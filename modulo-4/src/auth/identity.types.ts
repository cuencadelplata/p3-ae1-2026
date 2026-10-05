export interface AuthenticatedIdentity {
  userId: number;
  role: string;
}

export interface IdentityValidator {
  validate(authorizationHeader?: string): Promise<AuthenticatedIdentity>;
}

export class AuthenticationError extends Error {}
export class AuthorizationError extends Error {}
export class IdentityServiceUnavailableError extends Error {}
