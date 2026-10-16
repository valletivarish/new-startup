import type { Job, JobKnowledgeSource } from '../../lib/api';

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
  /** checking: the agent's status hasn't loaded yet. */
  agent: 'live' | 'not-live' | 'missing' | 'checking';
  status: string;
  /** The description is in and the agent is live: calls can start. */
  ready: boolean;
}

export function jobReadiness(
  job: Pick<Job, 'description' | 'hasJdDocs' | 'agentId' | 'status' | 'screeningQuestions'>,
  sources: readonly Pick<JobKnowledgeSource, 'readyDocs' | 'pendingDocs'>[],
  agentLive: boolean | null,
): Readiness {
  const description =
    hasJobDescription(job) || sources.some((s) => s.readyDocs > 0)
      ? 'saved'
      : sources.some((s) => s.pendingDocs > 0)
        ? 'preparing'
        : 'missing';
  const agent = !job.agentId ? 'missing' : agentLive === null ? 'checking' : agentLive ? 'live' : 'not-live';
  return {
    description,
    questions: job.screeningQuestions?.length ?? 0,
    agent,
    status: job.status,
    ready: description === 'saved' && agent === 'live',
  };
}

function joinAnd(parts: string[]): string {
  return parts.length < 2 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/** One line for the job's header. Null while the agent is still being checked, so it never flips. */
export function readinessLine(r: Readiness): string | null {
  if (r.agent === 'checking') return null;
  if (r.status === 'closed') return 'This job is closed.';
  if (r.ready) {
    return r.status === 'open' ? 'Ready for calls.' : 'Set up for calls. Open the job when you start calling.';
  }
  const todo: string[] = [];
  if (r.description === 'missing') todo.push('add the job description');
  if (r.description === 'preparing') todo.push('wait for the description file to be read');
  if (r.agent === 'missing') todo.push('choose the AI hiring agent');
  if (r.agent === 'not-live') todo.push('publish the AI hiring agent');
  return `Before calling, ${joinAnd(todo)}.`;
}
