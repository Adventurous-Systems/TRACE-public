import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db, users } from '@trace/db';
import {
  UnauthorizedError,
  ConflictError,
  TooManyRequestsError,
  type LoginInput,
  type RegisterInput,
  type JwtPayload,
  type UserRole,
} from '@trace/core';
import { clearFailedLogins, recordFailedLogin } from './login-backoff.js';

export async function loginUser(input: LoginInput): Promise<JwtPayload> {
  const user = await db.query.users.findFirst({
    where: eq(users.email, input.email.toLowerCase()),
  });

  // D5: an account in its wait is refused before the password is checked,
  // whether it is right or not.
  const waitMs = user?.loginBackoffUntil ? user.loginBackoffUntil.getTime() - Date.now() : 0;
  if (waitMs > 0) {
    const minutes = Math.ceil(waitMs / 60_000);
    throw new TooManyRequestsError(
      `Too many failed sign-ins for this account. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      Math.ceil(waitMs / 1000),
    );
  }

  // Constant-time comparison path — always check hash to prevent timing attacks
  // Valid bcrypt hash for a known dummy string; keeps compare path constant-time.
  const dummyHash = '$2b$10$02xnKRdR3biWegV7liWi7.Lwo5N9ozmh/MGhPxCfM/I2x6lmUpJMW';
  const passwordToCheck = user?.passwordHash ?? dummyHash;
  const valid = await bcrypt.compare(input.password, passwordToCheck);

  if (!user || !valid) {
    if (user) await recordFailedLogin(user.id);
    throw new UnauthorizedError('Invalid email or password');
  }

  if (user.failedLoginCount > 0 || user.loginBackoffUntil) await clearFailedLogins(user.id);
  return buildPayload(user);
}

export async function registerUser(input: RegisterInput): Promise<JwtPayload> {
  const existing = await db.query.users.findFirst({
    where: eq(users.email, input.email.toLowerCase()),
  });

  if (existing) {
    throw new ConflictError('An account with this email already exists');
  }

  const passwordHash = await bcrypt.hash(input.password, 10);

  const [user] = await db
    .insert(users)
    .values({
      email: input.email.toLowerCase(),
      passwordHash,
      name: input.name,
      role: 'buyer',
      organisationId: null,
    })
    .returning();

  return buildPayload(user!);
}

export function buildPayload(user: {
  id: string;
  email: string;
  role: string;
  organisationId: string | null;
  tokenVersion: number;
}): JwtPayload {
  return {
    sub: user.id,
    email: user.email,
    role: user.role as UserRole,
    ...(user.organisationId !== null ? { organisationId: user.organisationId } : {}),
    tv: user.tokenVersion,
  };
}
