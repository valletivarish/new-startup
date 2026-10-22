import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from './api';

type Api = typeof ApiModule;

const fetchMock = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>();
const assign = vi.fn();
const store = new Map<string, string>();
const location = { pathname: '/jobs', search: '?stage=new', href: 'http://localhost/jobs?stage=new', assign };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function load(): Promise<Api> {
  vi.resetModules(); // fresh "redirect once" flag per test
  return import('./api');
}

beforeEach(() => {
  fetchMock.mockReset();
  assign.mockReset();
  store.clear();
  location.pathname = '/jobs';
  location.search = '?stage=new';
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('window', {
    location,
    sessionStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('request', () => {
  it('turns a non-JSON error body into a typed error instead of throwing from JSON.parse', async () => {
    const api = await load();
    fetchMock.mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 }));
    const error = await api.listJobs().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(api.ApiClientError);
    expect(error).toMatchObject({ status: 502, message: 'Something failed on our side. Retry in a minute.' });
  });

  it('a 2xx that is not JSON is a server failure', async () => {
    const api = await load();
    fetchMock.mockResolvedValue(new Response('<html>proxy</html>', { status: 200 }));
    await expect(api.listJobs()).rejects.toMatchObject({ status: 502, code: 'invalid_response' });
  });

  it('an empty 2xx is null', async () => {
    const api = await load();
    fetchMock.mockResolvedValue(new Response('', { status: 200 }));
    await expect(api.signOut()).resolves.toBeNull();
  });

  it('a dropped connection is ApiClientError status 0', async () => {
    const api = await load();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(api.me()).rejects.toMatchObject({ status: 0, code: 'network' });
  });

  it('lets an abort through untouched', async () => {
    const api = await load();
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    fetchMock.mockRejectedValue(abort);
    await expect(api.me()).rejects.toBe(abort);
  });

  it('keeps the envelope: code, request id, field errors', async () => {
    const api = await load();
    fetchMock.mockResolvedValue(
      json(422, {
        code: 'validation_failed',
        message: 'Title is required',
        request_id: 'req-1',
        errors: [{ field: 'title', message: 'Title is required' }],
      }),
    );
    await expect(api.createJob({ title: '' })).rejects.toMatchObject({
      status: 422,
      code: 'validation_failed',
      requestId: 'req-1',
      fieldErrors: [{ field: 'title', message: 'Title is required' }],
      message: 'Some details need fixing. Title is required.',
    });
  });
});

describe('401 handling', () => {
  it('sends the person to sign-in once, with the page to come back to, and leaves a notice', async () => {
    const api = await load();
    fetchMock.mockImplementation(async () => json(401, { code: 'unauthorized', message: 'Authentication required' }));
    await Promise.allSettled([api.listJobs(), api.me(), api.listAgents()]);
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('/login?next=%2Fjobs%3Fstage%3Dnew');
    expect(api.isRedirectingToLogin()).toBe(true);
    expect(api.takeSessionEndedNotice()).toBe(true);
    expect(api.takeSessionEndedNotice()).toBe(false);
    expect(api.SESSION_ENDED_MESSAGE).toBe('Your session ended. Sign in to continue.');
  });

  it('still rejects, so callers stop', async () => {
    const api = await load();
    fetchMock.mockResolvedValue(json(401, { code: 'unauthorized', message: 'Authentication required' }));
    await expect(api.listJobs()).rejects.toMatchObject({ status: 401 });
  });

  it.each([
    ['sign-in', (api: Api) => api.signIn({ email: 'a@b.co', password: 'x' })],
    ['invite accept', (api: Api) => api.acceptInvitation('t'.repeat(30))],
    ['invite preview', (api: Api) => api.previewInvitation('tok')],
  ])('does not redirect for auth endpoints (%s)', async (_name, run) => {
    const api = await load();
    fetchMock.mockResolvedValue(json(401, { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' }));
    await run(api).catch(() => undefined);
    expect(assign).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it.each(['/login', '/', '/reset-password', '/invitations/accept', '/c/abc'])('does not redirect from public page %s', async (page) => {
    const api = await load();
    location.pathname = page;
    fetchMock.mockResolvedValue(json(401, { code: 'unauthorized', message: 'Authentication required' }));
    await api.me().catch(() => undefined);
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('optional endpoints', () => {
  it('a bare 404 "Not found" or a 405 means the backend lacks the route', async () => {
    const api = await load();
    fetchMock.mockResolvedValueOnce(json(404, { code: 'not_found', message: 'Not found' }));
    await expect(api.getJobCandidate('j1', 'c1')).rejects.toBeInstanceOf(api.NotAvailableError);
    fetchMock.mockResolvedValueOnce(new Response('', { status: 405 }));
    await expect(api.sendMemberPasswordReset('m1')).rejects.toBeInstanceOf(api.NotAvailableError);
    fetchMock.mockResolvedValueOnce(new Response('<html>404</html>', { status: 404 }));
    await expect(api.getHiringSummary()).rejects.toBeInstanceOf(api.NotAvailableError);
  });

  it('a named 404 is a real miss, not a missing route', async () => {
    const api = await load();
    fetchMock.mockResolvedValue(json(404, { code: 'not_found', message: 'Job candidate not found' }));
    const error = await api.getJobCandidate('j1', 'c1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(api.ApiClientError);
    expect(error).not.toBeInstanceOf(api.NotAvailableError);
  });

  it('non-optional endpoints never throw NotAvailableError', async () => {
    const api = await load();
    fetchMock.mockResolvedValue(json(404, { code: 'not_found', message: 'Not found' }));
    const error = await api.getJob('j1').catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(api.NotAvailableError);
  });
});

describe('new client functions', () => {
  const lastCall = () => fetchMock.mock.calls.at(-1) as [string, RequestInit | undefined];

  it('hit the contract paths', async () => {
    const api = await load();
    fetchMock.mockImplementation(async () => json(200, {}));
    await api.getJobCandidate('j1', 'c1');
    expect(lastCall()[0]).toBe('/backend/jobs/j1/candidates/c1');
    await api.previewInvitation('a/b c');
    expect(lastCall()[0]).toBe('/backend/invitations/a%2Fb%20c');
    await api.acceptInvitationAsNewUser({ token: 't', name: 'Asha', password: 'pw123456' });
    expect(lastCall()).toMatchObject(['/backend/invitations/accept-new', { method: 'POST' }]);
    await api.resendInvitation('i1');
    expect(lastCall()).toMatchObject(['/backend/organization/invitations/i1/resend', { method: 'POST' }]);
    await api.revokeInvitation('i1');
    expect(lastCall()).toMatchObject(['/backend/organization/invitations/i1', { method: 'DELETE' }]);
    await api.removeMember('m1');
    expect(lastCall()).toMatchObject(['/backend/organization/members/m1', { method: 'DELETE' }]);
    await api.sendMemberPasswordReset('m1');
    expect(lastCall()).toMatchObject(['/backend/organization/members/m1/password-reset', { method: 'POST' }]);
    await api.getHiringSummary();
    expect(lastCall()[0]).toBe('/backend/hiring/summary');
    await api.listJobCandidates('j1', { status: 'declined' });
    expect(lastCall()[0]).toBe('/backend/jobs/j1/candidates?status=declined');
  });

  it('listRoles derives isSystem on older backends', async () => {
    const api = await load();
    fetchMock.mockResolvedValue(
      json(200, {
        roles: [
          { id: '1', key: 'owner', name: 'Owner', description: '' },
          { id: '2', key: 'custom_lead', name: 'Lead', description: '' },
          { id: '3', key: 'custom_x', name: 'X', description: '', isSystem: true },
        ],
      }),
    );
    const { roles } = await api.listRoles();
    expect(roles.map((r) => r.isSystem)).toEqual([true, false, true]);
  });

  it('listPermissions normalises the older shape', async () => {
    const api = await load();
    fetchMock.mockResolvedValue(
      json(200, {
        permissions: [
          { key: 'candidates.read', resource: 'candidates', action: 'read', description: 'Read candidates', is_sensitive: true },
          { key: 'jobs.read', label: 'See jobs', group: 'Jobs', description: 'Read jobs', isSensitive: false },
        ],
      }),
    );
    const { permissions } = await api.listPermissions();
    expect(permissions).toEqual([
      { key: 'candidates.read', label: 'Read candidates', group: 'candidates', description: 'Read candidates', isSensitive: true },
      { key: 'jobs.read', label: 'See jobs', group: 'Jobs', description: 'Read jobs', isSensitive: false },
    ]);
  });

  it('requestPasswordReset never fetches a reset link', async () => {
    const api = await load();
    fetchMock.mockResolvedValue(json(200, { status: true, message: 'ok' }));
    await expect(api.requestPasswordReset('a@b.co', '/reset-password')).resolves.toEqual({ status: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/auth/request-password-reset');
  });

  it('formatApiError uses the safe sentence, or the fallback for non-API errors', async () => {
    const api = await load();
    expect(api.formatApiError(new Error('boom'), 'Could not save.')).toBe('Could not save.');
    const e = new api.ApiClientError(403, { code: 'forbidden', message: '' });
    expect(api.formatApiError(e, 'x')).toBe('You don’t have access to this. Ask a workspace admin.');
  });
});
