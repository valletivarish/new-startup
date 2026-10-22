import type { Job, JobKnowledgeSource } from '../../lib/api';
import { requirementLines } from '../candidates/fit';

/**
 * Whether a job is ready for calls, from saved data only: text typed but not saved never
 * counts. Mirrors the backend (CallContextCompiler): a description of 20 characters or more
 * goes into every call, and so do files attached to the job.
 */

export const MIN_DESCRIPTION = 20;

/** Calls for this job carry its description: saved text of 20+ characters, or attached files. */
export function hasJobDescription(job: Pick<Job, 'description' | 'hasJdDocs'>): boolean {
  return job.hasJdDocs || (job.description ?? '').trim().length >= MIN_DESCRIPTION;
}

/** The questions as they will be saved: trimmed, blanks dropped. */
export function cleanQuestions(questions: readonly string[]): string[] {
  return questions.map((q) => q.trim()).filter(Boolean);
}

export function sameQuestions(a: readonly string[], b: readonly string[]): boolean {
  const x = cleanQuestions(a);
  const y = cleanQuestions(b);
  return x.length === y.length && x.every((q, i) => q === y[i]);
}

export interface Readiness {
  /** preparing: only files, still being read. */
  description: 'saved' | 'preparing' | 'missing';
  questions: number;
  /** How many requirements calls are checked against (optional). */
  requirements: number;
  /** checking: the agent's status hasn't loaded yet. */
  agent: 'live' | 'not-live' | 'missing' | 'checking';
  /** The workspace's calling number, as the telephony status reports it. unknown: it couldn't be read. */
  line: 'connected' | 'not-connected' | 'checking' | 'unknown';
  status: string;
  /** The description is in and the agent is live: test calls can start. */
  ready: boolean;
  /** Ready, and the calling number is connected: phone calls can start too. */
  phoneReady: boolean;
}

/**
 * Whether the workspace can place phone calls: telephony status outboundPhone. null while loading.
 * unknown when it couldn't be read, or this person may not check it: nothing then claims either way.
 */
export function lineState(outboundPhone: boolean | null | undefined, failed = false): Readiness['line'] {
  if (failed) return 'unknown';
  return outboundPhone == null ? 'checking' : outboundPhone ? 'connected' : 'not-connected';
}

export function jobReadiness(
  job: Pick<Job, 'description' | 'hasJdDocs' | 'agentId' | 'status' | 'screeningQuestions' | 'requirements'>,
  sources: readonly Pick<JobKnowledgeSource, 'readyDocs' | 'pendingDocs'>[],
  agentLive: boolean | null,
  line: Readiness['line'] = 'checking',
): Readiness {
  const description =
    hasJobDescription(job) || sources.some((s) => s.readyDocs > 0)
      ? 'saved'
      : sources.some((s) => s.pendingDocs > 0)
        ? 'preparing'
        : 'missing';
  const agent = !job.agentId ? 'missing' : agentLive === null ? 'checking' : agentLive ? 'live' : 'not-live';
  const ready = description === 'saved' && agent === 'live';
  return {
    description,
    questions: job.screeningQuestions?.length ?? 0,
    requirements: requirementLines(job.requirements).length,
    agent,
    line,
    status: job.status,
    ready,
    phoneReady: ready && line === 'connected',
  };
}

function joinAnd(parts: string[]): string {
  return parts.length < 2 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/** The job's status in words: an open job without a calling number can only take test calls. */
export function jobStatusLabel(r: Pick<Readiness, 'status' | 'line'>): string | null {
  return r.status === 'open' && r.line !== 'connected' && r.line !== 'checking' ? 'Active · browser test calls only' : null;
}

/** One line for the job's header. Null while the agent or the line is still being checked, so it never flips. */
export function readinessLine(r: Readiness): string | null {
  if (r.agent === 'checking' || r.line === 'checking') return null;
  if (r.status === 'closed') return 'This job is closed.';
  if (r.phoneReady) {
    return r.status === 'open' ? 'Ready for calls.' : 'Set up for calls. Make the job active when you start calling.';
  }
  if (r.ready) {
    const why =
      r.line === 'unknown'
        ? 'Test calls in your browser work now. Phone calls need your calling number connected.'
        : 'Phone calls start once your calling number is connected. Test calls in your browser work now.';
    return r.status === 'open' ? why : `${why} Make the job active when you start calling.`;
  }
  const todo: string[] = [];
  if (r.description === 'missing') todo.push('add the job description');
  if (r.description === 'preparing') todo.push('wait for the description file to be read');
  if (r.agent === 'missing') todo.push('choose the AI hiring agent');
  if (r.agent === 'not-live') todo.push('publish the AI hiring agent');
  return `Before calling, ${joinAnd(todo)}.`;
}
