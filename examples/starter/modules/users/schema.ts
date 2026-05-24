/**
 * User schema — colocated with the users module.
 *
 * This file demonstrates colocation: it lives alongside api.ts but
 * is NOT a route. Only files named exactly "api.ts" become API routes.
 * You can colocate schemas, utilities, tests, constants — anything.
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

export interface UserProfile extends User {
  bio?: string;
  avatarUrl?: string;
}
