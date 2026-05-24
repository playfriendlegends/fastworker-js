---
id: rpc
title: Cross-Module RPC
sidebar_position: 4
---

`ctx.call` is fastworker's type-safe cross-module communication system. It lets you call functions across module boundaries as if they were local — the framework handles the transport transparently.

## How It Works

Any exported function in `api.ts` that is **not** an HTTP method handler becomes RPC-callable:

```typescript
// modules/users/api.ts

// ✅ HTTP handler — routed to GET /users
export async function GET(ctx: FastworkerContext) { ... }

// ✅ RPC function — callable via ctx.call.users.getProfile()
export async function getProfile(input: { id: number }) {
  return { id: input.id, name: 'Alice' };
}

// ✅ Another RPC function
export async function exists(input: { id: number }): Promise<boolean> {
  return input.id > 0;
}

// ❌ Non-function export — NOT callable via RPC
export const CACHE_TTL = 3600;
```

**The rule is simple:** HTTP method names (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`) are route handlers. Everything else is an RPC function.

## Calling RPC Functions

From any other module, use `ctx.call.{moduleName}.{functionName}()`:

```typescript
// modules/billing/api.ts
import type { FastworkerContext } from 'fastworker-js';

export async function GET(ctx: FastworkerContext) {
  // Call the users module
  const user = await ctx.call.users.getProfile({ id: 123 });

  // Call the auth module
  const auth = await ctx.call.auth.verifyToken({ token: 'abc' });

  return new Response(JSON.stringify({ user, auth }));
}
```

### What You Get

- **Full TypeScript autocompletion** on module names and function signatures
- **Zero boilerplate** — no client setup, no URL construction, no serialization
- **Transport transparency** — same code works in monolith and microservices

## Enabling Type Safety via `types.ts`

To get full autocompletion and type checking on `ctx.call`, fastworker uses a central `types.ts` file in the root of your project. This file maps each module name to its corresponding API types.

### The `types.ts` File

When you scaffold a project with `create-fastworker`, a `types.ts` file is generated in your project root:

```typescript
// types.ts
import type * as UsersModule from './modules/users/api.js';
import type * as AuthModule from './modules/auth/api.js';

export interface Modules {
  users: typeof UsersModule;
  auth: typeof AuthModule;
}
```

### Passing Modules to Context

To enable typing in your route handlers, pass the `Modules` interface as a type parameter to `FastworkerContext`:

```typescript
import type { FastworkerContext } from 'fastworker-js';
import type { Modules } from '../../types.js'; // Import the type map from your project root

export async function GET(ctx: FastworkerContext<Modules>) {
  // Now ctx.call.users.getProfile is fully typed!
  const user = await ctx.call.users.getProfile({ id: 123 });
}
```

### Adding New Modules

Whenever you create a new module (e.g. `billing`):
1. Create `modules/billing/api.ts`.
2. Open `types.ts` at your project root.
3. Import the new module's api file:
   ```typescript
   import type * as BillingModule from './modules/billing/api.js';
   ```
4. Add it to the `Modules` interface:
   ```typescript
   export interface Modules {
     ...
     billing: typeof BillingModule;
   }
   ```
This immediately enables autocompletion and type checking for `ctx.call.billing` everywhere in your project!

## Transport Behavior by Deploy Mode

| Mode | What `ctx.call.users.getProfile()` Does |
|---|---|
| **Monolith** | Direct function call. Zero latency, zero serialization. |
| **Microservices (Cloudflare)** | `env.ACCOUNT_SERVICE.fetch('/__rpc', ...)` via Service Binding |
| **Microservices (Cloudflare fallback)** | `fetch('http://localhost:3001/__rpc', ...)` if binding unavailable |
| **Microservices (Node.js)** | `fetch('http://localhost:3001/__rpc', ...)` via services map |

**Your code doesn't change.** The compiler generates the appropriate transport based on your config.

## The `/__rpc` Endpoint

In microservices mode, each worker automatically exposes a `POST /__rpc` endpoint. This is an **internal** endpoint used by the RPC system — you don't need to create or manage it.

Request format:

```json
{
  "module": "users",
  "function": "getProfile",
  "args": [{ "id": 123 }]
}
```

Response: the function's return value as JSON.

## Safety Guards

### HTTP Methods Cannot Be Called via RPC

```typescript
// ❌ This will throw an error
const response = await ctx.call.users.GET(ctx);
// Error: Cannot call HTTP handler "GET" via ctx.call.
//   "GET" is an HTTP route handler, not an RPC function.
```

### Unknown Modules Throw Descriptive Errors

```typescript
const result = await ctx.call.nonexistent.someFunction();
// Error: Module "nonexistent" not found.
//   Available modules: users, auth, billing
//   Ensure "nonexistent/api.ts" exists in your modules directory.
```

### Unknown Functions List Available Alternatives

```typescript
const result = await ctx.call.users.nonExistentFn();
// Error: Function "nonExistentFn" not found in module "users".
//   Available RPC functions: getProfile, exists, getDisplayName
```

### Network & Binding Failures Throw Detailed Errors

In microservices mode, if a remote RPC call fails due to a network connection issue or a misconfigured Cloudflare Service Binding, the framework throws a descriptive error:

```text
Error: [fastworker] RPC users.getProfile() network request failed:
  URL: http://localhost:3001/__rpc
  Error: fetch failed
  Ensure the target worker "account_service" is running at that URL.
```

## Patterns & Best Practices

### Module-Internal Reuse

RPC functions can call each other within the same module:

```typescript
// modules/users/api.ts

export async function getProfile(input: { id: number }) {
  return { id: input.id, name: 'Alice' };
}

export async function getDisplayName(input: { id: number }) {
  // Reuse getProfile — this is a normal function call, not RPC
  const profile = await getProfile(input);
  return profile.name;
}
```

### Multi-Module Fan-Out

A handler can call multiple modules:

```typescript
export async function GET(ctx: FastworkerContext) {
  // Parallel calls to different modules
  const [user, billingStatus, authInfo] = await Promise.all([
    ctx.call.users.getProfile({ id: 1 }),
    ctx.call.billing.getStatus({ userId: 1 }),
    ctx.call.auth.verifyToken({ token: 'abc' }),
  ]);

  return new Response(JSON.stringify({ user, billingStatus, authInfo }));
}
```

### Error Handling

RPC calls throw on failure. Use try/catch:

```typescript
export async function GET(ctx: FastworkerContext) {
  try {
    const user = await ctx.call.users.getProfile({ id: 123 });
    return new Response(JSON.stringify(user));
  } catch (error) {
    // Handle RPC failure (network error, module error, etc.)
    return new Response(
      JSON.stringify({ error: 'Failed to fetch user' }),
      { status: 502 },
    );
  }
}
```

### Serialization Constraints

In **microservices mode**, arguments and return values are serialized to JSON. This means:

- ✅ Primitives, objects, arrays, null
- ❌ Functions, classes, Symbols, circular references
- ❌ `Date` objects → become strings (use `.toISOString()`)
- ❌ `Map`, `Set` → become empty objects (use arrays/objects instead)

In **monolith mode**, no serialization occurs — you can pass anything.

## How the Proxy Chain Works (Internals)

`ctx.call` uses a two-tier ES `Proxy` chain:

```
ctx.call                    → Level-1 Proxy (intercepts module name)
ctx.call.users              → Level-2 Proxy (intercepts function name)
ctx.call.users.getProfile   → Returns async function
ctx.call.users.getProfile() → Invokes: local call or transport.invoke()
```

- **Level-1 Proxy:** Captures the module name (e.g., `'users'`)
- **Level-2 Proxy:** Captures the function name (e.g., `'getProfile'`)
- The returned function either calls the module directly (monolith) or delegates to the `RPCTransport` (microservices)

Errors are **deferred** — accessing `ctx.call.nonexistent` doesn't throw. Only calling `ctx.call.nonexistent.fn()` throws, with a descriptive message listing available modules.
