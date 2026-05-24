/**
 * @module fastworker/config
 *
 * Configuration loader and validator for `fastworker.config.ts`.
 * Uses esbuild to compile TypeScript config files on-the-fly,
 * then validates the loaded config against the schema.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import type { FastworkerConfig, Adapter } from './types.js';

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Ordered list of config file names to search for */
const CONFIG_FILE_NAMES = [
  'fastworker.config.ts',
  'fastworker.config.mts',
  'fastworker.config.js',
  'fastworker.config.mjs',
] as const;

/** Valid adapter values */
const VALID_ADAPTERS: ReadonlySet<Adapter> = new Set(['cloudflare', 'node']);

/** Internal directory for compiler artifacts */
const FASTWORKER_DIR = '.fastworker';

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Locate, compile, and validate a fastworker config file from the given root directory.
 *
 * For TypeScript config files, esbuild is used to compile them on-the-fly
 * (similar to how Vite handles `vite.config.ts`). The compiled output is
 * written to `.fastworker/_config.mjs` and then dynamically imported.
 *
 * @param rootDir - Absolute path to the project root (where the config file lives)
 * @returns Validated and normalized FastworkerConfig
 * @throws If no config file is found or validation fails
 */
export async function loadConfig(rootDir: string): Promise<FastworkerConfig> {
  const configPath = findConfigFile(rootDir);

  if (!configPath) {
    throw new Error(
      `[fastworker] No configuration file found in "${rootDir}".\n` +
      `  Expected one of: ${CONFIG_FILE_NAMES.join(', ')}`,
    );
  }

  const rawConfig = await compileAndImportConfig(configPath, rootDir);
  return validateConfig(rawConfig, rootDir);
}

/**
 * Provide sensible defaults for a partial config.
 * Useful for programmatic usage where not all fields need to be specified.
 */
export function defineConfig(config: Partial<FastworkerConfig> & Pick<FastworkerConfig, 'deployMode'>): FastworkerConfig {
  return {
    adapter: 'cloudflare',
    modulesDir: './modules',
    ...config,
  };
}

// ─── Config File Discovery ─────────────────────────────────────────────────────

/**
 * Search for a config file in the given directory.
 * Returns the first match from CONFIG_FILE_NAMES, or null if none found.
 */
function findConfigFile(rootDir: string): string | null {
  for (const fileName of CONFIG_FILE_NAMES) {
    const candidate = path.resolve(rootDir, fileName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

// ─── Config Compilation ────────────────────────────────────────────────────────

/**
 * Compile a config file (potentially TypeScript) using esbuild,
 * then dynamically import the compiled JavaScript.
 *
 * This approach avoids requiring the user to have `tsx` or `ts-node` installed.
 * The compiled config is written to `.fastworker/_config.mjs` and cleaned up after import.
 */
async function compileAndImportConfig(configPath: string, rootDir: string): Promise<unknown> {
  const isTypeScript = /\.ts$|\.mts$/.test(configPath);

  // For plain JS/MJS files, import directly — no compilation needed
  if (!isTypeScript) {
    const configUrl = pathToFileURL(configPath).href;
    const mod = await import(configUrl);
    return mod.default ?? mod;
  }

  // Compile TypeScript config with esbuild
  const outDir = path.join(rootDir, FASTWORKER_DIR);
  const outFile = path.join(outDir, '_config.mjs');

  fs.mkdirSync(outDir, { recursive: true });

  await esbuild.build({
    entryPoints: [configPath],
    outfile: outFile,
    bundle: true,
    write: true,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    // Mark node builtins as external to avoid bundling them
    external: ['node:*'],
    // Suppress esbuild warnings for config files
    logLevel: 'silent',
  });

  try {
    // Use file:// URL for cross-platform import() compatibility
    // Add timestamp query to bust module cache on repeated loads
    const configUrl = pathToFileURL(outFile).href + `?t=${Date.now()}`;
    const mod = await import(configUrl);
    return mod.default ?? mod;
  } finally {
    // Clean up compiled config — it's a transient build artifact
    try {
      fs.unlinkSync(outFile);
    } catch {
      // Non-critical cleanup failure — ignore silently
    }
  }
}

// ─── Config Validation ─────────────────────────────────────────────────────────

/**
 * Validate and normalize raw config values.
 * Applies defaults, checks required fields, and validates cross-field constraints.
 *
 * @param raw     - The raw config object from the user's config file
 * @param rootDir - Project root, used to resolve relative paths and validate module existence
 * @returns Validated FastworkerConfig
 * @throws Descriptive error if validation fails
 */
function validateConfig(raw: unknown, rootDir: string): FastworkerConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('[fastworker] Config file must export an object.');
  }

  const config = raw as Record<string, unknown>;
  const errors: string[] = [];

  // ── deployMode (required) ──
  if (!config.deployMode || !['monolith', 'microservices'].includes(config.deployMode as string)) {
    errors.push(`"deployMode" must be 'monolith' or 'microservices'. Got: ${JSON.stringify(config.deployMode)}`);
  }

  // ── adapter (optional, defaults to 'cloudflare') ──
  const adapter = (config.adapter as Adapter) ?? 'cloudflare';
  if (!VALID_ADAPTERS.has(adapter)) {
    errors.push(`"adapter" must be 'cloudflare' or 'node'. Got: ${JSON.stringify(config.adapter)}`);
  }

  // ── modulesDir (optional, defaults to './modules') ──
  const modulesDir = (config.modulesDir as string) ?? './modules';
  const resolvedModulesDir = path.resolve(rootDir, modulesDir);
  if (!fs.existsSync(resolvedModulesDir)) {
    errors.push(`"modulesDir" directory does not exist: ${resolvedModulesDir}`);
  }

  // ── services (conditionally required) ──
  const services = config.services as Record<string, string> | undefined;
  if (config.deployMode === 'microservices' && adapter === 'node' && !services) {
    errors.push(
      `"services" map is required when adapter is 'node' and deployMode is 'microservices'.\n` +
      `  This tells the RPC client where to find each worker (e.g., { billing_service: 'http://localhost:3002' }).`,
    );
  }

  // Validate services entries are valid URLs
  if (services) {
    for (const [workerName, url] of Object.entries(services)) {
      try {
        new URL(url);
      } catch {
        errors.push(`"services.${workerName}" is not a valid URL: ${JSON.stringify(url)}`);
      }
    }
  }

  // ── workers (optional, validated if provided) ──
  const workers = config.workers as Record<string, string[]> | undefined;
  if (workers) {
    validateWorkersMap(workers, resolvedModulesDir, errors);
  }

  // ── Bail on errors ──
  if (errors.length > 0) {
    throw new Error(
      `[fastworker] Configuration errors:\n${errors.map(e => `  • ${e}`).join('\n')}`,
    );
  }

  return {
    deployMode: config.deployMode as 'monolith' | 'microservices',
    adapter,
    modulesDir,
    services,
    workers,
  };
}

/**
 * Validate the `workers` map:
 * - Every module listed must exist as a directory in `modulesDir`
 * - No module may appear in multiple worker groups (ambiguous routing)
 * - Worker names must be valid identifiers (lowercase + underscores)
 */
function validateWorkersMap(
  workers: Record<string, string[]>,
  resolvedModulesDir: string,
  errors: string[],
): void {
  const seenModules = new Map<string, string>(); // moduleName → workerName

  for (const [workerName, modules] of Object.entries(workers)) {
    // Validate worker name format
    if (!/^[a-z][a-z0-9_]*$/.test(workerName)) {
      errors.push(
        `Worker name "${workerName}" must be lowercase with underscores (e.g., "account_service").`,
      );
    }

    if (!Array.isArray(modules) || modules.length === 0) {
      errors.push(`"workers.${workerName}" must be a non-empty array of module names.`);
      continue;
    }

    for (const moduleName of modules) {
      // Check for duplicate module assignment
      const existingWorker = seenModules.get(moduleName);
      if (existingWorker) {
        errors.push(
          `Module "${moduleName}" is assigned to both "${existingWorker}" and "${workerName}". ` +
          `A module can only belong to one worker (ambiguous RPC routing otherwise).`,
        );
      } else {
        seenModules.set(moduleName, workerName);
      }

      // Check that the module directory actually exists
      const moduleDir = path.join(resolvedModulesDir, moduleName);
      if (!fs.existsSync(moduleDir)) {
        errors.push(
          `Module "${moduleName}" (in workers.${workerName}) not found at: ${moduleDir}`,
        );
      }
    }
  }
}
