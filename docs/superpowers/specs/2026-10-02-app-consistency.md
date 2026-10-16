# App consistency rulebook (D2 app, matched to the website)

2026-10-02. For everyone rebuilding an app page. The app follows Dribbble D2 "Voiceon" (Oripio) for its **style, not its layout or content** (founder: "don't exactly copy, but same stylings"); the website follows Synergos (`2026-10-02-synergos-website.md`). The D2 parts of `2026-10-01-l1-d2-visual-system.md` still hold where this file is silent. Product truth: `apps/web/PRODUCT.md`.

**Shared layer is done; don't fork it.** Already landed: buttons and icon buttons 10px (`rounded-button`), status tags 6px (`rounded-xs`), Segmented 12px track with 8px chips, search fields 12px, D2 toasts, the agent character as brand mark and agent avatar, `EmptyState agent=`, `TranscriptCard agentState=`, `agentStateFor()`, the photo AuthShell, `cn` merging role radii. Need a change in `components/ui|shared|layout`? Ask for it; don't patch around it.

## 1. Page frame

```tsx
<AppShell profile={me.data ?? null} breadcrumb={[{ label: 'Jobs', href: '/jobs' }, { label: job.title }]}>
  <PageMain>
    <PageHeader title="Jobs" accent="you’re hiring for" description="One line in plain words."
      actions={<Button asChild><Link href="/jobs?create=1"><Plus aria-hidden strokeWidth={1.5} />Create job</Link></Button>} />
    {/* sections */}
  </PageMain>
</AppShell>
```

- One `h1` per page, always through `PageHeader` (28px/600). Sections: `h2 className="m-0 text-section text-text"`; card titles `text-title font-semibold`.
- **One serif-italic phrase per page**, in the h1 only: `accent` (appended) or `<span className="serif-accent">` inside `title`. Never in body, buttons, tags or cards.

| Page | h1 (suggested) |
|---|---|
| Home | Good evening, *Priya* (exists) |
| Jobs | Jobs *you’re hiring for* |
| Candidates | Candidates *across your jobs* |
| Calls | Every call, *on the record* |
| Agents | Your *AI hiring agent* |
| Knowledge | What the agent *answers from* |
| Tools | What the agent *can do* |
| Analytics | Analytics *from real calls* |
| Settings | Settings *for your workspace* |
| Job, candidate (record pages) | The record's own name, no accent: an italic name reads as decoration |

## 2. Surfaces, radius, depth

| Role | Classes |
|---|---|
| Card | `rounded-card border border-border bg-canvas p-5 sm:p-6` (no shadow, or `shadow-xs`) |
| Inner card, tile, board card | `rounded-card-sm border border-border bg-canvas` or `bg-subtle` |
| Hero card (one per page at most, Home owns it) | `HERO` from `components/home/queues` |
| Quiet fill / selected row | `bg-subtle` / `bg-accent-soft` |
| Buttons, icon buttons | `rounded-button` (Button does it) |
| Inputs, search, menu items | `rounded-input` (Input does it) |
| Tags | `rounded-xs` (StatusBadge does it) |
| Avatars, count bubbles, voice bars | `rounded-full` / `rounded-pill` |
| Menus, dialogs, sheets | `shadow-float` (components do it) |

Text: `text-text`, `text-text-2` (body, descriptions), `text-text-3` (meta, never under 4.5:1: ok on canvas, subtle, muted, ground). Sizes: `text-caption|meta|body|label|title|section|subpage|page`. Numbers `tabular-nums`. Sentence case, no all-caps eyebrows, no em or en dashes.

## 3. Buttons

`<Button>` only (never a hand-rolled action button). `primary` = the one main action in a view (ink); `secondary` = white with hairline; `tertiary` (`quiet`) = low emphasis; `destructive` only inside a confirm; `destructive-secondary` for End call style actions; `link` for inline text actions. Sizes `sm` (36, rows and cards), `md` (40, default), `lg` (48, auth). Links: `<Button asChild><Link …/></Button>`. Leading Lucide icon, `strokeWidth={1.5}`, `aria-hidden`. Busy: `loading` (label stays). Icon only: `<IconButton label="…">` (label is required; it is the name and tooltip). Real phone calls and deletes confirm with `ConfirmDialog` (`tone="real-world"` / `"danger"`).

## 4. Lists, boards, filters

- Lists: `ListRows` (`columns`, `header`) > `ListRow` > `ListRowPrimary` (`avatar={<UserInitials name=… />}`, `title`, `meta`, `href` or `onOpen`) + `ListCell kind="meta|tag|actions"`. Rows are 56px, hover `bg-subtle`, open row `selected`. Phones reflow to two lines on their own: no wide tables.
- Boards: `Board` > `BoardColumn title count` > `ListRow`s. Counts are true totals; show "Showing 5 of 9" when sliced; missing counts are left out, never 0.
- Filters: `Segmented` (radio group). Page sections: `Tabs` (underline). Search: `SearchInput`.

## 5. Status

`<StatusTag domain="call|job|agent|invite|voice" value={raw} />`, stages `<StageTag value={stage} />`, one-offs `<StatusBadge tone icon>`. Icon + word always; raw API values never reach the screen; no new colours. `LiveDot` (`icon="live"`) only while something is live now.

## 6. Loading, empty, error

- Loading: `const loading = useHeldLoading(q.isPending)` then `SkeletonPage | SkeletonRows | SkeletonBoard | SkeletonCard` shaped like the result. No spinner pages.
- Empty: `<EmptyState title description action icon={<Phone />} />`. About calls or the agent: `agent="idle"` (or `"missed"` when calls didn't connect) instead of the icon.
- Error: `const m = toUserMessage(error, 'load calls')` then `<ErrorState title={m.title} cause={m.detail} onRetry retrying />`; offline `variant="offline"`. Inline: `<Alert kind="error|warning|info|success" title action>`. Stale data that failed to refresh: warning Alert "Couldn’t refresh X" + Retry (Home's pattern). Every failure says what happened, then the next step.
- Toasts: `toast.success|error|warning|info` (sonner); decisions with Undo `toastUndo`.

## 7. The agent character

`<Agent size state colour onLight follow hoverable />` from `components/brand/agent` (never edit it). It is the brand and the agent's face; it replaces every old orb.

| Where | Use | State |
|---|---|---|
| Sidebar, phone top bar | `<BrandLink href="/dashboard" />` (done) | idle, alive |
| Live phone call | `<LiveCallCard state=… />` (done) | automatic: ringing, listening, thinking (writing up), done, missed |
| Transcript | `<TranscriptCard agentState=… />` | `agentStateFor(callKey)`; `'done'` for a finished call; live: `'speaking'` on the agent's turn, else `'listening'` |
| Browser test call, call monitor | `<HiringVoiceFace state=… size={44} />` (wired) | from the voice SDK |
| Agent page or tile | `<Agent size={48} colour="ink" onLight />` | `'idle'`; never act out a call that isn't happening |
| Empty states about calls or the agent | `<EmptyState agent="idle" />` | idle / missed |
| On sky, photos, dark glass | `<Agent size={n} />` (pearl) | as above |

Light surfaces: always `colour="ink" onLight`. One animated agent per card, never one per list row (people get `UserInitials`), at most three on screen. Decorative: the state is always also in words (StatusTag). Reduced motion is handled inside it.

## 8. Words

| Say | Not |
|---|---|
| AI hiring agent, the agent | bot, model, voice model, hiring voice |
| call, screening call, test call in your browser | a screen (as a noun), session, conversation, demo |
| calling number | line, phone line, telephony, DID |
| job | role (for a job opening), requisition |
| the people you allow, who can see this | roles, RBAC, permissions (when talking about access) |
| workspace | organization, org, tenant |
| Ready for review, Moved forward, Not moving forward | shortlisted, rejected, hire, score, fit |

No vendor names (speech, model or telephony). Contact and work-item words come from `useUseCase().labels`. Never fabricate a number, person or customer; missing is shown as missing.

## 9. Old to new (when rebuilding a page)

| Old | New |
|---|---|
| `text-[var(--foreground)]`, `--foreground-secondary`, `--foreground-tertiary`/`-muted` | `text-text`, `text-text-2`, `text-text-3` |
| `border-[var(--separator…)]`, `bg-[var(--surface-secondary)]` | `border-border`, `bg-subtle` |
| `font-display text-[1.375rem] font-semibold`, `text-[11px] uppercase tracking-wide` | `text-subpage` / `text-section`, `text-meta text-text-3` sentence case |
| `<p role="alert" className="rounded-md bg-[color-mix…]">`, `Notice`, `Surface` | `<Alert kind>`, cards (section 2) |
| `Badge tone`, `ThinkingStatus` | `StatusTag` / `StatusBadge` |
| `HiringVoiceFace working` | `HiringVoiceFace state` |
| `rounded-md`, `rounded-[1rem]`, `rounded-full` buttons | role radii (section 2) |

## 10. Done means

390px: no sideways scroll, 44px targets (Button and Input handle it; custom controls add `[@media(pointer:coarse)]:min-h-11`). Keyboard reaches everything with the global focus ring (inside clipped scrollers `focus-visible:-outline-offset-2`). 4.5:1 text. `motion-safe:` on every animation. No new console errors. Same API calls as before. `pnpm typecheck` and `pnpm test` pass. Screenshots at 1440 and 390, headless only.
