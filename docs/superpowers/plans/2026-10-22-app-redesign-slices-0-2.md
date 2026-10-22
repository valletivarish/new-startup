# App redesign, slices 0–2 (clear stages and pages) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first visible redesign: four-item navigation (Jobs, People, Reports, Settings), one vocabulary, job pages split into Set up / People / Review with a Next banner, Settings on real routes, and redirects from every old URL — with no stored-data or API change.

**Architecture:** Display labels change only through `lib/status-labels.ts` and `components/candidates/fit.ts`. New routes are thin pages that reuse today's components (the god files are split in slice 10, not here). One client hook, `useJobReadiness`, wraps the existing pure `jobReadiness` and feeds the job tabs, the Next banner and the job cards. Old URLs redirect through `next.config` `redirects()` (static) and small server pages (`/jobs/[id]` opening rule).

**Tech Stack:** Next.js 15 app router, React 19, TanStack Query, Tailwind, vitest, playwright-core for QA screenshots.

**Spec:** `docs/superpowers/specs/2026-10-22-app-redesign-design.md` (the "Founder decisions" section wins over the judge's text).

## Global Constraints

- No stored enum, API, SDK, Zapier or MCP change in these slices. Labels only.
- Job words: **Draft · Active · Closed**; "Show archived" filter for archived. (Paused needs a stored state, so it is not in these slices.) An open job without a calling number is **Active** plus the banner "Browser test calls only until your calling number is set up".
- Fit words: **Meets all · Needs a look · Doesn't meet**. No answers → no chip (the old "Not screened" lane is gone from the UI). Chips carry text + icon, never colour alone.
- Decision words: **No decision yet · On hold · Moved forward · Not moving forward**. "No decision yet" is real text.
- Call words: Not called yet · On the phone · Answered · Didn't connect (· Rang out / · Voicemail / · Number not reachable) · Will retry. Map only from existing stored states (`no_answer`, `voicemail`, `line_not_connected`, ...).
- Plain recruiter language; never vendor names; WCAG 2.2 AA; 44 px targets; no sideways scroll at 390 px; focused fields never hidden under sticky bars.
- Every agent works in its own git worktree and commits only its own files; commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Before a task is "done": `pnpm --filter @platform/web exec vitest run`, `pnpm --filter @platform/web exec tsc --noEmit -p .`, and `pnpm --filter @platform/web lint` all clean.

## Review Focus

- Deep links people already have (`/dashboard`, `/candidates`, `/jobs/<id>/candidates?stage=reviewed&lane=meets_all`, `/settings?section=developers`, `/calls?candidateId=…`) must land on the matching new page with the same filter, not a 404 or an unfiltered list.
- A member without `candidates.read` / `analytics.read` / `integrations.read` must not see the nav item, tab or settings page, and a direct URL shows the existing "no access" state.
- A Draft job with zero candidates opens on Set up; an Active job with zero candidates opens on People with an empty state that names one verb ("Add people").
- At 390 px the job tabs with counts ("Set up · People 17 · Review 5") never truncate a label and the bottom bar never covers the focused field.
- Platform admins still reach Costs, Support inbox and Agents (from the account menu) after they leave the sidebar.

---

### Task 1: Characterisation tests (slice 0)

Pins today's behaviour so the later tasks can't change it by accident. Labels are NOT pinned here (Task 2 changes them).

**Files:**
- Create: `apps/web/lib/redesign-baseline.test.ts`

**Interfaces:**
- Consumes: `jobReadiness` (`components/jobs/setup.ts`), `gate`, `isActive` (`components/layout/app-shell/nav.ts`), fit sort helper in `components/candidates/fit.ts` (the function containing the `meets_all` comparator at line ~171), the bulk-confirm threshold constant in `app/jobs/[id]/candidates/page.tsx` (export it if it isn't, no behaviour change).
- Produces: nothing new for other tasks.

- [ ] **Step 1:** Write `describe('redesign baseline')` with these tests:
  - `jobReadiness` returns `ready: true` only when description is saved AND agent is live; `phoneReady` additionally needs `line === 'connected'`; a pending document gives `description: 'preparing'`.
  - the fit sort puts `meets_all` first and is stable for equal items.
  - bulk decisions need the typed confirmation at exactly 24 people and not at 23.
  - `gate()` hides items whose permission the person lacks, marks them `pending` while permissions are `undefined`.
- [ ] **Step 2:** Run `pnpm --filter @platform/web exec vitest run lib/redesign-baseline.test.ts` — expect PASS (it describes current behaviour; if anything fails, the test is wrong, not the code).
- [ ] **Step 3:** Commit `test(web): pin readiness, fit sort, bulk-confirm and nav gating before the redesign`.

### Task 2: Vocabulary pass (slice 1)

**Files:**
- Modify: `apps/web/lib/status-labels.ts` (job, call labels), `apps/web/components/candidates/fit.ts` (lane labels; drop `not_screened` from rendered lanes), `apps/web/lib/use-case-definitions.ts` (stage labels if they duplicate)
- Modify: every `*.test.ts` that asserts an old label (grep `Open for calls`, `"Check"`, `Not screened`, `test calls only`)
- Test: `apps/web/lib/status-labels.test.ts` (create if absent)

**Interfaces:**
- Produces: `STATE_MAP.job.open.label === 'Active'`, `STATE_MAP.job.open_test_only.label === 'Active'` with a new exported const `TEST_ONLY_BANNER = 'Browser test calls only until your calling number is set up'`; `LANE_LABEL.check === 'Needs a look'`; call labels per Global Constraints.

- [ ] **Step 1:** Failing test: assert each label above, plus `STATE_MAP.call.no_answer.label === "Didn't connect · Rang out"`, `voicemail → "Didn't connect · Voicemail"`, `line_not_connected → "Didn't connect · Number not reachable"`, and that no exported label contains "Open for calls", "Check" (as a lane), "Not screened", "Published" or "Live" for jobs.
- [ ] **Step 2:** Run it, expect FAIL.
- [ ] **Step 3:** Change the labels in the three label files only. Do NOT edit page/JSX files: Tasks 3–5 own those and run in parallel. Instead export `JOB_ACTION_LABEL = { open: 'Make active', reopen: 'Make active again', draft: 'Move to draft', close: 'Close job' }` from `status-labels.ts` for Task 5 to use, and list in your report every JSX string still showing an old word, with file:line, for the owning task.
- [ ] **Step 4:** Full web vitest + tsc + lint pass.
- [ ] **Step 5:** Commit `feat(web): one vocabulary for jobs, calls and fit (labels only)`.

### Task 3: Four-item navigation

**Files:**
- Modify: `apps/web/components/layout/app-shell/nav.ts`, `nav-icons.tsx`, `mobile.tsx`, `sidebar.tsx` (only if it reads the removed `workspace` group), `account.tsx` (admin links), `apps/web/components/layout/CommandMenu.tsx`
- Test: `apps/web/components/layout/app-shell/nav.test.ts` (create or extend)

**Interfaces:**
- Produces: `buildNav(labels)` returns `{ main: NavItem[] }` with exactly `[{href:'/jobs',label:'Jobs'},{href:'/people',label:'People',permission:'candidates.read'},{href:'/reports',label:'Reports',permission:'analytics.read'},{href:'/settings',label:'Settings'}]`; `adminLinks: NavItem[]` (`/admin/costs` Costs, `/admin/support` Support inbox, `/agents` Agents — all `permission: 'platform.admin'`) rendered in the account menu.

- [ ] **Step 1:** Failing tests: `buildNav` returns those four in order; `isActive('/jobs/abc/review','/jobs')` is true; `adminLinks` gated to `platform.admin`.
- [ ] **Step 2:** Implement. Mobile: four items fit the bottom bar, so remove the "More" sheet. Nav icons: add People and Reports animated icons in the existing `nav-icons.tsx` style; remove unused ones. Command menu items: "New job" (`/jobs?create=1`), "Add people" (opens the jobs list), "Invite a teammate" (`/settings/team?invite=1`), "Go to Settings".
- [ ] **Step 3:** vitest + tsc + lint pass; check sidebar hover-peek still works at 1440 and the bottom bar at 390 (playwright screenshot to `scratchpad/redesign/nav-*.png`).
- [ ] **Step 4:** Commit `feat(web): four-item navigation (Jobs, People, Reports, Settings)`.

### Task 4: Settings on real routes, People and Reports pages, static redirects

**Files:**
- Create: `apps/web/app/settings/layout.tsx` (AppShell, header, section links), `apps/web/app/settings/{company,calling,team,sources,activity,account,advanced}/page.tsx`, `apps/web/app/settings/sections.ts` (typed array `SettingsSection { slug, label, permission?, visible?(ctx) }`), `apps/web/app/people/page.tsx`, `apps/web/app/reports/page.tsx`
- Modify: `apps/web/app/settings/page.tsx` (becomes a redirect to `/settings/company`, honouring `?section=`), `apps/web/next.config.ts` (add `redirects()`), `apps/web/app/sitemap.ts` if it lists app routes
- Test: `apps/web/app/settings/sections.test.ts`, `apps/web/lib/redirects.test.ts`

**Interfaces:**
- Consumes: existing `WorkspaceSection`, `TeamSettings`, `AccessLevels`, `ActivityLog`, `ConnectedSystemsSection`, `DevelopersSection`, `AccountSection`, the knowledge page content, the candidates page content, the analytics page content.
- Produces: `SETTINGS_SECTIONS: readonly SettingsSection[]` in order company, calling, team, sources, activity, account, advanced; `LEGACY_SECTION: Record<string,string>` mapping `workspace→company`, `team→team`, `access→team`, `activity→activity`, `connected→sources`, `developers→advanced`, `account→account`; `staticRedirects(): { source; destination; permanent: false }[]` exported from `apps/web/lib/redirects.ts` and used by `next.config.ts`.

- [ ] **Step 1:** Failing tests: section order and gates (`advanced` needs `integrations.read`; `sources` hidden when Zoho is unavailable AND nothing else is connected); `LEGACY_SECTION` as above; `staticRedirects()` contains `/dashboard→/jobs`, `/candidates→/people`, `/analytics→/reports`, `/knowledge→/settings/company`, `/tools→/jobs`.
- [ ] **Step 2:** Implement. `company` = workspace name/details + the knowledge documents UI (moved as-is); `calling` = calling number, hours, consent, hand-off numbers note, Meets-all auto-advance toggle (moved from workspace section as-is); `team` = TeamSettings + AccessLevels. `/people` renders today's `/candidates` content (title "People"); `/reports` renders today's analytics (title "Reports"). Old `app/candidates`, `app/analytics`, `app/knowledge`, `app/tools`, `app/dashboard` page files are deleted (their content moved), so the redirects are the only path. `/calls` and `/agents*` stay (not in nav).
- [ ] **Step 3:** vitest + tsc + lint; screenshots of each settings page at 1440/390.
- [ ] **Step 4:** Commit `feat(web): Settings on real routes, People and Reports pages, redirects from old URLs`.

### Task 5: Job pages: Set up / People / Review, Next banner, useJobReadiness

**Files:**
- Create: `apps/web/features/readiness/use-job-readiness.ts`, `apps/web/features/readiness/next-action.ts`, `apps/web/app/jobs/[id]/layout.tsx` (job header, tabs, Next banner), `apps/web/app/jobs/[id]/setup/page.tsx`, `apps/web/app/jobs/[id]/people/page.tsx`, `apps/web/app/jobs/[id]/review/page.tsx`, `apps/web/components/jobs/job-tabs.tsx`
- Modify: `apps/web/app/jobs/[id]/page.tsx` (becomes the opening-rule redirect), `apps/web/app/jobs/[id]/candidates/page.tsx` (its component is exported for reuse and the route redirects), the old setup component moves to a module imported by `setup/page.tsx` (move, don't rewrite)
- Test: `apps/web/features/readiness/next-action.test.ts`, `apps/web/components/jobs/job-tabs.test.tsx`

**Interfaces:**
- Consumes: `jobReadiness`, `Readiness` from `components/jobs/setup.ts`; telephony status query `['telephony-status']`.
- Produces: `useJobReadiness(jobId: string): { readiness: Readiness | undefined; next: NextAction | undefined; isLoading: boolean }`; `nextAction(r: Readiness, counts: { people: number; answered: number; undecided: number }): NextAction` where `NextAction = { label: string; href: string; tab: 'setup' | 'people' | 'review' }`; `openingTab(status: JobStatus): 'setup' | 'people'` (`draft → setup`, else `people`).

- [ ] **Step 1:** Failing tests for `nextAction`, in priority order: description missing → `{label:'Add the job description', tab:'setup'}`; agent not live → `{label:'Finish setting up the call', tab:'setup'}`; no people → `{label:'Add people', tab:'people'}`; answered with undecided > 0 → `{label:'Review <n> answers', tab:'review'}`; people not called → `{label:'Start calling', tab:'people'}`; otherwise `{label:'All caught up', tab:'people'}`. And `openingTab`.
- [ ] **Step 2:** Implement the hook (TanStack Query, shared keys) and pure functions.
- [ ] **Step 3:** Pages: `/jobs/[id]` server-redirects to `/jobs/[id]/setup` for Draft else `/people` (keep the query string). `/jobs/[id]/candidates` redirects to `/review` when `stage=reviewed` or a `lane` param is present, else `/people`, keeping params. `people` = today's board; `review` = today's board with answered-only filter and fit lanes as the primary filter, decision filter defaulting to "No decision yet". Tabs are links with `aria-current="page"` and count badges. The Next banner shows one button from `nextAction`, plus `TEST_ONLY_BANNER` when the job is open without a number.
- [ ] **Step 4:** vitest + tsc + lint; playwright screenshots of a Draft job and an Active job with answers at 1440/390.
- [ ] **Step 5:** Commit `feat(web): job pages Set up / People / Review with one Next action`.

### Task 6: Jobs home (after Tasks 2–5 merge)

**Files:**
- Modify: `apps/web/app/jobs/page.tsx` (job cards with status word, counts and a **Next:** line from `nextAction`; the existing Home `Queues` rendered at the top as "Needs you", max 3 rows + "Show all"; first-run `GettingStarted` shown when there are no jobs)
- Test: `apps/web/app/jobs/job-card.test.tsx`

**Interfaces:**
- Consumes: `nextAction`, `useJobReadiness` (Task 5), `Queues`, `GettingStarted` (`components/home/*`), status labels (Task 2).

- [ ] **Step 1:** Failing test: a card for a Draft job without a description shows "Next: Add the job description" linking to `/jobs/<id>/setup`; an Active job with 2 undecided answers shows "Next: Review 2 answers" linking to `/jobs/<id>/review`.
- [ ] **Step 2:** Implement; delete the now-unused `/dashboard` components only if nothing else imports them.
- [ ] **Step 3:** vitest + tsc + lint; screenshots at 1440/390.
- [ ] **Step 4:** Commit `feat(web): Jobs is home — needs-you list and a Next line on every job`.

### Task 7: QA and release

- [ ] **Step 1 (QA user, Haiku):** On the local stack, walk signup-free demo login → Jobs → a Draft job → Set up → People → add one person → Review, at 1440 and 390 px; list every place a first-time HR user would hesitate, with screenshots.
- [ ] **Step 2 (QA tests, Haiku):** run web vitest, tsc, lint, API suite, `CLIENTS_API_PORT=3011 pnpm -s test:clients`; report exact failures.
- [ ] **Step 3 (Reviewer, Sonnet):** review the merged diff against this plan's Global Constraints and Review Focus; every finding fixed or rejected with a reason.
- [ ] **Step 4 (Founder):** re-run the suites myself, deploy (VM then Vercel), push.
