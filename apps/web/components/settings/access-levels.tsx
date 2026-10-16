'use client';

/**
 * Settings › Access levels (spec 8, ADR-009). Built-in levels are read-only with Duplicate;
 * the workspace's own levels can be created, edited and deleted by people allowed to manage
 * access, and nobody can give a level more than they hold themselves (the server's rule).
 */

import { useId, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Copy, Lock, Minus, PenLine, Plus, RotateCw, Trash2 } from 'lucide-react';
import { createRole, deleteRole, listPermissions, listRoles, updateRole, type Me, type PermissionInfo, type Role } from '@/lib/api';
import { messageText, toUserMessage } from '@/lib/errors';
import { useUseCase } from '@/lib/use-cases';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm';
import { ErrorState } from '@/components/ui/error-state';
import { Field, Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/notice';
import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton, SkeletonRows, useHeldLoading } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/state-tag';
import { ListCell, ListRow, ListRowPrimary, ListRows } from '@/components/ui/strip';
import {
  accessBlurb,
  accessName,
  canGrant,
  groupPermissions,
  hiddenPermissions,
  permissionLabel,
  permissionsToSave,
  sortLevels,
  teamKeys,
  type Granter,
} from './access';
import { SectionHead } from './sections';

type Open = { mode: 'view'; level: Role } | { mode: 'edit'; level: Role } | { mode: 'create'; from?: Role };

const SENSITIVE_HINT = 'Personal data. Each time someone opens it, it’s logged in Activity.';
const peopleCount = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

export function AccessLevels({ profile }: { profile: Me }) {
  const { labels } = useUseCase();
  const org = profile.activeOrganization;
  const me: Granter = { role: org?.role ?? '', permissions: org?.permissions ?? [] };
  const canManage = org?.permissions.includes('roles.manage') ?? false;
  const roles = useQuery({ queryKey: teamKeys.roles, queryFn: listRoles });
  const loading = useHeldLoading(roles.isPending);
  // Kept while the sheet closes, so its content stays drawn through the exit.
  const [open, setOpen] = useState<Open | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  function show(next: Open) {
    setOpen(next);
    setSheetOpen(true);
  }

  let list;
  if (roles.isError) {
    const m = toUserMessage(roles.error, 'load access levels');
    list = (
      <ErrorState
        headingLevel={3}
        title={m.title}
        cause={m.detail}
        onRetry={() => void roles.refetch()}
        retrying={roles.isFetching}
        className="rounded-card border border-border bg-canvas"
      />
    );
  } else if (loading || !roles.data) {
    list = <SkeletonRows rows={5} />;
  } else {
    list = (
      <ListRows
        aria-labelledby="access-levels"
        columns="minmax(0,1fr) auto auto"
        header={
          <>
            <span>Access level</span>
            <span>Type</span>
            <span>People</span>
          </>
        }
      >
        {sortLevels(roles.data.roles).map((level) => {
          // Only a workspace level that holds no more than you do opens for editing.
          const editable = canManage && !level.isSystem && canGrant(level, me);
          const blurb = accessBlurb(level.key, level.description, labels);
          return (
            <ListRow key={level.id}>
              <ListRowPrimary
                title={accessName(level.key, level.name)}
                // Wraps rather than cuts off on phones: the line is what the level is for.
                meta={blurb || undefined}
                wrapMeta
                onOpen={() => show({ mode: editable ? 'edit' : 'view', level })}
              />
              <ListCell kind="tag">
                {level.isSystem ? (
                  <StatusBadge tone="neutral" icon={Lock}>
                    Built in
                  </StatusBadge>
                ) : (
                  <StatusBadge tone="info" icon={PenLine}>
                    Custom
                  </StatusBadge>
                )}
              </ListCell>
              {/* Unknown on older backends: left out, never 0. */}
              <ListCell className="text-meta tabular-nums">
                {level.memberCount != null ? peopleCount(level.memberCount) : ''}
              </ListCell>
            </ListRow>
          );
        })}
      </ListRows>
    );
  }

  return (
    <section aria-labelledby="access-levels">
      <SectionHead
        id="access-levels"
        title="Access levels"
        count={roles.data?.roles.length}
        description="Everyone in the workspace has one. It decides what they can see and do here."
        actions={
          canManage ? (
            <Button onClick={() => show({ mode: 'create' })}>
              <Plus aria-hidden strokeWidth={1.5} />
              Create access level
            </Button>
          ) : null
        }
      />
      {list}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent closeBlockedReason={saving ? 'Saving. This closes when it’s done.' : undefined}>
          {open?.mode === 'view' ? (
            <LevelView
              level={open.level}
              canManage={canManage}
              onDuplicate={() => setOpen({ mode: 'create', from: open.level })}
            />
          ) : open ? (
            <LevelEditor
              // A new key per level, so switching levels starts the form fresh.
              key={open.mode === 'edit' ? open.level.id : `new-${open.from?.id ?? ''}`}
              open={open}
              me={me}
              onSaving={setSaving}
              onDone={() => setSheetOpen(false)}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </section>
  );
}

/** The permission catalogue, grouped for the editor. Loading and failure are drawn here. */
function useCatalogue() {
  return useQuery({ queryKey: teamKeys.permissions, queryFn: listPermissions, staleTime: Infinity });
}

function CatalogueState({ query }: { query: ReturnType<typeof useCatalogue> }) {
  if (query.isError) {
    return (
      <Alert
        kind="error"
        title="Couldn’t load what levels can include"
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
    <div aria-busy="true" className="space-y-3">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-4 w-2/3" />
      ))}
      <span className="sr-only">Loading</span>
    </div>
  );
}

function LevelView({
  level,
  canManage,
  onDuplicate,
}: {
  level: Role;
  canManage: boolean;
  onDuplicate: () => void;
}) {
  const { labels } = useUseCase();
  const catalogue = useCatalogue();
  const held = new Set(level.permissions ?? []);

  return (
    <>
      <SheetHeader>
        <SheetTitle>{accessName(level.key, level.name)}</SheetTitle>
        <SheetDescription>
          {accessBlurb(level.key, level.description, labels) || 'A level made for this workspace.'}
        </SheetDescription>
      </SheetHeader>
      <SheetBody className="space-y-6">
        {canManage ? (
          <p className="m-0 text-meta text-text-3">
            {level.isSystem
              ? 'Built-in levels can’t be changed. Duplicate it to make your own.'
              : 'It holds access you don’t have, so you can’t edit it.'}
          </p>
        ) : null}
        {!catalogue.data ? (
          <CatalogueState query={catalogue} />
        ) : !level.permissions ? (
          <p className="m-0 text-text-2">What this level includes isn’t available here yet.</p>
        ) : (
          groupPermissions(catalogue.data.permissions, labels).map((group) => (
            <section key={group.name}>
              <h3 className="m-0 text-label font-semibold text-text">{group.name}</h3>
              <ul role="list" className="m-0 mt-2 list-none space-y-2 p-0">
                {group.items.map((p) => {
                  const on = held.has(p.key);
                  return (
                    <li key={p.key} className={cn('flex items-start gap-2.5', on ? 'text-text' : 'text-text-3')}>
                      {on ? (
                        <Check aria-hidden strokeWidth={2} className="mt-0.5 size-4 shrink-0 text-status-success-text" />
                      ) : (
                        <Minus aria-hidden strokeWidth={2} className="mt-0.5 size-4 shrink-0" />
                      )}
                      <span className="min-w-0">
                        {permissionLabel(p)}
                        <span className="sr-only">{on ? ', included' : ', not included'}</span>
                        {p.isSensitive ? (
                          <span className="block text-meta text-text-3">{SENSITIVE_HINT}</span>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </SheetBody>
      <SheetFooter>
        {canManage ? (
          // The copy only keeps what you hold yourself.
          <Button variant="secondary" onClick={onDuplicate}>
            <Copy aria-hidden strokeWidth={1.5} />
            Duplicate
          </Button>
        ) : null}
        <SheetClose asChild>
          <Button>Done</Button>
        </SheetClose>
      </SheetFooter>
    </>
  );
}

function LevelEditor({
  open,
  me,
  onSaving,
  onDone,
}: {
  open: Exclude<Open, { mode: 'view' }>;
  me: Granter;
  onSaving: (saving: boolean) => void;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const { labels } = useUseCase();
  const catalogue = useCatalogue();
  const formId = useId();
  const editing = open.mode === 'edit' ? open.level : null;
  const source = editing ?? (open.mode === 'create' ? open.from : undefined);
  const holds = (key: string) => me.role === 'owner' || me.permissions.includes(key);

  const [name, setName] = useState(() =>
    editing ? accessName(editing.key, editing.name) : source ? `${accessName(source.key, source.name)} (copy)` : '',
  );
  const [description, setDescription] = useState(() =>
    editing ? editing.description : source ? accessBlurb(source.key, source.description, labels) : '',
  );
  // A duplicate starts from what you could give yourself: nothing more than you hold.
  const [ticked, setTicked] = useState(() => new Set((source?.permissions ?? []).filter(holds)));
  const [errors, setErrors] = useState<{ name?: string; permissions?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function setWorking(next: boolean) {
    setBusy(next);
    onSaving(next);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!catalogue.data) return;
    const hidden = hiddenPermissions(catalogue.data.permissions);
    const trimmed = name.trim();
    const next: typeof errors = {};
    if (trimmed.length < 2 || trimmed.length > 60) next.name = 'Use 2 to 60 characters.';
    if (![...ticked].some((key) => !hidden.has(key))) next.permissions = 'Choose at least one thing this level can do.';
    setErrors(next);
    if (next.name || next.permissions) return;

    const permissions = permissionsToSave(ticked, (source?.permissions ?? []).filter(holds), hidden);
    const input = { name: trimmed, description: description.trim(), permissions };
    setWorking(true);
    try {
      if (editing) await updateRole(editing.id, input);
      else await createRole(input);
      await queryClient.invalidateQueries({ queryKey: ['team'] });
      toast.success(editing ? `${trimmed} saved` : `${trimmed} created`, {
        description: editing
          ? 'People on this level get the change straight away.'
          : 'Pick it when you invite someone or change their access.',
      });
      onDone();
    } catch (e) {
      const fields = toUserMessage(e).fieldErrors ?? [];
      const fieldError = (f: string) => fields.find((x) => x.field === f)?.message;
      if (fieldError('name') || fieldError('permissions')) {
        setErrors({ name: fieldError('name'), permissions: fieldError('permissions') });
      } else {
        const context = editing ? 'save this access level' : 'create the access level';
        setErrors({ form: messageText(toUserMessage(e, context)) });
      }
    } finally {
      setWorking(false);
    }
  }

  async function remove() {
    if (!editing) return;
    setWorking(true);
    setDeleteError(null);
    try {
      await deleteRole(editing.id);
      await queryClient.invalidateQueries({ queryKey: ['team'] });
      toast.success(`${accessName(editing.key, editing.name)} deleted`);
      setConfirmDelete(false);
      onDone();
    } catch (e) {
      setDeleteError(messageText(toUserMessage(e, 'delete this access level')));
    } finally {
      setWorking(false);
    }
  }

  const inUse = editing?.memberCount ?? 0;

  return (
    <>
      <SheetHeader>
        <SheetTitle>{editing ? `Edit ${accessName(editing.key, editing.name)}` : 'New access level'}</SheetTitle>
        <SheetDescription>
          {editing
            ? 'Changes reach everyone on this level straight away.'
            : 'Name it after the job people do, then choose what they can see and do.'}
        </SheetDescription>
      </SheetHeader>
      <SheetBody>
        <form id={formId} noValidate onSubmit={(event) => void save(event)} className="space-y-6">
          <Field label="Name" hint="For example, Hiring lead." error={errors.name}>
            <Input
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setErrors((prev) => ({ ...prev, name: undefined }));
              }}
              maxLength={60}
              required
            />
          </Field>
          <Field label="Description" hint="Optional. One line on who it’s for.">
            <Input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={300} />
          </Field>

          {!catalogue.data ? (
            <CatalogueState query={catalogue} />
          ) : (
            <div className="space-y-6">
              <div>
                <p className="m-0 text-label font-medium text-text">What people on this level can do</p>
                {errors.permissions ? (
                  <p role="alert" className="mb-0 mt-1.5 text-meta text-status-danger-text">
                    {errors.permissions}
                  </p>
                ) : null}
              </div>
              {groupPermissions(catalogue.data.permissions, labels).map((group) => (
                <fieldset key={group.name} className="m-0 min-w-0 border-0 p-0">
                  <legend className="mb-1 p-0 text-label font-semibold text-text">{group.name}</legend>
                  {group.items.map((p) => (
                    <PermissionBox
                      key={p.key}
                      permission={p}
                      checked={ticked.has(p.key)}
                      disabled={!holds(p.key)}
                      unheld={!holds(p.key)}
                      onChange={(on) => {
                        setTicked((prev) => {
                          const next = new Set(prev);
                          if (on) next.add(p.key);
                          else next.delete(p.key);
                          return next;
                        });
                        setErrors((prev) => ({ ...prev, permissions: undefined }));
                      }}
                    />
                  ))}
                </fieldset>
              ))}
            </div>
          )}
          {errors.form ? <Alert kind="error">{errors.form}</Alert> : null}
        </form>
      </SheetBody>
      <SheetFooter className="justify-between">
        {editing ? (
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <Button
              type="button"
              variant="destructive-secondary"
              disabled={busy || inUse > 0}
              onClick={() => {
                setDeleteError(null);
                setConfirmDelete(true);
              }}
            >
              <Trash2 aria-hidden strokeWidth={1.5} />
              Delete
            </Button>
            {inUse > 0 ? (
              <span className="text-meta text-text-3">
                {peopleCount(inUse)} {inUse === 1 ? 'has' : 'have'} it. Move them first.
              </span>
            ) : null}
          </div>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <SheetClose asChild>
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </SheetClose>
          <Button type="submit" form={formId} loading={busy} disabled={!catalogue.data}>
            {editing ? 'Save changes' : 'Create access level'}
          </Button>
        </div>
      </SheetFooter>

      {editing ? (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={`Delete ${accessName(editing.key, editing.name)}?`}
          body="Nobody has this level now, so no one loses access. You can’t undo this."
          confirmLabel="Delete access level"
          tone="danger"
          busy={busy}
          error={deleteError}
          onConfirm={() => void remove()}
        />
      ) : null}
    </>
  );
}

function PermissionBox({
  permission: p,
  checked,
  disabled,
  unheld,
  onChange,
}: {
  permission: PermissionInfo;
  checked: boolean;
  disabled: boolean;
  unheld: boolean;
  onChange: (on: boolean) => void;
}) {
  const hintId = useId();
  const hint = unheld ? 'You don’t have this yourself, so you can’t give it.' : p.isSensitive ? SENSITIVE_HINT : null;
  return (
    <div>
      <Checkbox
        label={
          <span className="inline-flex items-center gap-1.5">
            {permissionLabel(p)}
            {p.isSensitive ? <Lock aria-hidden strokeWidth={1.75} className="size-3.5 shrink-0 text-text-3" /> : null}
          </span>
        }
        checked={checked}
        disabled={disabled}
        aria-describedby={hint ? hintId : undefined}
        onChange={(event) => onChange(event.target.checked)}
      />
      {hint ? (
        <p id={hintId} className="m-0 -mt-2 mb-1 pl-7 text-meta text-text-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
