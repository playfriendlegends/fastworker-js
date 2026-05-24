/**
 * @module create-fastworker/cli
 *
 * Interactive CLI flow using @clack/prompts.
 *
 * Prompt sequence:
 *   1. Project name (default: my-fastworker-app)
 *   2. Language: TypeScript or JavaScript
 *      → JS selection triggers a gentle warning about missing RPC autocomplete
 *   3. Deploy mode: Monolith or Microservices
 *   4. Adapter: Cloudflare or Node.js
 *   5. Scaffold and display next steps
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  intro,
  outro,
  text,
  select,
  spinner,
  note,
  cancel,
  isCancel,
  log,
} from '@clack/prompts';
import { scaffoldProject } from './scaffolder.js';
import type { ScaffoldOptions } from './scaffolder.js';

// ─── CLI Colors (ANSI escape codes, no dependency needed) ──────────────────────

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;

// ─── Main CLI Flow ─────────────────────────────────────────────────────────────

export async function main(): Promise<void> {
  // Parse optional project name from argv
  const argProjectName = process.argv[2];

  intro(bold(cyan('  create-fastworker  ')) + dim(' — Platform-Agnostic Modular Monolith'));

  // ── 1. Project Name ──
  const projectName = argProjectName ?? await promptProjectName();
  if (isCancel(projectName)) {
    cancel('Operation cancelled.');
    process.exit(0);
  }

  const projectDir = path.resolve(process.cwd(), projectName as string);

  // Check if directory already exists and is non-empty
  if (fs.existsSync(projectDir)) {
    const dirContents = fs.readdirSync(projectDir);
    if (dirContents.length > 0) {
      cancel(`Directory "${projectName}" already exists and is not empty.`);
      process.exit(1);
    }
  }

  // ── 2. Language ──
  const language = await promptLanguage();
  if (isCancel(language)) {
    cancel('Operation cancelled.');
    process.exit(0);
  }

  // JavaScript warning
  if (language === 'javascript') {
    log.warn(
      yellow('⚠ Notice: fastworker is highly optimized for TypeScript.\n') +
      '  You will miss out on cross-module RPC auto-complete ' +
      dim('(ctx.call)') + '\n' +
      '  if you proceed with plain JavaScript.\n\n' +
      dim('  You can migrate to TypeScript later by adding a tsconfig.json\n') +
      dim('  and renaming .js files to .ts.'),
    );
  }

  // ── 3. Deploy Mode ──
  const deployMode = await promptDeployMode();
  if (isCancel(deployMode)) {
    cancel('Operation cancelled.');
    process.exit(0);
  }

  // ── 4. Adapter ──
  const adapter = await promptAdapter();
  if (isCancel(adapter)) {
    cancel('Operation cancelled.');
    process.exit(0);
  }

  // ── 5. Scaffold ──
  const s = spinner();
  s.start('Scaffolding your fastworker project...');

  const options: ScaffoldOptions = {
    projectName: projectName as string,
    projectDir,
    language: language as 'typescript' | 'javascript',
    deployMode: deployMode as 'monolith' | 'microservices',
    adapter: adapter as 'cloudflare' | 'node',
  };

  try {
    const createdFiles = await scaffoldProject(options);
    s.stop(`Created ${createdFiles.length} files`);
  } catch (error) {
    s.stop('Scaffolding failed');
    throw error;
  }

  // ── 6. Display Next Steps ──
  const relativeDir = path.relative(process.cwd(), projectDir) || '.';
  const pkgManager = detectPackageManager();

  const steps = [
    `cd ${relativeDir}`,
    `${pkgManager} install`,
    `${pkgManager} run dev`,
  ];

  note(
    steps.map((step, i) => `  ${dim(`${i + 1}.`)} ${green(step)}`).join('\n'),
    'Next steps',
  );

  outro(bold('Happy building! 🚀'));
}

// ─── Prompt Functions ──────────────────────────────────────────────────────────

async function promptProjectName(): Promise<string | symbol> {
  return text({
    message: 'Project name',
    placeholder: 'my-fastworker-app',
    defaultValue: 'my-fastworker-app',
    validate(value) {
      if (!value) return 'Project name is required';
      if (!/^[a-z0-9@][a-z0-9._\-/]*$/.test(value)) {
        return 'Project name must be lowercase and contain only letters, numbers, hyphens, and dots';
      }
      return undefined;
    },
  });
}

async function promptLanguage(): Promise<string | symbol> {
  return select({
    message: 'Which language would you like to use?',
    options: [
      {
        value: 'typescript',
        label: 'TypeScript',
        hint: 'recommended — full ctx.call autocomplete',
      },
      {
        value: 'javascript',
        label: 'JavaScript',
        hint: 'no RPC type inference',
      },
    ],
  });
}

async function promptDeployMode(): Promise<string | symbol> {
  return select({
    message: 'How would you like to deploy?',
    options: [
      {
        value: 'monolith',
        label: 'Monolith',
        hint: 'all modules in one worker — simplest to start',
      },
      {
        value: 'microservices',
        label: 'Microservices',
        hint: 'modules split into separate workers',
      },
    ],
  });
}

async function promptAdapter(): Promise<string | symbol> {
  return select({
    message: 'Which platform adapter?',
    options: [
      {
        value: 'cloudflare',
        label: 'Cloudflare Workers',
        hint: 'Service Bindings + global edge deployment',
      },
      {
        value: 'node',
        label: 'Node.js',
        hint: 'standard HTTP — deploy anywhere (VPS, Docker, etc.)',
      },
    ],
  });
}

// ─── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Detect which package manager invoked this CLI.
 * Falls back to 'npm' if detection fails.
 */
function detectPackageManager(): string {
  const userAgent = process.env.npm_config_user_agent;
  if (userAgent) {
    if (userAgent.startsWith('pnpm')) return 'pnpm';
    if (userAgent.startsWith('yarn')) return 'yarn';
    if (userAgent.startsWith('bun')) return 'bun';
  }
  return 'npm';
}
