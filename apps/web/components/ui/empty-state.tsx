import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';
import { Agent } from '../brand/agent';
import type { AgentState } from '../brand/agent-draw';
import { cn } from './cn';

/**
 * The soft square behind an empty or error state's icon: 48px, 16px radius, subtle fill and
 * hairline. Pass a STATUS_TONE entry as className to tint it. Any icon inside is drawn 20px at
 * stroke 1.5, whatever size the caller gave it.
 */
export function IconTile({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-12 shrink-0 items-center justify-center rounded-card-sm border border-border bg-subtle text-text-2 [&_svg]:size-5 [&_svg]:[stroke-width:1.5]',
        className,
      )}
    >
      {children}
    </span>
  );
}

export interface EmptyStateProps {
  /** The one sentence: what is empty, said plainly. */
  title: ReactNode;
  /** Optional second line, such as how things arrive here. */
  description?: ReactNode;
  /** One action, or a small group of them. */
  action?: ReactNode;
  /** A Lucide icon for the tile, such as <Phone aria-hidden />. An inbox when left out. */
  icon?: ReactNode;
  /**
   * For empty states about calls or the agent itself: the agent's face, in this state, instead
   * of the icon tile. 'idle' while nothing has happened yet, 'missed' when calls didn't connect.
   */
  agent?: AgentState;
  /** 3 when the empty state sits inside a section that has its own h2. */
  headingLevel?: 2 | 3;
  className?: string;
}

/** Centred: a soft icon tile (or the agent), one sentence, an optional second line, the action. */
export function EmptyState({
  title,
  description,
  action,
  icon,
  agent,
  headingLevel = 2,
  className,
}: EmptyStateProps) {
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  return (
    <div className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      {agent ? <Agent size={56} state={agent} colour="glass" onLight /> : <IconTile>{icon ?? <Inbox />}</IconTile>}
      <Heading className="mb-0 mt-4 text-md font-semibold text-text">{title}</Heading>
      {description ? <p className="mb-0 mt-1 max-w-[48ch] text-text-2">{description}</p> : null}
      {action ? <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}
