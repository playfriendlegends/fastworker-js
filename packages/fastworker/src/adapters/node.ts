/**
 * @module fastworker/adapters/node
 *
 * Node.js HTTP fetch transport and port-resolution utilities.
 *
 * ─── RPC Transport ───
 * Uses standard `globalThis.fetch()` to call other workers via HTTP.
 * The `serviceMap` URLs are used strictly as fetch targets (the "address book").
 * This transport works on any runtime with `globalThis.fetch` (Node 18+, Deno, Bun).
 *
 * ─── Port Resolution (CRITICAL) ───
 * The `resolvePort()` function implements a strict 3-tier fallback
 * that DECOUPLES server port binding from RPC target URLs:
 *
 *   Priority 1: process.env.PORT          → production/VPS (bind 0.0.0.0)
 *   Priority 2: Parsed localhost port     → local development (bind 127.0.0.1)
 *   Priority 3: Default 3000 + warning   → safe fallback (bind 127.0.0.1)
 *
 * This prevents EADDRINUSE errors and invalid domain binding when developers
 * use production URLs (e.g., https://api.domain.com) in their config.
 */

import type {
  RPCTransport,
  ServiceMap,
  NodeServerOptions,
} from '../types.js';

// ─── Node.js HTTP Transport ────────────────────────────────────────────────────

/**
 * Create an RPC transport that uses standard HTTP `fetch()` calls.
 *
 * The `serviceMap` provides the base URL for each worker — acting as an
 * "address book" for the RPC client. These URLs are used as-is for fetch().
 *
 * The `moduleToWorkerMap` resolves which worker hosts a given module.
 * This handles the many-to-one relationship (multiple modules per worker).
 *
 * @param serviceMap       - Worker name → network URL (e.g., `{ billing_service: 'http://localhost:3002' }`)
 * @param moduleToWorkerMap - Module name → worker name (e.g., `{ users: 'account_service' }`)
 * @returns RPCTransport implementation
 *
 * @example
 * ```ts
 * const transport = createNodeTransport(
 *   { account_service: 'http://localhost:3001' },
 *   { users: 'account_service', auth: 'account_service' },
 * );
 * // transport.invoke('users', 'getProfile', [{ id: 1 }])
 * // → fetch('http://localhost:3001/__rpc', { body: { module: 'users', ... } })
 * ```
 */
export function createNodeTransport(
  serviceMap: ServiceMap,
  moduleToWorkerMap: Record<string, string>,
): RPCTransport {
  return {
    async invoke(
      moduleName: string,
      functionName: string,
      args: unknown[],
    ): Promise<unknown> {
      // Resolve which worker hosts this module
      const workerName = moduleToWorkerMap[moduleName];
      if (!workerName) {
        throw new Error(
          `[fastworker] Unknown module "${moduleName}" — ` +
          `not found in module-to-worker map.\n` +
          `  Available modules: ${Object.keys(moduleToWorkerMap).join(', ')}`,
        );
      }

      // Look up the worker's network URL from the address book
      const baseUrl = serviceMap[workerName];
      if (!baseUrl) {
        throw new Error(
          `[fastworker] No service URL found for worker "${workerName}" ` +
          `(module: "${moduleName}").\n` +
          `  Add it to config.services: { ${workerName}: 'http://localhost:PORT' }`,
        );
      }

      // Make the RPC call via HTTP POST
      const response = await globalThis.fetch(`${baseUrl}/__rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module: moduleName,
          function: functionName,
          args,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `[fastworker] RPC ${moduleName}.${functionName}() failed:\n` +
          `  URL: ${baseUrl}/__rpc\n` +
          `  Status: ${response.status}\n` +
          `  Body: ${errorBody}`,
        );
      }

      return response.json();
    },
  };
}

// ─── Port Resolution (3-Tier Fallback) ─────────────────────────────────────────

/**
 * Resolve the port and hostname for a Node.js micro-worker server.
 *
 * CRITICAL: This is strictly decoupled from the RPC target URLs.
 * The `serviceMap` URLs tell the RPC client WHERE to send requests.
 * This function determines WHERE the server LISTENS — a separate concern.
 *
 * Fallback hierarchy:
 *
 * ```
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ Priority 1 (Production/VPS): process.env.PORT                  │
 * │   → PORT=8080 node dist/billing_service.js                     │
 * │   → Binds to 0.0.0.0:8080 (accepts external traffic)          │
 * ├─────────────────────────────────────────────────────────────────┤
 * │ Priority 2 (Local Dev): Parsed from services URL               │
 * │   → services.billing_service = 'http://localhost:3002'         │
 * │   → Extracts 3002, binds to 127.0.0.1:3002                    │
 * ├─────────────────────────────────────────────────────────────────┤
 * │ Priority 3 (Safe Fallback): Default 3000 + warning             │
 * │   → services URL is 'https://billing.api.domain.com' (no port) │
 * │   → Binds to 127.0.0.1:3000 with console warning              │
 * └─────────────────────────────────────────────────────────────────┘
 * ```
 *
 * @param workerName - Name of the worker (for logging)
 * @param serviceMap - Worker name → URL map (only used for port extraction, NOT for binding)
 * @returns Resolved { port, hostname } for `server.listen(port, hostname)`
 */
export function resolvePort(
  workerName: string,
  serviceMap: ServiceMap,
): NodeServerOptions {
  // ── Priority 1: process.env.PORT (production/VPS/Docker) ──
  const envPort = process.env.PORT;
  if (envPort) {
    const port = parseInt(envPort, 10);
    if (!isNaN(port) && port > 0 && port < 65536) {
      return { port, hostname: '0.0.0.0' };
    }
    // Invalid PORT env — fall through with warning
    console.warn(
      `[fastworker] Invalid process.env.PORT="${envPort}" — ` +
      `must be a number between 1 and 65535. Falling through to next priority.`,
    );
  }

  // ── Priority 2: Parse port from services URL (local development) ──
  const serviceUrl = serviceMap[workerName];
  if (serviceUrl) {
    try {
      const parsed = new URL(serviceUrl);
      const isLocalhost =
        parsed.hostname === 'localhost' ||
        parsed.hostname === '127.0.0.1' ||
        parsed.hostname === '0.0.0.0' ||
        parsed.hostname === '::1';

      if (isLocalhost && parsed.port) {
        const port = parseInt(parsed.port, 10);
        if (!isNaN(port) && port > 0 && port < 65536) {
          return { port, hostname: '127.0.0.1' };
        }
      }
    } catch {
      // URL parsing failed — fall through to default
    }
  }

  // ── Priority 3: Safe fallback with warning ──
  console.warn(
    `[fastworker] Running ${workerName} on default port 3000.\n` +
    `  In production environments, you MUST provide process.env.PORT.\n` +
    `  Example: PORT=8080 node dist/${workerName}/index.js`,
  );

  return { port: 3000, hostname: '127.0.0.1' };
}
