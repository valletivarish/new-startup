'use client';

/**
 * Settings → Developers: API keys, webhook endpoints, the delivery log and usage, for
 * people with integrations.read. Keys and signing secrets are shown once, in the dialog
 * that made them. The public guide is /developers.
 */

import Link from 'next/link';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BookOpen, Clock, FlaskConical, KeyRound, Plus, RotateCw, Send, Trash2, Webhook, Zap } from 'lucide-react';
import type { Me } from '@/lib/api';
import {
  API_SCOPES,
  EVENT_INFO,
  SCOPE_INFO,
  WEBHOOK_EVENTS,
  canResend,
  createApiKey,
  createWebhook,
  deleteWebhook,
  deliveryProblem,
  getMonthUsage,
  listApiKeys,
  listDeliveries,
  listWebhooks,
  monthLabel,
  recentMonths,
  resendDelivery,
  revokeApiKey,
  scopeList,
  type ApiKey,
  type ApiKeyMode,
  type ApiScope,
  type WebhookDelivery,
  type WebhookEndpoint,
  type WebhookEvent,
} from '@/lib/developers';
import { messageText, toUserMessage } from '@/lib/errors';
import { formatWhen } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm';
import { CopyField } from '@/components/ui/copy-field';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { Field, Input, Select } from '@/components/ui/input';
import { Alert } from '@/components/ui/notice';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/state-tag';
import { ListCell, ListRow, ListRowPrimary, ListRows } from '@/components/ui/strip';
import { SectionHead, SettingsCard } from './sections';

const KEYS = ['developer', 'api-keys'];
const HOOKS = ['developer', 'webhooks'];
const DELIVERIES = ['developer', 'deliveries'];

export function DevelopersSection({ profile }: { profile: Me }) {
  const perms = profile.activeOrganization?.permissions ?? [];
  const can = (p: string) => perms.includes(p);
  return (
    <div className="space-y-10">
      <Alert
        kind="info"
        title="Try everything in test mode first"
        action={
          <Button asChild variant="secondary" size="sm">
            <Link href="/developers">
              <BookOpen aria-hidden strokeWidth={1.5} />
              Developer guide
            </Link>
          </Button>
        }
      >
        Keys that start with <code className="font-mono">hrv_test_</code> call a simulated phone line instead of a
        real candidate. Test calls are free, don’t count towards your usage, and everything they create is marked
        as test.
      </Alert>
      <ApiKeys canCreate={can('integrations.create')} canRevoke={can('integrations.delete')} />
      <Webhooks
        canCreate={can('integrations.create')}
        canDelete={can('integrations.delete')}
        canResend={can('integrations.update')}
      />
      {can('usage.read') ? <Usage /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ */

function LoadState({ query, what }: { query: UseQueryResult<unknown>; what: string }) {
  if (query.isError) {
    return (
      <Alert
        kind="error"
        title={`Couldn’t load ${what}`}
        action={
          <Button variant="secondary" size="sm" loading={query.isFetching} onClick={() => void query.refetch()}>
            <RotateCw aria-hidden strokeWidth={1.5} />
            Retry
          </Button>
        }
      >
        {toUserMessage(query.error).detail}
      </Alert>
    );
  }
  return (
    <div aria-busy="true" className="space-y-2">
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
      <span className="sr-only">Loading {what}</span>
    </div>
  );
}

function ModeBadge({ mode }: { mode: ApiKeyMode }) {
  return mode === 'test' ? (
    <StatusBadge tone="neutral" icon={FlaskConical}>
      Test
    </StatusBadge>
  ) : (
    <StatusBadge tone="info" icon={Zap}>
      Live
    </StatusBadge>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* API keys                                                                                    */

function ApiKeys({ canCreate, canRevoke }: { canCreate: boolean; canRevoke: boolean }) {
  const queryClient = useQueryClient();
  const keys = useQuery({ queryKey: KEYS, queryFn: listApiKeys });
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows = keys.data?.keys ?? [];
  const active = rows.filter((k) => !k.revokedAt);

  async function revoke() {
    if (!revoking) return;
    setBusy(true);
    setError(null);
    try {
      await revokeApiKey(revoking.id);
      toast.success(`${revoking.name} is revoked. It stopped working straight away.`);
      setRevoking(null);
      void queryClient.invalidateQueries({ queryKey: KEYS });
    } catch (e) {
      setError(messageText(toUserMessage(e, 'revoke the key')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="dev-keys">
      <SectionHead
        id="dev-keys"
        title="API keys"
        count={keys.data ? active.length : undefined}
        description="A key lets your own software add jobs and candidates, start calls and read results. It can only do what its scopes allow, and never more than the person who made it."
        actions={
          canCreate ? (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden strokeWidth={1.5} />
              Create key
            </Button>
          ) : null
        }
      />
      {!keys.data ? (
        <LoadState query={keys} what="your API keys" />
      ) : rows.length === 0 ? (
        <EmptyState
            headingLevel={3}
            className="rounded-card border border-border bg-canvas"
          icon={<KeyRound aria-hidden strokeWidth={1.5} />}
          title="No API keys yet"
          description={canCreate ? 'Create a test key to try the API without placing real calls.' : 'Ask an administrator to create one.'}
        />
      ) : (
        <ListRows
          aria-labelledby="dev-keys"
          columns="minmax(0,1.3fr) auto minmax(0,1.2fr) minmax(0,0.9fr) auto"
          header={
            <>
              <span>Name</span>
              <span>Mode</span>
              <span>Scopes</span>
              <span>Last used</span>
              <span className="sr-only">Actions</span>
            </>
          }
        >
          {rows.map((k) => (
            <ListRow key={k.id}>
              <ListRowPrimary
                title={k.name}
                meta={
                  <>
                    <code className="font-mono">{k.prefix}…</code> · created {formatWhen(k.createdAt)}
                  </>
                }
              />
              <ListCell kind="tag">
                {k.revokedAt ? (
                  <StatusBadge tone="neutral">Revoked</StatusBadge>
                ) : (
                  <ModeBadge mode={k.mode} />
                )}
              </ListCell>
              <ListCell className="text-meta">{scopeList(k.scopes)}</ListCell>
              <ListCell className="text-meta tabular-nums">
                {k.lastUsedAt ? `Used ${formatWhen(k.lastUsedAt)}` : 'Never used'}
              </ListCell>
              <ListCell kind="actions">
                {canRevoke && !k.revokedAt ? (
                  <IconButton
                    size="sm"
                    variant="quiet"
                    label={`Revoke ${k.name}`}
                    onClick={() => {
                      setError(null);
                      setRevoking(k);
                    }}
                  >
                    <Trash2 aria-hidden strokeWidth={1.5} />
                  </IconButton>
                ) : null}
              </ListCell>
            </ListRow>
          ))}
        </ListRows>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          {creating ? (
            <CreateKey
              onDone={() => setCreating(false)}
              onCreated={() => void queryClient.invalidateQueries({ queryKey: KEYS })}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={`Revoke ${revoking?.name ?? 'this key'}?`}
        body="Anything still using it stops working at once. This can’t be undone; you can create a new key."
        confirmLabel="Revoke key"
        tone="danger"
        busy={busy}
        error={error}
        onConfirm={() => void revoke()}
      />
    </section>
  );
}

const DEFAULT_SCOPES: ApiScope[] = ['jobs', 'candidates', 'calls', 'results'];

function CreateKey({ onDone, onCreated }: { onDone: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [mode, setMode] = useState<ApiKeyMode>('test');
  const [scopes, setScopes] = useState<ApiScope[]>(DEFAULT_SCOPES);
  const [nameError, setNameError] = useState<string | null>(null);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    setNameError(trimmed ? null : 'Give the key a name, like the system that will use it.');
    setScopeError(scopes.length ? null : 'Pick at least one thing this key can do.');
    if (!trimmed || !scopes.length) return;
    setBusy(true);
    setFormError(null);
    try {
      const out = await createApiKey({ name: trimmed, mode, scopes });
      setKey(out.key);
      onCreated();
    } catch (e) {
      setFormError(messageText(toUserMessage(e, 'create the key')));
    } finally {
      setBusy(false);
    }
  }

  if (key) {
    return (
      <div className="grid gap-5">
        <DialogHeader>
          <DialogTitle>Your new {mode} key</DialogTitle>
          <DialogDescription>Put it in your server’s secret settings. Send it as a Bearer token.</DialogDescription>
        </DialogHeader>
        <CopyField label="API key" value={key} />
        <Alert kind="warning" title="You won’t see this key again">
          We only keep a fingerprint of it. If you lose it, revoke it and create a new one.
        </Alert>
        <DialogFooter>
          <Button type="button" onClick={onDone}>
            I’ve saved it
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="grid gap-5">
      <DialogHeader>
        <DialogTitle>Create an API key</DialogTitle>
        <DialogDescription>The key is shown once, right after you create it.</DialogDescription>
      </DialogHeader>
      <Field label="Name" error={nameError} hint="Only you see this. Name it after what will use it.">
        <Input
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setNameError(null);
          }}
          maxLength={100}
          autoComplete="off"
          placeholder="Careers site"
        />
      </Field>
      <div className="grid gap-1.5">
        <span aria-hidden className="text-label font-medium text-text">
          Mode
        </span>
        <Segmented
          label="Mode"
          value={mode}
          onValueChange={setMode}
          options={[
            { value: 'test', label: 'Test' },
            { value: 'live', label: 'Live' },
          ]}
        />
        <p className="m-0 text-meta text-text-3">
          {mode === 'test'
            ? 'Calls go to a simulated phone line. Free, and marked as test.'
            : 'Calls go to real candidates and count towards your usage.'}
        </p>
      </div>
      <fieldset className="m-0 grid gap-1 border-0 p-0" aria-describedby={scopeError ? 'key-scopes-error' : undefined}>
        <legend className="mb-1 p-0 text-label font-medium text-text">What it can do</legend>
        {API_SCOPES.map((s) => (
          <div key={s}>
            <Checkbox
              label={<span className="font-medium">{SCOPE_INFO[s].label}</span>}
              checked={scopes.includes(s)}
              aria-describedby={`scope-${s}`}
              onChange={(event) => {
                setScopeError(null);
                setScopes((cur) => (event.target.checked ? [...cur, s] : cur.filter((x) => x !== s)));
              }}
            />
            <p id={`scope-${s}`} className="m-0 -mt-2 pb-1 pl-[1.75rem] text-meta text-text-3">
              {SCOPE_INFO[s].description}
            </p>
          </div>
        ))}
        {scopeError ? (
          <p id="key-scopes-error" role="alert" className="m-0 text-meta text-status-danger-text">
            {scopeError}
          </p>
        ) : null}
      </fieldset>
      {formError ? <Alert kind="error">{formError}</Alert> : null}
      <DialogFooter>
        <Button type="button" variant="secondary" disabled={busy} onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={busy}>
          <KeyRound aria-hidden strokeWidth={1.5} />
          Create key
        </Button>
      </DialogFooter>
    </form>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Webhooks and deliveries                                                                     */

function Webhooks({ canCreate, canDelete, canResend: mayResend }: { canCreate: boolean; canDelete: boolean; canResend: boolean }) {
  const queryClient = useQueryClient();
  const hooks = useQuery({ queryKey: HOOKS, queryFn: listWebhooks });
  const deliveries = useQuery({ queryKey: DELIVERIES, queryFn: listDeliveries });
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<WebhookEndpoint | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState<string | null>(null);
  const endpoints = hooks.data?.endpoints ?? [];
  const urlOf = (id: string) => endpoints.find((e) => e.id === id)?.url ?? 'A deleted endpoint';

  async function remove() {
    if (!removing) return;
    setBusy(true);
    setError(null);
    try {
      await deleteWebhook(removing.id);
      toast.success('Endpoint deleted. Nothing more will be sent to it.');
      setRemoving(null);
      void queryClient.invalidateQueries({ queryKey: HOOKS });
    } catch (e) {
      setError(messageText(toUserMessage(e, 'delete the endpoint')));
    } finally {
      setBusy(false);
    }
  }

  async function resend(d: WebhookDelivery) {
    setResending(d.id);
    try {
      await resendDelivery(d.id);
      toast.success('Sending it again. It’s retried for up to 24 hours if your server doesn’t answer.');
      void queryClient.invalidateQueries({ queryKey: DELIVERIES });
    } catch (e) {
      toast.error(messageText(toUserMessage(e, 'send it again')));
    } finally {
      setResending(null);
    }
  }

  return (
    <>
      <section aria-labelledby="dev-hooks">
        <SectionHead
          id="dev-hooks"
          title="Webhooks"
          count={hooks.data ? endpoints.length : undefined}
          description="We send a signed message to your URL when a call ends, so your system doesn’t have to keep asking."
          actions={
            canCreate ? (
              <Button onClick={() => setAdding(true)}>
                <Plus aria-hidden strokeWidth={1.5} />
                Add endpoint
              </Button>
            ) : null
          }
        />
        {!hooks.data ? (
          <LoadState query={hooks} what="your webhooks" />
        ) : endpoints.length === 0 ? (
          <EmptyState
            headingLevel={3}
            className="rounded-card border border-border bg-canvas"
            icon={<Webhook aria-hidden strokeWidth={1.5} />}
            title="No endpoints yet"
            description="Add the URL on your server that should hear about finished calls."
          />
        ) : (
          <ListRows
            aria-labelledby="dev-hooks"
            columns="minmax(0,1.6fr) auto minmax(0,0.8fr) auto"
            header={
              <>
                <span>URL</span>
                <span>Status</span>
                <span>Added</span>
                <span className="sr-only">Actions</span>
              </>
            }
          >
            {endpoints.map((e) => (
              <ListRow key={e.id}>
                <ListRowPrimary title={<span className="break-all font-mono text-[0.8125rem]">{e.url}</span>} meta={e.events.join(', ')} />
                <ListCell kind="tag">
                  <StatusBadge tone="success">Active</StatusBadge>
                </ListCell>
                <ListCell className="text-meta tabular-nums">{formatWhen(e.createdAt)}</ListCell>
                <ListCell kind="actions">
                  {canDelete ? (
                    <IconButton
                      size="sm"
                      variant="quiet"
                      label={`Delete the endpoint ${e.url}`}
                      onClick={() => {
                        setError(null);
                        setRemoving(e);
                      }}
                    >
                      <Trash2 aria-hidden strokeWidth={1.5} />
                    </IconButton>
                  ) : null}
                </ListCell>
              </ListRow>
            ))}
          </ListRows>
        )}
      </section>

      <section aria-labelledby="dev-deliveries">
        <SectionHead
          id="dev-deliveries"
          title="Delivery log"
          description="The latest 50 messages we sent. Failed ones are retried for 24 hours; you can send any finished one again."
          actions={
            <Button variant="secondary" loading={deliveries.isFetching} onClick={() => void deliveries.refetch()}>
              <RotateCw aria-hidden strokeWidth={1.5} />
              Refresh
            </Button>
          }
        />
        {!deliveries.data ? (
          <LoadState query={deliveries} what="the delivery log" />
        ) : deliveries.data.deliveries.length === 0 ? (
          <EmptyState
            headingLevel={3}
            className="rounded-card border border-border bg-canvas"
            icon={<Send aria-hidden strokeWidth={1.5} />}
            title="Nothing sent yet"
            description="Messages appear here when a call ends and you have an endpoint for that event."
          />
        ) : (
          <ListRows
            aria-labelledby="dev-deliveries"
            columns="minmax(0,1.3fr) auto minmax(0,1.4fr) minmax(0,0.8fr) auto"
            header={
              <>
                <span>Event</span>
                <span>Status</span>
                <span>Attempts and answer</span>
                <span>Sent</span>
                <span className="sr-only">Actions</span>
              </>
            }
          >
            {deliveries.data.deliveries.map((d) => (
              <DeliveryRow
                key={d.id}
                delivery={d}
                url={urlOf(d.endpointId)}
                canResend={mayResend && canResend(d) && endpoints.some((e) => e.id === d.endpointId)}
                resending={resending === d.id}
                onResend={() => void resend(d)}
              />
            ))}
          </ListRows>
        )}
      </section>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          {adding ? (
            <AddEndpoint
              onDone={() => setAdding(false)}
              onCreated={() => void queryClient.invalidateQueries({ queryKey: HOOKS })}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Delete this endpoint?"
        body={
          <>
            Nothing more is sent to <span className="break-all">{removing?.url}</span>, and messages still being retried
            stop. Its delivery log stays.
          </>
        }
        confirmLabel="Delete endpoint"
        tone="danger"
        busy={busy}
        error={error}
        onConfirm={() => void remove()}
      />
    </>
  );
}

function DeliveryStatus({ status }: { status: WebhookDelivery['status'] }) {
  if (status === 'delivered') return <StatusBadge tone="success">Delivered</StatusBadge>;
  if (status === 'failed') return <StatusBadge tone="danger">Failed</StatusBadge>;
  return (
    <StatusBadge tone="neutral" icon={Clock}>
      Sending
    </StatusBadge>
  );
}

function DeliveryRow({
  delivery: d,
  url,
  canResend: allowed,
  resending,
  onResend,
}: {
  delivery: WebhookDelivery;
  url: string;
  canResend: boolean;
  resending: boolean;
  onResend: () => void;
}) {
  const problem = deliveryProblem(d);
  const tries = `${d.attempts} ${d.attempts === 1 ? 'attempt' : 'attempts'}`;
  let answer: ReactNode = d.lastStatusCode ? `${tries} · last answer ${d.lastStatusCode}` : tries;
  if (d.status === 'pending' && d.attempts === 0) answer = 'Not tried yet';
  return (
    <ListRow>
      <ListRowPrimary title={<span className="font-mono text-[0.8125rem]">{d.event}</span>} meta={url} />
      <ListCell kind="tag">
        <DeliveryStatus status={d.status} />
      </ListCell>
      <ListCell className="text-meta">
        <span className="tabular-nums">{answer}</span>
        {problem ? <span className="block text-text-3">{problem}</span> : null}
      </ListCell>
      <ListCell className="text-meta tabular-nums">{formatWhen(d.deliveredAt ?? d.createdAt)}</ListCell>
      <ListCell kind="actions">
        {allowed ? (
          <Button size="sm" variant="secondary" loading={resending} onClick={onResend}>
            <Send aria-hidden strokeWidth={1.5} />
            Send again
          </Button>
        ) : null}
      </ListCell>
    </ListRow>
  );
}

function AddEndpoint({ onDone, onCreated }: { onDone: () => void; onCreated: () => void }) {
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<WebhookEvent[]>(['call.completed', 'call.failed']);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [eventError, setEventError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = url.trim();
    const validUrl = /^https?:\/\/\S+$/i.test(value);
    setUrlError(validUrl ? null : 'Enter the full URL, starting with https://');
    setEventError(events.length ? null : 'Pick at least one event.');
    if (!validUrl || !events.length) return;
    setBusy(true);
    setFormError(null);
    try {
      const out = await createWebhook({ url: value, events });
      setSecret(out.secret);
      onCreated();
    } catch (e) {
      const m = toUserMessage(e, 'add the endpoint');
      const field = m.fieldErrors?.find((f) => f.field === 'url')?.message;
      if (field) setUrlError(field.replace(/^url must/, 'The URL must'));
      else setFormError(messageText(m));
    } finally {
      setBusy(false);
    }
  }

  if (secret) {
    return (
      <div className="grid gap-5">
        <DialogHeader>
          <DialogTitle>Endpoint added</DialogTitle>
          <DialogDescription>
            Use this secret to check that each message really came from us (the HRVoice-Signature header).
          </DialogDescription>
        </DialogHeader>
        <CopyField label="Signing secret" value={secret} />
        <Alert kind="warning" title="You won’t see this secret again">
          Keep it with your server’s other secrets. If you lose it, delete the endpoint and add it again.
        </Alert>
        <DialogFooter>
          <Button type="button" onClick={onDone}>
            I’ve saved it
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="grid gap-5">
      <DialogHeader>
        <DialogTitle>Add a webhook endpoint</DialogTitle>
        <DialogDescription>We’ll POST a signed JSON message to this URL. Answer with any 2xx within 10 seconds.</DialogDescription>
      </DialogHeader>
      <Field label="URL" error={urlError} hint="Use https. While you build, http://localhost works too.">
        <Input
          type="url"
          inputMode="url"
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
            setUrlError(null);
          }}
          autoComplete="off"
          spellCheck={false}
          placeholder="https://example.com/hrvoice/webhook"
        />
      </Field>
      <fieldset className="m-0 grid gap-1 border-0 p-0">
        <legend className="mb-1 p-0 text-label font-medium text-text">Events</legend>
        {WEBHOOK_EVENTS.map((ev) => (
          <div key={ev}>
            <Checkbox
              label={<code className="font-mono text-[0.8125rem]">{ev}</code>}
              checked={events.includes(ev)}
              aria-describedby={`event-${ev}`}
              onChange={(event) => {
                setEventError(null);
                setEvents((cur) => (event.target.checked ? [...cur, ev] : cur.filter((x) => x !== ev)));
              }}
            />
            <p id={`event-${ev}`} className="m-0 -mt-2 pb-1 pl-[1.75rem] text-meta text-text-3">
              {EVENT_INFO[ev]}
            </p>
          </div>
        ))}
        {eventError ? (
          <p role="alert" className="m-0 text-meta text-status-danger-text">
            {eventError}
          </p>
        ) : null}
      </fieldset>
      {formError ? <Alert kind="error">{formError}</Alert> : null}
      <DialogFooter>
        <Button type="button" variant="secondary" disabled={busy} onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={busy}>
          <Webhook aria-hidden strokeWidth={1.5} />
          Add endpoint
        </Button>
      </DialogFooter>
    </form>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Usage                                                                                       */

const MONTHS = recentMonths(12);

function Usage() {
  const [month, setMonth] = useState(MONTHS[0]!);
  const usage = useQuery({ queryKey: ['developer', 'usage', month], queryFn: () => getMonthUsage(month) });
  return (
    <SettingsCard
      title="Usage"
      description="Calls placed through the dashboard and the API. A screen is completed when the candidate spoke and the call lasted at least 20 seconds. Test calls never count."
    >
      <Field label="Month">
        <Select value={month} onChange={(event) => setMonth(event.target.value)}>
          {MONTHS.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </Select>
      </Field>
      {usage.data ? (
        <dl className="m-0 grid grid-cols-2 gap-4" aria-live="polite">
          <Stat label="Calls placed" value={usage.data.callsPlaced} />
          <Stat label="Completed screens" value={usage.data.completedScreens} />
        </dl>
      ) : (
        <LoadState query={usage} what="usage" />
      )}
    </SettingsCard>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-card-sm border border-border bg-subtle px-4 py-3">
      <dt className="text-meta text-text-2">{label}</dt>
      <dd className="m-0 mt-1 text-[1.75rem] font-semibold leading-none tabular-nums text-text">{value}</dd>
    </div>
  );
}
