/**
 * Careers-page embed. A company admin makes a publishable key (`hrv_pub_` + 32 base62) for one
 * job and pastes the snippet into its careers page. The key is public by design: it can only
 * read the job's title and company name, add one candidate to that job with the candidate's
 * own consent, and request one call (source 'embed', so calling hours, DND and limits apply as
 * for every automatic call). Requests are accepted only from the key's allowed origins.
 * Nothing about scores, fit or results ever goes back to the page.
 */

import { sql, withTenantContext, withoutTenantContext, type Database } from '@platform/db';

import { ApiError } from '../errors.js';
import type { AuditService } from '../audit/audit.service.js';
import type { CandidatesService } from '../hiring/candidates.service.js';
import { createKeyRateLimiter, hashKey, randomBase62, type KeyRateLimiter } from './api-keys.service.js';
import type { CallRequestsService } from './call-requests.service.js';
import { assertWithinLimits } from './call-limits.js';
import { nextCallingTime } from './calling-hours.js';

export const PUBLISHABLE_KEY_RE = /^hrv_pub_[A-Za-z0-9]{32}$/;
export const MAX_ORIGINS = 10;

interface Actor {
  readonly organizationId: string;
  readonly userId: string;
}

export interface CareersKey {
  id: string;
  publicKey: string;
  mode: 'live' | 'test';
  allowedOrigins: string[];
  lastUsedAt: string | null;
  createdAt: string;
}

/** A resolved, origin-checked form: what the public routes act with. */
export interface EmbedForm {
  readonly keyId: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly jobId: string;
  readonly isTest: boolean;
}

export interface CareersEmbedService {
  /** The job's active key (or null), and the company name the form shows. */
  get(actor: Actor, jobId: string): Promise<{ key: CareersKey | null; companyName: string }>;
  /** Makes the job's key, revoking any earlier one (so this is also "make a new key"). */
  create(actor: Actor, jobId: string, origins: readonly string[]): Promise<CareersKey>;
  setOrigins(actor: Actor, jobId: string, origins: readonly string[]): Promise<CareersKey>;
  revoke(actor: Actor, jobId: string): Promise<void>;

  /** True when `origin` may use this key. Never throws (CORS preflight). */
  allows(key: string, origin: string | undefined): Promise<boolean>;
  /** 404 for an unknown or revoked key, 403 for an origin not on its list. */
  authorize(key: string, origin: string | undefined): Promise<EmbedForm>;
  describe(form: EmbedForm): Promise<{ companyName: string; jobTitle: string; open: boolean }>;
  apply(
    form: EmbedForm,
    input: { fullName: string; phone: string; email?: string },
  ): Promise<{ callAfter: string | null }>;
}

/**
 * "https://acme.in" for "acme.in", "https://acme.in/careers/" or "HTTPS://Acme.in"; null when it
 * isn't a website address. Recruiters paste page URLs, so the path is dropped.
 */
export function normalizeOrigin(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password) return null;
  if (u.hostname !== 'localhost' && !u.hostname.includes('.')) return null;
  return u.origin;
}

/** Normalised, de-duplicated origins, or a 422 naming the first bad entry. */
export function parseOrigins(raw: readonly string[]): string[] {
  const out: string[] = [];
  for (const entry of raw) {
    if (!entry.trim()) continue;
    const origin = normalizeOrigin(entry);
    if (!origin) {
      throw ApiError.validation([
        { field: 'allowedOrigins', message: `“${entry.trim().slice(0, 100)}” isn’t a website address.` },
      ]);
    }
    if (!out.includes(origin)) out.push(origin);
  }
  if (out.length === 0) {
    throw ApiError.validation([{ field: 'allowedOrigins', message: 'Add the website your careers page is on.' }]);
  }
  if (out.length > MAX_ORIGINS) {
    throw ApiError.validation([{ field: 'allowedOrigins', message: `Add at most ${MAX_ORIGINS} websites.` }]);
  }
  return out;
}

/** An Indian mobile as 10 digits ("+91 98765-43210" → "9876543210"), or null. */
export function indianMobile(raw: string): string | null {
  const digits = raw.replace(/[\s\-().]/g, '').replace(/^(\+91|0091|91(?=\d{10}$)|0(?=\d{10}$))/, '');
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

type KeyRow = {
  id: string;
  organization_id: string;
  created_by_user_id: string;
  mode: 'live' | 'test';
  revoked_at: unknown;
  kind: string;
  job_id: string | null;
  allowed_origins: string[];
};

const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());

export function createCareersEmbedService(deps: {
  database: Database;
  audit: AuditService;
  candidates: Pick<CandidatesService, 'create'>;
  calls: Pick<CallRequestsService, 'request'>;
  now?: () => Date;
  /** Applications per key per minute (default 20). */
  keyLimiter?: KeyRateLimiter;
}): CareersEmbedService {
  const { database, audit, candidates, calls } = deps;
  const now = deps.now ?? (() => new Date());
  const limiter = deps.keyLimiter ?? createKeyRateLimiter({ limit: 20 });
  const tenant = <T>(a: Actor, fn: Parameters<typeof withTenantContext<T>>[2]) =>
    withTenantContext(database.db, a, fn);

  const toKey = (r: {
    id: string;
    public_key: string;
    mode: 'live' | 'test';
    allowed_origins: string[];
    last_used_at: unknown;
    created_at: unknown;
  }): CareersKey => ({
    id: r.id,
    publicKey: r.public_key,
    mode: r.mode,
    allowedOrigins: r.allowed_origins,
    lastUsedAt: iso(r.last_used_at),
    createdAt: iso(r.created_at) ?? '',
  });
  const KEY_COLUMNS = sql`id, public_key, mode, allowed_origins, last_used_at, created_at`;

  const record = (actor: Actor, eventType: string, keyId: string, jobId: string) =>
    audit.record({
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      eventType,
      resourceType: 'api_key',
      resourceId: keyId,
      metadata: { apiKeyId: keyId, kind: 'publishable', jobId },
    });

  async function lookup(key: string): Promise<KeyRow | null> {
    if (!PUBLISHABLE_KEY_RE.test(key)) return null;
    const rows = await withoutTenantContext(database.db, (tx) =>
      tx.execute<KeyRow>(sql`select * from resolve_api_key(${hashKey(key)})`),
    );
    const row = rows[0];
    return row && row.kind === 'publishable' && row.revoked_at === null && row.job_id ? row : null;
  }

  async function describe(form: EmbedForm) {
    const rows = await tenant(form, (tx) =>
      tx.execute<{ company: string; title: string; status: string }>(sql`
        select o.name as company, j.title, j.status
        from jobs j join organizations o on o.id = j.organization_id
        where j.id = ${form.jobId} and j.organization_id = ${form.organizationId}`),
    );
    if (!rows[0]) throw ApiError.notFound('Form');
    return { companyName: rows[0].company, jobTitle: rows[0].title, open: rows[0].status !== 'closed' };
  }

  return {
    async get(actor, jobId) {
      return tenant(actor, async (tx) => {
        const rows = await tx.execute<Parameters<typeof toKey>[0]>(sql`
          select ${KEY_COLUMNS} from api_keys
          where organization_id = ${actor.organizationId} and job_id = ${jobId}
            and kind = 'publishable' and revoked_at is null
          order by created_at desc limit 1`);
        const org = await tx.execute<{ name: string }>(
          sql`select name from organizations where id = ${actor.organizationId}`,
        );
        return { key: rows[0] ? toKey(rows[0]) : null, companyName: org[0]?.name ?? '' };
      });
    },

    async create(actor, jobId, rawOrigins) {
      const origins = parseOrigins(rawOrigins);
      const key = `hrv_pub_${randomBase62(32)}`;
      const created = await tenant(actor, async (tx) => {
        const job = await tx.execute<{ title: string; is_test: boolean }>(sql`
          select title, is_test from jobs where id = ${jobId} and organization_id = ${actor.organizationId}`);
        if (!job[0]) throw ApiError.notFound('Job');
        await tx.execute(sql`
          update api_keys set revoked_at = now()
          where organization_id = ${actor.organizationId} and job_id = ${jobId}
            and kind = 'publishable' and revoked_at is null`);
        const rows = await tx.execute<Parameters<typeof toKey>[0]>(sql`
          insert into api_keys
            (organization_id, created_by_user_id, name, prefix, key_hash, mode, scopes,
             kind, job_id, allowed_origins, public_key)
          values (${actor.organizationId}, ${actor.userId}, ${`Careers page: ${job[0].title}`.slice(0, 100)},
                  ${key.slice(0, 12)}, ${hashKey(key)}, ${job[0].is_test ? 'test' : 'live'}, '{}'::text[],
                  'publishable', ${jobId},
                  array[${sql.join(origins.map((o) => sql`${o}`), sql`, `)}]::text[], ${key})
          returning ${KEY_COLUMNS}`);
        return toKey(rows[0]!);
      });
      await record(actor, 'integrations.api_key_created', created.id, jobId);
      return created;
    },

    async setOrigins(actor, jobId, rawOrigins) {
      const origins = parseOrigins(rawOrigins);
      const rows = await tenant(actor, (tx) =>
        tx.execute<Parameters<typeof toKey>[0]>(sql`
          update api_keys
          set allowed_origins = array[${sql.join(origins.map((o) => sql`${o}`), sql`, `)}]::text[]
          where organization_id = ${actor.organizationId} and job_id = ${jobId}
            and kind = 'publishable' and revoked_at is null
          returning ${KEY_COLUMNS}`),
      );
      if (!rows[0]) throw ApiError.notFound('Careers page form');
      return toKey(rows[0]);
    },

    async revoke(actor, jobId) {
      const rows = await tenant(actor, (tx) =>
        tx.execute<{ id: string }>(sql`
          update api_keys set revoked_at = now()
          where organization_id = ${actor.organizationId} and job_id = ${jobId}
            and kind = 'publishable' and revoked_at is null
          returning id`),
      );
      if (!rows[0]) throw ApiError.notFound('Careers page form');
      for (const r of rows) await record(actor, 'integrations.api_key_revoked', r.id, jobId);
    },

    async allows(key, origin) {
      if (!origin) return false;
      try {
        return (await lookup(key))?.allowed_origins.includes(origin) ?? false;
      } catch {
        return false;
      }
    },

    async authorize(key, origin) {
      const row = await lookup(key);
      if (!row) throw ApiError.notFound('Form');
      if (!origin || !row.allowed_origins.includes(origin)) {
        throw ApiError.forbidden('This form isn’t set up for this website.');
      }
      const actor = { organizationId: row.organization_id, userId: row.created_by_user_id };
      // Calls run in the creator's name: one who left the company (or was suspended) ends the form.
      const user = await withoutTenantContext(database.db, (tx) =>
        tx.execute(sql`select 1 from users where id = ${row.created_by_user_id} and status = 'active'`),
      );
      const live = user.length === 0 ? [] : await tenant(actor, (tx) =>
        tx.execute(sql`
          select 1 from organization_memberships
          where organization_id = ${row.organization_id} and user_id = ${row.created_by_user_id}
            and status = 'active'`),
      );
      if (live.length === 0) throw ApiError.notFound('Form');
      return {
        keyId: row.id,
        organizationId: row.organization_id,
        userId: row.created_by_user_id,
        jobId: row.job_id!,
        isTest: row.mode === 'test',
      };
    },

    describe,

    async apply(form, input) {
      limiter.check(form.keyId);
      const job = await describe(form);
      if (!job.open) throw ApiError.notFound('Form');
      const t = now();
      // Refuse before creating anyone, so a limit hit leaves no half-made candidate.
      if (!form.isTest) await assertWithinLimits(database, form.organizationId, t);
      const callAfter = form.isTest ? null : (nextCallingTime(t)?.toISOString() ?? null);

      await tenant(form, (tx) =>
        tx.execute(sql`
          update api_keys set last_used_at = now()
          where id = ${form.keyId} and organization_id = ${form.organizationId}`),
      );
      // Someone applying twice gets the same answer and no second call; saying "already applied"
      // would tell anyone whether a number has applied for this job.
      const taken = await tenant(form, (tx) =>
        tx.execute(sql`
          select 1 from candidates
          where organization_id = ${form.organizationId} and job_id = ${form.jobId}
            and phone = ${input.phone} limit 1`),
      );
      if (taken.length > 0) return { callAfter };

      let candidateId: string;
      try {
        candidateId = (
          await candidates.create(form, {
            jobId: form.jobId,
            fullName: input.fullName,
            phone: input.phone,
            countryCode: '+91',
            ...(input.email ? { email: input.email } : {}),
            consentSource: 'candidate',
            isTest: form.isTest,
          })
        ).id;
      } catch (error) {
        if (error instanceof ApiError && error.code === 'conflict') return { callAfter };
        throw error;
      }
      await calls.request(
        { ...form, apiKeyId: form.keyId },
        { jobId: form.jobId, candidateId, source: 'embed' },
      );
      return { callAfter };
    },
  };
}
