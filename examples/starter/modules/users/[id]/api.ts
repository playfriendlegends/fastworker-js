import type { FastworkerContext } from 'fastworker-js';
import type { Modules } from '../../../types.js';

/**
 * GET /users/:id — Get a single user by ID
 */
export async function GET(ctx: FastworkerContext<Modules>) {
  const userId = Number(ctx.params.id);

  if (isNaN(userId)) {
    return new Response(JSON.stringify({ error: 'Invalid user ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Use the RPC function from the parent users module
  const user = await ctx.call.users.getProfile({ id: userId });

  return new Response(JSON.stringify({ user }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * PUT /users/:id — Update a user
 */
export async function PUT(ctx: FastworkerContext<Modules>) {
  const userId = Number(ctx.params.id);
  const body = (await ctx.req.json()) as { name?: string; email?: string };

  return new Response(
    JSON.stringify({
      user: { id: userId, ...body },
      message: 'User updated',
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

/**
 * DELETE /users/:id — Delete a user
 */
export async function DELETE(ctx: FastworkerContext<Modules>) {
  const userId = Number(ctx.params.id);

  // Verify the user exists before deleting
  const userExists = await ctx.call.users.exists({ id: userId });

  if (!userExists) {
    return new Response(JSON.stringify({ error: 'User not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ message: `User ${userId} deleted` }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
