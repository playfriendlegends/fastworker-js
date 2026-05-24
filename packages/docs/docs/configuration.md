---
id: configuration
title: Configuration
sidebar_position: 5
---

Full reference for `fastworker.config.ts` — the single source of truth for your project's build and deployment behavior.

## Config File Location

The compiler looks for config files in this order:

1. `fastworker.config.ts`
2. `fastworker.config.mts`
3. `fastworker.config.js`
4. `fastworker.config.mjs`

TypeScript config files are compiled on-the-fly by esbuild — no `tsx` or `ts-node` required.

## Full Config Type

```typescript
import type { FastworkerConfig } from 'fastworker-js';

export default {
  deployMode: 'monolith',
  adapter: 'cloudflare',
  modulesDir: './modules',
  workers: { ... },
  services: { ... },
} satisfies FastworkerConfig;
```

## Config Options

### `deployMode` (required)

How modules are bundled for deployment.

| Value | Description |
|---|---|
| `'monolith'` | All modules in a single worker. `ctx.call` is zero-latency local. |
| `'microservices'` | Modules split into separate workers. `ctx.call` uses network RPC. |

```typescript
deployMode: 'monolith',
```

---

### `adapter` (required)

Target platform adapter. Drives code generation — the compiler emits different RPC transport code per adapter.

| Value | Description |
|---|---|
| `'cloudflare'` | Cloudflare Workers with Service Bindings + auto-fallback to HTTP |
| `'node'` | Standard HTTP fetch. Works on Node.js 18+, Deno, Bun, any VPS. |

```typescript
adapter: 'cloudflare',
```

---

### `modulesDir` (optional)

Path to the modules directory, relative to the config file.

- **Default:** `'./modules'`
- Must be an existing directory

```typescript
modulesDir: './src/modules',
```

---

### `workers` (optional)

Groups source modules into named infrastructure workers. Only relevant when `deployMode: 'microservices'`.

If omitted, the compiler defaults to **1 worker per top-level module directory**.

```typescript
workers: {
  account_service: ['users', 'auth'],
  billing_service: ['billing', 'invoices'],
},
```

**Rules:**
- Worker names must be lowercase with underscores (e.g., `account_service`)
- Each module can only belong to **one** worker (enforced by the compiler)
- Module names must match directory names in `modulesDir`
- The compiler auto-generates Cloudflare `[[services]]` bindings from this

**What the compiler generates:**

The `workers` map drives several auto-generated artifacts:

| Artifact | Generated From |
|---|---|
| Gateway `wrangler.toml` `[[services]]` | Worker names → `binding = "ACCOUNT_SERVICE"` |
| `ModuleToBindingMap` | Inverted: `{ users: 'ACCOUNT_SERVICE', auth: 'ACCOUNT_SERVICE' }` |
| Per-worker `wrangler.toml` | One per worker group |
| Per-worker esbuild bundle | Only the modules in that group |

---

### `services` (conditionally required)

Maps worker names to their network URLs. This is an **address book** for the RPC client — it tells the gateway where to find each worker.

**Required when:** `adapter: 'node'` + `deployMode: 'microservices'`

**Also used as:** HTTP fallback URLs for the Cloudflare adapter when Service Bindings are unavailable.

```typescript
const isProd = process.env.NODE_ENV === 'production';

services: {
  account_service: isProd
    ? 'https://account.api.example.com'
    : 'http://localhost:3001',
  billing_service: isProd
    ? 'https://billing.api.example.com'
    : 'http://localhost:3002',
},
```

> **⚠️ CRITICAL: Address Book, Not Server Config**
>
> These URLs tell the RPC client (caller/gateway) **where to send requests**.
> They do **NOT** configure which port a generated Node.js server binds to.
>
> You can safely use production HTTPS domains here — the Node.js server
> uses a separate 3-tier port fallback to determine its listen port.

### Why HTTPS URLs Don't Cause Port Errors

Consider this config:

```typescript
services: {
  billing_service: 'https://billing.api.example.com',
},
```

A naive implementation might try to `server.listen()` on `billing.api.example.com` — which would crash with `EADDRINUSE` or `ENOTFOUND`.

fastworker's architecture **decouples** these concerns:

| Concern | Component | Uses |
|---|---|---|
| **Where to send RPC calls** | Gateway / RPC client | `services` URLs (as-is) |
| **Where to listen** | Generated Node server | `resolvePort()` — 3-tier fallback |

The `resolvePort()` fallback:

1. `process.env.PORT` → bind `0.0.0.0:PORT` (production)
2. Parsed port from services URL **only if localhost** → bind `127.0.0.1:PORT` (dev)
3. Default `3000` with warning → bind `127.0.0.1:3000` (safe fallback)

---

## Helper: `defineConfig()`

For programmatic usage with type safety:

```typescript
import { defineConfig } from 'fastworker-js';

export default defineConfig({
  deployMode: 'monolith',
  // adapter defaults to 'cloudflare'
  // modulesDir defaults to './modules'
});
```

---

## Environment Variables

fastworker uses a unified environment variable strategy:

| Adapter | Dev File | Accessed Via |
|---|---|---|
| Cloudflare | `.dev.vars` | `ctx.env.VARIABLE_NAME` |
| Node.js | `.env` | `ctx.env.VARIABLE_NAME` |

**In microservices mode**, the compiler automatically copies the root env file to every worker's output directory — so `ctx.env.DB_URL` works consistently regardless of which worker handles the request.

**For production secrets:**
- Cloudflare: `wrangler secret put SECRET_NAME`
- Node.js: Platform-specific env config (Docker ENV, systemd, etc.)

> **Never commit `.dev.vars` or `.env` to version control.**
> The scaffolder generates a `.gitignore` that excludes these by default.

---

## Example Configs

### Minimal (Cloudflare Monolith)

```typescript
import type { FastworkerConfig } from 'fastworker-js';

export default {
  deployMode: 'monolith',
  adapter: 'cloudflare',
} satisfies FastworkerConfig;
```

### Full (Node.js Microservices)

```typescript
import type { FastworkerConfig } from 'fastworker-js';

const isProd = process.env.NODE_ENV === 'production';

export default {
  deployMode: 'microservices',
  adapter: 'node',
  modulesDir: './modules',
  workers: {
    account_service: ['users', 'auth', 'profile'],
    billing_service: ['billing', 'invoices', 'payments'],
    notification_service: ['email', 'sms', 'push'],
  },
  services: {
    account_service: isProd ? 'https://account.api.co' : 'http://localhost:3001',
    billing_service: isProd ? 'https://billing.api.co' : 'http://localhost:3002',
    notification_service: isProd ? 'https://notify.api.co' : 'http://localhost:3003',
  },
} satisfies FastworkerConfig;
```
