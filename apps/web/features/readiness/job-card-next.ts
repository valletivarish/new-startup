import { jobReadiness } from '../../components/jobs/setup';
import type { Agent, Job } from '../../lib/api';
import type { JobFunnel } from '../../lib/hiring-people';
import { toPublicId } from '../../lib/public-id';
import { nextAction, type NextAction } from './next-action';

export interface JobCardContext {
  /** The one agents list; undefined while it loads, failed, or this person can't read agents. */
  agents: readonly Pick<Agent, 'id' | 'status'>[] | undefined;
  /** This job's people from the list's funnels; undefined when unknown. */
  funnel: JobFunnel | undefined;
}

const NO_PEOPLE = { total: 0, notCalled: 0, notConnected: 0, toReview: 0 };

/**
 * The Next line for a job card from data the list already holds (no per-job request).
 * null only for a closed job. Anything we can't know falls back to "Open the job",
 * never to a blank cell.
 */
export function jobCardNext(job: Job, ctx: JobCardContext): NextAction | null {
  if (job.status === 'closed') return null;
  const id = toPublicId(job.id);
  const agentLive = !job.agentId
    ? false
    : ctx.agents
      ? ctx.agents.some((a) => a.id === job.agentId && a.status === 'published')
      : null;
  const r = jobReadiness(job, [], agentLive);
  if (r.description === 'missing') return nextAction(r, NO_PEOPLE, id);
  if (r.agent === 'checking') return { label: 'Open the job', href: `/jobs/${id}`, tab: 'people' };
  if (r.agent !== 'live') return nextAction(r, NO_PEOPLE, id);
  if (!ctx.funnel) return { label: 'Open the job', href: `/jobs/${id}`, tab: 'people' };
  return nextAction(r, ctx.funnel, id);
}
