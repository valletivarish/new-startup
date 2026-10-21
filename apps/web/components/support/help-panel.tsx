'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, LifeBuoy, MessageSquareText } from 'lucide-react';
import { toast } from 'sonner';
import { IconButton } from '@/components/ui/icon-button';
import { Button } from '@/components/ui/button';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { StatusBadge } from '@/components/ui/state-tag';
import { Skeleton, SkeletonGroup } from '@/components/ui/skeleton';
import { formatApiError } from '@/lib/api';
import { formatWhen } from '@/lib/format';
import { CUSTOMER_STATUS, POLL_MS, relatedFromLocation, type Ticket } from '@/lib/support';
import { closeTicket, createTicket, getTicket, listMyTickets, replyTicket } from '@/lib/support-api';
import { Composer, Thread } from './thread';

const ticketsKey = ['support', 'mine'] as const;

/**
 * "Get help" in the app header: start a chat with the HRVoice team, or pick up an earlier one.
 * Opened from a job or candidate page, the new chat carries that job and candidate, so the team
 * sees what you were looking at. The thread refreshes every 4 seconds while it is open.
 */
export function HelpButton() {
  const [open, setOpen] = useState(false);
  const [related, setRelated] = useState<{ jobId?: string; candidateId?: string }>({});
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <IconButton
        label="Get help"
        onClick={() => {
          setRelated(relatedFromLocation(window.location.pathname, window.location.search));
          setOpen(true);
        }}
      >
        <LifeBuoy strokeWidth={1.5} />
      </IconButton>
      <SheetContent aria-describedby={undefined}>{open ? <HelpPanel related={related} /> : null}</SheetContent>
    </Sheet>
  );
}

function HelpPanel({ related }: { related: { jobId?: string; candidateId?: string } }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return openId ? (
    <TicketView id={openId} onBack={() => setOpenId(null)} />
  ) : (
    <Home related={related} onOpen={setOpenId} />
  );
}

function Home({ related, onOpen }: { related: { jobId?: string; candidateId?: string }; onOpen: (id: string) => void }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ticketsKey, queryFn: listMyTickets });
  const start = useMutation({
    mutationFn: (body: string) => createTicket({ body, channel: 'chat', ...related }),
    onSuccess: (t) => {
      void qc.invalidateQueries({ queryKey: ticketsKey });
      onOpen(t.id);
    },
    onError: (e) => toast.error(formatApiError(e, 'We couldn’t send that. Try again.')),
  });
  const attached = [related.jobId ? 'this job' : null, related.candidateId ? 'this candidate' : null].filter(Boolean);

  return (
    <>
      <SheetHeader>
        <SheetTitle>Get help</SheetTitle>
        <SheetDescription>Write to the HRVoice team. Replies show up here and come to you by email.</SheetDescription>
      </SheetHeader>
      <SheetBody className="grid content-start gap-8">
        <section aria-labelledby="help-start" className="grid gap-3">
          <h2 id="help-start" className="m-0 text-title font-medium text-text">
            Start a chat
          </h2>
          {attached.length ? (
            <p className="m-0 text-meta text-text-2">We’ll attach {attached.join(' and ')}, so you don’t have to explain which.</p>
          ) : null}
          <Composer
            label="What do you need help with?"
            placeholder="What happened, and what did you expect?"
            sending={start.isPending}
            onSend={(body) => start.mutateAsync(body)}
          />
        </section>

        <section aria-labelledby="help-mine" className="grid gap-3">
          <h2 id="help-mine" className="m-0 text-title font-medium text-text">
            Your conversations
          </h2>
          {list.isPending ? (
            <SkeletonGroup>
              <Skeleton className="mb-2 h-16 w-full" />
              <Skeleton className="mb-2 h-16 w-full" />
            </SkeletonGroup>
          ) : list.isError ? (
            <p className="m-0 text-body text-text-2">
              Your conversations didn’t load.{' '}
              <Button variant="link" className="h-auto p-0" onClick={() => void list.refetch()}>
                Try again
              </Button>
            </p>
          ) : list.data.tickets.length === 0 ? (
            <p className="m-0 text-body text-text-2">None yet. Anything you send appears here.</p>
          ) : (
            <ul role="list" className="m-0 grid list-none gap-2 p-0">
              {list.data.tickets.map((t) => (
                <li key={t.id}>
                  <TicketRow ticket={t} onOpen={() => onOpen(t.id)} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </SheetBody>
    </>
  );
}

function TicketRow({ ticket, onOpen }: { ticket: Ticket; onOpen: () => void }) {
  const s = CUSTOMER_STATUS[ticket.status];
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-16 w-full items-center gap-3 rounded-card border border-border bg-canvas px-4 py-3 text-left transition-colors hover:bg-subtle"
    >
      <MessageSquareText aria-hidden strokeWidth={1.5} className="size-5 shrink-0 text-text-3" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-label font-medium text-text">{ticket.subject}</span>
        <span className="block text-caption text-text-3">{formatWhen(ticket.lastMessageAt)}</span>
      </span>
      <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
    </button>
  );
}

function TicketView({ id, onBack }: { id: string; onBack: () => void }) {
  const qc = useQueryClient();
  const key = ['support', 'ticket', id];
  const ticket = useQuery({ queryKey: key, queryFn: () => getTicket(id), refetchInterval: POLL_MS });
  const send = useMutation({
    mutationFn: (body: string) => replyTicket(id, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
    onError: (e) => toast.error(formatApiError(e, 'We couldn’t send that. Try again.')),
  });
  const close = useMutation({
    mutationFn: () => closeTicket(id),
    onSuccess: (t) => {
      qc.setQueryData(key, t);
      void qc.invalidateQueries({ queryKey: ticketsKey });
    },
    onError: (e) => toast.error(formatApiError(e, 'We couldn’t close this. Try again.')),
  });
  const t = ticket.data;
  const s = t ? CUSTOMER_STATUS[t.status] : null;
  const waiting = t?.messages?.length && t.messages[t.messages.length - 1]!.authorKind === 'customer';

  return (
    <>
      <SheetHeader>
        <div className="flex items-center gap-2">
          <IconButton label="Back to Get help" variant="quiet" size="sm" onClick={onBack}>
            <ArrowLeft strokeWidth={1.5} />
          </IconButton>
          <SheetTitle className="min-w-0 flex-1 truncate">{t?.subject ?? 'Conversation'}</SheetTitle>
        </div>
        {t && s ? (
          <div className="flex flex-wrap items-center gap-2 pl-11">
            <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
            <span className="text-caption text-text-3">Reference #{t.ref}</span>
          </div>
        ) : null}
      </SheetHeader>
      <SheetBody>
        {ticket.isPending ? (
          <SkeletonGroup>
            <Skeleton className="mb-3 h-14 w-3/4" />
            <Skeleton className="ml-auto h-14 w-2/3" />
          </SkeletonGroup>
        ) : ticket.isError ? (
          <p className="m-0 text-body text-text-2">This conversation didn’t load. It will try again in a few seconds.</p>
        ) : (
          <>
            <Thread messages={t!.messages ?? []} viewer="customer" />
            {waiting ? (
              <p className="m-0 mt-4 text-meta text-text-3">
                Sent. Someone from the team will answer here; if nobody does within 5 minutes, we email you too.
              </p>
            ) : null}
          </>
        )}
      </SheetBody>
      {t ? (
        <div className="grid gap-3 border-t border-border px-4 py-4 sm:px-6">
          <Composer
            label={t.status === 'solved' ? 'Write to reopen this conversation' : 'Reply'}
            placeholder={t.status === 'solved' ? 'Write to reopen this conversation' : 'Reply'}
            sending={send.isPending}
            onSend={(body) => send.mutateAsync(body)}
          />
          {t.status !== 'solved' ? (
            <Button variant="tertiary" size="sm" className="justify-self-start" loading={close.isPending} onClick={() => close.mutate()}>
              Mark as solved
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
