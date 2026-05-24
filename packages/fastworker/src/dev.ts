import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, ChildProcess } from 'node:child_process';
import { build, generateDefaultWorkersMap } from './compiler.js';
import type { FastworkerConfig } from './types.js';

/**
 * Recursively watches a directory and its subdirectories.
 * Works reliably on Linux, macOS, and Windows.
 */
function watchDirectoryRecursive(
  dir: string,
  onChange: (filepath: string) => void
): () => void {
  const watchers = new Map<string, fs.FSWatcher>();

  function register(targetDir: string) {
    if (watchers.has(targetDir)) return;

    try {
      const stats = fs.statSync(targetDir);
      if (!stats.isDirectory()) return;

      const watcher = fs.watch(targetDir, (event, filename) => {
        if (!filename) return;
        const fullPath = path.join(targetDir, filename);

        // If a new directory is created, watch it recursively
        try {
          if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
            register(fullPath);
          }
        } catch {}

        onChange(fullPath);
      });
      watchers.set(targetDir, watcher);

      // Recursively watch subdirectories
      const entries = fs.readdirSync(targetDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          register(path.join(targetDir, entry.name));
        }
      }
    } catch (e) {
      // Ignore watch errors (e.g. permission issues on some folders)
    }
  }

  register(dir);

  return () => {
    for (const watcher of watchers.values()) {
      watcher.close();
    }
    watchers.clear();
  };
}

/**
 * Start the fastworker development server with file watching and auto-rebuild.
 */
export async function dev(config: FastworkerConfig, rootDir: string): Promise<void> {
  const modulesDir = path.resolve(rootDir, config.modulesDir ?? './modules');

  console.log('[fastworker] Running initial build...');
  await build(config, rootDir);
  console.log('[fastworker] Initial build successful.\n');

  // List of active processes to clean up on exit
  const processes: ChildProcess[] = [];

  const cleanup = () => {
    console.log('\n[fastworker] Stopping dev server...');
    for (const p of processes) {
      p.kill('SIGINT');
    }
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // ─── 1. Spawn Dev Server Processes ───

  const spawnProcess = (cmd: string, args: string[], label: string) => {
    console.log(`[fastworker] Starting ${label}: ${cmd} ${args.join(' ')}`);
    const cp = spawn(cmd, args, {
      stdio: 'inherit',
      shell: true,
      cwd: rootDir,
    });

    cp.on('error', (err) => {
      console.error(`[fastworker] Failed to start ${label}:`, err);
    });

    processes.push(cp);
  };

  if (config.adapter === 'cloudflare') {
    if (config.deployMode === 'monolith') {
      // Run wrangler dev at project root (uses root wrangler.toml pointing to dist/index.js)
      spawnProcess('npx', ['wrangler', 'dev'], 'Wrangler (monolith)');
    } else {
      // Run wrangler dev for the gateway
      spawnProcess('npx', ['wrangler', 'dev', '-c', 'dist/gateway/wrangler.toml'], 'Wrangler Gateway');
    }
  } else {
    // Node.js adapter
    if (config.deployMode === 'monolith') {
      // Node monolith: run node --watch dist/index.js
      // node --watch is supported natively in Node 18.11.0+ / 20+
      spawnProcess('node', ['--watch', 'dist/index.js'], 'Node monolith');
    } else {
      // Node microservices: run node --watch for gateway and each service
      const workers = config.workers ?? generateDefaultWorkersMap(modulesDir);
      spawnProcess('node', ['--watch', 'dist/gateway/index.js'], 'Node Gateway');
      for (const workerName of Object.keys(workers)) {
        spawnProcess('node', ['--watch', `dist/${workerName}/server.js`], `Node Service (${workerName})`);
      }
    }
  }

  // ─── 2. Setup Watcher & Debounced Rebuild ───

  let rebuildTimeout: NodeJS.Timeout | null = null;

  const triggerRebuild = (filepath: string) => {
    if (rebuildTimeout) clearTimeout(rebuildTimeout);

    rebuildTimeout = setTimeout(async () => {
      const relPath = path.relative(rootDir, filepath);
      console.log(`\n[fastworker] Change detected in ${relPath}. Recompiling...`);
      try {
        await build(config, rootDir);
        console.log('[fastworker] Recompile complete.');
      } catch (error) {
        if (error instanceof Error) {
          console.error(`[fastworker] Recompile failed:\n${error.message}`);
        } else {
          console.error('[fastworker] Recompile failed with an unknown error.');
        }
      }
    }, 100); // 100ms debounce
  };

  // Watch modules directory
  const closeModulesWatcher = watchDirectoryRecursive(modulesDir, (filepath) => {
    // Only rebuild on relevant source files (.ts, .js, .json)
    if (/\.(ts|js|json)$/.test(filepath)) {
      triggerRebuild(filepath);
    }
  });

  // Watch config file
  const CONFIG_FILE_NAMES = [
    'fastworker.config.ts',
    'fastworker.config.mts',
    'fastworker.config.js',
    'fastworker.config.mjs',
  ];
  let configWatcher: fs.FSWatcher | null = null;
  for (const file of CONFIG_FILE_NAMES) {
    const p = path.resolve(rootDir, file);
    if (fs.existsSync(p)) {
      try {
        configWatcher = fs.watch(p, () => {
          triggerRebuild(p);
        });
      } catch {}
      break;
    }
  }

  // Also close watchers if process exits cleanly
  process.on('exit', () => {
    closeModulesWatcher();
    if (configWatcher) configWatcher.close();
  });
}
