# Hiring Production Launch — Product Design

**Date:** 2026-09-16  
**Status:** Active (goal-driven)  
**Branch:** `feat/p0-pack-hiring-wizard`  
**Working name:** ai voice agent  

## 1. Intent

Ship a **production-ready hiring phone-agent product** for Indian businesses. A recruiter who has never seen our architecture must complete: understand product → sign up → create hiring agent → add docs → demo → screen candidates by phone → review results.

**Not day-one:** Support/Sales/Appointments/Reminders packs as full products; customer webhooks; MCP connectors for embedding in third-party apps. Those reuse this spine later.

**Hard rules**
- No MVP / prototype / fake data presented as done.
- Nothing fake: missing metrics → unavailable/null, not zeros.
- No vendor names in product UI (ElevenLabs, Exotel, Gemini stay in adapters/env).
- Never recommend hire/reject — show transcript, summary, structured answers, fit % only when real.
- Plain language. No API paths, no Markdown-as-user-workflow.
- Privacy: org RLS + permission gates remain authoritative.

## 2. Users & jobs-to-be-done

| User | Job |
|------|-----|
| Hiring owner / recruiter | Screen candidates by phone without juggling scripts manually |
| Admin (same person early) | Create company, invite teammates later |
| Candidate | Receives a normal phone call; never uses our dashboard |

## 3. End-to-end journey (must work)

1. **Landing** — mock-faithful marketing (`/`). CTAs: Get started, Sign in.
2. **Signup** — creates user + **company automatically** (or one plain “Company name” field). Single-org users never see an org switcher.
3. **Dashboard** — hiring metrics from real data; deep blue desk chrome.
4. **Create hiring agent** — wizard; upload **PDF / Word / PPT**; questions; transfer numbers; English default.
5. **Demo** — labeled demo conversation (browser voice acceptable as demo; clearly not a live campaign).
6. **Jobs + candidates** — create job, add candidates (paste **or** resume file), assign, start screening.
7. **Live outbound phone** — real number, real call (telephony port / Exotel when credentials present; clear blocked state if not configured — never pretend).
8. **Review** — transcript / summary / answers / cost when present.

## 4. UX bar

- Not “HTML form builder”: intentional type, color tokens from mock (white, deep blue `#1e40af`-family, dark sidebar), motion sparingly.
- Human errors only (“Create or open your company first”) — never `POST /auth/switch-organization`.
- Calls / Analytics may say “Coming soon” only if not yet shipping; prefer shipping Calls list for hiring screens first.

## 5. Document uploads

| Surface | Formats |
|---------|---------|
| Agent knowledge | PDF, DOCX, PPTX (+ keep txt/md for power users) |
| Candidate resume | PDF, DOCX (+ paste text still works) |

Extract text server-side; index via existing knowledge pipeline; phone extract from resume text after parse.

## 6. Architecture stance (hiring now, future-safe)

- Keep Nest API + Next web + Drizzle/Postgres RLS.
- Voice/telephony behind existing ports/adapters.
- New parsers isolated (`knowledge/parsers/` or `hiring/resume-parse.ts`).
- Subscription limits: enforce existing agent quota; surface clear limit messages.
- **Do not hard-code “hiring-only” into the core model** — hiring is the first *pack* on a shared spine (already started via `agentType` / packs registry).

## 6b. Future iterations — design the seams now, build later

Day-one ships **hiring**. Architecture must not force a rewrite when we add:

| Later creation | What customers get | Spine rule today |
|----------------|--------------------|------------------|
| Support / sales / appointments / reminders packs | New wizard fields + result schemas | Packs registry only; no hiring tables inside core agent/call |
| Customer **webhooks** | Their backend gets call.completed, result.ready | Domain events at call/result boundaries; no UI coupling |
| **MCP** / embed in their apps | Tools + context for external agents | Stable org-scoped APIs + tool catalogue; MCP is a façade later |
| Inbound lines / campaigns | Phone work beyond single outbound | Job/task remains the work unit; direction on call session |
| Billing / seats / pack unlocks | Limits by plan | Quota checks already at agent create; generalize meters later |

**Stable domain nouns (do not rename for hiring slang in the DB):**
Organization → Agent (typed by pack) → Knowledge → Contact → Job/Task → Call/Session → Result → Transfer target.

Hiring maps: Contact≈candidate, Job≈open role, Result≈screening packet. Support later maps Contact≈ticket user, Job≈queue — **same tables or pack-scoped extensions**, not a second product core.

**Event boundary (stub interfaces OK, real bus later):**  
`call.started | call.ended | result.ready | transfer.requested` — payload = orgId + ids + pack id. Webhooks/MCP subscribe to these; hiring UI reads DB.

**Anti-patterns to avoid while building hiring:**
- Columns/APIs named only `candidate_*` on shared call tables (use generic + hiring join).
- Business logic that `if (hiring)` branches across the whole API (pack modules instead).
- Vendor SDKs outside adapters.
- Shipping fake webhook/MCP UI.

## 7. Production readiness checklist (Definition of Done)

- [x] Research & product definition (this doc)
- [x] Architecture locked for hiring loop
- [x] Design (visual + flows) implemented
- [x] Development complete for journey §3 (browser demo + honest phone-blocked until telephony credentials)
- [x] Automated tests for critical paths (`apps/api` 517 passing)
- [x] Security review (authz, PII, no vendor leak in UI copy; route markers complete)
- [x] Performance sanity (upload size limits 10 MB, Fastify bodyLimit 15 MB)
- [x] UX review against mock + newcomer path (landing live; desk AppShell; human errors)
- [x] Deployment readiness (env, migrate, health, rollback notes in plan)
- [ ] Final audit: would a real company run this?
  - Product loop: yes (landing→signup→desk→wizard docs→jobs/candidates→browser+phone screen→review transcript/summary).
  - Live AI phone: verified on Voicebot App `1342474` with desk transcript; **550/550** API tests.
  - Call recording playback: `GET …/voice-sessions/:id/recording` (`calls.read_recording`) + desk/Calls `<audio>`; one-question-at-a-time provision prompt; wizard Done shows browser demo after publish.
  - Multi-call review: job candidate results return `sessions[]` newest-first with listen/summary/answers/transcript; **fit %** = share of must-ask answers collected (null when no criteria — option B); never hire advice.
  - Review ask + Request another call: shipped (job review “Ask about this screen” + “Request another call”).
  - Ops remaining: Exotel **KYC** (Company Info → Start Business Verification → **PAN**) for open outbound to arbitrary resume numbers; optional remote VPS staging.
  - Post-call answers: must-ask → provider `data_collection` + prompt (2026-09-16); webhook HMAC uses raw body bytes.
  - Phone tools: voicemail detection + optional human transfer from wizard numbers on provision.
  - Dial failures: carrier/KYC blocks map to plain copy (no vendor names); covered by `outbound-dial-message` tests.
  - Recruiter screens: job outbound + telephony + browser screen accept `calls.initiate` (recruiters) or `agents.test` (agent builders); job list returns phone when `candidates.read_pii`.
  - Transcript ACL: `calls.read_transcript` required for transcript/summary/answers on job results and voice-session GET/list (analysts see status only).
  - Compose: `ELEVENLABS_*` passed to api; web `GET /api/health` + compose healthcheck.
  - Hiring agent detail: screening summary + Jobs/Candidates/Calls links; builder chrome (tools/sessions/JSON) only with `agents.update`; dashboard quick links prioritize Jobs.
  - Job desk: inline mobile save; Calls page polls live sessions + Refresh results; wizard Done can Publish agent; CI runs web production build.
  - Review panel polls while screen is pending/active; candidates list supports inline mobile save; web `next build` verified green.

### Objective evidence (2026-09-16)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Marketing landing (mock-faithful) | DONE | Brand-first full-bleed hero (no overlays); use-case tiles; India desk band; 5-step how-it-works; footer CTA; hero SVG cleaned of colliding labels |
| Signup → auto company, no org jargon | DONE | Login register + `createOrganization`; switcher hidden for single org; invite roles human-labeled |
| Polished desk UX | DONE | AppShell on dashboard/jobs/candidates/knowledge/agents/tools/calls; advanced agent settings collapsed; mobile Menu bar &lt;800px |
| Wizard + PDF/DOCX/PPTX uploads | DONE | Wizard multi-file upload + attach; knowledge + resume parsers; PDF/DOCX/PPTX extract tests green |
| Candidates/jobs/assign/review | DONE | Hiring desk; multi-call results newest-first + recording + fit % when must-ask set; resume `0`-prefix → `+91` |
| Demo voice | DONE | Browser demo labeled; ConversationProvider fix; live token walkthrough |
| Live outbound phone screening | DONE | Voicebot App ID `1342474` + EL wss URL; DID `phnum_7301m2na9tpcff28h1sz1tdktrkj`. Live Call phone to `+918919504427`: Exotel `AnsweredBy=human`, EL `stream_sid`, **20-turn transcript** in desk (voicemail greeting — AI spoke). Trial still limits open resume dialing until KYC. |
| Transcripts/summaries/answers; no hire advice; no vendor UI names | DONE | ReviewPanel + Calls; pack copy; vendor names only in adapters/imports |
| Security/RLS/authz | DONE | Tenant isolation + route-coverage + production-boundary tests |
| Tests / observability / deploy readiness | DONE | **550/550** API tests green (2026-09-16); OTEL optional; CI workflow; Docker image health `{"status":"ok"}`; web production build. Remote VPS staging optional. Webhook HMAC uses raw body bytes. |
| Packs/webhooks/MCP later | DONE | Only hiring+custom packs exposed; no webhook/MCP UI |

**Cannot mark goal complete** until Exotel KYC unlocks open outbound to arbitrary resume numbers (trial whitelist is not production) — product AI phone path is verified on the verified test mobile. Ops path: Company Info → Start Business Verification → enter PAN → Verify PAN.

**Fresh ops check (2026-09-17 ~00:26 IST):** Exotel still **KYC=notstarted**. `GET /health` now reports readiness (email/storage/voice/openOutbound). `pnpm ops:check` PASS with expected warnings (console mail, local storage, openOutbound off). Prior desk/deploy gaps closed. After PAN: `TELEPHONY_OPEN_OUTBOUND=true` + restart API.

## 8. Explicit non-goals (later layers)

Customer support pack, sales pack, inbound-heavy clinic flows, public webhooks, MCP server for external apps, custom roles UI, OCR cloud SaaS beyond local/library parse.
