import Fastify from 'fastify';
import { expect, it } from 'vitest';
import { LoginSchema } from '@trace/core';
import { errorHandler } from './error-handler.js';

it('preserves the HTTP validation envelope and issue paths with Zod 4', async () => {
  const app = Fastify({ logger: false });
  app.setErrorHandler(errorHandler);
  app.post('/validation-fixture', (request) => LoginSchema.parse(request.body));
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/validation-fixture',
      payload: { email: 'invalid', password: 'short' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        issues: [
          { path: ['email'], message: expect.any(String) },
          { path: ['password'], message: expect.any(String) },
        ],
      },
    });
    // Rejected values are not echoed back to the client.
    expect(response.json().error.issues[0]).not.toHaveProperty('input');
  } finally {
    await app.close();
  }
});
