/**
 * Consistent, machine-readable API errors (`04_DATABASE_API_SPEC` §7).
 * Never exposes stack traces, SQL, or provider internals to callers.
 */

export type ApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'link_phone_conflict'
  | 'gone'
  | 'validation_failed'
  | 'consent_required'
  | 'agent_required'
  | 'idempotency_in_progress'
  | 'delivery_in_progress'
  | 'rate_limited'
  | 'call_limit_reached'
  | 'test_call_limit_reached'
  | 'service_unavailable'
  | 'closed_in_ats'
  | 'zoho_not_connected'
  | 'internal';

const STATUS: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  link_phone_conflict: 409,
  gone: 410,
  validation_failed: 422,
  consent_required: 422,
  agent_required: 409,
  idempotency_in_progress: 409,
  delivery_in_progress: 409,
  rate_limited: 429,
  call_limit_reached: 429,
  test_call_limit_reached: 429,
  service_unavailable: 503,
  closed_in_ats: 409,
  zoho_not_connected: 409,
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
  /** Extra machine-readable context, sent as `details` (e.g. `resetsAt`). */
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    code: ApiErrorCode,
    message: string,
    fields?: readonly FieldError[],
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.code = code;
    this.status = STATUS[code];
    this.fields = fields;
    this.details = details;
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
  static consentRequired(): ApiError {
    return new ApiError('consent_required', 'Candidate consent is required: send "consent": true');
  }
  static agentRequired(): ApiError {
    return new ApiError(
      'agent_required',
      'Pass an agent, or publish exactly one hiring agent to link automatically',
    );
  }
  static validation(fields: readonly FieldError[]): ApiError {
    const message = fields[0]?.message?.trim() || 'Validation failed';
    return new ApiError('validation_failed', message, fields);
  }
}
