/**
 * Shared module type map for the project.
 * Enforces strict type safety across RPC calls via ctx.call.
 */

import type * as UsersModule from './modules/users/api.js';
import type * as AuthModule from './modules/auth/api.js';

export interface Modules {
  users: typeof UsersModule;
  auth: typeof AuthModule;
}
