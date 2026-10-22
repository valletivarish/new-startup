'use client';

/**
 * Settings › Activity: the workspace's audit log as sentences (audit T3), filters that apply at
 * once, and the server's CSV exports for a compliance copy.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Download, History } from 'lucide-react';
import { downloadAuditExportCsv, listAuditEvents, type AuditEventRow } from '@/lib/api';
import { messageText, toUserMessage } from '@/lib/errors';
import { formatWhen } from '@/lib/format';
import { PIPELINE_STATUS_LABEL } from '@/lib/status-labels';
import { useUseCase } from '@/lib/use-cases';
import { UserInitials } from '@/components/shared/user-initials';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Field, Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { SkeletonRows, useHeldLoading } from '@/components/ui/skeleton';
import { ListRow, ListRows } from '@/components/ui/strip';
import { accessName } from './access';
import { SectionHead } from './sections';

type AuditFilter = 'all' | 'stage' | 'access';

// Downloads are changes too, so they list under Changes rather than a filter of their own.
const FILTERS: { value: AuditFilter; label: string }[] = [
  { value: 'all', label: 'Changes' },
  { value: 'stage', label: 'Stage moves' },
  { value: 'access', label: 'Opened records' },
];

function eventTypeForFilter(filter: AuditFilter): string | undefined {
  if (filter === 'stage') return 'hiring.candidate_status_changed';
  if (filter === 'access') return 'authz.sensitive_access';
  return undefined;
}

// What people did, in words. "Changes" lists these; the rest (sign-ins, page visits, the agent's
// own bookkeeping) stays out of it.
const EVENT_LABEL: Record<string, string> = {
  'hiring.job_created': 'Created a job',
  'hiring.job_updated': 'Updated a job',
  'hiring.candidate_imported': 'Imported candidates',
  'hiring.call_started': 'Started a call',
  'hiring.call_ended': 'Ended a call',
  'candidates.deleted': 'Deleted candidates',
  'voice.session.outbound_started': 'Placed a phone call',
  'voice.session.ended_by_user': 'Ended a call',
  'agent.created': 'Created a call setup',
  'agent.updated': 'Edited a call setup',
  'agent.version.published': 'Published the call setup',
  'knowledge.document.created': 'Added a document',
  'knowledge.document.deleted': 'Deleted a document',
  'knowledge.document.reindexed': 'Re-read a document',
  'knowledge.source.created': 'Added company info',
  'knowledge.source.updated': 'Edited company info',
  'knowledge.source.deleted': 'Removed company info',
  'invitation.created': 'Invited someone',
  'invitation.resent': 'Made a new invite link',
  'invitation.revoked': 'Revoked an invite',
  'invitation.accepted': 'Joined the workspace',
  'membership.role_changed': 'Changed someone’s access level',
  'membership.removed': 'Removed someone from the workspace',
  'membership.suspended': 'Suspended someone',
  'membership.reactivated': 'Let someone back in',
  'membership.password_reset_sent': 'Sent someone a password reset link',
  'role.created': 'Created an access level',
  'role.updated': 'Edited an access level',
  'role.deleted': 'Deleted an access level',
  'organization.created': 'Created the workspace',
  'organization.updated': 'Renamed the workspace',
  // Nest names for the same facts.
  'org.member_invited': 'Invited someone',
  'org.member_joined': 'Joined the workspace',
  'org.settings_updated': 'Changed workspace settings',
};
const CHANGES = new Set([...Object.keys(EVENT_LABEL), 'hiring.candidate_status_changed', 'audit.exported']);

// Opened records name what was opened, never the page's address.
const OPENED: Record<string, string> = {
  'candidates.read_pii': 'Opened contact details',
  'calls.read_transcript': 'Opened a call transcript',
  'calls.read_recording': 'Played a call recording',
  'agents.sessions.read': 'Opened the calls list',
  'candidates.export': 'Exported candidates',
};

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

function stageLabel(raw: string | null): string {
  if (!raw) return 'none';
  return raw in PIPELINE_STATUS_LABEL ? PIPELINE_STATUS_LABEL[raw as keyof typeof PIPELINE_STATUS_LABEL] : 'another stage';
}

/** One event as a sentence: who and what, never an address or a raw code. */
function summarizeAudit(ev: AuditEventRow): string {
  const meta =
    ev.metadata && typeof ev.metadata === 'object' && !Array.isArray(ev.metadata)
      ? (ev.metadata as Record<string, unknown>)
      : {};
  const who = str(ev.subjectName);
  const job = str(ev.jobTitle);

  if (ev.eventType === 'hiring.candidate_status_changed') {
    const from = stageLabel(str(meta.from) ?? str(meta.previous));
    const to = stageLabel(str(meta.to) ?? str(meta.status));
    const reason = str(meta.reason);
    return `${who ?? 'Someone'}${job ? ` on ${job}` : ''}: ${from} → ${to}${reason ? `. Note: ${reason}` : ''}`;
  }
  if (ev.eventType === 'audit.exported') {
    const what = meta.kind === 'stage' ? 'stage moves' : 'the activity log';
    const count = typeof meta.count === 'number' ? meta.count : null;
    return count != null ? `Downloaded ${what} (${count} ${count === 1 ? 'row' : 'rows'})` : `Downloaded ${what}`;
  }
  if (ev.eventType === 'membership.role_changed' && str(meta.from) && str(meta.to)) {
    return `Changed someone’s access from ${accessName(str(meta.from) ?? '')} to ${accessName(str(meta.to) ?? '')}`;
  }
  if (ev.eventType === 'invitation.created' && str(meta.role)) {
    return `Invited someone as ${accessName(str(meta.role) ?? '')}`;
  }

  let base: string;
  if (ev.eventType === 'authz.sensitive_access') {
    const permission = str(meta.permission);
    base = (permission && OPENED[permission]) || 'Opened a restricted record';
  } else {
    // Last resort: the event's own words, without the dotted namespace.
    base =
      EVENT_LABEL[ev.eventType] ??
      ev.eventType
        .replace(/^[a-z]+\./, '')
        .replace(/[._]/g, ' ')
        .replace(/^./, (c) => c.toUpperCase());
  }
  const about = [who, job].filter(Boolean).join(' on ');
  return about ? `${base}: ${about}` : base;
}

export function ActivityLog() {
  const { labels } = useUseCase();
  const [filter, setFilter] = useState<AuditFilter>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [events, setEvents] = useState<AuditEventRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [exporting, setExporting] = useState<'all' | 'stage' | null>(null);
  const showSkeleton = useHeldLoading(loading && events.length === 0);

  const load = useCallback(
    async (opts?: { cursor?: string; append?: boolean }) => {
      setLoading(true);
      setError(null);
      try {
        let found: AuditEventRow[] = [];
        let next = opts?.cursor;
        let pages = 0;
        // Changes leaves out page visits, which can fill whole pages: read on (up to 5) until some show.
        do {
          const page = await listAuditEvents({
            limit: 40,
            cursor: next,
            eventType: eventTypeForFilter(filter),
            from: from || undefined,
            to: to || undefined,
          });
          found = [...found, ...page.events];
          next = page.nextCursor ?? undefined;
          pages += 1;
        } while (filter === 'all' && next && pages < 5 && found.filter((ev) => CHANGES.has(ev.eventType)).length < 10);
        setEvents((prev) => (opts?.append ? [...prev, ...found] : found));
        setCursor(next ?? null);
      } catch (e) {
        setError(e);
        if (!opts?.append) {
          setEvents([]);
          setCursor(null);
        }
      } finally {
        setLoading(false);
      }
    },
    [filter, from, to],
  );

  // Filters apply as they change: no Apply button (audit T3).
  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(
    () => (filter === 'all' ? events.filter((ev) => CHANGES.has(ev.eventType)) : events),
    [events, filter],
  );

  async function onExport(kind: 'all' | 'stage') {
    setExporting(kind);
    try {
      const { blob, truncated, count } = await downloadAuditExportCsv({
        kind,
        from: from || undefined,
        to: to || undefined,
      });
      if (count === 0 && blob.size < 80) {
        toast.info('Nothing to download', { description: 'There’s no activity in these dates.' });
        return;
      }
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `${kind === 'stage' ? 'stage-moves' : 'activity-log'}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(objectUrl);
      if (truncated) {
        toast.warning('Download started, but it’s cut short', {
          description: `The file stops at the export limit (${count} rows). Pick shorter dates for the rest.`,
        });
      } else {
        toast.success('Download started', { description: `${count} ${count === 1 ? 'row' : 'rows'}.` });
      }
      void load();
    } catch (e) {
      toast.error(messageText(toUserMessage(e, 'download the log')));
    } finally {
      setExporting(null);
    }
  }

  let body;
  if (error && events.length === 0) {
    const m = toUserMessage(error, 'load activity');
    body = (
      <ErrorState
        headingLevel={3}
        title={m.title}
        cause={m.detail}
        onRetry={() => void load()}
        retrying={loading}
        className="rounded-card border border-border bg-canvas"
      />
    );
  } else if (showSkeleton) {
    body = <SkeletonRows rows={5} />;
  } else if (visible.length === 0) {
    const dated = Boolean(from || to);
    const copy = {
      all: {
        title: dated ? 'No changes in these dates' : 'No changes yet',
        description:
          events.length > 0
            ? 'So far people have only opened records. Choose Opened records to see who opened what.'
            : 'Stage moves, invites and access changes show up here as your team works.',
      },
      stage: {
        title: dated ? 'No stage moves in these dates' : 'No stage moves yet',
        description: `They show up here when someone moves ${labels.contact.many.toLowerCase()} along.`,
      },
      access: {
        title: dated ? 'No opened records in these dates' : 'No opened records yet',
        description: 'When someone opens contact details, a transcript or a recording, it shows up here.',
      },
    }[filter];
    body = (
      <EmptyState
        headingLevel={3}
        icon={<History />}
        title={copy.title}
        description={copy.description}
        action={
          cursor ? (
            <Button variant="secondary" loading={loading} onClick={() => void load({ cursor, append: true })}>
              Look further back
            </Button>
          ) : undefined
        }
        className="rounded-card border border-border bg-canvas"
      />
    );
  } else {
    body = (
      <ListRows aria-label="Activity">
        {visible.map((ev) => (
          <ListRow key={ev.id} reflow={false} className="grid-cols-[auto_minmax(0,1fr)]">
            <UserInitials name={ev.actorName} />
            <div className="min-w-0 py-1">
              <p className="m-0 break-words text-text">{summarizeAudit(ev)}</p>
              <p className="m-0 mt-0.5 text-meta tabular-nums text-text-3">
                {[ev.actorName?.trim(), formatWhen(ev.createdAt)].filter(Boolean).join(' · ')}
              </p>
            </div>
          </ListRow>
        ))}
      </ListRows>
    );
  }

  return (
    <section aria-labelledby="activity">
      <SectionHead
        id="activity"
        title="Activity"
        description="What changed in this workspace and who did it. Download a copy when you need a record."
        actions={
          <>
            <Button variant="secondary" loading={exporting === 'stage'} disabled={exporting !== null} onClick={() => void onExport('stage')}>
              <Download aria-hidden strokeWidth={1.5} />
              Stage moves
            </Button>
            <Button variant="secondary" loading={exporting === 'all'} disabled={exporting !== null} onClick={() => void onExport('all')}>
              <Download aria-hidden strokeWidth={1.5} />
              Full log
            </Button>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-x-3 gap-y-4">
        <Segmented label="Show" options={FILTERS} value={filter} onValueChange={setFilter} className="max-sm:w-full" />
        <div className="flex gap-3 max-sm:w-full">
          <Field label="From" className="w-40 max-sm:flex-1">
            <Input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} />
          </Field>
          <Field label="To" className="w-40 max-sm:flex-1">
            <Input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} />
          </Field>
        </div>
      </div>
      {body}
      {cursor && visible.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="secondary" loading={loading} onClick={() => void load({ cursor, append: true })}>
            Load more
          </Button>
          {error ? (
            <p className="m-0 text-meta text-status-danger-text">{messageText(toUserMessage(error, 'load more'))}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
