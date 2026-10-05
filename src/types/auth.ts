import type { UserId } from './customer.js';

export type AuthIdentity = {
  readonly userId: UserId;
  readonly role: string;
};

export type AuthContext = AuthIdentity & {
  readonly token: string;
};

export interface AuthValidator {
  validateToken(token: string): Promise<AuthIdentity | null>;
}
