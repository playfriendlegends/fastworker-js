---
id: introduction
title: Introduction
sidebar_position: 1
---

Comprehensive documentation for the fastworker framework — a platform-agnostic stateless modular monolith.

## Philosophy

> **Opinionated Code. Agnostic Infrastructure.**

Fastworker is **opinionated** in how you write code — strict file-system routing, typed RPC, and enforced module boundaries keep your team disciplined and your codebase clean.

But Fastworker is **100% agnostic** when it comes to infrastructure. Your company is free to migrate from Monolith to Microservices, and free to switch from Cloudflare Workers to any VPS — without rewriting a single line of application code.
## Guides

| Document | Description |
|---|---|
| [Getting Started](./getting-started.md) | Install, scaffold, and run your first fastworker project |
| [Configuration](./configuration.md) | Full `fastworker.config.ts` reference |
| [Routing](./routing.md) | File-system routing rules, dynamic parameters, colocation |
| [RPC](./rpc.md) | Cross-module communication via `ctx.call` |
| [Deployment](./deployment.md) | Monolith vs microservices, Cloudflare vs Node.js |
| [Architecture](./architecture.md) | Internal compiler and runtime architecture |

## Quick Reference

```
modules/
├── users/
│   ├── api.ts          → GET/POST /users         (route handler)
│   ├── schema.ts       → NOT a route              (colocated)
│   └── [id]/
│       └── api.ts      → GET/PUT/DELETE /users/:id (dynamic route)
├── auth/
│   └── api.ts          → POST /auth
└── billing/
    └── api.ts          → GET/POST /billing
```

### Handler Convention

```typescript
// Export HTTP methods by name — they become route handlers
export async function GET(ctx: FastworkerContext) { ... }
export async function POST(ctx: FastworkerContext) { ... }

// Export any other function — it becomes RPC-callable
export async function getProfile(input: { id: number }) { ... }
// → ctx.call.users.getProfile({ id: 123 })
```

### Config Quick Start

```typescript
// fastworker.config.ts
import type { FastworkerConfig } from 'fastworker-js';

export default {
  deployMode: 'monolith',    // or 'microservices'
  adapter: 'cloudflare',     // or 'node'
} satisfies FastworkerConfig;
```
