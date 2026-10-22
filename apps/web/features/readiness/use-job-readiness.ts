import { useQuery } from '@tanstack/react-query';
import { jobReadiness, lineState, type Readiness } from '../../components/jobs/setup';
import { getAgent, getJob, getTelephonyStatus, listJobCandidates, listJobKnowledge, type Job } from '../../lib/api';
import { fromPublicId, toPublicId } from '../../lib/public-id';
import { useMe } from '../../lib/use-me';
import { nextAction, type JobCounts, type NextAction } from './next-action';

// ponytail: counts come from the first 100 people (the API has no "answered" total yet);
// the server readiness slice replaces this with one call.
const COUNT_PAGE = 100;

/**
 * One definition of "is this job ready, and what is next": the existing pure `jobReadiness`
 * fed by shared queries, so the tabs, the Next banner and the job cards cannot disagree.
 * `jobId` may be the public or the raw id.
 */
export function useJobReadiness(jobId: string): {
  readiness: Readiness | undefined;
  next: NextAction | undefined;
  counts: JobCounts | undefined;
  job: Job | undefined;
  isLoading: boolean;
} {
  const id = fromPublicId(jobId) ?? jobId;
  const me = useMe();
  const permissions = me.data?.activeOrganization?.permissions ?? [];
  const canCheckLine = permissions.includes('calls.initiate') || permissions.includes('agents.test');

  const job = useQuery({ queryKey: ['job', id], queryFn: () => getJob(id), staleTime: 10_000 });
  const knowledge = useQuery({
    queryKey: ['job-knowledge', id],
    queryFn: () => listJobKnowledge(id).then((r) => r.sources),
    staleTime: 10_000,
  });
  const agentId = job.data?.agentId ?? null;
  const agent = useQuery({
    queryKey: ['agent', agentId],
    queryFn: () => getAgent(agentId as string),
    enabled: agentId !== null,
    staleTime: 10_000,
  });
  const telephony = useQuery({ queryKey: ['telephony-status'], queryFn: getTelephonyStatus, enabled: canCheckLine });
  const people = useQuery({
    queryKey: ['job-people-counts', id],
    queryFn: async (): Promise<JobCounts> => {
      const r = await listJobCandidates(id, { limit: COUNT_PAGE });
      const answered = r.candidates.filter((c) => c.callStatus === 'completed');
      return {
        people: r.totals.all,
        answered: answered.length,
        undecided: answered.filter((c) => c.status === 'new').length,
      };
    },
    staleTime: 10_000,
  });

  const loading = job.isLoading || me.isLoading;
  if (!job.data) return { readiness: undefined, next: undefined, counts: people.data, job: undefined, isLoading: loading };

  const agentLive = agentId === null || agent.isLoading ? null : agent.isError ? null : agent.data?.status === 'published';
  const line = lineState(telephony.data?.outboundPhone, telephony.isError || (me.data != null && !canCheckLine));
  const readiness = jobReadiness(job.data, knowledge.data ?? [], agentLive, line);
  // While the agent or the counts are still loading nothing is claimed: no flipping banner.
  const next =
    readiness.agent === 'checking' || !people.data ? undefined : nextAction(readiness, people.data, toPublicId(id));
  return { readiness, next, counts: people.data, job: job.data, isLoading: loading };
}
