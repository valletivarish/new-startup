import Link from 'next/link';
import { BookOpen, BriefcaseBusiness, ChevronRight } from 'lucide-react';
import { cn } from '@/components/ui/cn';
import { IconTile } from '@/components/ui/empty-state';
import { useUseCase } from '@/lib/use-cases';

/**
 * Where the agent's words come from: each job's own questions and the company facts in
 * Knowledge. One link card each, for the pages this person can open. className sets the grid.
 */
export function AgentSources({
  can,
  className,
}: {
  can: (permission: string) => boolean;
  className?: string;
}) {
  const { labels } = useUseCase();
  const job = labels.workItem.one.toLowerCase();
  const items = [
    {
      href: '/jobs',
      icon: <BriefcaseBusiness />,
      title: `Each ${job}`,
      text: `The ${job} description and its must-ask questions, set on the ${job} itself.`,
      permission: 'jobs.read',
    },
    {
      href: '/knowledge',
      icon: <BookOpen />,
      title: 'Company facts',
      text: 'Policies, benefits and locations it can answer from on every call.',
      permission: 'knowledge.read',
    },
  ].filter((item) => can(item.permission));
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="agent-sources">
      <h2 id="agent-sources" className="m-0 text-section text-text">
        Where its words come from
      </h2>
      <ul role="list" className={cn('m-0 mt-4 grid list-none gap-3 p-0', className)}>
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="flex h-full items-start gap-4 rounded-card-sm border border-border bg-canvas p-4 transition-colors duration-fast hover:bg-subtle"
            >
              <IconTile className="size-10">{item.icon}</IconTile>
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-text">{item.title}</span>
                <span className="mt-0.5 block text-meta text-text-2">{item.text}</span>
              </span>
              <ChevronRight aria-hidden strokeWidth={1.5} className="mt-0.5 size-4 shrink-0 text-text-3" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
