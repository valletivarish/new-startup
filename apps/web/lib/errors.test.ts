import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiClientError,
  NotAvailableError,
  isRetryable,
  messageText,
  plainServerText,
  toUserMessage,
  type ApiFailure,
} from './errors';

const err = (status: number, failure: Partial<ApiFailure> = {}) =>
  new ApiClientError(status, { code: 'x', message: '', ...failure });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('plainServerText', () => {
  it('keeps plain sentences and ends them with a full stop', () => {
    expect(plainServerText('Title must be at least 2 characters')).toBe('Title must be at least 2 characters.');
    expect(plainServerText('  Phone looks invalid.  ')).toBe('Phone looks invalid.');
    expect(plainServerText('Upload a PDF, DOCX or PPTX file')).toBe('Upload a PDF, DOCX or PPTX file.');
  });

  it('curls apostrophes like our own words', () => {
    expect(plainServerText("Built-in roles can't be deleted.")).toBe('Built-in roles can’t be deleted.');
  });

  it.each([
    'ElevenLabs agent provisioning failed',
    'Eleven Labs is down',
    'Exotel rejected the call',
    'gemini-2.5-flash timed out',
    'Sarvam, Deepgram or Cartesia unavailable',
    'Plivo number not verified',
    'OpenAI quota exceeded',
    'Anthropic overloaded',
    'Google sign-in failed',
  ])('rejects vendor names: %s', (raw) => {
    expect(plainServerText(raw)).toBeNull();
  });

  it.each([
    'Set ELEVENLABS_ENABLED=true to enable voice',
    'Missing OPENAI_API_KEY',
    'DATABASE_URL is not set',
    'Configure SECRET=abc first',
  ])('rejects config tokens: %s', (raw) => {
    expect(plainServerText(raw)).toBeNull();
  });

  it.each([
    'See https://docs.example.com/errors',
    'Visit www.example.com for help',
    'POST /api/auth/sign-in failed',
    'Route /backend/jobs/123 is gone',
    'Cannot GET /organization/members',
  ])('rejects URLs and API paths: %s', (raw) => {
    expect(plainServerText(raw)).toBeNull();
  });

  it.each([
    'validation_failed',
    'Status is not_called',
    'Request failed',
    'Request failed (500)',
    'Something went wrong',
    'Validation failed',
    'Not found',
    'Internal server error',
    'Authentication required',
    "TypeError: Cannot read properties of undefined (reading 'id')",
    '{"error":"x"}',
    '<html><body>502 Bad Gateway</body></html>',
    'Voice provider not configured',
    'Invalid token',
    'The request body could not be parsed',
  ])('rejects raw codes, vague text and leaks: %s', (raw) => {
    expect(plainServerText(raw)).toBeNull();
  });

  it.each([
    'java.lang.IllegalStateException: Duplicate key 5',
    'IllegalStateException: Duplicate key 5',
    "Failed to convert value of type 'java.lang.String' to required type 'java.util.UUID'",
    'NullPointerException at desk.jobs.JobService.create(JobService.java:42)',
    'connect ECONNREFUSED 127.0.0.1:5432',
    'Eleven-Labs down',
    '11labs error',
    'AWS S3 bucket missing',
    'Postgres unique constraint violated',
    'Redis timed out',
    'Azure speech quota reached',
  ])('rejects exceptions, package paths, stack frames, addresses and more vendors: %s', (raw) => {
    expect(plainServerText(raw)).toBeNull();
  });

  it('rejects empty, overlong and non-string values', () => {
    expect(plainServerText('')).toBeNull();
    expect(plainServerText('   ')).toBeNull();
    expect(plainServerText('a'.repeat(241))).toBeNull();
    expect(plainServerText(undefined)).toBeNull();
    expect(plainServerText(42)).toBeNull();
  });
});

describe('toUserMessage', () => {
  it('no connection: retry, plain words', () => {
    const m = toUserMessage(err(0));
    expect(m).toEqual({
      title: 'The server can’t be reached right now',
      detail: 'Check your connection, then retry.',
      action: 'retry',
    });
    expect(toUserMessage(new TypeError('Failed to fetch')).action).toBe('retry');
    expect(toUserMessage(new TypeError('Load failed')).title).toBe('The server can’t be reached right now');
  });

  it('says offline when a request never arrived and the browser is offline', () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(toUserMessage(err(0)).title).toBe('You’re offline');
    expect(toUserMessage(new TypeError('Failed to fetch')).title).toBe('You’re offline');
  });

  it('a response that came back keeps its meaning while offline', () => {
    vi.stubGlobal('navigator', { onLine: false });
    const m = toUserMessage(
      err(422, { message: 'Validation failed', errors: [{ field: 'title', message: 'Title is required' }] }),
    );
    expect(m.title).toBe('Some details need fixing');
    expect(m.detail).toBe('Title is required.');
    expect(m.fieldErrors).toEqual([{ field: 'title', message: 'Title is required.' }]);
    expect(toUserMessage(err(500)).title).toBe('Something failed on our side');
  });

  it('puts the context in the title and the cause in the detail', () => {
    const m = toUserMessage(err(0), 'load candidates');
    expect(m.title).toBe('Couldn’t load candidates');
    expect(m.detail).toBe('The server can’t be reached right now. Check your connection, then retry.');
  });

  it('titles are headings: no full stop, curly apostrophes; details are sentences', () => {
    for (const status of [0, 400, 401, 403, 404, 409, 410, 413, 418, 422, 429, 500]) {
      for (const context of [undefined, 'save the job']) {
        const m = toUserMessage(err(status), context);
        expect(m.title).not.toMatch(/[.']$|'/);
        expect(m.detail).toMatch(/[.!?]$/);
        expect(messageText(m)).toBe(`${m.title}. ${m.detail}`);
      }
    }
  });

  it('validation: fix_input with scrubbed field errors and the first plain message', () => {
    const m = toUserMessage(
      err(422, {
        code: 'validation_failed',
        message: 'Validation failed',
        errors: [
          { field: 'title', message: 'Title must be at least 2 characters' },
          { field: 'voice', message: 'ElevenLabs voice id is invalid' },
        ],
      }),
    );
    expect(m.action).toBe('fix_input');
    expect(m.title).toBe('Some details need fixing');
    expect(m.detail).toBe('Title must be at least 2 characters.');
    expect(m.fieldErrors).toEqual([
      { field: 'title', message: 'Title must be at least 2 characters.' },
      { field: 'voice', message: 'Check this field.' },
    ]);
  });

  it('400 without usable text still says what to do', () => {
    const m = toUserMessage(err(400, { message: 'The request body could not be parsed by FASTIFY_PARSER' }));
    expect(m).toMatchObject({ action: 'fix_input', detail: 'Check what you entered, then try again.' });
    expect(toUserMessage(err(400, { errors: [{ field: 'a', message: 'Required' }] })).detail).toBe('Required.');
  });

  it('401: session ended, sign in', () => {
    expect(toUserMessage(err(401, { message: 'Authentication required' }))).toEqual({
      title: 'Your session ended',
      detail: 'Sign in to continue.',
      action: 'sign_in',
    });
  });

  it('known sign-in codes get their own words', () => {
    const wrong = toUserMessage(err(401, { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' }));
    expect(wrong).toMatchObject({ title: 'Email or password is wrong', action: 'fix_input' });
    const exists = toUserMessage(err(422, { code: 'USER_ALREADY_EXISTS', message: 'User already exists' }));
    expect(exists).toMatchObject({ title: 'An account already exists for this email', action: 'sign_in' });
    expect(toUserMessage(err(400, { code: 'INVALID_TOKEN' })).title).toBe('This link has expired');
    expect(toUserMessage(err(400, { code: 'constructor' })).title).toBe('Some details need fixing');
  });

  it('an untrusted web address on sign-in is a setup problem, not missing access', () => {
    for (const code of ['INVALID_ORIGIN', 'INVALID_CALLBACK_URL']) {
      const m = toUserMessage(err(403, { code, message: 'Invalid origin' }));
      expect(m).toEqual({
        title: 'Sign-in isn’t set up for this web address',
        detail: 'Open the app from its usual address, then try again.',
        action: null,
      });
    }
  });

  it('403: no access, the server’s own reason when it gives one', () => {
    const m = toUserMessage(err(403, { message: 'You do not have permission to do this' }));
    expect(m.action).toBe('contact_admin');
    expect(messageText(m)).toBe('You don’t have access to this. Ask a workspace admin.');
    expect(toUserMessage(err(403), 'invite people').detail).toBe(
      'You don’t have access to this. Ask a workspace admin.',
    );
    const own = toUserMessage(err(403, { code: 'forbidden', message: 'Only an Owner can invite an Owner' }), 'send the invite');
    expect(messageText(own)).toBe('Couldn’t send the invite. Only an Owner can invite an Owner.');
  });

  it('404: not found, no raw resource text', () => {
    const m = toUserMessage(err(404, { message: 'Job candidate not found' }));
    expect(m).toEqual({
      title: 'We couldn’t find that',
      detail: 'It may have been removed, or the link is out of date.',
      action: null,
    });
    expect(toUserMessage(err(404), 'open the candidate').title).toBe('Couldn’t open the candidate');
  });

  it('409: shows plain server text, our sentence otherwise', () => {
    expect(toUserMessage(err(409, { message: "The last owner can't be removed" })).detail).toBe(
      'The last owner can’t be removed.',
    );
    expect(toUserMessage(err(409, { message: 'unique_violation on roles_key' })).detail).toBe(
      'It changed since you opened it. Reload the page, then try again.',
    );
  });

  it('410, 413, 429', () => {
    expect(toUserMessage(err(410)).title).toBe('This link is no longer valid');
    expect(messageText(toUserMessage(err(413)))).toBe('That file is too large. The limit is 10 MB.');
    expect(toUserMessage(err(413)).action).toBe('fix_input');
    expect(toUserMessage(err(429, { message: 'Too many requests. Try again in 30s' }))).toEqual({
      title: 'Too many attempts',
      detail: 'Wait a minute, then try again.',
      action: 'retry',
    });
  });

  it('5xx: our side, short support ref, never the server text', () => {
    const m = toUserMessage(
      err(500, {
        code: 'internal',
        message: 'Set ELEVENLABS_ENABLED=true',
        request_id: '4f2a91c3-0b9d-4a7e-9c8b-6f0e9d112233',
      }),
    );
    expect(m).toEqual({
      title: 'Something failed on our side (ref 4F2A91C3)',
      detail: 'Retry in a minute.',
      action: 'retry',
      supportRef: '4F2A91C3',
    });
    expect(toUserMessage(err(502)).supportRef).toBeUndefined();
    expect(toUserMessage(err(503), 'load jobs').detail).toBe('Something failed on our side. Retry in a minute.');
  });

  it('NotAvailableError: the feature is missing, not broken', () => {
    const m = toUserMessage(new NotAvailableError(404, { code: 'not_found', message: 'Not found' }));
    expect(m).toEqual({
      title: 'This isn’t available yet',
      detail: 'This feature isn’t turned on yet.',
      action: null,
    });
  });

  it('anything else: generic, never the raw text', () => {
    const m = toUserMessage(new Error('Cannot read properties of undefined'));
    expect(m).toEqual({
      title: 'That didn’t go through',
      detail: 'Try again. If it keeps happening, reload the page.',
      action: 'retry',
    });
    expect(messageText(toUserMessage('Sarvam exploded'))).not.toContain('Sarvam');
  });

  it('never says "Something went wrong" or "Request failed", never a dash, never the leaked text', () => {
    const leak = { message: 'Something went wrong: OPENAI_API_KEY missing at https://x.io/v1', request_id: 'r1' };
    for (const status of [0, 400, 401, 403, 404, 405, 409, 410, 413, 418, 422, 429, 500, 502, 503]) {
      for (const context of [undefined, 'save the job']) {
        const out = messageText(toUserMessage(err(status, leak), context));
        expect(out).not.toMatch(/something went wrong|request failed|OPENAI|https?:|[–—]/i);
        expect(out.trim()).not.toBe('');
      }
    }
  });
});

describe('ApiClientError', () => {
  it('message is the safe sentence; serverMessage keeps the raw text for logs', () => {
    const e = err(500, { message: 'Set ELEVENLABS_ENABLED=true', request_id: 'abcdef12-3456' });
    expect(e.message).toBe('Something failed on our side (ref ABCDEF12). Retry in a minute.');
    expect(e.serverMessage).toBe('Set ELEVENLABS_ENABLED=true');
    expect(e.requestId).toBe('abcdef12-3456');
    expect(e).toBeInstanceOf(Error);
  });

  it('keeps a plain validation message as before', () => {
    const e = err(422, { message: 'Validation failed', errors: [{ field: 'name', message: 'Name is required' }] });
    expect(e.message).toBe('Some details need fixing. Name is required.');
    expect(e.fieldErrors).toEqual([{ field: 'name', message: 'Name is required' }]);
  });

  it('survives a malformed body', () => {
    const e = new ApiClientError(500, { errors: 'nope', request_id: 7 } as unknown as ApiFailure);
    expect(e.code).toBe('');
    expect(e.fieldErrors).toEqual([]);
    expect(e.requestId).toBeNull();
  });

  it('keeps only well-formed field errors', () => {
    const e = new ApiClientError(422, {
      code: 'validation_failed',
      message: 'Validation failed',
      errors: [null, 'x', { message: 'no field' }, { field: 'title', message: 'Required' }],
    } as unknown as ApiFailure);
    expect(e).toBeInstanceOf(ApiClientError);
    expect(e.fieldErrors).toEqual([{ field: 'title', message: 'Required' }]);
    expect(e.message).toBe('Some details need fixing. Required.');
  });

  it('NotAvailableError is still an ApiClientError', () => {
    const e = new NotAvailableError(405, { code: 'not_found', message: '' });
    expect(e).toBeInstanceOf(ApiClientError);
    expect(e.name).toBe('NotAvailableError');
  });
});

describe('isRetryable', () => {
  it('retries no-connection and 5xx only', () => {
    expect(isRetryable(err(0))).toBe(true);
    expect(isRetryable(err(500))).toBe(true);
    expect(isRetryable(err(503))).toBe(true);
    for (const status of [400, 401, 403, 404, 409, 413, 422, 429]) expect(isRetryable(err(status))).toBe(false);
    expect(isRetryable(new NotAvailableError(404, { code: '', message: '' }))).toBe(false);
    expect(isRetryable(new TypeError('Failed to fetch'))).toBe(true);
    expect(isRetryable(new Error('bug'))).toBe(false);
  });
});
