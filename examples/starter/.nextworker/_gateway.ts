// Auto-generated gateway entry (Cloudflare) — do not edit
import { routes, moduleMap } from './_manifest';
import { createRouter } from 'fastworker/runtime';

// ─── Cloudflare Service Binding Transport (auto-generated) ─────────────
const __moduleToBinding = {
  "users": "ACCOUNT_SERVICE",
  "auth": "ACCOUNT_SERVICE",
  "billing": "BILLING_SERVICE"
};
const __serviceMap = {
  "account_service": "http://localhost:3001",
  "billing_service": "http://localhost:3002"
};

/**
 * Create an RPC transport using Cloudflare Service Bindings.
 * Falls back to standard HTTP fetch if bindings are unavailable.
 */
function createTransport(env) {
  return {
    async invoke(moduleName, functionName, args) {
      const bindingName = __moduleToBinding[moduleName];
      if (!bindingName) {
        throw new Error(`[fastworker] Unknown module "${moduleName}" — not found in module-to-binding map.`);
      }

      // ── Per-call runtime check: try Service Binding first ──
      const binding = env[bindingName];
      if (binding && typeof binding.fetch === 'function') {
        // Primary path: Cloudflare Service Binding
        const response = await binding.fetch('http://internal/__rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ module: moduleName, function: functionName, args }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`[fastworker] RPC call ${moduleName}.${functionName}() failed: ${errorText}`);
        }

        return response.json();
      }

      // ── Auto-fallback: Service Binding unavailable ──
      // Find the worker name for this module (reverse lookup from moduleToBinding)
      const workerName = Object.entries({"users":["users","auth"],"auth":["users","auth"],"billing":["billing"]}).find(([, mods]) => mods.includes(moduleName))?.[0] || moduleName;

      // Look up the worker's fallback URL from the service map
      const baseUrl = __serviceMap[workerName];
      if (!baseUrl) {
        throw new Error(
          `[fastworker] Service Binding "${bindingName}" is unavailable and no fallback URL \n` +
          `  found in config.services for worker "${workerName}".\n` +
          `  Either configure the Service Binding or add a services entry.`
        );
      }

      console.warn(
        `[fastworker] Service Binding "${bindingName}" unavailable, falling back to HTTP fetch → ${baseUrl}`
      );

      const response = await fetch(`${baseUrl}/__rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ module: moduleName, function: functionName, args }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`[fastworker] RPC call ${moduleName}.${functionName}() failed (fallback): ${errorText}`);
      }

      return response.json();
    },
  };
}

const handler = createRouter({ routes, modules: moduleMap, transport: (env) => createTransport(env) });

export default { fetch: handler };