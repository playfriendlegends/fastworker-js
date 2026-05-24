import type { FastworkerContext } from 'fastworker-js';
import type { User, CreateUserInput } from './schema.js';

/**
 * GET /users — List all users
 */
export async function GET(ctx: FastworkerContext) {
  // In a real app: const users = await db.query('SELECT * FROM users');
  const users: User[] = [
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
export async function POST(ctx: FastworkerContext) {
  const body = (await ctx.req.json()) as CreateUserInput;

  // Access environment variables via ctx.env
  const dbUrl = ctx.env.DB_URL as string;
  console.log(`[users] Creating user with DB: ${dbUrl}`);

  const newUser: User = {
    id: Date.now(),
    name: body.name,
    email: body.email,
  };

  return new Response(JSON.stringify({ user: newUser }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── RPC Functions ─────────────────────────────────────────────────────────────
// These are callable by other modules via ctx.call.users.functionName()
// They are NOT HTTP endpoints — only api.ts exports named GET/POST/etc. are routes.

/**
 * Get a user profile by ID.
 *
 * @example
 * // From billing/api.ts:
 * const user = await ctx.call.users.getProfile({ id: 123 });
 */
export async function getProfile(input: { id: number }): Promise<User> {
  // In a real app, query the database
  return {
    id: input.id,
    name: 'Alice',
    email: 'alice@example.com',
  };
}

/**
 * Check if a user exists by ID.
 *
 * @example
 * const exists = await ctx.call.users.exists({ id: 123 });
 */
export async function exists(input: { id: number }): Promise<boolean> {
  return input.id > 0;
}

/**
 * Get a user's display name.
 */
export async function getDisplayName(input: { id: number }): Promise<string> {
  const profile = await getProfile(input);
  return profile.name;
}
