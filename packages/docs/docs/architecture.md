---
id: architecture
title: Architecture
sidebar_position: 6
---

Internal architecture of the fastworker compiler and runtime. This document explains how the framework works under the hood.

## High-Level Flow

```
Developer Code          Build-Time Compiler          Runtime
─────────────          ─────────────────          ───────

modules/                                           Incoming
├── users/api.ts    →  scanModules()              Request
├── auth/api.ts        generateRouteManifest()       │
└── billing/api.ts     esbuild bundle                ▼
                            │                   createRouter()
fastworker.config.ts  →  loadConfig()               │
                            │                   Match Route
                            ▼                       │
                       dist/index.js  ──────→  Extract Params
                       (or per-worker)             │
                                               Build ctx
                                                   │
                                               Invoke Handler
                                                   │
                                               Response
```

## Compiler Pipeline

The compiler (`packages/fastworker/src/compiler.ts`) orchestrates the entire build:

### 1. Config Loading

```
fastworker.config.ts
        │
        ▼
  esbuild (on-the-fly)    ← compiles TS config without tsx/ts-node
        │
        ▼
  validateConfig()         ← checks adapter, deployMode, workers uniqueness
        │
        ▼
  FastworkerConfig         ← validated, normalized config object
```

### 2. Module Scanning

```
modules/
├── users/api.ts
├── users/[id]/api.ts
├── users/schema.ts       ← SKIPPED (not api.ts)
├── auth/api.ts
└── billing/api.ts

        │
        ▼ scanModules()

RouteManifestEntry[]
  [
    { pattern: /^\/billing$/,               methods: ['GET','POST'], ... },
    { pattern: /^\/users$/,                 methods: ['GET','POST'], ... },
    { pattern: /^\/auth$/,                  methods: ['POST'],       ... },
    { pattern: /^\/users\/(?<id>[^\/]+)$/,  methods: ['GET','PUT','DELETE'], ... },
  ]
```

**Sorting:** Static routes before dynamic. More specific (more segments) before less specific.

### 3. Export Extraction

The compiler uses lightweight regex-based static analysis (not the full TypeScript compiler) to extract exported names:

```typescript
// Detected patterns:
export async function GET(ctx) { ... }     // → function declaration
export const POST = async (ctx) => { ... } // → const declaration
export { GET, POST }                       // → named re-export
```

This determines:
- Which HTTP methods a route handles (for the manifest)
- Which functions are RPC-callable (for type generation)

### 4. Code Generation

The compiler generates intermediate TypeScript files in `.fastworker/`:

**Monolith:** One manifest + one entry point
```
.fastworker/
├── _manifest.ts     ← imports all modules, exports routes + moduleMap
└── _entry.ts        ← re-exports manifest, sets mode = 'monolith'
```

**Microservices:** Manifest + gateway + per-service entries
```
.fastworker/
├── _manifest.ts              ← full manifest for gateway
├── _gateway.ts               ← gateway entry with RPC transport code
├── _manifest_account_service.ts  ← subset manifest
├── _service_account_service.ts   ← service entry
├── _manifest_billing_service.ts
└── _service_billing_service.ts
```

### 5. esbuild Bundling

Each generated entry is bundled with esbuild:

| Config | Cloudflare | Node.js |
|---|---|---|
| `platform` | `'browser'` | `'node'` |
| `format` | `'esm'` | `'esm'` |
| `external` | none | `'node:*'` |
| `target` | `'es2022'` | `'es2022'` |

---

## Runtime Architecture

### Router (`router.ts`)

The router is a pure function that takes a `RouterConfig` and returns a `FetchHandler`:

```
Request
  │
  ├─ pathname === '/__rpc' && POST? ──→ handleRPCRequest()
  │
  ├─ for each route in manifest:
  │    pattern.exec(pathname) ──match──→ extract params
  │                                       check HTTP method
  │                                       build ctx
  │                                       invoke handler
  │                                       return Response
  │
  └─ no match ──→ 404 Not Found
```

**Key design decisions:**
- Routes are pre-sorted at build time — runtime just iterates
- `ctx` is `Object.freeze()`'d — immutable
- RPC endpoint (`/__rpc`) is handled before route matching (short-circuit)

### RPC Client (`rpc.ts`)

Two-tier ES `Proxy` chain enabling `ctx.call.module.function()`:

```
ctx.call ─────────────── Level-1 Proxy ──┐
                                          │ get('users')
ctx.call.users ────────── Level-2 Proxy ──┤
                                          │ get('getProfile')
ctx.call.users.getProfile ── Function ────┤
                                          │ call([{ id: 1 }])
        ┌─────────────────────────────────┘
        │
        ├─ Local mode:  modules.get('users').getProfile({ id: 1 })
        │
        └─ Remote mode: transport.invoke('users', 'getProfile', [{ id: 1 }])
```

**Safety:** Accessing a missing module returns a proxy that only throws when you call a function — not on property access. This makes `ctx.call.unknown` safe but `ctx.call.unknown.fn()` throws with available modules.

### RPC Transport (`adapters/`)

```
                  ┌─────────────────────────────┐
                  │       RPCTransport           │
                  │  invoke(module, fn, args)     │
                  └──────────┬──────────────────┘
                             │
              ┌──────────────┼──────────────────┐
              │              │                   │
      Local (monolith)  Cloudflare          Node.js
      modules.get(m)    binding.fetch()     fetch(url)
      .fn(...args)      ↓ fallback ↓
                        fetch(url)
```

---

## Infrastructure Automation

### ModuleToBindingMap

The `workers` config is **inverted** at build time:

```
Config (input):
  workers: { account_service: ['users', 'auth'] }

ModuleToBindingMap (output):
  { users: 'ACCOUNT_SERVICE', auth: 'ACCOUNT_SERVICE' }
```

This map is embedded in the gateway's bundle. At runtime:
1. `ctx.call.users.getProfile()` → RPC Proxy extracts module name `'users'`
2. Transport looks up `ModuleToBindingMap['users']` → `'ACCOUNT_SERVICE'`
3. Cloudflare: `env.ACCOUNT_SERVICE.fetch('/__rpc', ...)`
4. Node.js: `serviceMap['account_service']` → `fetch('http://localhost:3001/__rpc', ...)`

### Wrangler.toml Generation

For the gateway, `[[services]]` blocks are auto-injected:

```
workers config                   Generated wrangler.toml
─────────────                   ─────────────────────────
account_service: [...]    →     [[services]]
                                binding = "ACCOUNT_SERVICE"
                                service = "account_service"

billing_service: [...]    →     [[services]]
                                binding = "BILLING_SERVICE"
                                service = "billing_service"
```

### Environment Variable Distribution

```
Root .dev.vars                    Compiler
─────────────                     ────────
DB_URL=...            →          cp .dev.vars dist/gateway/
API_KEY=...                      cp .dev.vars dist/account_service/
JWT_SECRET=...                   cp .dev.vars dist/billing_service/
```

All workers get the same env vars. `ctx.env.DB_URL` works identically everywhere.

---

## File Map

```
packages/fastworker/src/
├── types.ts              Core type definitions (RPCClient, Context, Config, etc.)
├── config.ts             Config file discovery, esbuild compilation, validation
├── compiler.ts           Module scanning, manifest generation, esbuild bundling
├── router.ts             Runtime request matching, ctx construction, /__rpc handler
├── rpc.ts                Proxy-based RPC client (local + remote strategies)
├── index.ts              Public API barrel file
└── adapters/
    ├── cloudflare.ts     Service Binding transport with auto-fallback
    └── node.ts           HTTP fetch transport + resolvePort()
```
