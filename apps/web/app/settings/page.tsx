'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppShell } from '../../components/AppShell';
import { Button } from '../../components/ui/button';
import {
  Notice,
  PageHeader,
  PageMain,
  Surface,
} from '../../components/ui/page';
import { SkeletonCard } from '../../components/ui/skeleton';
import { ThemeToggle } from '../../components/layout/ThemeToggle';
import { TeamSettings } from '../../components/TeamSettings';
import { Field, Input, Select } from '../../components/ui/input';
import { loginPathForReturn } from '../../lib/auth-redirect';
import { PIPELINE_STATUS_LABEL } from '../../lib/status-labels';
import {
  ApiClientError,
  downloadAuditExportCsv,
  getTelephonyStatus,
  listAuditEvents,
  me,
  myOrganizations,
  type AuditEventRow,
  type Me,
} from '../../lib/api';

type AuditFilter = 'all' | 'stage' | 'exported' | 'access';

function eventTypeForFilter(filter: AuditFilter): string | undefined {
  if (filter === 'stage') return 'hiring.candidate_status_changed';
  if (filter === 'exported') return 'audit.exported';
  if (filter === 'access') return 'authz.sensitive_access';
  return undefined;
}

function summarizeAudit(ev: AuditEventRow): string {
  const meta =
    ev.metadata && typeof ev.metadata === 'object' && !Array.isArray(ev.metadata)
      ? (ev.metadata as Record<string, unknown>)
      : {};
  if (ev.eventType === 'hiring.candidate_status_changed') {
    const fromRaw =
      typeof meta.from === 'string'
        ? meta.from
        : typeof meta.previous === 'string'
          ? meta.previous
          : '—';
    const toRaw =
      typeof meta.to === 'string'
        ? meta.to
        : typeof meta.status === 'string'
          ? meta.status
          : '—';
    const from =
      fromRaw in PIPELINE_STATUS_LABEL
        ? PIPELINE_STATUS_LABEL[fromRaw as keyof typeof PIPELINE_STATUS_LABEL]
        : fromRaw;
    const to =
      toRaw in PIPELINE_STATUS_LABEL
        ? PIPELINE_STATUS_LABEL[toRaw as keyof typeof PIPELINE_STATUS_LABEL]
        : toRaw;
    const who = ev.subjectName?.trim() || 'Someone';
    const job = ev.jobTitle?.trim() ? ` on ${ev.jobTitle.trim()}` : '';
    const reason =
      typeof meta.reason === 'string' && meta.reason.trim()
        ? ` · ${meta.reason.trim()}`
        : '';
    return `${who}${job}: ${from} → ${to}${reason}`;
  }
  if (ev.eventType === 'audit.exported') {
    const kind = typeof meta.kind === 'string' ? meta.kind : 'log';
    const count = typeof meta.count === 'number' ? meta.count : null;
    return count != null
      ? `Exported ${kind} (${count} rows)`
      : `Exported ${kind}`;
  }

  const AUDIT_EVENT_LABEL: Record<string, string> = {
    'authz.sensitive_access': 'Opened a restricted page',
    'authz.denied': 'Access denied',
    'hiring.job_created': 'Created a job',
    'hiring.job_updated': 'Updated a job',
    'hiring.candidate_imported': 'Imported candidates',
    'hiring.call_started': 'Started a phone screen',
    'hiring.call_ended': 'Ended a phone screen',
    'org.member_invited': 'Invited a teammate',
    'org.member_joined': 'Teammate joined',
    'org.settings_updated': 'Updated company settings',
  };
  if (ev.eventType === 'authz.sensitive_access') {
    const permission =
      typeof meta.permission === 'string' ? meta.permission : null;
    const url = typeof meta.url === 'string' ? meta.url : null;
    const pathHint = url
      ? url
          .replace(/^https?:\/\/[^/]+/i, '')
          .replace(/\?.*$/, '')
          .slice(0, 80)
      : null;
    const detail =
      permission === 'calls.read_transcript'
        ? 'call transcript'
        : permission === 'candidates.read_pii'
          ? 'contact details'
          : pathHint
            ? pathHint
            : null;
    const who = ev.subjectName?.trim();
    const base = detail
      ? `Opened ${detail}`
      : AUDIT_EVENT_LABEL['authz.sensitive_access'];
    if (who) return `${base} · ${who}`;
    return base;
  }
  if (ev.eventType in AUDIT_EVENT_LABEL) {
    const who = ev.subjectName?.trim();
    const job = ev.jobTitle?.trim();
    const base = AUDIT_EVENT_LABEL[ev.eventType];
    if (who && job) return `${base} · ${who} on ${job}`;
    if (who) return `${base} · ${who}`;
    if (job) return `${base} · ${job}`;
    return base;
  }
  // Last resort: drop dotted namespaces, keep readable words.
  return ev.eventType
    .replace(/^[a-z]+\./, '')
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function SettingsPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Me | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [telephonyMessage, setTelephonyMessage] = useState<string | null>(null);
  const [openOutbound, setOpenOutbound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportFrom, setExportFrom] = useState('');
  const [exportTo, setExportTo] = useState('');
  const [exportNotice, setExportNotice] = useState<{
    kind: 'ok' | 'err';
    text: string;
  } | null>(null);
  const [auditFilter, setAuditFilter] = useState<AuditFilter>('all');
  const [auditEvents, setAuditEvents] = useState<AuditEventRow[]>([]);
  const [auditCursor, setAuditCursor] = useState<string | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditNotice, setAuditNotice] = useState<string | null>(null);

  const HIRING_ACTIVITY_TYPES = new Set([
    'hiring.candidate_status_changed',
    'hiring.job_created',
    'hiring.job_updated',
    'hiring.candidate_imported',
    'hiring.call_started',
    'hiring.call_ended',
    'org.member_invited',
    'org.member_joined',
    'org.settings_updated',
    'audit.exported',
  ]);

  const visibleAuditEvents = useMemo(() => {
    if (auditFilter !== 'all') return auditEvents;
    // Default hiring view: stage/job/team/call facts only — not page-access noise.
    return auditEvents.filter((ev) => HIRING_ACTIVITY_TYPES.has(ev.eventType));
  }, [auditEvents, auditFilter]);

  const can = (p: string) =>
    profile?.activeOrganization?.permissions.includes(p) ?? false;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = await me();
      setProfile(p);
      if (p.activeOrganization?.id) {
        try {
          const orgs = await myOrganizations();
          const match = orgs.organizations.find(
            (o) => o.id === p.activeOrganization?.id,
          );
          setCompanyName(match?.name?.trim() || null);
        } catch {
          setCompanyName(null);
        }
      } else {
        setCompanyName(null);
      }
      try {
        const tel = await getTelephonyStatus();
        setTelephonyMessage(tel.message);
        setOpenOutbound(Boolean(tel.openOutbound));
      } catch {
        setTelephonyMessage(null);
      }
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 401) {
        router.push(loginPathForReturn('/settings'));
      }
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadAudit = useCallback(
    async (opts?: { cursor?: string; append?: boolean }) => {
      if (!can('audit.read')) return;
      setAuditLoading(true);
      setAuditNotice(null);
      try {
        const page = await listAuditEvents({
          limit: 40,
          cursor: opts?.cursor,
          eventType: eventTypeForFilter(auditFilter),
          from: exportFrom || undefined,
          to: exportTo || undefined,
        });
        setAuditEvents((prev) =>
          opts?.append ? [...prev, ...page.events] : [...page.events],
        );
        setAuditCursor(page.nextCursor);
      } catch (e) {
        setAuditNotice(
          e instanceof ApiClientError
            ? e.message
            : 'Could not load the audit log.',
        );
        if (!opts?.append) {
          setAuditEvents([]);
          setAuditCursor(null);
        }
      } finally {
        setAuditLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- can() reads profile
    [auditFilter, exportFrom, exportTo, profile],
  );

  useEffect(() => {
    if (!loading && can('audit.read')) {
      void loadAudit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, auditFilter, profile?.activeOrganization?.id]);

  async function onExportAudit(kind: 'all' | 'stage') {
    setExportBusy(true);
    setExportNotice(null);
    try {
      const { blob, truncated, count } = await downloadAuditExportCsv({
        kind,
        from: exportFrom || undefined,
        to: exportTo || undefined,
      });
      if (count === 0 && blob.size < 80) {
        setExportNotice({
          kind: 'ok',
          text: 'No audit events in this range.',
        });
        return;
      }
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download =
        kind === 'stage'
          ? `stage-moves-${new Date().toISOString().slice(0, 10)}.csv`
          : `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(objectUrl);
      setExportNotice({
        kind: truncated ? 'err' : 'ok',
        text: truncated
          ? `Download started (${count} rows) — file hit the export limit and may be incomplete.`
          : `Download started (${count} rows) from the server export.`,
      });
      void loadAudit();
    } catch (e) {
      setExportNotice({
        kind: 'err',
        text:
          e instanceof ApiClientError
            ? e.message
            : e instanceof Error
              ? e.message
              : 'Could not export the audit log.',
      });
    } finally {
      setExportBusy(false);
    }
  }

  return (
    <AppShell profile={profile}>
      <PageMain className="pb-10">
        <PageHeader
          title="Settings"
          description="Company, team, appearance, and phone line."
        />

        {loading ? <SkeletonCard /> : null}

        {!loading ? (
          <div className="space-y-4">
            <Surface className="space-y-4">
              <h2 className="m-0 font-display text-base font-semibold tracking-tight">
                Company
              </h2>
              <dl className="m-0 grid gap-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--foreground-muted)]">
                    Company
                  </dt>
                  <dd className="m-0 mt-1 text-[15px] font-medium tracking-tight">
                    {companyName ??
                      (profile?.activeOrganization
                        ? 'Current company'
                        : '—')}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--foreground-muted)]">
                    Signed in as
                  </dt>
                  <dd className="m-0 mt-1 text-[15px] font-medium tracking-tight">
                    {profile?.user?.email ?? '—'}
                  </dd>
                </div>
              </dl>
              <p className="m-0 text-sm text-[var(--foreground-tertiary)]">
                Company name is set when the workspace is created. Invite people
                under Team.
              </p>
            </Surface>

            <section id="team" className="scroll-mt-6 space-y-3">
              <h2 className="m-0 font-display text-base font-semibold tracking-tight">
                Team
              </h2>
              <TeamSettings />
            </section>

            <Surface className="space-y-3">
              <div>
                <h2 className="m-0 font-display text-base font-semibold tracking-tight">
                  Hiring voice
                </h2>
                <p className="mt-1 mb-0 text-sm text-[var(--foreground-tertiary)]">
                  The voice that runs phone screens. Set it up once, then attach
                  it on each job.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <Link href="/agents">Open hiring voice</Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href="/agents/new">Set up a new voice</Link>
                </Button>
              </div>
            </Surface>

            {can('audit.read') ? (
              <Surface className="space-y-4">
                <div>
                  <h2 className="m-0 font-display text-base font-semibold tracking-tight">
                    Audit log
                  </h2>
                  <p className="mt-1 mb-0 text-sm text-[var(--foreground-tertiary)]">
                    Browse what changed in this company, then download a CSV
                    when you need a compliance copy. Stage moves show who moved
                    each person and any note they left.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Show">
                    <Select
                      value={auditFilter}
                      onChange={(e) =>
                        setAuditFilter(e.target.value as AuditFilter)
                      }
                    >
                      <option value="all">Hiring activity</option>
                      <option value="stage">Stage moves</option>
                      <option value="exported">Exports</option>
                      <option value="access">Page access</option>
                    </Select>
                  </Field>
                  <Field label="From (optional)">
                    <Input
                      type="date"
                      value={exportFrom}
                      onChange={(e) => setExportFrom(e.target.value)}
                    />
                  </Field>
                  <Field label="To (optional)">
                    <Input
                      type="date"
                      value={exportTo}
                      onChange={(e) => setExportTo(e.target.value)}
                    />
                  </Field>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={auditLoading}
                    onClick={() => void loadAudit()}
                  >
                    {auditLoading ? 'Loading…' : 'Apply filters'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={exportBusy}
                    onClick={() => void onExportAudit('stage')}
                  >
                    {exportBusy ? 'Preparing…' : 'Export stage moves'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={exportBusy}
                    onClick={() => void onExportAudit('all')}
                  >
                    Export full log
                  </Button>
                </div>

                {exportNotice ? (
                  <Notice kind={exportNotice.kind}>{exportNotice.text}</Notice>
                ) : null}
                {auditNotice ? (
                  <Notice kind="err">{auditNotice}</Notice>
                ) : null}

                {auditLoading && auditEvents.length === 0 ? (
                  <p className="m-0 text-sm text-[var(--foreground-tertiary)]">
                    Loading audit events…
                  </p>
                ) : visibleAuditEvents.length === 0 ? (
                  <p className="m-0 text-sm text-[var(--foreground-tertiary)]">
                    {auditFilter === 'all' && auditEvents.length > 0
                      ? 'No hiring activity in this range. Switch to Page access to see visits.'
                      : 'No events in this range.'}
                  </p>
                ) : (
                  <ul className="m-0 divide-y divide-[var(--separator-subtle)] list-none border-y border-[var(--separator-subtle)] p-0">
                    {visibleAuditEvents.map((ev) => (
                      <li
                        key={ev.id}
                        className="flex items-baseline justify-between gap-4 py-2"
                      >
                        <p className="m-0 min-w-0 flex-1 text-[13px] text-[var(--foreground)]">
                          {summarizeAudit(ev)}
                        </p>
                        <p className="m-0 shrink-0 text-[12px] tabular-nums text-[var(--foreground-tertiary)]">
                          {ev.actorName ? `${ev.actorName} · ` : ''}
                          {new Date(ev.createdAt).toLocaleString()}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}

                {auditCursor ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={auditLoading}
                    onClick={() =>
                      void loadAudit({ cursor: auditCursor, append: true })
                    }
                  >
                    {auditLoading ? 'Loading…' : 'Load more'}
                  </Button>
                ) : null}
              </Surface>
            ) : null}

            <Surface className="space-y-3">
              <h2 className="m-0 font-display text-base font-semibold tracking-tight">
                Appearance
              </h2>
              <div className="flex items-center justify-between gap-3">
                <p className="m-0 text-sm text-[var(--foreground-tertiary)]">
                  Switch between light and dark.
                </p>
                <ThemeToggle />
              </div>
            </Surface>

            <Surface className="space-y-4">
              <div>
                <h2 className="m-0 font-display text-base font-semibold tracking-tight">
                  Phone line
                </h2>
                <p className="mt-1 mb-0 text-sm text-[var(--foreground-tertiary)]">
                  Outbound calling for phone screens — facts from your phone
                  account.
                </p>
              </div>
              <dl className="m-0 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--foreground-muted)]">
                    Outbound
                  </dt>
                  <dd className="m-0 mt-1 text-[15px] font-medium tracking-tight">
                    {telephonyMessage
                      ? openOutbound
                        ? 'Ready to dial'
                        : 'Not open for dials yet'
                      : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--foreground-muted)]">
                    Status detail
                  </dt>
                  <dd className="m-0 mt-1 text-sm text-[var(--foreground-secondary)]">
                    {telephonyMessage ??
                      'Phone status is not available right now.'}
                  </dd>
                </div>
              </dl>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href="/calls">View call history</Link>
                </Button>
              </div>
            </Surface>
          </div>
        ) : null}
      </PageMain>
    </AppShell>
  );
}
