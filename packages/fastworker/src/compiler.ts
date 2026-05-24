/**
 * @module fastworker/compiler
 *
 * Build-time compiler for the fastworker framework.
 *
 * This module is the architectural core — it reads a `modules/` directory,
 * generates a RegExp-based route manifest, and produces deployment-ready
 * bundles via esbuild. The output varies by deploy mode and adapter:
 *
 * ─── Monolith Mode ───
 * All modules bundled into a single worker/server entry.
 * ctx.call becomes zero-latency local function calls.
 *
 * ─── Microservices Mode ───
 * Modules split into per-worker bundles + a gateway worker.
 * The gateway contains the router and adapter-aware RPC transport.
 * - Cloudflare: Service Bindings with auto-fallback
 * - Node.js: Standard HTTP fetch with port-binding decoupling
 *
 * ─── Key Functions ───
 * scanModules()               → Walk modules/ dir, produce RouteManifestEntry[]
 * generateRouteManifest()     → Emit manifest as importable TypeScript code
 * generateModuleToBindingMap() → Invert workers config for CF binding resolution
 * generateWranglerToml()      → Auto-generate Cloudflare wrangler.toml
 * generateNodeServerEntry()   → Node server with 3-tier port fallback
 * generateRPCTransport()      → Adapter-specific RPC client code
 * distributeEnvVars()         → Copy .dev.vars/.env to all micro-worker outputs
 * buildMonolith()             → Full monolith build pipeline
 * buildMicroservices()        → Full microservices build pipeline
 * build()                     → Top-level entry point
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as esbuild from 'esbuild';
import type {
  RouteManifestEntry,
  HttpMethod,
  FastworkerConfig,
  Adapter,
  WorkersMap,
  ModuleToBindingMap,
  ServiceMap,
} from './types.js';
import { HTTP_METHODS } from './types.js';

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Only files with these exact basenames become routes */
const API_FILE_NAMES: ReadonlySet<string> = new Set(['api.ts', 'api.js']);

/** Output directory name */
const OUTPUT_DIR = 'dist';

/** Generated code directory (intermediate, compiled away by esbuild) */
const GENERATED_DIR = '.fastworker';

// ─── 1. Module Scanner ─────────────────────────────────────────────────────────

/**
 * Recursively scan the `modules/` directory for `api.ts` / `api.js` files
 * and produce a sorted route manifest.
 *
 * Scanning rules:
 * - ONLY files named exactly `api.ts` or `api.js` become routes
 * - All other files are completely ignored (colocation-friendly)
 * - Directory names with `[brackets]` become dynamic route parameters
 * - Static routes are sorted before dynamic routes for correct matching priority
 *
 * @param modulesDir - Absolute path to the modules directory
 * @returns Sorted array of RouteManifestEntry (static routes first)
 *
 * @example
 * ```
 * // Given:
 * //   modules/users/api.ts           → GET, POST
 * //   modules/users/[id]/api.ts      → GET, PUT, DELETE
 * //   modules/users/schema.ts        → IGNORED (not api.ts)
 * //   modules/billing/api.ts         → GET
 * //
 * // Returns:
 * //   [
 * //     { routePath: '/billing',    pattern: /^\/billing$/,               ... },
 * //     { routePath: '/users',      pattern: /^\/users$/,                 ... },
 * //     { routePath: '/users/:id',  pattern: /^\/users\/(?<id>[^\/]+)$/,  ... },
 * //   ]
 * ```
 */
export function scanModules(modulesDir: string): RouteManifestEntry[] {
  const resolvedDir = path.resolve(modulesDir);

  if (!fs.existsSync(resolvedDir)) {
    throw new Error(`[fastworker] Modules directory not found: ${resolvedDir}`);
  }

  const entries: RouteManifestEntry[] = [];
  walkDirectory(resolvedDir, resolvedDir, entries);

  // Sort: static routes first, then dynamic, then alphabetical within each group
  return entries.sort((a, b) => {
    const aDynamic = a.paramNames.length > 0;
    const bDynamic = b.paramNames.length > 0;

    // Static routes take priority over dynamic routes
    if (aDynamic !== bDynamic) return aDynamic ? 1 : -1;

    // Within the same category, sort by specificity (more segments first)
    const aSegments = a.routePath.split('/').length;
    const bSegments = b.routePath.split('/').length;
    if (aSegments !== bSegments) return bSegments - aSegments;

    // Finally, alphabetical for deterministic ordering
    return a.routePath.localeCompare(b.routePath);
  });
}

/**
 * Recursively walk a directory tree, collecting api.ts/api.js files.
 */
function walkDirectory(
  currentDir: string,
  rootModulesDir: string,
  entries: RouteManifestEntry[],
): void {
  const dirEntries = fs.readdirSync(currentDir, { withFileTypes: true });

  for (const entry of dirEntries) {
    const fullPath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      // Recurse into subdirectories (including [bracket] dirs)
      walkDirectory(fullPath, rootModulesDir, entries);
    } else if (entry.isFile() && API_FILE_NAMES.has(entry.name)) {
      // Found an api.ts/api.js — convert to route entry
      const relativeDirPath = path.relative(rootModulesDir, currentDir);
      const manifestEntry = createManifestEntry(relativeDirPath, fullPath, rootModulesDir);
      entries.push(manifestEntry);
    }
  }
}

/**
 * Convert a directory path and api file into a RouteManifestEntry.
 *
 * @param relativeDirPath - Path relative to modules/ dir (e.g., 'users/[id]')
 * @param apiFilePath     - Absolute path to the api.ts/api.js file
 * @param rootModulesDir  - Absolute path to the modules/ directory
 */
function createManifestEntry(
  relativeDirPath: string,
  apiFilePath: string,
  rootModulesDir: string,
): RouteManifestEntry {
  const { routePath, pattern, paramNames } = pathToRoutePattern(relativeDirPath);
  const methods = extractExportedHttpMethods(apiFilePath);
  const modulePath = path.relative(rootModulesDir, apiFilePath);

  return {
    pattern,
    paramNames,
    modulePath,
    methods,
    routePath,
  };
}

// ─── 2. Path → Route Pattern Conversion ────────────────────────────────────────

/**
 * Convert a directory path (e.g., 'users/[id]') to a route pattern.
 *
 * Bracket segments become named capture groups:
 *   'users/[id]/posts/[postId]'
 *   → routePath: '/users/:id/posts/:postId'
 *   → pattern:   /^\/users\/(?<id>[^\/]+)\/posts\/(?<postId>[^\/]+)$/
 *   → paramNames: ['id', 'postId']
 */
function pathToRoutePattern(relativeDirPath: string): {
  routePath: string;
  pattern: RegExp;
  paramNames: string[];
} {
  // Handle root module (e.g., modules/api.ts → '/')
  if (relativeDirPath === '' || relativeDirPath === '.') {
    return {
      routePath: '/',
      pattern: /^\/$/,
      paramNames: [],
    };
  }

  const segments = relativeDirPath.split(path.sep).filter(Boolean);
  const paramNames: string[] = [];

  // Build both the human-readable route path and the RegExp source
  const routeSegments: string[] = [];
  const regexSegments: string[] = [];

  for (const segment of segments) {
    const bracketMatch = segment.match(/^\[(.+)\]$/);

    if (bracketMatch) {
      // Dynamic segment: [id] → :id / (?<id>[^\/]+)
      const paramName = bracketMatch[1];
      paramNames.push(paramName);
      routeSegments.push(`:${paramName}`);
      regexSegments.push(`(?<${paramName}>[^\\/]+)`);
    } else {
      // Static segment: escape for RegExp safety
      routeSegments.push(segment);
      regexSegments.push(escapeRegex(segment));
    }
  }

  const routePath = '/' + routeSegments.join('/');
  const pattern = new RegExp(`^\\/${regexSegments.join('\\/')}$`);

  return { routePath, pattern, paramNames };
}

/**
 * Escape special RegExp characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── 3. Export Extraction (Lightweight AST) ────────────────────────────────────

/**
 * Extract exported HTTP method names from an api.ts/api.js file
 * using lightweight static analysis.
 *
 * This uses a regex-based approach instead of the full TypeScript compiler API
 * to avoid a heavy dependency for what is essentially pattern matching.
 *
 * Supported export patterns:
 * - `export async function GET(ctx) { ... }`
 * - `export function POST(ctx) { ... }`
 * - `export const PUT = async (ctx) => { ... }`
 * - `export { GET, POST }` (named re-exports)
 *
 * @param filePath - Absolute path to the api.ts/api.js file
 * @returns Array of HTTP methods exported by this file
 */
export function extractExportedHttpMethods(filePath: string): HttpMethod[] {
  const source = fs.readFileSync(filePath, 'utf-8');
  const methods = new Set<HttpMethod>();

  // Pattern 1: export [async] function NAME
  const funcPattern = /export\s+(?:async\s+)?function\s+(\w+)/g;
  let match: RegExpExecArray | null;

  while ((match = funcPattern.exec(source)) !== null) {
    if (HTTP_METHODS.has(match[1])) {
      methods.add(match[1] as HttpMethod);
    }
  }

  // Pattern 2: export const NAME = ...
  const constPattern = /export\s+const\s+(\w+)\s*=/g;
  while ((match = constPattern.exec(source)) !== null) {
    if (HTTP_METHODS.has(match[1])) {
      methods.add(match[1] as HttpMethod);
    }
  }

  // Pattern 3: export { NAME, NAME2, ... }
  const namedExportPattern = /export\s*\{([^}]+)\}/g;
  while ((match = namedExportPattern.exec(source)) !== null) {
    const names = match[1].split(',').map(n => n.trim().split(/\s+as\s+/).pop()!.trim());
    for (const name of names) {
      if (HTTP_METHODS.has(name)) {
        methods.add(name as HttpMethod);
      }
    }
  }

  return [...methods];
}

/**
 * Extract ALL exported function/const names from a module file.
 * Used by the RPC system to discover callable functions (non-HTTP exports).
 */
export function extractAllExportedNames(filePath: string): string[] {
  const source = fs.readFileSync(filePath, 'utf-8');
  const names = new Set<string>();

  // export [async] function NAME
  const funcPattern = /export\s+(?:async\s+)?function\s+(\w+)/g;
  let match: RegExpExecArray | null;
  while ((match = funcPattern.exec(source)) !== null) {
    names.add(match[1]);
  }

  // export const/let/var NAME
  const varPattern = /export\s+(?:const|let|var)\s+(\w+)/g;
  while ((match = varPattern.exec(source)) !== null) {
    names.add(match[1]);
  }

  // export { NAME, NAME2 }
  const namedPattern = /export\s*\{([^}]+)\}/g;
  while ((match = namedPattern.exec(source)) !== null) {
    const items = match[1].split(',').map(n => n.trim().split(/\s+as\s+/).pop()!.trim());
    for (const name of items) {
      if (name) names.add(name);
    }
  }

  return [...names];
}

// ─── 4. Route Manifest Code Generator ──────────────────────────────────────────

/**
 * Generate the route manifest as importable TypeScript/JavaScript code.
 *
 * The generated file:
 * - Imports each api module statically (enables tree-shaking)
 * - Exports a `routes` array with compiled RegExp patterns
 * - Exports a `moduleMap` for the RPC system
 *
 * @param entries    - The scanned route manifest entries
 * @param modulesDir - Absolute path to modules directory (for computing relative imports)
 * @param outDir     - Where the generated file will be written (for import path calculation)
 * @returns Generated TypeScript source code
 */
export function generateRouteManifest(
  entries: RouteManifestEntry[],
  modulesDir: string,
  outDir: string,
): string {
  const lines: string[] = [
    '// Auto-generated by fastworker compiler — do not edit',
    '// This file is regenerated on every build',
    '',
  ];

  // Generate import statements for each api module
  const moduleVarNames = new Map<string, string>();

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const varName = `_mod_${i}`;
    moduleVarNames.set(entry.modulePath, varName);

    // Compute relative import path from outDir to the module file
    const absoluteModulePath = path.join(modulesDir, entry.modulePath);
    let relativePath = path.relative(outDir, absoluteModulePath);

    // Ensure the path starts with ./ and uses forward slashes
    relativePath = relativePath.replace(/\\/g, '/');
    if (!relativePath.startsWith('.')) {
      relativePath = './' + relativePath;
    }

    // Remove .ts/.js extension for TypeScript imports
    relativePath = relativePath.replace(/\.(ts|js)$/, '');

    lines.push(`import * as ${varName} from '${relativePath}';`);
  }

  lines.push('');

  // Generate the routes array
  lines.push('export const routes = [');

  for (const entry of entries) {
    const varName = moduleVarNames.get(entry.modulePath)!;
    const methodsStr = entry.methods.map(m => `'${m}'`).join(', ');

    lines.push('  {');
    lines.push(`    pattern: ${entry.pattern.toString()},`);
    lines.push(`    paramNames: [${entry.paramNames.map(p => `'${p}'`).join(', ')}],`);
    lines.push(`    module: ${varName},`);
    lines.push(`    methods: [${methodsStr}],`);
    lines.push(`    routePath: '${entry.routePath}',`);
    lines.push('  },');
  }

  lines.push('];');
  lines.push('');

  // Generate module map (module folder name → module exports)
  // This maps each top-level module directory to its exports for the RPC system
  const moduleMapEntries = new Map<string, string>();

  for (const entry of entries) {
    // Extract the top-level module name from the path
    // e.g., 'users/[id]/api.ts' → 'users', 'billing/api.ts' → 'billing'
    const topLevelModule = entry.modulePath.split(path.sep)[0].split('/')[0];
    const varName = moduleVarNames.get(entry.modulePath)!;

    // Only map the top-level api.ts (not nested dynamic routes)
    // The RPC system routes by module name, not by sub-routes
    if (!entry.modulePath.includes('[') && !moduleMapEntries.has(topLevelModule)) {
      moduleMapEntries.set(topLevelModule, varName);
    }
  }

  lines.push('export const moduleMap = new Map([');
  for (const [moduleName, varName] of moduleMapEntries) {
    lines.push(`  ['${moduleName}', ${varName}],`);
  }
  lines.push(']);');
  lines.push('');

  return lines.join('\n');
}

// ─── 5. Infrastructure Mapping ─────────────────────────────────────────────────

/**
 * Invert the `workers` config map to produce a module → binding lookup.
 *
 * Input:  `{ account_service: ['users', 'auth'], billing_service: ['billing'] }`
 * Output: `{ users: 'ACCOUNT_SERVICE', auth: 'ACCOUNT_SERVICE', billing: 'BILLING_SERVICE' }`
 *
 * The binding name is always the UPPERCASED version of the worker name.
 * This matches Cloudflare's convention for Service Binding variable names.
 *
 * @param workers - The workers map from fastworker.config.ts
 * @returns ModuleToBindingMap for gateway runtime routing
 * @throws If a module appears in multiple worker groups (ambiguous routing)
 */
export function generateModuleToBindingMap(workers: WorkersMap): ModuleToBindingMap {
  const map: ModuleToBindingMap = {};

  for (const [workerName, modules] of Object.entries(workers)) {
    const bindingName = workerName.toUpperCase();

    for (const moduleName of modules) {
      if (map[moduleName]) {
        throw new Error(
          `[fastworker] Module "${moduleName}" is assigned to multiple workers: ` +
          `"${map[moduleName]}" and "${bindingName}". ` +
          `A module can only belong to one worker.`,
        );
      }
      map[moduleName] = bindingName;
    }
  }

  return map;
}

/**
 * Generate a default 1:1 workers map when none is provided.
 * Each module becomes its own worker with the same name.
 *
 * @param modulesDir - Absolute path to modules directory
 * @returns WorkersMap with one worker per top-level module directory
 */
export function generateDefaultWorkersMap(modulesDir: string): WorkersMap {
  const workers: WorkersMap = {};
  const entries = fs.readdirSync(modulesDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      workers[entry.name] = [entry.name];
    }
  }

  return workers;
}

// ─── 6. Wrangler.toml Generator ────────────────────────────────────────────────

/**
 * Generate a `wrangler.toml` configuration file for a Cloudflare Worker.
 *
 * For the **gateway** role, this auto-injects `[[services]]` blocks for every
 * worker in the config — the binding name is the UPPERCASED worker name.
 *
 * @param workerName - Name of this worker (e.g., 'gateway', 'account_service')
 * @param config     - The fastworker config
 * @param role       - 'gateway' (with [[services]] bindings) or 'service' (standalone)
 * @returns Generated wrangler.toml content as a string
 *
 * @example
 * ```toml
 * # Gateway wrangler.toml (auto-generated)
 * name = "gateway"
 * main = "./index.js"
 * compatibility_date = "2024-01-01"
 *
 * [[services]]
 * binding = "ACCOUNT_SERVICE"
 * service = "account_service"
 *
 * [[services]]
 * binding = "BILLING_SERVICE"
 * service = "billing_service"
 * ```
 */
export function generateWranglerToml(
  workerName: string,
  config: FastworkerConfig,
  role: 'gateway' | 'service',
): string {
  const lines: string[] = [
    '# Auto-generated by fastworker compiler — do not edit manually',
    `name = "${workerName}"`,
    'main = "./index.js"',
    'compatibility_date = "2024-01-01"',
    'compatibility_flags = ["nodejs_compat"]',
    '',
  ];

  // Gateway: inject [[services]] blocks for each worker
  if (role === 'gateway' && config.workers) {
    for (const wName of Object.keys(config.workers)) {
      const bindingName = wName.toUpperCase();
      lines.push('[[services]]');
      lines.push(`binding = "${bindingName}"`);
      lines.push(`service = "${wName}"`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ─── 7. RPC Transport Code Generator ──────────────────────────────────────────

/**
 * Generate adapter-specific RPC transport code for the gateway worker.
 *
 * The generated code is inlined into the gateway's entry point and provides
 * the `RPCTransport` implementation used by `ctx.call`.
 *
 * @param adapter           - Target platform adapter
 * @param moduleToBindingMap - Maps module names to CF binding names (only used for cloudflare)
 * @param serviceMap         - Maps worker names to network URLs (used for node + CF fallback)
 * @returns Generated TypeScript source code for the transport factory function
 */
export function generateRPCTransport(
  adapter: Adapter,
  moduleToBindingMap: ModuleToBindingMap,
  serviceMap: ServiceMap = {},
): string {
  if (adapter === 'cloudflare') {
    return generateCloudflareTransport(moduleToBindingMap, serviceMap);
  }
  return generateNodeTransport(serviceMap, moduleToBindingMap);
}

/**
 * Generate Cloudflare Service Binding transport with auto-fallback.
 *
 * The generated code:
 * 1. Looks up the binding name via moduleToBindingMap
 * 2. Tries env[BINDING].fetch() (Service Binding)
 * 3. If binding is undefined or lacks .fetch, falls back to HTTP fetch()
 * 4. NEVER throws — degrades gracefully with a console warning
 */
function generateCloudflareTransport(
  moduleToBindingMap: ModuleToBindingMap,
  serviceMap: ServiceMap,
): string {
  return `
// ─── Cloudflare Service Binding Transport (auto-generated) ─────────────
const __moduleToBinding = ${JSON.stringify(moduleToBindingMap, null, 2)};
const __serviceMap = ${JSON.stringify(serviceMap, null, 2)};

/**
 * Create an RPC transport using Cloudflare Service Bindings.
 * Falls back to standard HTTP fetch if bindings are unavailable.
 */
function createTransport(env) {
  return {
    async invoke(moduleName, functionName, args) {
      const bindingName = __moduleToBinding[moduleName];
      if (!bindingName) {
        throw new Error(\`[fastworker] Unknown module "\${moduleName}" — not found in module-to-binding map.\`);
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
          throw new Error(\`[fastworker] RPC call \${moduleName}.\${functionName}() failed: \${errorText}\`);
        }

        return response.json();
      }

      // ── Auto-fallback: Service Binding unavailable ──
      // Find the worker name for this module (reverse lookup from moduleToBinding)
      const workerName = Object.entries(${JSON.stringify(Object.fromEntries(
        Object.entries(moduleToBindingMap).map(([mod, binding]) => [
          mod,
          Object.entries(moduleToBindingMap)
            .filter(([, b]) => b === binding)
            .map(([m]) => m),
        ]),
      ))}).find(([, mods]) => mods.includes(moduleName))?.[0] || moduleName;

      // Look up the worker's fallback URL from the service map
      const baseUrl = __serviceMap[workerName];
      if (!baseUrl) {
        throw new Error(
          \`[fastworker] Service Binding "\${bindingName}" is unavailable and no fallback URL \\n\` +
          \`  found in config.services for worker "\${workerName}".\\n\` +
          \`  Either configure the Service Binding or add a services entry.\`
        );
      }

      console.warn(
        \`[fastworker] Service Binding "\${bindingName}" unavailable, falling back to HTTP fetch → \${baseUrl}\`
      );

      const response = await fetch(\`\${baseUrl}/__rpc\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ module: moduleName, function: functionName, args }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(\`[fastworker] RPC call \${moduleName}.\${functionName}() failed (fallback): \${errorText}\`);
      }

      return response.json();
    },
  };
}
`.trim();
}

/**
 * Generate standard HTTP fetch transport for the Node.js adapter.
 *
 * The generated code:
 * 1. Looks up the worker name for each module via moduleToBindingMap
 * 2. Uses serviceMap[workerName] as the base URL for fetch()
 * 3. This is the "address book" pattern — URLs are routing targets, not server configs
 */
function generateNodeTransport(
  serviceMap: ServiceMap,
  moduleToBindingMap: ModuleToBindingMap,
): string {
  return `
// ─── Node.js HTTP Fetch Transport (auto-generated) ─────────────────────
const __moduleToWorker = ${JSON.stringify(
    invertToModuleWorkerMap(moduleToBindingMap),
    null,
    2,
  )};
const __serviceMap = ${JSON.stringify(serviceMap, null, 2)};

/**
 * Create an RPC transport using standard HTTP fetch.
 * Uses the services map as an address book for routing.
 */
function createTransport() {
  return {
    async invoke(moduleName, functionName, args) {
      const workerName = __moduleToWorker[moduleName];
      if (!workerName) {
        throw new Error(\`[fastworker] Unknown module "\${moduleName}" — not found in module-to-worker map.\`);
      }

      const baseUrl = __serviceMap[workerName];
      if (!baseUrl) {
        throw new Error(
          \`[fastworker] No service URL found for worker "\${workerName}" (module: "\${moduleName}").\\n\` +
          \`  Add it to config.services: { \${workerName}: 'http://localhost:PORT' }\`
        );
      }

      const response = await fetch(\`\${baseUrl}/__rpc\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ module: moduleName, function: functionName, args }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(\`[fastworker] RPC call \${moduleName}.\${functionName}() failed: \${errorText}\`);
      }

      return response.json();
    },
  };
}
`.trim();
}

/**
 * Convert ModuleToBindingMap to a module→workerName lookup.
 * The binding names are uppercased worker names, so we lowercase them back.
 */
function invertToModuleWorkerMap(moduleToBindingMap: ModuleToBindingMap): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [moduleName, bindingName] of Object.entries(moduleToBindingMap)) {
    result[moduleName] = bindingName.toLowerCase();
  }
  return result;
}

// ─── 8. Node.js Server Entry Generator ─────────────────────────────────────────

/**
 * Generate a Node.js HTTP server entry point for a micro-worker.
 *
 * CRITICAL: The generated server does NOT blindly bind to the services URL.
 * It implements a strict 3-tier port fallback hierarchy:
 *
 *   1. process.env.PORT (production/VPS) → bind 0.0.0.0
 *   2. Parsed port from services URL if localhost (dev) → bind 127.0.0.1
 *   3. Default 3000 with warning → bind 127.0.0.1
 *
 * This prevents EADDRINUSE and invalid domain binding errors when developers
 * use production URLs (e.g., https://api.domain.com) in their config.
 *
 * @param workerName - Name of this worker (e.g., 'account_service')
 * @param config     - The fastworker config (for extracting services URL)
 * @returns Generated Node.js server source code
 */
export function generateNodeServerEntry(
  workerName: string,
  config: FastworkerConfig,
): string {
  const serviceUrl = config.services?.[workerName] ?? '';

  return `
// ─── Node.js Server Entry: ${workerName} (auto-generated) ──────────────
import { createServer } from 'node:http';

// ── 3-Tier Port Fallback ──
function resolvePort() {
  // Priority 1: process.env.PORT (production/VPS/Docker)
  if (process.env.PORT) {
    const port = parseInt(process.env.PORT, 10);
    if (!isNaN(port) && port > 0 && port < 65536) {
      return { port, hostname: '0.0.0.0' };
    }
  }

  // Priority 2: Parse port from services URL (local development)
  try {
    const url = new URL('${serviceUrl}');
    if (
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
      url.port
    ) {
      return { port: parseInt(url.port, 10), hostname: '127.0.0.1' };
    }
  } catch {
    // URL parsing failed — fall through to default
  }

  // Priority 3: Safe fallback with warning
  console.warn(
    '[fastworker] Running ${workerName} on default port 3000.\\n' +
    '  In production environments, you MUST provide process.env.PORT.\\n' +
    '  Example: PORT=8080 node dist/${workerName}/index.js'
  );
  return { port: 3000, hostname: '127.0.0.1' };
}

const { port, hostname } = resolvePort();

// Import the worker's fetch handler
import { handler } from './handler.js';

// Create a standard Node.js HTTP server that delegates to the worker handler
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', \`http://\${req.headers.host || 'localhost'}\`);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
    }

    const webRequest = new Request(url.toString(), {
      method: req.method || 'GET',
      headers,
      body: ['GET', 'HEAD'].includes(req.method || 'GET') ? undefined : req,
      duplex: 'half',
    });

    const response = await handler(webRequest);

    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    const body = await response.arrayBuffer();
    res.end(Buffer.from(body));
  } catch (error) {
    console.error('[fastworker] Request error:', error);
    res.writeHead(500);
    res.end('Internal Server Error');
  }
});

server.listen(port, hostname, () => {
  console.log(\`[fastworker] ${workerName} listening on http://\${hostname}:\${port}\`);
});
`.trim();
}

// ─── 9. Environment Variable Distribution ──────────────────────────────────────

/**
 * Distribute environment variables from the project root to all micro-worker outputs.
 *
 * Reads a single `.dev.vars` (Cloudflare) or `.env` (Node) from the root
 * and copies it to each worker's output directory. This ensures `ctx.env.DB_URL`
 * works consistently regardless of deployment topology.
 *
 * For production, secrets should be set via:
 * - Cloudflare: `wrangler secret put SECRET_NAME`
 * - Node/VPS: Platform-specific env config (not committed to repo)
 *
 * @param rootDir    - Project root directory
 * @param outputDirs - Array of output directories (one per worker)
 * @param adapter    - Target adapter (determines which env file to look for)
 */
export function distributeEnvVars(
  rootDir: string,
  outputDirs: string[],
  adapter: Adapter,
): void {
  // Determine which env file to distribute
  const envFileName = adapter === 'cloudflare' ? '.dev.vars' : '.env';
  const envFilePath = path.join(rootDir, envFileName);

  if (!fs.existsSync(envFilePath)) {
    // No env file found — not an error, just skip
    return;
  }

  const envContent = fs.readFileSync(envFilePath, 'utf-8');

  for (const outDir of outputDirs) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, envFileName), envContent);
  }
}

// ─── 10. Build Orchestrators ───────────────────────────────────────────────────

/**
 * Top-level build entry point.
 * Delegates to buildMonolith() or buildMicroservices() based on config.
 */
export async function build(config: FastworkerConfig, rootDir: string): Promise<void> {
  const modulesDir = path.resolve(rootDir, config.modulesDir ?? './modules');
  const outDir = path.resolve(rootDir, OUTPUT_DIR);

  console.log(`[fastworker] Building in ${config.deployMode} mode (adapter: ${config.adapter})`);
  console.log(`[fastworker] Scanning modules in: ${modulesDir}`);

  const entries = scanModules(modulesDir);
  console.log(`[fastworker] Found ${entries.length} route(s):`);
  for (const entry of entries) {
    console.log(`  ${entry.methods.join(',')} ${entry.routePath} → ${entry.modulePath}`);
  }

  if (config.deployMode === 'monolith') {
    await buildMonolith(config, rootDir, entries, modulesDir, outDir);
  } else {
    await buildMicroservices(config, rootDir, entries, modulesDir, outDir);
  }

  console.log(`[fastworker] Build complete → ${outDir}`);
}

/**
 * Build a single monolith bundle.
 *
 * All modules are inlined into one entry point. The route manifest is embedded
 * directly. ctx.call uses local function calls (zero-latency, no network).
 */
async function buildMonolith(
  config: FastworkerConfig,
  rootDir: string,
  entries: RouteManifestEntry[],
  modulesDir: string,
  outDir: string,
): Promise<void> {
  // Generate the manifest and entry point
  const generatedDir = path.resolve(rootDir, GENERATED_DIR);
  fs.mkdirSync(generatedDir, { recursive: true });

  const manifestCode = generateRouteManifest(entries, modulesDir, generatedDir);

  const isNode = config.adapter === 'node';

  const entryCode = isNode
    ? `
// Auto-generated monolith entry (Node.js) — do not edit
import { createServer } from 'node:http';
import { routes, moduleMap } from './_manifest';
import { createRouter } from 'fastworker-js/runtime';

const handler = createRouter({ routes, modules: moduleMap });

const port = parseInt(process.env.PORT || '3000', 10);
const hostname = process.env.PORT ? '0.0.0.0' : '127.0.0.1';

const server = createServer(async (nodeReq, nodeRes) => {
  try {
    const url = new URL(nodeReq.url || '/', \`http://\${nodeReq.headers.host || 'localhost'}\`);
    const headers = new Headers();
    for (const [key, value] of Object.entries(nodeReq.headers)) {
      if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
    }
    const webReq = new Request(url.toString(), {
      method: nodeReq.method || 'GET',
      headers,
      body: ['GET', 'HEAD'].includes(nodeReq.method || 'GET') ? undefined : nodeReq,
      duplex: 'half',
    });
    const response = await handler(webReq);
    nodeRes.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    const body = await response.arrayBuffer();
    nodeRes.end(Buffer.from(body));
  } catch (error) {
    console.error('[fastworker] Request error:', error);
    nodeRes.writeHead(500);
    nodeRes.end('Internal Server Error');
  }
});

server.listen(port, hostname, () => {
  console.log(\`[fastworker] Listening on http://\${hostname}:\${port}\`);
});
`.trim()
    : `
// Auto-generated monolith entry (Cloudflare) — do not edit
import { routes, moduleMap } from './_manifest';
import { createRouter } from 'fastworker-js/runtime';

const handler = createRouter({ routes, modules: moduleMap });

export default { fetch: handler };
`.trim();

  fs.writeFileSync(path.join(generatedDir, '_manifest.ts'), manifestCode);
  fs.writeFileSync(path.join(generatedDir, '_entry.ts'), entryCode);

  // Bundle with esbuild
  fs.mkdirSync(outDir, { recursive: true });

  await esbuild.build({
    entryPoints: [path.join(generatedDir, '_entry.ts')],
    outfile: path.join(outDir, 'index.js'),
    bundle: true,
    format: 'esm',
    platform: isNode ? 'node' : 'browser',
    target: 'es2022',
    minify: false,
    sourcemap: true,
    external: isNode ? ['node:*'] : [],
    logLevel: 'info',
  });
}

/**
 * Build microservices: one bundle per worker group + a gateway.
 *
 * The gateway contains the router and adapter-specific RPC transport.
 * Each service worker contains its modules and an RPC endpoint handler.
 */
async function buildMicroservices(
  config: FastworkerConfig,
  rootDir: string,
  entries: RouteManifestEntry[],
  modulesDir: string,
  outDir: string,
): Promise<void> {
  // Resolve workers map (use config or generate default 1:1)
  const workers = config.workers ?? generateDefaultWorkersMap(modulesDir);
  const moduleToBindingMap = generateModuleToBindingMap(workers);

  const gatewayOutDir = path.join(outDir, 'gateway');
  const generatedDir = path.resolve(rootDir, GENERATED_DIR);
  fs.mkdirSync(generatedDir, { recursive: true });

  // ── Build the Gateway ──
  console.log('[fastworker] Building gateway...');

  const manifestCode = generateRouteManifest(entries, modulesDir, generatedDir);
  const transportCode = generateRPCTransport(
    config.adapter,
    moduleToBindingMap,
    config.services ?? {},
  );

  const isNodeGw = config.adapter === 'node';
  const transportFactory = config.adapter === 'cloudflare'
    ? '(env) => createTransport(env)'
    : 'createTransport()';

  const gatewayEntry = isNodeGw
    ? `
// Auto-generated gateway entry (Node.js) — do not edit
import { createServer } from 'node:http';
import { routes, moduleMap } from './_manifest';
import { createRouter } from 'fastworker-js/runtime';

${transportCode}

const handler = createRouter({ routes, modules: moduleMap, transport: ${transportFactory} });

const port = parseInt(process.env.PORT || '3000', 10);
const hostname = process.env.PORT ? '0.0.0.0' : '127.0.0.1';

const server = createServer(async (nodeReq, nodeRes) => {
  try {
    const url = new URL(nodeReq.url || '/', \`http://\${nodeReq.headers.host || 'localhost'}\`);
    const headers = new Headers();
    for (const [key, value] of Object.entries(nodeReq.headers)) {
      if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
    }
    const webReq = new Request(url.toString(), {
      method: nodeReq.method || 'GET',
      headers,
      body: ['GET', 'HEAD'].includes(nodeReq.method || 'GET') ? undefined : nodeReq,
      duplex: 'half',
    });
    const response = await handler(webReq);
    nodeRes.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    const body = await response.arrayBuffer();
    nodeRes.end(Buffer.from(body));
  } catch (error) {
    console.error('[fastworker] Gateway error:', error);
    nodeRes.writeHead(500);
    nodeRes.end('Internal Server Error');
  }
});

server.listen(port, hostname, () => {
  console.log(\`[fastworker] Gateway listening on http://\${hostname}:\${port}\`);
});
`.trim()
    : `
// Auto-generated gateway entry (Cloudflare) — do not edit
import { routes, moduleMap } from './_manifest';
import { createRouter } from 'fastworker-js/runtime';

${transportCode}

const handler = createRouter({ routes, modules: moduleMap, transport: ${transportFactory} });

export default { fetch: handler };
`.trim();

  fs.writeFileSync(path.join(generatedDir, '_manifest.ts'), manifestCode);
  fs.writeFileSync(path.join(generatedDir, '_gateway.ts'), gatewayEntry);

  fs.mkdirSync(gatewayOutDir, { recursive: true });

  await esbuild.build({
    entryPoints: [path.join(generatedDir, '_gateway.ts')],
    outfile: path.join(gatewayOutDir, 'index.js'),
    bundle: true,
    format: 'esm',
    platform: config.adapter === 'cloudflare' ? 'browser' : 'node',
    target: 'es2022',
    sourcemap: true,
    external: config.adapter === 'cloudflare' ? [] : ['node:*'],
    logLevel: 'info',
  });

  // Generate gateway wrangler.toml (Cloudflare only)
  if (config.adapter === 'cloudflare') {
    const gatewayToml = generateWranglerToml('gateway', config, 'gateway');
    fs.writeFileSync(path.join(gatewayOutDir, 'wrangler.toml'), gatewayToml);
  }

  // ── Build each Service Worker ──
  const workerOutputDirs: string[] = [gatewayOutDir];

  for (const [workerName, moduleNames] of Object.entries(workers)) {
    console.log(`[fastworker] Building service: ${workerName} (modules: ${moduleNames.join(', ')})`);

    const workerOutDir = path.join(outDir, workerName);
    workerOutputDirs.push(workerOutDir);
    fs.mkdirSync(workerOutDir, { recursive: true });

    // Generate the service worker entry
    const workerModuleEntries = entries.filter(e => {
      const topModule = e.modulePath.split(path.sep)[0].split('/')[0];
      return moduleNames.includes(topModule);
    });

    // Generate service manifest (only routes for this worker's modules)
    const serviceManifest = generateRouteManifest(
      workerModuleEntries,
      modulesDir,
      generatedDir,
    );

    const isNodeSvc = config.adapter === 'node';
    const serviceUrl = config.services?.[workerName] ?? '';

    const serviceEntry = isNodeSvc
      ? `
// Auto-generated service entry: ${workerName} (Node.js) — do not edit
import { createServer } from 'node:http';
import { routes, moduleMap } from './_manifest_${workerName}';
import { createRouter } from 'fastworker-js/runtime';

const handler = createRouter({ routes, modules: moduleMap });

function resolvePort() {
  if (process.env.PORT) {
    const p = parseInt(process.env.PORT, 10);
    if (!isNaN(p) && p > 0 && p < 65536) return { port: p, hostname: '0.0.0.0' };
  }
  try {
    const u = new URL('${serviceUrl}');
    if ((u.hostname === 'localhost' || u.hostname === '127.0.0.1') && u.port) {
      return { port: parseInt(u.port, 10), hostname: '127.0.0.1' };
    }
  } catch {}
  console.warn('[fastworker] ${workerName}: defaulting to port 3000. Set PORT env for production.');
  return { port: 3000, hostname: '127.0.0.1' };
}

const { port, hostname } = resolvePort();

const server = createServer(async (nodeReq, nodeRes) => {
  try {
    const url = new URL(nodeReq.url || '/', \`http://\${nodeReq.headers.host || 'localhost'}\`);
    const headers = new Headers();
    for (const [key, value] of Object.entries(nodeReq.headers)) {
      if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
    }
    const webReq = new Request(url.toString(), {
      method: nodeReq.method || 'GET',
      headers,
      body: ['GET', 'HEAD'].includes(nodeReq.method || 'GET') ? undefined : nodeReq,
      duplex: 'half',
    });
    const response = await handler(webReq);
    nodeRes.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    const body = await response.arrayBuffer();
    nodeRes.end(Buffer.from(body));
  } catch (error) {
    console.error('[fastworker] ${workerName} error:', error);
    nodeRes.writeHead(500);
    nodeRes.end('Internal Server Error');
  }
});

server.listen(port, hostname, () => {
  console.log(\`[fastworker] ${workerName} listening on http://\${hostname}:\${port}\`);
});
`.trim()
      : `
// Auto-generated service entry: ${workerName} (Cloudflare) — do not edit
import { routes, moduleMap } from './_manifest_${workerName}';
import { createRouter } from 'fastworker-js/runtime';

const handler = createRouter({ routes, modules: moduleMap });

export default { fetch: handler };
`.trim();

    fs.writeFileSync(
      path.join(generatedDir, `_manifest_${workerName}.ts`),
      serviceManifest,
    );
    fs.writeFileSync(
      path.join(generatedDir, `_service_${workerName}.ts`),
      serviceEntry,
    );

    await esbuild.build({
      entryPoints: [path.join(generatedDir, `_service_${workerName}.ts`)],
      outfile: path.join(workerOutDir, 'index.js'),
      bundle: true,
      format: 'esm',
      platform: config.adapter === 'cloudflare' ? 'browser' : 'node',
      target: 'es2022',
      sourcemap: true,
      external: config.adapter === 'cloudflare' ? [] : ['node:*'],
      logLevel: 'info',
    });

    // Generate service wrangler.toml (Cloudflare only)
    if (config.adapter === 'cloudflare') {
      const serviceToml = generateWranglerToml(workerName, config, 'service');
      fs.writeFileSync(path.join(workerOutDir, 'wrangler.toml'), serviceToml);
    }

    // Generate Node server entry (Node only)
    if (config.adapter === 'node') {
      const serverEntry = generateNodeServerEntry(workerName, config);
      fs.writeFileSync(path.join(workerOutDir, 'server.js'), serverEntry);
    }
  }

  // ── Distribute environment variables ──
  distributeEnvVars(rootDir, workerOutputDirs, config.adapter);
}
