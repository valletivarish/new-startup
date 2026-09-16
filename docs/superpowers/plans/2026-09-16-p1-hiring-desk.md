# P1 Hiring Desk — Contacts, Jobs, Review Widgets

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a recruiter create jobs, add candidates (manual or resume text → phone), assign an agent, and review screening results in permission-gated dashboard widgets — without live Exotel yet.

**Architecture:** New org-scoped `jobs` and `candidates` tables (match existing `jobs.*` / `candidates.*` permissions). Optional `job_candidates` assignment + `agent_id` on job. Resume phone extract is a pure function (E.164/+91 heuristics), not an OCR service. Result review reads existing `voice_sessions` / `agent_sessions` linked via FKs or `business_context`. UI follows locked visual reference (deep blue, white desk, metric cards).

**Tech Stack:** NestJS/Fastify, Drizzle/Postgres RLS, Next.js, Vitest, Zod.

**Spec:** `docs/superpowers/specs/2026-09-16-voice-agent-platform-design.md` (§5 domain, §10 P1, §13 visual)

## Global Constraints

- No vendor names (ElevenLabs, Exotel, Gemini) in product UI copy.
- Never recommend hire/reject — review shows fit % / answers / transcript when present; else unavailable/null.
- English default for agent-facing content; candidate phone numbers India-friendly (+91).
- YAGNI / ponytail: no OCR cloud, no Exotel, no custom roles UI, no analytics pack beyond desk widgets.
- TDD per task; no change-history comments in code.
- Unlock only `jobs` + `candidates` from phase-boundary; keep `calls` / `evaluations` / `workflows` forbidden until later plans.
- Work on branch `feat/p0-pack-hiring-wizard` (continues P0) or rename to `feat/p1-hiring-desk` in Task 0 if cleaner — prefer **continue same branch**.

---

## File map

| File | Responsibility |
|------|----------------|
| `packages/db/drizzle/0015_hiring_desk_foundation.sql` | `jobs`, `candidates`, `job_candidates` |
| `packages/db/drizzle/0016_hiring_desk_rls.sql` | RLS ENABLE+FORCE + tenant policies |
| `packages/db/src/schema/hiring.ts` | Drizzle schema |
| `apps/api/src/hiring/*` | jobs/candidates services + controllers |
| `apps/api/src/hiring/phone-extract.ts` | Resume text → phones |
| `apps/api/test/hiring-desk.test.ts` | Integration tests |
| `apps/api/test/phase-boundary.test.ts` | Remove jobs/candidates from FORBIDDEN_TABLES |
| `apps/web/app/jobs/*`, `candidates/*`, dashboard widgets | Desk UI |
| `apps/web/lib/api.ts` | Client helpers |

---

### Task 1: Phase boundary + migrations + schema

**Files:**
- Modify: `apps/api/test/phase-boundary.test.ts` — drop `jobs`, `candidates` from `FORBIDDEN_TABLES`
- Create: `packages/db/src/schema/hiring.ts`
- Modify: `packages/db/src/schema/index.ts` — export
- Create: `packages/db/drizzle/0015_hiring_desk_foundation.sql`
- Create: `packages/db/drizzle/0016_hiring_desk_rls.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`

**Schema (minimal):**

```typescript
// jobs: id, organization_id, title, description (JD text), status draft|open|closed,
//   agent_id nullable FK agents, created_by_user_id, created_at, updated_at
// candidates: id, organization_id, full_name, phone nullable, email nullable,
//   resume_text nullable, source manual|resume, created_at, updated_at
// job_candidates: id, organization_id, job_id, candidate_id, status new|screening|reviewed,
//   unique (job_id, candidate_id)
```

- [ ] **Step 1:** Write failing phase-boundary expectation that jobs/candidates are allowed OR flip forbidden list first then add migrations in same task after test update
- [ ] **Step 2:** Add schema + SQL + journal (follow 0013/0014 RLS patterns: ENABLE + FORCE, `organization_id = current_org_id()`)
- [ ] **Step 3:** `pnpm -C packages/db migrate` against local DB if available; otherwise harness migrations pick up journal
- [ ] **Step 4:** Run `phase-boundary.test.ts` — PASS
- [ ] **Step 5:** Commit `feat(db): hiring desk jobs and candidates tables with RLS`

---

### Task 2: Phone extract helper

**Files:**
- Create: `apps/api/src/hiring/phone-extract.ts`
- Test: `apps/api/test/phone-extract.test.ts`

**Produces:** `extractPhonesFromText(text: string): string[]` — unique, prefer +91 / 10-digit Indian mobiles; strip junk; max 5.

- [ ] **Step 1:** Failing tests: empty; `+91 98765 43210`; `9876543210`; duplicate; ignore short numbers
- [ ] **Step 2:** Implement minimal regex pipeline
- [ ] **Step 3:** PASS + commit `feat(hiring): extract phone numbers from resume text`

---

### Task 3: Jobs API

**Files:**
- Create: `apps/api/src/hiring/jobs.service.ts`, `jobs.controller.ts`
- Modify: `app.module.ts`, `tokens.more.ts`, `route-coverage.test.ts`
- Test: `apps/api/test/hiring-desk.test.ts`

**Endpoints:**
- `GET /jobs` — `jobs.read`
- `POST /jobs` — `jobs.create` body `{ title, description?, agentId? }`
- `GET /jobs/:id` — `jobs.read`
- `PATCH /jobs/:id` — `jobs.update` (title, description, status, agentId)

- [ ] **Step 1:** Failing integration test create+list+get with owner cookie
- [ ] **Step 2:** Implement service/controller with RLS tenant context (copy agents patterns)
- [ ] **Step 3:** Cross-org 404 test
- [ ] **Step 4:** Commit `feat(api): jobs CRUD for hiring desk`

---

### Task 4: Candidates API + resume text

**Files:**
- Create: `apps/api/src/hiring/candidates.service.ts`, `candidates.controller.ts`
- Wire module + route-coverage
- Extend: `hiring-desk.test.ts`

**Endpoints:**
- `GET /candidates` — `candidates.read` (omit phone/email unless `candidates.read_pii`)
- `POST /candidates` — `candidates.create` `{ fullName, phone?, email?, resumeText? }` — if resumeText and no phone, run `extractPhonesFromText` and set first phone
- `GET /candidates/:id` — PII gated same way
- `PATCH /candidates/:id` — `candidates.update`

Sensitive: audit `candidates.read_pii` when returning phone/email (use existing sensitive permission auditing).

- [ ] **Step 1:** Tests for create with resumeText → phone filled; list without PII hides phone
- [ ] **Step 2:** Implement
- [ ] **Step 3:** Commit `feat(api): candidates CRUD with resume phone extract`

---

### Task 5: Assign candidate to job

**Files:**
- Extend hiring services/controllers
- `POST /jobs/:jobId/candidates` — `{ candidateId }` → `job_candidates` row status `new`
- `GET /jobs/:jobId/candidates` — list with candidate summary
- `PATCH /jobs/:jobId/candidates/:candidateId` — status `new|screening|reviewed`

Permissions: `jobs.update` for assign/status; `candidates.read` to see names.

- [ ] **Step 1:** Failing tests assign + list + status
- [ ] **Step 2:** Implement unique constraint conflict → 409
- [ ] **Step 3:** Commit `feat(api): assign candidates to jobs`

---

### Task 6: Link screening result for review (no Exotel)

**Files:**
- Modify: voice session start OR a thin `POST /jobs/:jobId/candidates/:candidateId/attach-session` 
- Prefer: when starting a **demo/test voice session** from UI later, pass `businessContext: { jobId, candidateId }`; for P1 add `GET /jobs/:jobId/candidates/:candidateId/results` that returns latest `voice_sessions` / agent session rows matching that context (query JSON or add nullable FKs `job_id`, `candidate_id` on `voice_sessions` if JSON query is painful)

**YAGNI choice (plan mandate):** Add nullable `job_id` + `candidate_id` columns on `voice_sessions` via migration `0017_voice_session_hiring_link.sql` + set them when startVoiceSession receives optional ids in body. Results endpoint joins those columns.

- [ ] **Step 1:** Migration + extend start voice session payload optional `jobId`/`candidateId`
- [ ] **Step 2:** `GET .../results` returns transcript/summary/structuredAnswers/costCredits (null-safe) — never invent fit %
- [ ] **Step 3:** Tests with stub voice adapter
- [ ] **Step 4:** Commit `feat(api): link voice sessions to job candidates for review`

---

### Task 7: Web desk UI (visual reference)

**Files:**
- `apps/web/app/jobs/page.tsx`, `apps/web/app/jobs/[id]/page.tsx`
- `apps/web/app/candidates/page.tsx`
- Update `apps/web/app/dashboard/page.tsx` — metric-style widgets gated by permissions (jobs/candidates counts; recent assignments) deep blue CTAs
- `apps/web/lib/api.ts` — client methods
- Nav links matching mock: Jobs, Candidates (Calls can stub “Coming soon” disabled)

Copy: “ai voice agent” tone; no vendor names; no hire advice on review panel.

- [ ] **Step 1:** API client + jobs list/create pages
- [ ] **Step 2:** Candidate create (resume textarea) + assign on job detail
- [ ] **Step 3:** Review panel on job candidate row (fetch results)
- [ ] **Step 4:** Dashboard widgets permission-gated
- [ ] **Step 5:** Grep `apps/web/app` for elevenlabs|exotel|gemini — only integrations path allowed
- [ ] **Step 6:** Commit `feat(web): hiring desk jobs candidates and review UI`

---

### Task 8: P1 verification

- [ ] `pnpm --filter @platform/api exec vitest run test/hiring-desk.test.ts test/phone-extract.test.ts test/phase-boundary.test.ts`
- [ ] API + web typecheck
- [ ] Optional full API suite
- [ ] Fixups only; no Exotel
- [ ] Commit fixups if any

---

## Spec coverage

| Spec P1 item | Task |
|--------------|------|
| Contacts | 4 (candidates) |
| Resume → phone | 2, 4 |
| Job/Task | 3, 5 |
| Result review | 6, 7 |
| Default widgets | 7 |
| Privacy / RLS | 1, 4 PII |
| No Exotel | Out of plan |

## Out of scope

Exotel, inbound/outbound live calls, fit-% model scoring, custom roles, subscriptions billing table, OCR PDF parse (text paste only).
