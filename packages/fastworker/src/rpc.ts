/**
 * @module fastworker/rpc
 *
 * RPC client factory — the bridge between `ctx.call` and actual function invocation.
 *
 * Provides two client strategies:
 *
 * 1. LOCAL (monolith mode)
 *    ctx.call.users.getProfile({ id: 123 })
 *    → Proxy intercepts → resolves module → calls function directly
 *    → Zero-latency, zero-serialization, zero-network
 *
 * 2. REMOTE (microservices mode)
 *    ctx.call.users.getProfile({ id: 123 })
 *    → Proxy intercepts → delegates to RPCTransport.invoke()
 *    → Transport handles serialization + network (CF Bindings or HTTP fetch)
 *
 * Both strategies use ES `Proxy` for a clean, chainable API:
 *   ctx.call       → level-1 Proxy (intercepts module name)
 *   ctx.call.users → level-2 Proxy (intercepts function name)
 *   ctx.call.users.getProfile(args) → actual invocation
 *
 * ─── Safety Guards ───
 * - HTTP method names (GET, POST, etc.) are blocked from RPC calls
 * - Unknown modules/functions throw descriptive errors
 * - All calls are wrapped in async (return Promise even if fn is sync)
 */

import type { RPCTransport } from './types.js';
import { HTTP_METHODS } from './types.js';

// ─── Local RPC Client (Monolith Mode) ──────────────────────────────────────────

/**
 * Create an RPC client that calls module functions directly (zero-latency).
 *
 * Used in monolith mode where all modules are bundled into a single worker.
 * The function is resolved from the moduleMap and called synchronously
 * (well, awaited — but no serialization or network involved).
 *
 * @param modules - Map of module names to their exports
 * @returns A Proxy-based RPC client for `ctx.call`
 *
 * @example
 * ```ts
 * const modules = new Map([
 *   ['users', { getProfile: async ({ id }) => ({ id, name: 'Alice' }) }],
 * ]);
 * const client = createLocalRPCClient(modules);
 * const user = await client.users.getProfile({ id: 1 });
 * // → { id: 1, name: 'Alice' } (direct call, no network)
 * ```
 */
export function createLocalRPCClient(
  modules: Map<string, Record<string, unknown>>,
  getCtx: () => any,
): unknown {
  // Level-1 Proxy: intercepts module name (e.g., ctx.call.users)
  return new Proxy(Object.create(null), {
    get(_target, moduleName: string) {
      // Ignore Symbol properties and internal JS methods
      if (typeof moduleName !== 'string') return undefined;

      const mod = modules.get(moduleName);
      if (!mod) {
        // Return a proxy that throws on any function call — deferred error
        // This allows `ctx.call.nonexistent` to not throw, but
        // `ctx.call.nonexistent.fn()` will throw with a clear message
        return createMissingModuleProxy(moduleName, modules);
      }

      // Level-2 Proxy: intercepts function name (e.g., ctx.call.users.getProfile)
      return createModuleProxy(moduleName, mod, getCtx);
    },
  });
}

// ─── Remote RPC Client (Microservices Mode) ─────────────────────────────────────

/**
 * Create an RPC client that delegates to an RPCTransport for remote invocation.
 *
 * Used in microservices mode where modules are deployed as separate workers.
 * The transport handles serialization and network communication
 * (CF Service Bindings, HTTP fetch, or auto-fallback).
 *
 * @param transport - The RPCTransport implementation (from an adapter)
 * @returns A Proxy-based RPC client for `ctx.call`
 *
 * @example
 * ```ts
 * const transport = createCloudflareTransport(env, bindingMap, serviceMap);
 * const client = createRemoteRPCClient(transport);
 * const user = await client.users.getProfile({ id: 1 });
 * // → serialized → env.ACCOUNT_SERVICE.fetch('/__rpc', ...) → deserialized
 * ```
 */
export function createRemoteRPCClient(transport: RPCTransport): unknown {
  // Level-1 Proxy: intercepts module name
  return new Proxy(Object.create(null), {
    get(_target, moduleName: string) {
      if (typeof moduleName !== 'string') return undefined;

      // Level-2 Proxy: intercepts function name
      return new Proxy(Object.create(null), {
        get(_target2, functionName: string) {
          if (typeof functionName !== 'string') return undefined;

          // Guard: prevent calling HTTP handlers via RPC
          if (HTTP_METHODS.has(functionName)) {
            return () => {
              throw new Error(
                `[fastworker] Cannot call HTTP handler "${functionName}" via ctx.call.\n` +
                `  "${functionName}" is an HTTP route handler (GET, POST, etc.), not an RPC function.\n` +
                `  Use ctx.call.${moduleName}.yourFunctionName() instead.`,
              );
            };
          }

          // Return an async function that delegates to the transport
          return async (...args: unknown[]) => {
            return transport.invoke(moduleName, functionName, args);
          };
        },
      });
    },
  });
}

// ─── Internal Helpers ──────────────────────────────────────────────────────────

/**
 * Create a level-2 Proxy for a resolved module.
 * Intercepts function calls and invokes them directly.
 */
function createModuleProxy(
  moduleName: string,
  mod: Record<string, unknown>,
  getCtx: () => any,
): unknown {
  return new Proxy(Object.create(null), {
    get(_target, functionName: string) {
      if (typeof functionName !== 'string') return undefined;

      // Guard: prevent calling HTTP handlers via RPC
      if (HTTP_METHODS.has(functionName)) {
        return () => {
          throw new Error(
            `[fastworker] Cannot call HTTP handler "${functionName}" via ctx.call.\n` +
            `  "${functionName}" is an HTTP route handler, not an RPC function.\n` +
            `  Use ctx.call.${moduleName}.yourFunctionName() instead.`,
          );
        };
      }

      const fn = mod[functionName];

      if (fn === undefined) {
        // Deferred error — only throws when called, not when accessed
        return (..._args: unknown[]) => {
          const availableFns = Object.keys(mod).filter(
            k => typeof mod[k] === 'function' && !HTTP_METHODS.has(k),
          );
          throw new Error(
            `[fastworker] Function "${functionName}" not found in module "${moduleName}".\n` +
            `  Available RPC functions: ${availableFns.length > 0 ? availableFns.join(', ') : '(none)'}`,
          );
        };
      }

      if (typeof fn !== 'function') {
        return (..._args: unknown[]) => {
          throw new Error(
            `[fastworker] "${moduleName}.${functionName}" is not a function (got ${typeof fn}).\n` +
            `  Only exported functions can be called via ctx.call.`,
          );
        };
      }

      // Wrap in async to ensure consistent Promise return type
      return async (...args: unknown[]) => {
        const ctx = getCtx();
        return fn(ctx, ...args);
      };
    },
  });
}

/**
 * Create a Proxy for a module that doesn't exist.
 * Any function call on it throws a descriptive error.
 */
function createMissingModuleProxy(
  moduleName: string,
  modules: Map<string, Record<string, unknown>>,
): unknown {
  return new Proxy(Object.create(null), {
    get(_target, functionName: string) {
      if (typeof functionName !== 'string') return undefined;

      return (..._args: unknown[]) => {
        const available = [...modules.keys()];
        throw new Error(
          `[fastworker] Module "${moduleName}" not found.\n` +
          `  Available modules: ${available.length > 0 ? available.join(', ') : '(none)'}\n` +
          `  Ensure "${moduleName}/api.ts" exists in your modules directory.`,
        );
      };
    },
  });
}
