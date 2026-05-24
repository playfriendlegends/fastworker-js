#!/usr/bin/env node

/**
 * @module fastworker/cli
 *
 * CLI entry point for the `fastworker` command.
 *
 * Usage:
 *   fastworker build     Build the project (reads fastworker.config.ts)
 *   fastworker --help    Show help
 */

import * as path from 'node:path';
import { loadConfig } from './config.js';
import { build } from './compiler.js';
import { dev } from './dev.js';

const args = process.argv.slice(2);
const command = args[0];

async function main(): Promise<void> {
  switch (command) {
    case 'dev': {
      const rootDir = process.cwd();

      console.log('[fastworker] Loading configuration...');

      try {
        const config = await loadConfig(rootDir);
        await dev(config, rootDir);
      } catch (error) {
        if (error instanceof Error) {
          console.error(`\n${error.message}\n`);
        } else {
          console.error('\n[fastworker] Dev mode failed with an unknown error.\n');
        }
        process.exit(1);
      }
      break;
    }

    case 'build': {
      const rootDir = process.cwd();

      console.log('[fastworker] Loading configuration...');

      try {
        const config = await loadConfig(rootDir);
        await build(config, rootDir);
      } catch (error) {
        if (error instanceof Error) {
          console.error(`\n${error.message}\n`);
        } else {
          console.error('\n[fastworker] Build failed with an unknown error.\n');
        }
        process.exit(1);
      }
      break;
    }

    case '--help':
    case '-h':
    case undefined: {
      console.log(`
  fastworker — Platform-Agnostic Modular Monolith Framework

  Usage:
    fastworker dev         Start development server with live reload
    fastworker build       Build the project
    fastworker --help      Show this help message

  The dev command watches your modules directory and config file,
  recompiles your code on change, and starts the target platform's dev server.
`);
      break;
    }

    default: {
      console.error(`[fastworker] Unknown command: "${command}"`);
      console.error('  Run "fastworker --help" for usage information.');
      process.exit(1);
    }
  }
}

main().catch((error) => {
  console.error('[fastworker] Fatal error:', error);
  process.exit(1);
});

