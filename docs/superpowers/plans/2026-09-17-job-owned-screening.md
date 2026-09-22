# Job-owned screening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one reusable HR agent screen many jobs by moving must-ask questions and role JD docs onto the Job, and wiring provision + fit % to job context.

**Architecture:** Agent remains the versioned voice/persona shell. Job owns screening questions + role knowledge. At call time, `provisionDeployment(actor, agentId, { jobId })` merges job criteria/knowledge over the agent shell. Compat: empty job screening falls back to linked agent config with a deprecation log until migration completes.

**Tech Stack:** NestJS/Fastify API, Next.js desk, Drizzle/Postgres + RLS, existing knowledge pipeline, ElevenLabs voice adapter.

**Spec:** `docs/ARCHITECTURE.md` (freeze contract)

## Global Constraints

- Organization is the tenant boundary; RLS + `@RequirePermission` unchanged.
- No hire advice / no vendor names in customer UI.
- Do not put must-ask or role JD back on agent create.
- Providers only via adapters; no ElevenLabs types in domain tables.
- Other packs / webhooks / MCP stay out of day-one.
- Prefer TDD for schema + provision merge + one two-job integration test.
- Human approval required before starting Task 1 if this plan was not explicitly approved.

---

## File map

| File | Responsibility |
|------|----------------|
| `packages/db/src/schema/hiring.ts` (+ migration `0018_*.sql`) | `job_screening` fields or table; `job_knowledge_sources` |
| `packages/db/drizzle/0018_job_owned_screening.sql` | Tables, indexes, RLS, grants |
| `apps/api/src/hiring/jobs.service.ts` | CRUD for questions/knowledge; list call flags |
| `apps/api/src/hiring/jobs.controller.ts` | API surface for job screening + knowledge attach |
| `apps/api/src/providers/elevenlabs/voice-session.service.ts` | `provisionDeployment` job merge |
| `apps/api/src/hiring/fit-percent` usage in `jobs.service` | Criteria from job when present |
| `apps/web/app/agents/new/page.tsx` | Remove JD upload + must-ask |
| `apps/web/app/jobs/[id]/page.tsx` (and/or `jobs/new`) | JD upload, must-ask, add people, call flags |
| `apps/web/lib/api.ts` | Client types/endpoints |
| `apps/api/test/hiring-desk.test.ts` (+ new focused tests) | Two jobs, one agent, different questions |
| `apps/web/app/page.tsx` | Landing copy: jobs own docs/questions |

---

### Task 1: Schema — job screening + job knowledge

**Files:**
- Create: `packages/db/drizzle/0018_job_owned_screening.sql`
- Modify: `packages/db/src/schema/hiring.ts`, `packages/db/src/schema/knowledge.ts` (or hiring), `packages/db/src/schema/index.ts`

- [ ] Add `job_knowledge_sources` (mirror `agent_knowledge_sources`: org_id, job_id, source_id, unique(job_id, source_id), RLS FORCE, grants).
- [ ] Add job screening storage: either `jobs.screening_questions jsonb not null default '[]'` **or** normalized `job_screening_questions` table — prefer jsonb array `{ id, label }` for slice 1 speed.
- [ ] Apply migration locally; confirm schema-drift / RLS tests still pass for new tables.
- [ ] Commit: `db: add job-owned screening questions and job_knowledge_sources`

---

### Task 2: API — read/write job screening + attach knowledge

**Files:**
- Modify: `apps/api/src/hiring/jobs.service.ts`, `jobs.controller.ts`
- Modify: `apps/web/lib/api.ts`

- [ ] Write failing tests: create/update job with `mustAskQuestions`; attach knowledge source to job; list returns them.
- [ ] Implement service methods + controller routes (`PATCH` job body and/or `POST /jobs/:id/knowledge`).
- [ ] Permissions: `jobs.update` for mutate; `jobs.read` + `knowledge.read` as appropriate for list.
- [ ] Run tests; commit: `api: job screening questions and knowledge attach`

---

### Task 3: Provision + fit % use job context

**Files:**
- Modify: `apps/api/src/providers/elevenlabs/voice-session.service.ts`
- Modify: `apps/api/src/hiring/jobs.service.ts` (`getCandidateResults` criteria source)
- Test: `apps/api/test/hiring-desk.test.ts` or new `job-screening-provision.test.ts`

- [ ] Write failing test: one agent, two jobs with different must-ask; outbound/browser start for job A collects A’s keys (or provision snapshot includes A’s labels); fit % uses job A criteria.
- [ ] Change `provisionDeployment(actor, agentId, { jobId?, knowledgeSnapshot?, voiceId? })`:
  - If `jobId` set and job has questions/knowledge → use those for criteria + knowledge source ids.
  - Else fall back to agent version config + `agent_knowledge_sources` (compat) and log `hiring.screening.fallback_agent`.
- [ ] Pass `jobId` from `startVoiceSession` / `startOutboundPhoneCall` into provision.
- [ ] `getCandidateResults` / fit %: load criteria from job when non-empty.
- [ ] Run hiring + packs tests; commit: `voice: provision and fit % prefer job screening`

---

### Task 4: Desk UX — strip agent wizard; Jobs-first screening

**Files:**
- Modify: `apps/web/app/agents/new/page.tsx`
- Modify: `apps/web/app/jobs/[id]/page.tsx` (and jobs create if needed)
- Modify: `apps/web/app/page.tsx` (landing copy)
- Modify: `apps/web/app/agents/page.tsx` copy if it says “job description documents”

- [ ] Remove JD file upload + must-ask from agent create/review/done; keep name, purpose (generic), transfer phones, publish.
- [ ] On job detail: edit must-ask (textarea lines), upload JD docs → create knowledge source named after job → attach via job knowledge API; show indexing status from **job** sources.
- [ ] Add candidate on job (create + assign) and show `callStatus` / `callReceived` from list API (if not already wired).
- [ ] Soften “Link agent”: auto-pick first published hiring agent when only one exists.
- [ ] Manual smoke: create agent (no questions) → two jobs with different JD/questions → same agent → confirm UI shows job fields.
- [ ] Commit: `web: jobs own JD and must-ask; agent wizard is reusable screener`

---

### Task 5: Compat migration note + verification

**Files:**
- Modify: `docs/ARCHITECTURE.md` (mark Slice 1 done)
- Optional script or one-shot admin note in README

- [ ] Document: existing agents with baked JD/questions — operators should copy questions/docs onto linked jobs (or run a follow-up Task 6 migrator).
- [ ] Run `pnpm` hiring-desk tests + `hiring:smoke` + `ops:check`.
- [ ] Confirm freeze rule: agent create has no must-ask/JD.
- [ ] Commit: `docs: slice 1 job-owned screening complete`

---

## Out of scope (later slices)

- Bulk assign / dial campaign
- Session-frozen criteria snapshot table (recommended follow-up)
- Deleting agent_knowledge for role docs automatically
- Full rewrite of control plane
- Other packs, customer webhooks, MCP
