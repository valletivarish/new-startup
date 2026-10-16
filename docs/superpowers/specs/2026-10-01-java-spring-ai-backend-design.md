# Java / Spring AI Backend — Design

**Date:** 2026-10-01
**Status:** Active (implementation in `apps/api-java`, progress in `apps/api-java/MIGRATION_STATUS.md`)
**Decision record:** `BRD's/10_ADRs/ADR-008-java-spring-ai-backend.md`

## 1. Goal and non-goals

Replace the NestJS API with a Java 17 / Spring Boot 3.4 / Spring AI service **without changing the web app** (switch `API_URL`), the database, the migrations owner, the session cookie, or the permission model. Make the backend a **use-case-agnostic voice-agent engine** (hiring is the first definition), with production RAG and a per-call cost ledger.

Non-goals: new UI; new infrastructure; selecting AI/telephony vendors (still open per §D2); live calls during migration.

## 2. Module map (package `desk`)

| Package | Responsibility | Nest source |
|---|---|---|
| `desk.platform` | config, DB URL parsing, Jackson (timestamps/jsonb), error envelope, request id, rate limit, security headers, input validation helper, pagination, tenant transactions, health | `server.ts`, `errors.ts`, `http-exception.filter.ts`, `pagination.ts`, `validate.ts`, `packages/db/tenant-context.ts` |
| `desk.authz` | route markers, fail-closed interceptor, auth context resolution, permission catalogue (labels/groups), role invariants | `authz/*`, `packages/permissions` |
| `desk.auth` | Better Auth–compatible `/api/auth/*`: sign-up/in/out, reset, verify-email; scrypt; signed cookie | `auth/better-auth.ts` (Better Auth library) |
| `desk.team` | organizations, members, invitations (+copyable links, resend, preview, accept-new), custom roles, permissions catalogue | `controllers.ts`, `organizations/*` |
| `desk.audit` | audit writes (never fail the request), list, CSV export | `audit/*`, `controllers.ts` |
| `desk.notify` | `NotificationPort` (console, SMTP) | `notifications/*` |
| `desk.usecase` | `UseCaseDefinition`, registry (classpath JSON), packs view, `/use-cases` routes | `agents/packs/*` |
| `desk.agents` | agents, versions, configuration validation, lifecycle, knowledge links | `agents/*` |
| `desk.runtime` | text `AgentSession` loop (ADR-007), events, intelligence orchestrator, context builder, tools (registry, authorizer, executor, built-ins) | `agents/runtime.ts`, `intelligence/*`, `tools/*` |
| `desk.knowledge` | sources, documents, Tika extraction, chunker, processor, object storage | `knowledge/*` |
| `desk.rag` | embedding port + cache, hybrid retriever, RRF, MMR, packer, reranker flag, eval harness, metrics | `knowledge/retriever.ts` (+ new) |
| `desk.hiring` | jobs/candidates routes (exact contract), CSV import, phone extract, resume parse, JD assist, review chat, fit % — hiring-scoped glue only | `hiring/*` |
| `desk.engine` | use-case-agnostic call engine: context compiler, post-call extractor, call outcome classification, retry planner, domain events | new (was hard-coded in `voice-session.service.ts`) |
| `desk.voice` | voice sessions, deployments, webhook, telephony status; `VoiceAgentPort`/`TelephonyPort` + hosted-agent adapter + stub | `providers/elevenlabs/*` |
| `desk.cost` | rate card, cost math, ledger, budget guard, usage summary + costs + limits routes | new |

## 3. Contract parity strategy

* `apps/web/lib/api.ts` is the source of truth. Every route there is ported with the same method, path, status code, JSON shape, key order where practical, and error envelope.
* SQL mirrors Nest's: timestamps the Nest API returned as `x::text` are returned as `::text`; timestamps it returned as JS `Date` serialise as ISO-8601 `Z` strings; `jsonb` is passed through as JSON; counts are numbers.
* PATCH semantics keep the absent-vs-null distinction (JSON-tree input helper rather than records).
* Validation errors use the same envelope with the first field message promoted to `message`, in plain language, never naming vendors or API paths.
* Contract tests assert the JSON shapes per route against a real database (Testcontainers).
* Deliberate differences (each listed in `MIGRATION_STATUS.md`): console reset link never returned (security); vendor names removed from error copy; webhook org resolution fixed; new routes added (use cases, usage/costs/limits, onboarding, custom roles).

## 4. Tenant isolation (RLS) strategy

* `Tenant.inOrg(actor, fn)` = one `TransactionTemplate` transaction that first runs `select set_config('app.current_org_id', ?, true)` and `select set_config('app.current_user_id', ?, true)` (bind parameters, `is_local=true`), then `fn`. Equivalent to `SET LOCAL`, discarded on commit/rollback. `asActor`, `withInvitationToken`, `withoutContext` mirror Nest's other three wrappers; `withWebhookConversation` is new (see below).
* Values come only from the validated server-side session; nothing reads org ids from headers, query or body.
* Application SQL still filters `organization_id = ?` explicitly (three layers).
* Background work (document sweep, call retry sweep, max-duration sweep) enumerates organizations (RLS-exempt table) and opens **one transaction per organization**.
* Webhook: after HMAC verification over the raw request bytes, `set_config('app.webhook_conversation_id', id, true)` exposes exactly the one `voice_sessions` row for that conversation (new SELECT-only policy, migration 0022); its `organization_id` is then used to open a normal tenant transaction for the update.

## 5. Use-case engine

A **definition** (`src/main/resources/usecases/*.json`) contains:

```
id, version, displayName, packLabel, description, enabled
workUnit   {label, pluralLabel}            e.g. Job / Ticket
contact    {label, pluralLabel}            e.g. Candidate / Customer
knowledge  {scopes: [company, workUnit, agent], contextBudgetTokens, topK}
stages     [{key, label}]                  pipeline words (hiring: new/screening/reviewed/declined)
conversation {defaultLanguage, firstMessageTemplate/Fallback, voicemailTemplate/Fallback,
              promptBlocks[{template, requires[], fallback}]}   ordered = stable cacheable prefix
dataCollection {fromWorkUnitQuestions: bool, descriptionTemplate, fields: [{key, description, type}]}
result     {summaryInstruction, adviceGuard {patterns[], refusal, replacement}}
actions    {endCall, voicemailDetection, transferToHuman}
callPolicy {maxDurationSeconds, silenceTimeoutSeconds, retry {enabled, maxAttempts, backoffMinutes[], retryOn[], window {startHour, endHour, timezone}}}
review     {reviewer, callNoun}                       review-chat wording; reported, never advice
costLevers {summaryTier, summaryMode: provider_then_platform|platform, contextBudgetTokens}
packView   {defaultConfigSlice, wizardFields[]}       for /agents/packs parity
```

A block whose `requires` slots are all empty renders its `fallback` (or nothing), so a definition never prints a half-filled sentence. Validation at load/register: id pattern, labels present, at least one prompt block, `maxDurationSeconds` 60–3600, `retry.maxAttempts` 1–5.

Prompt templates use `{{slot}}` placeholders filled by the engine (organizationName, goal, workUnitTitle, workUnitBrief, questions, companyFacts, knowledgeBrief, contactLabel…). Unknown slots are left empty, never invented.

Engine flow for a call: resolve agent → definition (`agents.type` / `configuration.agentType`) → load work unit + contact (shared nouns: `jobs` = work items, `candidates` = contacts, per spec §6b) → **compile context once** (RAG over the definition's knowledge scopes, token budget from the definition, stable prompt prefix: policy → company facts → work-unit brief → questions) → hash → provision only when the hash changed → dial via `TelephonyPort` → webhook/reconcile → **one** post-call JSON extraction (definition's data-collection + summary schema, cheap tier) when provider analysis is missing or the definition prefers platform analysis → advice guard → ledger → domain events `call.started | call.ended | result.ready | transfer.requested`.

Hiring = `usecases/hiring.json` (HRVoice). `SecondUseCaseTest` registers a CustomerVoice (support) definition at runtime and runs agent creation, context compilation + provisioning, a signed post-call webhook, the per-use-case ledger and one-call extraction against fakes with no engine change.

## 6. RAG design

1. **Ingest:** validate type/size/magic bytes (same messages as Nest) → Apache Tika text extraction for PDF/DOCX/PPTX; UTF-8 decode for text/markdown.
2. **Chunk:** structure-aware (markdown headings, blank-line blocks, slide/page breaks) packed to a **token** target (default 300) with token overlap (default 40), counted with JTokkit (cl100k); oversized blocks are split on sentence boundaries, then hard-split.
3. **Dedup + idempotency:** document checksum (exists); per-chunk `content_hash` (sha256 of normalised text); version pointer flip exactly as Nest (old version serves until the new one commits).
4. **Embed:** batched (default 32) through `EmbeddingPort`; per-org cache table keyed by `(organization_id, content_hash, model)`; re-index of unchanged text is 100% cache hits. Providers: `deterministic-hash-v1` (bit-identical to Nest, so Nest- and Java-indexed chunks are interchangeable) and a Spring AI Google embedding adapter (1536-d). Retrieval only compares vectors with the same `embedding_provider`.
5. **Store:** `knowledge_chunks` (existing HNSW cosine index) + new `content_tsv` generated column with GIN index.
6. **Retrieve (hybrid):** vector top-N (`<=>`) and full-text top-N (`websearch_to_tsquery('simple')`, `ts_rank_cd`) in one tenant transaction, fused with **RRF** (k=60) → similarity floor on the vector leg (default 0.15, FTS-only hits must pass a rank floor) → optional reranker (flag) → **MMR** (λ=0.7) → top-K.
7. **Pack:** greedy token-budgeted packing with numbered citations `[1]`, each chunk fenced as untrusted data (fence markers stripped from content) under a fixed instruction that fenced text is never an instruction.
8. **Scope:** org always; optional `sourceIds`, `documentIds`, `jobId` (→ `job_knowledge_sources`), `agentId` (→ `agent_knowledge_sources`), all joined in SQL **and** subject to RLS.
9. **Eval:** golden set (`src/test/resources/rag/golden.json`) → recall@k and MRR, asserted in tests against Testcontainers.
10. **Metrics:** `rag.retrieve` timer, `rag.embed.cache{result=hit|miss}`, `rag.context.tokens` summary, `rag.results` counter by outcome.

## 7. Cost design (grounded in `PHASE_5B_UNIT_ECONOMICS.md`)

* **Ledger row per voice session** (`call_cost_ledger`, migration 0025): use case, channel, outcome, connected seconds, billed telephony seconds (30-s pulses), STT seconds (whole call), TTS characters (agent turns of the real transcript), LLM input / cached input / output tokens (when the provider reports them), recording bytes, provider-reported cost + unit, and per-component INR cost computed from the configured rate card. Any unknown quantity or unset rate → `null`; totals are `null` unless every component is known.
* **Rate card** from configuration (`DESK_RATE_*`); `PHASE_5B` official rates are documented, not silently assumed, because the deployed hosted voice stack is not the modelled Plivo+Sarvam stack.
* **Rollups:** per completed screen (completed = ended, human-answered, data collected), per use case, per month; answer rate; the `/usage/summary` shape matches the web's `WorkspaceUsage` plus a `costs` block.
* **Levers implemented:** compile-once context with a stable prompt prefix (≤ definition token budget instead of the 40 000-char knowledge dump), provision-only-on-change (context hash), one cheap structured post-call extraction instead of several calls, voicemail detection + early hang-up, max duration + silence timeout, bounded retry windows with backoff inside calling hours (disabled by default; §15 cost safety), per-org monthly minute/₹ budget guard checked **before** dialing, fixed-phrase TTS cache at the `VoicePipeline` port (inactive with the hosted agent, which renders its own audio).

## 8. Team onboarding and custom roles (founder addition)

Copyable invite links (create/resend return `{invitation, inviteUrl}` and keep `{id, acceptUrl}`), resend rotates the token and extends expiry, list shows effective status (pending/expired/revoked/accepted), public preview by token, public accept-new (create account + accept + session, one transaction), custom roles (CRUD, system roles read-only, subset rule against escalation, last-owner and self-lockout guards), grouped permission catalogue with labels, admin-triggered reset email, audit events for every change. Exact shapes are in `MIGRATION_STATUS.md` → "Frontend contract additions".

## 9. Cutover plan

1. Apply new migrations (0022+) with `pnpm db:migrate` — additive, Nest unaffected.
2. Run Java on :3002 against the same DB (`DATABASE_URL`, `BETTER_AUTH_SECRET` identical to Nest).
3. Shadow: point a staging web at `API_URL=http://localhost:3002`; run the hiring smoke (no dials) and the contract test suite.
4. Switch production web `API_URL` to Java; keep Nest running idle for one week.
5. Register the voice webhook URL to the Java host (same path `/webhooks/elevenlabs`).
6. Retire the Nest container and worker after a clean week.

**Rollback:** set `API_URL` back to Nest and restart web. No data migration in either direction.

## Addendum: decisions and production gaps (2026-10-01, second batch)

* **Administrators manage custom roles.** See ADR-009 and migration 0028. The API still refuses any grant beyond what the actor holds.
* **Embedding cutover.** A shadow vector column plus per-org progress (migration 0029), filled in batches through the embedding cache and switched with one UPDATE per org. It is a one-command CLI (`--desk.reembed=<model>`) and is resumable and idempotent.
* **Prompt-swap safety.**
  * Phone calls: provision → dial holds `pg_advisory_xact_lock(hashtextextended('voice.provision:'||version))`, which works across replicas.
  * Browser test calls: they can carry the job prompt as a per-call override (`DESK_VOICE_PER_CALL_OVERRIDES`, off until a live check). The hosted agent is then synced once with an "o:" context hash.
* **Durable background work.**
  * An own `background_jobs` table (migration 0030); pg-boss is not shared.
  * Claims use FOR UPDATE SKIP LOCKED, inside the tenant's context or the account-only scope.
  * Backoff is exponential: email 6 attempts from 30 s, documents 4 attempts from 15 s.
  * Expired claims are reclaimed after a crash.
  * Email payloads are sealed with AES-GCM.
* **S3-compatible storage.** `STORAGE_BACKEND=s3` with Nest's env keys and `<org>/<key>` layout (AWS SDK v2 with the JDK HTTP client; checksums only when required, for R2), and local disk as the fallback.
* **Account settings.** Better Auth `change-password` and `update-user`, probed against Nest and matched, except for stricter name and Origin validation.
* **Model pre-flight.** A free model-metadata lookup at boot, never fatal, reported as `/health` readiness (`llm`, `embeddings`).
