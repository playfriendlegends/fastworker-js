/**
 * @module fastworker/adapters/cloudflare
 *
 * Cloudflare Service Binding transport with automatic HTTP fallback.
 *
 * ─── Primary Path ───
 * Uses Cloudflare Service Bindings (`env.BINDING.fetch()`) for
 * zero-egress inter-worker communication within the same CF account.
 *
 * ─── Auto-Fallback (CRITICAL) ───
 * If a Service Binding is `undefined` or lacks a `.fetch` method at runtime:
 * 1. Logs a warning (once per binding, not per call)
 * 2. Falls back to standard HTTP `fetch()` using the services URL map
 * 3. NEVER throws — the framework degrades gracefully
 *
 * This handles:
 * - Running locally without `wrangler dev` (no bindings available)
 * - Deploying to a non-Cloudflare platform by accident
 * - Partial binding configuration (some bindings available, others not)
 *
 * The fallback check is per-call, so it handles bindings that become
 * available/unavailable during the worker's lifetime.
 */

import type {
  RPCTransport,
  ModuleToBindingMap,
  ServiceMap,
} from '../types.js';

/** Track which bindings have already shown a fallback warning (avoid log spam) */
const warnedBindings = new Set<string>();

/**
 * Create an RPC transport that uses Cloudflare Service Bindings
 * with automatic fallback to standard HTTP fetch.
 *
 * @param env                - The Cloudflare Worker env object (contains Service Bindings)
 * @param moduleToBindingMap - Maps module names to uppercased binding names
 * @param serviceMap         - Maps worker names to fallback HTTP URLs
 * @returns RPCTransport implementation
 *
 * @example
 * ```ts
 * // In the generated gateway entry:
 * const transport = createCloudflareTransport(env, {
 *   users: 'ACCOUNT_SERVICE',
 *   auth: 'ACCOUNT_SERVICE',
 *   billing: 'BILLING_SERVICE',
 * }, {
 *   account_service: 'http://localhost:3001',
 *   billing_service: 'http://localhost:3002',
 * });
 * ```
 */
export function createCloudflareTransport(
  env: Record<string, unknown>,
  moduleToBindingMap: ModuleToBindingMap,
  serviceMap: ServiceMap,
): RPCTransport {
  return {
    async invoke(
      moduleName: string,
      functionName: string,
      args: unknown[],
    ): Promise<unknown> {
      // Resolve which binding hosts this module
      const bindingName = moduleToBindingMap[moduleName];
      if (!bindingName) {
        throw new Error(
          `[fastworker] Unknown module "${moduleName}" — ` +
          `not found in module-to-binding map.\n` +
          `  Available modules: ${Object.keys(moduleToBindingMap).join(', ')}`,
        );
      }

      // ── Per-call runtime check: attempt Service Binding first ──
      const binding = env[bindingName] as
        | { fetch?: typeof globalThis.fetch }
        | undefined;

      if (binding && typeof binding.fetch === 'function') {
        // ✓ Primary path: Cloudflare Service Binding (zero-egress)
        return invokeViaBinding(binding.fetch.bind(binding), moduleName, functionName, args);
      }

      // ── Auto-fallback: Service Binding unavailable ──
      const workerName = bindingName.toLowerCase();
      const baseUrl = serviceMap[workerName];

      if (!baseUrl) {
        throw new Error(
          `[fastworker] Service Binding "${bindingName}" is unavailable and no fallback URL\n` +
          `  found in config.services for worker "${workerName}".\n` +
          `  Either:\n` +
          `  1. Configure the Service Binding in wrangler.toml\n` +
          `  2. Add a services entry: { ${workerName}: 'http://localhost:PORT' }`,
        );
      }

      // Log warning once per binding to avoid noise
      if (!warnedBindings.has(bindingName)) {
        warnedBindings.add(bindingName);
        console.warn(
          `[fastworker] Service Binding "${bindingName}" unavailable, ` +
          `falling back to HTTP fetch → ${baseUrl}`,
        );
      }

      return invokeViaHTTP(baseUrl, moduleName, functionName, args);
    },
  };
}

// ─── Invocation Strategies ─────────────────────────────────────────────────────

/**
 * Invoke an RPC function via a Cloudflare Service Binding.
 * The binding.fetch() call is intra-account and doesn't traverse the public internet.
 */
async function invokeViaBinding(
  fetchFn: typeof globalThis.fetch,
  moduleName: string,
  functionName: string,
  args: unknown[],
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchFn('http://internal/__rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: moduleName,
        function: functionName,
        args,
      }),
    });
  } catch (bindingError) {
    throw new Error(
      `[fastworker] RPC ${moduleName}.${functionName}() Service Binding invocation failed:\n` +
      `  Error: ${bindingError instanceof Error ? bindingError.message : String(bindingError)}\n` +
      `  Check your wrangler.toml service bindings configuration.`
    );
  }

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `[fastworker] RPC ${moduleName}.${functionName}() failed via Service Binding:\n` +
      `  Status: ${response.status}\n` +
      `  Body: ${errorBody}`,
    );
  }

  return response.json();
}

/**
 * Invoke an RPC function via standard HTTP fetch (fallback path).
 * Used when Service Bindings are unavailable.
 */
async function invokeViaHTTP(
  baseUrl: string,
  moduleName: string,
  functionName: string,
  args: unknown[],
): Promise<unknown> {
  let response: Response;
  try {
    response = await globalThis.fetch(`${baseUrl}/__rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: moduleName,
        function: functionName,
        args,
      }),
    });
  } catch (fetchError) {
    throw new Error(
      `[fastworker] RPC ${moduleName}.${functionName}() HTTP fallback request failed:\n` +
      `  URL: ${baseUrl}/__rpc\n` +
      `  Error: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}\n` +
      `  Ensure the target service is reachable at that URL.`
    );
  }

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `[fastworker] RPC ${moduleName}.${functionName}() failed via HTTP fallback:\n` +
      `  URL: ${baseUrl}/__rpc\n` +
      `  Status: ${response.status}\n` +
      `  Body: ${errorBody}`,
    );
  }

  return response.json();
}
