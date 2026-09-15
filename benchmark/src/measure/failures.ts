/**
 * Failure accounting and the retry policy.
 *
 * TWO RULES, both learned from defects:
 *
 *  1. A failure gate expressed as a RATE is unreachable at benchmark sample
 *     sizes. At 30 turns the resolution is 1/30 = 3.3%, so a 2% threshold
 *     fails a stack for one transient 429 — network weather, not provider
 *     quality. Failures are therefore counted, and the denominator is stated.
 *
 *  2. Retries must never hide failures. A turn that succeeded only after two
 *     retries is recorded as `recovered`, its retry count is kept, and its
 *     latency is EXCLUDED from the distribution — otherwise a provider that is
 *     flaky but eventually fast would look better than one that is reliably
 *     mediocre.
 */

/** Categories, so a report can say what actually went wrong. */
export type FailureCategory =
  | 'transient_transport'   // 429, 5xx, socket reset — retryable
  | 'timeout'
  | 'auth'                  // bad or missing credentials — not the provider's fault
  | 'quota'                 // free tier exhausted — stop the sweep, do not retry
  | 'malformed_response'    // provider returned something unparseable
  | 'empty_response'        // provider returned nothing at all
  | 'audio_rejected'        // provider refused the audio format
  | 'audio_not_consumed'    // adapter abandoned the paced audio before the end
  | 'client_request_error'  // 4xx from OUR malformed request — an adapter defect
  | 'response_shape_unrecognised' // 2xx we could not parse — also an adapter defect
  | 'unknown';

/**
 * A 200 OK whose body did not contain the field this adapter expected.
 *
 * Every real adapter here parses a response shape taken from documentation and
 * never exercised. A provider that answered correctly under a field name we
 * guessed wrong is OUR defect — but it used to be classified by keyword as
 * `empty_response` or `unknown` and counted against the provider. With
 * maxHardFailures at 1, TWO such responses printed a red FAIL for a service
 * that got every answer right.
 */
export class ResponseShapeError extends Error {
  constructor(provider: string, expected: string, detail?: string) {
    super(
      `${provider} returned a successful response that did not contain ${expected}. ` +
        'That is this adapter\'s parsing expectation being wrong, not the provider failing — ' +
        'the request shape was written from documentation and has never been verified against ' +
        `the live service.${detail ? ` Body: ${detail}` : ''}`,
    );
    this.name = 'ResponseShapeError';
  }
}

/**
 * Failures that are OUR fault, not the provider's.
 *
 * Every real adapter here was written from documentation and has never touched
 * the live service, so the most likely first-contact outcome is a 4xx from a
 * wrong endpoint, field name or language code. Counting that against the
 * provider would print a confident FAIL for a service whose only sin was that
 * our request shape guessed wrong.
 */
export const ADAPTER_DEFECT: ReadonlySet<FailureCategory> = new Set([
  'client_request_error',
  'response_shape_unrecognised',
]);

export interface FailureRecord {
  readonly utteranceId: string;
  readonly category: FailureCategory;
  readonly message: string;
  readonly attempts: number;
}

export interface FailureSummary {
  readonly attempted: number;
  readonly succeeded: number;
  /** Succeeded, but only after at least one retry. Excluded from latency. */
  readonly recovered: number;
  readonly failed: number;
  /** Percentage with the denominator stated so it cannot be misread. */
  readonly failureRate: number;
  readonly denominator: 'attempted_turns';
  readonly byCategory: Readonly<Record<string, number>>;
  readonly records: readonly FailureRecord[];
}

export const RETRYABLE: ReadonlySet<FailureCategory> = new Set([
  'transient_transport',
  'timeout',
]);

/**
 * Classify an error.
 *
 * `auth` and `quota` are deliberately NOT retryable: retrying a bad key just
 * burns time, and retrying past a quota wall burns money the founder does not
 * have. Both should stop the sweep, not be absorbed as provider unreliability.
 */
export function classify(error: unknown): FailureCategory {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : '';
  const lower = message.toLowerCase();
  const status = (error as { status?: number }).status;

  // A missing credential is a setup problem. Its message names an env var, which
  // matches none of the keyword patterns below, so without this it was absorbed
  // as N "unknown" provider failures and printed as a FAIL for a provider that
  // was never contacted.
  if (name === 'MissingCredentialsError') return 'auth';
  // Classified by NAME, not by keyword: its message mentions "audio frames",
  // which the audio-format pattern below would otherwise claim.
  if (name === 'AudioNotConsumedError') return 'audio_not_consumed';
  // By NAME, before the keyword ladder: these messages mention transcripts and
  // audio, which the keyword rules below would claim as provider failures.
  if (name === 'ResponseShapeError') return 'response_shape_unrecognised';
  if (name === 'ProviderRefusedError') return 'empty_response';

  // STATUS FIRST, in specificity order. Keyword matching on a provider's own
  // error body is a last resort: a 429 body reading "you have exceeded your
  // rate limit" would otherwise match the quota pattern and abort the sweep.
  if (status === 401 || status === 403) return 'auth';
  if (status === 402) return 'quota';
  if (status === 408 || status === 504) return 'timeout';
  if (status === 429) {
    // VERIFIED against Google's documented error table on 2026-08-24: the
    // Gemini API returns 429 for BOTH `rate_limit_exceeded` (per-minute, and
    // genuinely transient) AND `quota_exceeded` ("you have exceeded your daily
    // quota", which is a wall). It publishes no 402 at all, so the status code
    // alone cannot tell them apart — and retrying into an exhausted daily quota
    // is exactly what this module's header says it exists to prevent.
    //
    // The body's error code is the only discriminator, so it is read here and
    // nowhere else. This is the one place a body keyword outranks a status.
    // WHAT GOOGLE ACTUALLY SENDS, per its published error envelope: an integer
    // `error.code`, the string enum `RESOURCE_EXHAUSTED` in `error.status`, and
    // a message reading "You exceeded your current quota". The per-day versus
    // per-minute distinction lives in `details[].violations[].quotaId`, whose
    // value contains `PerDay` or `PerMinute`.
    //
    // An earlier version of this branch matched `quota_exceeded`, a literal no
    // provider here emits — so a daily wall classified as retryable and the
    // sweep hammered an exhausted quota. The test that passed was checking a
    // body shape that does not exist.
    // ORDER MATTERS, and it is the opposite of what reads naturally. A
    // per-minute limit's message also says "Quota exceeded", so a generic
    // quota keyword test would stop the sweep on the most common and most
    // recoverable failure there is. The explicit per-minute signal is checked
    // FIRST and wins.
    if (/perminute|per[_ ]?minute|per[_ ]?second|requests per minute/.test(lower)) {
      return 'transient_transport';
    }
    if (/perday|per[_ ]?day|daily quota|quota[_ ]?exceeded|insufficient[_ ]?quota|billing/.test(lower)) {
      return 'quota';
    }
    // Unqualified: treat as transient. A per-minute limit is far more common
    // than a spend wall, retries are bounded, and rejected requests are not
    // billed — so the cost of guessing wrong this way is time, while guessing
    // the other way abandons a run that would have completed.
    return 'transient_transport';
  }
  if (typeof status === 'number' && status >= 500) return 'transient_transport';
  // Any other 4xx is OUR request being wrong. Audio APIs routinely say "audio",
  // "format" or "sample rate" in a 400 body, so keyword matching would file an
  // adapter defect as the provider rejecting our audio.
  if (typeof status === 'number' && status >= 400) return 'client_request_error';

  if (/unauthor|forbidden|invalid api key|api key/.test(lower)) return 'auth';
  if (/quota|insufficient (credit|balance)|payment required|exceeded your/.test(lower)) {
    return 'quota';
  }
  if (/rate.?limit|too many requests/.test(lower)) return 'transient_transport';
  if (/timeout|timed out|etimedout|abort/.test(lower)) return 'timeout';
  if (/econnreset|socket hang up|network|fetch failed|enotfound|econnrefused/.test(lower)) {
    return 'transient_transport';
  }
  if (/unexpected token|json|parse|malformed|schema/.test(lower)) return 'malformed_response';
  if (/empty|no (audio|transcript|result)/.test(lower)) return 'empty_response';
  if (/audio|codec|sample rate|format/.test(lower)) return 'audio_rejected';
  return 'unknown';
}

/**
 * The provider declined to answer — a real outcome, not our defect.
 *
 * A safety block is the provider exercising its own judgement about the input.
 * Filing it as an adapter defect would excuse the provider from a refusal it
 * actually made, and treating it as a transport failure would suggest something
 * broke. It is an empty response with a stated reason.
 */
export class ProviderRefusedError extends Error {
  constructor(provider: string, reason: string) {
    super(`${provider} refused to answer: ${reason}. This is a provider outcome, not a fault.`);
    this.name = 'ProviderRefusedError';
  }
}

export class QuotaExhaustedError extends Error {
  constructor(provider: string, detail: string) {
    super(
      `${provider} quota or credit exhausted: ${detail}. Stopping the sweep rather than ` +
        'spending past the budget. Results so far are already persisted.',
    );
    this.name = 'QuotaExhaustedError';
  }
}

export class CredentialsError extends Error {
  constructor(provider: string, detail: string) {
    super(`${provider} credentials rejected: ${detail}. This is a setup problem, not a provider result.`);
    this.name = 'CredentialsError';
  }
}

export interface RetryOutcome<T> {
  readonly value?: T;
  readonly attempts: number;
  readonly recovered: boolean;
  readonly failure?: { category: FailureCategory; message: string };
}

/**
 * Run an operation with bounded retries on transient faults only.
 *
 * `onRetry` lets the caller record the retry against the provider, so a flaky
 * provider is visible in the report rather than smoothed away.
 */
export async function withRetries<T>(
  operation: () => Promise<T>,
  options: {
    readonly maxRetries: number;
    readonly provider: string;
    readonly onRetry?: (attempt: number, category: FailureCategory) => void;
    readonly backoffMs?: (attempt: number) => number;
    readonly sleep?: (ms: number) => Promise<void>;
  },
): Promise<RetryOutcome<T>> {
  const {
    maxRetries, provider, onRetry,
    backoffMs = (attempt) => Math.min(2000, 250 * 2 ** attempt),
    sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  } = options;

  // A NaN retry budget makes `attempts > maxRetries` permanently false, which
  // is an unbounded retry loop against a rate-limited endpoint. A budget that
  // cannot be understood must stop the run, not silently become infinite.
  if (!Number.isFinite(maxRetries) || maxRetries < 0) {
    throw new Error(
      `Retry budget must be a non-negative finite number, got ${String(maxRetries)}. ` +
        'An unparseable budget would mean unbounded retries against a paid endpoint.',
    );
  }

  let attempts = 0;
  let last: { category: FailureCategory; message: string } | undefined;

  for (;;) {
    attempts += 1;
    try {
      const value = await operation();
      return { value, attempts, recovered: attempts > 1 };
    } catch (error) {
      const category = classify(error);
      const message = error instanceof Error ? error.message : String(error);
      last = { category, message };

      // Never retry a setup problem or a spend limit.
      if (category === 'auth') throw new CredentialsError(provider, message);
      if (category === 'quota') throw new QuotaExhaustedError(provider, message);

      if (!RETRYABLE.has(category) || attempts > maxRetries) {
        return { attempts, recovered: false, failure: last };
      }
      onRetry?.(attempts, category);
      await sleep(backoffMs(attempts));
    }
  }
}

export function summariseFailures(input: {
  readonly attempted: number;
  readonly succeeded: number;
  readonly recovered: number;
  readonly records: readonly FailureRecord[];
}): FailureSummary {
  const byCategory: Record<string, number> = {};
  for (const record of input.records) {
    byCategory[record.category] = (byCategory[record.category] ?? 0) + 1;
  }
  const failed = input.records.length;
  return {
    attempted: input.attempted,
    succeeded: input.succeeded,
    recovered: input.recovered,
    failed,
    failureRate: input.attempted === 0 ? 0 : failed / input.attempted,
    denominator: 'attempted_turns',
    byCategory,
    records: input.records,
  };
}
