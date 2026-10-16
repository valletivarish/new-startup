import type { HTMLAttributes, ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import { cn } from './cn';

/** The five status families of spec 2: badge pills, alert tints, icon tiles. */
export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

// No 'use client' here on purpose: server-rendered alerts read this map, and so do the client
// badge, error state and offline banner. Each family's text on its own tint is 4.5:1 or better.
/** Tint, 1px border and text colour per tone. */
export const STATUS_TONE: Record<StatusTone, string> = {
  neutral: 'border-status-neutral-border bg-status-neutral-bg text-status-neutral-text',
  info: 'border-status-info-border bg-status-info-bg text-status-info-text',
  success: 'border-status-success-border bg-status-success-bg text-status-success-text',
  warning: 'border-status-warning-border bg-status-warning-bg text-status-warning-text',
  danger: 'border-status-danger-border bg-status-danger-bg text-status-danger-text',
};

export type AlertKind = 'info' | 'success' | 'warning' | 'error';

const KINDS: Record<AlertKind, { tone: StatusTone; icon: LucideIcon }> = {
  info: { tone: 'info', icon: Info },
  success: { tone: 'success', icon: CircleCheck },
  warning: { tone: 'warning', icon: TriangleAlert },
  error: { tone: 'danger', icon: CircleAlert },
};

export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'role'> {
  /** No default on purpose. 'error' is announced at once (role alert), the rest politely (role status). */
  kind: AlertKind;
  title?: ReactNode;
  /** One control, such as a Retry button. Sits right of the text, below it on phones. */
  action?: ReactNode;
}

/** Inline alert: a 16px card tinted by kind, icon in the kind's colour, title, body, optional action. */
export function Alert({ kind, title, action, className, children, ...rest }: AlertProps) {
  const { tone, icon: Icon } = KINDS[kind];
  return (
    <div
      {...rest}
      role={kind === 'error' ? 'alert' : 'status'}
      // The tint's text colour reaches the icon only; the words stay in text and text-2.
      className={cn('flex gap-3 rounded-card-sm border px-4 py-3 text-body', STATUS_TONE[tone], className)}
    >
      {/* One line box tall, so the icon centres on the first line of text. */}
      <span className="flex h-5 shrink-0 items-center">
        <Icon aria-hidden strokeWidth={1.75} className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3 text-text sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          {title ? <p className="m-0 font-semibold">{title}</p> : null}
          {children ? <div className={title ? 'mt-0.5 text-text-2' : undefined}>{children}</div> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </div>
  );
}

// Strip Board names, still imported by pages awaiting rebuild.
export { Alert as Notice };
export type { AlertProps as NoticeProps, AlertKind as NoticeKind };
