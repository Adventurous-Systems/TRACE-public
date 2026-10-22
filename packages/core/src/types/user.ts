export type UserRole =
  | 'platform_admin'
  | 'hub_admin'
  | 'hub_staff'
  | 'supplier'
  | 'buyer'
  | 'inspector';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  organisationId?: string;
  blockchainAddress?: string;
  notificationPrefs?: Record<string, unknown>;
  createdAt: Date;
}

export interface JwtPayload {
  sub: string; // user id
  email: string;
  role: UserRole;
  organisationId?: string;
  /** The user's token_version when the token was signed; a stale one is refused. */
  tv?: number;
  iat?: number;
  exp?: number;
}
