/**
 * A small fake Zoho Recruit, for pnpm test:clients and the API tests. Same
 * shape as the real endpoints the HRVoice connector uses, all on one host:
 *
 *   GET  /oauth/v2/auth           auto-approves; redirects with code, state, location, accounts-server
 *   POST /oauth/v2/token          authorization_code (PKCE S256 checked) and refresh_token grants
 *   POST /oauth/v2/token/revoke   ?token=
 *   GET  /recruit/v2/JobOpenings
 *   GET  /recruit/v2/Applications  If-Modified-Since (inclusive, second precision), sort Last_Activity_Time asc, page/per_page
 *   POST /recruit/v2/Notes         { data: [{ Note_Title, Note_Content, Parent_Id, se_module }] }
 *
 * In memory; helpers add jobs and applications and read the notes back.
 */

import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeApplication {
  id: string;
  jobId: string;
  candidateId: string;
  name: string;
  mobile: string | null;
  email?: string;
  status: string;
  /** Zoho's form: 2026-10-21T10:00:00+05:30. */
  modifiedTime: string;
}

export interface FakeNote {
  title: string;
  content: string;
  parentId: string;
  module: string;
  raw: unknown;
}

export interface FakeZoho {
  readonly url: string;
  readonly jobs: { id: string; title: string; status: string }[];
  readonly applications: FakeApplication[];
  readonly notes: FakeNote[];
  readonly revoked: string[];
  /** Requests to /recruit/v2/Applications, newest last (for paging assertions). */
  readonly applicationReads: { modifiedSince: string | null; page: number }[];
  /** Number of refresh_token grants served. */
  refreshes: number;
  /** Next N API calls answer 401 (an expired access token). */
  failNextApiWith401: number;
  /** Notes answer 503 while true. */
  notesDown: boolean;
  /** Applications answer INVALID_MODULE (an account without the Applications module). */
  noApplicationsModule: boolean;
  /** Access token lifetime in seconds. */
  expiresIn: number;
  addJob(title: string): string;
  addApplication(a: Omit<FakeApplication, 'id' | 'candidateId' | 'modifiedTime'> & { modifiedTime?: string; candidateId?: string }): FakeApplication;
  close(): Promise<void>;
}

const id = () => String(BigInt(`0x${randomBytes(6).toString('hex')}`) + 600_000_000_000n);

/** Zoho's ISO form with the IST offset. */
export function zohoIst(t: Date): string {
  return `${new Date(t.getTime() + 330 * 60_000).toISOString().slice(0, 19)}+05:30`;
}

function body(req: IncomingMessage): Promise<string> {
  return new Promise((ok) => {
    let s = '';
    req.on('data', (c: Buffer) => (s += c.toString()));
    req.on('end', () => ok(s));
  });
}

export async function startFakeZoho(port = 0): Promise<FakeZoho> {
  const codes = new Map<string, { challenge: string; redirectUri: string }>();
  const refreshTokens = new Set<string>();
  const accessTokens = new Set<string>();

  const fake: FakeZoho = {
    url: '',
    jobs: [],
    applications: [],
    notes: [],
    revoked: [],
    applicationReads: [],
    refreshes: 0,
    failNextApiWith401: 0,
    notesDown: false,
    noApplicationsModule: false,
    expiresIn: 3600,
    addJob(title) {
      const jobId = id();
      fake.jobs.push({ id: jobId, title, status: 'In-progress' });
      return jobId;
    },
    addApplication(a) {
      const app: FakeApplication = {
        ...a,
        id: id(),
        candidateId: a.candidateId ?? id(),
        modifiedTime: a.modifiedTime ?? zohoIst(new Date()),
      };
      fake.applications.push(app);
      return app;
    },
    close: () => new Promise((r) => server.close(() => r())),
  };

  const issue = () => {
    const access = `fake-access-${randomBytes(8).toString('hex')}`;
    accessTokens.add(access);
    return access;
  };

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const json = (status: number, value?: unknown) => {
      res.writeHead(status, value === undefined ? {} : { 'content-type': 'application/json' });
      res.end(value === undefined ? undefined : JSON.stringify(value));
    };

    if (req.method === 'GET' && url.pathname === '/oauth/v2/auth') {
      const code = `fake-code-${randomBytes(8).toString('hex')}`;
      const redirectUri = url.searchParams.get('redirect_uri') ?? '';
      codes.set(code, { challenge: url.searchParams.get('code_challenge') ?? '', redirectUri });
      const back = new URL(redirectUri);
      back.searchParams.set('code', code);
      back.searchParams.set('state', url.searchParams.get('state') ?? '');
      back.searchParams.set('location', 'in');
      back.searchParams.set('accounts-server', fake.url);
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }

    if (req.method === 'POST' && url.pathname === '/oauth/v2/token/revoke') {
      const t = url.searchParams.get('token') ?? '';
      refreshTokens.delete(t);
      fake.revoked.push(t);
      return json(200, { status: 'success' });
    }

    if (req.method === 'POST' && url.pathname === '/oauth/v2/token') {
      const form = new URLSearchParams(await body(req));
      if (form.get('grant_type') === 'authorization_code') {
        const c = codes.get(form.get('code') ?? '');
        codes.delete(form.get('code') ?? '');
        const verifier = form.get('code_verifier') ?? '';
        const challenge = createHash('sha256').update(verifier).digest('base64url');
        // Zoho answers token failures with HTTP 200 and an `error` field.
        if (!c || c.challenge !== challenge || c.redirectUri !== form.get('redirect_uri')) {
          return json(200, { error: 'invalid_code' });
        }
        const refresh = `fake-refresh-${randomBytes(8).toString('hex')}`;
        refreshTokens.add(refresh);
        return json(200, {
          access_token: issue(),
          refresh_token: refresh,
          api_domain: fake.url,
          token_type: 'Bearer',
          expires_in: fake.expiresIn,
        });
      }
      if (form.get('grant_type') === 'refresh_token') {
        if (!refreshTokens.has(form.get('refresh_token') ?? '')) return json(200, { error: 'invalid_code' });
        fake.refreshes += 1;
        return json(200, { access_token: issue(), api_domain: fake.url, token_type: 'Bearer', expires_in: fake.expiresIn });
      }
      return json(200, { error: 'unsupported_grant_type' });
    }

    if (url.pathname.startsWith('/recruit/v2/')) {
      const token = (req.headers['authorization'] ?? '').replace(/^Zoho-oauthtoken /, '');
      if (fake.failNextApiWith401 > 0) {
        fake.failNextApiWith401 -= 1;
        return json(401, { code: 'INVALID_TOKEN', status: 'error' });
      }
      if (!accessTokens.has(token)) return json(401, { code: 'INVALID_TOKEN', status: 'error' });
      const module = url.pathname.slice('/recruit/v2/'.length);

      if (req.method === 'GET' && module === 'JobOpenings') {
        return json(200, {
          data: fake.jobs.map((j) => ({ id: j.id, Posting_Title: j.title, Job_Opening_Status: j.status })),
          info: { page: 1, per_page: 200, count: fake.jobs.length, more_records: false },
        });
      }

      if (req.method === 'GET' && module === 'Applications') {
        if (fake.noApplicationsModule) return json(400, { code: 'INVALID_MODULE', status: 'error' });
        const ims = req.headers['if-modified-since'];
        const since = typeof ims === 'string' ? Math.floor(Date.parse(ims) / 1000) * 1000 : null;
        const page = Number(url.searchParams.get('page') ?? 1);
        const perPage = Math.min(200, Number(url.searchParams.get('per_page') ?? 200));
        fake.applicationReads.push({ modifiedSince: typeof ims === 'string' ? ims : null, page });
        const rows = fake.applications
          .filter((a) => since === null || Date.parse(a.modifiedTime) >= since)
          .sort((x, y) => Date.parse(x.modifiedTime) - Date.parse(y.modifiedTime) || x.id.localeCompare(y.id));
        const slice = rows.slice((page - 1) * perPage, page * perPage);
        if (slice.length === 0) return json(since === null ? 204 : 304);
        return json(200, {
          data: slice.map((a) => ({
            id: a.id,
            // Shape seen on a real India-DC account (22 Oct 2026): no Modified_Time on
            // applications, plain-string lookups with $-prefixed ids.
            Last_Activity_Time: a.modifiedTime,
            Created_Time: a.modifiedTime,
            Application_Status: a.status,
            Full_Name: a.name,
            Mobile: a.mobile,
            Email: a.email ?? null,
            Job_Opening_Name: fake.jobs.find((j) => j.id === a.jobId)?.title ?? '',
            $Job_Opening_Id: a.jobId,
            $Candidate_Id: a.candidateId,
          })),
          info: { page, per_page: perPage, count: slice.length, more_records: page * perPage < rows.length },
        });
      }

      if (req.method === 'POST' && module === 'Notes') {
        if (fake.notesDown) return json(503, { code: 'INTERNAL_ERROR', status: 'error' });
        const parsed = JSON.parse(await body(req)) as {
          data: { Note_Title: string; Note_Content: string; Parent_Id: string; se_module: string }[];
        };
        const n = parsed.data[0]!;
        fake.notes.push({ title: n.Note_Title, content: n.Note_Content, parentId: n.Parent_Id, module: n.se_module, raw: parsed });
        return json(201, { data: [{ code: 'SUCCESS', status: 'success', details: { id: id() } }] });
      }
      return json(400, { code: 'INVALID_URL_PATTERN', status: 'error' });
    }
    json(404, { error: 'not found' });
  });

  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  (fake as { url: string }).url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return fake;
}
