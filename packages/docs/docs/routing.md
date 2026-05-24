---
id: routing
title: Routing
sidebar_position: 3
---

fastworker uses strict file-system routing inspired by the Next.js App Router. The directory structure inside `modules/` defines your entire API surface — no route configuration files needed.

## Core Rules

### Rule 1: Only `api.ts` Files Become Routes

The router scans the `modules/` directory recursively, but **only** files named exactly `api.ts` (or `api.js`) are registered as routes. Every other file is completely invisible to the router.

```
modules/
├── users/
│   ├── api.ts          ✅ Route: GET/POST /users
│   ├── schema.ts       ❌ Ignored (not api.ts)
│   ├── helpers.ts      ❌ Ignored
│   ├── users.test.ts   ❌ Ignored
│   └── README.md       ❌ Ignored
```

This enables **native colocation** — put schemas, tests, utilities, and documentation right next to the routes that use them.

### Rule 2: Folder Structure = URL Structure

Each directory level maps to a URL segment:

```
modules/users/api.ts              → /users
modules/users/settings/api.ts     → /users/settings
modules/billing/invoices/api.ts   → /billing/invoices
```

### Rule 3: Bracket Folders = Dynamic Parameters

Directories wrapped in square brackets become dynamic URL segments. The parameter value is available via `ctx.params`:

```
modules/users/[id]/api.ts         → /users/:id
modules/posts/[slug]/api.ts       → /posts/:slug
modules/orgs/[orgId]/teams/[teamId]/api.ts → /orgs/:orgId/teams/:teamId
```

```typescript
// modules/users/[id]/api.ts
export async function GET(ctx: FastworkerContext) {
  const userId = ctx.params.id;  // string — always a string
  return new Response(`User ${userId}`);
}
```

## Route Matching Priority

Routes are matched in this order:

1. **Static routes** (no dynamic segments) — matched first
2. **Dynamic routes** (with `[param]` segments) — matched second
3. Within each category: **more segments first**, then **alphabetical**

Example matching order:

```
/users/me        → modules/users/me/api.ts       (static, matched first)
/users/settings  → modules/users/settings/api.ts  (static)
/users/123       → modules/users/[id]/api.ts       (dynamic, matched second)
```

This ensures specific static routes always take priority over catch-all dynamic routes.

## HTTP Method Handlers

Export named functions matching HTTP methods — they become the handlers for that method on that route:

```typescript
// modules/users/api.ts

export async function GET(ctx) { ... }     // Handles GET /users
export async function POST(ctx) { ... }    // Handles POST /users
export async function PUT(ctx) { ... }     // Handles PUT /users
export async function PATCH(ctx) { ... }   // Handles PATCH /users
export async function DELETE(ctx) { ... }  // Handles DELETE /users
export async function HEAD(ctx) { ... }    // Handles HEAD /users
export async function OPTIONS(ctx) { ... } // Handles OPTIONS /users
```

Supported methods: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`

### Method Not Allowed

If a request matches a route but the HTTP method isn't exported, the router returns a `405 Method Not Allowed` response with the `Allow` header listing the available methods.

```bash
# If api.ts only exports GET:
curl -X DELETE /users
# → 405 { "error": "Method Not Allowed", "allowedMethods": ["GET"] }
```

### Not Found

If no route pattern matches the URL, the router returns a `404 Not Found` with a hint:

```json
{
  "error": "Not Found",
  "message": "No route matches \"/nonexistent\".",
  "hint": "Ensure you have an api.ts file in the corresponding modules/ directory."
}
```

## The `ctx` Object

Every handler receives a `ctx` (context) object:

```typescript
export async function GET(ctx: FastworkerContext) {
  ctx.req;     // Standard Web API Request
  ctx.params;  // { id: '123' } — dynamic route parameters
  ctx.env;     // Environment variables / platform bindings
  ctx.call;    // Type-safe RPC client for cross-module calls
}
```

| Property | Type | Description |
|---|---|---|
| `ctx.req` | `Request` | Standard Web API Request (not Cloudflare-specific) |
| `ctx.params` | `Record<string, string>` | Dynamic route params, always strings |
| `ctx.env` | `Record<string, unknown>` | Env vars (`.dev.vars` / `.env` / platform bindings) |
| `ctx.call` | `RPCClient<TModules>` | Type-safe cross-module RPC (see [RPC Guide](./rpc.md)) |

The entire `ctx` object is **frozen** (`Object.freeze`) — it cannot be mutated.

## Handlers Must Return `Response`

Every handler must return a standard Web API `Response` (or a `Promise<Response>`):

```typescript
// ✅ Correct — returns Response
export async function GET(ctx: FastworkerContext) {
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// ✅ Also correct — sync return
export function GET(ctx: FastworkerContext) {
  return new Response('Hello');
}

// ❌ Incorrect — returns plain object (will crash)
export async function GET(ctx: FastworkerContext) {
  return { ok: true };  // NOT a Response!
}
```

## Advanced Patterns

### Nested Dynamic Routes

```
modules/orgs/[orgId]/members/[memberId]/api.ts
→ /orgs/:orgId/members/:memberId
```

```typescript
export async function GET(ctx: FastworkerContext) {
  const { orgId, memberId } = ctx.params;
  // Both are strings
}
```

### Root Route

Place `api.ts` directly in the modules directory for a root (`/`) route:

```
modules/api.ts → /
```

### Extracting Query Parameters

Use the standard `Request` API:

```typescript
export async function GET(ctx: FastworkerContext) {
  const url = new URL(ctx.req.url);
  const page = url.searchParams.get('page') ?? '1';
  const limit = url.searchParams.get('limit') ?? '10';
  // ...
}
```

### Accessing Request Headers

```typescript
export async function GET(ctx: FastworkerContext) {
  const auth = ctx.req.headers.get('Authorization');
  const contentType = ctx.req.headers.get('Content-Type');
  // ...
}
```

### Reading Request Body

```typescript
export async function POST(ctx: FastworkerContext) {
  // JSON body
  const body = await ctx.req.json();

  // Form data
  const formData = await ctx.req.formData();

  // Raw text
  const text = await ctx.req.text();

  // Binary
  const buffer = await ctx.req.arrayBuffer();
}
```
