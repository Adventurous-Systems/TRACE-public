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
  iat?: number;
  exp?: number;
}
