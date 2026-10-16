import Link from 'next/link';
import { BRAND } from '../../lib/brand';
import { cn } from '../ui/cn';
import { Agent } from './agent';
import type { AgentState } from './agent-draw';

const PX = {
  sm: 20, // inline
  md: 28, // brand row, card headers
  lg: 40, // transcript card avatar, auth panel
  xl: 72, // a large standalone mark
} as const;

export type LogoMarkSize = keyof typeof PX;

/**
 * The brand mark is the AI agent itself (./agent): the glass character, in ink glass for the
 * app's light surfaces (the website draws it in pearl on the sky and the black). Decorative;
 * the wordmark or a label names it. `live`: its eyes follow the pointer and it lifts under it,
 * as the website's nav mark does. Pass `state` only where it mirrors a real call.
 */
export function LogoMark({
  size = 'md',
  state,
  live = false,
  className,
}: {
  size?: LogoMarkSize;
  state?: AgentState;
  live?: boolean;
  className?: string;
}) {
  return (
    <Agent
      size={PX[size]}
      state={state}
      colour="glass"
      onLight
      follow={live}
      hoverable={live}
      className={className}
    />
  );
}

export interface BrandLinkProps {
  href?: string;
  className?: string;
  /** 'hero' is a retired size name; it draws lg. */
  markSize?: LogoMarkSize | 'hero';
  /** @deprecated The mark is always alive (reduced motion keeps it still). Ignored. */
  animate?: boolean;
  labelClassName?: string;
}

/** The agent and the wordmark, Geist 600, as a link (home by default). The name comes from lib/brand. */
export function BrandLink({ href = '/', className, markSize = 'md', labelClassName }: BrandLinkProps) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex min-h-11 min-w-0 items-center gap-2.5 rounded-input text-title font-semibold tracking-tight text-text no-underline',
        className,
      )}
    >
      <LogoMark size={markSize === 'hero' ? 'lg' : markSize} live />
      <span className={cn('truncate', labelClassName)}>{BRAND.name}</span>
    </Link>
  );
}
