/**
 * @module fastworker/runtime
 *
 * Lean runtime-only entry point.
 *
 * This module exports ONLY the runtime code needed by generated entry points:
 * - createRouter (request matching + ctx injection)
 * - createLocalRPCClient / createRemoteRPCClient (RPC client factories)
 *
 * It does NOT import the compiler, config loader, or esbuild.
 * This is critical for Cloudflare Workers where node:* builtins are unavailable
 * and bundling the full package would pull in esbuild/fs/path.
 */

export { createRouter } from './router.js';
export type { RuntimeRouteEntry, RouterConfig } from './router.js';

export { createLocalRPCClient, createRemoteRPCClient } from './rpc.js';

export type {
  FastworkerContext,
  FetchHandler,
  RPCTransport,
  RPCClient,
  RPCProxy,
  RouteHandler,
  HttpMethod,
} from './types.js';

export { HTTP_METHODS } from './types.js';
