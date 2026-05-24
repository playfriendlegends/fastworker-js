import type { FastworkerContext } from 'fastworker-js';
import type { Modules } from '../../types.js';

/**
 * GET /billing — Get billing summary for the authenticated user
 */
export async function GET(ctx: FastworkerContext<Modules>) {
  // Cross-module RPC: get the user's profile from the users module
  // In microservices mode, this call is routed through Service Bindings
  // or HTTP fetch — completely transparent to this code.
  const user = await ctx.call.users.getProfile({ id: 1 });

  // Cross-module RPC: verify the auth token
  const auth = await ctx.call.auth.verifyToken({
    token: ctx.req.headers.get('Authorization') ?? '',
  });

  return new Response(
    JSON.stringify({
      user,
      auth,
      billing: {
        plan: 'pro',
        balance: 42.50,
        currency: 'USD',
        invoices: [
          { id: 'inv_001', amount: 29.99, status: 'paid', date: '2024-01-15' },
          { id: 'inv_002', amount: 12.51, status: 'pending', date: '2024-02-15' },
        ],
      },
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

/**
 * POST /billing — Create a new invoice
 */
export async function POST(ctx: FastworkerContext<Modules>) {
  const body = (await ctx.req.json()) as { userId: number; amount: number };

  // Verify the user exists before creating an invoice
  const userExists = await ctx.call.users.exists({ id: body.userId });
  if (!userExists) {
    return new Response(JSON.stringify({ error: 'User not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const invoice = {
    id: `inv_${Date.now()}`,
    userId: body.userId,
    amount: body.amount,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  return new Response(JSON.stringify({ invoice }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── RPC Functions ─────────────────────────────────────────────────────────────

/**
 * Get billing status for a user.
 * Called by other modules: await ctx.call.billing.getStatus({ userId: 123 })
 */
export async function getStatus(input: { userId: number }) {
  return {
    userId: input.userId,
    plan: 'pro',
    isActive: true,
    balance: 42.50,
  };
}
