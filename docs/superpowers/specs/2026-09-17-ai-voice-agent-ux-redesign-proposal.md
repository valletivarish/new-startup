# AI Voice Agent SaaS — Master UI/UX Redesign Proposal

**Status:** Active goal — design system first, then rebuild product UI in code.  
**Date:** 2026-09-17  
**Product:** AI Voice Agent SaaS (commercial wedge: recruitment screening; architecture open to support/sales/appointments later)  
**Constraint:** Do not preserve the current visual language, theme, layout, or IA. Do not use ChatGPT / AI-generated mock images as visual references. Research and principles only.  
**Implementation order:** (1) tokens + primitives, (2) shell/command/toasts, (3) Home → Jobs → Applications → Calls, (4) Agents/Analytics/Settings, (5) a11y/motion QA. Do not patch legacy screens component-by-component.

---

## 0. Locked technology decisions (from product owner)

### 0.1 Build foundation

| Decision | Choice | Why |
| --- | --- | --- |
| App framework | **Next.js 15 (App Router)** — keep | Repo already runs Nest + Next. Vite is fine for greenfield SPAs; migrating now costs weeks and breaks SSR/auth routes without UX gain. |
| Language | TypeScript | Already in place |
| Styling | Tailwind CSS | Required for shadcn and a real design system |
| Components | shadcn/ui + Radix | Accessible primitives; own the styles |
| Icons | Lucide | Matches shadcn ecosystem |

### 0.2 Motion hierarchy (authoritative)

Use the **smallest appropriate technology** for each interaction:

1. **CSS transitions** — hover, focus, color, opacity, simple transforms  
2. **Motion** (`motion` / Framer Motion) — React UI enter/exit, shared layout, page section transitions  
3. **GSAP (+ ScrollTrigger when needed)** — timeline-based sequences, scroll-driven landing storytelling, complex SVG / voice-activity visuals, high-impact product moments  
4. **Lenis** — only on marketing/landing where smooth scroll materially improves storytelling  

Rules:

- Do **not** use two animation libraries for the same interaction.  
- Do **not** animate everything.  
- Performance and accessibility beat visual effects.  
- Always respect `prefers-reduced-motion` (instant or opacity-only fallbacks).

### 0.3 Stack keep / cut / later

**Keep for v1 redesign**

| Library | Use |
| --- | --- |
| shadcn/ui + Radix | Buttons, dialogs, sheets, forms, tabs, dropdowns, toasts shell |
| Lucide | Icons |
| Tailwind | Tokens + layout |
| Motion | App UI transitions / layout |
| GSAP + ScrollTrigger | Landing + rare high-impact moments + voice SVG |
| Lenis | Landing only (optional; gate behind reduced-motion) |
| TanStack Query | Server state |
| TanStack Table | Jobs / candidates / calls tables |
| TanStack Virtual | Large lists |
| Zustand | Ephemeral UI state (panels, call monitor, command palette) |
| React Hook Form + Zod | Forms + validation |
| cmdk (via shadcn Command) | ⌘K |
| date-fns | Dates |
| dnd-kit | Pipeline stage moves |
| Sonner | Toasts |
| Tiptap | JD review / light editing |
| Uppy | JD / resume / CSV upload |
| Recharts | Analytics v1 |
| Playwright + Vitest + axe-core | QA |

**Defer (do not install until a real need appears)**

| Library | Why defer |
| --- | --- |
| Vite | Not replacing Next |
| Apache ECharts | Recharts covers v1; add only for dense ops analytics |
| Tremor | Overlaps shadcn + Recharts |
| DiceBear | Prefer initials avatars first |
| MapLibre | No location product need yet |
| Three.js / R3F / tsParticles | Decorative risk; no product purpose |
| SplitType | Only if a landing headline moment needs it |
| Web Animations API | Prefer CSS/Motion; WAAPI is optional micro-opt |

---

## 1. Web research findings

Sources consulted (live product writing + independent analysis; **not** ChatGPT image mocks):

- Linear (calmer UI refresh): dim navigation chrome, content leads, prune borders, progressive density  
- Stripe dashboard patterns: job-based nav, actionable metrics first, human microcopy, progressive disclosure  
- Ashby ATS: visual pipeline, “what’s next” for candidates, Application ≈ job consideration, AI as assistant not config surface  
- Greenhouse: structured hiring / scorecards — useful for review rigor, not for click-heavy daily UX  
- ElevenLabs / Retell / Vapi: voice products either hide infra (ops UX) or expose providers (dev UX). **We must not copy Vapi’s provider surface for HR.**  
- Progressive disclosure literature: Layer 1 overview (3–7 signals) → Layer 2 detail on click → Layer 3 configuration on intent  

### Extracted principles (not visual clones)

1. **Jobs of the user, not objects of the backend** — nav and home answer “what needs me?”  
2. **Summary first, evidence on demand** — AI summary before transcript  
3. **Progressive disclosure** — basic path tiny; advanced behind intent  
4. **Dim chrome, bright work** — sidebar quieter than content  
5. **Smart defaults + inference** — never re-ask Job/Agent/JD when Application already knows  
6. **Human state language** — Connected / Listening / Speaking, never WebSocket/LLM  
7. **Optimistic, recoverable UI** — every async path has loading / success / error / retry / empty  
8. **Keyboard power path** — ⌘K without blocking mouse beginners  
9. **Motion communicates state**, never delays work  
10. **One animation tech per interaction** (see §0.2)

---

## 2. Design principles for this product

| Principle | Product meaning |
| --- | --- |
| Tell outcome, not config | “Screen candidates for this job” beats “configure agent parameters” |
| Agent ≠ Job ≠ Candidate | Clear entity boundaries in IA and copy |
| Application is the hinge | Candidate × Job; context flows automatically |
| Attention over dashboards | Home = needs review / in progress / blocked |
| AI does repetitive work | Extract JD, propose questions, run screens, summarize |
| Trust through evidence | Claims link to transcript moments |
| Calm premium B2B | Clarity, hierarchy, restraint — not AI-gradient theater |
| Fail loudly, recover kindly | No silent call deaths; always next action |

---

## 3. Problems with current UX (audit)

Evidence from read-only audit of `apps/web` (2026-09-17).

**Current stack reality:** Next.js with inline-style AppShell tokens; Tailwind/shadcn were absent at audit time (foundation now being added). Giant pages (`jobs/[id]/candidates/page.tsx` ~1460 lines). Landing is a separate `ava-*` CSS system.

**Routes today:** `/`, `/login`, `/dashboard`, `/jobs`, `/jobs/[id]`, `/jobs/[id]/candidates`, `/agents`, `/agents/new`, `/agents/[id]`, `/candidates` (stub→Jobs), `/calls`, `/knowledge`, `/tools`, auth helpers. No job wizard route — only agent wizard at `/agents/new`.

**Top problems for an HR recruiter**

1. No guided first-run path — landing promises 3 steps; login lands on Dashboard, not Jobs.  
2. Agent-before-job chicken-and-egg; publish errors surface late.  
3. Three document concepts (team note / job JD / org Documents) — easy to put JD in the wrong place.  
4. Job “Screening setup” is one long form, not a review-AI-plan flow.  
5. Candidates page is a control room (add/import/call/review on one scroll), not a pipeline.  
6. `/candidates` stub + missing nav item; Dashboard still says “Assignments.”  
7. Raw statuses (`draft/open/closed`, `new/screening/reviewed`) without HR language.  
8. Calls is ops log disconnected from job workflow.  
9. Agent chrome (versions, sessions, builder) leaks into hiring desk.  
10. Nav mirrors backend (Documents beside Jobs) and undermines Agent≠Job ownership.

**KEEP / REFACTOR / REPLACE / REMOVE (frontend)**

| Area | Verdict |
| --- | --- |
| Domain APIs (jobs, candidates, voice) | KEEP (evaluate for Application endpoints) |
| AppShell + inline theme | REPLACE |
| Landing Atlas-inspired CSS experiment | REPLACE |
| Job / candidate page monoliths | REFACTOR → split into feature modules |
| Agent = reusable worker (post-freeze) | KEEP conceptually; REPLACE UI |
| Provider jargon in HR surfaces | REMOVE |

---

## 4. New information architecture

Primary objects HR thinks in:

```
Org → Agents (reusable workers)
    → Jobs (hiring contexts: JD, criteria, workflow)
         → Applications (Candidate × Job)
              → Screenings / Calls
              → Reviews / Stage moves
```

Supporting: Knowledge (attached to Job or Agent carefully), Integrations, Usage, Team/Settings.

---

## 5. New navigation

**Primary (sidebar)**

1. **Home** — attention inbox  
2. **Jobs** — open roles + pipeline health  
3. **Candidates** — people across applications (filterable by job)  
4. **Agents** — reusable AI workers  
5. **Activity** — calls & screening timeline (not a dump of sessions)  

**Secondary (footer / settings)**

- Analytics  
- Settings (company, team, phone line, billing, integrations)  

**Removed from primary**

- Documents as top-level (surfaces inside Job / Agent where owned)  
- Tools as primary  

**Global:** ⌘K command palette (create job, find candidate, jump to application, start screen).

---

## 6. New HR user journey (happy path)

1. Sign up → company created automatically  
2. Optional: create / confirm default **Hiring Screener** agent (one click, smart defaults)  
3. **Create Job** → upload JD → AI extracts requirements + screening plan → HR reviews → Publish  
4. **Add candidates** once for that job → Applications auto-created  
5. AI screens (phone/browser) with Job context already bound  
6. Home shows “needs review”  
7. HR opens Application → summary → evidence → advance / reject / schedule human  

Test question at every step: “Would a normal recruiter know what to do next without understanding our backend?”

---

## 7. Agent creation flow

**Mental model:** “What is this AI responsible for?”

Minimal create:

1. Name (e.g. Hiring Screener)  
2. Purpose preset: Hiring screen / Support (soon) / Custom  
3. Voice & language (India-first defaults)  
4. Transfer-to-human: on / off + when  

**Not on Agent:** JD, job title, must-ask list, candidate picker.

Advanced (collapsed): tone, max call length, retry policy, knowledge that is truly agent-global.

---

## 8. Job creation flow

1. Title + link Agent (default Hiring Screener)  
2. Provide JD (upload / paste) — Tiptap + Uppy  
3. AI analysis progress (Motion list reveal)  
4. Review cards: Must-haves, Nice-to-haves, Screening plan, Suggested questions (editable)  
5. Publish  

No “rebuild the JD as 40 fields.” Override only what AI got wrong.

---

## 9–11. Candidate / Application / Screening flows

**Candidates**

- Import: select Job **once** → bulk create Applications  
- Job apply link: Application auto-bound  

**Application (center of review)**

- Profile + job context  
- Stage in pipeline  
- AI screening summary  
- Requirement coverage with evidence links  
- Transcript drawer  
- Timeline  
- Primary CTA: Advance / Hold / Reject / Request human interview  

**Screening**

- States HR sees: Queued → Calling → Ringing → Connected → AI speaking → Listening → Thinking → Completed / No answer / Failed / Transferring  
- Live monitor sheet (optional)  
- Never show provider/LLM/WebSocket names  

---

## 12. Voice call experience

Dedicated **CallMonitor** component:

- Large human-readable state  
- Soft waveform (GSAP/SVG only if reduced-motion allows; else static bar)  
- Elapsed time  
- Candidate + Job labels  
- Actions: End, Transfer (if enabled), Retry  

Backend must drive explicit state machine; UI mirrors it. Silent audio → detect → surface error → close “active” lie.

---

## 13. Candidate review experience

Default tab: **Summary**  
Secondary: Evidence · Transcript · Timeline · Files  

Decision bar sticky: Advance / Reject / Schedule.

---

## 14. Dashboard (Home)

**What needs my attention?**

- Candidates needing review  
- Screenings in progress / stuck  
- Interviews today (when scheduling exists)  
- Failed calls needing retry  

Then **Hiring pipeline by job** (counts + next action).  
Then light **AI activity** strip (completed screens, advanced, attention).  

Not a vanity metrics wall.

---

## 15–20. Surfaces

### Jobs list

TanStack Table: title, stage counts, needs review, last activity, actions. Empty: “Create your first job — upload a JD and we’ll draft the screen.”

### Job detail

Header + pipeline (dnd-kit stages) + application table + Screening settings sheet + Add candidates.

### Agents

Card/list of workers; “Used by N jobs”; create simple; advanced in sheet.

### Candidates

People index with applications nested/filterable; never force job pick per row on import.

### Calls / Activity

Timeline + filters; deep-link to Application.

### Analytics

Recharts: screens completed, completion rate, time-to-review, funnel by job. ECharts only if we outgrow.

### Settings

Company, team, phone line status (honest), billing, integrations. Hide provider IDs behind “Advanced”.

---

## 21–23. Empty / loading / error

Every async view implements the five:

Loading (skeleton, not endless spinner) · Success · Error + Retry · Timeout · Empty with CTA  

Catalog explicitly designed for: no jobs, no candidates, no agents, no calls, no results, JD parse fail, import fail, call fail, unreachable, provider down, network, permission, session expiry, partial failure.

---

## 24. Responsive strategy

- **Desktop:** sidebar + dense tables  
- **Laptop:** collapsible sidebar  
- **Tablet:** icon rail + sheets for detail  
- **Mobile:** bottom nav (Home, Jobs, Candidates, More); tables → card lists; call monitor full-screen; no drag pipeline (buttons instead)

Do not merely shrink desktop.

---

## 25. Accessibility strategy

- Radix focus traps / keyboard for dialogs, menus, tabs  
- Visible focus rings (tokenized)  
- Contrast AA+ on text/status  
- Live regions for call state changes  
- `prefers-reduced-motion` kills Lenis, GSAP timelines, Motion layout springs  
- axe-core in CI; Playwright a11y smoke on Home, Job, Application, CallMonitor  

---

## 26. Motion strategy (detailed)

| Interaction | Tech |
| --- | --- |
| Button/hover/focus | CSS |
| Page section enter, tab panels, toasts presence | Motion |
| Pipeline card move confirmation | Motion layout |
| Landing scroll chapters | GSAP ScrollTrigger (+ Lenis only if approved in QA) |
| Voice waveform / state choreography | GSAP timeline or static CSS if reduced-motion |
| JD analysis progressive reveal | Motion stagger |

Forbidden: particles, bounce-everywhere, dual libraries on one element, motion that blocks input >150ms.

---

## 27. Component architecture

```
apps/web/
  app/                         # Next routes only
  components/
    ui/                        # shadcn primitives
    layout/                    # AppShell, Sidebar, Topbar, CommandMenu
    jobs/                      # JobList, JobHeader, PipelineBoard, ScreeningPlanReview
    applications/              # ApplicationHeader, Summary, Evidence, DecisionBar
    candidates/                # CandidateTable, ImportWizard
    agents/                    # AgentCard, AgentCreateDialog
    calls/                     # CallMonitor, ActivityFeed
    home/                      # AttentionInbox, JobHealthStrip
    marketing/                 # Landing sections (GSAP scoped)
  lib/
    api/                       # TanStack Query hooks
    stores/                    # Zustand
    motion/                    # reduced-motion helpers, gsap safe wrappers
    validators/                # Zod schemas
```

---

## 28. Design tokens — iOS-level quality system (not Apple clone)

**Goal:** Apple-quality refinement (spacing, type, depth, motion, a11y) applied to our AI SaaS — not an iOS UI clone.

### 28.1 Principles

Calm, premium, intentional, lightweight, information-dense without clutter, hierarchical, predictable. One coherent OS — not a pile of components.

Avoid: generic dashboard cards everywhere, border noise, random shadows, arbitrary px, AI-startup neon/purple glow, robot mascots, bounce motion.

### 28.2 Token architecture (CSS variables → Tailwind)

**Space:** `--space-1` … `--space-24` mapped to 4/8/12/16/20/24/32/40/48/64 rhythm.  
**Type:** `--font-display`, `--font-body`, `--font-mono`; `--text-xs`…`--text-4xl`; weights; `--leading-*`.  
**Color (semantic, light + dark):** `--background` / secondary / tertiary; `--surface` / elevated; `--foreground` scale; `--separator`; `--accent`+states; `--success|warning|danger|info`. Dark mode is a designed palette, not inverted white.  
**Radius:** `--radius-xs`…`--radius-full` — geometry by role, not 20px everywhere.  
**Depth / material:** background → surface → elevated → popover → floating; `.material-*` with blur only for nav, command, dialogs, sticky bars. Content stays opaque.  
**Motion:** `--duration-instant|fast|normal|slow` + natural easings; hierarchy CSS → Motion → GSAP; Lenis only when justified; `prefers-reduced-motion`.

### 28.3 Interaction + UI rules

- Controls: rest/hover/focus/active/disabled/loading; press `scale(0.98)` via CSS.  
- Focus: `:focus-visible` system-wide.  
- Touch: ≥44px targets; hover never sole path to info.  
- Cards only when grouping adds value; prefer surface + type + space.  
- Skeletons mirror final geometry.  
- Sheets/drawers for contextual Candidate / Transcript / Job config.  
- ⌘K command palette; Sonner sparingly.  
- AI language: status dots, waveforms, badges — quiet infrastructure, not magic theater.  
- Voice states: Idle → Connecting → Connected → Listening → Processing → Speaking → Interrupted → Reconnecting → Completed → Failed (not color-only).  
- Tables: subtle separators, hover/selected, keyboard — no heavy grids.  
- Animate transform/opacity only; no layout thrash.

### 28.4 Code delivery (in scope of this goal)

1. Audit legacy frontend ✓  
2. Define tokens + Tailwind bridge  
3. Install shadcn primitives listed in §26 of owner brief  
4. Replace AppShell  
5. Rebuild Jobs → Candidates/Applications → AI Screening on primitives  
6. Quality bar checklist before claiming a screen done

---

## 29. Three design directions

### Direction A — Minimal premium SaaS

- Sparse layout, typography-led, Stripe-like calm  
- Strength: trust, speed to learn  
- Weakness: may under-signal “AI working” during screens  
- Fit: strong for finance-like trust; weaker for live voice drama  

### Direction B — AI-native hiring workspace (**recommended lean**)

- Home as attention inbox; Job as workspace; Application as decision surface  
- AI status as quiet, continuous system presence (not neon)  
- Strength: matches philosophy “tell it what to accomplish”  
- Weakness: requires discipline to avoid AI gimmick UI  

### Direction C — Recruiting command center

- Dense Ashby-like multi-job pipeline walls  
- Strength: power recruiters  
- Weakness: high cognitive load for SMB HR first customers  

### Selection

**Primary: Direction B**, borrowing density patterns from C *inside Job detail only*, and visual restraint from A.

Rationale: commercial wedge is SMB/India HR who need clarity + AI doing work — not ops theater and not empty luxury whitespace.

---

## 30. Selected direction summary

**Name:** Hiring Workspace  

**Nav:** Home · Jobs · Candidates · Agents · Activity (+ Settings)  
**Hero object:** Job → Application  
**AI:** behind defaults + review screens  
**Visual:** new calm token system; shadcn foundation; motion hierarchy §0.2  
**Voice:** CallMonitor with human states  

---

## 31. Page-by-page implementation plan

Ordered delivery (still **no coding until approval**):

1. Design tokens + shadcn init + AppShell replacement  
2. Command palette + Sonner + Query client  
3. Home (AttentionInbox)  
4. Jobs list + Create Job (JD → AI review → Publish)  
5. Job detail + Pipeline + Import candidates  
6. Application detail (summary/evidence/decision)  
7. CallMonitor + Activity  
8. Agents simplified create/detail  
9. Analytics v1  
10. Settings (honest telephony)  
11. Marketing landing rebuild (GSAP/Lenis per rules; **real product UI screenshots**, not AI stock)  
12. Responsive + a11y pass + Playwright journeys  

---

## 32. Migration strategy from current UI

1. Feature-flag `ux.v2` shell; keep API contracts  
2. Route-by-route replacement behind flag  
3. Introduce Application as first-class UI (and API if missing — **do not distort UX to hide missing Application**)  
4. Strip provider strings from HR-facing errors; map to plain language  
5. Delete legacy inline-style AppShell and experimental landing once v2 ships  
6. Data migrator already frozen for Job-owned JD/questions — UI must match that freeze  

**API risks to flag (do not bend UX around them forever)**

- If candidates lack Application entity, add it.  
- If screening config still lives on Agent, finish migration.  
- If call states are coarse (`pending|active|ended|failed`), expand to the human state machine above.

---

## Real customer simulation checklist

Scenario: “Hire a Java Backend Developer” on a new account.

- [ ] Create job without configuring models/providers  
- [ ] Upload JD → AI plan appears → edit → publish  
- [ ] Import 10 candidates with **one** job selection  
- [ ] Start screens without re-picking JD/agent  
- [ ] Review summary without reading full transcript first  
- [ ] Advance candidate with clear next step  
- [ ] Failed call shows reason + retry  

If any step forces architecture understanding → redesign that step.

---

## Approval gate

**Goal now includes code.** Implementation order:

1. Tokens + Tailwind + primitives (started)  
2. AppShell / Command / Toasts  
3. Home → Jobs → Applications → Calls  
4. Agents / Analytics / Settings  
5. a11y + motion QA + customer journey verification  

Reply with course corrections anytime; do not wait on a separate “approve before code” gate for the design-system foundation.
