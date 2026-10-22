# HRVoice app redesign: clear stages and pages, open for extension

Date: 22 October 2026. Status: **approved by the founder-delegate** (the founder asked me to act as founder: "continue as auto founder ... ensure nothing is compromised"). Produced by a council: two research agents (current app map from code; comparable products), three rival proposals (job-first, to-do inbox, guided minimal), two debate rounds against an HR-user critic, an engineering critic and a founder/sales critic, a judge, and a completeness critic. The judge's merged design is below, followed by the founder decisions that settle every gap the completeness critic raised. Where the two conflict, **Founder decisions win**.

## Why

The founder, who built it, said: "Unclear UI. It looks too confusing — the stages and pages. Overall lost, I don't get the idea of using it." And: "if we keep building on the current one it is closed for extension, not open for extension. Follow SOLID." The current app has nine sidebar sections organised around how we built it (Agents, Knowledge, Tools, Calls...) instead of what HR is doing, five different readiness definitions, overlapping status words, and 1,300–1,500-line page files where every new source, step or stage means editing a giant component.

## Scores

Weights: clarity 40%, extensibility 30%, demo speed 20%, migration safety 10%. Each is scored out of 10.

| Proposal | Clarity | Architecture | Demo speed | Migration | Weighted |
|---|---|---|---|---|---|
| A: Job-first pipeline | 8.0 | 8.0 | 8.5 | 8.5 | 8.15 |
| B: To-do inbox | 8.5 | 8.5 | 8.5 | 8.5 | 8.50 |
| C: Guided minimal | 8.0 | 8.0 | 8.5 | 7.5 | 8.05 |

All three converged on the same skeleton: job spine, tabs on sub-routes, one Add people menu, server-owned readiness, two registries, a sample job, and display-only vocabulary changes. The scores differ only at the margins.

- **B wins, narrowly.**
  - It has the simplest opening rule ("always People" plus a Next banner).
  - "Needs you" answers the founder's "I'm lost" directly.
  - Its server task providers are the clearest extension point.
  - It keeps Reports visible as buyer proof, and keeps the stored `On hold` state.
- **A** has the best idea of opening a Draft job on Set up. Its server-sorted job cards with a Next line are the most compact. But it hides `On hold` behind "Not decided", and with no strip it gives no cross-job answer to "what needs me today".
- **C** has the best note on slicing, which is to separate behaviour-changing readiness from label changes. But it mounts the calling-number flow in two places, so that flow becomes a mini-app that has to be kept in sync. It also delays the first visible release behind the readiness slice. Its three-way landing redirect is the hardest rule to explain.

## The mental model

"I add a job and people. HRVoice phones them. I review who fits and decide."

HR needs three nouns: **Job**, **Person**, **What needs me**.

- "Agent", "knowledge" and "tools" are not nouns in the UI. They become voice and language on a job, Company info in Settings, and nothing, respectively.
- "What needs me" is a section on the Jobs page, not a page.
- Every screen has one filled button, and the verbs are fixed: **Add people, Start calling, Review answers**.
- Fit ("Meets all / Needs a look / Doesn't meet") is information shown on the dashboard only. The AI never rejects and never tells a candidate anything. The decision is always HR's.

## Navigation and pages

**Primary nav (4 items):** Jobs (home), People, Reports, Settings. At 390px these are a bottom bar with 44px targets.

- **Get help** is a header button that opens a drawer.
- Platform admins reach `/admin` from the account menu, outside tenant Settings.

**Jobs `/jobs`**
- "Needs you" sits at the top, with at most 3 lines and then "Show all". Each line is one task from `GET /tasks`.
- Below it is one card per job: status word, counts ("12 not called · 5 answered · 2 undecided"), and a **Next:** line that deep-links to the right tab. The strip line and the card line use the same text, so they cannot disagree.
- Caught-up state: "All caught up. 12 people will be called tomorrow at 9:00." Out of hours: "Calls resume tomorrow at 9:00." Both are information, not errors.
- A live-calls strip appears only while calls are in progress.
- A new workspace gets a callable **Sample** job, deletable in one tap.

**Job page: three tabs on real sub-routes, with counts** ("Set up · People 17 · Review 5")
- **Opening rule (A's version of B's).** `/jobs/[id]` redirects on the server. A Draft job opens on Set up, and every other job opens on People. There is no cookie and no memory.
- A **Next banner** above the tabs has one button.
- **Set up** is one checklist with the first unfinished item marked Next. It has three headed groups:
  1. *The role:*
     - Role details. This is the only step a browser test needs.
     - Must-ask questions. The three standard ones are pre-ticked.
     - "What a good candidate has". This is a main step with the copy "This is how we sort people into Meets all, Needs a look and Doesn't meet", plus an explicit "Skip, I'll sort by hand".
  2. *The call:*
     - Voice and language, with "Hear a sample" per language.
     - Calling hours.
     - "If a candidate asks for a person".
  3. *Needed for real calls:*
     - Calling number.
     - Consent and Do-Not-Disturb.
     - The number is a status row linking to Settings > Calling and returning with `?back=job`. It is not an embedded KYC flow.
     - The row says "Your company's number, shared by all jobs" and "Phone approval takes time, so start early". It states no duration.
- **People** is the list with one **Add people** menu, where each option has a one-line description. Every row has a source tag and a language tag. A "Where they came from" line shows real counts and the last arrival.
- **Review** shows answered people sorted by fit.
  - It has lane filters, and a decision filter that defaults to "No decision yet".
  - The verdict sits on the row, and a tap shows the exact answer and transcript line.
  - With no requirements there is no chip, and one banner reads "Add what a good candidate has to sort these."
- **Person panel** is a `?p=ID` search param on the tab. It is a side sheet on desktop and full screen at 390px. It holds answers, summary, recording, transcript, call history with the raw state, source, and the actions Call now, Test in browser, Move forward and Not moving forward. The same component is also reachable at `/people/[id]`.

**People `/people`** is lookup only: search, a job filter and "Recently called". It uses the same row and panel. It has no Add button, because every candidate belongs to a job.

**Reports `/reports`** is the old Analytics. It also shows a workspace-wide "Where candidates come from" table with counts per source and last arrival.

**Settings (real routes):** `/settings/company` (includes Company info, the old Knowledge), `calling` (number, hours, consent, Do-Not-Disturb, hand-off numbers, workspace default voice), `team`, `sources` (connected systems), `activity`, `account`, and `advanced` (API keys, webhooks, usage; shown only with `integrations.read`). The menu is a typed array. There is no "Alerts" page until alerts exist.

**Route mapping (every current route)**

| Current | New home |
|---|---|
| `/` marketing | Unchanged |
| `/login`, `/reset-password`, `/invitations/accept` | Unchanged |
| `/c/[token]` (ask the candidate) | Unchanged. Link creation moves into the Add people menu. |
| `/status`, `/developers` (public API docs) | Unchanged |
| `/dashboard` | `/jobs` (Needs you section) |
| `/jobs` | `/jobs` (cards, Sample job) |
| `/jobs/[id]` | Redirects to `/jobs/[id]/setup` (Draft) or `/people` |
| `/jobs/[id]/candidates` | Redirects to `/people` or `/review`, honouring old `?stage` and lane params |
| `/candidates` | `/people` |
| `/calls` | Removed. Live strip on Jobs, history in the person panel. `?candidateId=` redirects to `/people/[id]`. |
| `/agents`, `/agents/new`, `/agents/[id]` | Removed from HR. Moves to `/admin/agents`, untouched. |
| `/knowledge` | `/settings/company` |
| `/tools` | Removed |
| `/design-system` | Removed from the production build |
| `/analytics` | `/reports` |
| `/settings?section=workspace` | `/settings/company` and `/settings/calling` |
| `/settings?section=team` | `/settings/team` |
| `/settings?section=access` | `/settings/team` (access levels sit with people) |
| `/settings?section=activity` | `/settings/activity` |
| `/settings?section=connected` | `/settings/sources` |
| `/settings?section=developers` | `/settings/advanced` |
| `/settings?section=account` | `/settings/account` |
| `/admin/costs`, `/admin/support` | Unchanged, reached from the account menu |

Redirects stay for at least one release. Each shows a one-time "Moved to ..." note.

## The one path from signup to first shortlist

1. Sign up with email and company name. The workspace is created automatically.
2. Jobs shows the Sample job with its questions, requirements and one sample candidate.
3. Tap **Hear it first** (a browser call). Test calls never need a calling number or KYC. A result lands in Review with answers, summary, playable recording and fit chip. This is the first value moment.
4. Tap **New job** and enter a title and description. A browser test can run now.
5. Open **Add people** and choose typed, CSV, resume, careers form, Zoho or the ask-the-candidate link.
6. Open the "Needed for real calls" row and set up the number. The row has been visible since step 2.
7. Tap **Start calling**, inside 9:00 to 20:00 IST.
8. Jobs says "4 answered on Backend Developer". Tap the line, tap a row for the evidence, then tap **Move forward**.

## Stages and words

Only display labels change, through `STATE_MAP`. Stored enums, the API, SDKs, Zapier and MCP do not change.

| Concept | Words | Notes |
|---|---|---|
| **Job** | Draft · Active · Paused · Closed | Archived is a filter on Closed. "Browser test calls only until your calling number is set up" is a **banner**, not a state. A job that loses its number stays Active with the banner. The server blocks real calls and never reverts the status. |
| **Call** | Not called yet · On the phone · Answered · Didn't connect · Will retry | "Didn't connect" carries a reason line: Voicemail, Rang out, or Number not reachable. Reachable reasons offer **Retry**. An unreachable number offers **Fix the number**. "Bad number" is rejected because it blames the candidate. "Calling" is reserved for the button "Start calling". |
| **Fit** (AI view, dashboard only) | Meets all · Needs a look · Doesn't meet | One name per lane, so the data contract has a single `label`. "Check" and "Not screened" are gone. No answers means no chip. |
| **Decision** (HR only) | No decision yet · On hold · Moved forward · Not moving forward | "No decision yet" is the absence of a chip. `On hold` stays until usage data exists. "To review" and "Shortlist" are never decision words. |
| **Test call** | "Browser test" | |

**Glossary rules**
- "Active", "Live", "Published" and "Open for calls" collapse to **Active**.
- "Review" is the name of a tab only.
- **Row rule** (a table in code, not prose):
  - People shows call phrase, source tag and language tag.
  - Review shows fit chip, language tag and source tag.
  - The decision shows as a filter and in the panel.
  - No row shows more than two chips plus one tag.

## First run and "what next"

- **One readiness model.** `GET /jobs/:id/readiness` returns ordered steps, blockers, `nextAction`, `canTestCall` and `canCallForReal`. One web hook, `useJobReadiness(jobId)`, feeds the Home cards, the Set up checklist and the Next banner. The five client definitions are deleted.
- **The same gate is enforced on the server** when starting calls and when setting a job Active. That covers Zapier, the API and MCP. The gate affects new activations only, and existing Active jobs keep working.
- **Server steps and tasks are open lists.** A new connector or check adds a provider file and does not edit a switch.
- **Task bands, fixed and documented, in order:**
  1. Live or failed calls.
  2. People waiting for a decision.
  3. A job with people that cannot call.
  4. An empty job.
  5. A missing setup step.
  6. Tips.
  - Ranking is by band, then recency, in one pure function with a table test.
  - Waiting answers always outrank the number nag.
  - The calling number appears once, as a job blocker line, never as a separate banner.
- **Empty states each name one verb.**
- **Voice precedence** is one server resolver: job override, then workspace default, then the linked agent's voice. The job's Voice card names the winner ("Kore, from the workspace default").
- **Out of first-run scope:** AI-drafted questions and requirements ("Suggest from description"). It is a later project, human-approved, with no protected attributes.

## Front-end architecture (SOLID)

**Principle:** consumers loop over data and never branch on ids. The client loop is open. A new fit lane or stored stage still needs server code, a migration and SDK exposure. The OCP test proves the client half only, and the server provider lists cover the other half.

**Two registries only. Everything else is plain typed data.**

```ts
// lib/registry.ts (~30 lines)
export interface Keyed { id: string; order?: number }
export function createRegistry<T extends Keyed>(): {
  register(item: T): void;
  all(ctx?: unknown): T[];          // sorted by order, ids unique (throws on duplicate)
}

// features/sources/contract.ts  (data only, unit-testable without React)
export interface SourceManifest extends Keyed {
  group: 'enter' | 'import' | 'connect' | 'share';
  label: string;                    // "Upload a spreadsheet"
  description: string;              // one line shown in the menu
  tag: string;                      // short tag shown on the row
  permission?: string;
  available(ctx: AppCtx): 'enabled' | 'needs-setup' | 'hidden';
}
// sibling lazy map, so manifests stay pure:
export const sourcePanels: Record<string, () => Promise<{ default: ComponentType<PanelProps> }>>;

// features/integrations/contract.ts (freeze only after a second connector)
export interface IntegrationManifest extends Keyed { name: string; sources?: string[]; }
```

**Typed data, not registries:**
- Lanes, decisions and stages extend `lib/use-case-definitions.ts`. The first task of slice 1 is to read that file in full.
  - They replace `CONFIRM_PHRASE`, `NOBODY`, `callStateKey`, `jobFunnel`, `homeQueueOf`, `FIT_LANES`, `LANE_LABEL`, `OVERALL` and the bulk buttons.
  - The parallel `Record<CandidateStage, …>` tables are deleted.

```ts
export interface LaneDef { id: string; label: string; tone: Tone; order: number } // one label
export interface DecisionDef { id: CandidateStage; label: string; isDecision: boolean; confirmAt?: number }
```

- Setup steps are `{ id, title, Panel }`. `isDone` and ordering come from the server.
- Nav is an array of four. Settings are file routes. Sheet tabs and the row-dimension table are arrays.

**Server contracts (NestJS)**

```ts
interface ReadinessStep { id: string; order: number; blocks: 'test' | 'phone' | null; check(job: Job): Promise<StepResult> }
interface TaskProvider  { id: string; band: number; collect(ws: WorkspaceId): Promise<Task[]> }
```

Providers are collected through Nest multi-providers. `GET /jobs/:id/readiness` and `GET /tasks` aggregate them.

**Layers**
- Pages are thin server shells. They prefetch with TanStack Query and pass a `HydrationBoundary`. Panels load through `next/dynamic`. Filters live in URL params. There is no cookie dependence.
- `lib/api.ts` (1471 lines) splits by domain behind a barrel.
- One query-key factory replaces `touchElsewhere`.
- `useTelephony()` replaces the six copies.
- The only fakeable boundaries are telephony and readiness. There is no injected client context.

**Folder layout**
```
apps/web/
  app/(shell)/jobs/[id]/{setup,people,review}/page.tsx   # thin
  app/(shell)/{people,reports}/ ; app/(shell)/settings/{company,calling,team,sources,activity,account,advanced}/
  entities/candidate/    # Row, Panel, tags, Candidate type (shared; people and review never import each other)
  features/
    sources/ (registry.ts, manifests/<one per source>/, panels/)
    integrations/zoho/   # moved from lib/ + settings
    readiness/ (useJobReadiness, ReadinessChecklist)
    tasks/ (useTasks, NeedsYou)
    people/ review/ job-setup/ (one file per step)
  lib/api/<domain>.ts + index.ts ; lib/query-keys.ts ; lib/vocabulary.ts (STATE_MAP + use-case defs)
```

**What gets split** (characterisation tests first)
- `jobs/[id]/candidates/page.tsx` (1451 lines) becomes `PeopleTab`, `ReviewTab`, `AddPeopleMenu`, `BulkDecideBar`, `usePeopleFilters` and `PersonPanel`.
- `jobs/[id]/page.tsx` (1295 lines) becomes a shell plus one file per setup step, moved from hand-rolled `useEffect` to TanStack Query.
- `add-candidates.tsx` becomes one file per source.
- Zoho moves to `features/integrations/zoho`.
- `agents/[id]` moves to `/admin/agents`.
- `EngineCard` moves out of `app/admin/costs-api`.
- `hiring-people.ts` is retired once `GET /tasks` and `GET /jobs` exist.
- `CandidateDetailSheet` loses its hard-coded tab union.

**SOLID checks**
- **S:** each god file becomes a data hook, a view model and presentational parts.
- **O:** one test registers a fake source and a fake lane, and asserts the menu, row tag and filter render them with no consumer edited.
- **L:** a contract test over every registry checks unique ids and that every source resolves a panel.
- **I:** small manifests, with permission and availability optional.
- **D:** components depend on hooks (`useJobReadiness`, `useTelephony`, `useTasks`), never on fetch details.

**Boundary lint:** an ESLint boundary rule starts as a warning with an allowlist of existing paths and is an error for new folders only. It ratchets as files move. **Targets:** adding a source touches its own folder plus one barrel line, and no new file exceeds 400 lines.

## Migration slices

Each slice ships on a working app. There are no feature flags, since the route slices are redirects over a working app.

0. **Characterisation tests and baselines.** Pin the board's fit sort, stage filters, bulk-confirm threshold (24 or more people), the gates and `STATE_MAP`. Capture the baseline measures in the same slice.
1. **Vocabulary pass.** Labels only, through `STATE_MAP`. No behaviour change. Add the lanes and decisions data table.
2. **First visible release (C's sequencing note, applied).**
   - Nav to four items, Settings routes, and job sub-routes with counts and the Next banner.
   - The stateless opening rule, redirects, and "Moved to ..." notes.
   - Readiness uses a single client `useJobReadiness` that wraps the existing pure `jobReadiness` logic. No server change yet.
   - Job cards show a Next line from existing data.
3. **Server readiness.** `GET /jobs/:id/readiness` with the step-provider list, enforced on start-calling and set-Active. `useJobReadiness` swaps to it behind the same signature, and the other client definitions are deleted. `useTelephony` lands here.
4. **Needs you.** `GET /tasks` with task providers and the rank table test. `GET /jobs` returns the urgency sort. `hiring-people.ts` and its browser N+1 are retired.
5. **Sample job and browser-test-first.** Test calls never need a number. The Sample tag and one-tap delete ship with it.
6. **Sources registry.** Add people menu, source and language tags, both "Where candidates come from" views, and ask-the-candidate link creation. **Check first** that every candidate already carries an origin field. If it does not, this slice adds a column and a backfill of "unknown".
7. **Lanes and decisions as data.** Delete the parallel tables and add the OCP test. Document the cost of a new stored stage (migration, SDK, docs).
8. **Person panel, `/people/[id]`, and removal of `/calls`.**
9. **Voice on the job.** Job voice fields, the resolver, a default-agent backfill (dry run on copies of real data, named rollback), hand-off numbers move to Settings > Calling, `/admin/agents`, and Zoho into the integrations registry. This is the riskiest data change, so it goes late.
10. **Split the remaining god files, ratchet the lint, run contract tests.** "Suggest from description" is optional after this.

## Open questions only the founder can answer

1. **Who pays for the Sample job's browser-call minutes, and what is the per-workspace cap?** The design assumes the Sample is callable without a number. I state no figure.
2. **Do we keep the non-hiring "agent" capability?** Default: move it to `/admin/agents` untouched and cut it later if unused. This is a product decision, not a UI change.
3. **Does anyone use `On hold` today?** A stored-value usage query decides whether we ship a real hold or fold it into "No decision yet". Until then the label stays.
4. **Where should Meets-all auto-advance live?** Today it sits under Zoho's `autoCall`. I recommend moving it to an optional Set up item on each job, off by default, labelled "Move Meets-all people forward automatically". It is still HR's opt-in, and the AI still never rejects. This needs your approval because it changes who controls a decision.
5. **What is the real calling-number approval time?** The UI says "start early" and promises no duration. If you know the typical range, we can state it honestly in the checklist.

## What we're deliberately not doing

- **No drag-and-drop kanban.** One automated stage plus a human decision does not need it.
- **No separate Candidates and Calls top-level lists.** A call is a fact about a person and lives in the person panel.
- **No `/today` page.** It duplicated Jobs.
- **No remembered last tab, cookie or flash.** The opening rule is stateless.
- **No "Alerts" page or Slack/Teams/WhatsApp UI until alerts exist.**
- **No LLM-drafted requirements on the first-run path.** Chips come from fixed templates and are editable.
- **No stored-enum changes in this redesign.** The API, SDK, Zapier and MCP are untouched.
- **No numeric score as a decision, and no fit data outside the dashboard.**
- **No client-side or invented metrics.** We capture baselines in slice 0 and set no targets.
- **No integration contract freeze before a second connector.** Zoho is the only one today.
- **No third or fourth registry** without a second implementation.
- **No embedded KYC flow on the job.** The calling number is a status row.
- **No per-workspace feature-flag matrix.**
- **No competitor figures reused as ours.** The market research was pattern-level from public pages and reviews, with no logged-in UI seen. So the Needs you inbox is tested with the 5-person 390px task ("add three people and tell me who to call back") and not assumed.

**Measures** (baselines first, no invented targets):
- Time from signup to the first completed browser test, and to the first real call.
- Share of new workspaces with a first decision within 7 days.
- Share of jobs with requirements saved.
- Clicks from login to the first opened person in Review.
- "Where do I ..." support chats per new workspace.
- Files touched to add a source, and the largest page file length.
## Founder decisions (settle the completeness critic's gaps and the open questions)

1. **Calling number gates real calls, never job status.** A job can be Active without a calling number; it then shows the banner "Browser test calls only until your calling number is set up". The server already refuses real calls without a number; it keeps doing that for every caller (dashboard, /v1, Zapier, MCP) with the existing error code, documented. Setting a job Active is **not** gated. No grace-period machinery is needed because nothing that works today starts failing.
2. **Voice step appears only when it works.** Until slice 9, Set up's "The call" group shows Call language and calling hours only; "Voice" and "Hear a sample" ship with slice 9.
3. **Calling-number row has every state:** Not set up · Waiting for approval · Approved · Needs attention (rejected/expired) — each with one action. Consent is a fixed checkbox on each source; DND shows "Checked before every call" only once the lookup is real (today the copy says nothing about DND).
4. **Routes:** `/jobs/[id]/candidates` redirects to `/jobs/[id]/people` (or `/review` when old params ask for answered/fit lanes). The command menu, the mobile "More" sheet and Get help are mapped: command menu items become "New job", "Add people", "Invite a teammate", "Go to Settings"; there is no More sheet (four items fit the bottom bar); Get help stays in the header and the tenant's own tickets list lives in the Get help drawer.
5. **Every server provider receives a viewer context** (`{ organizationId, userId, permissions }`) and must filter by it. Needs you never shows names or results to someone without `candidates.read`.
6. **Sample job:** created only for **new** workspaces, flagged `is_sample`, excluded from Reports, source counts, Needs you and usage. Browser test calls on it are capped at **3 per workspace per day** (Gemini quota is shared and tight on the trial). One tap deletes it.
7. **One person per phone per job.** The existing unique phone-per-job rule is the de-duplication rule; a second arrival by another source updates the source tag history, never creates a second row. Source counts count people, not arrivals.
8. **Knowledge:** slice 2 only moves the page to `/settings/company` and keeps documents attached as today. A real "Company info" model is a later project with its own migration; not in this redesign.
9. **Candidate-facing flows** (`/c/[token]`, careers form) keep their current consent wording, language and expiry; this redesign only moves the HR entry points into Add people.
10. **Words:** Paused = "no new calls are placed; nothing is lost; resume any time". Archived = a "Show archived" filter on Closed. "No decision yet" is real text (screen readers and filters), not the absence of a chip. "Not moving forward" stays: it is HR's decision word, never shown to candidates, never set by the AI.
11. **Accessibility at 390 px:** job tabs are links with `aria-current="page"`, counts shown as a small badge that never truncates the label; the Next banner and bottom bar never cover a focused field (scroll-padding); fit chips always carry text plus an icon, never colour alone; the full-screen person panel traps focus and returns it to the row; the live strip respects reduced motion.
12. **Honest SOLID targets:** adding a candidate source touches its manifest folder, one barrel line and — only if it is a brand-new origin value — the server enum + migration + SDK docs. That is the documented cost. Server prefetch forwards the session cookie to the API through the existing `/backend` proxy path; if that cannot be made to work in slice 2, pages prefetch on the client and the "thin server shell" goal moves to slice 10. No claim ships that a test doesn't prove.
13. **Call outcome reasons map to real stored states only:** `no_answer` → "Didn't connect · Rang out", `voicemail` → "Didn't connect · Voicemail", `line_not_connected` → "Didn't connect · Number not reachable" (offers Fix the number). No other reasons are invented.
14. **Open questions answered:** (1) sample browser minutes are ours, capped as above; (2) non-hiring "agents" move to `/admin/agents` untouched; (3) `On hold` stays; (4) Meets-all auto-advance stays where the founder approved it (Settings, off by default, HR's opt-in) — no move in this redesign; (5) the calling-number row says "start early" and states no duration.

## Build order for the team

Slices 0 → 2 first (characterisation tests, vocabulary pass, first visible release with the four-item nav, job sub-routes, Settings routes, redirects and the client readiness hook). That is the biggest clarity win and changes no stored data. Each later slice ships on its own after review, QA at 1440 and 390 px, and the full test suites.
