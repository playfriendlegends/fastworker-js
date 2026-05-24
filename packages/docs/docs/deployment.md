---
id: deployment
title: Deployment
sidebar_position: 7
---

fastworker supports two deployment topologies and two platform adapters. This guide covers every combination.

## Deployment Topology

### Monolith

All modules bundled into **one** worker or server.

```
┌─────────────────────────────────────────┐
│              Single Worker              │
│                                         │
│  /users   → users/api.ts               │
│  /auth    → auth/api.ts                │
│  /billing → billing/api.ts             │
│                                         │
│  ctx.call = direct function call        │
│  (zero latency, zero serialization)     │
└─────────────────────────────────────────┘
```

**Best for:** Getting started, small-to-medium projects, prototyping.

**Config:**
```typescript
export default {
  deployMode: 'monolith',
  adapter: 'cloudflare', // or 'node'
} satisfies FastworkerConfig;
```

**Output:** Single `dist/index.js` bundle.

---

### Microservices

Modules split into **separate workers** behind a gateway.

```
┌───────────────────┐     ┌─────────────────────────┐
│      Gateway      │────▶│    account_service       │
│                   │     │  /users  → users/api.ts  │
│  Routes requests  │     │  /auth   → auth/api.ts   │
│  to the correct   │     └─────────────────────────┘
│  service worker   │
│                   │     ┌─────────────────────────┐
│                   │────▶│   billing_service        │
│                   │     │  /billing → billing/api  │
└───────────────────┘     └─────────────────────────┘
```

**Best for:** Large projects, team autonomy, independent scaling.

**Config:**
```typescript
export default {
  deployMode: 'microservices',
  adapter: 'cloudflare',
  workers: {
    account_service: ['users', 'auth'],
    billing_service: ['billing'],
  },
  services: {
    account_service: 'http://localhost:3001',
    billing_service: 'http://localhost:3002',
  },
} satisfies FastworkerConfig;
```

**Output:**
```
dist/
├── gateway/
│   ├── index.js
│   └── wrangler.toml     (with [[services]] blocks)
├── account_service/
│   ├── index.js
│   └── wrangler.toml
└── billing_service/
    ├── index.js
    └── wrangler.toml
```

---

## Platform Adapters

### Cloudflare Workers

Uses Cloudflare's global edge network. In microservices mode, modules communicate via **Service Bindings** (zero-egress, same-account RPC).

#### Monolith Deployment

```bash
npx fastworker build
npx wrangler deploy
```

#### Microservices Deployment

```bash
npx fastworker build

# Deploy each worker
cd dist/account_service && npx wrangler deploy
cd dist/billing_service && npx wrangler deploy
cd dist/gateway && npx wrangler deploy  # deploy gateway LAST
```

> **Deploy the gateway last** — it depends on Service Bindings to the other workers.

#### Auto-Generated `wrangler.toml`

The compiler auto-generates `wrangler.toml` for each worker. The **gateway** gets `[[services]]` blocks:

```toml
# dist/gateway/wrangler.toml (auto-generated)
name = "gateway"
main = "./index.js"
compatibility_date = "2024-01-01"
compatibility_flags = ["nodejs_compat"]

[[services]]
binding = "ACCOUNT_SERVICE"
service = "account_service"

[[services]]
binding = "BILLING_SERVICE"
service = "billing_service"
```

The binding name is always the **UPPERCASED** worker name.

#### Service Binding Auto-Fallback

If a Service Binding is unavailable at runtime (e.g., running locally without `wrangler dev --remote`), the framework automatically falls back to HTTP `fetch()` using the `services` URLs:

```
ctx.call.users.getProfile()
  → try: env.ACCOUNT_SERVICE.fetch('/__rpc', ...)     // Service Binding
  → catch: fetch('http://localhost:3001/__rpc', ...)   // HTTP fallback
```

A warning is logged once per binding. The framework **never throws** on a missing binding if a fallback URL is configured.

---

### Node.js

Uses standard `http.createServer()` and `globalThis.fetch()`. Works on any platform with Node.js 18+.

#### Monolith Deployment

```bash
npx fastworker build
node dist/index.js
```

Or with Docker:

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY dist/ ./dist/
CMD ["node", "dist/index.js"]
```

#### Microservices Deployment

Each worker runs as a separate Node.js process:

```bash
npx fastworker build

# Terminal 1: Account service
PORT=3001 node dist/account_service/server.js

# Terminal 2: Billing service
PORT=3002 node dist/billing_service/server.js

# Terminal 3: Gateway
PORT=3000 node dist/gateway/server.js
```

#### Port Binding (3-Tier Fallback)

The generated Node.js servers use a strict 3-tier fallback for port assignment. This is **decoupled** from the `services` URLs:

| Priority | Source | Bind Address | Use Case |
|---|---|---|---|
| 1 | `process.env.PORT` | `0.0.0.0:PORT` | Production / VPS / Docker |
| 2 | Parsed from services URL (localhost only) | `127.0.0.1:PORT` | Local development |
| 3 | Default `3000` + warning | `127.0.0.1:3000` | Safe fallback |

**Why this matters:** If your services config has `'https://billing.api.example.com'`, the server won't try to bind to that domain. It will use `PORT` env or fall back to `3000`.

#### VPS / Docker Compose Example

```yaml
# docker-compose.yml
version: '3.8'
services:
  gateway:
    build: .
    command: node dist/gateway/server.js
    ports:
      - "3000:3000"
    environment:
      - PORT=3000

  account-service:
    build: .
    command: node dist/account_service/server.js
    environment:
      - PORT=3001

  billing-service:
    build: .
    command: node dist/billing_service/server.js
    environment:
      - PORT=3002
```

#### Nginx Reverse Proxy Example

```nginx
upstream gateway {
    server 127.0.0.1:3000;
}

server {
    listen 80;
    server_name api.example.com;

    location / {
        proxy_pass http://gateway;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## Environment Variables

### Development

Place a single env file in your project root:

| Adapter | File | Format |
|---|---|---|
| Cloudflare | `.dev.vars` | `KEY=value` per line |
| Node.js | `.env` | `KEY=value` per line |

In microservices mode, the compiler **automatically copies** this file to every worker's output directory.

### Production

| Adapter | Method |
|---|---|
| Cloudflare | `wrangler secret put SECRET_NAME` per worker |
| Node.js | Platform env config (Docker ENV, systemd, etc.) |

---

## Migrating Between Modes

### Monolith → Microservices

1. Add `workers` map to group your modules
2. Add `services` map with URLs for each worker
3. Change `deployMode: 'microservices'`
4. Rebuild — your module code stays **exactly the same**

```diff
 export default {
-  deployMode: 'monolith',
+  deployMode: 'microservices',
   adapter: 'cloudflare',
+  workers: {
+    account_service: ['users', 'auth'],
+    billing_service: ['billing'],
+  },
+  services: {
+    account_service: 'http://localhost:3001',
+    billing_service: 'http://localhost:3002',
+  },
 } satisfies FastworkerConfig;
```

### Cloudflare → Node.js

1. Change `adapter: 'node'`
2. Ensure `services` map is provided (required for Node microservices)
3. Rebuild — your module code stays **exactly the same**

```diff
 export default {
   deployMode: 'microservices',
-  adapter: 'cloudflare',
+  adapter: 'node',
   // ...
 } satisfies FastworkerConfig;
```
