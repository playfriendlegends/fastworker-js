import type { FastworkerContext } from 'fastworker-js';
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
