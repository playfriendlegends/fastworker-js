/**
 * @module fastworker
 *
 * Public API surface for the fastworker framework.
 *
 * ─── Runtime exports (used in user's api.ts files) ───
 *   FastworkerContext, RouteHandler — for typing handler functions
 *   RPCClient, RPCProxy — for typing ctx.call
 *
 * ─── Router & RPC (used by generated entry points) ───
 *   createRouter — creates the platform-agnostic fetch handler
 *   createLocalRPCClient, createRemoteRPCClient — RPC client factories
 *
 * ─── Adapters (used by generated gateway code) ───
 *   Accessed via 'fastworker/adapters/cloudflare' and 'fastworker/adapters/node'
 *
 * ─── Build-time exports (used by the compiler/CLI) ───
 *   Accessed via 'fastworker/compiler' and 'fastworker/config' subpaths
 *
 * @example
 * ```ts
 * // In a user's api.ts:
 * import type { FastworkerContext } from 'fastworker';
 *
 * export async function GET(ctx: FastworkerContext) {
 *   return new Response('Hello from fastworker!');
 * }
 * ```
 */

// ─── Re-export all types ───────────────────────────────────────────────────────

export type {
  // Context & handlers
  FastworkerContext,
  RouteHandler,
  FetchHandler,

  // RPC type system
  RPCClient,
  RPCProxy,
  RPCTransport,

  // Route manifest
  RouteManifestEntry,
  LoadedModule,

  // Configuration
  FastworkerConfig,
  Adapter,
  WorkersMap,
  ServiceMap,
  ModuleToBindingMap,
  NodeServerOptions,

  // HTTP
  HttpMethod,
} from './types.js';

// ─── Re-export runtime values ──────────────────────────────────────────────────

export { HTTP_METHODS } from './types.js';

// ─── Re-export config utilities ────────────────────────────────────────────────

export { defineConfig } from './config.js';

// ─── Re-export router ─────────────────────────────────────────────────────────

export { createRouter } from './router.js';
export type { RuntimeRouteEntry, RouterConfig } from './router.js';

// ─── Re-export RPC client factories ────────────────────────────────────────────

export { createLocalRPCClient, createRemoteRPCClient } from './rpc.js';
