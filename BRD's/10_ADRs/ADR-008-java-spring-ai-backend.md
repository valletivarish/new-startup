# ADR-008 — Backend on Java 17 + Spring Boot + Spring AI, use-case-agnostic voice engine

**Status:** REJECTED — 2026-10-09, founder decision: backend stays NestJS/TypeScript; the Java port (apps/api-java) was removed. Migrations 0022–0030 it introduced remain in packages/db.
**Date:** 2026-10-01
**Supersedes (on acceptance):** ADR-001, **backend rows only** — "Backend: NestJS on Fastify", "Language: TypeScript (backend)", "Data access: Drizzle", "Validation: Zod (backend)", "Testing: Vitest/Supertest (backend)". ADR-001 is left in place unedited, per `07_CODING_RULES` §21. Frontend (Next.js, TypeScript), PostgreSQL, pgvector, RLS, migrations owned by `packages/db`, Better Auth session format, and every other ADR are unchanged.
**Relates to:** ADR-002 (sessions), ADR-003 (RLS), ADR-004 (permissions), ADR-005 (membership), ADR-007 (VoicePipeline / AgentSession shape)
**Design spec:** `docs/superpowers/specs/2026-10-01-java-spring-ai-backend-design.md`

---

## Context

ADR-001 chose TypeScript end to end, mainly to move fast through CRUD phases with a team of one or two. Three things changed:

1. The product is now a **voice-agent engine** whose hardest, most valuable parts are retrieval quality, per-call cost control and post-call extraction — the AI-orchestration layer, not CRUD. Spring AI gives typed structured output, embedding and chat abstractions, observation hooks and retry policies behind vendor-neutral interfaces, which is the shape ADR-001 §A9 already demands.
2. The founder directed a migration to Java/Spring Boot + Spring AI with production RAG and per-call cost optimisation, running **side by side** with the Nest API until parity is proven.
3. The founder widened scope: the backend must be a **use-case-agnostic engine**. Hiring ("HRVoice") is the first *definition*; support ("CustomerVoice") and others must be addable as data, with no engine code changes.

The data layer is the expensive-to-change part (ADR-001 §"Expensive to change": PostgreSQL, RLS, membership). This ADR keeps all of it. What changes is the process that reads and writes it.

## Options considered

| Option | Summary | Verdict |
|---|---|---|
| A. Stay on NestJS | Keep TS; add RAG/cost work there | Rejected by founder direction; also the Nest webhook lookup is broken under RLS (see Consequences) and must be fixed anyway |
| B. Big-bang rewrite in Spring | Switch the web app on day one | Rejected — no rollback, parity unproven |
| C. **Strangler, side by side** | Java API on :3002 over the **same database, same migrations, same session cookie**; web switches by `API_URL` only; Nest stays runnable for rollback | **Chosen** |
| D. Java with its own schema/migrations (Flyway) | Independent schema | Rejected — two migration owners for one database is how RLS drifts; `packages/db` stays the single owner |

## Decision

**Option C.** Concretely:

| Concern | Decision |
|---|---|
| Runtime | Java 17, Spring Boot 3.4 (Spring MVC, servlet), one fat jar, port 3002 during cutover |
| Data access | `JdbcTemplate` + hand-written SQL. Every tenant query runs inside a transaction that first calls `set_config('app.current_org_id', ?, true)` and `set_config('app.current_user_id', ?, true)` — the exact calls Nest's `withTenantContext` makes. No ORM. |
| Migrations | Still owned by `packages/db` (drizzle journal + numbered SQL). Java adds **new numbered files only**, appended to the journal. No Flyway. |
| Roles | Java connects as `platform_app` (non-owner, no BYPASSRLS) and refuses to boot on the migrator URL, same as Nest. |
| Authentication | Byte-compatible with Better Auth 1.6: same `sessions`/`accounts`/`verifications` tables, same cookie (`better-auth.session_token`, value `token.base64(HMAC-SHA256(secret, token))`, URL-encoded, `__Secure-` prefix when secure), same scrypt password hash (`N=16384,r=16,p=1,dkLen=64`, hex salt). Existing sessions and passwords keep working across the switch, in both directions. |
| Authorization | Same permission catalogue and role bundles as `packages/permissions`; annotation per route (`@Public`, `@Authenticated`, `@RequirePermission`, `@RequireAnyPermission`); an interceptor **fails closed** on any route without one; route-coverage test enforces it. |
| Errors / pagination | Identical envelope `{code, message, request_id, errors?}` and opaque base64url keyset cursor `{createdAt,id}`. |
| AI | Spring AI behind our own ports (`LlmPort`, `EmbeddingPort`, `VoiceAgentPort`, `TelephonyPort`). Vendor classes are only referenced in `adapter` packages. Deterministic fakes are the default in tests and when no key is configured. |
| Use cases | A **use-case definition** (JSON, versioned, loaded by a registry) declares work-unit/contact labels, goal + prompt template slots, data-collection schema, result/summary template, allowed post-call actions, call policy, evaluation rubric (reported, never advice), and cost levers. The engine (provisioning, context compilation, extraction, cost ledger, events) reads definitions and contains no `if (hiring)` branch. |
| RAG | Tika extraction → structure-aware token chunking with overlap → content-hash dedup + per-org embedding cache → pgvector (existing HNSW) + Postgres full-text → Reciprocal Rank Fusion → similarity floor → MMR → token-budgeted context with citations, fenced as untrusted data. Org/job/agent filters are explicit **and** RLS-enforced. |
| Cost | Per-call ledger (telephony 30-s pulse rounding, STT minutes, TTS characters, LLM input/cached/output tokens, storage) persisted per call, rolled up per completed screen and per use case. Unknown → `null`, never `0`. |
| Jobs | No pg-boss client in Java. Document indexing runs on a bounded in-process executor with version-guarded idempotent processing; a startup sweep re-drives stale documents **per organization, per transaction** (ADR-003 rule for background work). Emails send inline through the notification port. |
| Observability | Structured JSON logs (Spring Boot ECS format) with `request_id`; Micrometer metrics; OpenTelemetry tracing via the Micrometer OTel bridge, off unless `OTEL_ENABLED=true`. |
| Testing | JUnit 5 + Testcontainers `pgvector/pgvector:pg16` booted with `docker/postgres/init/*.sql` and the real migration chain applied as `platform_migrator`. RLS is never tested against a mock. |

### Infrastructure inventory

No new infrastructure. During cutover there are temporarily two API containers against one database; after cutover the Nest container is removed and the A4 inventory is unchanged (one application container, PostgreSQL + pgvector, R2, Caddy). Java's job execution lives in the API process, so the separate worker container is not needed for Java.

## Consequences

- **Founder-level reversal cost.** ADR-001 lists backend language as "very high" to reverse. That cost is paid once here and is bounded because the schema, RLS, sessions and the web contract do not move.
- **Two codebases during cutover.** Any new migration must keep both APIs working until Nest is retired. New tables are additive; no column used by Nest is altered.
- **Bug found and fixed in passing:** the Nest voice webhook looks up `voice_sessions` with no tenant context, so under the real `platform_app` role and FORCE RLS it matches zero rows and never records results (reconcile-on-view masks it). Java resolves the organization through a narrowly-scoped RLS policy keyed on the provider conversation id, set only after HMAC verification — the same pattern as the invitation-token policy.
- **Security fix, both APIs:** Nest's `POST /auth/password-reset/console-link` returned a working reset link to any caller who knew an email. Java never returns a reset link over HTTP, and Nest was patched the same way (minimal change, tested); the route answers the same generic 404 for every input.
- **Custom roles become real** (schema already allowed them). `role_permissions` stays a global, readable table (A6) but writes are restricted by a trigger to roles owned by the current organization, so Nest's session resolution keeps working.
- **Provider selection is still open** (ADR §D2). Defaults are deterministic fakes; real Gemini chat/embeddings and the hosted voice agent are switched on per environment.

## Rollback

Point the web app's `API_URL` back to the Nest API and restart the web container. Sessions, passwords, data and migrations are shared, so rollback is a config change with no data migration. New Java-only tables (cost ledger, usage limits, embedding cache, scheduled calls) are ignored by Nest.

## Expensive to change later

| Item | Cost to reverse | Why |
|---|---|---|
| Backend language/framework | High | Every service and test |
| Session/cookie compatibility with Better Auth | Moderate | Breaking it logs every user out of both APIs |
| Use-case definition format | Moderate | Stored on agent versions and in call snapshots; version it, never mutate meaning |
| JdbcTemplate + SQL (no ORM) | Low–moderate | Queries are explicit and portable |
| Spring AI as AI abstraction | Low | Hidden behind our own ports |
