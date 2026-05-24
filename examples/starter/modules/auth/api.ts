import type { FastworkerContext } from 'fastworker-js';
import type { Modules } from '../../types.js';

/**
 * POST /auth — Authenticate a user
 */
export async function POST(ctx: FastworkerContext<Modules>) {
  const body = (await ctx.req.json()) as { email: string; password: string };

  // Cross-module RPC: verify the user exists via the users module
  const userExists = await ctx.call.users.exists({ id: 1 });

  if (!userExists) {
    return new Response(JSON.stringify({ error: 'User not found' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // In a real app: verify password hash, generate JWT, etc.
  return new Response(
    JSON.stringify({
      token: 'eyJhbGciOiJIUzI1NiJ9.example-token',
      user: { email: body.email },
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

// ─── RPC Functions ─────────────────────────────────────────────────────────────

/**
 * Verify a JWT token.
 * Called by other modules: await ctx.call.auth.verifyToken({ token: '...' })
 */
export async function verifyToken(input: { token: string }) {
  // In a real app, this would decode and verify the JWT
  return {
    valid: input.token.length > 0,
    userId: 1,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  };
}

/**
 * Refresh an existing token.
 * Called by other modules: await ctx.call.auth.refreshToken({ token: '...' })
 */
export async function refreshToken(input: { token: string }) {
  const verification = await verifyToken(input);

  if (!verification.valid) {
    throw new Error('Invalid token — cannot refresh');
  }

  return {
    token: 'eyJhbGciOiJIUzI1NiJ9.refreshed-token',
    expiresAt: new Date(Date.now() + 7200_000).toISOString(),
  };
}
