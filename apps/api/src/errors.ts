/**
 * Consistent, machine-readable API errors (`04_DATABASE_API_SPEC` §7).
 * Never exposes stack traces, SQL, or provider internals to callers.
 */

export type ApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'gone'
  | 'validation_failed'
  | 'rate_limited'
  | 'internal';

const STATUS: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  gone: 410,
  validation_failed: 422,
  rate_limited: 429,
  internal: 500,
};

export interface FieldError {
  readonly field: string;
  readonly message: string;
}

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly fields: readonly FieldError[] | undefined;

  constructor(code: ApiErrorCode, message: string, fields?: readonly FieldError[]) {
    super(message);
    this.code = code;
    this.status = STATUS[code];
    this.fields = fields;
  }

  static unauthorized(message = 'Authentication required'): ApiError {
    return new ApiError('unauthorized', message);
  }
  static forbidden(message = 'You do not have permission to do this'): ApiError {
    return new ApiError('forbidden', message);
  }
  /**
   * Cross-tenant probes and genuinely missing resources produce the identical
   * response, so existence cannot be inferred from an id (IDOR hygiene).
   */
  static notFound(resource = 'Resource'): ApiError {
    return new ApiError('not_found', `${resource} not found`);
  }
  static conflict(message: string): ApiError {
    return new ApiError('conflict', message);
  }
  static gone(message: string): ApiError {
    return new ApiError('gone', message);
  }
  static validation(fields: readonly FieldError[]): ApiError {
    const message = fields[0]?.message?.trim() || 'Validation failed';
    return new ApiError('validation_failed', message, fields);
  }
}
