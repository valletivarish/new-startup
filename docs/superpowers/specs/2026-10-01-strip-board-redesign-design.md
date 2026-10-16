# Strip Board redesign — design spec

> **SUPERSEDED for all visual decisions (2026-10-01, founder choice: conventional SaaS look, references Intercom / Stripe / Attio, deep blue accent).** The master spec is now `2026-10-01-saas-redesign-design.md`. Non-visual requirements below (infrastructure §4, page requirements §7, team §8, use cases §9, accessibility §10, verification §11) still apply as referenced from the new spec.

**Date:** 2026-10-01 · **Branch:** `feat/strip-board-redesign` · **Owner:** product founder (delegated design authority to Claude)
**Goal:** ship one cohesive product across the website and the app, in the Strip Board world, with every "fix first" gap from the audit closed and the main journeys verified end to end.

Read with: `apps/web/PRODUCT.md` (product truth), `docs/superpowers/specs/2026-10-01-ux-audit.md` (findings with IDs), `apps/api-java/MIGRATION_STATUS.md` (backend contract, when present).

---

## 0. Decisions already made — do not re-open

| Topic | Decision |
|---|---|
| Positioning | A voice-agent platform. Hiring is the first live use case. Other use cases appear only as clearly labelled "Not live yet". |
| Naming | Overall product name undecided → wordmark reads **Voice platform** from `lib/brand.ts` (one constant). Modules are `<Domain>Voice`: **HRVoice** (hiring, live), **CustomerVoice** (support), **SalesVoice** (lead qualification), **BookingVoice** (appointments, reminders). |
| Pricing | Usage-based per completed screening call, no seat fees, start with a pilot. No numbers anywhere. |
| Visual world | **Strip Board** (air-traffic-control flight progress strips). Light theme only. |
| Build path | Code-led, with section reference comps under `apps/web/.impeccable/mocks/` as art direction (not pixel law). |
| Motion stack | CSS for hover/press/focus · `motion/react` for app enter/exit/layout · GSAP + ScrollTrigger on the website only · **no Lenis** · **no Three.js/WebGL**. |
| Libraries removed | `three`, `img-fx`, `metal-fx`, `liquid-gooey`, `voice-glow`, `thinking-orbs`, `bot-avatars`, `border-beam`, `lenis`, `next-themes` (light only), unused Radix/dnd-kit/zustand/rhf/zod/recharts once no import remains. |
| Icons | Lucide (already installed), stroke 1.75. |
| Truth rules | Nothing fake: missing data is shown as missing, never 0 or "None". No vendor/provider names, env vars, API paths in UI. The product never recommends hire or reject. Plain language. Samples on the website are labelled as samples. |
| Languages | Public copy claims English only until the founder confirms more. |
| Landing destination | After sign-in, register, or accepting an invite, everyone lands on **Home** (`/dashboard`), or on `?next=` when present. |

---

## 1. The world in one paragraph

Every call is a **strip**: a slip of paper in a coloured holder, printed with who is being called, for which piece of work, and what has happened so far. Strips sit in **bays** on a **board**; dark **rails** carry the bay labels. A strip moves bay to bay (Not called yet → Calling → On call → Ready for review → a decision), is **stamped** at each handoff, and collects **evidence** (transcript, answers, recording) that a person reads before deciding. The airfield's own sign language supplies the action colour: **black on yellow means "go this way"** (primary actions); **yellow on black means "you are here"** (current location in navigation, counts on rails).

What this refuses: the voice-AI category default (white page, blue accent, waveform orb, three feature cards), glow, gradients, glass, drop shadows, tracked-out caps labels, mono "data" labels, middle-dot meta strings, arrows appended to links.

---

## 2. Visual system

### 2.1 Colour tokens (CSS custom properties in `app/globals.css` `:root`)

| Token | Hex | Use |
|---|---|---|
| `--board` | `#EEF0EC` | Page ground (app + site). |
| `--board-deep` | `#E4E6E3` | Pressed/disabled fills, decided tint, hover on board. |
| `--paper` | `#FDFDFB` | Strips, inputs, dialogs, sheets. |
| `--ink` | `#15191C` | Primary text, control borders that must read strongly, focus outline on light. |
| `--ink-2` | `#3B4349` | Secondary text. |
| `--ink-3` | `#5A636A` | Tertiary text, meta, placeholder (5.3:1 on board). |
| `--line` | `#D5D9D5` | Decorative separators only (never the only boundary of a control). |
| `--line-strong` | `#7D868C` | Input/checkbox/segmented borders (3.6:1 on paper). |
| `--rail` | `#262C30` | Bay headers, nav rail, bottom nav, final CTA band. |
| `--rail-2` | `#313840` | Hover/active fill on rail. |
| `--rail-text` | `#E9ECEA` | Text on rail. |
| `--rail-muted` | `#AEB6BB` | Secondary text on rail (6.9:1). |
| `--signal` | `#F2C230` | Primary action fill; counts/current item on rail. |
| `--signal-hover` | `#E3B11C` | |
| `--signal-press` | `#D4A30F` | |
| `--danger-ink` | `#9C3A25` | Error text. |
| `--success-ink` | `#1E5A37` | Success text. |
| `--scrim` | `rgb(21 25 28 / 0.48)` | Behind dialogs/sheets. |

State colours (tint = holder fill, edge = holder edge/border, ink = text on tint). Every pair verified ≥ 4.5:1 (text) and ≥ 3:1 (edge on paper).

| State family | Tint | Edge | Ink |
|---|---|---|---|
| `queued` | `#DCE7F2` | `#2F6FA6` | `#1F4E79` |
| `live` | `#D6ECDD` | `#2D7A4B` | `#1E5A37` |
| `review` | `#F6E7B0` | `#8A6200` | `#5E4300` |
| `decided` | `#E4E6E3` | `#5A636A` | `#3B4349` |
| `failed` | `#F5D0C5` | `#B4442C` | `#8E3020` |

Tailwind (`tailwind.config.js`, v3) exposes these as `bg-board`, `text-ink-2`, `border-line-strong`, `bg-signal`, `bg-state-review-tint`, `border-state-failed-edge`, `text-state-live-ink` etc. Keep shadcn alias names mapped onto the new tokens during the transition (`background→board`, `foreground→ink`, `primary→signal`, `primary-foreground→ink`, `muted→board-deep`, `muted-foreground→ink-3`, `border→line`, `input→line-strong`, `ring→ink`, `destructive→state-failed-edge`). No hex values in components; no inline `color-mix()`; no `style={{}}` except genuinely dynamic geometry.

### 2.2 Type

One family: **Archivo** variable via `next/font/google` with `axes: ['wdth']` (wdth 62–125, wght 100–900). Fallback `ui-sans-serif, system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`. Remove Public Sans and Outfit.

**Width carries role** (verify in the built CSS whether `font-stretch` maps to the axis; if not, drive `font-variation-settings: "wdth" var(--wdth)` through an inherited `--wdth` custom property on `*`):

| Role | Width | Weight | Notes |
|---|---|---|---|
| Announce (website H1/H2, app page titles) | 112–118 | 680–760 | sentence case, tracking −0.02em, `text-wrap: balance` |
| Read (body, forms, dialogs) | 100 | 400 / 600 | |
| Strip (names on strips, tags, table cells, bay labels, counts) | 82 | 500–650 | `font-variant-numeric: tabular-nums` |

Scale (rem at 16px): app `12` (legal/caption only) · `13` meta · `14` labels/secondary · `15` body (app default) · `17` lead/strip title · `20` section heading · `24` sub-page title · `30` page title (announce width). Website display: `display-1 clamp(2.6rem, 1.4rem + 4.2vw, 4.75rem)` leading 1.02 · `display-2 clamp(1.9rem, 1.2rem + 2.2vw, 2.9rem)` leading 1.06 · `lead 1.1875rem` leading 1.5, max 60ch. Body leading 1.5, line length ≤ 75ch.

Rules: sentence case everywhere; **no all-caps labels, no eyebrows** (website may use at most two, and only if they name a real category); numbers in strips/tables/timers are tabular; durations `m:ss`; dates `en-IN` (`1 Oct, 14:05`); **no em dashes or en dashes in UI copy** (use a full stop, comma, colon or hyphen); no middle-dot-joined meta strings (use cells or line breaks); no `→` appended to link text.

### 2.3 Space and layout

4px base: `4 8 12 16 20 24 32 40 48 64 80 96 128`. Website container `max-w-[80rem]`, side padding 20 / 32 / 48px (mobile / tablet / desktop), 12-column grid, 24px gutters. App: content max 72rem for forms and settings; boards and lists may use full width. Breakpoints: Tailwind defaults (sm 640, md 768, lg 1024, xl 1280). Every multi-column layout declares its < 768px collapse explicitly. `min-h-[100dvh]`, never `h-screen`.

### 2.4 Shape and depth

Radius by role, nothing else: strips, state tags, tickets **3px** · buttons, inputs, segmented controls **6px** · dialogs, sheets, menus **8px** · bays, rails, nav **0**. No pills. **No box-shadows anywhere.** Depth comes from overlap (strips sit on the board), from rails, and for overlays from `--scrim` plus a 1.5px `--ink` border. Sticky headers: `--board` background with a 1px `--line` bottom border.

### 2.5 Motion grammar

Tokens: `--dur-instant 80ms`, `--dur-fast 140ms`, `--dur-base 200ms`, `--dur-slow 320ms`, `--dur-strip 420ms`; `--ease-standard cubic-bezier(0.2,0,0,1)`, `--ease-exit cubic-bezier(0.4,0,1,1)`, `--ease-stamp cubic-bezier(0.34,1.3,0.64,1)` (stamps only).

The world's native motions, used only where they mean something:
1. **Slide** — a strip moves into its new bay (transform only, `--dur-strip`). Motion `layout`/`layoutId` in the app; GSAP on the website.
2. **Stamp** — a state tag lands when state really changes (scale 1.06→1 + opacity, `--dur-base`, `--ease-stamp`).
3. **Write-in** — transcript lines appear in order (opacity + 6px rise, 60ms stagger).
4. **Press** — `:active` translateY(1px).
5. **Live bars** — three bars in the live state tag, animated only while a call is genuinely live and motion is allowed; static otherwise.

Everything collapses to instant under `prefers-reduced-motion`. Any content that moves automatically for more than 5s has a visible **Pause** control (WCAG 2.2.2). Animate transform/opacity only. No scroll listeners (use ScrollTrigger / IntersectionObserver / Motion `useScroll`).

### 2.6 State system (one map: `lib/status-labels.ts` + `components/ui/state-tag.tsx`)

Every state renders as **tint + 1px edge border + Lucide glyph (14px) + word**. Never colour alone.

| Domain | Value(s) | Word | Family | Glyph |
|---|---|---|---|---|
| Candidate stage | `new` | Not called yet | queued | `Clock` |
| | `screening` | On hold | decided | `PauseCircle` |
| | `reviewed` | Moved forward | decided | `CheckCircle2` |
| | `declined` (needs backend) | Not moving forward | decided | `XCircle` |
| Call | not called | Not called yet | queued | `Clock` |
| | dialing / ringing | Calling | live | `PhoneOutgoing` |
| | active | On call | live | live bars |
| | transferring | Handing to your team | live | `PhoneForwarded` |
| | completed, results pending | Writing up the call | live | `FileClock` |
| | completed, results ready, no decision | Ready for review | review | `FileCheck2` |
| | no answer / busy | No answer / Line busy | failed | `PhoneMissed` |
| | voicemail | Reached voicemail | failed | `Voicemail` |
| | failed | Call didn't connect | failed | `TriangleAlert` |
| Job | draft / open / closed | Draft / Open for calls / Closed | decided / live / decided | `PenLine` / `Radio` / `Archive` |
| Agent | draft / published / paused / archived | Draft / Live / Paused / Archived | decided / live / review / decided | `PenLine` / `Radio` / `PauseCircle` / `Archive` |
| Invite | pending / accepted / expired / revoked | Waiting / Joined / Expired / Revoked | queued / live / review / decided | `Mail` / `UserCheck` / `CalendarX` / `Ban` |

`labelStatus()` must never return "None" or a raw enum; unknown values render "Unknown" (family `decided`) and log once in dev.

### 2.7 Vocabulary (one name per thing; use-case labels come from §9)

Workspace · Team · Member · Role · Permission · Invite link · **Agent** (default name "Hiring agent"; nav "Agents") · **Job** · **Candidate** (replaces "People" in the hiring module) · **Call** (phone conversation) · **Test call** (in-browser call with the agent, for the recruiter; never "demo", "practice", "browser screen", "session") · **Phone call** · Transcript · Recording · Summary · **Questions** (must-ask) · **Answers** · Knowledge (documents the agent may use).

Action labels (button text = toast text in past tense): Start a pilot · Sign in · Sign out · Create job · Add candidates · Import CSV · Start test call · Call now (always confirms) · Call again · End call (confirms) · Move forward · Put on hold · Not moving forward · Undo · Save changes · Discard changes · Publish agent · Pause agent · Invite people · Copy invite link · Get a new link · Revoke invite · Change role · Remove from workspace · Send password reset email · Retry.

Errors say what happened and what to do, in the interface's voice, never apologise, never vague: "Couldn't load candidates. Check your connection, then retry." + **Retry**. Server errors add the support ID: "Something failed on our side (ref 4F2A91). Retry in a minute."

---

## 3. Component inventory (WF-2 builds; everyone else imports)

All in `components/ui/` unless noted. Each has rest / hover / focus-visible / active / disabled / loading (where relevant) states and a keyboard path.

- **Button** — variants `primary` (signal fill, ink text, 1.5px ink border), `secondary` (paper, 1.5px ink border), `quiet` (no border, hover board-deep), `danger` (paper, 1.5px failed-edge border, danger-ink text), `on-rail` (primary stays signal; secondary = rail-2 fill, rail-text). Sizes `md` 44px, `sm` 36px desktop with ≥44px hit area on touch. Loading: label stays, three-bar progress glyph replaces the leading icon, `aria-busy`, click ignored. Focus: 2px ink outline, 2px offset (signal outline on rail).
- **IconButton** — 44px hit area, required `label` prop → `aria-label` + Radix tooltip.
- **Field** — label above (14px/600), optional hint below the label (13px ink-3, linked via `aria-describedby`, outside `<label>`), control, error below (glyph + danger-ink text, `aria-invalid`, `role="alert"` only on submit). Controls: `Input`, `Textarea`, `Select` (native, styled), `PasswordInput` (show/hide), `PhoneField` (existing logic, restyled; +91 default).
- **Checkbox** — real `<input type="checkbox">`, 20px box, 44px hit area, ink check.
- **Segmented** — for filters (radio-group semantics, arrow keys). **Tabs** — Radix Tabs for panels (proper tabpanels). Never `role=tab` on filters.
- **Dialog** — Radix; exports `DialogTitle`/`DialogDescription` (required); errors render inside the dialog; scrim + 1.5px ink border + 8px radius; close button 44px.
- **Sheet** — Radix Dialog as right sheet (560px desktop, full-screen mobile); title required; focus returns to trigger; `onOpenChange` never blocked except while a request it owns is in flight (then the close control explains why).
- **Tooltip**, **Kbd**.
- **Notice** — inline banner with 4px left holder edge in the state colour + glyph + title + body + optional action. `kind: 'info' | 'success' | 'warning' | 'error'` is **required** (no default); `error` → `role="alert"`, others `role="status"`.
- **ErrorState** — section/page error: title, plain cause, next step, **Retry** button, support ref when present, offline variant.
- **EmptyState** — one demonstrative object (a ghost strip outline) + one sentence + one action.
- **Skeleton** — strip- and bay-shaped placeholders that mirror the final geometry; `aria-busy` on the container; "Still loading…" message after 8s.
- **StateTag** — §2.6.
- **Strip** — the signature row: CSS grid `[6px holder edge][primary cell][meta cells…][state tag][actions]`; paper, 1px line border, 3px radius. Primary cell = name (strip width, 15–17px/600) + secondary line (13px ink-3). Whole-row navigation via a stretched link on the name (inner buttons sit above it). Selected: holder edge 10px + 2px ink border. Hover: holder edge 8px, border ink-3 (no transforms). Focus-visible on the link: ink outline around the strip. Optional leading Checkbox cell. Mobile: cells reflow to two lines; tag stays visible.
- **Bay** — header rail (`--rail`, rail-text label at strip width 600, signal tabular count) + board body + strip list; optional collapse; "Show N more" footer when paged. **BayBoard** lays bays out as columns ≥ lg, stacked sections below.
- **PageHeader** (title at announce width + optional description + actions), **Breadcrumb**, **JobHeader** (`components/shared/job-header.tsx`: breadcrumb Jobs / title, job StateTag, readiness line, link-tabs Candidates | Setup).
- **ConfirmDialog** + **ConfirmInline** — for destructive or real-world actions ("Call Priya now? This places a real phone call to +91 98•••• 4410." [Call now] [Cancel]).
- **CopyField** — read-only link + Copy button with "Copied" announcement.
- **OfflineBanner** — rail band at the top of the shell: "You're offline. Changes won't save until you reconnect." Auto-hides on reconnect and triggers query refetch.
- **Toaster** — Sonner restyled: paper, 1.5px ink border, 3px radius, holder edge per kind, Undo action support.
- Domain components in `components/shared/`: **Transcript** (single renderer: list of turns with speaker label, time, text; optional "Play from here" button per turn when a recording exists; highlight current line; scroll respects reduced motion), **OriginTicket** (timestamp chip that seeks the recording and highlights the turn), **AnswersList** (question, answer or "Not answered" in neutral style, origin ticket, coverage "3 of 5 questions answered" computed over the job's own questions only; extras under "Also mentioned"), **RecordingPlayer** (native `<audio>` controls + current-time sync), **LiveCallStrip** (the call monitor: strip with live state from real events, elapsed timer, End call with confirm, Retry when failed with mapped reason), **StripMark** (brand mark) + wordmark.

---

## 4. Shared infrastructure (`lib/`, WF-2)

- **API client** (`lib/api.ts`): one `request()` that (a) parses JSON safely (non-JSON 5xx → typed error, no throw from `JSON.parse`), (b) on 401 from any call except auth endpoints redirects to `/login?next=<current path+query>` and shows "Your session ended. Sign in to continue." once, (c) maps every error through `lib/errors.ts`. Remove the 14 copied 401 blocks as pages are rebuilt.
- **Errors** (`lib/errors.ts`): `toUserMessage(error, context)` → `{ title, detail, action: 'retry'|'sign_in'|'contact_admin'|'fix_input'|null, supportRef }`. Maps status codes and known API codes to plain sentences; strips vendor names, env-var-looking tokens (`/[A-Z][A-Z0-9_]{3,}=/`), URLs and paths; field errors returned as `{ field, message }`. Unit-tested.
- **Data**: TanStack Query for all reads (retry 2 with backoff for network/5xx, none for 4xx), mutations with optimistic updates where a rollback exists. One `useMe()` + `usePermissions()` (`can(key)`) used everywhere.
- **Offline**: `useOnline()` (navigator.onLine + events) drives OfflineBanner; queries pause while offline and refetch on reconnect.
- **Drafts**: long forms (job setup, agent form, CSV fixes) keep an unsaved draft in `sessionStorage` keyed by user+entity, restored after a forced re-login, and warn on navigation away with unsaved changes (route guard + `beforeunload`).
- **Use cases** (`lib/use-cases.ts`, §9). **Brand** (`lib/brand.ts`, replace the dead legacy object). **Format** (`lib/format.ts`: `formatWhen`, `formatDuration m:ss`, `formatPhoneMasked`, en-IN). **Uploads** (`lib/upload.ts`: client-side type + size validation before encoding; accepted `.pdf .docx .pptx .txt .md`, ≤ 10 MB; plain errors).
- **New client functions** (guarded: a 404/405 from a backend that lacks the route returns a typed `NotAvailableError` so the UI can fall back): `getJobCandidate(jobId, candidateId)`, stage `declined`, invite `preview`/`acceptNew`/`resend`, roles CRUD + permission catalogue, member remove / password-reset trigger, hiring summary, call `failureReason`. Shapes: the backend agent records them in `apps/api-java/MIGRATION_STATUS.md` ("Frontend contract additions"); until then use the shapes in §8.

---

## 5. Website (`/`) — Persuade mode

**Job of the page:** a founder or HR head understands within one viewport that this is an AI agent that makes real business phone calls (hiring live today), sees it working, and starts a pilot.

**Theme lock:** light board; dark rails are structural (bay headers, final CTA band), not section inversions. **One accent:** signal yellow, fills only. **One CTA label for signup:** "Start a pilot" (nav, hero, pricing, final band). "Sign in" for existing users.

Sections, in order, each answering one question. Layout families never repeat.

| # | id | Question it answers | Layout family | Content |
|---|---|---|---|---|
| Nav | — | Where am I, how do I start? | single line, 64px | StripMark + "Voice platform"; links Use cases · How it works · Pricing · FAQ; right: Sign in (quiet), Start a pilot (primary sm). Sticky with board background after scroll. Mobile: brand, Start a pilot, menu (Sheet). |
| 1 Hero | `top` | What is it, for whom, what next? | top-left lead + full-width strip board band | H1 (announce, ≤ 2 lines desktop): **"Voice agents that make your business calls and show their work."** Sub (≤ 20 words): **"Give it a job. It phones every candidate, asks your questions, and returns the transcript for you to decide."** CTAs: Start a pilot · See a sample call (secondary, to `#sample-call`). Below, spanning the container: a live **BayBoard** with three bays — Calling · On call · Ready for review — where sample strips slide and get stamped on a ~4s loop (GSAP timeline, starts after load, pauses when off-screen, Pause control, static under reduced motion). The On call strip shows two transcript lines writing in and question ticks. Caption under the board: "Sample calls. Names and answers are illustrative." Must fit a 1366×768 viewport with headline, sub, CTAs and the top of the board visible. |
| 2 Sample call | `sample-call` | What does a call actually look like? | one opened strip, document-like, full width | H2 "A sample call, start to finish." A single large strip opened like a printed record: left (7 cols) the transcript (Transcript component) with Play/Pause + scrubber driving a scripted timeline; right (5 cols) AnswersList with origin tickets that jump the transcript, coverage line, 2-sentence summary. Sample: hiring call for "Java backend developer, Bengaluru" (Spring Boot experience, notice period, current location/relocation, expected CTC, availability for a technical round). Label "Sample call. Illustrative, not a real candidate." Reduced motion: full transcript shown, controls still work. |
| 3 How it works | `how-it-works` | How does it work? Can I trust it? | pinned scroll sequence (desktop) / stacked stations (mobile) | H2 "Every call passes six stations." A vertical track of stations; a single strip on the right gets one stamp per station as the visitor scrolls (ScrollTrigger pin + scrub, `start: "top top"`). Stations (real sequence, so order is shown by the track, not "01/02" labels): **Line** "Dials from an Indian number and recognises voicemail." stamp "Answered at 0:04" · **Listen** "Turns the person's speech into text as they talk." stamp "Heard: thirty days" · **Think** "Picks the next question from your list and their last answer." stamp "Next: expected salary" · **Recall** "Answers questions about the role from the job description you gave it." stamp "From your job description: hybrid, three days in office" · **Route** "Follows your rules: hands the call to a person on your team when asked." stamp "No handoff needed" · **Act** "Writes the transcript, answers and summary onto the candidate." stamp "Ready for review". Mobile and reduced motion: stations as a stacked list, each with its stamp visible. |
| 4 Use cases | `use-cases` | Is it for my kind of call? | one wide bay of tall strips | H2 "One engine. A module for each kind of call." Bay "Modules": strip **HRVoice** (Live tag) "Screens job candidates by phone against your job description. You get the transcript and the answers." · **CustomerVoice** (Not live yet) "Answers support calls from your help articles." · **SalesVoice** (Not live yet) "Qualifies new leads and books the next step." · **BookingVoice** (Not live yet) "Confirms, reschedules and reminds people about appointments." Caption: "Modules marked not live yet are on our roadmap." |
| 5 The desk | `desk` | What will my team actually use? | real product composition in a framed board (not a screenshot, not div mockery) | H2 "Where your team reads the calls." Real app components (Bay, Strip, StateTag, AnswersList, Transcript) rendered with sample data: a job's board on the left (bays with 6–8 strips), the open candidate's review panel on the right with the decision bar (Move forward / Put on hold / Not moving forward) — interactive (clicking a strip swaps the panel; decisions move the strip, Undo restores). Caption "Sample data." |
| 6 Control | `control` | Who decides? Who sees what? | asymmetric grid: one large tile + three small | H2 "The agent reports. Your team decides." Large tile: the decision bar in context. Small tiles: "It never recommends hire or reject. Every answer links to the second it was said." · "Roles decide who can hear recordings and read transcripts." · "Invite your team with a link and choose what each role can do." (+ "Any call can be handed to a person on your team." folded into the large tile). |
| 7 Pricing | `pricing` | What will it cost? | single centred "fare card" strip, narrow | H2 "Pay for completed calls, not seats." Body: "Pricing is per completed screening call, with no per-seat fees. Start with a pilot on one open role and see the results before you commit." CTA Start a pilot. No numbers. |
| 8 FAQ | `faq` | What about…? | two-column accordion (`details/summary`, single column on mobile) | Does the agent decide who gets hired? · Do I need a phone line to start? · What does the candidate need to do? · Can a call be handed to a person? · Who can see recordings and transcripts? · What happens if a candidate doesn't pick up? (Answers in §5.1.) |
| 9 Close | — | Ready? | full-width rail band | "Put an agent on your next open role." + Start a pilot (signal on rail = "you are here, go"). |
| Footer | — | — | board, two rows | StripMark + "Voice platform" + one line "Voice agents for business calls, made in India."; links Use cases, How it works, Pricing, FAQ, Sign in; © year. **No app routes.** |

### 5.1 FAQ answers (final copy)
- *Does the agent decide who gets hired?* No. It asks your questions and reports the answers, with the transcript and the recording. A person on your team moves each candidate forward or not.
- *Do I need a phone line to start?* No. Start with a test call in your browser. Phone calls begin once your workspace's line is connected.
- *What does the candidate need to do?* Nothing. They answer an ordinary phone call. They never need an account or an app.
- *Can a call be handed to a person?* Yes. Add your team's numbers to the agent and it can transfer the call when the candidate asks for a person.
- *Who can see recordings and transcripts?* Only the roles you allow. Workspace admins choose which roles can hear recordings and read transcripts.
- *What happens if a candidate doesn't pick up?* The call is marked "No answer" and you can call again from their record. Voicemail is recognised and marked, so you know the call didn't reach them.

### 5.2 Website engineering
- `app/page.tsx` stays a Server Component; interactive pieces are client leaves under `components/marketing/` (hero board, sample call player, stations sequence, desk demo). GSAP + ScrollTrigger registered once, used via `useGSAP` with scope and `gsap.matchMedia()` for reduced motion and breakpoints; all cleaned up on unmount. Lazy-load below-the-fold client leaves (`next/dynamic`, `ssr: true` with static markup first). Delete `app/landing.css`, `components/LandingPage.tsx`, `components/landing/*` once replaced.
- Metadata: title "Voice agents that make your business calls | Voice platform", description from the sub-headline, OG/Twitter tags (OG image on the replacement list), canonical, `app/icon.svg` (StripMark), `robots`/`sitemap` routes.
- Budgets: LCP < 2.5s, CLS < 0.1, INP < 200ms; landing JS for first viewport ≤ 120 KB gz excluding Next runtime; no image heavier than 200 KB; Lighthouse desktop perf ≥ 90, a11y ≥ 95.

---

## 6. App shell and IA

Routes are unchanged (`/dashboard`, `/jobs`, `/jobs/[id]`, `/jobs/[id]/candidates`, `/candidates`, `/calls`, `/agents`, `/agents/new`, `/agents/[id]`, `/knowledge`, `/tools`, `/analytics`, `/settings`, `/login`, `/reset-password`, `/invitations/accept`). Labels change.

- **Desktop ≥ 1024:** left **NavRail** 232px on `--rail`: StripMark + workspace name (real org name; skeleton while loading; never the user's name); primary group Home · Jobs · Candidates · Calls; secondary group Agents · Knowledge · Analytics · Settings. Current item = yellow text + 3px yellow left bar on `--rail-2` (the airfield location sign). Others `--rail-muted`, hover `--rail-text` on `--rail-2`. Bottom: **UserMenu** (initials tag + name) → name/email, Switch workspace (only if > 1), Your account, Sign out. Top bar on board: ⌘K search field ("Search jobs and candidates"), OfflineBanner slot.
- **Tablet 768–1023:** rail collapses to 72px icons with labels in tooltips; same UserMenu.
- **Mobile < 768:** top bar (StripMark, search IconButton) + **BottomNav** on `--rail` (Home, Jobs, Candidates, Calls, More); More opens a Sheet with secondary items + UserMenu. Focus trap via Sheet.
- **CommandMenu (⌘K):** permission-filtered; groups Go to · Create · Jobs · Candidates (server search, debounced, loading row, "No jobs or candidates match "x"."); never shows "No matching" while loading.
- Skip link kept. One `<main id="main-content">`. Page titles via `metadata`/`document.title` per route.

---

## 7. Page requirements (close every listed audit ID)

1. **Home `/dashboard`** — "What needs you". BayBoard of real queues with true counts (count before slicing; "Showing 8 of 31" + link): Ready for review · Calls that didn't connect (reason + Retry call) · Not called yet (grouped by job, Call now) · On hold. First run (no agent or no job): EmptyState checklist derived from real data — Set up your agent → Create a job → Add candidates and call. No silent workspace creation: if the user has no workspace, show "Create your workspace" (name field). Loads in parallel (or the summary endpoint when available). Closes H4 H5 H6 H7 H8 H9 S1.
2. **Jobs `/jobs`** — Strip list (holder edge = job state), cells: title, candidates, ready for review, not called, last activity. Segmented filter Open / Draft / Closed / All. "Create job" dialog: Title + optional "Job description (used on calls)" textarea; errors inside the dialog; on create → `/jobs/[id]` (Setup). Closes J1 J2 J6 J7 S8.
3. **Job setup `/jobs/[id]`** — JobHeader (tab Setup). One form, sections: Job description (paste or upload; AI assists show a suggestion with **Use suggestion / Keep mine**) · Questions to ask (list editor, AI suggestions as additions) · Agent (inline picker of published agents; "Set up an agent" opens `/agents/new?returnTo=…` which returns here) · Status (Draft / Open for calls / Closed with what each means). One sticky **save bar** ("Unsaved changes" · Discard changes · Save changes) + navigation guard + draft persistence. Readiness checklist reflects **saved** data only and matches backend enforcement. Closes J3 J4 J5 J8.
4. **Job candidates `/jobs/[id]/candidates`** — JobHeader (tab Candidates; default tab once setup is complete). Stage Segmented filter with server counts + BayBoard/list toggle (list default for > 30). Strips with Checkbox, stage tag, latest call tag, questions answered, last call time. No page-level key handler: roving focus inside the list only (↑/↓ move, Enter opens); global shortcuts limited to `/` focus search. Bulk bar: Move forward · Put on hold · Not moving forward · Call now (confirm with count) + Undo; no typed confirmations. **Candidate Sheet** (`?c=` deep link fetches the row by id when not loaded): header (name, masked phone, stage tag, Call now [confirm], Start test call), Radix Tabs **Answers** (default when results exist; latest call expanded; AnswersList, summary, RecordingPlayer, Transcript, "Ask about this call" with a real label) · **Calls** (history with outcome reasons, Call again) · **Details** (edit name and phone, Remove from this job with confirm) · **History** (stage events with reason). Sticky decision bar: Move forward · Put on hold · Not moving forward (optional reason) + Undo toast (keep the existing optimistic pattern). Live call inside the sheet via LiveCallStrip with End call; after it ends: "Call ended. The answers appear here when the write-up is ready." and the sheet can always be closed. **Add candidates** Dialog with Tabs "One person" | "Import CSV": errors inside; CSV accepts 10-digit Indian numbers and applies +91 automatically (shown in the preview), downloadable template (`/templates/candidates.csv`), editable preview with labelled inputs that re-validates edited rows in place (never re-reads the file), then Import N candidates. Closes P1–P17 S7 S10.
5. **Candidates `/candidates`** — global search across jobs (server search if available; otherwise one cached load, not per keystroke); strips with job cell + stage + latest call; opens the job board with `?c=`. Closes C1 C2.
6. **Calls `/calls`** (nav "Calls", was "Activity") — Bay "Live now" (LiveCallStrip per live call; polling via query `refetchInterval` with backoff and visible error) · Recent calls strip list with Segmented filter All / Ready for review / Didn't connect / Test calls; each unsuccessful call shows its mapped reason + Call again (confirm). Call Sheet: Transcript + RecordingPlayer + AnswersList (same components as the board). Phone line banner: admins get the next step ("Connect your phone line in Settings"), others "Ask a workspace admin to connect the phone line." End call confirms. Closes V1 V5 V6 V7 V8 V10 S11.
7. **Test call** (`VoiceTestPanel` → `components/calls/test-call.tsx`, used by agent detail and the candidate sheet) — ask for the microphone **before** creating the server session; states from real SDK events (connecting, listening, agent speaking, ended) — never hard-coded; one cost notice in plain words; mic denied → "Your browser blocked the microphone. Allow microphone access for this site, then start again." + Try again; results refresh shown whenever results are pending. Closes V2 V3 V4 V9 G7.
8. **Agents** — `/agents` strips (name, module tag HRVoice, state, used by N jobs). `/agents/new` single page form: Name (default "Hiring agent") · Voice and language (only options the backend supports) · Transfer numbers (PhoneField list, up to 10 stated, validated) · Publish when saved (default on) → Save → agent detail with Start test call and "Create a job with this agent" (`/jobs?create=1&agent=<id>`). `/agents/[id]`: ErrorState on load failure (never a forever skeleton), busy states on every action, Pause confirms, no jargon (tiers, providers, raw events, permission keys, session ids); delete unreachable builder UI for hiring agents. Closes G1–G7.
9. **Knowledge `/knowledge`** — upload with client validation, progress and mapped errors; delete confirms with a short Undo window; Retry on load errors; Segmented (not tabs) for Upload/Paste. `/tools` restyled, not in nav. Closes K1–K3.
10. **Analytics `/analytics`** — only real numbers; ErrorState on failure (never zeros); parallel or summary loading; totals identical on mobile and desktop; cost per completed call only when the backend provides it. Closes N1 N2.
11. **Settings `/settings`** — left sub-nav sections: Workspace · Team · Phone line · Audit log · Your account. Missing data shows ErrorState, never "None". Audit log reads as sentences ("Ravi changed Asha's role to Recruiter"), no raw paths. Appearance section removed. Closes T1–T5 A10.
12. **Auth** — AuthShell: left a static strip bay (live loop off) + one line of value; right the form. `/login` and `/login?mode=register` are links (URL state). Register: Your name · Work email · Company name (hint "Shown to your team, e.g. Sharma Logistics") · Password with a visible rule checklist and show/hide. If the account is created but the workspace isn't: "Your account is ready, but the workspace wasn't created." + Create workspace (company name kept). Sign-in: no `minLength`; big enough "Forgot password?" link. Reset request: always "If an account exists for that email, we've sent a reset link." — **never render a link**. Reset with token: invalid/expired → "This link has expired. Request a new one." + Request a new link; success → "Password changed." + Sign in (email prefilled). **Invite accept** `/invitations/accept?token=`: skeleton while loading; preview (company, inviter, role); new person → name + password → Join <Company> → signed in → Home; existing account → "Sign in to join" (email prefilled, returns here); signed in as someone else → "You're signed in as x. This invite is for y." + Sign out and continue; expired/revoked → who to ask. Falls back to the current sign-in-to-accept flow when the preview endpoint is not available. Closes A1–A10.

---

## 8. Team, invites and roles (Settings → Team)

- **Members**: strips (name, email, role select, state). Change role → confirm ("Changing a role signs them out of open sessions."). Send password reset email (never shows a link). Remove from workspace → confirm. The last owner can't be removed or demoted; the control explains why.
- **Invite people** dialog: email(s) (one per line or comma separated, validated) + role (system + custom). Result lists each invite with **CopyField** (invite link) and "Expires on <date>". Only say "We emailed them" when the response says `emailDelivery: 'sent'`; otherwise "Share this link with them."
- **Invites list**: Waiting / Joined / Expired / Revoked tags; actions Get a new link (resend → copy), Revoke invite (confirm).
- **Roles**: system roles read-only with Duplicate; custom role editor = name, description, permission matrix grouped by area (People, Jobs, Calls, Knowledge, Agents, Team, Workspace) with checkboxes; sensitive permissions carry a lock glyph and the note "Personal data: every read is logged."; member count; Delete disabled with the reason while members hold the role.
- **Gating**: only members with the member-management permission see edit controls; others see read-only lists.
- **Contract (until MIGRATION_STATUS.md supersedes)**: `GET/POST /organizations/:orgId/roles`, `PATCH/DELETE /organizations/:orgId/roles/:roleId` → `{ id, key, name, description, isSystem, permissions: string[], memberCount }`; `GET /permissions` → `[{ key, label, group, description, isSensitive }]`; invitations create/resend → `{ invitation, inviteUrl, emailDelivery }`; public `GET /invitations/preview?token=` → `{ organizationName, inviterName, roleName, email, status, accountExists }`; public `POST /invitations/accept-new { token, name, password }` → session + `{ organizationId }`, 409 when the account exists, field errors `{ field, message }`.

---

## 9. Use-case-driven rendering (`lib/use-cases.ts`)

The UI reads a **UseCaseDefinition** instead of hard-coding hiring nouns:
```ts
interface UseCaseDefinition {
  id: string;                    // 'hiring'
  moduleName: string;            // 'HRVoice'
  live: boolean;
  labels: {
    workItem: { one: string; many: string };   // Job / Jobs
    contact:  { one: string; many: string };   // Candidate / Candidates
    agentDefaultName: string;                  // 'Hiring agent'
  };
  stages: Array<{ value: string; label: string; family: StateFamily; glyph: string; closing: boolean }>;
}
```
Fetch from `GET /use-cases` when the backend provides it; otherwise use the bundled HRVoice definition (the only live one). Nav labels, page titles, empty states, stage tags, Segmented filters and the website's module list read from it. Do not build a module switcher until a second definition is live.

---

## 10. Accessibility (WCAG 2.2 AA)

Keyboard path for everything; visible focus everywhere (ink on light, signal on rail); logical order; landmarks; one H1 per page; Radix for dialogs/sheets/menus/tabs/tooltips; labels on every control (no placeholder-as-label); errors linked with `aria-describedby` and `aria-invalid`; live regions for call state changes, toasts, async results ("Still loading…"); touch targets ≥ 44px; states never colour-only; reduced motion honoured everywhere; text resizes to 200% without loss; images have alt text (decorative `alt=""`); link text is meaningful.

---

## 11. Verification (must pass before claiming done)

1. `pnpm --filter @platform/web typecheck`, `test` (vitest), `build` — green.
2. Vitest units for `lib/errors.ts`, `lib/status-labels.ts`, `lib/use-cases.ts`, CSV row re-validation, AnswersList coverage, password rules, `lib/format.ts`.
3. Playwright (`apps/web/e2e/`, against the local API + DB) — journeys and failures:
   - Visitor: landing renders at 1366×768 with CTA above the fold; sample call controls work; Start a pilot → register → Home first-run checklist.
   - Recruiter: create agent → create job → setup save (unsaved-changes guard) → add one candidate + CSV with a fixed bad row → open candidate via deep link → move forward → Undo.
   - Team: invite → copy link → open in a fresh context → set password → lands on Home; owner changes a role (confirm); revoke an invite.
   - Failures: offline (`context.setOffline`) shows OfflineBanner and Retry recovers; mocked 500 shows ErrorState with ref + Retry; cleared session cookie mid-session redirects to `/login?next=`; expired reset token; oversized upload rejected client-side; mic denied on test call.
   - `@axe-core/playwright` on every main route: zero serious/critical.
   - Reduced motion emulation: no transforms on hero/stations; content complete.
   - Mobile 390×844 and tablet 820×1180 screenshots of every route.
4. Lighthouse on `/` (desktop + mobile) within §5.2 budgets.
5. `node ~/.claude/skills/impeccable/scripts/detect.mjs --json` on changed UI files; fix mechanical findings.
6. Fresh finish review, then DESIGN.md written from the built world.

---

## 12. Execution (workflows) and file ownership

| Wave | Workflow | Owns (write) |
|---|---|---|
| 1 | Inspiration + comps | `apps/web/.impeccable/mocks/**`, `docs/superpowers/specs/2026-10-01-inspiration-notes.md` |
| 2 | Foundation | `app/globals.css`, `tailwind.config.js`, `app/layout.tsx`, `components/ui/**`, `components/shared/**`, `components/brand/**`, `components/fx/**` (rewritten as thin new-world equivalents, then deleted when unused), `components/layout/AppProviders.tsx`, `lib/**` except the cluster-owned files below, `package.json`, `next.config.mjs`, `app/icon.svg`, `public/templates/**` |
| 3 | App clusters (parallel, strict ownership; may create new files only under their own folders) | **shell-home**: `components/AppShell.tsx`→`components/layout/app-shell/**`, `components/layout/CommandMenu.tsx`, `app/dashboard/**`, `app/candidates/**`, `lib/hiring-people.ts`, `components/home/**` · **auth**: `app/login/**`, `app/reset-password/**`, `app/invitations/**`, `components/layout/AuthShell.tsx`, `components/auth/**` · **jobs**: `app/jobs/page.tsx`, `app/jobs/[id]/page.tsx`, `components/jobs/**` · **board**: `app/jobs/[id]/candidates/**`, `components/candidates/**` · **calls**: `app/calls/**`, `components/calls/**`, `src/integrations/**` · **agents**: `app/agents/**`, `components/agents/**` · **knowledge-analytics**: `app/knowledge/**`, `app/tools/**`, `app/analytics/**`, `lib/upload.ts`, `lib/usage.ts`, `components/knowledge/**`, `components/analytics/**` · **settings-team**: `app/settings/**`, `components/TeamSettings.tsx`→`components/settings/**` |
| 4 | Website | `app/page.tsx`, `components/marketing/**`, deletes `components/LandingPage.tsx`, `components/landing/**`, `app/landing.css` |
| 5 | QA + finish | `apps/web/e2e/**`, `playwright.config.ts`, fixes routed back to owners |

Shared files are changed only by their owner. A cluster that needs a shared change records it in its report; the integration step applies it. Never touch `apps/api-java/**`, `apps/api/**` (backend agent), or git state.

---

## 12a. Addendum — decisions from the inspiration research (binding)

`docs/superpowers/specs/2026-10-01-inspiration-notes.md` is the craft reference for every builder (per-surface directives, motion cookbook, category defaults to avoid). Where it conflicts with this spec, these resolutions apply:

1. **Live bars** animate for 5s after each state change, then rest static (bars + word stay visible). Satisfies WCAG 2.2.2 without a pause control on every live strip.
2. **Website sample call** is a scripted text transcript, no audio, played compressed (about 3× real time) against a real m:ss clock with a native range scrubber; labelled as a sample. Write-in only during play; paused/reduced motion shows the full transcript with the current turn highlighted.
3. **Tablet rail** shows 12px labels under icons (not tooltip-only). Supersedes §6 tablet line.
4. **Hero fallback**: when the viewport is ≥ 1024px wide but too short for headline + sub + CTAs + top of the board (e.g. 1366×768), the H1 takes 7 columns and the sub + CTAs sit beside it in the remaining 5.
5. **Skeletons** use a flat opacity pulse (no shimmer), appear after 300ms, stay ≥ 500ms. Supersedes §3 Skeleton shimmer.
6. **Counts stamp, never roll** (no count-up animations anywhere). The H1 is static (no text reveal) for LCP.
7. **Unconfirmed data** (time in bay, last active, "used on N calls", waiting thresholds) renders only when the backend provides it; never inferred client-side.
8. **Not live yet** module strips: hatched holder edge, no link, no hover, no yellow.
9. **Sheet** stays modal (no three-pane layout); Undo toasts last 8s with no countdown fuse.

## 13. Things only the founder can supply (replacement list)

1. Product name and logo (wordmark constant `lib/brand.ts`, `app/icon.svg`).
2. A public contact email for "Talk to us" and server-error help text.
3. Languages to claim publicly beyond English.
4. OG/social image (generated placeholder ships until then).
5. Pilot terms, if the pricing copy should say more than "agree before you go live".
