/**
 * @module fastworker/router
 *
 * Runtime request router and context injection engine.
 *
 * This is the execution core — it processes incoming HTTP requests,
 * matches them against the compiled route manifest, builds the `ctx`
 * object (with the RPC client), and invokes the appropriate handler.
 *
 * Platform-agnostic: returns a standard `FetchHandler` that works on
 * Cloudflare Workers, Node.js, Deno, Bun, or any WinterCG-compatible runtime.
 *
 * ─── Request Flow ───
 *
 *   Request → Match Route → Extract Params → Build ctx → Invoke Handler → Response
 *                                                 ↑
 *                                          RPC client injected
 *                                          (local or remote)
 *
 * ─── RPC Endpoint ───
 *
 * In microservices mode, each service worker exposes a `POST /__rpc` endpoint
 * for receiving cross-module RPC calls. The router handles this automatically.
 */

import type {
  FastworkerContext,
  FetchHandler,
  HttpMethod,
  RPCTransport,
  RouteHandler,
} from './types.js';
import { HTTP_METHODS } from './types.js';
import { createLocalRPCClient, createRemoteRPCClient } from './rpc.js';

// ─── Runtime Route Entry ───────────────────────────────────────────────────────

/**
 * A route entry with actual module references (not paths).
 * This is the runtime counterpart of RouteManifestEntry — the compiler generates
 * code that creates these from static `import * as` statements.
 */
export interface RuntimeRouteEntry {
  /** Compiled RegExp with named capture groups */
  pattern: RegExp;

  /** Parameter names from dynamic segments */
  paramNames: string[];

  /** The actual module object (from `import * as mod from './api'`) */
  module: Record<string, unknown>;

  /** HTTP methods this route handles */
  methods: string[];

  /** Human-readable route path for logging (e.g., '/users/:id') */
  routePath: string;
}

// ─── Router Configuration ──────────────────────────────────────────────────────

/**
 * Configuration for creating a router instance.
 */
export interface RouterConfig {
  /**
   * Compiled route entries with live module references.
   * Ordered by matching priority (static before dynamic).
   */
  routes: RuntimeRouteEntry[];

  /**
   * Map of module names to their exports.
   * Used for:
   * - Local RPC calls (monolith mode)
   * - Handling incoming /__rpc requests (service workers)
   */
  modules: Map<string, Record<string, unknown>>;

  /**
   * RPC transport for remote calls (microservices mode).
   *
   * Can be:
   * - `undefined` → monolith mode, all calls are local
   * - `RPCTransport` → pre-created transport instance
   * - `(env) => RPCTransport` → factory for env-dependent transports (e.g., CF Service Bindings)
   */
  transport?:
    | RPCTransport
    | ((env: Record<string, unknown>) => RPCTransport);
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Create a platform-agnostic fetch handler from a router configuration.
 *
 * The returned handler:
 * 1. Matches the request URL against compiled route patterns
 * 2. Extracts dynamic parameters from named capture groups
 * 3. Verifies the HTTP method is exported by the matched module
 * 4. Constructs the `ctx` object with the appropriate RPC client
 * 5. Invokes the handler and returns its Response
 *
 * Special endpoints:
 * - `POST /__rpc` → Handles incoming cross-module RPC calls
 *
 * @param config - Router configuration with routes, modules, and optional transport
 * @returns A standard FetchHandler compatible with all major runtimes
 *
 * @example
 * ```ts
 * import { createRouter } from 'fastworker/router';
 * import { routes, moduleMap } from './_generated_manifest';
 *
 * export default {
 *   fetch: createRouter({ routes, modules: moduleMap }),
 * };
 * ```
 */
export function createRouter(config: RouterConfig): FetchHandler {
  const { routes, modules, transport } = config;

  return async function handleRequest(
    request: Request,
    env: Record<string, unknown> = {},
  ): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method.toUpperCase();

    // ── Handle RPC endpoint (microservices mode) ──
    if (pathname === '/__rpc' && method === 'POST') {
      return handleRPCRequest(request, modules, env);
    }

    // ── Match against route manifest ──
    for (const route of routes) {
      const match = route.pattern.exec(pathname);
      if (!match) continue;

      // Extract named capture groups as params
      const params: Record<string, string> = {};
      for (const name of route.paramNames) {
        const value = match.groups?.[name];
        if (value !== undefined) {
          params[name] = decodeURIComponent(value);
        }
      }

      // Verify HTTP method is handled by this module
      const handler = route.module[method];
      if (!handler || typeof handler !== 'function') {
        return createMethodNotAllowedResponse(route.methods, pathname);
      }

      // Build the ctx object with the appropriate RPC client
      const ctx = createContext(request, params, env, modules, transport);

      // Invoke the handler and return its response
      try {
        const response = await (handler as RouteHandler)(ctx);
        return response;
      } catch (error) {
        return createErrorResponse(error, route.routePath, method, env);
      }
    }

    // ── No route matched ──
    return createNotFoundResponse(pathname);
  };
}

// ─── Context Builder ───────────────────────────────────────────────────────────

/**
 * Construct the `ctx` object injected into every route handler.
 *
 * The RPC client is created based on the available transport:
 * - No transport → monolith mode → local function calls (zero-latency)
 * - RPCTransport → pre-created remote transport
 * - Factory function → deferred transport creation (needs env for CF bindings)
 */
function createContext(
  request: Request,
  params: Record<string, string>,
  env: Record<string, unknown>,
  modules: Map<string, Record<string, unknown>>,
  transport?:
    | RPCTransport
    | ((env: Record<string, unknown>) => RPCTransport),
): FastworkerContext {
  // Determine the RPC client based on available transport
  let rpcClient: unknown;

  if (!transport) {
    // Monolith mode: direct local function calls
    rpcClient = createLocalRPCClient(modules);
  } else if (typeof transport === 'function') {
    // Factory mode: create transport with current env (e.g., CF Service Bindings)
    rpcClient = createRemoteRPCClient(transport(env));
  } else {
    // Pre-created transport instance
    rpcClient = createRemoteRPCClient(transport);
  }

  return Object.freeze({
    req: request,
    params: Object.freeze(params),
    env,
    call: rpcClient as FastworkerContext['call'],
  });
}

// ─── RPC Request Handler ──────────────────────────────────────────────────────

/**
 * Handle incoming cross-module RPC requests on the `POST /__rpc` endpoint.
 *
 * Request body format:
 * ```json
 * {
 *   "module": "users",
 *   "function": "getProfile",
 *   "args": [{ "id": 123 }]
 * }
 * ```
 *
 * This endpoint is used by:
 * - Cloudflare Service Bindings (binding.fetch('http://internal/__rpc', ...))
 * - Node.js HTTP fetch (fetch('http://localhost:3001/__rpc', ...))
 * - Auto-fallback when Service Bindings are unavailable
 */
async function handleRPCRequest(
  request: Request,
  modules: Map<string, Record<string, unknown>>,
  env?: Record<string, unknown>,
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch (jsonError) {
    return new Response(
      JSON.stringify({
        error: 'Invalid JSON',
        message: 'Failed to parse JSON body: ' + (jsonError instanceof Error ? jsonError.message : String(jsonError)),
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return new Response(
      JSON.stringify({
        error: 'Invalid RPC request',
        message: 'Request body must be a JSON object.',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  const { module: moduleName, function: functionName, args = [] } = body as {
    module?: string;
    function?: string;
    args?: unknown[];
  };

  try {
    // Validate request fields
    if (!moduleName || !functionName || typeof moduleName !== 'string' || typeof functionName !== 'string') {
      return new Response(
        JSON.stringify({
          error: 'Invalid RPC request',
          message: 'Request body must include string "module" and "function" fields.',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    // Resolve module
    const mod = modules.get(moduleName);
    if (!mod) {
      return new Response(
        JSON.stringify({
          error: 'Module not found',
          message: `Module "${moduleName}" is not available in this worker.`,
          availableModules: [...modules.keys()],
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    // Resolve function
    const fn = mod[functionName];
    if (!fn || typeof fn !== 'function') {
      return new Response(
        JSON.stringify({
          error: 'Function not found',
          message: `Function "${functionName}" not found in module "${moduleName}".`,
          availableFunctions: Object.keys(mod).filter(
            k => typeof mod[k] === 'function' && !HTTP_METHODS.has(k),
          ),
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    // Guard: prevent calling HTTP handlers via RPC
    if (HTTP_METHODS.has(functionName)) {
      return new Response(
        JSON.stringify({
          error: 'Invalid RPC target',
          message: `"${functionName}" is an HTTP handler, not an RPC function. ` +
            `Use a direct HTTP request instead.`,
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    // Invoke the function
    const result = await fn(...(Array.isArray(args) ? args : [args]));

    return new Response(JSON.stringify(result ?? null), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown RPC error';
    const stack =
      error instanceof Error ? error.stack : undefined;

    console.error('[fastworker] RPC handler error:', error);

    const isProduction =
      (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') ||
      (env && (env.NODE_ENV === 'production' || env.ENVIRONMENT === 'production'));

    return new Response(
      JSON.stringify({
        error: 'RPC execution failed',
        message,
        ...(!isProduction && stack ? { stack } : {}),
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}

// ─── Response Factories ────────────────────────────────────────────────────────

/**
 * Create a 404 Not Found response with helpful debugging info.
 */
function createNotFoundResponse(pathname: string): Response {
  return new Response(
    JSON.stringify({
      error: 'Not Found',
      message: `No route matches "${pathname}".`,
      hint: 'Ensure you have an api.ts file in the corresponding modules/ directory.',
    }),
    {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

/**
 * Create a 405 Method Not Allowed response with the Allow header.
 */
function createMethodNotAllowedResponse(
  allowedMethods: string[],
  pathname: string,
): Response {
  return new Response(
    JSON.stringify({
      error: 'Method Not Allowed',
      message: `Route "${pathname}" does not handle this HTTP method.`,
      allowedMethods,
    }),
    {
      status: 405,
      headers: {
        'Content-Type': 'application/json',
        Allow: allowedMethods.join(', '),
      },
    },
  );
}

/**
 * Create a 500 Internal Server Error response from a caught exception.
 */
function createErrorResponse(
  error: unknown,
  routePath: string,
  method: string,
  env?: Record<string, unknown>,
): Response {
  const message =
    error instanceof Error ? error.message : 'Internal Server Error';

  console.error(`[fastworker] Handler error in ${method} ${routePath}:`, error);

  const isProduction =
    (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') ||
    (env && (env.NODE_ENV === 'production' || env.ENVIRONMENT === 'production'));

  return new Response(
    JSON.stringify({
      error: 'Internal Server Error',
      message: isProduction ? 'An unexpected error occurred.' : message,
    }),
    {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}
