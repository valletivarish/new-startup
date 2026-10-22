import { useQuery } from '@tanstack/react-query';
import { ListRows } from '../../components/ui/strip';
import { jobCardNext } from '../../features/readiness/job-card-next';
import { listAgents, type Job } from '../../lib/api';
import type { JobFunnel } from '../../lib/hiring-people';
import { useMe } from '../../lib/use-me';
import { useUseCase } from '../../lib/use-cases';
import { JobCard } from './job-card';

/**
 * Every job as a row. All Next lines come from the list's own data plus ONE agents query,
 * so the request count does not grow with the number of jobs.
 */
export function JobList({ jobs, funnels }: { jobs: Job[]; funnels: Record<string, JobFunnel> }) {
  const { labels } = useUseCase();
  const me = useMe();
  const canReadAgents = me.data?.activeOrganization?.permissions.includes('agents.read') ?? false;
  const agents = useQuery({ queryKey: ['agents', 'list'], queryFn: listAgents, enabled: canReadAgents, staleTime: 30_000 });
  const contact = { one: labels.contact.one.toLowerCase(), many: labels.contact.many.toLowerCase() };
  return (
    <ListRows
      aria-label={labels.workItem.many}
      columns="minmax(0,1.2fr) minmax(0,1.6fr) minmax(0,0.9fr) auto"
      header={
        <>
          <span>{labels.workItem.one}</span>
          <span>{labels.contact.many}</span>
          <span>Next</span>
          <span>Status</span>
        </>
      }
    >
      {jobs.map((job) => (
        <JobCard
          key={job.id}
          job={job}
          funnel={funnels[job.id]}
          next={jobCardNext(job, { agents: agents.data?.agents, funnel: funnels[job.id] })}
          contact={contact}
        />
      ))}
    </ListRows>
  );
}
