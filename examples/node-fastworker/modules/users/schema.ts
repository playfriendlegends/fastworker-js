/**
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
