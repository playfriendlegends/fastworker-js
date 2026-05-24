import type { FastworkerContext } from 'fastworker-js';
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
