export class TraceError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(message: string, code: string, statusCode: number) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    // Maintains proper stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export class NotFoundError extends TraceError {
  constructor(resource: string, id?: string) {
    super(id ? `${resource} '${id}' not found` : `${resource} not found`, 'NOT_FOUND', 404);
  }
}

export class UnauthorizedError extends TraceError {
  constructor(message = 'Authentication required') {
    super(message, 'UNAUTHORIZED', 401);
  }
}

export class ForbiddenError extends TraceError {
  constructor(message = 'Insufficient permissions') {
    super(message, 'FORBIDDEN', 403);
  }
}

export class ValidationError extends TraceError {
  public readonly issues?: unknown;

  constructor(message: string, issues?: unknown) {
    super(message, 'VALIDATION_ERROR', 400);
    this.issues = issues;
  }
}

export class ConflictError extends TraceError {
  constructor(message: string) {
    super(message, 'CONFLICT', 409);
  }
}

export class BlockchainError extends TraceError {
  public readonly txHash?: string;

  constructor(message: string, txHash?: string) {
    super(message, 'BLOCKCHAIN_ERROR', 502);
    if (txHash !== undefined) this.txHash = txHash;
  }
}

export class InternalError extends TraceError {
  constructor(message = 'An unexpected error occurred') {
    super(message, 'INTERNAL_ERROR', 500);
  }
}

export function isTraceError(error: unknown): error is TraceError {
  return error instanceof TraceError;
}
