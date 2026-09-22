# Architecture contract — hiring product (freeze)

> **Status:** V1 PRODUCT FREEZE (2026-09-17 ChatGPT-as-PO). Coding only after human approval of this contract.  
> **Branch:** `feat/p0-pack-hiring-wizard`  
> **Research pack:** `docs/superpowers/specs/2026-09-17-hiring-po-research-pack.md`  
> **PO thread:** https://chatgpt.com/c/6aab8429-88b8-83ee-9071-27e2999e4bf2

## Non-negotiable rules

1. Reusable **Agent** — no JD / must-ask on agent create.  
2. **Job** owns JD, must-ask, criteria, language, candidate list.  
   HR configures JD **once on the Job**. Opening that Job → upload candidates → Call — **never** re-select JD/Job/Agent for intake or outbound. Call resolves Job → JD + questions + Agent automatically.  
3. **Jobs-first** UX; Agents secondary/admin.  
4. **Candidates are Job-scoped** — upload CSV/resume or add manually under that Job. No org-wide reuse; no CandidateAssignment in V1. Uniqueness `(job_id, normalized_phone)`.  
5. **Conversation chat** is primary post-call UI — Ask AI + Request callback + Listen.  
6. **Callback** = immediate new VoiceSession (same Candidate); one-off questions; no schedule in V1.  
7. **Alignment % only** — never hire/reject advice. Default weights 40/25/20/10/5.  
8. **Freeze config onto VoiceSession** at call start (JD, must-ask, scores, language, agent version).  
9. **Multi-pack** — Session / Agent / Knowledge stay pack-agnostic; hiring is Pack 1.  
10. **No vendor names** in customer UI; providers behind adapters.  
11. **Org tenant boundary** + RLS/authz.  
12. Language: **English default**; **Hindi** optional when Job enables; no arbitrary switch.  
13. **Human transfer** in V1 — Agent default number; Job may override.  
14. Retention: **90 days**; Admin-only early delete.  
15. Retry: **HR-triggered** only. Demo: **browser** only (Agent + Job preview).  
16. External job boards (LinkedIn/Naukri/career site) are **OUT of V1** — HR posts elsewhere; our app starts at Job create + intake.  
17. Intake: **manual + intelligent bulk** (CSV/XLSX/ZIP resumes/paste) → normalize to candidate JSON; preferred schema passes through; missing required fields highlighted in review table before commit; duplicate phone **within Job = block row**.  
18. Migration: delete orphan candidates (no job link); legacy NULL phone allowed; NEW requires phone + country_code (legacy default `+91`); `screening_status` on Candidate; keep `job_candidates` read-only archive one release.

## Domain

```text
Organization
  ├── Admin + Recruiters (fixed V1 roles)
  ├── Agent (persona, voice, company knowledge, default transfer)
  └── Job
        ├── JD / knowledge, must-ask, criteria, language, optional transfer override
        └── Candidates (job_id required)
              └── VoiceSessions → Conversation, Summary, Alignment, Recording, ReviewChat
```

## Nav (V1)

Jobs → Agents → Analytics → Settings  
**Absent:** Applications, career portal, candidate directory, provider/LLM UI.

## Slices (dependency order)

1. Org + Agent foundation (+ browser demo)  
2. Job + screening config (+ Job preview)  
3. Candidate intake + outbound call  
4. Session + Conversation + Ask AI  
5. Callback + transfer + permissions  

## KEEP / REFACTOR

**KEEP:** Auth/org/RBAC/RLS, Agent versions, knowledge pipeline, packs registry, voice adapters, telephony guards, ops/smoke/KYC path.  

**REFACTOR before/with Slice 3:** Align storage to Job-scoped Candidates (retire cross-job assign UX). Move must-ask/JD off agent create onto Job.  

**Storage note (PO Task 1):** Migration `0018_job_scoped_candidates` — `candidates.job_id` NOT NULL, `screening_status`, `country_code` (legacy default `+91`); unique `(job_id, phone)`; orphans deleted; `job_candidates` kept read-only archive (no new writes).  

**DELETE (V1 product):** Agent-owned role JD/must-ask as primary path; CandidateAssignment; cross-job candidate merge; scheduled callback; auto-retry.

## Enforcers

**Allowed without re-opening freeze:** Exotel KYC/ops, non-domain bugfixes, tests, docs that match this contract.  

**Forbidden:** Inventing behavior for checklist rows; coding ownership moves without human approval of this freeze + research pack.

## Related

- Full checklist + invariants: `docs/superpowers/specs/2026-09-17-hiring-po-research-pack.md`  
- Prior plan (needs rewrite to match Job-scoped Candidate): `docs/superpowers/plans/2026-09-17-job-owned-screening.md`
