/**
 * Own voice loop — the Nest side of apps/voice.
 *
 *   getCallPlan       apps/voice asks what to say on a call it just received
 *                     (by the carrier's call id). Only a recent, still-live
 *                     own-loop session answers; anything else is 404.
 *   saveCallResult    apps/voice posts the transcript + usage when a call ends;
 *                     we extract answers/summary and price the call.
 *   refreshCarrier    the carrier's status callback: final status, length and
 *                     billed price come from the carrier's API, never the body.
 *
 * Every lookup by call id runs under the conversation-id policy (0022); every
 * write runs under the session's own organization.
 */

import {
  sql,
  withConversationLookupContext,
  withTenantContext,
  type Database,
} from '@platform/db';
import type { Env } from '../../config.js';
import { ApiError } from '../../errors.js';
import type { CostService, LoopUsage } from '../../costs/costs.service.js';
import { extractScreeningResult } from '../../hiring/screening-extract.js';

const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000';
/** A stream must open within this long of the dial, or the call id is stale. */
const PLAN_WINDOW_SECONDS = 600;

/** Carrier view of one call, normalized by the carrier adapter. */
export interface CarrierCallOutcome {
  /** null while the call is still in progress. */
  final: boolean;
  failureReason: 'no_answer' | 'busy' | 'network' | null;
  durationSeconds: number | null;
  priceInr: number | null;
}

export interface CallCarrier {
  getCallOutcome(callId: string): Promise<CarrierCallOutcome>;
}

export interface CallPlan {
  voiceSessionId: string;
  engine: string;
  language: string;
  prompt: string;
  firstMessage: string;
  voiceId: string | null;
  questions: { id: string; label: string }[];
  maxCallSeconds: number;
}

export type EndedReason =
  | 'completed'
  | 'candidate_hung_up'
  | 'silence'
  | 'voicemail'
  | 'max_duration'
  | 'engine_error';

export interface CallResult {
  transcript: { role: 'agent' | 'user'; message: string }[];
  durationSeconds: number;
  endedReason: EndedReason;
  usage: LoopUsage;
}

export interface OwnLoopService {
  getCallPlan(callId: string): Promise<CallPlan>;
  saveCallResult(callId: string, result: CallResult): Promise<void>;
  refreshCarrier(callId: string): Promise<void>;
}

type SessionRow = {
  id: string;
  organization_id: string;
  status: string;
  engine: string;
  provider: string;
  provision_snapshot: Record<string, unknown> | null;
  age_seconds: string;
};

export function createOwnLoopService(
  database: Database,
  env: Env,
  costs: Pick<CostService, 'recordCallCost'>,
  carrier: CallCarrier | null,
  /** Call ended: emits the client webhook event. Must not throw. */
  onCallEnded: (organizationId: string, voiceSessionId: string) => Promise<void> = async () => {},
): OwnLoopService {
  async function lookup(callId: string): Promise<SessionRow | null> {
    if (!callId.trim()) return null;
    const rows = await withConversationLookupContext(database.db, callId, (tx) =>
      tx.execute<SessionRow>(sql`
        select id, organization_id, status, engine, provider, provision_snapshot,
               extract(epoch from now() - started_at)::text as age_seconds
        from voice_sessions
        where external_conversation_id = ${callId}
        limit 1
      `),
    );
    const row = rows[0];
    return row && row.provider === 'own_loop' ? row : null;
  }

  const asOrg = <T>(organizationId: string, fn: Parameters<typeof withTenantContext<T>>[2]) =>
    withTenantContext(database.db, { organizationId, userId: SYSTEM_ACTOR_ID }, fn);

  async function priceWithCarrier(row: SessionRow, callId: string): Promise<void> {
    if (!carrier) return;
    try {
      const outcome = await carrier.getCallOutcome(callId);
      if (outcome.final && outcome.priceInr !== null) {
        await costs.recordCallCost(row.organization_id, row.id, {
          telephonyBilledInr: outcome.priceInr,
        });
      }
    } catch {
      /* billed price arrives later via the status callback */
    }
  }

  return {
    async getCallPlan(callId) {
      const row = await lookup(callId);
      if (
        !row ||
        !['pending', 'active'].includes(row.status) ||
        Number(row.age_seconds) > PLAN_WINDOW_SECONDS
      ) {
        throw ApiError.notFound('Call');
      }
      const snap = row.provision_snapshot ?? {};
      const criteria = Array.isArray(snap['evaluationCriteria']) ? snap['evaluationCriteria'] : [];
      await asOrg(row.organization_id, (tx) =>
        tx.execute(sql`
          update voice_sessions set status = 'active'
          where id = ${row.id} and organization_id = ${row.organization_id} and status = 'pending'
        `),
      );
      return {
        voiceSessionId: row.id,
        engine: row.engine,
        language: String(snap['screeningLanguage'] ?? 'en'),
        prompt: String(snap['agentPrompt'] ?? ''),
        firstMessage: String(snap['firstMessage'] ?? ''),
        voiceId: typeof snap['voiceId'] === 'string' ? snap['voiceId'] : null,
        questions: criteria
          .filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === 'object')
          .map((c) => ({ id: String(c['id'] ?? ''), label: String(c['label'] ?? '') }))
          .filter((q) => q.id && q.label),
        maxCallSeconds: env.VOICE_MAX_CALL_SECONDS,
      };
    },

    async saveCallResult(callId, result) {
      const row = await lookup(callId);
      if (!row) throw ApiError.notFound('Call');
      const failed = result.endedReason === 'engine_error';
      const failureReason =
        result.endedReason === 'voicemail' ? 'voicemail' : failed ? 'engine_error' : null;
      const transcript = result.transcript.filter((t) => t.message.trim());

      await asOrg(row.organization_id, (tx) =>
        tx.execute(sql`
          update voice_sessions set
            status = ${failed ? 'failed' : 'ended'},
            failure_reason = coalesce(${failureReason}, failure_reason),
            transcript = ${JSON.stringify(transcript)}::jsonb,
            duration_seconds = ${Math.max(0, Math.round(result.durationSeconds))},
            ended_at = coalesce(ended_at, now()),
            webhook_received_at = now()
          where id = ${row.id} and organization_id = ${row.organization_id}
        `),
      );

      const snap = row.provision_snapshot ?? {};
      const questions = (Array.isArray(snap['evaluationCriteria']) ? snap['evaluationCriteria'] : [])
        .filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === 'object')
        .map((c) => ({ id: String(c['id'] ?? ''), label: String(c['label'] ?? '') }));
      const extracted = await extractScreeningResult(
        { questions, transcript, language: String(snap['screeningLanguage'] ?? 'en') },
        { apiKey: env.GEMINI_API_KEY, baseUrl: env.GEMINI_BASE_URL, model: env.GEMINI_MODEL },
      );
      if (extracted.summary || Object.keys(extracted.answers).length > 0) {
        await asOrg(row.organization_id, (tx) =>
          tx.execute(sql`
            update voice_sessions set
              summary = ${extracted.summary},
              structured_answers = ${JSON.stringify(extracted.answers)}::jsonb
            where id = ${row.id} and organization_id = ${row.organization_id}
          `),
        );
      }

      await costs.recordCallCost(row.organization_id, row.id, { usage: result.usage });
      await onCallEnded(row.organization_id, row.id);
      await priceWithCarrier(row, callId);
    },

    async refreshCarrier(callId) {
      const row = await lookup(callId);
      if (!row || !carrier) return;
      const outcome = await carrier.getCallOutcome(callId);
      if (!outcome.final) return;
      if (outcome.failureReason && ['pending', 'active'].includes(row.status)) {
        await asOrg(row.organization_id, (tx) =>
          tx.execute(sql`
            update voice_sessions set
              status = 'failed',
              failure_reason = ${outcome.failureReason},
              duration_seconds = coalesce(duration_seconds, ${outcome.durationSeconds}),
              ended_at = coalesce(ended_at, now())
            where id = ${row.id} and organization_id = ${row.organization_id}
          `),
        );
        await onCallEnded(row.organization_id, row.id);
      }
      await costs.recordCallCost(row.organization_id, row.id, {
        telephonyBilledInr: outcome.priceInr,
      });
    },
  };
}
