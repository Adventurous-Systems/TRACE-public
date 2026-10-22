import type { FastifyRequest, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, users } from '@trace/db';
import { UnauthorizedError, ForbiddenError } from '@trace/core';
import type { JwtPayload, UserRole } from '@trace/core';

/**
 * The session behind a request (M3a). Verifies the token (the Authorization
 * header, else the session cookie), then reads the user's row: a token whose
 * `tv` is missing or older than the row's token_version has been revoked.
 * Role and organisation come from the row, not the token, so a change to
 * either applies on the user's next request. Throws on any failure.
 */
async function loadSession(request: FastifyRequest): Promise<JwtPayload> {
  await request.jwtVerify();
  const claims = request.user;
  if (typeof claims.tv !== 'number') throw new UnauthorizedError('Invalid or expired token');

  const user = await db.query.users.findFirst({
    where: eq(users.id, claims.sub),
    columns: { email: true, role: true, organisationId: true, tokenVersion: true },
  });
  if (!user || user.tokenVersion !== claims.tv) {
    throw new UnauthorizedError('Invalid or expired token');
  }

  const session: JwtPayload = {
    ...claims,
    email: user.email,
    role: user.role as UserRole,
  };
  if (user.organisationId !== null) session.organisationId = user.organisationId;
  else delete session.organisationId;
  request.user = session;
  return session;
}

/**
 * Verifies the session and populates request.user.
 * Use as a preHandler on routes that require authentication.
 */
export async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  try {
    await loadSession(request);
  } catch {
    throw new UnauthorizedError('Invalid or expired token');
  }
}

/**
 * The signed-in user, if the request carries a valid session; undefined for
 * anyone else. For public routes that show more to some readers.
 */
export async function optionalUser(request: FastifyRequest): Promise<JwtPayload | undefined> {
  try {
    return await loadSession(request);
  } catch {
    return undefined;
  }
}

/**
 * Factory that returns a preHandler enforcing one of the given roles.
 * Must be used after `authenticate`.
 *
 * @example
 * { preHandler: [authenticate, authorize('hub_staff', 'hub_admin')] }
 */
export function authorize(...roles: UserRole[]) {
  return async function authorizationCheck(
    request: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> {
    const userRole = request.user?.role;
    if (!userRole || !roles.includes(userRole)) {
      throw new ForbiddenError(
        `Role '${userRole ?? 'unknown'}' is not permitted. Required: ${roles.join(', ')}`,
      );
    }
  };
}
