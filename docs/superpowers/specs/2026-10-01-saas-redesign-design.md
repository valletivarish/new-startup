# SaaS redesign — master design spec (supersedes the Strip Board spec)

**Date:** 2026-10-01 · **Branch:** `feat/strip-board-redesign` · **Owner:** founder; design execution delegated to Claude
**Goal:** one cohesive, premium, conventional SaaS product across the website and the app, at the craft level of **Intercom, Stripe and Attio**, with every "fix first" gap from the audit closed and the main journeys verified end to end.

Read with: `apps/web/PRODUCT.md` (product truth + brand commitments), `docs/superpowers/specs/2026-10-01-ux-audit.md` (findings with IDs), `apps/api-java/MIGRATION_STATUS.md` (backend contract), `docs/superpowers/specs/2026-10-01-saas-references.md` (reference screenshots and measurements, when present).
`2026-10-01-strip-board-redesign-design.md` is **superseded for all visual decisions**; its non-visual requirements are carried into this document. The Strip Board inspiration notes remain useful only for interaction, motion timing and accessibility rules, never for visuals.

---

## 0. Decisions — do not re-open

| Topic | Decision |
|---|---|
| Visual direction | **Conventional premium SaaS** (founder choice). References: Intercom, Stripe, Attio. Light theme. One accent: **deep blue**. Rounded cards, soft shadows, product UI in clean frames, centred hero. |
| Positioning | A voice-agent platform; hiring (**HRVoice**) is the live use case; CustomerVoice, SalesVoice, BookingVoice shown as "On the roadmap". |
| Naming | Wordmark reads **Voice platform** (`lib/brand.ts`, placeholder until the founder names the product). |
| Pricing | Usage-based per completed screening call, no seat fees, start with a pilot. **No numbers.** |
| Primary CTA | **Start a pilot** (signup) everywhere; **Sign in** for existing users. |
| Motion | CSS for hover/press/focus; `motion/react` for app transitions and scroll reveals; GSAP + ScrollTrigger for the website hero product animation and the architecture diagram; no Lenis; no Three.js/WebGL. |
| Truth rules | Nothing fake (missing data shown as missing, never 0 or "None"); no vendor names, env vars or API paths in UI; never recommend hire/reject; plain language; samples labelled; no customer logos, testimonials, metrics or languages beyond English unless the founder supplies them. |
| Landing after auth | Home (`/dashboard`) or `?next=`. |
| Libraries removed | `three`, `img-fx`, `metal-fx`, `liquid-gooey`, `voice-glow`, `thinking-orbs`, `bot-avatars`, `border-beam`, `lenis`, `next-themes` once nothing imports them. |

---

## 1. Visual system

### 1.1 Colour tokens (CSS custom properties, `app/globals.css` `:root`)

Neutrals (cool grey scale):

| Token | Hex | Use |
|---|---|---|
| `--bg` | `#FFFFFF` | Page and card surface |
| `--bg-subtle` | `#F9FAFB` | Alternate sections, app canvas, table header, hover rows |
| `--bg-muted` | `#F2F4F7` | Pressed/selected neutral fills, skeletons, empty-state icon ring |
| `--border` | `#EAECF0` | Card and divider borders (decorative) |
| `--border-strong` | `#D0D5DD` | Secondary button border, checkbox frame on hover (decorative or paired with text) |
| `--border-input` | `#8A94A6` | **Input, select, checkbox and radio boundaries** (3.06:1 on white, WCAG 1.4.11) |
| `--text` | `#101828` | Primary text |
| `--text-2` | `#475467` | Secondary text |
| `--text-3` | `#667085` | Tertiary text, placeholders, meta (4.97:1 on white; 4.76:1 on bg-subtle) |
| `--text-on-primary` | `#FFFFFF` | |

Brand (deep blue):

| Token | Hex | Use |
|---|---|---|
| `--primary` | `#1D4ED8` | Primary buttons, links, focus ring, active indicators (6.70:1 with white) |
| `--primary-hover` | `#1E40AF` | |
| `--primary-press` | `#1E3A8A` | Also the final CTA band background |
| `--primary-subtle` | `#EFF4FF` | Selected rows, active nav, tinted panels |
| `--primary-border` | `#C7D7FE` | Borders of tinted panels |

Status (badge text on badge background, all ≥ 4.5:1):

| Family | Text | Background | Border |
|---|---|---|---|
| `neutral` | `#344054` | `#F2F4F7` | `#EAECF0` |
| `info` | `#175CD3` | `#EFF8FF` | `#B2DDFF` |
| `success` | `#067647` | `#ECFDF3` | `#ABEFC6` |
| `warning` | `#B54708` | `#FFFAEB` | `#FEDF89` |
| `danger` | `#B42318` | `#FEF3F2` | `#FECDCA` |

Destructive button: `#B42318` with white text (6.57:1), hover `#912018`. Scrim: `rgb(16 24 40 / 0.5)`.

Tailwind (`tailwind.config.js`, v3): expose as `bg-bg`, `bg-subtle`, `bg-muted`, `border-border`, `border-strong`, `border-input`, `text-text`, `text-text-2`, `text-text-3`, `bg-primary`, `hover:bg-primary-hover`, `text-primary`, `bg-primary-subtle`, `border-primary-border`, `bg-status-{family}-bg`, `text-status-{family}-text`, `border-status-{family}-border`. Keep shadcn alias names mapped onto these so legacy classes compile. No hex in components; no inline `color-mix()`; no `style={{}}` except dynamic geometry.

### 1.2 Type

**Inter** variable via `next/font/google` with `axes: ['opsz']` (opsz 14–32, wght 100–900), `font-optical-sizing: auto` so large headings use the display cut. Font features: `"cv11", "ss01"` on body (single-storey a, open digits) and `tabular-nums` for numbers in tables, timers and counts. Fallback `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`.

| Token | Size / line height | Weight | Tracking | Use |
|---|---|---|---|---|
| `text-xs` | 12 / 18 | 400–500 | 0 | Meta, badges, table headers |
| `text-sm` | 14 / 20 | 400–600 | 0 | **App body default**, labels, buttons |
| `text-md` | 16 / 24 | 400–600 | 0 | **Website body default**, inputs on mobile |
| `text-lg` | 18 / 28 | 400–600 | 0 | Lead text (app), card titles (site) |
| `text-xl` | 20 / 30 | 600 | 0 | Section titles (app), feature titles (site) |
| `display-xs` | 24 / 32 | 600 | -0.01em | App page titles |
| `display-sm` | 30 / 38 | 600 | -0.02em | Large app headings, mobile H2 |
| `display-md` | 36 / 44 | 600 | -0.02em | Website H2 |
| `display-lg` | 48 / 60 | 600 | -0.02em | Website H1 at tablet |
| `display-xl` | 60 / 72 | 600 | -0.025em | Website H1 at desktop (`clamp(2.5rem, 1.6rem + 3vw, 3.75rem)`) |

Website lead/sub-headline: 18–20px / 28–30, `--text-2`, max 60ch. Rules: sentence case everywhere; no all-caps labels except optional 12px table-header-style overlines (none on the website); no em or en dashes in UI copy; no middle-dot-joined meta strings in app rows (use columns); no `→` characters appended to link text (a chevron icon is fine).

### 1.3 Space, layout, radius, depth

- 4px base spacing (Tailwind default scale). Website container `max-w-[75rem]` (1200px) with 24px / 32px side padding; section spacing `py-24` desktop, `py-16` mobile; centred section headers (max 720px) are allowed and conventional here. App content max 80rem for wide pages, 48rem for forms.
- Radius by role: badges **full pill**; buttons and inputs **8px**; small cards and table containers **12px**; feature cards, product frames, modals **16px**; final CTA band **24px**.
- Shadows (tinted with `#101828`): `--shadow-xs: 0 1px 2px rgb(16 24 40 / .05)`; `--shadow-sm: 0 1px 3px rgb(16 24 40 / .10), 0 1px 2px rgb(16 24 40 / .06)`; `--shadow-md: 0 4px 8px -2px rgb(16 24 40 / .10), 0 2px 4px -2px rgb(16 24 40 / .06)`; `--shadow-lg: 0 12px 16px -4px rgb(16 24 40 / .08), 0 4px 6px -2px rgb(16 24 40 / .03)`; `--shadow-xl: 0 20px 24px -4px rgb(16 24 40 / .08), 0 8px 8px -4px rgb(16 24 40 / .03)`; `--shadow-2xl: 0 24px 48px -12px rgb(16 24 40 / .18)`. Buttons and inputs `shadow-xs`; cards `shadow-sm` (+`shadow-md` on hover when interactive); menus and toasts `shadow-lg`; modals and product frames `shadow-xl`/`shadow-2xl`.
- Backgrounds: white by default; `--bg-subtle` alternates sections. The website hero may use **one** restrained decoration: a faint grid or dot pattern and/or a soft blue radial tint (≤ 8% opacity) behind the product frame. No purple, no rainbow mesh, no glowing blobs, no glass except the sticky nav (white 85% + 8px blur).

### 1.4 Motion

Tokens: `--dur-fast 150ms`, `--dur-base 200ms`, `--dur-slow 300ms`; ease `cubic-bezier(0.2, 0, 0, 1)`. Hover: colour/shadow 150ms; interactive cards lift `translateY(-2px)` + `shadow-md`. Scroll reveals on the website: fade + 12px rise, 400ms, stagger 60ms, once, via Motion `whileInView` (not on every element: section headers and card groups only). Tabs: sliding underline. Modals/sheets: fade + scale 0.98 → 1 / slide-in 300ms. Live status: a pulsing dot that pulses for 3 cycles after each state change, then rests (WCAG 2.2.2). GSAP on the website only: the hero product animation (one call moving through statuses, answers writing in; ~6s loop with ≥1s rests; starts after load; pauses off-screen; visible Pause control) and the architecture diagram (connector lines draw and nodes light in sequence on scroll, once). Everything instant under `prefers-reduced-motion` with designed end states. Never animate layout properties; no scroll listeners.

### 1.5 Iconography and imagery

Lucide (installed), stroke 1.75, 16px in app rows, 20px in buttons/feature cards; decorative icons `aria-hidden`. Feature icons sit in "featured icon" containers: 40–48px rounded square (10–12px radius) in `--primary-subtle` with `--primary` icon, or a soft neutral ring (`--bg-muted` with a 6px `--bg-subtle` outer ring) for empty states. Product imagery = **real app components rendered with sample data inside a framed window** (16px radius, `--border`, `--shadow-2xl`, a slim top bar showing the app's breadcrumb). No stock photos, no AI images, no fake browser-dot chrome, no device mockups.

### 1.6 Logo

Placeholder mark until the founder names the product: a 28px rounded square (8px radius) in `--primary` with two white rounded bars of different lengths (a transcript line motif), next to the wordmark "Voice platform" in Inter 600. `app/icon.svg` uses the mark. One constant in `lib/brand.ts`.

---

## 2. Status system (one map: `lib/status-labels.ts` → `StatusBadge`)

Every status renders as a **pill badge: background + border + 12px Lucide icon + word**. Never colour alone. Live states add a 6px pulsing dot instead of the icon.

| Domain | Value | Word | Family | Icon |
|---|---|---|---|---|
| Candidate stage | `new` | Not called yet | neutral | `Clock` |
| | `screening` | On hold | warning | `PauseCircle` |
| | `reviewed` | Moved forward | success | `CheckCircle2` |
| | `declined` | Not moving forward | neutral | `XCircle` |
| Call | dialing / ringing | Calling | info | live dot |
| | active | On call | success | live dot |
| | transferring | Handing to your team | info | `PhoneForwarded` |
| | completed, write-up pending | Writing up the call | info | `Loader` (static under reduced motion) |
| | results ready, no decision | Ready for review | warning | `FileCheck2` |
| | no answer / busy | No answer / Line busy | danger | `PhoneMissed` |
| | voicemail | Reached voicemail | danger | `Voicemail` |
| | failed | Call didn't connect | danger | `TriangleAlert` |
| Job | draft / open / closed | Draft / Open for calls / Closed | neutral / success / neutral | `PenLine` / `Radio` / `Archive` |
| Agent | draft / published / paused / archived | Draft / Live / Paused / Archived | neutral / success / warning / neutral | |
| Invite | pending / accepted / expired / revoked | Waiting / Joined / Expired / Revoked | info / success / warning / neutral | `Mail` / `UserCheck` / `CalendarX` / `Ban` |
| Module (site) | live / roadmap | Live / On the roadmap | success / neutral | |

---

## 3. Components (restyle the existing foundation; keep every export name working)

The foundation already provides the right components and APIs; this redesign **restyles** them and renames the world-specific ones with compatibility aliases:

| Existing | New name (keep old export as alias) | Conventional anatomy |
|---|---|---|
| `Button` | Button | Variants `primary` (blue fill, white text, shadow-xs), `secondary` (white, `--border-strong`, `--text-2`... use `#344054` text, shadow-xs), `tertiary`/`quiet` (no border, hover `--bg-subtle`), `link` (primary text, underline on hover), `destructive`, `destructive-secondary`. Sizes sm 36 / md 40 / lg 44 / xl 48; ≥44px hit area on touch. Radius 8. Loading: spinner + label, `aria-busy`. Focus: 2px primary outline, 2px offset. |
| `Field`, `Input`, `Textarea`, `Select`, `PasswordInput`, `FileInput`, `PhoneField` | same | Label 14px/500 `#344054` above; hint 14px `--text-3` below the control (`aria-describedby`); error 14px danger text with icon below; input 40px (44 on touch), radius 8, `--border-input`, shadow-xs, focus: primary border + 4px `--primary-subtle` ring + outline for keyboard; error: danger border + `#FEE4E2` ring. FileInput: dashed 12px-radius dropzone with featured icon, "Click to upload or drag and drop", type/size line. |
| `Checkbox`, `Segmented`, `Tabs` | same | Checkbox 16px box, radius 4, primary when checked, 44px hit area. Segmented: pill group on `--bg-muted` with white raised selected segment (shadow-xs). Tabs: underline style (2px primary bar on the active tab, text `--text` vs `--text-3`). |
| `Dialog`, `Sheet`, `Tooltip`, `ConfirmDialog` | same | Modal radius 16, shadow-xl, scrim; header with featured icon optional; footer buttons right-aligned (full width on mobile). Sheet: right slide-over 560px, white, border-left, shadow-2xl. Tooltip: `#101828` bg, white 12px text, radius 8. |
| `Notice` | Alert | Radius 12, tinted background by kind, border, icon, title + description, optional actions; `error` → `role=alert`. |
| `ErrorState`, `EmptyState`, `Skeleton` | same | Centered featured icon (neutral ring), 16px/600 title, 14px `--text-3` description, actions. Skeleton: `--bg-muted` blocks with a subtle pulse, mirroring final layout; shown after 300ms, held ≥500ms. |
| `StateTag` | **StatusBadge** | §2. |
| `Strip` / `StripList` | **ListRow** / **ListRows** | Attio-style row: 52px min height, columns, checkbox cell, avatar/initials + primary text + secondary text, badges, right-aligned meta and actions; `border-bottom: --border`; hover `--bg-subtle`; selected `--primary-subtle`; stretched link on the primary cell. Rows live inside a white 12px-radius container with `--border` and shadow-xs, with a `--bg-subtle` header row (12px/500 `--text-3`). |
| `Bay` / `BayBoard` | **BoardColumn** / **Board** | Kanban: columns on `--bg-subtle` (radius 12, 8px padding), header with title (14px/600) + count badge; cards white, radius 10, `--border`, shadow-xs, hover shadow-sm. Columns side by side ≥ lg; stacked list below. |
| `PageHeader`, `Breadcrumb`, `JobHeader` | same | Title `display-xs` 600 + description `--text-3` + actions right; underline tabs below; breadcrumb 14px with chevrons. |
| `OfflineBanner` | same | Top banner `--bg-subtle` with warning icon and text, or an Alert. |
| `CopyField` | same | Input-like field with a secondary "Copy" button; "Copied" announcement. |
| Toaster (Sonner) | same | White, radius 12, shadow-lg, border, icon by kind, Undo action as link-button. |
| `Transcript`, `OriginTicket`, `AnswersList`, `RecordingPlayer`, `LiveCallStrip` | same (LiveCallStrip may alias **LiveCallCard**) | Transcript: speaker avatar/initials + name + time, message text; current turn highlighted with `--primary-subtle`; time doubles as "Play from here" button when a recording exists. OriginTicket: small pill button "0:28" with play icon. AnswersList: two-column definition list (question / answer), "Not answered" in `--text-3`, coverage "4 of 5 questions answered" with a small progress indicator (no filled track bar on the website). RecordingPlayer: custom controls (play/pause button, range slider styled with primary thumb, time). Live call card: name, job, status badge with live dot, timer (tabular), End call (destructive-secondary, confirms). |
| `StripMark`, `BrandLink` | **LogoMark**, BrandLink | §1.6. |

All components: keyboard path, visible focus, ≥44px touch targets, reduced-motion handling, no colour-only meaning.

---

## 4. Shared infrastructure (unchanged from the previous spec, already built)

Kept as built in the foundation: `lib/api.ts` (safe JSON, single 401 redirect with `next`, NotAvailableError for optional endpoints), `lib/errors.ts` (plain messages, vendor/env/path scrubbing, support ref), TanStack Query defaults, `useMe`/`usePermissions`, `useOnline` + OfflineBanner, drafts + unsaved-changes guard, `lib/use-cases.ts`, `lib/status-labels.ts` (update families per §2), `lib/format.ts`, `lib/brand.ts`. **Align client functions with `apps/api-java/MIGRATION_STATUS.md` "Frontend contract additions"** (exact paths: `GET /invitations/{token}`, `POST /invitations/accept-new`, `POST /organization/invitations/{id}/resend`, `GET/POST/PATCH/DELETE /roles`, `GET /permissions`, `DELETE /organization/members/{id}`, `POST /organization/members/{id}/password-reset`, `GET /hiring/summary`, `GET /jobs/{jobId}/candidates/{candidateId}`, `GET /use-cases`, `GET /usage/summary`, `GET /usage/costs`, `GET/PUT /usage/limits`, Better Auth `change-password` / `update-user`), all under the `/backend` prefix except `/api/auth`.

---

## 5. Website (`/`) — conventional SaaS at the Stripe / Intercom / Attio bar

Job: a founder or HR head understands within one viewport that this is an AI agent that makes real business phone calls (hiring live today), sees the product working, and starts a pilot.

| # | Section (id) | Layout | Content |
|---|---|---|---|
| Nav | — | Sticky, 64px, white 85% + blur after scroll, bottom border after scroll | Logo + "Voice platform"; links Product (#features), How it works (#how-it-works), Use cases (#use-cases), Pricing (#pricing), FAQ (#faq); right: Sign in (tertiary) · **Start a pilot** (primary). Mobile: logo, Start a pilot, menu → Sheet. |
| 1 Hero | `top` | **Centred** | Optional announcement pill (`--primary-subtle`, 14px): "HRVoice is live for hiring teams" + chevron icon, links to #use-cases. H1 (≤ 2 lines desktop): **"Voice agents that make your business calls and show their work."** Sub (≤ 2 lines): **"Give it a job. It phones every candidate, asks your questions, and returns the transcript for you to decide."** CTAs: **Start a pilot** (primary lg) · **See how it works** (secondary lg → #how-it-works). Below: the **product frame** (real app components with sample data: compact app sidebar + a job's candidates table with status badges + an open review panel with answers), animated with GSAP (a call goes Calling → On call → Ready for review, answers write in; Pause control; static under reduced motion). Caption under the frame: "Sample data. Names and answers are illustrative." Must show headline, sub, CTAs and the top of the frame at 1366×768. |
| 2 Features | `features` | Centred header + **3 feature cards** (each with a mini product visual on `--bg-subtle`, icon, title, text) | Header: "Phone screening that runs itself" + one-line sub. Cards: **"Calls every candidate"** — "Add people to a job and the agent calls each one, from an Indian number, at the pace you set." (visual: list of calls with status badges) · **"Asks the questions you choose"** — "Every call follows your job description and the questions you set. No scripts to write." (visual: question checklist with ticks) · **"Hands you the evidence"** — "Read a short summary, the answers and the full transcript, or play the recording." (visual: answers with timestamp pills). |
| 3 Sample call | `sample-call` | Split: text left, product card right | H2 "Read a five-minute call in thirty seconds." Bullets (check icons): "Summary first, transcript one click away" · "Every answer links to the second it was said" · "It never recommends hire or reject". Link button "Start a pilot". Right: the **sample call player** card (play/pause, custom scrubber, time, transcript highlighting the current turn, answers with timestamp pills, coverage line), using `components/marketing/sample-data.ts` and the existing `sample-call-timeline.ts` logic. Label "Sample call. Illustrative, not a real candidate." |
| 4 How it works | `how-it-works` | Header + **4 numbered steps** in a row (connected line; stacked on mobile) + "Under the hood" architecture diagram | Steps: 1 **Create a job** — "Paste or upload the job description and the questions you want asked." 2 **Add candidates** — "Add people one by one or import a CSV. Phone numbers are checked as you go." 3 **The agent calls** — "Try a test call in your browser first, then call by phone once your line is connected." 4 **Review and decide** — "Read the answers, play the recording, and move each person forward yourself." Then "Under the hood": a horizontal flow of six nodes — **Phone line** (dials and detects voicemail) → **Speech** (turns speech into text as they talk) → **Reasoning** (picks the next question) → **Knowledge** (answers from your job description) → **Orchestration** (follows your rules, hands off to a person) → **Actions** (writes transcript, answers and summary) — connectors draw in sequence on scroll (GSAP, once); vertical on mobile; static under reduced motion. |
| 5 Use cases | `use-cases` | Header + 4 module cards (2×2 or 4-up), HRVoice card emphasised | "One platform. A module for each kind of call." Cards from `MODULES` in `lib/brand.ts` with StatusBadge "Live" (HRVoice) / "On the roadmap" (others). HRVoice card has "Start a pilot" link; roadmap cards have no link. |
| 6 Control | `control` | Split: 2×2 icon list left, a product card right (roles & permissions table snippet built from real components with sample roles) | H2 "Your team stays in control." Items: "It never recommends hire or reject" · "Roles decide who hears recordings and reads transcripts" · "Invite your team with a link and set what each role can do" · "Any call can be handed to a person on your team". |
| 7 Pricing | `pricing` | Centred header + one pricing card (with "included" checklist) | "Simple, usage-based pricing." Card: "Pilot" · "Pay per completed screening call" · "No per-seat fees" · checklist (Test calls in your browser · Phone calls once your line is connected · Transcripts, recordings and answers · Team roles and invite links · Analytics on real calls) · CTA **Start a pilot** · note "We agree the rate with you before you go live." No numbers, no tiers. |
| 8 FAQ | `faq` | Two-column: heading + sub left, accordion right | Questions/answers exactly as the previous spec §5.1 (agent decides? phone line? candidate needs? handoff? who sees recordings? no pick-up?). Accordion = native `details/summary` styled with chevron rotation (150ms; instant under reduced motion), dividers between items. |
| 9 Final CTA | — | Rounded (24px) `--primary-press` band card inside the container | "Put an agent on your next open role." + sub "Start with a test call in your browser. No per-seat fees." + **Start a pilot** (white button, primary text) · **Sign in** (link-button white). |
| Footer | — | White, top border, logo + tagline left, link columns right | Product: Features, How it works, Use cases, Pricing, FAQ · Account: Sign in, Start a pilot · © year Voice platform. No links to pages that don't exist. |

Engineering: `app/page.tsx` stays a Server Component; interactive pieces are client leaves under `components/marketing/`; GSAP via `useGSAP` + `gsap.matchMedia()` with cleanup; Motion `whileInView` for reveals; lazy-load below-the-fold client leaves with SSR markup kept. Metadata/OG/robots/sitemap as before. Budgets: LCP < 2.5s, CLS < 0.1, Lighthouse desktop perf ≥ 90, a11y ≥ 95. Reuse logic from the stopped Strip Board build where it fits (`sample-data.ts`, `sample-call-timeline.ts`, `desk-demo-state.ts`, `stations-data.ts`); replace all of its visuals.

---

## 6. App shell and IA (Attio / Stripe dashboard bar)

Routes unchanged. **Desktop ≥ 1024:** left sidebar 240px, white with `--border` right edge: top = workspace switcher (logo mark + workspace name + chevron; real org name, skeleton while loading); a search button "Search" with ⌘K hint; nav group (Home, Jobs, Candidates, Calls) and a second group (Agents, Knowledge, Analytics, Settings) with 36px items (icon 18px + label 14px/500), active item `--bg-muted`/`--primary-subtle` background + `--text` + icon in primary; bottom: user menu (initials avatar circle 32px + name + email, menu: Your account, Switch workspace if > 1, Sign out). **Tablet:** collapsible icon sidebar (64px) with tooltips + labels in an expandable state. **Mobile:** top bar (logo, search, menu) + bottom tab bar (Home, Jobs, Candidates, Calls, More) on white with top border; More → Sheet. Page area on `--bg-subtle` with white content cards, or white with sections; pick one per page type and keep it consistent: **lists/tables on white page with a bordered table container; dashboards on `--bg-subtle` with white cards**. Command menu restyled conventionally (white, radius 12, shadow-xl, grouped results, keyboard hints). Offline banner at the top of the content area.

---

## 7. Page requirements (close every listed audit ID)

Unchanged in substance from the previous spec §7 (read it there for full detail); visual vocabulary maps as: strip → ListRow, bay → BoardColumn / card section, rail header → table header / column header, state tag → StatusBadge.

1. **Home** — greeting with the user's first name; 4 stat cards with real counts from `/hiring/summary` (Ready for review · Calls that didn't connect · Not called yet · Open jobs), each linking to the filtered list; below, two cards: "Ready for review" list (oldest first, "Showing 8 of N") and "Calls that didn't connect" list with reason + Call again; first-run: setup checklist card (Set up your agent → Create a job → Add candidates and call) driven by real data. Closes H4–H9, S1.
2. **Jobs** — table (Title, Status badge, Candidates, Ready for review, Not called, Last activity) with Segmented filter (Open / Draft / Closed / All) and search; Create job modal (Title + optional "Job description (used on calls)"). Closes J1, J2, J6, J7, S8.
3. **Job setup** — JobHeader with underline tabs (Candidates | Setup); form sections as cards (Job description · Questions to ask · Agent · Status); sticky save bar when dirty ("4 unsaved changes" · Discard · Save changes); AI suggestions shown as a diff-like suggestion card with Use suggestion / Keep mine; readiness checklist card from saved data. Closes J3, J4, J5, J8.
4. **Job candidates** — JobHeader; toolbar (search, stage Segmented with counts, view toggle Table/Board, Add candidates); table rows with checkbox, name + masked phone, stage badge, latest call badge, questions answered, last call; bulk action bar (Move forward / Put on hold / Not moving forward / Call now with confirm) + Undo toast; Board view with columns per stage; candidate slide-over (Sheet) with header (name, badges, Call now [confirm], Start test call), tabs Answers / Calls / Details / History, sticky decision footer, live call card with End call; `?c=` deep link fetches by id; Add candidates modal with tabs One person / Import CSV (template download, +91 auto, editable preview with per-row revalidation). Closes P1–P17, S7, S10.
5. **Candidates** — global table with job column and filters; one cached load or server search. Closes C1, C2.
6. **Calls** — "Live now" cards + Recent calls table with Segmented filter (All / Ready for review / Didn't connect / Test calls); failure reasons mapped from `failureReason`; call slide-over with transcript, recording and answers; phone-line banner with the admin's next step. Closes V1, V5–V8, V10, S11.
7. **Test call** — mic permission first; states from real SDK events; one plain cost note; mic-denied recovery; results refresh. Closes V2–V4, V9, G7.
8. **Agents** — table of agents; single-page create form (Name, Voice and language, Transfer numbers via PhoneField list "3 of 10", Publish when saved) with `returnTo`; detail page with Start test call, Pause (confirm), busy states, ErrorState on load failure; remove builder jargon. Closes G1–G7.
9. **Knowledge** — upload dropzone with client validation, progress, file rows with statuses, delete with confirm + Undo. Closes K1–K3.
10. **Analytics** — stat cards and tables from `/usage/summary` and `/usage/costs`; costs shown only when not null ("Cost per completed call appears once your rate card is set."); ErrorState on failure, never zeros. Closes N1, N2.
11. **Settings** — left sub-nav (Workspace · Team · Roles · Phone line · Audit log · Your account) with Stripe-style setting cards; no "None" placeholders; audit log as sentences. Closes T1–T5, A10.
12. **Auth** — split layout: form left (max 400px), right panel on `--bg-subtle` (or `--primary-press`) with a framed product card and one value line; URL-driven register/sign-in; password checklist + show/hide; generic reset message (never a link); expired-token recovery; invite accept with preview, set-password-on-first-open, wrong-account switch. Closes A1–A10.

---

## 8. Team, invites, roles — as the previous spec §8, using the confirmed backend contract (`MIGRATION_STATUS.md`): `emailDelivery` decides "We emailed them" vs "Share this link with them"; Administrators can manage custom roles (ADR-009), granting only what they hold; permission catalogue grouped with sensitive markers; system roles read-only with Duplicate.

## 9. Use-case-driven rendering — as the previous spec §9 (`lib/use-cases.ts`, backed by `GET /use-cases`).

## 10. Accessibility — WCAG 2.2 AA, as the previous spec §10 (keyboard, focus, labels, live regions, 44px targets, non-colour status, reduced motion, 200% text).

## 11. Verification — as the previous spec §11 (typecheck, vitest, build; Playwright journeys incl. failures; axe; reduced motion; mobile/tablet screenshots; Lighthouse; impeccable detector; finish review; DESIGN.md from the built world). Visual review is judged against the reference screenshots in `docs/superpowers/specs/2026-10-01-saas-references.md`.

## 12. Execution and ownership

| Wave | Workflow | Owns |
|---|---|---|
| R1 | Re-theme foundation + reference research | tokens, fonts, `components/ui/**`, `components/shared/**`, `components/brand/**`, `components/fx/**`, `lib/status-labels.ts`, `lib/api.ts` contract alignment, `app/layout.tsx`, `app/icon.svg`, `app/design-system/**`, reference doc + screenshots |
| R2 | Website | `app/page.tsx`, `components/marketing/**` (except `sample-data.ts`, coordinator-owned), robots/sitemap/OG |
| R3 | App clusters (parallel, strict ownership as in the previous spec §12) | per-cluster pages and feature folders |
| R4 | QA + finish | `apps/web/e2e/**`, fixes routed to owners, DESIGN.md |

## 13. Replacement list (founder-only inputs)

Product name and logo; a public contact email; languages to claim; whether the agent should state it is an AI on calls; pilot terms; rate card (costs stay hidden until set); auto-retry consent policy.
