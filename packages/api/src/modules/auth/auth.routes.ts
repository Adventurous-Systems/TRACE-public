import type { FastifyInstance } from 'fastify';
import { LoginSchema, RegisterSchema } from '@trace/core';
import { authenticate } from '../../middleware/auth.js';
import { loginUser, registerUser } from './auth.service.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/v1/auth/login
  app.post('/login', async (request, reply) => {
    const input = LoginSchema.parse(request.body);
    const payload = await loginUser(input);
    const token = app.jwt.sign(payload);

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
  app.post('/register', async (request, reply) => {
    const input = RegisterSchema.parse(request.body);
    const payload = await registerUser(input);
    const token = app.jwt.sign(payload);

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
