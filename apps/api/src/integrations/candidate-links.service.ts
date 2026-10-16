/**
 * "Ask the candidate" links. A company mints a one-use link for a job; the candidate opens it,
 * gives their own consent and phone, and a call request (source 'link') is queued for them.
 * The token is 32 base62 characters, stored only as a SHA-256 hash, valid 7 days.
 */

import { sql, withTenantContext, withoutTenantContext, type Database } from '@platform/db';

import { ApiError } from '../errors.js';
import type { CandidatesService } from '../hiring/candidates.service.js';
import { hashKey, randomBase62 } from './api-keys.service.js';
import type { CallRequestsService } from './call-requests.service.js';

const LINK_TTL_MS = 7 * 24 * 3_600_000;
/** A chosen call time further out than this is refused. */
const MAX_AHEAD_MS = 30 * 24 * 3_600_000;

interface Actor {
  readonly organizationId: string;
  readonly userId: string;
}

type Link = {
  id: string;
  organization_id: string;
  job_id: string;
  candidate_id: string | null;
  created_by_user_id: string;
  is_test: boolean;
  full_name: string | null;
  email: string | null;
  expires_at: string;
  used_at: string | null;
};

export interface CandidateLinksService {
  create(
    actor: Actor & { isTest: boolean },
    jobId: string,
    input: { candidateId?: string; fullName?: string; email?: string },
  ): Promise<{ token: string; expiresAt: string }>;
  /** 404 when the token is unknown, used or expired. */
  describe(
    token: string,
  ): Promise<{ companyName: string; jobTitle: string; fullName: string | null; expiresAt: string }>;
  submit(
    token: string,
    input: { fullName: string; phone: string; countryCode: string; when: 'now' | Date },
  ): Promise<{ scheduledFor: string | null }>;
}

export function createCandidateLinksService(deps: {
  database: Database;
  candidates: Pick<CandidatesService, 'create'>;
  calls: Pick<CallRequestsService, 'request'>;
  now?: () => Date;
}): CandidateLinksService {
  const { database, candidates, calls } = deps;
  const now = deps.now ?? (() => new Date());
  const tenant = <T>(a: Actor, fn: Parameters<typeof withTenantContext<T>>[2]) =>
    withTenantContext(database.db, a, fn);

  /** The link behind a token, or 404. Same answer for unknown, used and expired. */
  async function open(token: string): Promise<Link> {
    const rows = await withoutTenantContext(database.db, (tx) =>
      tx.execute<Link>(sql`select * from resolve_candidate_link(${hashKey(token)})`),
    );
    const link = rows[0];
    if (!link || link.used_at !== null || new Date(link.expires_at) <= now()) {
      throw ApiError.notFound('Link');
    }
    return link;
  }

  const actorOf = (l: Link): Actor => ({
    organizationId: l.organization_id,
    userId: l.created_by_user_id,
  });

  return {
    async create(actor, jobId, input) {
      const token = randomBase62(32);
      const expiresAt = new Date(now().getTime() + LINK_TTL_MS);
      await tenant(actor, async (tx) => {
        const job = await tx.execute(sql`
          select 1 from jobs where id = ${jobId} and organization_id = ${actor.organizationId}`);
        if (job.length === 0) throw ApiError.notFound('Job');
        if (input.candidateId) {
          const cand = await tx.execute(sql`
            select 1 from candidates
            where id = ${input.candidateId} and job_id = ${jobId}
              and organization_id = ${actor.organizationId}`);
          if (cand.length === 0) throw ApiError.notFound('Candidate');
        }
        await tx.execute(sql`
          insert into candidate_links
            (organization_id, job_id, candidate_id, created_by_user_id, is_test,
             full_name, email, token_hash, expires_at)
          values (${actor.organizationId}, ${jobId}, ${input.candidateId ?? null},
                  ${actor.userId}, ${actor.isTest}, ${input.fullName ?? null},
                  ${input.email ?? null}, ${hashKey(token)}, ${expiresAt.toISOString()})`);
      });
      return { token, expiresAt: expiresAt.toISOString() };
    },

    async describe(token) {
      const link = await open(token);
      const rows = await tenant(actorOf(link), (tx) =>
        tx.execute<{ company: string; title: string }>(sql`
          select o.name as company, j.title
          from jobs j join organizations o on o.id = j.organization_id
          where j.id = ${link.job_id} and j.organization_id = ${link.organization_id}`),
      );
      if (!rows[0]) throw ApiError.notFound('Link');
      return {
        companyName: rows[0].company,
        jobTitle: rows[0].title,
        fullName: link.full_name,
        expiresAt: new Date(link.expires_at).toISOString(),
      };
    },

    async submit(token, input) {
      const link = await open(token);
      const a = actorOf(link);
      if (input.when !== 'now') {
        const ahead = input.when.getTime() - now().getTime();
        if (ahead <= 0 || ahead > MAX_AHEAD_MS) {
          throw ApiError.validation([{ field: 'when', message: 'Pick a time within the next 30 days' }]);
        }
      }

      // Claim first so two submissions cannot both queue a call; undone below on failure.
      const claimed = await tenant(a, (tx) =>
        tx.execute(sql`
          update candidate_links set used_at = now()
          where id = ${link.id} and organization_id = ${link.organization_id}
            and used_at is null and expires_at > now()
          returning id`),
      );
      if (claimed.length === 0) throw ApiError.notFound('Link');

      try {
        const candidateId = await tenant(a, async (tx) => {
          // The link's own candidate, else one already on this job with the same number.
          const found = link.candidate_id
            ? [{ id: link.candidate_id }]
            : await tx.execute<{ id: string }>(sql`
                select id from candidates
                where organization_id = ${link.organization_id} and job_id = ${link.job_id}
                  and phone = ${input.phone} limit 1`);
          if (!found[0]) return null;
          try {
            await tx.execute(sql`
              update candidates set
                full_name = ${input.fullName}, phone = ${input.phone},
                country_code = ${input.countryCode}, email = coalesce(${link.email}, email),
                consent_at = now(), consent_source = 'candidate', updated_at = now()
              where id = ${found[0].id} and organization_id = ${link.organization_id}`);
          } catch (error) {
            if ((error as { cause?: { code?: string } }).cause?.code === '23505') {
              throw ApiError.conflict('A candidate with this phone already exists on this job');
            }
            throw error;
          }
          return found[0].id;
        });
        const id =
          candidateId ??
          (
            await candidates.create(a, {
              jobId: link.job_id,
              fullName: input.fullName,
              phone: input.phone,
              countryCode: input.countryCode,
              ...(link.email ? { email: link.email } : {}),
              consentSource: 'candidate',
              isTest: link.is_test,
            })
          ).id;

        await calls.request(
          { ...a, apiKeyId: null, isTest: link.is_test },
          {
            jobId: link.job_id,
            candidateId: id,
            source: 'link',
            ...(input.when !== 'now' ? { notBefore: input.when } : {}),
          },
        );
        return { scheduledFor: input.when === 'now' ? null : input.when.toISOString() };
      } catch (error) {
        await tenant(a, (tx) =>
          tx.execute(sql`
            update candidate_links set used_at = null
            where id = ${link.id} and organization_id = ${link.organization_id}`),
        );
        throw error;
      }
    },
  };
}
