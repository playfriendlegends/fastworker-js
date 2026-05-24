---
id: getting-started
title: Getting Started
sidebar_position: 2
---

Set up your first fastworker project in under 2 minutes.

## Prerequisites

- **Node.js** ≥ 18.0.0
- **npm**, **pnpm**, **yarn**, or **bun**

## 1. Scaffold a New Project

```bash
npx create-fastworker my-app
```

The CLI will ask you four questions:

| Prompt | Options | Default |
|---|---|---|
| Project name | any valid npm name | `my-fastworker-app` |
| Language | TypeScript / JavaScript | TypeScript |
| Deploy mode | Monolith / Microservices | — |
| Adapter | Cloudflare Workers / Node.js | — |

> **Tip:** TypeScript is strongly recommended — it enables full `ctx.call` auto-completion across modules.

:::tip Agnostic & Easy Migration
Don't worry about picking the "wrong" options. You can easily switch your **Deploy mode** or **Adapter** later at any time by simply editing `fastworker.config.ts`. You **never** need to rewrite a single line of your application/business logic code to transition from Monolith to Microservices, or to migrate from Cloudflare Workers to Node.js.
:::

## 2. Install Dependencies

```bash
cd my-app
npm install
```

## 3. Explore the Structure

```
my-app/
├── modules/
│   ├── users/
│   │   ├── api.ts          → GET/POST /users
│   │   └── schema.ts       → colocated, NOT a route
│   └── auth/
│       └── api.ts          → POST /auth
├── fastworker.config.ts
├── package.json
└── tsconfig.json
```

Key rules:
- **Only `api.ts` files become routes** — everything else is safely colocated
- **Folder structure = URL structure** — `modules/users/api.ts` → `/users`
- **Bracket folders = dynamic params** — `modules/users/[id]/api.ts` → `/users/:id`

## 4. Write Your First Handler

```typescript
// modules/users/api.ts
import type { FastworkerContext } from 'fastworker-js';

export async function GET(ctx: FastworkerContext) {
  return new Response(JSON.stringify({ message: 'Hello from /users!' }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
```

Export HTTP methods by name: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`.

## 5. Add Cross-Module RPC

```typescript
// modules/users/api.ts — add an RPC function
export async function getProfile(input: { id: number }) {
  return { id: input.id, name: 'Alice' };
}
```

```typescript
// modules/billing/api.ts — call it from another module
import type { FastworkerContext } from 'fastworker-js';

export async function GET(ctx: FastworkerContext) {
  // Type-safe! Full autocompletion on ctx.call
  const user = await ctx.call.users.getProfile({ id: 123 });
  return new Response(JSON.stringify({ user }));
}
```

In **monolith mode**, this is a zero-latency direct function call.
In **microservices mode**, this automatically becomes a Service Binding call (Cloudflare) or HTTP fetch (Node.js).

## 6. Build & Run

```bash
# Build the project
npx fastworker build

# Run locally
npx wrangler dev          # Cloudflare adapter
# or
node dist/index.js        # Node.js adapter
```

## 7. Test Your Routes

```bash
# List users
curl http://localhost:8787/users

# Get single user (dynamic route)
curl http://localhost:8787/users/123

# Authenticate
curl -X POST http://localhost:8787/auth \
  -H "Content-Type: application/json" \
  -d '{"email": "alice@example.com", "password": "secret"}'
```

## Next Steps

- [Configuration Reference](./configuration.md) — full config options
- [Routing Guide](./routing.md) — advanced routing patterns
- [RPC Guide](./rpc.md) — cross-module communication deep dive
- [Deployment Guide](./deployment.md) — monolith vs microservices
