/**
 * @module create-fastworker/scaffolder
 *
 * Project scaffolder — generates all files for a new fastworker project.
 *
 * Generated structure varies based on user choices:
 *
 * ─── Always Generated ───
 *   package.json
 *   fastworker.config.{ts|js}
 *   modules/users/api.{ts|js}
 *   modules/auth/api.{ts|js}
 *   .gitignore
 *
 * ─── TypeScript Only ───
 *   tsconfig.json
 *
 * ─── Cloudflare Adapter ───
 *   wrangler.toml
 *   .dev.vars
 *
 * ─── Node.js Adapter ───
 *   .env
 *
 * All templates are inline string generators — no external template files needed.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ─── Public Types ──────────────────────────────────────────────────────────────

export interface ScaffoldOptions {
  projectName: string;
  projectDir: string;
  language: 'typescript' | 'javascript';
  deployMode: 'monolith' | 'microservices';
  adapter: 'cloudflare' | 'node';
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Scaffold a complete fastworker project from the given options.
 * Creates the directory structure and writes all template files.
 *
 * @returns Array of created file paths (relative to project dir)
 */
export async function scaffoldProject(options: ScaffoldOptions): Promise<string[]> {
  const { projectDir } = options;
  const createdFiles: string[] = [];

  // Build the file map (relative path → content)
  const files = generateFileMap(options);

  // Write all files
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(projectDir, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, 'utf-8');
    createdFiles.push(relativePath);
  }

  return createdFiles;
}

// ─── File Map Generator ────────────────────────────────────────────────────────

/**
 * Generate the complete map of files to create.
 * Each key is a relative path, each value is the file content.
 */
function generateFileMap(opts: ScaffoldOptions): Record<string, string> {
  const ext = opts.language === 'typescript' ? 'ts' : 'js';
  const files: Record<string, string> = {};

  // ── Always generated ──
  files['package.json'] = genPackageJson(opts);
  files[`fastworker.config.${ext}`] = genConfig(opts);
  files[`modules/users/api.${ext}`] = genUsersApi(opts);
  files[`modules/users/schema.${ext}`] = genUsersSchema(opts);
  files[`modules/auth/api.${ext}`] = genAuthApi(opts);
  files['.gitignore'] = genGitignore();

  // ── TypeScript only ──
  if (opts.language === 'typescript') {
    files['tsconfig.json'] = genTsconfig();
    files['types.ts'] = genTypesTs();
  }

  // ── Adapter-specific ──
  if (opts.adapter === 'cloudflare') {
    files['wrangler.toml'] = genWranglerToml(opts);
    files['.dev.vars'] = genDevVars();
  } else {
    files['.env'] = genDotEnv();
  }

  return files;
}

// ─── Template: package.json ────────────────────────────────────────────────────

function genPackageJson(opts: ScaffoldOptions): string {
  const devDeps: Record<string, string> = {};

  if (opts.language === 'typescript') {
    devDeps['typescript'] = '^5.8.0';
    devDeps['@types/node'] = '^22.0.0';
  }

  if (opts.adapter === 'cloudflare') {
    devDeps['wrangler'] = '^4.0.0';
  }

  const pkg = {
    name: opts.projectName,
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts: {
      build: 'fastworker build',
      dev: 'fastworker dev',
      ...(opts.language === 'typescript' ? { typecheck: 'tsc --noEmit' } : {}),
    },
    dependencies: {
      'fastworker-js': '^0.1.4',
    },
    devDependencies: Object.keys(devDeps).length > 0 ? devDeps : undefined,
  };

  return JSON.stringify(pkg, null, 2) + '\n';
}

// ─── Template: fastworker.config ───────────────────────────────────────────────

function genConfig(opts: ScaffoldOptions): string {
  if (opts.language === 'typescript') {
    return genConfigTS(opts);
  }
  return genConfigJS(opts);
}

function genConfigTS(opts: ScaffoldOptions): string {
  const lines: string[] = [
    `import type { FastworkerConfig } from 'fastworker-js';`,
    '',
  ];

  if (opts.deployMode === 'microservices') {
    lines.push(`const isProd = process.env.NODE_ENV === 'production';`);
    lines.push('');
  }

  lines.push('export default {');
  lines.push(`  deployMode: '${opts.deployMode}',`);
  lines.push(`  adapter: '${opts.adapter}',`);
  lines.push(`  modulesDir: './modules',`);

  if (opts.deployMode === 'microservices') {
    lines.push('');
    lines.push('  // Group modules into infrastructure workers');
    lines.push('  workers: {');
    lines.push("    account_service: ['users', 'auth'],");
    lines.push('  },');
    lines.push('');
    lines.push('  // RPC address book — tells the gateway where to find each worker');
    lines.push('  services: {');

    if (opts.adapter === 'cloudflare') {
      lines.push(
        "    account_service: isProd ? 'https://account.your-domain.com' : 'http://localhost:3001',",
      );
    } else {
      lines.push(
        "    account_service: isProd ? 'https://account.your-domain.com' : 'http://localhost:3001',",
      );
    }

    lines.push('  },');
  }

  lines.push('} satisfies FastworkerConfig;');
  lines.push('');

  return lines.join('\n');
}

function genConfigJS(opts: ScaffoldOptions): string {
  const lines: string[] = [
    '/** @type {import("fastworker-js").FastworkerConfig} */',
  ];

  if (opts.deployMode === 'microservices') {
    lines.push(`const isProd = process.env.NODE_ENV === 'production';`);
    lines.push('');
  }

  lines.push('export default {');
  lines.push(`  deployMode: '${opts.deployMode}',`);
  lines.push(`  adapter: '${opts.adapter}',`);
  lines.push(`  modulesDir: './modules',`);

  if (opts.deployMode === 'microservices') {
    lines.push('');
    lines.push('  workers: {');
    lines.push("    account_service: ['users', 'auth'],");
    lines.push('  },');
    lines.push('');
    lines.push('  services: {');
    lines.push(
      "    account_service: isProd ? 'https://account.your-domain.com' : 'http://localhost:3001',",
    );
    lines.push('  },');
  }

  lines.push('};');
  lines.push('');

  return lines.join('\n');
}

// ─── Template: modules/users/api ───────────────────────────────────────────────

function genUsersApi(opts: ScaffoldOptions): string {
  if (opts.language === 'typescript') {
    return `import type { FastworkerContext } from 'fastworker-js';
import type { Modules } from '../../types.js';

/**
 * GET /users — List all users
 */
export async function GET(ctx: FastworkerContext<Modules>) {
  const users = [
    { id: 1, name: 'Alice', email: 'alice@example.com' },
    { id: 2, name: 'Bob', email: 'bob@example.com' },
  ];

  return new Response(JSON.stringify({ users }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * POST /users — Create a new user
 */
export async function POST(ctx: FastworkerContext<Modules>) {
  const body = await ctx.req.json() as { name: string; email: string };

  const newUser = {
    id: Date.now(),
    name: body.name,
    email: body.email,
  };

  return new Response(JSON.stringify({ user: newUser }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── RPC Functions (callable by other modules via ctx.call.users) ──────────

/**
 * Get a user profile by ID.
 * Called by other modules: await ctx.call.users.getProfile({ id: 123 })
 */
export async function getProfile(input: { id: number }) {
  // In a real app, this would query a database
  return {
    id: input.id,
    name: 'Alice',
    email: 'alice@example.com',
  };
}

/**
 * Check if a user exists.
 * Called by other modules: await ctx.call.users.exists({ id: 123 })
 */
export async function exists(input: { id: number }): Promise<boolean> {
  // In a real app, this would check the database
  return input.id > 0;
}
`;
  }

  // JavaScript version
  return `/**
 * GET /users — List all users
 * @param {import('fastworker-js').FastworkerContext} ctx
 */
export async function GET(ctx) {
  const users = [
    { id: 1, name: 'Alice', email: 'alice@example.com' },
    { id: 2, name: 'Bob', email: 'bob@example.com' },
  ];

  return new Response(JSON.stringify({ users }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * POST /users — Create a new user
 * @param {import('fastworker-js').FastworkerContext} ctx
 */
export async function POST(ctx) {
  const body = await ctx.req.json();

  const newUser = {
    id: Date.now(),
    name: body.name,
    email: body.email,
  };

  return new Response(JSON.stringify({ user: newUser }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── RPC Functions (callable by other modules via ctx.call.users) ──────────

/**
 * Get a user profile by ID.
 * Called by other modules: await ctx.call.users.getProfile({ id: 123 })
 */
export async function getProfile(input) {
  return {
    id: input.id,
    name: 'Alice',
    email: 'alice@example.com',
  };
}

/**
 * Check if a user exists.
 * Called by other modules: await ctx.call.users.exists({ id: 123 })
 */
export async function exists(input) {
  return input.id > 0;
}
`;
}

// ─── Template: modules/users/schema (colocated, NOT a route) ───────────────────

function genUsersSchema(opts: ScaffoldOptions): string {
  if (opts.language === 'typescript') {
    return `/**
 * User schema — colocated with the users module.
 *
 * This file is NOT a route. Only files named exactly "api.ts"
 * become API routes. Everything else is safely colocated.
 */

export interface User {
  id: number;
  name: string;
  email: string;
}

export interface CreateUserInput {
  name: string;
  email: string;
}
`;
  }

  return `/**
 * User schema — colocated with the users module.
 *
 * This file is NOT a route. Only files named exactly "api.js"
 * become API routes. Everything else is safely colocated.
 */

/**
 * @typedef {{ id: number, name: string, email: string }} User
 * @typedef {{ name: string, email: string }} CreateUserInput
 */
export {};
`;
}

// ─── Template: modules/auth/api ────────────────────────────────────────────────

function genAuthApi(opts: ScaffoldOptions): string {
  if (opts.language === 'typescript') {
    return `import type { FastworkerContext } from 'fastworker-js';
import type { Modules } from '../../types.js';

/**
 * POST /auth — Authenticate a user
 */
export async function POST(ctx: FastworkerContext<Modules>) {
  const body = await ctx.req.json() as { email: string; password: string };

  // Example: call the users module via RPC to verify the user exists
  const userExists = await ctx.call.users.exists({ id: 1 });

  if (!userExists) {
    return new Response(JSON.stringify({ error: 'User not found' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // In a real app, verify password, generate JWT, etc.
  return new Response(JSON.stringify({
    token: 'example-jwt-token',
    user: { email: body.email },
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── RPC Functions ─────────────────────────────────────────────────────────

/**
 * Verify a JWT token.
 * Called by other modules: await ctx.call.auth.verifyToken({ token: '...' })
 */
export async function verifyToken(input: { token: string }) {
  // In a real app, this would verify the JWT
  return {
    valid: input.token.length > 0,
    userId: 1,
  };
}
`;
  }

  // JavaScript version
  return `/**
 * POST /auth — Authenticate a user
 * @param {import('fastworker-js').FastworkerContext} ctx
 */
export async function POST(ctx) {
  const body = await ctx.req.json();

  // Example: call the users module via RPC to verify the user exists
  const userExists = await ctx.call.users.exists({ id: 1 });

  if (!userExists) {
    return new Response(JSON.stringify({ error: 'User not found' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({
    token: 'example-jwt-token',
    user: { email: body.email },
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Verify a JWT token.
 * Called by other modules: await ctx.call.auth.verifyToken({ token: '...' })
 */
export async function verifyToken(input) {
  return {
    valid: input.token.length > 0,
    userId: 1,
  };
}
`;
}

// ─── Template: tsconfig.json ───────────────────────────────────────────────────

function genTsconfig(): string {
  const config = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ES2022',
      moduleResolution: 'bundler',
      lib: ['ES2022'],
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      resolveJsonModule: true,
      isolatedModules: true,
      noEmit: true,
    },
    include: ['modules/**/*', 'fastworker.config.ts', 'types.ts'],
  };

  return JSON.stringify(config, null, 2) + '\n';
}

// ─── Template: wrangler.toml ───────────────────────────────────────────────────

function genWranglerToml(opts: ScaffoldOptions): string {
  return `# Cloudflare Workers configuration
# Docs: https://developers.cloudflare.com/workers/wrangler/configuration/

name = "${opts.projectName}"
main = "./dist/index.js"
compatibility_date = "2024-01-01"
compatibility_flags = ["nodejs_compat"]
`;
}

// ─── Template: .dev.vars (Cloudflare local env) ────────────────────────────────

function genDevVars(): string {
  return `# Local development environment variables (Cloudflare adapter)
# These are available via ctx.env in your api.ts handlers
# For production, use: wrangler secret put SECRET_NAME

DB_URL=postgresql://localhost:5432/myapp
API_KEY=dev-api-key-change-me
`;
}

// ─── Template: .env (Node.js local env) ────────────────────────────────────────

function genDotEnv(): string {
  return `# Local development environment variables (Node adapter)
# These are available via ctx.env in your api.ts handlers
# For production, set via your platform's env config

DB_URL=postgresql://localhost:5432/myapp
API_KEY=dev-api-key-change-me
PORT=3000
`;
}

// ─── Template: .gitignore ──────────────────────────────────────────────────────

function genGitignore(): string {
  return `# Dependencies
node_modules/

# Build output
dist/
.fastworker/

# Environment variables (secrets!)
.dev.vars
.env
.env.local

# OS
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/
*.swp
*.swo
`;
}

// ─── Template: types.ts ────────────────────────────────────────────────────────

function genTypesTs(): string {
  return `/**
 * Shared module type map for the project.
 * Enforces strict type safety across RPC calls via ctx.call.
 */

import type * as UsersModule from './modules/users/api.js';
import type * as AuthModule from './modules/auth/api.js';

export interface Modules {
  users: typeof UsersModule;
  auth: typeof AuthModule;
}
`;
}
