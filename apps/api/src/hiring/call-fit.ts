/**
 * After a call ends: score it against the job's requirements, store the fit, and, when the
 * company turned on auto-advance and the candidate meets all requirements, move them forward
 * (the same stage change as the "Move forward" button), audited as an automatic action.
 *
 * Runs once per session (skips when a fit is already stored). Never throws: a call's result
 * is saved regardless; a failed fit just shows as not scored.
 */

import { sql, withTenantContext, type Database } from '@platform/db';

import type { AuditService } from '../audit/audit.service.js';
import type { JobsService } from './jobs.service.js';
import { evaluateFit, parseStoredRequirements, type CallFit, type FitTurn, type GeminiDeps } from './requirements.js';

const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000';

export interface CallFitDeps {
  database: Database;
  gemini: GeminiDeps;
  jobs: Pick<JobsService, 'updateCandidateStatuses'>;
  audit: AuditService;
}

type Row = {
  status: string;
  job_id: string | null;
  candidate_id: string | null;
  transcript: unknown;
  structured_answers: unknown;
  provision_snapshot: Record<string, unknown> | null;
  fit: unknown;
  job_requirements: unknown;
  candidate_status: string | null;
  auto_advance: boolean | null;
};

/** Must-ask answers keyed by the question as asked (own loop stores q1.., the baseline slugs). */
function answersByLabel(raw: unknown, snapshot: Record<string, unknown> | null): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const labels = new Map<string, string>();
  for (const c of Array.isArray(snapshot?.['evaluationCriteria']) ? snapshot['evaluationCriteria'] : []) {
    if (c && typeof c === 'object') labels.set(String((c as Record<string, unknown>)['id']), String((c as Record<string, unknown>)['label']));
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const value = typeof v === 'string' ? v : v && typeof v === 'object' ? String((v as Record<string, unknown>)['value'] ?? '') : '';
    if (value.trim()) out[labels.get(k) ?? k] = value.trim();
  }
  return out;
}

export async function recordCallFit(
  deps: CallFitDeps,
  organizationId: string,
  voiceSessionId: string,
): Promise<CallFit | null> {
  try {
    const asOrg = <T>(fn: Parameters<typeof withTenantContext<T>>[2]) =>
      withTenantContext(deps.database.db, { organizationId, userId: SYSTEM_ACTOR_ID }, fn);
    const rows = await asOrg((tx) =>
      tx.execute<Row>(sql`
        select vs.status, vs.job_id, vs.candidate_id, vs.transcript, vs.structured_answers,
               vs.provision_snapshot, vs.fit, j.requirements as job_requirements,
               c.screening_status as candidate_status, o.auto_advance_meets_all as auto_advance
        from voice_sessions vs
        left join jobs j on j.id = vs.job_id and j.organization_id = vs.organization_id
        left join candidates c on c.id = vs.candidate_id and c.organization_id = vs.organization_id
        left join organizations o on o.id = vs.organization_id
        where vs.id = ${voiceSessionId} and vs.organization_id = ${organizationId}
      `),
    );
    const row = rows[0];
    if (!row || row.status !== 'ended' || !row.job_id || row.fit !== null) return null;

    // The requirements frozen at call start; sessions from before 0035 read the job's.
    const snap = row.provision_snapshot;
    const requirements = parseStoredRequirements(
      snap && 'requirements' in snap ? snap['requirements'] : row.job_requirements,
    );
    if (!requirements) return null;

    const transcript: FitTurn[] = Array.isArray(row.transcript)
      ? row.transcript
          .filter((t): t is Record<string, unknown> => Boolean(t) && typeof t === 'object')
          .map((t) => ({
            role: String(t['role'] ?? ''),
            message: String(t['message'] ?? ''),
            ...(typeof t['timeInCallSecs'] === 'number' ? { timeInCallSecs: t['timeInCallSecs'] } : {}),
          }))
      : [];
    const fit = await evaluateFit(
      { requirements, transcript, answers: answersByLabel(row.structured_answers, snap) },
      deps.gemini,
    );
    if (!fit) return null;

    await asOrg((tx) =>
      tx.execute(sql`
        update voice_sessions set fit = ${JSON.stringify(fit)}::jsonb
        where id = ${voiceSessionId} and organization_id = ${organizationId} and fit is null
      `),
    );

    // Only an undecided candidate moves: a person's hold or decision always stands.
    if (row.auto_advance && fit.overall === 'meets_all' && row.candidate_id && row.candidate_status === 'new') {
      const [moved] = await deps.jobs.updateCandidateStatuses(
        { organizationId, userId: SYSTEM_ACTOR_ID },
        row.job_id,
        [{ candidateId: row.candidate_id, status: 'reviewed' }],
      );
      if (moved && moved.previous !== moved.status) {
        await deps.audit.record({
          organizationId,
          actorUserId: null,
          eventType: 'hiring.candidate_status_changed',
          resourceType: 'candidate',
          resourceId: row.candidate_id,
          metadata: {
            jobId: row.job_id,
            from: moved.previous,
            to: moved.status,
            reason: `Moved forward automatically: met all ${fit.items.length} requirement${fit.items.length === 1 ? '' : 's'}`,
            automatic: true,
            voiceSessionId,
            fitOverall: fit.overall,
            fit: JSON.stringify(fit),
          },
        });
      }
    }
    return fit;
  } catch {
    return null;
  }
}
