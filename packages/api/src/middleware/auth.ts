import type { FastifyRequest, FastifyReply } from 'fastify';
import { UnauthorizedError, ForbiddenError } from '@trace/core';
import type { JwtPayload, UserRole } from '@trace/core';

/**
 * Verifies the JWT and populates request.user.
 * Use as a preHandler on routes that require authentication.
 */
export async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    throw new UnauthorizedError('Invalid or expired token');
  }
}

/**
 * The signed-in user, if the request carries a valid token; undefined for
 * anyone else. For public routes that show more to some readers.
 */
export async function optionalUser(request: FastifyRequest): Promise<JwtPayload | undefined> {
  try {
    await request.jwtVerify();
    return request.user;
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
