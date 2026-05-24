#!/usr/bin/env node

/**
 * @module create-fastworker
 *
 * CLI entry point for scaffolding new fastworker projects.
 * Run via: npx create-fastworker [project-name]
 */

import { main } from './cli.js';

main().catch((error) => {
  console.error('\n[create-fastworker] Fatal error:', error);
  process.exit(1);
});
