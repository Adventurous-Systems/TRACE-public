import type { FastifyInstance, FastifyReply } from 'fastify';
import { LoginSchema, RegisterSchema, type JwtPayload } from '@trace/core';
import { authenticate, optionalUser } from '../../middleware/auth.js';
import { env } from '../../env.js';
import { sessionCookie, sessionCookieOptions } from '../../lib/session-cookie.js';
import { loginUser, registerUser } from './auth.service.js';

const LOGIN_RATE_LIMIT = { max: 10, timeWindow: '1 minute' } as const;
const REGISTER_RATE_LIMIT = { max: 20, timeWindow: '1 hour' } as const;
const SESSION_COOKIE = sessionCookie(env.WEB_URL);

/**
 * Signs the session token and sets it as the browser's session cookie, which
 * lives exactly as long as the token (D2: JWT_EXPIRY, fixed). The token is
 * also returned in the body for scripts and probes, which send it as Bearer;
 * the web client ignores it.
 */
function startSession(app: FastifyInstance, reply: FastifyReply, payload: JwtPayload): string {
  const token = app.jwt.sign(payload);
  const { iat, exp } = app.jwt.decode<JwtPayload>(token) ?? {};
  const maxAge = iat !== undefined && exp !== undefined ? exp - iat : undefined;
  void reply.setCookie(SESSION_COOKIE.name, token, sessionCookieOptions(SESSION_COOKIE, maxAge));
  return token;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/v1/auth/login
  app.post('/login', { config: { rateLimit: LOGIN_RATE_LIMIT } }, async (request, reply) => {
    const input = LoginSchema.parse(request.body);
    const payload = await loginUser(input);
    const token = startSession(app, reply, payload);

    return reply.send({
      success: true,
      data: {
        token,
        user: {
          id: payload.sub,
          email: payload.email,
          role: payload.role,
          organisationId: payload.organisationId ?? null,
        },
      },
    });
  });

  // POST /api/v1/auth/register
  app.post('/register', { config: { rateLimit: REGISTER_RATE_LIMIT } }, async (request, reply) => {
    const input = RegisterSchema.parse(request.body);
    const payload = await registerUser(input);
    const token = startSession(app, reply, payload);

    return reply.status(201).send({
      success: true,
      data: {
        token,
        user: {
          id: payload.sub,
          email: payload.email,
          role: payload.role,
          organisationId: payload.organisationId ?? null,
        },
      },
    });
  });

  // POST /api/v1/auth/logout
  // Ends this browser's session only (D3): clears the cookie. It needs no
  // valid session, so signing out always works. Ending every session a user
  // holds is a token_version bump (credential changes; "sign out everywhere"
  // comes with M4a).
  app.post('/logout', async (_request, reply) => {
    void reply.clearCookie(SESSION_COOKIE.name, sessionCookieOptions(SESSION_COOKIE));
    return reply.send({ success: true });
  });

  // GET /api/v1/auth/session
  // The web's session check: the signed-in user, or null. Never a 401, so a
  // page an anonymous visitor opens logs no error in their console.
  app.get('/session', async (request, reply) => {
    const user = await optionalUser(request);
    return reply.send({
      success: true,
      data: user
        ? {
            id: user.sub,
            email: user.email,
            role: user.role,
            organisationId: user.organisationId ?? null,
          }
        : null,
    });
  });

  // GET /api/v1/auth/me
  app.get('/me', { preHandler: [authenticate] }, async (request, reply) => {
    return reply.send({
      success: true,
      data: {
        id: request.user.sub,
        email: request.user.email,
        role: request.user.role,
        organisationId: request.user.organisationId ?? null,
      },
    });
  });
}
