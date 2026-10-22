'use client';

/**
 * Settings › Access levels (spec 8, ADR-009). The built-in levels are viewable and read-only.
 * Creating, editing and deleting custom levels is not offered: the API has no /roles writes.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Lock, Minus, PenLine, RotateCw } from 'lucide-react';
import { listPermissions, listRoles, type Role } from '@/lib/api';
import { toUserMessage } from '@/lib/errors';
import { useUseCase } from '@/lib/use-cases';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
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
  groupPermissions,
  permissionLabel,
  sortLevels,
  teamKeys,
} from './access';
import { SectionHead } from './sections';

const SENSITIVE_HINT = 'Personal data. Each time someone opens it, it’s logged in Activity.';
const peopleCount = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

export function AccessLevels() {
  const { labels } = useUseCase();
  const roles = useQuery({ queryKey: teamKeys.roles, queryFn: listRoles });
  const loading = useHeldLoading(roles.isPending);
  // Kept while the sheet closes, so its content stays drawn through the exit.
  const [open, setOpen] = useState<Role | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  function show(level: Role) {
    setOpen(level);
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
          const blurb = accessBlurb(level.key, level.description, labels);
          return (
            <ListRow key={level.id}>
              <ListRowPrimary
                title={accessName(level.key, level.name)}
                // Wraps rather than cuts off on phones: the line is what the level is for.
                meta={blurb || undefined}
                wrapMeta
                onOpen={() => show(level)}
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
      />
      {list}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent>{open ? <LevelView level={open} /> : null}</SheetContent>
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

function LevelView({ level }: { level: Role }) {
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
        {level.isSystem ? <p className="m-0 text-meta text-text-3">Built-in levels can’t be changed.</p> : null}
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
        <SheetClose asChild>
          <Button>Done</Button>
        </SheetClose>
      </SheetFooter>
    </>
  );
}
