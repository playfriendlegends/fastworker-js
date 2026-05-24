# fastworker

**Platform-Agnostic Stateless Modular Monolith Framework**

Build modular APIs with strict file-system routing (Next.js App Router style), type-safe cross-module RPC, and flexible deployment — from a single monolith to fully isolated microservices — on Cloudflare Workers, Node.js, or any WinterCG-compatible runtime.

## Key Features

- **Strict File-System Routing** — Only `api.ts` files become routes. Everything else is colocated and ignored.
- **Type-Safe RPC** (`ctx.call`) — Call functions across modules with full TypeScript autocompletion. Zero boilerplate.
- **Compiler-Driven Deployment** — One codebase, two topologies:
  - `monolith` — Everything bundled into a single worker. `ctx.call` is a zero-latency local function call.
  - `microservices` — Modules split into separate workers. `ctx.call` becomes Cloudflare Service Bindings or HTTP fetch under the hood.
- **Platform-Agnostic Adapters** — First-class support for Cloudflare Workers and Node.js, with auto-fallback when Service Bindings are unavailable.
- **Automated Infrastructure** — The compiler generates `wrangler.toml`, `[[services]]` bindings, and distributes env vars automatically.

## Quick Start

```bash
npx create-fastworker my-app
cd my-app
npm install
npm run dev
```

## Project Structure

```
my-app/
├── modules/
│   ├── users/
│   │   ├── api.ts          → GET/POST /users
│   │   ├── schema.ts       → colocated, not a route
│   │   └── [id]/
│   │       └── api.ts      → GET/PUT/DELETE /users/:id
│   └── billing/
│       └── api.ts          → GET/POST /billing
├── fastworker.config.ts
└── package.json
```

## Route Handlers

```typescript
// modules/users/api.ts
import type { FastworkerContext } from 'fastworker-js';

export async function GET(ctx: FastworkerContext) {
  return new Response(JSON.stringify({ users: [] }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// RPC-callable by other modules via ctx.call.users.getProfile()
export async function getProfile(input: { id: number }) {
  return { id: input.id, name: 'Alice' };
}
```

## Cross-Module RPC

```typescript
// modules/billing/api.ts
import type { FastworkerContext } from 'fastworker-js';

export async function GET(ctx: FastworkerContext) {
  // Type-safe! Full autocompletion on ctx.call
  const user = await ctx.call.users.getProfile({ id: 123 });
  return new Response(JSON.stringify({ user, balance: 100 }));
}
```

## Configuration

```typescript
// fastworker.config.ts
const isProd = process.env.NODE_ENV === 'production';

export default {
  deployMode: 'microservices',
  adapter: 'cloudflare',
  workers: {
    account_service: ['users', 'auth'],
    billing_service: ['billing'],
  },
  services: {
    account_service: isProd ? 'https://account.api.example.com' : 'http://localhost:3001',
    billing_service: isProd ? 'https://billing.api.example.com' : 'http://localhost:3002',
  },
};
```

## Packages

| Package | Description |
|---|---|
| [`fastworker`](./packages/fastworker) | Core framework — types, compiler, router, RPC |
| [`create-fastworker`](./packages/create-fastworker) | CLI scaffolding tool |
| [`docs`](./packages/docs) | Docusaurus documentation |

## License

MIT
