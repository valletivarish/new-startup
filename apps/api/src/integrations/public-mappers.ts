/**
 * Whitelist mappers for the public API. Fields are copied one by one, so a new
 * internal column (or fitPercent, or any score) can never leak by accident.
 */

import type { CandidateRow } from '../hiring/candidates.service.js';
import type {
  CandidateScreeningResults,
  JobRow,
  ScreeningQuestion,
} from '../hiring/jobs.service.js';
import { scrubHireAdvice } from '../hiring/review-chat.js';
import { dataCollectionKey } from '../providers/elevenlabs/provision-config.js';
import type { V1Candidate, V1Job } from './v1-schemas.js';

export interface V1Result {
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  answers: { questionId: string; question: string; answer: unknown }[];
  summary: string | null;
  transcript?: { role?: string; message?: string }[];
  recordingUrl?: string;
  failureReason?: string;
}

/** Client-facing recording link; the client fetches it with its API key. */
export function recordingLink(apiUrl: string, callId: string): string {
  return `${apiUrl.replace(/\/$/, '')}/v1/calls/${callId}/recording`;
}

export function toV1Job(row: JobRow): V1Job {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    language: row.screeningLanguage,
    questions: row.screeningQuestions.map((q) => ({ id: q.id, text: q.label })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Without `allowPii` (candidates.read_pii) phone, email and countryCode are null. */
export function toV1Candidate(row: CandidateRow, allowPii: boolean): V1Candidate {
  return {
    id: row.id,
    jobId: row.jobId,
    externalId: row.externalId,
    fullName: row.fullName,
    phone: allowPii ? row.phone : null,
    countryCode: allowPii ? row.countryCode : null,
    email: allowPii ? row.email : null,
    status: row.screeningStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** `opts.questions` labels the answers; `opts.recordingUrl` is the caller's signed link. */
export function toV1Result(
  r: CandidateScreeningResults,
  allowTranscript: boolean,
  allowRecording: boolean,
  opts: { questions?: readonly ScreeningQuestion[]; recordingUrl?: string } = {},
): V1Result {
  const raw = r.structuredAnswers ?? {};
  const answers = (opts.questions ?? []).flatMap((q) => {
    const answer = raw[dataCollectionKey(q.label)] ?? raw[dataCollectionKey(q.id)] ?? raw[q.id];
    return answer == null ? [] : [{ questionId: q.id, question: q.label, answer }];
  });
  const ended =
    r.startedAt && r.durationSeconds != null
      ? new Date(Date.parse(r.startedAt) + r.durationSeconds * 1000).toISOString()
      : null;
  return {
    status: r.status ?? 'pending',
    startedAt: r.startedAt,
    endedAt: ended,
    durationSeconds: r.durationSeconds,
    answers,
    summary: r.summary ? scrubHireAdvice(r.summary) : null,
    ...(allowTranscript && r.transcript ? { transcript: [...r.transcript] } : {}),
    ...(allowRecording && r.recordingAvailable && opts.recordingUrl
      ? { recordingUrl: opts.recordingUrl }
      : {}),
    ...(r.status === 'failed' ? { failureReason: 'call_failed' } : {}),
  };
}
