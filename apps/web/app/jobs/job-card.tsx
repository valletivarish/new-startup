import Link from 'next/link';
import { ListCell, ListRow, ListRowPrimary } from '../../components/ui/strip';
import { StatusTag } from '../../components/ui/state-tag';
import { useJobReadiness } from '../../features/readiness/use-job-readiness';
import type { NextAction } from '../../features/readiness/next-action';
import type { Job } from '../../lib/api';
import { formatWhen } from '../../lib/format';
import { formatJobPeopleSummary, type JobFunnel } from '../../lib/hiring-people';
import { toPublicId } from '../../lib/public-id';

interface Noun {
  one: string;
  many: string;
}

/** One job: who is on it, its status, and the single Next: line. The title opens the job's opening tab. */
export function JobCard({
  job,
  funnel,
  next,
  contact,
}: {
  job: Job;
  funnel: JobFunnel | undefined;
  /** undefined while it loads, or when it can't be known (closed job, no access to people). */
  next: NextAction | undefined;
  contact: Noun;
}) {
  const questions = job.screeningQuestions?.length ?? 0;
  const created = formatWhen(job.createdAt);
  const meta = [
    questions > 0 ? `${questions} ${questions === 1 ? 'question' : 'questions'}` : null,
    created ? `Created ${created}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <ListRow>
      <ListRowPrimary title={job.title} meta={meta || undefined} href={`/jobs/${toPublicId(job.id)}`} />
      {/* Unknown (no access to people, or a closed job) stays empty, never "No people yet". */}
      <ListCell className="max-md:hidden">{formatJobPeopleSummary(funnel, contact)}</ListCell>
      <ListCell className="text-text">
        {next ? (
          <>
            <span className="text-text-2">Next: </span>
            {/* relative: above the title link's row-wide overlay, so this link takes its own taps. */}
            <Link
              href={next.href}
              className="relative font-medium text-accent underline underline-offset-4 inline-flex min-h-11 items-center"
            >
              {next.label}
            </Link>
          </>
        ) : null}
      </ListCell>
      <ListCell kind="tag">
        <StatusTag domain="job" value={job.status} />
      </ListCell>
    </ListRow>
  );
}

/** The card with its Next line from the shared readiness hook; a closed job has no next step. */
export function JobCardWithNext({ job, funnel, contact }: { job: Job; funnel: JobFunnel | undefined; contact: Noun }) {
  const { next } = useJobReadiness(job.id);
  return <JobCard job={job} funnel={funnel} next={job.status === 'closed' ? undefined : next} contact={contact} />;
}
