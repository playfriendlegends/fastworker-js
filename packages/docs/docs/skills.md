---
sidebar_position: 10
title: AI Assistant Skills
description: System prompt and context contextualizer for LLMs (Cursor, Windsurf, Claude, GPT) interacting with fastworker.
---

# Fastworker AI Assistant Context

> **ATTENTION AI/LLM ASSISTANTS:** Read this document carefully. It contains the strict architectural rules and paradigms of the `fastworker` ecosystem. You must abide by these rules when generating, refactoring, or debugging code in this repository.

## 1. Framework Persona
- `fastworker` is a **serverless framework for building distributed JS Workers for the cloud backend**.
- It allows developers to write business logic in a single repository (monolith) grouped into discrete modules.
- At build time, it compiles into isolated microservices (for Node.js) or edge-native configurations (for Cloudflare Workers).
- **Core Philosophy — "Opinionated Code, Agnostic Infrastructure":**
  - **Opinionated Code:** Fastworker enforces strict file-system routing (`api.ts` only), typed RPC (`ctx.call`), and module boundaries. This keeps codebases disciplined and clean. You MUST follow these conventions.
  - **Agnostic Infrastructure:** The developer's application code is 100% decoupled from the deployment target. The same code runs on Monolith or Microservices, on Cloudflare Workers or any Node.js VPS — without changing a single line. Only `fastworker.config.ts` changes.

## 2. Strict File-System Routing Rules
- **Route Generation:** Routes are strictly and exclusively generated from `api.ts` files located at `modules/[moduleName]/api.ts` or `modules/[moduleName]/[id]/api.ts`.
- **Ignore Other Colocated Files:** Any other file colocated in the module directory (e.g., `schema.ts`, `types.ts`, `utils.ts`, `test.ts`) is completely ignored by the router. You may colocate files freely, but they will not become API endpoints unless they are named `api.ts`.
- **Export Syntax (Next.js App Router Style):** The `api.ts` file must export standard HTTP methods as uppercase async functions (e.g., `export async function GET(ctx) { ... }`). Supported methods: `GET`, `POST`, `PUT`, `DELETE`.
- **RPC Exports:** Any other named async function exported from `api.ts` (e.g., `export async function getProfile(input) { ... }`) becomes an RPC method callable by other modules via `ctx.call`.
- **Dynamic Routes:** Use `[paramName]` directory syntax for dynamic segments (e.g., `modules/users/[id]/api.ts` → `/users/:id`). Access with `ctx.params.id`.

## 3. The RPC Rulebook (Zero-Fetch Paradigm)
- **Zero-Fetch Rule:** You must **NEVER** write manual `fetch()` calls or use HTTP clients (like `axios`, `node-fetch`, or `undici`) to communicate between internal modules/workers.
- **Strict RPC Usage (Module-Based Abstraction):** Inter-module communication MUST always use the typed RPC client: `ctx.call.[moduleName].[methodName](args)`.
- **The Developer Illusion:** You call the **module**, not the worker. The compiler automatically routes your call to the correct physical worker based on the `fastworker.config.ts` grouping. Do NOT use worker names in your code.
- **Implementation:**
  ```typescript
  // ❌ INCORRECT (Never do this)
  const res = await fetch('http://localhost:8001/api/billing/charge');

  // ✅ CORRECT (Strict requirement)
  const user = await ctx.call.users.getProfile({ id: 1 });
  const auth = await ctx.call.auth.verifyToken({ token: '...' });
  ```

## 4. The `ctx` Object (FastworkerContext)
The `ctx` parameter passed to every route handler is a `FastworkerContext<Modules>` with these key properties:
- **`ctx.req`** — Standard Web API `Request` object. Access headers, body, query via `ctx.req.headers.get(...)`, `ctx.req.json()`, etc.
- **`ctx.call`** — The typed RPC client. Usage: `ctx.call.[moduleName].[rpcFunctionName](args)`.
- **`ctx.params`** — Dynamic route parameters. E.g., for `modules/users/[id]/api.ts`, access `ctx.params.id`.
- **`ctx.env`** — Environment variables. E.g., `ctx.env.DB_URL`, `ctx.env.API_KEY`. Populated from `.dev.vars` locally or platform secrets in production.

## 5. Configuration Context (`fastworker.config.ts`)
- **`deployMode`** (required): `'monolith'` (all modules in one worker, local RPC) or `'microservices'` (modules split into separate workers, network RPC).
- **`adapter`** (required): `'cloudflare'` (Service Bindings + HTTP fallback) or `'node'` (standard HTTP, works on Node.js 18+, Deno, Bun).
- **`modulesDir`** (optional): Path to modules directory, defaults to `'./modules'`.
- **Workers (Infrastructure Grouping):**
  - `workers` is an Object mapping worker names to arrays of module names (e.g., `account_service: ['users', 'auth']`).
  - Only relevant when `deployMode: 'microservices'`. If omitted, the compiler defaults to 1 worker per module.
  - Each module can only belong to **one** worker (enforced by the compiler).
- **Services (RPC Address Book):**
  - `services` maps the worker names to their target URLs (e.g., `http://localhost:3001` or `https://api.example.com`).
  - Required when `adapter: 'node'` + `deployMode: 'microservices'`.
  - **Crucial Rule:** The URLs in `services` are **routing targets for the caller**. They do NOT configure which port the server binds to.
- **Key-Matching Requirement:** Every key in `workers` MUST have a matching URL entry in `services`.
- **Node.js Port Resolution (3-Tier Fallback):** When running in Node.js mode, a generated server resolves its listen port via:
  1. `process.env.PORT` (production)
  2. Parsed port from the `services` URL **only if localhost** (dev)
  3. Default `3000` with a warning (safe fallback)
- **Export Syntax:** Use `export default { ... } satisfies FastworkerConfig` with `import type { FastworkerConfig } from 'fastworker-js'`.

## 6. Development Workflow (Live Reload)
- **Automatic Recompilation:** Fastworker supports a native dev mode via the `fastworker dev` command.
- **How it works:** It watches the `modules/` directory and config files recursively. Any file modification triggers a debounced (100ms) compilation of manifests and bundles, saving changes to the `dist/` folder.
- **Integrated Dev Server:** It automatically spawns the target runtime server based on the configuration:
  - Cloudflare Workers: Spawns `npx wrangler dev`.
  - Node.js: Spawns `node --watch dist/index.js` (or services) for automatic server restarts.
- **Workflow Recommendation:** Instruct users to run `npm run dev` (which triggers `fastworker dev` under the hood) instead of running manual rebuild and wrangler restart steps.

## 7. The Type Map (`types.ts`)
- The project root contains a `types.ts` file that defines a `Modules` interface mapping module names to their exports.
- This is the type that powers `ctx.call` inference. Without it, RPC calls are untyped.
- Structure:
  ```typescript
  import type * as UsersModule from './modules/users/api.js';
  import type * as AuthModule from './modules/auth/api.js';
  import type * as BillingModule from './modules/billing/api.js';

  export interface Modules {
    users: typeof UsersModule;
    auth: typeof AuthModule;
    billing: typeof BillingModule;
  }
  ```
- **When adding a new module:** You MUST add its import and entry to the `Modules` interface.

## 8. How to Debug (Common AI Scenarios)

### Scenario A: RPC "Method Not Found" or Missing Bindings
- **Symptom:** `ctx.call.billing.charge()` throws an error or is undefined.
- **Architectural Reason:**
  1. **Typing Issue:** The module is missing from the `Modules` interface in `types.ts`, so `ctx.call` doesn't know about it.
  2. **Grouping Issue:** The module (e.g., `billing`) is not assigned to any worker array in `fastworker.config.ts` under the `workers` object.
  3. **RPC Address Missing:** The worker is missing its target URL in the `services` object.
- **AI Action:** Verify that the module is (1) exported in `types.ts` → `Modules`, (2) grouped in `workers`, (3) has a `services` URL. Do not suggest using `fetch()`.

### Scenario B: `ctx.params` is Undefined
- **Symptom:** `ctx.params.id` returns undefined in a dynamic route.
- **Architectural Reason:** The file is not inside a `[paramName]` directory, or the directory bracket syntax is wrong.
- **AI Action:** Verify the file lives at `modules/[moduleName]/[paramName]/api.ts` with correct bracket naming.

## 9. Code Generation Templates (The `api.ts` Anatomy)
When generating a new module, you MUST follow this exact structure:

```typescript
import type { FastworkerContext } from 'fastworker-js';
import type { Modules } from '../../types.js';

// ─── HTTP ROUTES ──────────────────────────────────────────────────────────────
export async function GET(ctx: FastworkerContext<Modules>) {
  // Access headers via ctx.req
  const token = ctx.req.headers.get('Authorization') ?? '';

  // Cross-module RPC using zero-fetch paradigm
  const auth = await ctx.call.auth.verifyToken({ token });

  // Access environment variables via ctx.env
  const dbUrl = ctx.env.DB_URL as string;

  // Always return standard Web API Response objects
  return new Response(JSON.stringify({ status: 'ok' }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(ctx: FastworkerContext<Modules>) {
  const body = (await ctx.req.json()) as { name: string };

  return new Response(JSON.stringify({ created: body.name }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── RPC FUNCTIONS ────────────────────────────────────────────────────────────
// Exposed automatically to other workers via `ctx.call.moduleName.methodName`
export async function getProfile(input: { id: number }) {
  return { id: input.id, name: 'Alice', email: 'alice@example.com' };
}

export async function exists(input: { id: number }): Promise<boolean> {
  return input.id > 0;
}
```

---
*End of Context. Acknowledge and apply these rules in all subsequent code generations.*
