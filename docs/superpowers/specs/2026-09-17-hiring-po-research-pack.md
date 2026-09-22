# Hiring PO research pack (2026-09-17)

> **Status:** V1 PRODUCT FREEZE (ChatGPT-as-PO)  
> **Thread:** https://chatgpt.com/c/6aab8429-88b8-83ee-9071-27e2999e4bf2  
> **Contract:** `docs/ARCHITECTURE.md`  
> **Rule:** Cursor must not invent behavior for any row below.

## Founder → frozen mapping

| Founder ask | Frozen decision |
|-------------|-----------------|
| Reusable HR agent across roles | Agent has no JD/must-ask; Job owns them |
| Questions not on agent create | Job owns must-ask |
| Jobs-first | Nav: Jobs → Agents → Analytics → Settings |
| B2B only, no portal | No candidate login / apply |
| Upload or add candidates; no cross-job reuse | Job-scoped Candidate; `(job_id, phone)` unique |
| Post-call as normal chat | Conversation primary UI |
| Ask follow-ups to agent | SessionReviewChat + grounding |
| Callback with follow-up Qs | Immediate new VoiceSession; one-off Qs |
| Multi-call history | Newest first; listen + summary + alignment |
| Real screening quality | Weighted criteria; not location-only |
| No hire advice | Alignment % only |
| Multi-pack / don’t couple core | Session/Agent/Knowledge stay generic |
| English mainly | English default + Hindi optional on Job |
| Transfer to human | Agent default number; Job may override |
| Demo conversation | Browser demo on Agent + Job preview |
| Subscription / analytics | Basic V1; advanced later |
| Admin + roles | Admin + Recruiter fixed; custom roles later |

## Domain (hiring pack V1)

```text
Organization → Job → Candidates (job_id required) → VoiceSessions
Agent (reusable) linked from Job
SessionReviewChat on VoiceSession
```

**Deleted for V1:** CandidateAssignment, org-wide candidate directory, cross-job assign/merge, scheduled callbacks, auto-retry, phone demo, custom role builder.

## FROZEN V1 CHECKLIST

| Topic | Frozen V1 decision |
|-------|-------------------|
| Product model | Multi-pack; Hiring = Pack 1 |
| Candidate | Job-scoped |
| Cross-job reuse | Out |
| CandidateAssignment | Out |
| Intake | CSV/resume upload + manual |
| Self-apply / login | Out |
| Callback | Immediate only |
| Scheduled callback | Out of V1 (immediate only) |
| Callback architecture | Same Candidate + new VoiceSession |
| Callback questions | One-off on session |
| Permissions | Admin + Recruiter, fixed |
| Call / Callback / Ask AI / Listen | Permission-controlled |
| Alignment | 100-pt weighted (40/25/20/10/5 default) |
| Hire/reject recommendation | Never |
| JD / must-ask / agent versioning | Freeze onto VoiceSession at call start |
| Language | English default; Hindi optional; no arbitrary switch |
| Human transfer | In — Agent default, Job override |
| Agent demo | Browser |
| Job demo | Browser with Job context |
| Phone demo | Out |
| Subscription + agent limits | Basic V1 |
| Analytics | Basic operational |
| Advanced analytics / billing | Later |
| Org Admin | One Admin |
| Custom role builder | Later |
| Role-aware widgets | In |
| Resume | Store file + extract fields; usable in Ask AI |
| Call failure | Visible Failed |
| Retry | HR-triggered only |
| Conversation | Chat-style primary post-call view |
| Retention | 90 days; Admin early delete; auto-delete |
| Tenant isolation | Organization boundary |
| Historical sessions | Immutable |
| Demo data | Isolated from production |
| Primary navigation | Jobs → Agents → Analytics → Settings |
| HLD/LLD constraint | Preserve pack-agnostic Session/Agent/Knowledge |

## Coding order (PO 2026-09-17 — start here)

1. **Migrate Candidate to Job scope** — DONE (`0018_job_scoped_candidates`; `job_id` required; unique `(job_id, phone)`; no new `job_candidates` writes; orphans deleted; NEW requires phone + country_code)  
2. **Job-owned screening** — DONE: Job owns questions/language/JD knowledge; agent create stripped; provision/fit prefer Job; no JD reselect on upload/call (`0019_job_owned_screening`)  
   - Follow-up PO (2026-09-17):  
     - **Q1** DONE — Agent detail has no must-ask / knowledge attach (persona/voice/transfer only)  
     - **Q2** = **B** DONE — freeze full provision snapshot onto each VoiceSession at call start (`0020_voice_session_provision_snapshot`); not separate deployments per Job  
     - **Q3** DONE — one-shot migrator baked agent JD/questions → Jobs (`0021_backfill_job_screening_from_agents`; re-run `pnpm db:backfill-job-screening` / `scripts/backfill-job-screening.mjs`)  
3. **Intelligent intake + outbound** — DONE for CSV/paste preview→confirm under Job (`/jobs/:id/candidates/import/*`). Job path context supplies JD — never ask HR to reselect JD on upload/call. Outbound call on Job is in MVP (same Job→agent resolve).

External board posting OUT of V1. Preferred candidate JSON required: `full_name`, `country_code`, `phone`.

## MVP slices still in flight (not deferred)

4. **Session + Conversation + Ask AI** — in progress  
5. **Callback + transfer + permissions** — in progress  

## Dangerous invariants (must appear in HLD/LLD)

1. Org tenant isolation for all hiring artifacts  
2. VoiceSession config snapshot immutability  
3. Ask AI grounding + source attribution (call vs resume vs JD)  
4. Alignment ≠ hiring decision  
5. Simple lifecycle: Imported → Not called → Calling → Done | Failed → Retry  
6. Call request idempotency (no duplicate sessions on refresh)  
7. Sensitive data access + retention/deletion  
8. Agent version pinned on session  
9. Demo never becomes production screening  
10. Callback inherits Job+Candidate automatically  

## Retention note

90-day default is a **product** default. DPDP erasure/retention obligations may require customer-specific policy later; V1 ships Admin delete + auto-expiry.

## Next gate

Human approval of this freeze → then HLD/LLD doc → then Slice 1 code. No blind coding.
