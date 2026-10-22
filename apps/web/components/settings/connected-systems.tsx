'use client';

/**
 * Settings → Connected systems: hiring systems HRVoice works inside. Today that's Zoho
 * Recruit: connect once, pick the Zoho jobs to bring applicants in from, and each call's
 * answers go back to Zoho as a note. Shown with integrations.read; connect, change and
 * disconnect need integrations.create / update / delete. Every sentence comes from
 * lib/connected-systems.ts; server text is never shown.
 */

import { useEffect, useId, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Link2, Plug, RefreshCw, RotateCw, Unplug } from 'lucide-react';
import { listJobs, type Me } from '@/lib/api';
import {
  SKIP_REASON,
  connectResultMessage,
  connectionProblem,
  disconnectZoho,
  getZohoStatus,
  linksChanged,
  listZohoJobOpenings,
  noteProblem,
  retryZohoNotes,
  saveZohoLinks,
  startZohoConnect,
  syncZohoNow,
  type LinkDraft,
  type ZohoConnection,
} from '@/lib/connected-systems';
import { messageText, toUserMessage } from '@/lib/errors';
import { formatWhen } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/input';
import { Alert } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/state-tag';
import { SectionHead } from './sections';

export const ZOHO_STATUS_KEY = ['connected-systems', 'zoho'];

const timeOnly = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(iso));

export function ConnectedSystemsSection({ profile }: { profile: Me }) {
  const perms = profile.activeOrganization?.permissions ?? [];
  const can = (p: string) => perms.includes(p);
  const status = useQuery({ queryKey: ZOHO_STATUS_KEY, queryFn: getZohoStatus, refetchInterval: 30_000 });
  const [result, setResult] = useState<ReturnType<typeof connectResultMessage>>(null);

  // The Zoho sign-in comes back to /settings/sources?zoho=<code>: say how it went, once.
  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('zoho');
    if (code === null) return;
    setResult(connectResultMessage(code));
    url.searchParams.delete('zoho');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  return (
    <section aria-labelledby="connected-head" className="space-y-6">
      <SectionHead
        id="connected-head"
        title="Connected systems"
        description="Bring applicants in from the hiring system you already use, and send each call’s results back to it."
      />
      {result ? (
        <Alert kind={result.kind} title={result.title}>
          {result.detail}
        </Alert>
      ) : null}
      {status.isError ? (
        <Alert
          kind="error"
          title="Couldn’t load your connected systems"
          action={
            <Button variant="secondary" className="h-11" loading={status.isFetching} onClick={() => void status.refetch()}>
              <RotateCw aria-hidden strokeWidth={1.5} />
              Retry
            </Button>
          }
        >
          {toUserMessage(status.error).detail}
        </Alert>
      ) : !status.data ? (
        <div aria-busy="true">
          <Skeleton className="h-48 w-full" />
          <span className="sr-only">Loading your connected systems</span>
        </div>
      ) : status.data.available ? (
        <ZohoCard
          connection={status.data.connection}
          canConnect={can('integrations.create')}
          canChange={can('integrations.update')}
          canDisconnect={can('integrations.delete')}
          canCreateJobs={can('jobs.create')}
        />
      ) : null}
    </section>
  );
}

function ZohoCard({
  connection,
  canConnect,
  canChange,
  canDisconnect,
  canCreateJobs,
}: {
  connection: ZohoConnection | null;
  canConnect: boolean;
  canChange: boolean;
  canDisconnect: boolean;
  canCreateJobs: boolean;
}) {
  const headingId = useId();
  const badge = !connection ? (
    <StatusBadge tone="neutral">Not connected</StatusBadge>
  ) : connection.status === 'needs_attention' ? (
    <StatusBadge tone="danger">Needs attention</StatusBadge>
  ) : connection.status === 'paused' ? (
    <StatusBadge tone="warning">Paused</StatusBadge>
  ) : (
    <StatusBadge tone="success">Connected</StatusBadge>
  );
  return (
    <article aria-labelledby={headingId} className="rounded-card border border-border bg-canvas">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4 sm:px-6">
        <h3 id={headingId} className="m-0 text-title font-semibold text-text">
          Zoho Recruit
        </h3>
        {badge}
      </header>
      <div className="space-y-6 p-5 sm:p-6">
        {connection ? (
          <Connected
            connection={connection}
            canConnect={canConnect}
            canChange={canChange}
            canDisconnect={canDisconnect}
            canCreateJobs={canCreateJobs}
          />
        ) : (
          <NotConnected canConnect={canConnect} />
        )}
      </div>
    </article>
  );
}

function WhatWeDo() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <h4 className="m-0 text-label font-semibold text-text">We’ll read</h4>
        <p className="mb-0 mt-1 text-text-2">
          The Zoho job openings you pick, and their applicants’ name, mobile, email and status.
        </p>
      </div>
      <div>
        <h4 className="m-0 text-label font-semibold text-text">We’ll write</h4>
        <p className="mb-0 mt-1 text-text-2">
          A note on the candidate in Zoho Recruit after each call, with their answers and a short summary. We never
          send a score or a recommendation.
        </p>
      </div>
    </div>
  );
}

function NotConnected({ canConnect }: { canConnect: boolean }) {
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const { url } = await startZohoConnect();
      window.location.assign(url);
    } catch (e) {
      setError(messageText(toUserMessage(e, 'start connecting')));
      setBusy(false);
    }
  }

  return (
    <>
      <WhatWeDo />
      <p className="m-0 text-text-2">
        Rejected, hired and closed applicants are never brought in or called. Calls that start on their own happen
        only between 9:00 am and 8:00 pm India time.
      </p>
      {canConnect ? (
        <div className="flex flex-col items-start gap-3">
          <Checkbox
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            label="People who apply to our jobs in Zoho Recruit have agreed to be contacted by phone about their application."
          />
          {error ? <Alert kind="error">{error}</Alert> : null}
          <Button className="h-11" disabled={!consent} loading={busy} onClick={() => void connect()}>
            <Plug aria-hidden strokeWidth={1.5} />
            Connect Zoho Recruit
          </Button>
          <p className="m-0 text-meta text-text-3">You’ll sign in to Zoho and come straight back here.</p>
        </div>
      ) : (
        <p className="m-0 text-meta text-text-3">Ask a workspace admin to connect Zoho Recruit.</p>
      )}
    </>
  );
}

function Connected({
  connection: c,
  canConnect,
  canChange,
  canDisconnect,
  canCreateJobs,
}: {
  connection: ZohoConnection;
  canConnect: boolean;
  canChange: boolean;
  canDisconnect: boolean;
  canCreateJobs: boolean;
}) {
  const queryClient = useQueryClient();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ZOHO_STATUS_KEY });
  const [choosing, setChoosing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<'sync' | 'retry' | 'disconnect' | 'reconnect' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const problem = connectionProblem(c, timeOnly);
  const live = c.status === 'connected';

  async function run(kind: 'sync' | 'retry', fn: () => Promise<unknown>, done: string, context: string) {
    setBusy(kind);
    try {
      await fn();
      toast.success(done);
      refresh();
    } catch (e) {
      toast.error(messageText(toUserMessage(e, context)));
    } finally {
      setBusy(null);
    }
  }

  async function reconnect() {
    setBusy('reconnect');
    try {
      window.location.assign((await startZohoConnect()).url);
    } catch (e) {
      toast.error(messageText(toUserMessage(e, 'start reconnecting')));
      setBusy(null);
    }
  }

  async function disconnect() {
    setBusy('disconnect');
    setError(null);
    try {
      await disconnectZoho();
      toast.success('Zoho Recruit is disconnected. People already brought in stay in HRVoice.');
      setConfirming(false);
      refresh();
    } catch (e) {
      setError(messageText(toUserMessage(e, 'disconnect Zoho Recruit')));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {problem ? (
        <Alert
          kind={c.status === 'needs_attention' ? 'error' : 'warning'}
          title={c.status === 'needs_attention' ? 'Zoho Recruit needs attention' : 'Zoho Recruit is paused'}
          action={
            c.status === 'needs_attention' && canConnect ? (
              <Button variant="secondary" className="h-11" loading={busy === 'reconnect'} onClick={() => void reconnect()}>
                <Plug aria-hidden strokeWidth={1.5} />
                Reconnect
              </Button>
            ) : undefined
          }
        >
          {problem}
        </Alert>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="m-0 text-text-2">
          {c.lastSyncAt ? `Last checked ${formatWhen(c.lastSyncAt)}` : 'Not checked yet'}
          {c.connectedBy ? ` · Connected by ${c.connectedBy}` : ''}
          <span className="block text-meta text-text-3">New applicants come in about every 15 minutes.</span>
        </p>
        {canChange && live ? (
          <Button
            variant="secondary"
            className="h-11"
            loading={busy === 'sync'}
            onClick={() => void run('sync', syncZohoNow, 'Checking Zoho Recruit now. New applicants show up in a minute or two.', 'check Zoho Recruit')}
          >
            <RefreshCw aria-hidden strokeWidth={1.5} />
            Check now
          </Button>
        ) : null}
      </div>

      <section aria-labelledby="zoho-jobs" className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h4 id="zoho-jobs" className="m-0 text-label font-semibold text-text">
            Jobs bringing in applicants
          </h4>
          {canChange && live ? (
            <Button variant={c.links.length ? 'secondary' : 'primary'} className="h-11" onClick={() => setChoosing(true)}>
              <Link2 aria-hidden strokeWidth={1.5} />
              {c.links.length ? 'Change jobs' : 'Pick jobs'}
            </Button>
          ) : null}
        </div>
        {c.links.length === 0 ? (
          <p className="m-0 text-text-2">No jobs picked yet. Nothing comes in from Zoho Recruit until you pick at least one.</p>
        ) : (
          <ul className="m-0 list-none divide-y divide-border rounded-input border border-border p-0">
            {c.links.map((l) => (
              <li key={l.zohoJobId} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="m-0 font-medium text-text">{l.zohoJobTitle}</p>
                  <p className="m-0 text-meta text-text-3">
                    Into the HRVoice job “{l.jobTitle}” ·{' '}
                    {l.autoCall ? 'New applicants are called automatically' : 'You start each call'}
                  </p>
                </div>
                <p className="m-0 shrink-0 text-meta tabular-nums text-text-2">
                  {l.imported} {l.imported === 1 ? 'person' : 'people'} brought in
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {c.skipped.length > 0 ? (
        <section aria-labelledby="zoho-skipped" className="space-y-2">
          <h4 id="zoho-skipped" className="m-0 text-label font-semibold text-text">
            Not brought in
          </h4>
          <ul className="m-0 list-none divide-y divide-border rounded-input border border-border p-0 text-text-2">
            {c.skipped.map((s) => (
              <li key={s.reason} className="px-4 py-2">
                <p className="m-0 py-1">{SKIP_REASON[s.reason]?.(s.count) ?? `${s.count} not brought in.`}</p>
                {s.names.length > 0 ? (
                  <details>
                    <summary className="inline-flex min-h-11 cursor-pointer items-center text-meta text-text-2 underline underline-offset-2">
                      Show who
                    </summary>
                    <p className="m-0 pb-2 text-meta text-text-3">
                      {s.names.join(', ')}
                      {s.count > s.names.length ? ` and ${s.count - s.names.length} more` : ''}
                    </p>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="zoho-notes" className="space-y-2">
        <h4 id="zoho-notes" className="m-0 text-label font-semibold text-text">
          Call results sent to Zoho Recruit
        </h4>
        <p className="m-0 text-text-2">
          {c.notes.sent} sent{c.notes.pending ? ` · ${c.notes.pending} waiting to send` : ''}
          {c.notes.failed ? ` · ${c.notes.failed} couldn’t be sent` : ''}
        </p>
        {c.notes.failed > 0 ? (
          <Alert
            kind="warning"
            title={`${c.notes.failed} call ${c.notes.failed === 1 ? 'result' : 'results'} couldn’t be sent`}
            action={
              canChange ? (
                <Button
                  variant="secondary"
                  className="h-11"
                  loading={busy === 'retry'}
                  onClick={() =>
                    void run('retry', retryZohoNotes, 'Sending them again. We keep trying for 24 hours.', 'retry sending')
                  }
                >
                  <RotateCw aria-hidden strokeWidth={1.5} />
                  Retry
                </Button>
              ) : undefined
            }
          >
            {noteProblem(c.notes.lastError)} The answers are still in HRVoice.
          </Alert>
        ) : null}
      </section>

      {canDisconnect ? (
        <div className="border-t border-border pt-5">
          <Button variant="secondary" className="h-11" onClick={() => setConfirming(true)}>
            <Unplug aria-hidden strokeWidth={1.5} />
            Disconnect Zoho Recruit
          </Button>
        </div>
      ) : null}

      <Dialog open={choosing} onOpenChange={setChoosing}>
        <DialogContent>
          {choosing ? (
            <ChooseJobs
              connection={c}
              canCreateJobs={canCreateJobs}
              onDone={() => setChoosing(false)}
              onSaved={refresh}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirming}
        onOpenChange={(open) => !open && setConfirming(false)}
        title="Disconnect Zoho Recruit?"
        body="New applicants stop coming in and call results stop going to Zoho Recruit. People already brought in stay in HRVoice. You can connect again later."
        confirmLabel="Disconnect"
        tone="danger"
        busy={busy === 'disconnect'}
        error={error}
        onConfirm={() => void disconnect()}
      />
    </>
  );
}

const NEW_JOB = '__new__';

function ChooseJobs({
  connection,
  canCreateJobs,
  onDone,
  onSaved,
}: {
  connection: ZohoConnection;
  canCreateJobs: boolean;
  onDone: () => void;
  onSaved: () => void;
}) {
  const openings = useQuery({ queryKey: ['connected-systems', 'zoho', 'openings'], queryFn: listZohoJobOpenings });
  const jobs = useQuery({ queryKey: ['jobs', 'for-zoho'], queryFn: listJobs });
  const [draft, setDraft] = useState<Record<string, LinkDraft & { picked: boolean }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hrJobs = useMemo(() => (jobs.data?.jobs ?? []).filter((j) => j.status !== 'closed'), [jobs.data]);

  // Start from what's linked; otherwise suggest the HRVoice job with the same title, else a new one.
  useEffect(() => {
    if (draft || !openings.data || !jobs.data) return;
    const next: Record<string, LinkDraft & { picked: boolean }> = {};
    for (const o of openings.data.jobOpenings) {
      const saved = connection.links.find((l) => l.zohoJobId === o.id);
      const sameTitle = hrJobs.find((j) => j.title.trim().toLowerCase() === o.title.trim().toLowerCase());
      const fallback = sameTitle?.id ?? (canCreateJobs ? undefined : hrJobs[0]?.id);
      next[o.id] = {
        zohoJobId: o.id,
        zohoJobTitle: o.title,
        picked: Boolean(saved),
        ...(saved ? { jobId: saved.jobId } : fallback ? { jobId: fallback } : {}),
        autoCall: saved?.autoCall ?? false,
      };
    }
    setDraft(next);
  }, [draft, openings.data, jobs.data, connection.links, hrJobs, canCreateJobs]);

  const picked = Object.values(draft ?? {}).filter((d) => d.picked);
  const links: LinkDraft[] = picked.map(({ picked: _p, ...l }) => l);
  const dirty = draft !== null && linksChanged(connection.links, links);
  const blocked = picked.some((d) => !d.jobId && !canCreateJobs);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await saveZohoLinks(links);
      toast.success(
        links.length
          ? 'Saved. Applicants on these jobs show up in HRVoice within about 15 minutes, usually sooner.'
          : 'Saved. Nothing comes in from Zoho Recruit until you pick a job.',
      );
      onSaved();
      onDone();
    } catch (e) {
      setError(messageText(toUserMessage(e, 'save the jobs')));
    } finally {
      setBusy(false);
    }
  }

  const update = (id: string, patch: Partial<LinkDraft & { picked: boolean }>) =>
    setDraft((cur) => (cur ? { ...cur, [id]: { ...cur[id]!, ...patch } } : cur));

  const loadError = openings.error ?? jobs.error;
  return (
    <div className="grid gap-5">
      <DialogHeader>
        <DialogTitle>Pick Zoho jobs</DialogTitle>
        <DialogDescription>
          Applicants on the jobs you pick come into the HRVoice job you link, and are called with its questions.
        </DialogDescription>
      </DialogHeader>
      {loadError ? (
        <Alert kind="error">{messageText(toUserMessage(loadError, 'load the jobs'))}</Alert>
      ) : !draft ? (
        <div aria-busy="true" className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <span className="sr-only">Loading jobs</span>
        </div>
      ) : Object.keys(draft).length === 0 ? (
        <p className="m-0 text-text-2">There are no job openings in this Zoho Recruit account yet.</p>
      ) : (
        <ul className="m-0 max-h-[60vh] list-none space-y-3 overflow-y-auto p-0">
          {Object.values(draft).map((d) => (
            <li key={d.zohoJobId} className="rounded-input border border-border p-3">
              <Checkbox
                checked={d.picked}
                onChange={(e) => update(d.zohoJobId, { picked: e.target.checked })}
                label={<span className="font-medium">{d.zohoJobTitle}</span>}
              />
              {d.picked ? (
                <div className="mt-2 grid gap-2 pl-[1.75rem]">
                  <Field label="Bring applicants into">
                    <Select
                      value={d.jobId ?? NEW_JOB}
                      onChange={(e) =>
                        update(d.zohoJobId, e.target.value === NEW_JOB ? { jobId: undefined } : { jobId: e.target.value })
                      }
                    >
                      {canCreateJobs ? <option value={NEW_JOB}>A new HRVoice job called “{d.zohoJobTitle}”</option> : null}
                      {hrJobs.map((j) => (
                        <option key={j.id} value={j.id}>
                          {j.title}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Checkbox
                    checked={d.autoCall}
                    onChange={(e) => update(d.zohoJobId, { autoCall: e.target.checked })}
                    label="Call new applicants automatically, between 9:00 am and 8:00 pm India time"
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {blocked ? <Alert kind="warning">Pick an HRVoice job for each Zoho job. Only people who can create jobs can add new ones.</Alert> : null}
      {error ? <Alert kind="error">{error}</Alert> : null}
      <DialogFooter>
        <Button type="button" variant="secondary" className="h-11" disabled={busy} onClick={onDone}>
          Cancel
        </Button>
        <Button type="button" className="h-11" loading={busy} disabled={!dirty || blocked} onClick={() => void save()}>
          Save jobs
        </Button>
      </DialogFooter>
    </div>
  );
}
