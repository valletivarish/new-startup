'use client';

import { useEffect, useId, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { formatWhen } from '@/lib/format';
import type { SupportMessage } from '@/lib/support';

/**
 * A support conversation. `viewer` decides which side is "you": the customer's own messages sit
 * right in Get help, the team's sit right in the founder's inbox. New messages are announced
 * politely; the list keeps the latest in view without animating the scroll.
 */
export function Thread({
  messages,
  viewer,
  customerName = 'Customer',
  className,
}: {
  messages: readonly SupportMessage[];
  viewer: 'customer' | 'staff';
  customerName?: string;
  className?: string;
}) {
  const end = useRef<HTMLLIElement>(null);
  const last = messages[messages.length - 1]?.id;
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [last]);

  return (
    <ol role="log" aria-live="polite" aria-label="Conversation" className={cn('m-0 grid list-none gap-3 p-0', className)}>
      {messages.map((m) => {
        if (m.authorKind === 'system') {
          return (
            <li key={m.id} className="mx-auto max-w-[36ch] text-center text-meta text-text-3">
              {m.body}
            </li>
          );
        }
        const mine = m.authorKind === viewer;
        const who = m.authorKind === 'staff' ? (viewer === 'staff' ? 'You' : 'HRVoice support') : viewer === 'customer' ? 'You' : customerName;
        return (
          <li key={m.id} className={cn('flex max-w-[85%] flex-col gap-1', mine ? 'ml-auto items-end' : 'items-start')}>
            <span className="text-caption text-text-3">
              {who} · <time dateTime={m.createdAt}>{formatWhen(m.createdAt)}</time>
            </span>
            <p
              className={cn(
                'm-0 whitespace-pre-wrap break-words rounded-card px-3.5 py-2.5 text-body',
                mine ? 'bg-primary text-primary-foreground' : 'border border-border bg-subtle text-text',
              )}
            >
              {m.body}
            </p>
          </li>
        );
      })}
      <li ref={end} aria-hidden className="h-0" />
    </ol>
  );
}

/** Message box: Enter adds a line, Ctrl/⌘+Enter sends. */
export function Composer({
  label,
  placeholder,
  sending,
  onSend,
  autoFocus,
}: {
  label: string;
  placeholder?: string;
  sending: boolean;
  onSend: (body: string) => Promise<unknown>;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  async function send() {
    const body = ref.current?.value.trim() ?? '';
    if (!body || sending) return;
    await onSend(body).then(
      () => {
        if (ref.current) ref.current.value = '';
      },
      () => undefined,
    );
  }
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <Textarea
        id={id}
        ref={ref}
        rows={3}
        maxLength={5000}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void send();
          }
        }}
        className="min-h-20"
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-caption text-text-3">Ctrl + Enter to send</span>
        <Button type="submit" loading={sending}>
          Send
        </Button>
      </div>
    </form>
  );
}
