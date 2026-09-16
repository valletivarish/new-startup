# MVP-01 ElevenLabs Browser-Voice — Completion Report

**Checkpoint commit:** d35e7e9 (chore: checkpoint platform before ElevenLabs MVP)  
**Completion date:** 2026-09-15

---

## 1. Objective

Implement browser-voice test sessions using ElevenLabs WebRTC for published agents, with full cost guards, audit trails, webhook processing, and result storage — without breaking any existing platform invariants.

---

## 2. Architecture Decisions Made

| Decision | Choice | Rationale |
|---|---|---|
| Browser transport | `@elevenlabs/react` + WebRTC via conversationToken | Zero-latency browser call; server never sees audio |
| LLM | Gemini Flash-Lite through ElevenLabs | Verified at provision time; STOP if unavailable |
| Knowledge | Strategy A — sync text snapshot to ElevenLabs KB | No live RAG latency; agent self-contained |
| Auth | Private agent + server-issued token | API key never exposed to browser |
| Results | Webhook + reconciliation fallback | Tolerant of webhook delivery delays |
| Kill switch | `ELEVENLABS_ENABLED=false` default | Zero spend, zero error when not configured |

---

## 3. Files Changed / Created

### New — Database
| File | Description |
|---|---|
| `packages/db/drizzle/0013_elevenlabs_foundation.sql` | Tables: voice_provider_deployments, voice_sessions |
| `packages/db/drizzle/0014_elevenlabs_rls.sql` | ENABLE+FORCE RLS, grants |
| `packages/db/src/schema/voice.ts` | Drizzle ORM schema for the two tables |

### Modified — Database
| File | Change |
|---|---|
| `packages/db/drizzle/meta/_journal.json` | Added entries idx 13, 14 |
| `packages/db/src/schema/index.ts` | Exported voice tables; added VOICE_TABLES constant |

### New — API
| File | Description |
|---|---|
| `apps/api/src/providers/elevenlabs/types.ts` | Normalized types (VoiceDeployment, VoiceSessionResult, etc.) |
| `apps/api/src/providers/elevenlabs/client.ts` | ElevenLabs SDK factory (lazy, key-guarded) |
| `apps/api/src/providers/elevenlabs/adapter.ts` | Live adapter + stub for tests; VoiceSessionAdapter interface |
| `apps/api/src/providers/elevenlabs/voice-session.service.ts` | Business logic, cost guards, DB operations |
| `apps/api/src/providers/elevenlabs/voice.controller.ts` | 5 endpoints with permission markers |

### Modified — API
| File | Change |
|---|---|
| `apps/api/src/config.ts` | 7 new ElevenLabs env vars with Zod validation |
| `apps/api/src/tokens.more.ts` | VOICE_SESSION_ADAPTER, VOICE_SESSION_SERVICE tokens |
| `apps/api/src/app.module.ts` | Wired adapter + service; registered 3 new controllers; added `voiceAdapter` override for tests |
| `apps/api/src/server.ts` | Pass `voiceAdapter` override from BuildOverrides to AppModule |

### New — Web
| File | Description |
|---|---|
| `apps/web/src/integrations/elevenlabs/VoiceTestPanel.tsx` | React component using @elevenlabs/react; isolated to this directory |

### Modified — Web
| File | Change |
|---|---|
| `apps/web/lib/api.ts` | Added voice session API functions (provisionVoiceDeployment, startVoiceSession, getVoiceSession, reconcileVoiceSession) |
| `apps/web/app/agents/[id]/page.tsx` | Added VoiceTestPanel to the agent detail page |

### Modified — Tests
| File | Change |
|---|---|
| `apps/api/test/production-boundary.test.ts` | Added VENDOR_ADAPTER_DIRS; exempts elevenlabs in adapter dirs; updated benchmark SDK check |
| `apps/api/test/phase-boundary.test.ts` | Removed ElevenLabs from FORBIDDEN list; added per-package allowlist; positive assertion that SDKs ARE in lockfile |
| `apps/api/test/route-coverage.test.ts` | Added 3 new controllers; updated public routes allowlist |
| `apps/api/test/setup/api-harness.ts` | Added voiceAdapter parameter to startApi |

### New — Tests
| File | Description |
|---|---|
| `apps/api/test/elevenlabs-voice.test.ts` | Integration tests: kill switch, authz, cross-tenant, cost guards, deployment, sessions, reconcile, webhook, null cost |

### Other
| File | Change |
|---|---|
| `.env.example` | Added ELEVENLABS_* placeholders; removed duplicate ELEVENLABS_API_KEY from benchmark section |
| `MVP_01_ELEVENLABS_COMPLETION.md` | This document |

---

## 4. DB Schema

### `voice_provider_deployments`
Maps a published `agent_version_id` → ElevenLabs agent. One row per `(agent_version_id, provider, environment)`.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid FK organizations | Cascade delete |
| agent_version_id | uuid FK agent_versions | RESTRICT delete |
| provider | text | Always 'elevenlabs' for MVP-01 |
| environment | text | 'test' or 'production' |
| external_agent_id | text | ElevenLabs agent ID |
| external_kb_doc_id | text nullable | ElevenLabs KB document ID |
| llm_model | text nullable | Verified LLM slug |
| llm_verified_at | timestamptz nullable | When last verified |
| created_at / updated_at | timestamptz | |

### `voice_sessions`
Maps a local `agent_sessions` row → ElevenLabs conversation + results.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid FK | |
| session_id | uuid FK agent_sessions | RESTRICT; one-to-one (unique) |
| deployment_id | uuid FK voice_provider_deployments | RESTRICT |
| provider | text | 'elevenlabs' |
| external_conversation_id | text nullable | Set when WebRTC connects |
| status | text | pending → active → ended / failed |
| transcript | jsonb nullable | Array of TranscriptTurn |
| summary | text nullable | Paragraph summary |
| structured_answers | jsonb nullable | Key-value agent output |
| duration_seconds | integer nullable | Call length |
| cost_credits | numeric(12,6) nullable | Nullable — observation not guarantee |
| started_at / ended_at | timestamptz | |
| webhook_received_at | timestamptz nullable | When last webhook arrived |
| created_at | timestamptz | |

RLS: ENABLE + FORCE on both tables; `platform_app` granted SELECT/INSERT/UPDATE on both; DELETE revoked from `voice_sessions` (append-only for audit).

---

## 5. API Endpoints

| Method | Path | Permission | Description |
|---|---|---|---|
| POST | /agents/:id/voice-deployments | agents.deploy | Provision / re-sync ElevenLabs agent |
| POST | /agents/:id/voice-sessions | agents.test | Start test session; returns conversationToken |
| GET | /agents/:id/voice-sessions/:vsId | agents.sessions.read | Get session state |
| POST | /agents/:id/voice-sessions/:vsId/reconcile | agents.sessions.manage | Pull results from ElevenLabs |
| POST | /webhooks/elevenlabs | @Public (HMAC-verified) | Receive ElevenLabs events |

---

## 6. Cost Guards

Enforced in `voice-session.service.ts` at session-start time:

1. **Kill switch** — `ELEVENLABS_ENABLED=false` → 403 Forbidden on any voice endpoint.
2. **1 active session per org** — `count(*) filter (where status = 'active') >= 1` → 409 Conflict.
3. **Daily session cap** — `ELEVENLABS_DAILY_TEST_SESSIONS` (default 10). Checked at start.
4. **Daily minute cap** — `ELEVENLABS_DAILY_TEST_MINUTES` (default 30). Checked at start.
5. **No auto-start** — the UI requires explicit user confirmation (cost warning modal).
6. **Max session length** — `ELEVENLABS_MAX_TEST_MINUTES` (default 5) is communicated to the UI; enforcement via ElevenLabs agent configuration in future iterations.

---

## 7. LLM Availability Check

The adapter calls `client.conversationalAi.llm.list()` before any provisioning and searches for a model matching `gemini-3.5-flash-lite`. If the model is not found, the provision call **throws and reports** rather than silently substituting another model. This is an explicit design constraint: no silent substitute.

---

## 8. Knowledge Strategy

Strategy A: the caller may pass a `knowledgeSnapshot: { name, content }` to the provision endpoint. The adapter calls `client.conversationalAi.knowledge.createKnowledgeBaseDocument(...)` and links the resulting document ID to the ElevenLabs agent's prompt configuration. No live RAG tool is exposed; the agent is self-contained for the duration of the deployment.

---

## 9. Webhook Processing

- **Endpoint:** `POST /webhooks/elevenlabs` — `@Public`.
- **Verification:** HMAC-SHA256 over the request body using `ELEVENLABS_WEBHOOK_SECRET`. Verified in the controller before the payload is dispatched to the service.
- **Supported events:** `conversation.ended` (→ status=ended), `conversation.started` (→ status=active). Unknown events are silently ignored.
- **Known limitation:** Fastify JSON-parses the body before the handler runs. The controller re-serializes the body for HMAC verification. This is safe for flat JSON payloads without ordering semantics. Production hardening: register `@fastify/raw-body` plugin to preserve the original bytes.

---

## 10. Idempotency

- **Provision:** upsert on `(agent_version_id, provider, environment)` — re-calling updates the external agent and returns the same DB row.
- **Webhook:** `conversation.ended` events are applied with `WHERE status <> 'ended'` — duplicates are no-ops.
- **Reconcile:** safe to call multiple times; already-ended sessions with a full transcript are returned immediately without re-fetching.

---

## 11. Provider Isolation

The ElevenLabs SDK (`@elevenlabs/elevenlabs-js`) is imported **only** in:
- `apps/api/src/providers/elevenlabs/client.ts`

The `@elevenlabs/react` package is imported **only** in:
- `apps/web/src/integrations/elevenlabs/VoiceTestPanel.tsx`

No other production file references the vendor name. The `production-boundary.test.ts` test enforces this with a per-file allowlist (`VENDOR_ADAPTER_DIRS`). The `phase-boundary.test.ts` test verifies the SDKs are in the expected packages and absent from all others.

---

## 12. DI Tokens

| Token | Symbol | Bound to |
|---|---|---|
| VOICE_SESSION_ADAPTER | Symbol('VOICE_SESSION_ADAPTER') | `createVoiceSessionAdapter` (live) or `createStubVoiceSessionAdapter` (disabled/test) |
| VOICE_SESSION_SERVICE | Symbol('VOICE_SESSION_SERVICE') | `createVoiceSessionService` |

---

## 13. Environment Variables

All default to OFF/empty so a misconfigured process never spends money.

| Variable | Default | Required when enabled |
|---|---|---|
| ELEVENLABS_ENABLED | false | — |
| ELEVENLABS_API_KEY | '' | Yes |
| ELEVENLABS_WEBHOOK_SECRET | '' | Yes |
| ELEVENLABS_DEFAULT_VOICE_ID | '' | No (falls back to 'Rachel') |
| ELEVENLABS_MAX_TEST_MINUTES | 5 | No |
| ELEVENLABS_DAILY_TEST_SESSIONS | 10 | No |
| ELEVENLABS_DAILY_TEST_MINUTES | 30 | No |

Zod `superRefine` in `config.ts` requires `ELEVENLABS_API_KEY` and `ELEVENLABS_WEBHOOK_SECRET` when `ELEVENLABS_ENABLED=true`. The process refuses to boot without them.

---

## 14. Web UI (VoiceTestPanel)

Located at `apps/web/src/integrations/elevenlabs/VoiceTestPanel.tsx`. Included on the agent detail page for users with `agents.test` permission, when the agent is published.

States:
- `idle` → shows "Start Voice Test" button
- `confirming` → cost warning modal with explicit confirmation
- `connecting` → waiting for WebRTC handshake
- `active` → call in progress; "End Call" button
- `ending` → awaiting result
- `ended` → transcript, summary, cost, structured answers displayed
- `error` → error message

---

## 15. Test Coverage

| Category | Test count | Approach |
|---|---|---|
| Kill switch | 1 | Real app, feature off |
| Authorization | 3 | Unauthenticated, no-org; unknown session → 404 (not 403) |
| Cross-tenant isolation | 2 | Org B cannot read Org A; forged ID → 404 |
| Deployment | 3 | Provision, re-provision (idempotent), draft agent → 409 |
| Start session | 2 | Happy path; concurrent session → 409 |
| Get result | 2 | Happy path; unknown ID → 404 (valid UUID v4 fixtures) |
| Reconcile | 1 | No-op when no external conversation ID (`@HttpCode(200)`) |
| Webhook | 4 | Missing sig → 422; bad sig → 422; valid → 200; unknown conv → 200 |
| Null cost | 1 | costCredits is null |

All tests use the real NestJS/Fastify/PostgreSQL stack (Testcontainers) with the stub adapter injected — no live ElevenLabs network calls, no credits spent.

**Verified (2026-09-15):** `vitest` — `elevenlabs-voice` (19), `production-boundary` (6), `phase-boundary` (13), `route-coverage` (121) → **159/159 passed**. `tsc --noEmit` clean for `@platform/api` and `@platform/web`.

---

## 16. Operator Smoke-Test Steps

```
# 1. Set credentials in .env
echo 'ELEVENLABS_ENABLED=true' >> .env
echo 'ELEVENLABS_API_KEY=<your-key>' >> .env
echo 'ELEVENLABS_WEBHOOK_SECRET=<webhook-signing-secret>' >> .env

# 2. Run migrations (against your dev database)
pnpm -C packages/db migrate

# 3. Start the API
pnpm -C apps/api dev

# 4. Start the web app
pnpm -C apps/web dev

# 5. Create or open a published agent at http://localhost:3000/agents/<id>

# 6. The "Voice Test" panel is now visible.
#    Click "Start Voice Test" → acknowledge cost warning → call begins.

# 7. Speak to the agent. It will respond via ElevenLabs WebRTC audio.

# 8. Click "End Call". The panel polls for results and displays transcript.

# 9. Optional: re-provision with a knowledge snapshot via API
POST /backend/agents/<id>/voice-deployments
{ "knowledgeSnapshot": { "name": "FAQ", "content": "Q: ... A: ..." } }

# 10. Optional: trigger reconcile manually
POST /backend/agents/<id>/voice-sessions/<vsId>/reconcile
```

---

## 17. Known Limitations / Future Work

1. **Raw body webhook verification** — Fastify re-serializes the body for HMAC. Register `@fastify/raw-body` for byte-perfect verification in production.
2. **Session max-time enforcement** — `ELEVENLABS_MAX_TEST_MINUTES` is communicated to the UI but not enforced server-side. Add a timer-based auto-end job.
3. **Structured answers extraction** — `structuredAnswers` is stored as NULL; the ElevenLabs API needs a data collection config on the agent. Wire in a future iteration.
4. **Production environment** — only `'test'` environment is implemented; `'production'` environment for real calls is reserved.
5. **Webhook deduplication** — events are idempotent by DB condition but not tracked with a delivered-event log. Add an events table for strict once-delivery if needed.
6. **Knowledge snapshot TTL** — synced KB docs are never cleaned up. Add a cleanup job.
7. **Cost reporting** — `costCredits` is nullable because ElevenLabs may not report it immediately. Wire up a post-call cost fetch.

---

## 18. Invariants Preserved

All Phase 1–4 invariants are unchanged:
- No domain code (agents, knowledge, tools, organizations) imports any provider SDK.
- All new tables carry ENABLE + FORCE RLS with `organization_id = current_org_id()`.
- All new routes declare exactly one permission marker.
- The `packages/providers` package still has no runtime dependencies.
- The benchmark package is structurally separate and unchanged.
- `audit_events` records all voice lifecycle actions.
- Cross-tenant probes return 404, not 403.

---

## 19. Rollback

To roll back MVP-01:
1. Remove migrations 0013 and 0014 (`DROP TABLE voice_sessions; DROP TABLE voice_provider_deployments;`).
2. Set `ELEVENLABS_ENABLED=false` (or remove the variable) — the feature is entirely inert.
3. Revert the git commit (all new files are isolated; no domain code was modified).

---

## 20. Sign-off Checklist

- [x] DB migrations follow existing naming and format (0013, 0014)
- [x] Both tables have RLS ENABLE + FORCE
- [x] Schema exported from packages/db/src/schema/index.ts
- [x] Journal updated
- [x] ElevenLabs env vars in config.ts with Zod validation
- [x] Env vars in .env.example
- [x] SDK imported ONLY in adapter directories
- [x] `production-boundary.test.ts` updated — elevenlabs allowed only in adapter dirs
- [x] `phase-boundary.test.ts` updated — ElevenLabs SDKs allowed in api/web only
- [x] `route-coverage.test.ts` updated — all 5 new routes covered
- [x] DI tokens added to tokens.more.ts
- [x] All 3 new controllers registered in app.module.ts
- [x] VoiceTestPanel isolated to apps/web/src/integrations/elevenlabs/
- [x] lib/api.ts updated with voice session functions
- [x] Agent detail page includes VoiceTestPanel
- [x] Test file covers kill switch, authz, cross-tenant, cost guards, webhook
- [x] No live network calls in tests (stub adapter)
- [x] Cost warning in UI (no auto-start)
- [x] LLM availability verified at provision time (STOP if unavailable)
- [x] costCredits nullable throughout
