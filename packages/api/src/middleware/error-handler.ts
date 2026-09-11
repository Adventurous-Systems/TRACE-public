import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { isTraceError } from '@trace/core';

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  // Known application errors (TraceError and subclasses)
  if (isTraceError(error)) {
    void reply.status(error.statusCode).send({
      success: false,
      error: { code: error.code, message: error.message },
    });
    return;
  }

  // Zod validation errors (from manual .parse() calls in route handlers)
  if (error instanceof ZodError) {
    void reply.status(400).send({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        issues: error.errors,
      },
    });
    return;
  }

  // Fastify built-in client errors (404, 405, etc.)
  // FastifyError always has statusCode and code as per @fastify/types
  const statusCode = error.statusCode ?? 500;

  if (statusCode < 500) {
    void reply.status(statusCode).send({
      success: false,
      error: { code: error.code, message: error.message },
    });
    return;
  }

  // Unexpected server errors — log full error, return generic message
  request.log.error({ err: error }, 'Unhandled server error');
  void reply.status(500).send({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
  });
}
