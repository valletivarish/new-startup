/**
 * Every failure becomes words a person can act on (spec §2.7, §4).
 * Server text is shown only when it is plain: anything carrying a vendor name,
 * a config token, a URL, an API path or a raw code is replaced by our own sentence.
 */

import { shortRef } from './format';

export interface FieldError {
  field: string;
  message: string;
}

/** The API's error envelope: `{ code, message, request_id, errors? }`. */
export interface ApiFailure {
  readonly code: string;
  readonly message: string;
  readonly request_id?: string;
  readonly errors?: readonly FieldError[];
}

export type ErrorAction = 'retry' | 'sign_in' | 'contact_admin' | 'fix_input' | null;

export interface UserMessage {
  title: string;
  detail: string;
  action: ErrorAction;
  /** Short reference support can search for. Server errors only. */
  supportRef?: string;
  /** Validation errors, scrubbed, for the form to place next to its fields. */
  fieldErrors?: FieldError[];
}

export class ApiClientError extends Error {
  readonly code: string;
  /** HTTP status. 0 means the request never reached the server. */
  readonly status: number;
  readonly requestId: string | null;
  /** Raw server text, for logs only. `message` is the sentence safe to show. */
  readonly serverMessage: string;
  readonly fieldErrors: readonly FieldError[];

  constructor(status: number, failure: ApiFailure) {
    super();
    this.name = 'ApiClientError';
    this.status = status;
    this.code = typeof failure.code === 'string' ? failure.code : '';
    this.requestId = typeof failure.request_id === 'string' ? failure.request_id : null;
    this.serverMessage = typeof failure.message === 'string' ? failure.message : '';
    // Only well-formed items: a body like {"errors":[null]} must not throw from here.
    this.fieldErrors = Array.isArray(failure.errors)
      ? failure.errors.filter(
          (f): f is FieldError =>
            typeof f === 'object' && f !== null && typeof (f as FieldError).field === 'string',
        )
      : [];
    this.message = messageText(toUserMessage(this));
  }
}

/** The backend doesn't have this route yet (404 "Not found" or 405 on an endpoint marked optional). Fall back. */
export class NotAvailableError extends ApiClientError {
  constructor(status: number, failure: ApiFailure) {
    super(status, failure);
    this.name = 'NotAvailableError';
  }
}

const VENDOR =
  /\b(?:eleven[\s-]?labs|11\s?labs|exotel|gemini|sarvam|deepgram|cartesia|plivo|twilio|open ?ai|anthropic|google|claude|gpt|azure|aws|postgres(?:ql)?|redis)\b/i;
// Config-looking tokens only: ELEVENLABS_ENABLED, API_KEY, FOO=. Plain caps like PDF or DOCX stay.
const CONFIG_TOKEN = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b|\b[A-Z][A-Z0-9_]{3,}=/;
const URL_LIKE = /\b(?:https?:\/\/|www\.)\S+/i;
const PATH_LIKE = /(?:^|[\s("'`])\/[\w.:{}-]+/;
const RAW_CODE = /\b[a-z]+_[a-z0-9_]+\b/;
const CODE_LEAK =
  /[{}<>]|\b(?:\w*exception|stack|undefined|null|nan|sql|json|payload|request body|provider|llm|sdk|webhook|api key|token)\b|\w+Error\b/i;
// Dotted package or class paths (java.lang.String), stack frames (JobService.java:42),
// IP addresses with ports, and errno codes.
const DOTTED_PATH = /\b[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*){2,}/i;
const STACK_FRAME = /\.(?:java|kt|ts|js|py):\d+/;
const IP_ADDRESS = /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/;
const ERRNO = /\bE(?:CONNREFUSED|CONNRESET|TIMEDOUT|NOTFOUND|AI_AGAIN|HOSTUNREACH|PIPE)\b/;
const GENERIC =
  /something went wrong|request failed|^(?:validation failed|internal server error|internal error|not found|bad request|unauthori[sz]ed|forbidden|you do not have permission to do this|authentication required|error|failed|unknown error|an error occurred|service unavailable|bad gateway|gateway timeout)\.?$/i;
const UNUSABLE = [
  VENDOR,
  CONFIG_TOKEN,
  URL_LIKE,
  PATH_LIKE,
  RAW_CODE,
  CODE_LEAK,
  DOTTED_PATH,
  STACK_FRAME,
  IP_ADDRESS,
  ERRNO,
  GENERIC,
];

/** Server text as a sentence, or null when it isn't fit to show (vendor, config, URL, path, code, vague). */
export function plainServerText(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  // Apostrophes curl, as in our own words: "can't" reads "can’t".
  const t = text.trim().replace(/(\w)'(\w)/g, '$1’$2');
  if (!t || t.length > 240 || UNUSABLE.some((re) => re.test(t))) return null;
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/** Title and detail as one line, for a form error or a toast with no description. */
export function messageText(m: Pick<UserMessage, 'title' | 'detail'>): string {
  return `${m.title}. ${m.detail}`;
}

const UNTRUSTED_ADDRESS = 'Sign-in isn’t set up for this web address';
const OPEN_USUAL_ADDRESS = 'Open the app from its usual address, then try again.';

// Better Auth codes (`/api/auth/*`) that deserve their own words. Titles are headings: no full stop.
const KNOWN_CODES: Record<string, [title: string, detail: string, action: ErrorAction]> = {
  INVALID_EMAIL_OR_PASSWORD: ['Email or password is wrong', 'Check both, or reset your password.', 'fix_input'],
  USER_ALREADY_EXISTS: ['An account already exists for this email', 'Sign in instead, or use a different email.', 'sign_in'],
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: ['An account already exists for this email', 'Sign in instead, or use a different email.', 'sign_in'],
  INVALID_EMAIL: ['That email address doesn’t look right', 'Check it, then try again.', 'fix_input'],
  PASSWORD_TOO_SHORT: ['That password is too short', 'Use at least 8 characters.', 'fix_input'],
  PASSWORD_TOO_LONG: ['That password is too long', 'Use 128 characters or fewer.', 'fix_input'],
  INVALID_TOKEN: ['This link has expired', 'Request a new one.', null],
  // The sign-in server refuses a request from, or a link back to, a web address it doesn't trust:
  // a setup problem, never a missing permission.
  INVALID_ORIGIN: [UNTRUSTED_ADDRESS, OPEN_USUAL_ADDRESS, null],
  INVALID_CALLBACK_URL: [UNTRUSTED_ADDRESS, OPEN_USUAL_ADDRESS, null],
};

function isNetworkFailure(error: unknown): boolean {
  if (error instanceof ApiClientError) return error.status === 0;
  return error instanceof TypeError && /fetch|network|load failed/i.test(error.message);
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** Worth retrying automatically: no connection or a server-side failure. Never a 4xx. */
export function isRetryable(error: unknown): boolean {
  if (error instanceof ApiClientError) return error.status === 0 || error.status >= 500;
  return isNetworkFailure(error);
}

/**
 * @param context what the person was doing, as a verb phrase after "Couldn’t":
 *   `toUserMessage(e, 'load candidates')` gives "Couldn’t load candidates" as the title.
 * Titles are headings, with no full stop; details are sentences. messageText joins them.
 */
export function toUserMessage(error: unknown, context?: string): UserMessage {
  const failed = context ? `Couldn’t ${context}` : null;
  // With a context, the title names what failed; `keepTitle` says whether our title still
  // explains why (then it leads the detail) or is a generic heading the context replaces.
  const say = (
    title: string,
    detail: string,
    action: ErrorAction,
    keepTitle: boolean,
    extra?: Pick<UserMessage, 'supportRef' | 'fieldErrors'>,
  ): UserMessage => ({
    title: failed ?? title,
    detail: failed && keepTitle ? `${title}. ${detail}` : detail,
    action,
    ...extra,
  });

  // Only a request that never arrived is a connection problem. A response with a status came
  // from the server, so its meaning (and its field errors) stands even if the browser is offline now.
  if (isNetworkFailure(error)) {
    return say(
      isOffline() ? 'You’re offline' : 'The server can’t be reached right now',
      'Check your connection, then retry.',
      'retry',
      true,
    );
  }
  if (!(error instanceof ApiClientError)) {
    return say('That didn’t go through', 'Try again. If it keeps happening, reload the page.', 'retry', false);
  }
  if (error instanceof NotAvailableError) {
    return say('This isn’t available yet', 'This part of the product isn’t switched on yet.', null, false);
  }

  const known = Object.hasOwn(KNOWN_CODES, error.code) ? KNOWN_CODES[error.code] : undefined;
  if (known) return say(known[0], known[1], known[2], true);

  const { status } = error;
  const serverText = plainServerText(error.serverMessage) ?? plainServerText(error.fieldErrors[0]?.message);

  if (status === 400 || status === 422) {
    const fieldErrors = error.fieldErrors.map((f) => ({
      field: f.field,
      message: plainServerText(f.message) ?? 'Check this field.',
    }));
    const detail =
      serverText ??
      (fieldErrors.length ? 'Fix the highlighted fields, then try again.' : 'Check what you entered, then try again.');
    return say('Some details need fixing', detail, 'fix_input', false, { fieldErrors });
  }
  if (status === 401) return say('Your session ended', 'Sign in to continue.', 'sign_in', true);
  if (status === 403) {
    // The server's own reason when it gives one ("Only an Owner can invite an Owner").
    return serverText
      ? say('You don’t have access to this', serverText, 'contact_admin', false)
      : say('You don’t have access to this', 'Ask a workspace admin.', 'contact_admin', true);
  }
  if (status === 404) {
    return say('We couldn’t find that', 'It may have been removed, or the link is out of date.', null, false);
  }
  if (status === 409) {
    return say(
      'That didn’t go through',
      serverText ?? 'It changed since you opened it. Reload the page, then try again.',
      null,
      false,
    );
  }
  if (status === 410) return say('This link is no longer valid', serverText ?? 'Ask for a new one.', null, true);
  if (status === 413) return say('That file is too large', 'The limit is 10 MB.', 'fix_input', true);
  if (status === 429) return say('Too many attempts', 'Wait a minute, then try again.', 'retry', true);
  if (status >= 500) {
    const supportRef = error.requestId ? shortRef(error.requestId) : undefined;
    const title = supportRef ? `Something failed on our side (ref ${supportRef})` : 'Something failed on our side';
    return say(title, 'Retry in a minute.', 'retry', true, supportRef ? { supportRef } : undefined);
  }
  return say('That didn’t go through', serverText ?? 'Reload the page, then try again.', 'retry', false);
}
