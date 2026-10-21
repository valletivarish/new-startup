/**
 * The few Zoho Accounts and Zoho Recruit calls the connector makes. No state:
 * tokens and data-centre hosts are passed in. Every failure is a ZohoError
 * with a kind the caller acts on; response bodies are never logged.
 *
 * Data centres: Zoho answers the sign-in with `accounts-server` (e.g.
 * https://accounts.zoho.in). Token calls go there, and Recruit calls go to the
 * matching recruit host (https://recruit.zoho.in/recruit/v2). Only Zoho's own
 * hosts are accepted, so a forged callback can never make us send the client
 * secret anywhere else. Outside production, ZOHO_TEST_BASE_URL (the fake Zoho)
 * is the one extra allowed host and serves both roles.
 */

export type ZohoErrorKind =
  | 'auth_revoked'
  | 'rate_limited'
  | 'transient'
  | 'rejected'
  | 'no_applications_module';

export class ZohoError extends Error {
  constructor(
    readonly kind: ZohoErrorKind,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ZohoError';
  }
}

/** Read-only on jobs, candidates and applications; create on notes. Nothing else. */
export const ZOHO_SCOPES = [
  'ZohoRecruit.modules.jobopenings.READ',
  'ZohoRecruit.modules.candidates.READ',
  'ZohoRecruit.modules.applications.READ',
  'ZohoRecruit.modules.notes.CREATE',
].join(',');

const ZOHO_ACCOUNTS = /^https:\/\/accounts\.zoho\.(com|in|eu|com\.au|jp|com\.cn|ca|sa|uk)$/;

/** The Recruit API base for an accounts server, or null if the host isn't Zoho's (or the test fake). */
export function recruitBaseFor(accountsServer: string, testBase?: string): string | null {
  const s = accountsServer.replace(/\/+$/, '');
  if (testBase && s === testBase.replace(/\/+$/, '')) return `${s}/recruit/v2`;
  const m = ZOHO_ACCOUNTS.exec(s);
  return m ? `https://recruit.zoho.${m[1]}/recruit/v2` : null;
}

/** Zoho's ISO form with an IST offset, second precision: 2026-10-21T15:26:49+05:30. */
export function zohoTime(t: Date): string {
  const ist = new Date(t.getTime() + 330 * 60_000).toISOString().slice(0, 19);
  return `${ist}+05:30`;
}

export interface ZohoTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. */
  expiresAt: number;
}

export interface ZohoRecord {
  id: string;
  [field: string]: unknown;
}

type FetchFn = typeof fetch;

export interface ZohoClient {
  authorizeUrl(input: { state: string; challenge: string; redirectUri: string }): string;
  exchangeCode(accountsServer: string, input: { code: string; verifier: string; redirectUri: string }): Promise<ZohoTokens>;
  refresh(accountsServer: string, refreshToken: string): Promise<Omit<ZohoTokens, 'refreshToken'>>;
  revoke(accountsServer: string, token: string): Promise<void>;
  listJobOpenings(base: string, accessToken: string): Promise<ZohoRecord[]>;
  /** One page of applications, oldest Modified_Time first. 204/304 → no records. */
  listApplications(
    base: string,
    accessToken: string,
    input: { modifiedSince: Date | null; page: number; perPage?: number },
  ): Promise<{ records: ZohoRecord[]; more: boolean }>;
  addNote(base: string, accessToken: string, input: { candidateId: string; title: string; content: string }): Promise<void>;
}

function classify(status: number, code: string): ZohoError {
  if (status === 401 || /invalid_token|invalid_grant|invalid_code|authentication_failure|oauth_scope_mismatch/i.test(code)) {
    return new ZohoError('auth_revoked', status, code || 'unauthorised');
  }
  if (status === 429 || /too many requests|limit_exceeded|access denied/i.test(code)) {
    return new ZohoError('rate_limited', status, code || 'rate limited');
  }
  if (status === 0 || status === 408 || status >= 500) return new ZohoError('transient', status, code || `HTTP ${status}`);
  if (/invalid_module|invalid_url_pattern/i.test(code)) return new ZohoError('no_applications_module', status, code);
  return new ZohoError('rejected', status, code || `HTTP ${status}`);
}

export function createZohoClient(opts: {
  clientId: string;
  clientSecret: string;
  /** Where the sign-in page is: Zoho's global accounts host, or the fake in tests. */
  authorizeBase: string;
  fetchFn?: FetchFn;
}): ZohoClient {
  const fetchFn = opts.fetchFn ?? fetch;

  async function send(url: string, init: RequestInit): Promise<{ status: number; body: Record<string, unknown> | null }> {
    let res: Response;
    try {
      res = await fetchFn(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
    } catch {
      throw new ZohoError('transient', 0, 'unreachable');
    }
    const text = await res.text();
    let body: Record<string, unknown> | null = null;
    try {
      body = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      body = null;
    }
    return { status: res.status, body };
  }

  /** Accounts answers some failures with HTTP 200 and an `error` field. */
  async function token(accountsServer: string, form: Record<string, string>) {
    const { status, body } = await send(`${accountsServer.replace(/\/+$/, '')}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    });
    const error = typeof body?.['error'] === 'string' ? (body['error'] as string) : '';
    if (status !== 200 || error || typeof body?.['access_token'] !== 'string') {
      throw classify(status === 200 ? 400 : status, error);
    }
    const expiresIn = Number(body['expires_in'] ?? 3600);
    return {
      accessToken: body['access_token'] as string,
      refreshToken: typeof body['refresh_token'] === 'string' ? (body['refresh_token'] as string) : '',
      expiresAt: Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000,
    };
  }

  async function api(base: string, accessToken: string, path: string, init: RequestInit = {}) {
    const { status, body } = await send(`${base}${path}`, {
      ...init,
      headers: { authorization: `Zoho-oauthtoken ${accessToken}`, ...(init.headers as Record<string, string>) },
    });
    if (status === 204 || status === 304) return null;
    if (status < 200 || status >= 300) {
      throw classify(status, typeof body?.['code'] === 'string' ? (body['code'] as string) : '');
    }
    return body;
  }

  return {
    authorizeUrl({ state, challenge, redirectUri }) {
      const q = new URLSearchParams({
        scope: ZOHO_SCOPES,
        client_id: opts.clientId,
        response_type: 'code',
        access_type: 'offline',
        prompt: 'consent',
        redirect_uri: redirectUri,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      });
      return `${opts.authorizeBase.replace(/\/+$/, '')}/oauth/v2/auth?${q.toString()}`;
    },

    async exchangeCode(accountsServer, { code, verifier, redirectUri }) {
      const t = await token(accountsServer, {
        grant_type: 'authorization_code',
        client_id: opts.clientId,
        client_secret: opts.clientSecret,
        redirect_uri: redirectUri,
        code,
        code_verifier: verifier,
      });
      // access_type=offline&prompt=consent must give a refresh token; without one the connection can't last an hour.
      if (!t.refreshToken) throw new ZohoError('rejected', 400, 'no_refresh_token');
      return t;
    },

    async refresh(accountsServer, refreshToken) {
      const { accessToken, expiresAt } = await token(accountsServer, {
        grant_type: 'refresh_token',
        client_id: opts.clientId,
        client_secret: opts.clientSecret,
        refresh_token: refreshToken,
      });
      return { accessToken, expiresAt };
    },

    async revoke(accountsServer, tok) {
      // Zoho documents the token in the query string.
      await send(`${accountsServer.replace(/\/+$/, '')}/oauth/v2/token/revoke?token=${encodeURIComponent(tok)}`, {
        method: 'POST',
      });
    },

    async listJobOpenings(base, accessToken) {
      const out: ZohoRecord[] = [];
      // ponytail: first 1,000 job openings; an SMB account has far fewer.
      for (let page = 1; page <= 5; page += 1) {
        const body = await api(
          base,
          accessToken,
          `/JobOpenings?fields=id,Posting_Title,Job_Opening_Status&per_page=200&page=${page}`,
        );
        const data = (body?.['data'] as ZohoRecord[] | undefined) ?? [];
        out.push(...data);
        if (!(body?.['info'] as { more_records?: boolean } | undefined)?.more_records) break;
      }
      return out;
    },

    async listApplications(base, accessToken, { modifiedSince, page, perPage = 200 }) {
      const q = new URLSearchParams({
        sort_by: 'Modified_Time',
        sort_order: 'asc',
        page: String(page),
        per_page: String(perPage),
      });
      const body = await api(base, accessToken, `/Applications?${q.toString()}`, {
        headers: modifiedSince ? { 'If-Modified-Since': zohoTime(modifiedSince) } : {},
      });
      return {
        records: (body?.['data'] as ZohoRecord[] | undefined) ?? [],
        more: Boolean((body?.['info'] as { more_records?: boolean } | undefined)?.more_records),
      };
    },

    async addNote(base, accessToken, { candidateId, title, content }) {
      const body = await api(base, accessToken, '/Notes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          data: [{ Note_Title: title, Note_Content: content, Parent_Id: candidateId, se_module: 'Candidates' }],
        }),
      });
      // Zoho answers a refused record with HTTP 2xx and a per-record error.
      const first = (body?.['data'] as { status?: string; code?: string }[] | undefined)?.[0];
      if (first?.status === 'error') throw classify(400, first.code ?? 'rejected');
    },
  };
}
