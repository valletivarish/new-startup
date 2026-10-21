/**
 * Zoho Recruit connector: connect (OAuth code + PKCE), link jobs, bring new
 * applicants in, and put a note on the Zoho candidate after each call.
 *
 * - One connection per company. Tokens are sealed before they are stored.
 * - The access token is refreshed when it has under 5 minutes left and stored
 *   by compare-and-set on the sealed value: if another job refreshed first,
 *   this one uses the stored token. A refused refresh (consent revoked) marks
 *   the connection, again only if the token it read is still the stored one.
 * - Sync runs per connection under a lease column (single flight), every 15
 *   minutes from the pg-boss schedule, and on "Sync now". Paging: sync.ts.
 * - Consent: connecting requires the admin to confirm that people who apply to
 *   the company's Zoho jobs agreed to be phoned about their application; that
 *   confirmation is stored and every imported candidate carries
 *   consent_source = 'customer' (the same rule as /v1).
 * - Calls: imported people are NOT called unless the job link has "call new
 *   applicants automatically" on (off by default). Those calls are ordinary
 *   call requests (source 'zoho'), so the 9:00-20:00 IST hold, limits and DND
 *   all apply. Rejected/hired/closed people are refused by guard.ts.
 * - Notes carry answers, outcome and the neutral summary only (toV1Result,
 *   scrubbed). Never a score, fit or recommendation.
 * - Every write to the database runs as the person who connected Zoho.
 */

import { createHash, randomBytes } from 'node:crypto';
import { sql, withTenantContext, withoutTenantContext, type Database } from '@platform/db';

import type { AuditService } from '../../audit/audit.service.js';
import { callOutcome } from '../../costs/costs.service.js';
import { ApiError } from '../../errors.js';
import type { CandidatesService } from '../../hiring/candidates.service.js';
import type { JobsService } from '../../hiring/jobs.service.js';
import type { CallRequestsService } from '../../integrations/call-requests.service.js';
import { toV1Result } from '../../integrations/public-mappers.js';
import type { JobQueue } from '../../jobs/queue.js';
import { toE164Phone } from '../../providers/elevenlabs/phone-e164.js';
import { recruitBaseFor, ZohoError, type ZohoClient } from './client.js';
import type { Sealer } from './seal.js';
import { buildNote, firstRead, isClosedStatus, mapApplication, nextRead, type MappedApplication } from './sync.js';

const SYSTEM_USER = '00000000-0000-0000-0000-000000000000';
const STATE_TTL_MS = 10 * 60_000;
const REFRESH_BEFORE_MS = 5 * 60_000;
const LEASE_MS = 10 * 60_000;
const PAUSE_MS = 15 * 60_000;
/** Pages per run; the next run carries on from the saved cursor. */
const MAX_PAGES = 25;
const NOTE_MAX_AGE_MS = 24 * 3_600_000;
/** 1 attempt + the queue's 12 retries. */
const NOTE_MAX_ATTEMPTS = 13;

export type SkipReason = 'closed_in_zoho' | 'no_phone' | 'invalid_phone' | 'duplicate_phone';

/** Stable codes the web turns into sentences (lib/connected-systems.ts). */
export type ConnectResult =
  | 'connected'
  | 'denied'
  | 'expired'
  | 'not_zoho'
  | 'no_refresh_token'
  | 'no_applications_module'
  | 'failed';

export interface ZohoStatus {
  available: boolean;
  connection: null | {
    status: 'connected' | 'needs_attention' | 'paused';
    /** Why it needs attention or last failed: consent_revoked, connected_by_left, no_applications_module, rate_limited, zoho_unreachable. */
    reason: string | null;
    pausedUntil: string | null;
    lastSyncAt: string | null;
    connectedAt: string;
    connectedBy: string | null;
    links: {
      zohoJobId: string;
      zohoJobTitle: string;
      jobId: string;
      jobTitle: string;
      autoCall: boolean;
      imported: number;
    }[];
    skipped: { reason: SkipReason; count: number; names: string[] }[];
    notes: { sent: number; pending: number; failed: number; lastError: string | null };
  };
}

export interface LinkInput {
  zohoJobId: string;
  zohoJobTitle: string;
  /** An existing HRVoice job, or omit to create one with the Zoho title. */
  jobId?: string;
  autoCall: boolean;
}

type Actor = { organizationId: string; userId: string };

type ConnRow = {
  id: string;
  organization_id: string;
  created_by_user_id: string;
  status: 'connected' | 'needs_attention';
  accounts_server: string;
  recruit_base: string;
  secrets_sealed: string;
  sync_cursor: string | null;
  last_error: string | null;
  paused_until: string | null;
};

type Secrets = { accessToken: string; refreshToken: string; expiresAt: number };

type LinkRow = { zoho_job_id: string; job_id: string; auto_call: boolean; is_test: boolean };

export interface ZohoService {
  available(): boolean;
  status(actor: Actor & { canSeeNames: boolean }): Promise<ZohoStatus>;
  startConnect(actor: Actor): Promise<{ url: string }>;
  /** The OAuth callback. Returns the stable result code; never throws for a bad callback. */
  finishConnect(actor: Actor, query: Record<string, string | undefined>): Promise<ConnectResult>;
  jobOpenings(actor: Actor): Promise<{ id: string; title: string; status: string }[]>;
  setLinks(actor: Actor, links: readonly LinkInput[]): Promise<void>;
  requestSync(actor: Actor): Promise<void>;
  /** Worker: one connection. */
  syncOrganization(organizationId: string): Promise<void>;
  /** Worker: the 15-minute schedule. */
  tick(): Promise<void>;
  /** After a call ends (never throws). */
  queueNote(organizationId: string, voiceSessionId: string): Promise<void>;
  /** Worker: throws when the attempt should be retried. */
  sendNote(organizationId: string, noteId: string, now?: Date): Promise<void>;
  retryNotes(actor: Actor): Promise<number>;
  disconnect(actor: Actor): Promise<void>;
}

export interface ZohoDeps {
  database: Database;
  client: ZohoClient | null;
  sealer: Sealer;
  redirectUri: string;
  webUrl: string;
  /** Outside production only: the fake Zoho's base URL. */
  testBase?: string;
  candidates: CandidatesService;
  jobs: JobsService;
  calls: Pick<CallRequestsService, 'request'>;
  queue: Pick<JobQueue, 'enqueueZohoSync' | 'enqueueZohoNote'> | null;
  audit: AuditService;
  logger: { warn(obj: object, msg: string): void; error(obj: object, msg: string): void };
  now?: () => Date;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const plainName = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

export function createZohoService(deps: ZohoDeps): ZohoService {
  const { database, sealer } = deps;
  const now = deps.now ?? (() => new Date());
  const tenant = <T>(a: Actor, fn: Parameters<typeof withTenantContext<T>>[2]) =>
    withTenantContext(database.db, a, fn);
  const client = () => {
    if (!deps.client) throw new ApiError('service_unavailable', 'Zoho Recruit isn’t set up on this server.');
    return deps.client;
  };

  async function loadConn(organizationId: string, userId = SYSTEM_USER): Promise<ConnRow | null> {
    const rows = await tenant({ organizationId, userId }, (tx) =>
      tx.execute<ConnRow>(sql`
        select id, organization_id, created_by_user_id, status, accounts_server, recruit_base,
               secrets_sealed, sync_cursor::text, last_error, paused_until::text
        from zoho_connections where organization_id = ${organizationId}
      `),
    );
    return rows[0] ?? null;
  }

  /** Marks the connection only if it still holds the token this job read (a reconnect meanwhile wins). */
  async function needsAttention(conn: ConnRow, reason: string) {
    await tenant({ organizationId: conn.organization_id, userId: SYSTEM_USER }, (tx) =>
      tx.execute(sql`
        update zoho_connections set status = 'needs_attention', last_error = ${reason}, updated_at = now()
        where id = ${conn.id} and secrets_sealed = ${conn.secrets_sealed}
      `),
    );
  }

  async function pause(conn: ConnRow) {
    await tenant({ organizationId: conn.organization_id, userId: SYSTEM_USER }, (tx) =>
      tx.execute(sql`
        update zoho_connections
        set paused_until = ${new Date(now().getTime() + PAUSE_MS).toISOString()}, last_error = 'rate_limited', updated_at = now()
        where id = ${conn.id}
      `),
    );
  }

  /** A live access token; refreshes by compare-and-set. `force` after a 401 from the API. */
  async function accessToken(conn: ConnRow, force = false): Promise<string> {
    const secrets = JSON.parse(sealer.open(conn.secrets_sealed)) as Secrets;
    if (!force && secrets.expiresAt - REFRESH_BEFORE_MS > Date.now()) return secrets.accessToken;
    let fresh;
    try {
      fresh = await client().refresh(conn.accounts_server, secrets.refreshToken);
    } catch (error) {
      if (error instanceof ZohoError && error.kind === 'auth_revoked') await needsAttention(conn, 'consent_revoked');
      throw error;
    }
    const sealed = sealer.seal(JSON.stringify({ ...secrets, ...fresh }));
    const won = await tenant({ organizationId: conn.organization_id, userId: SYSTEM_USER }, (tx) =>
      tx.execute(sql`
        update zoho_connections set secrets_sealed = ${sealed}, updated_at = now()
        where id = ${conn.id} and secrets_sealed = ${conn.secrets_sealed}
        returning id
      `),
    );
    if (won.length > 0) {
      conn.secrets_sealed = sealed;
      return fresh.accessToken;
    }
    // Another job refreshed (or someone reconnected) first: use what is stored now.
    const stored = await loadConn(conn.organization_id);
    if (!stored) throw new ZohoError('auth_revoked', 401, 'disconnected');
    conn.secrets_sealed = stored.secrets_sealed;
    return (JSON.parse(sealer.open(stored.secrets_sealed)) as Secrets).accessToken;
  }

  /** Runs a Zoho API call with the token; one forced refresh on a 401. */
  async function withToken<T>(conn: ConnRow, fn: (token: string) => Promise<T>): Promise<T> {
    try {
      return await fn(await accessToken(conn));
    } catch (error) {
      if (!(error instanceof ZohoError) || error.kind !== 'auth_revoked' || error.status !== 401) throw error;
      return fn(await accessToken(conn, true));
    }
  }

  /** Records what a failed Zoho call means for the connection. Returns the stable code. */
  async function recordFailure(conn: ConnRow, error: unknown): Promise<string> {
    if (!(error instanceof ZohoError)) return 'internal';
    if (error.kind === 'rate_limited') {
      await pause(conn);
      return 'rate_limited';
    }
    if (error.kind === 'auth_revoked') {
      await needsAttention(conn, 'consent_revoked');
      return 'consent_revoked';
    }
    if (error.kind === 'no_applications_module') {
      await needsAttention(conn, 'no_applications_module');
      return 'no_applications_module';
    }
    return error.kind === 'transient' ? 'zoho_unreachable' : 'zoho_rejected';
  }

  // --- Sync ------------------------------------------------------------------------------

  /** Same phone (last 10 digits) and the same name, not yet linked to anyone: adopt that row. */
  async function adoptExisting(a: Actor, jobId: string, m: MappedApplication): Promise<string | null> {
    const digits = (m.phone ?? '').replace(/\D/g, '').slice(-10);
    const rows = await tenant(a, (tx) =>
      tx.execute<{ id: string; full_name: string }>(sql`
        select id, full_name from candidates
        where organization_id = ${a.organizationId} and job_id = ${jobId} and external_id is null
          and right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 10) = ${digits}
        limit 1
      `),
    );
    const row = rows[0];
    if (!row || plainName(row.full_name) !== plainName(m.fullName)) return null;
    await tenant(a, (tx) =>
      tx.execute(sql`
        update candidates set external_id = ${`zoho:${m.applicationId}`},
          consent_at = coalesce(consent_at, now()), consent_source = coalesce(consent_source, 'customer'),
          updated_at = now()
        where id = ${row.id} and organization_id = ${a.organizationId} and external_id is null
      `),
    );
    return row.id;
  }

  /** One application, in its own transactions: a bad record never stops the others. */
  async function applyOne(conn: ConnRow, link: LinkRow, m: MappedApplication) {
    const a = { organizationId: conn.organization_id, userId: conn.created_by_user_id };
    const existing = (
      await tenant(a, (tx) =>
        tx.execute<{ candidate_id: string | null; modified_time: string }>(sql`
          select candidate_id, modified_time::text from zoho_applicants
          where connection_id = ${conn.id} and zoho_application_id = ${m.applicationId}
        `),
      )
    )[0];
    // De-duplication of the overlap window: already read at this Modified_Time.
    if (existing && Date.parse(existing.modified_time) >= m.modifiedTime.getTime()) return;

    const closed = isClosedStatus(m.status);
    let candidateId = existing?.candidate_id ?? null;
    let skip: SkipReason | null = null;
    let created = false;
    if (!candidateId) {
      if (closed) skip = 'closed_in_zoho';
      else if (!m.phone) skip = 'no_phone';
      else if (!toE164Phone(m.phone)) skip = 'invalid_phone';
      else {
        try {
          const r = await deps.candidates.upsertByExternalId(a, {
            jobId: link.job_id,
            externalId: `zoho:${m.applicationId}`,
            fullName: m.fullName,
            phone: m.phone,
            countryCode: '+91',
            ...(m.email ? { email: m.email } : {}),
            consentSource: 'customer',
            isTest: link.is_test,
          });
          candidateId = r.id;
          created = r.created;
        } catch (error) {
          if (!(error instanceof ApiError)) throw error;
          if (error.code === 'conflict') {
            candidateId = await adoptExisting(a, link.job_id, m);
            if (!candidateId) skip = 'duplicate_phone';
          } else skip = 'invalid_phone';
        }
      }
    }

    await tenant(a, (tx) =>
      tx.execute(sql`
        insert into zoho_applicants
          (organization_id, connection_id, zoho_application_id, zoho_candidate_id, zoho_job_id,
           full_name, candidate_id, closed, skip_reason, modified_time)
        values (${a.organizationId}, ${conn.id}, ${m.applicationId}, ${m.zohoCandidateId}, ${link.zoho_job_id},
                ${m.fullName}, ${candidateId}, ${closed}, ${skip}, ${m.modifiedTime.toISOString()})
        on conflict (connection_id, zoho_application_id) do update set
          zoho_candidate_id = excluded.zoho_candidate_id, zoho_job_id = excluded.zoho_job_id,
          full_name = excluded.full_name, candidate_id = excluded.candidate_id, closed = excluded.closed,
          skip_reason = excluded.skip_reason, modified_time = excluded.modified_time, updated_at = now()
      `),
    );

    if (created && candidateId && link.auto_call) {
      try {
        await deps.calls.request(
          { ...a, apiKeyId: null, isTest: link.is_test },
          { jobId: link.job_id, candidateId, source: 'zoho' },
        );
      } catch (error) {
        // A limit or a job without an agent: the person stays on the board for a manual call.
        deps.logger.warn({ organizationId: a.organizationId, code: (error as ApiError).code }, 'zoho.auto_call_refused');
      }
    }
  }

  async function syncConn(conn: ConnRow) {
    const a = { organizationId: conn.organization_id, userId: conn.created_by_user_id };
    // The connection acts as the person who connected it: if they left, stop until someone reconnects.
    const member = await tenant(a, (tx) =>
      tx.execute(sql`
        select 1 from organization_memberships
        where organization_id = ${a.organizationId} and user_id = ${a.userId} and status = 'active'
      `),
    );
    if (member.length === 0) {
      await needsAttention(conn, 'connected_by_left');
      return;
    }
    const links = await tenant(a, (tx) =>
      tx.execute<LinkRow>(sql`
        select l.zoho_job_id, l.job_id, l.auto_call, j.is_test
        from zoho_job_links l join jobs j on j.id = l.job_id
        where l.connection_id = ${conn.id}
      `),
    );
    const byJob = new Map(links.map((l) => [l.zoho_job_id, l]));
    if (byJob.size > 0) {
      let cursor = conn.sync_cursor ? new Date(conn.sync_cursor) : null;
      let at: ReturnType<typeof nextRead> = firstRead(cursor);
      for (let pages = 0; at && pages < MAX_PAGES; pages += 1) {
        const pos = at;
        const page = await withToken(conn, (t) => client().listApplications(conn.recruit_base, t, pos));
        let latest: Date | null = null;
        for (const record of page.records) {
          const m = mapApplication(record);
          if (!m) continue;
          if (!latest || m.modifiedTime > latest) latest = m.modifiedTime;
          const link = m.zohoJobId ? byJob.get(m.zohoJobId) : undefined;
          if (!link) continue;
          try {
            await applyOne(conn, link, m);
          } catch (error) {
            deps.logger.error({ err: (error as Error).message, organizationId: a.organizationId }, 'zoho.apply_failed');
          }
        }
        // Saved after the page's writes committed; a crash replays at most this page, harmlessly.
        if (latest && (!cursor || latest > cursor)) {
          cursor = latest;
          await tenant(a, (tx) =>
            tx.execute(sql`update zoho_connections set sync_cursor = ${latest.toISOString()} where id = ${conn.id}`),
          );
        }
        at = nextRead(pos, { latest, more: page.more });
      }
    }
    await tenant(a, (tx) =>
      tx.execute(sql`
        update zoho_connections set last_sync_at = now(), last_error = null, paused_until = null, updated_at = now()
        where id = ${conn.id} and status = 'connected'
      `),
    );
  }

  // --- Notes -----------------------------------------------------------------------------

  async function failNote(organizationId: string, id: string, code: string) {
    await tenant({ organizationId, userId: SYSTEM_USER }, (tx) =>
      tx.execute(sql`
        update zoho_notes set status = 'failed', last_error = ${code}
        where id = ${id} and organization_id = ${organizationId} and status = 'pending'
      `),
    );
  }

  return {
    available: () => deps.client !== null,

    async status(actor) {
      if (!deps.client) return { available: false, connection: null };
      const conn = await loadConn(actor.organizationId, actor.userId);
      if (!conn) return { available: true, connection: null };
      const data = await tenant(actor, async (tx) => {
        const meta = await tx.execute<{ last_sync_at: string | null; created_at: string; name: string | null }>(sql`
          select zc.last_sync_at::text, zc.created_at::text, coalesce(u.name, u.email) as name
          from zoho_connections zc left join users u on u.id = zc.created_by_user_id
          where zc.id = ${conn.id}
        `);
        const links = await tx.execute<{
          zoho_job_id: string;
          zoho_job_title: string;
          job_id: string;
          title: string;
          auto_call: boolean;
          imported: number;
        }>(sql`
          select l.zoho_job_id, l.zoho_job_title, l.job_id, j.title, l.auto_call,
                 (select count(*)::int from zoho_applicants za
                   where za.connection_id = l.connection_id and za.zoho_job_id = l.zoho_job_id
                     and za.candidate_id is not null) as imported
          from zoho_job_links l join jobs j on j.id = l.job_id
          where l.connection_id = ${conn.id}
          order by l.created_at
        `);
        const skipped = await tx.execute<{ skip_reason: SkipReason; count: number; names: string[] }>(sql`
          select skip_reason, count(*)::int as count,
                 (array_agg(full_name order by updated_at desc))[1:10] as names
          from zoho_applicants
          where connection_id = ${conn.id} and skip_reason is not null
            and zoho_job_id in (select zoho_job_id from zoho_job_links where connection_id = ${conn.id})
          group by skip_reason order by skip_reason
        `);
        const notes = await tx.execute<{ status: string; count: number; last_error: string | null }>(sql`
          select status, count(*)::int as count, max(last_error) as last_error
          from zoho_notes where connection_id = ${conn.id} group by status
        `);
        return { meta: meta[0]!, links, skipped, notes };
      });
      const paused = conn.paused_until && Date.parse(conn.paused_until) > now().getTime();
      const n = (s: string) => data.notes.find((x) => x.status === s);
      return {
        available: true,
        connection: {
          status: conn.status === 'needs_attention' ? 'needs_attention' : paused ? 'paused' : 'connected',
          reason: conn.last_error,
          pausedUntil: paused ? new Date(conn.paused_until!).toISOString() : null,
          lastSyncAt: data.meta.last_sync_at ? new Date(data.meta.last_sync_at).toISOString() : null,
          connectedAt: new Date(data.meta.created_at).toISOString(),
          connectedBy: data.meta.name,
          links: data.links.map((l) => ({
            zohoJobId: l.zoho_job_id,
            zohoJobTitle: l.zoho_job_title,
            jobId: l.job_id,
            jobTitle: l.title,
            autoCall: l.auto_call,
            imported: l.imported,
          })),
          skipped: data.skipped.map((s) => ({
            reason: s.skip_reason,
            count: s.count,
            names: actor.canSeeNames ? s.names : [],
          })),
          notes: {
            sent: n('sent')?.count ?? 0,
            pending: n('pending')?.count ?? 0,
            failed: n('failed')?.count ?? 0,
            lastError: n('failed')?.last_error ?? null,
          },
        },
      };
    },

    async startConnect(actor) {
      const c = client();
      const state = randomBytes(32).toString('base64url');
      const verifier = randomBytes(48).toString('base64url');
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      await tenant(actor, async (tx) => {
        await tx.execute(sql`delete from zoho_oauth_states where organization_id = ${actor.organizationId} and expires_at < now()`);
        await tx.execute(sql`
          insert into zoho_oauth_states (state_hash, organization_id, user_id, code_verifier, expires_at)
          values (${sha256(state)}, ${actor.organizationId}, ${actor.userId}, ${verifier},
                  ${new Date(Date.now() + STATE_TTL_MS).toISOString()})
        `);
      });
      return { url: c.authorizeUrl({ state, challenge, redirectUri: deps.redirectUri }) };
    },

    async finishConnect(actor, q) {
      const c = client();
      const state = q['state'] ?? '';
      // One-time: the row is deleted whether or not the rest succeeds.
      const rows = state
        ? await tenant(actor, (tx) =>
            tx.execute<{ code_verifier: string }>(sql`
              delete from zoho_oauth_states
              where state_hash = ${sha256(state)} and organization_id = ${actor.organizationId}
                and user_id = ${actor.userId} and expires_at > now()
              returning code_verifier
            `),
          )
        : [];
      const verifier = rows[0]?.code_verifier;
      if (!verifier) return 'expired';
      if (q['error'] || !q['code']) return 'denied';
      const accounts = (q['accounts-server'] ?? '').replace(/\/+$/, '');
      const base = recruitBaseFor(accounts, deps.testBase);
      if (!base) return 'not_zoho';

      let tokens;
      try {
        tokens = await c.exchangeCode(accounts, { code: q['code'], verifier, redirectUri: deps.redirectUri });
      } catch (error) {
        return error instanceof ZohoError && error.message === 'no_refresh_token' ? 'no_refresh_token' : 'failed';
      }
      // HRVoice reads applications, so the account must have Zoho's Applications module.
      try {
        await c.listApplications(base, tokens.accessToken, { modifiedSince: null, page: 1, perPage: 1 });
      } catch (error) {
        await c.revoke(accounts, tokens.refreshToken).catch(() => {});
        return error instanceof ZohoError && error.kind === 'no_applications_module' ? 'no_applications_module' : 'failed';
      }

      const sealed = sealer.seal(JSON.stringify(tokens));
      const previous = await tenant(actor, async (tx) => {
        const old = await tx.execute<{ accounts_server: string; secrets_sealed: string }>(sql`
          select accounts_server, secrets_sealed from zoho_connections
          where organization_id = ${actor.organizationId} for update
        `);
        // Reconnect (or take over) keeps the job links and the cursor.
        await tx.execute(sql`
          insert into zoho_connections
            (organization_id, created_by_user_id, accounts_server, recruit_base, secrets_sealed, consent_confirmed_at)
          values (${actor.organizationId}, ${actor.userId}, ${accounts}, ${base}, ${sealed}, now())
          on conflict (organization_id) do update set
            created_by_user_id = excluded.created_by_user_id, accounts_server = excluded.accounts_server,
            recruit_base = excluded.recruit_base, secrets_sealed = excluded.secrets_sealed,
            consent_confirmed_at = now(), status = 'connected', last_error = null, paused_until = null,
            updated_at = now()
        `);
        return old[0] ?? null;
      });
      // Replaced tokens are revoked: they'd count towards Zoho's refresh-token limit.
      if (previous) {
        try {
          const old = JSON.parse(sealer.open(previous.secrets_sealed)) as Secrets;
          await c.revoke(previous.accounts_server, old.refreshToken);
        } catch {
          /* best effort */
        }
      }
      await deps.audit.record({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        eventType: previous ? 'integration.zoho_reconnected' : 'integration.zoho_connected',
        metadata: { consentConfirmed: true },
      });
      return 'connected';
    },

    async jobOpenings(actor) {
      const conn = await loadConn(actor.organizationId, actor.userId);
      if (!conn || conn.status !== 'connected') {
        throw new ApiError('zoho_not_connected', 'Connect Zoho Recruit first.');
      }
      let records;
      try {
        records = await withToken(conn, (t) => client().listJobOpenings(conn.recruit_base, t));
      } catch (error) {
        const code = await recordFailure(conn, error);
        throw new ApiError(
          'service_unavailable',
          code === 'rate_limited'
            ? 'Zoho Recruit asked us to slow down. Try again in 15 minutes.'
            : 'Zoho Recruit didn’t answer. Try again in a minute.',
        );
      }
      return records.map((r) => ({
        id: String(r.id),
        title: String(r['Posting_Title'] ?? r['Job_Opening_Name'] ?? 'Untitled job'),
        status: String(r['Job_Opening_Status'] ?? ''),
      }));
    },

    async setLinks(actor, links) {
      const conn = await loadConn(actor.organizationId, actor.userId);
      if (!conn) throw new ApiError('zoho_not_connected', 'Connect Zoho Recruit first.');
      const resolved: (LinkInput & { jobId: string })[] = [];
      for (const l of links) {
        if (l.jobId) {
          await deps.jobs.get(actor, l.jobId); // 404 for a job outside this company
          resolved.push({ ...l, jobId: l.jobId });
          continue;
        }
        let created;
        try {
          created = await deps.jobs.create(actor, { title: l.zohoJobTitle.slice(0, 200), autoLinkAgent: true });
        } catch (error) {
          // No single published agent: create the job anyway; the recruiter links an agent before calling.
          if (!(error instanceof ApiError) || error.code !== 'agent_required') throw error;
          created = await deps.jobs.create(actor, { title: l.zohoJobTitle.slice(0, 200) });
        }
        resolved.push({ ...l, jobId: created.id });
      }
      const added = await tenant(actor, async (tx) => {
        const keep = resolved.map((l) => l.zohoJobId);
        await tx.execute(sql`
          delete from zoho_job_links where connection_id = ${conn.id}
          ${keep.length ? sql`and zoho_job_id not in (${sql.join(keep.map((k) => sql`${k}`), sql`, `)})` : sql``}
        `);
        let addedAny = false;
        for (const l of resolved) {
          const r = await tx.execute<{ inserted: boolean }>(sql`
            insert into zoho_job_links (organization_id, connection_id, zoho_job_id, zoho_job_title, job_id, auto_call)
            values (${actor.organizationId}, ${conn.id}, ${l.zohoJobId}, ${l.zohoJobTitle}, ${l.jobId}, ${l.autoCall})
            on conflict (connection_id, zoho_job_id) do update set
              zoho_job_title = excluded.zoho_job_title, auto_call = excluded.auto_call,
              job_id = excluded.job_id
            returning (xmax = 0) as inserted
          `);
          if (r[0]?.inserted) addedAny = true;
        }
        // A newly linked job's existing applicants come in: read everything again (idempotent).
        if (addedAny) {
          await tx.execute(sql`update zoho_connections set sync_cursor = null where id = ${conn.id}`);
        }
        return addedAny;
      });
      await deps.audit.record({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        eventType: 'integration.zoho_jobs_linked',
        metadata: { jobs: resolved.length, added },
      });
      await deps.queue?.enqueueZohoSync({ organizationId: actor.organizationId });
    },

    async requestSync(actor) {
      const conn = await loadConn(actor.organizationId, actor.userId);
      if (!conn || conn.status !== 'connected') {
        throw new ApiError('zoho_not_connected', 'Connect Zoho Recruit first.');
      }
      if (deps.queue) await deps.queue.enqueueZohoSync({ organizationId: actor.organizationId });
      else await this.syncOrganization(actor.organizationId);
    },

    async syncOrganization(organizationId) {
      if (!deps.client) return;
      // Single flight: take the lease, or leave it to whoever holds it.
      const leased = await tenant({ organizationId, userId: SYSTEM_USER }, (tx) =>
        tx.execute<ConnRow>(sql`
          update zoho_connections set sync_lease_until = ${new Date(Date.now() + LEASE_MS).toISOString()}
          where organization_id = ${organizationId} and status = 'connected'
            and (paused_until is null or paused_until < now())
            and (sync_lease_until is null or sync_lease_until < now())
          returning id, organization_id, created_by_user_id, status, accounts_server, recruit_base,
                    secrets_sealed, sync_cursor::text, last_error, paused_until::text
        `),
      );
      const conn = leased[0];
      if (!conn) return;
      try {
        await syncConn(conn);
      } catch (error) {
        const code = await recordFailure(conn, error);
        if (code === 'zoho_unreachable' || code === 'zoho_rejected' || code === 'internal') {
          await tenant({ organizationId, userId: SYSTEM_USER }, (tx) =>
            tx.execute(sql`update zoho_connections set last_error = ${code} where id = ${conn.id}`),
          );
        }
        deps.logger.warn({ organizationId, code }, 'zoho.sync_failed');
      } finally {
        await tenant({ organizationId, userId: SYSTEM_USER }, (tx) =>
          tx.execute(sql`update zoho_connections set sync_lease_until = null where id = ${conn.id}`),
        );
      }
    },

    async tick() {
      if (!deps.client) return;
      // organizations is RLS-exempt; each org is then checked under its own context.
      // ponytail: one query per org, like the call and webhook sweeps; a security-definer list if org count grows large.
      const orgs = await withoutTenantContext(database.db, (tx) =>
        tx.execute<{ id: string }>(sql`select id from organizations`),
      );
      for (const org of orgs) {
        const conn = await loadConn(org.id);
        if (conn?.status !== 'connected') continue;
        if (deps.queue) await deps.queue.enqueueZohoSync({ organizationId: org.id });
        else await this.syncOrganization(org.id);
      }
    },

    async queueNote(organizationId, voiceSessionId) {
      try {
        const rows = await tenant({ organizationId, userId: SYSTEM_USER }, (tx) =>
          tx.execute<{ id: string }>(sql`
            insert into zoho_notes (organization_id, connection_id, voice_session_id, zoho_candidate_id)
            select ${organizationId}, za.connection_id, vs.id, za.zoho_candidate_id
            from voice_sessions vs
            join zoho_applicants za on za.candidate_id = vs.candidate_id and za.organization_id = vs.organization_id
            join zoho_connections zc on zc.id = za.connection_id
            where vs.id = ${voiceSessionId} and vs.organization_id = ${organizationId}
              and vs.status in ('ended', 'failed') and za.zoho_candidate_id is not null
              and vs.created_at >= zc.created_at
            limit 1
            on conflict (connection_id, voice_session_id) do nothing
            returning id
          `),
        );
        for (const r of rows) await deps.queue?.enqueueZohoNote({ organizationId, noteId: r.id });
      } catch (error) {
        deps.logger.error({ err: (error as Error).message, organizationId, voiceSessionId }, 'zoho.note_queue_failed');
      }
    },

    async sendNote(organizationId, noteId, at = new Date()) {
      const sys = { organizationId, userId: SYSTEM_USER };
      const rows = await tenant(sys, (tx) =>
        tx.execute<{
          status: string;
          attempts: number;
          created_at: string;
          zoho_candidate_id: string;
          vs_status: string;
          failure_reason: string | null;
          duration_seconds: number | null;
          transcript: unknown;
          job_id: string;
          candidate_id: string;
          voice_session_id: string;
        }>(sql`
          select n.status, n.attempts, n.created_at::text, n.zoho_candidate_id, n.voice_session_id,
                 vs.status as vs_status, vs.failure_reason, vs.duration_seconds, vs.transcript,
                 vs.job_id, vs.candidate_id
          from zoho_notes n join voice_sessions vs on vs.id = n.voice_session_id
          where n.id = ${noteId} and n.organization_id = ${organizationId}
        `),
      );
      const row = rows[0];
      if (!row || row.status !== 'pending') return;
      if (at.getTime() - Date.parse(row.created_at) > NOTE_MAX_AGE_MS) return failNote(organizationId, noteId, 'expired');
      // Re-read the connection right before the write: a disconnect stops it at once.
      const conn = await loadConn(organizationId);
      if (!conn || conn.status !== 'connected') return failNote(organizationId, noteId, 'not_connected');
      if (conn.paused_until && Date.parse(conn.paused_until) > Date.now()) {
        throw new Error('zoho paused');
      }

      const a = { organizationId, userId: conn.created_by_user_id };
      const [job, packet] = await Promise.all([
        deps.jobs.get(a, row.job_id),
        deps.jobs.getCandidateResults(a, row.job_id, row.candidate_id),
      ]);
      const session = packet.sessions.find((s) => s.voiceSessionId === row.voice_session_id);
      if (!session) return failNote(organizationId, noteId, 'call_not_found');
      const result = toV1Result(session, false, false, { questions: job.screeningQuestions });
      const note = buildNote({
        jobTitle: job.title,
        startedAt: result.startedAt,
        durationSeconds: result.durationSeconds,
        outcome: callOutcome({
          status: row.vs_status,
          failure_reason: row.failure_reason,
          duration_seconds: row.duration_seconds,
          transcript: row.transcript,
        }),
        questions: job.screeningQuestions.map((q) => q.label),
        answers: result.answers,
        summary: result.summary,
        link: `${deps.webUrl.replace(/\/+$/, '')}/jobs/${row.job_id}/candidates?c=${row.candidate_id}`,
      });

      let code: string | null = null;
      try {
        await withToken(conn, (t) =>
          client().addNote(conn.recruit_base, t, { candidateId: row.zoho_candidate_id, ...note }),
        );
      } catch (error) {
        code = await recordFailure(conn, error);
      }
      const attempts = row.attempts + 1;
      const retry = code === 'rate_limited' || code === 'zoho_unreachable' || code === 'internal';
      const giveUp = code !== null && (!retry || attempts >= NOTE_MAX_ATTEMPTS);
      await tenant(sys, (tx) =>
        tx.execute(sql`
          update zoho_notes set
            status = ${code === null ? 'sent' : giveUp ? 'failed' : 'pending'},
            attempts = ${attempts}, last_error = ${code}, sent_at = ${code === null ? sql`now()` : sql`null`}
          where id = ${noteId} and organization_id = ${organizationId} and status = 'pending'
        `),
      );
      if (code !== null && !giveUp) throw new Error(`zoho note not sent: ${code}`);
    },

    async retryNotes(actor) {
      const rows = await tenant(actor, (tx) =>
        tx.execute<{ id: string }>(sql`
          update zoho_notes set status = 'pending', attempts = 0, last_error = null, created_at = now()
          where organization_id = ${actor.organizationId} and status = 'failed'
          returning id
        `),
      );
      for (const r of rows) await deps.queue?.enqueueZohoNote({ organizationId: actor.organizationId, noteId: r.id });
      return rows.length;
    },

    async disconnect(actor) {
      const removed = await tenant(actor, (tx) =>
        tx.execute<{ accounts_server: string; secrets_sealed: string }>(sql`
          delete from zoho_connections where organization_id = ${actor.organizationId}
          returning accounts_server, secrets_sealed
        `),
      );
      const old = removed[0];
      if (!old) return;
      await deps.audit.record({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        eventType: 'integration.zoho_disconnected',
      });
      // After commit, best effort: the token is useless to Zoho users once revoked.
      try {
        const secrets = JSON.parse(sealer.open(old.secrets_sealed)) as Secrets;
        await deps.client?.revoke(old.accounts_server, secrets.refreshToken);
      } catch {
        /* best effort */
      }
    },
  };
}
