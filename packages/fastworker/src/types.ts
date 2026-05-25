/**
 * @module fastworker/types
 *
 * Core type definitions for the fastworker framework.
 * This file defines the entire type-safe RPC contract, platform adapter
 * abstraction, route manifest schema, and configuration types.
 *
 * ─── Architecture Notes ───
 *
 * The type system is designed around three key principles:
 *
 * 1. SEPARATION OF CONCERNS
 *    - HttpMethod / RouteHandler / RouteManifestEntry → HTTP routing layer
 *    - RPCClient / RPCProxy / RPCTransport           → inter-module RPC layer
 *    - FastworkerConfig / Adapter / WorkersMap        → build-time config layer
 *
 * 2. PLATFORM AGNOSTICISM
 *    - Uses standard Web API types (Request, Response) — no Cloudflare-specific types
 *    - The Adapter type drives code generation, not runtime behavior
 *    - NodeServerOptions decouples port binding from RPC target URLs
 *
 * 3. TYPE-SAFE RPC via Mapped Types
 *    - RPCProxy<T> filters out HTTP method exports and wraps remaining functions
 *    - RPCClient<T> maps module names to their RPCProxy — enabling ctx.call.users.fn()
 *    - The compiler generates concrete type instantiations at build time
 */

// ─── HTTP Routing Types ────────────────────────────────────────────────────────

/**
 * Supported HTTP methods for route handlers.
 * Only exports with these exact names in `api.ts` files are treated as HTTP handlers.
 * All other exports are considered RPC-callable functions.
 */
export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS';

/**
 * Runtime-accessible set of all HTTP method names.
 * Used by the compiler and router to distinguish HTTP handlers from RPC functions.
 */
export const HTTP_METHODS: ReadonlySet<string> = new Set<string>([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
]);

// ─── Context & Handler Types ───────────────────────────────────────────────────

/**
 * The `ctx` object injected into every route handler.
 * Platform-agnostic: uses standard Web API `Request`, not Cloudflare-specific types.
 *
 * @typeParam TModules - Map of module names to their exports, enabling type-safe `ctx.call`.
 *
 * @example
 * ```ts
 * export async function GET(ctx: FastworkerContext) {
 *   const userId = ctx.params.id;
 *   const user = await ctx.call.users.getProfile({ id: Number(userId) });
 *   return new Response(JSON.stringify(user));
 * }
 * ```
 */
export interface FastworkerContext<TModules = Record<string, unknown>> {
  /** The incoming HTTP request (standard Web API Request) */
  readonly req: Request;

  /** Extracted dynamic route parameters (e.g., `{ id: '123' }` for `/users/:id`) */
  readonly params: Readonly<Record<string, string>>;

  /**
   * Platform bindings and environment variables.
   * - Cloudflare: the `env` object from the Worker fetch handler
   * - Node.js: loaded from `.env` / `process.env`
   */
  readonly env: Record<string, unknown>;

  /** Type-safe RPC client for inter-module communication */
  readonly call: RPCClient<TModules>;
}

/**
 * An HTTP route handler function exported from an `api.ts` file.
 * Must return a standard Web API `Response` (or a Promise resolving to one).
 */
export type RouteHandler<TModules = Record<string, unknown>> = (
  ctx: FastworkerContext<TModules>,
) => Response | Promise<Response>;

// ─── Type-Safe RPC Client Types ────────────────────────────────────────────────

/**
 * Extracts RPC-callable functions from a module's exports.
 *
 * Filtering rules:
 * - HTTP method exports (GET, POST, etc.) are **excluded** — they're route handlers, not RPC targets
 * - Non-function exports are **excluded**
 * - Remaining function exports are wrapped to always return `Promise<R>`
 *
 * @typeParam TModule - The module's export type (e.g., `typeof import('./modules/users/api')`)
 *
 * @example
 * ```ts
 * // If modules/users/api.ts exports:
 * //   GET(ctx) → Response          ← excluded (HTTP method)
 * //   getProfile({ id }) → User    ← included, becomes getProfile({ id }) → Promise<User>
 * //   createUser({ name }) → User  ← included, becomes createUser({ name }) → Promise<User>
 * //   SCHEMA = z.object(...)       ← excluded (not a function)
 * ```
 */
export type RPCProxy<TModule> = {
  [K in keyof TModule as K extends HttpMethod
    ? never  // Filter out HTTP method handlers
    : TModule[K] extends (...args: any[]) => unknown
      ? K       // Keep only function exports
      : never   // Filter out non-function exports
  ]: TModule[K] extends (ctx: any, ...args: infer A) => infer R
    ? (...args: A) => R extends Promise<unknown> ? R : Promise<R>
    : TModule[K] extends (...args: infer A) => infer R
      ? (...args: A) => R extends Promise<unknown> ? R : Promise<R>
      : never;
};

/**
 * Top-level RPC client type. Maps module names to their RPC-callable functions.
 *
 * This is the type of `ctx.call` — the entry point for cross-module communication.
 *
 * @typeParam TModules - Map of `{ [moduleName]: typeof import('./modules/name/api') }`
 *
 * @example
 * ```ts
 * // ctx.call.users.getProfile({ id: 123 })
 * // ctx.call.billing.createInvoice({ userId: 123, amount: 99 })
 * ```
 */
export type RPCClient<TModules> = {
  [K in keyof TModules]: TModules[K] extends Record<string, unknown>
    ? RPCProxy<TModules[K]>
    : never;
};

// ─── RPC Transport Abstraction ─────────────────────────────────────────────────

/**
 * Transport layer interface for inter-module RPC communication.
 * Implemented by platform-specific adapters:
 * - `adapters/cloudflare.ts` → Service Bindings with HTTP fallback
 * - `adapters/node.ts` → Standard HTTP fetch
 *
 * In monolith mode, the local RPC client bypasses this entirely
 * and calls functions directly (zero-latency).
 */
export interface RPCTransport {
  /**
   * Invoke an exported function on a remote module.
   *
   * @param moduleName   - The target module name (e.g., 'users')
   * @param functionName - The exported function to call (e.g., 'getProfile')
   * @param args         - Arguments to pass to the function
   * @returns The function's return value, deserialized from the transport
   */
  invoke(
    moduleName: string,
    functionName: string,
    args: unknown[],
  ): Promise<unknown>;
}

// ─── Route Manifest Types ──────────────────────────────────────────────────────

/**
 * A single entry in the compiled route manifest.
 * Generated at build-time by the compiler from the `modules/` directory structure.
 *
 * The manifest is an ordered array — static routes come before dynamic routes
 * to ensure correct matching priority (e.g., `/users/me` matches before `/users/:id`).
 */
export interface RouteManifestEntry {
  /** Compiled RegExp with named capture groups for dynamic params */
  pattern: RegExp;

  /** Names of dynamic parameters extracted from bracket segments (e.g., `['id']` for `[id]`) */
  paramNames: string[];

  /**
   * Path to the `api.ts` module, relative to the project root.
   * Used by the code generator for import statements.
   */
  modulePath: string;

  /** HTTP methods exported by this module (determines which verbs are routed here) */
  methods: HttpMethod[];

  /** Human-readable route path for logging/debugging (e.g., `/users/:id`) */
  routePath: string;
}

// ─── Platform & Adapter Types ──────────────────────────────────────────────────

/**
 * Platform adapter type.
 * Drives code generation — the compiler emits different RPC transport code per adapter.
 *
 * - `'cloudflare'` — Uses Cloudflare Service Bindings (`env.BINDING.fetch()`)
 *   with automatic fallback to standard HTTP `fetch()` if binding is unavailable.
 * - `'node'` — Uses standard HTTP `fetch()` to internal network URLs.
 *   No Cloudflare-specific APIs. Works on any runtime with `globalThis.fetch`.
 */
export type Adapter = 'cloudflare' | 'node';

/**
 * Maps infrastructure worker names to arrays of source module folder names.
 * Used in `fastworker.config.ts` to group modules into deployment units.
 *
 * When omitted, the compiler defaults to 1 worker per module.
 *
 * @example
 * ```ts
 * // Groups 'users' and 'auth' modules into a single 'account_service' worker
 * const workers: WorkersMap = {
 *   account_service: ['users', 'auth'],
 *   billing_service: ['billing', 'invoices'],
 * };
 * ```
 */
export type WorkersMap = Record<string, string[]>;

/**
 * Maps worker names to their network URLs.
 * Acts as an "address book" for the RPC client (caller/gateway).
 *
 * **CRITICAL**: This is NOT a server configuration. These URLs tell the RPC client
 * where to `fetch()` — they do NOT configure which port a generated Node.js server
 * binds to. See `NodeServerOptions` for port binding.
 *
 * @example
 * ```ts
 * const services: ServiceMap = {
 *   account_service: isProd
 *     ? 'https://account.api.example.com'    // production domain
 *     : 'http://localhost:3001',              // local dev
 *   billing_service: isProd
 *     ? 'https://billing.api.example.com'
 *     : 'http://localhost:3002',
 * };
 * ```
 */
export type ServiceMap = Record<string, string>;

/**
 * Build-time generated map: source module name → uppercased Cloudflare binding name.
 * Produced by `generateModuleToBindingMap()` from the `workers` config.
 *
 * Used by the Cloudflare adapter at runtime to resolve which Service Binding
 * hosts a given module — e.g., `ctx.call.auth` → `env.ACCOUNT_SERVICE`.
 *
 * @example
 * ```ts
 * // Generated from workers: { account_service: ['users', 'auth'] }
 * const map: ModuleToBindingMap = {
 *   users: 'ACCOUNT_SERVICE',
 *   auth: 'ACCOUNT_SERVICE',
 *   billing: 'BILLING_SERVICE',
 * };
 * ```
 */
export type ModuleToBindingMap = Record<string, string>;

/**
 * Resolved server binding config for generated Node.js micro-workers.
 * Strictly decoupled from RPC target URLs (ServiceMap).
 *
 * Uses a 3-tier port fallback:
 * 1. `process.env.PORT` (production/VPS — bind 0.0.0.0)
 * 2. Parsed port from services URL if localhost (dev — bind 127.0.0.1)
 * 3. Default 3000 with warning (bind 127.0.0.1)
 */
export interface NodeServerOptions {
  /** Resolved port number */
  port: number;

  /**
   * Bind address:
   * - `'0.0.0.0'` when PORT env is explicitly set (production, accepts external traffic)
   * - `'127.0.0.1'` otherwise (local dev, localhost only)
   */
  hostname: string;
}

// ─── Configuration Types ───────────────────────────────────────────────────────

/**
 * Framework configuration loaded from `fastworker.config.ts` (or `.js` / `.mjs`).
 *
 * @example
 * ```ts
 * // fastworker.config.ts
 * import type { FastworkerConfig } from 'fastworker';
 *
 * export default {
 *   deployMode: 'microservices',
 *   adapter: 'cloudflare',
 *   workers: {
 *     account_service: ['users', 'auth'],
 *     billing_service: ['billing'],
 *   },
 *   services: {
 *     account_service: 'http://localhost:3001',
 *     billing_service: 'http://localhost:3002',
 *   },
 * } satisfies FastworkerConfig;
 * ```
 */
export interface FastworkerConfig {
  /** How modules are bundled for deployment */
  deployMode: 'monolith' | 'microservices';

  /** Target platform adapter (defaults to 'cloudflare' if omitted) */
  adapter: Adapter;

  /** Path to the modules directory, relative to config file. Defaults to `'./modules'` */
  modulesDir?: string;

  /**
   * Worker name → network URL mapping ("address book" for RPC routing).
   *
   * Required when `adapter: 'node'` + `deployMode: 'microservices'`.
   * Also used as HTTP fallback URLs for the Cloudflare adapter.
   *
   * **IMPORTANT**: This is an address book, NOT a server config.
   * These URLs tell the RPC client (caller/gateway) where to find each worker.
   * They do NOT configure which port the generated Node.js server binds to.
   */
  services?: ServiceMap;

  /**
   * Groups source modules into named infrastructure workers.
   * If omitted in microservices mode, defaults to 1 worker per module.
   *
   * @example `{ account_service: ['users', 'auth'] }`
   */
  workers?: WorkersMap;
}

// ─── Standard Fetch Handler ────────────────────────────────────────────────────

/**
 * Platform-agnostic fetch handler signature.
 * Compatible with:
 * - Cloudflare Workers `ExportedHandler.fetch`
 * - Node.js `http.createServer` (via adapter)
 * - Deno.serve / Bun.serve
 */
export type FetchHandler = (
  request: Request,
  env?: Record<string, unknown>,
  executionCtx?: unknown,
) => Response | Promise<Response>;

// ─── Loaded Module Representation ──────────────────────────────────────────────

/**
 * A resolved module with its HTTP handlers and full exports.
 * Used internally by the router and RPC system at runtime.
 */
export interface LoadedModule {
  /** Route path for this module (e.g., '/users/:id') */
  routePath: string;

  /** HTTP method handlers extracted from the module */
  handlers: Partial<Record<HttpMethod, RouteHandler>>;

  /** All module exports (including non-HTTP RPC functions) */
  exports: Record<string, unknown>;
}
