/**
 * Shared module type map for the example project.
 *
 * In a production setup, the `fastworker build` command would auto-generate
 * this file from your modules/ directory. For now, we define it manually
 * to enable full ctx.call type inference.
 *
 * Usage:
 *   import type { Modules } from '../types';
 *   export async function GET(ctx: FastworkerContext<Modules>) { ... }
 */

import type * as UsersModule from './modules/users/api.js';
import type * as AuthModule from './modules/auth/api.js';
import type * as BillingModule from './modules/billing/api.js';

export interface Modules {
  users: typeof UsersModule;
  auth: typeof AuthModule;
  billing: typeof BillingModule;
}
