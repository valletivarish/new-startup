# 00 — Current system, backend side (map for integration work)

_Written 2026-10-03 from a read of the working tree. Research only: no code, config, migration or test was changed._

## How to read this

* **Repo root:** `/Users/valletivarish/Documents/new startup`. All paths below are relative to it.
* **Path shorthands** (used everywhere below):
  * `JAVA/` = `apps/api-java/src/main/java/desk/`
  * `RES/` = `apps/api-java/src/main/resources/`
  * `MIG/` = `packages/db/drizzle/`
  * `NEST/` = `apps/api/src/`
* **Labels:**
  * **FACT**: read in the named file, line numbers given where useful.
  * **RECOMMENDATION**: my suggestion for the integration design.
  * **ASSUMPTION**: believed but not checked.
  * **unverified**: I could not confirm it.
* "Java" means the Spring Boot API in `apps/api-java`. "Nest" means the older NestJS API in `apps/api`. Both use the same Postgres database.

---

## 1. Summary (the ten facts that matter most for integrations)

1. **FACT.** Java serves every route the web calls. Nest still runs alongside it on the same database, and switching between them is the `API_URL` variable. ADR-008 is still PROPOSED. Sources: `apps/api-java/MIGRATION_STATUS.md` lines 9–12, 371; `apps/web/next.config.mjs` lines 18–22 (rewrite `/backend/:path*` → `API_URL`).
2. **FACT.** Every tenant table has forced row-level security (RLS) keyed on `current_org_id()`. That function reads a transaction-local setting, and only `JAVA/platform/Db.java` sets it. There is no code path that bypasses RLS. Sources: `JAVA/platform/Db.java` lines 22–34 and 52–120; `docker/postgres/init/01-tenant-context-functions.sql`; `MIG/0001_rls_policies.sql`.
3. **FACT.** The only caller identity today is a **browser session cookie** (Better Auth format). There are **no API keys, no OAuth clients and no service accounts**. A background or system actor is represented by the nil UUID (`Db.NIL`). Sources: `JAVA/authz/AuthResolver.java`, `JAVA/auth/SessionStore.java`, `JAVA/platform/Db.java` line 39.
4. **FACT.** Candidates can be added in three ways: typed in (`POST /candidates`), a resume upload (stored as text only), or a CSV paste with a preview and confirm step. There is **no external id, no source-system field and no sync state** on jobs or candidates. `candidates.source` is limited by a check constraint to `'manual' | 'resume'`. Sources: `MIG/0015_hiring_desk_foundation.sql` lines 13–23; `MIG/0018_job_scoped_candidates.sql`; `JAVA/hiring/HiringController.java` lines 181–199 and 410–449.
5. **FACT.** Results come out of the API only through **pull**. `GET /jobs/{j}/candidates/{c}/results` returns the transcript, summary, structured answers and a `fitPercent` must-ask coverage figure. `GET /candidates/{id}/export` returns **only the candidate row**, with no call results. There is no bulk results export, no outbound webhook and no push of any kind. Sources: `JAVA/hiring/HiringController.java` lines 257–285 and 451–458; `JAVA/hiring/Jobs.java` lines 298–355.
6. **FACT.** In-process domain events already exist. `call.started`, `call.ended` and `result.ready` go out through Spring `ApplicationEventPublisher`. The only listener logs them. The class comment says "customer webhooks / MCP subscribe here later". Sources: `JAVA/engine/DomainEvents.java` lines 9–36; publishers at `JAVA/voice/VoiceSessions.java` lines 343, 460, 547 and 549.
7. **FACT.** There is a durable Postgres job queue (`background_jobs`, migration 0030) with RLS, idempotency keys, exponential backoff and dead-lettering. Its `kind` is limited by a check constraint to `'email' | 'document'`, and the Java retry policy map only knows those two kinds. Sources: `MIG/0030_background_jobs.sql`; `JAVA/jobs/JobQueue.java` lines 35–38 and 66–75.
8. **FACT.** There is exactly **one inbound webhook**: the voice provider's (`POST /webhooks/elevenlabs`). It is authenticated with HMAC-SHA256 over the raw bytes, and the tenant is found through a narrow RLS policy that matches the conversation id. Sources: `JAVA/voice/VoiceController.java` lines 131–156; `JAVA/voice/HostedVoiceAdapter.java` lines 198–230; `MIG/0022_voice_webhook_lookup.sql`.
9. **FACT.** The tool/function-calling layer (`tools`, `agent_tools`, `tool_executions`) is used **only by the text runtime**. The live voice agent receives only provider system tools: `end_call`, `voicemail_detection` and `transfer_to_number`. No customer tool or API call reaches a live phone call. Sources: `JAVA/engine/CallContextCompiler.java` lines 220–237; `JAVA/runtime/Tools.java`; `JAVA/runtime/AgentRuntime.java` (around line 181).
10. **FACT.** The permission catalogue already has `integrations.read/create/update/delete` and `workflows.*`. Recruiter and Admin roles hold some of them. **No route uses an `integrations.*` permission.** Sources: `JAVA/authz/Permissions.java` lines 61–69; `MIG/0008_seed_permission_matrix_v2.sql` lines 63–66.

---

## 2. Architecture and module boundaries

**FACT.** This is one Spring Boot process (`JAVA/DeskApplication.java`, with `@EnableScheduling`). It talks to the database through plain JDBC (`JdbcTemplate`). There is no ORM. It connects to Postgres as the application role named in `DATABASE_URL`, and refuses to boot if that is the migrator role (`JAVA/platform/Env.java` lines 160–163). The default port is 3002 (`RES/application.yml`).

| Package (`JAVA/…`) | What it owns | Integration relevance |
|---|---|---|
| `platform/` | `Db` (tenant transactions), `Env` (all config from env vars), `EdgeFilter` (request id, security headers, 15 MB body cap, per-IP fixed-window rate limit), `ApiError` (`{code, message, request_id, errors?}`), `Cursor` (keyset pagination), `Input` (strict JSON validation) | Every new integration route and worker goes through `Db.inOrg`. The rate limit is in-process per IP (`EdgeFilter.java` lines 69–83, marked "ponytail: move to Postgres/Redis with several replicas") |
| `auth/` | Better Auth–compatible sign-up, sign-in, sessions and password flows (`BetterAuthController`, `SessionStore`, `BetterAuthCrypto`) | Identity for humans only |
| `authz/` | `AuthInterceptor` (the single gate), `AuthResolver`, `Permissions` catalogue, annotations `@Public`, `@Authenticated`, `@RequirePermission`, `@RequireAnyPermission` | A machine principal would have to plug in here |
| `team/` | Organizations, members, invitations, custom roles | — |
| `hiring/` | Jobs, job-scoped candidates, CSV import, phone parsing, JD assist, results, stage changes, `/hiring/summary` | Core inbound and outbound data |
| `agents/` | Agent CRUD, versions, publish, `AgentConfig` contract | `AgentConfig` has unused `tools`, `followUp` and `escalation.notifyEmails` fields |
| `voice/` | `VoiceSessions` (provision, dial, reconcile, webhook apply, retries), `VoiceController`, `VoicePorts` (ports), `HostedVoiceAdapter` (ElevenLabs over REST), `FakeVoice` | Result production and the existing webhook |
| `engine/` | `CallContextCompiler` (prompt, data-collection schema, tools, snapshot), `PostCallExtractor`, `AdviceGuard`, `Coverage`, `CallOutcomes`, `DomainEvents`, `ReviewChat`, `PhoneNumbers` | Event boundary; the no-advice guard that must also cover write-back |
| `usecase/` | `UseCaseRegistry` and `UseCase` (JSON definitions from `RES/usecases/*.json`) | A definition already has `actions.webhook` and `actions.followUp` flags (both `false`, unused) |
| `runtime/` | Text agent sessions (`AgentRuntime`, `Intelligence`, `Sessions`) and tools (`Tools`) | Tool authorization model |
| `knowledge/`, `rag/` | Document ingest (Tika), chunking, embeddings, hybrid retrieval, `ObjectStorage` (local or S3) | Resume text extraction is reused from here |
| `ai/` | `LlmPort` (tiers `standard`/`cheap`), `GoogleLlm`, `ModelPreflight` | — |
| `cost/` | `CostLedger`, `BudgetGuard`, `RateCard`, `UsageController` | Budget guard runs before any dial |
| `audit/` | `AuditService`, `AuditController` (list, CSV export) | Audit of every integration action |
| `notify/` | `Notifications` (console or SMTP; queued and sealed) | The only encryption-at-rest helper |
| `jobs/` | `JobQueue` | Workers for sync and outbound delivery |

**FACT.** The request path is `EdgeFilter` (`JAVA/platform/EdgeFilter.java`) → `AuthInterceptor.preHandle` (`JAVA/authz/AuthInterceptor.java` lines 29–64) → controller (`Actor` argument resolved by `JAVA/authz/WebConfig.java` lines 34–51) → service → `Db.inOrg(...)`.

**FACT.** No CORS configuration exists in Java (grep for `cors` found nothing). The browser reaches the API same-origin through the Next rewrite `/backend/:path*` (`apps/web/next.config.mjs` lines 18–22; `apps/api-java/MIGRATION_STATUS.md` line 159). **ASSUMPTION:** a public integration API called directly by third parties would be a separate host or path, and CORS would not matter for server-to-server calls.

---

## 3. Database and tenant isolation

### 3.1 How org context is set

* **FACT.** There are three Postgres functions:
  * `current_org_id()` reads `app.current_org_id`;
  * `current_actor_id()` reads `app.current_user_id`;
  * `current_invitation_token_hash()` reads `app.invitation_token_hash`.

  All are `NULLIF(current_setting(..., true), '')`. Source: `docker/postgres/init/01-tenant-context-functions.sql`.
* **FACT.** `Db` (`JAVA/platform/Db.java`) is the only place the settings are written. It always uses `set_config(key, value, true)`, which is transaction-local, inside a `REQUIRES_NEW` transaction. Its entry points:
  * `inOrg(orgId, userId, work)`, lines 53–61: the full tenant context. Both ids must be UUIDs.
  * `asActor(userId, work)`, lines 64–70: no org; only the caller's own membership rows are visible.
  * `withInvitationToken(tokenHash, work)`, lines 73–81: exactly one invitation is visible.
  * `withWebhookConversation(conversationId, work)`, lines 87–95: exactly one `voice_sessions` row is visible, through the 0022 policy, and only after the HMAC is verified.
  * `underAdvisoryLock(key, work)`, lines 103–115: `pg_advisory_xact_lock`, a cross-replica mutex.
  * `noContext(work)`, lines 118–120: only tables without RLS (users, sessions, organizations).
* **FACT.** The class comment says: "There is deliberately no method that disables row-level security" (`Db.java` line 33). The TypeScript twin lists exactly two bootstrap exceptions and calls any third case "a bug, not a precedent" (`packages/db/src/tenant-context.ts` lines 1–40).
* **FACT.** System work with no human actor runs as `inOrg(org, Db.NIL, …)`, where `NIL` is `00000000-…` (`Db.java` line 39). Uses include the webhook apply (`VoiceSessions.java` lines 507 and 651), queue workers (`JobQueue.java` lines 163–165) and the stale-session sweep (`VoiceSessions.java` lines 678–687). Audit rows store `actor_user_id = NULL` for these (`JAVA/audit/AuditService.java` lines 38–45).
* **FACT.** The background loops iterate organizations with `select id from organizations where status='active'` under `noContext`, then open `inOrg` for each one (`JobQueue.java` lines 93–109; `VoiceSessions.java` line 681). One file comments "ponytail: … add a due-organizations index table past ~1k orgs".

### 3.2 RLS posture

* **FACT.** Every tenant table gets `ENABLE` + `FORCE ROW LEVEL SECURITY` and the policy `organization_id = current_org_id()` for both USING and WITH CHECK. Examples: jobs, candidates and job_candidates (`MIG/0016_hiring_desk_rls.sql`); tools (`MIG/0012_tool_rls.sql`); ledger, limits and scheduled_calls (`MIG/0025_call_cost_ledger.sql`); background_jobs (`MIG/0030_background_jobs.sql`).
* **FACT.** Neither `platform_app` nor `platform_migrator` has BYPASSRLS. A test asserts this (`MIG/0001_rls_policies.sql` lines 20–22; `apps/api-java/src/test/java/desk/StructuralTest.java` checks RLS drift and role privileges, per `MIGRATION_STATUS.md` line 58).
* **FACT.** The special policies are:
  * memberships readable by the actor (`MIG/0001_rls_policies.sql` lines 63–75);
  * an invitation found by token hash (lines 87–99);
  * audit NULL-org inserts (lines 114–122);
  * the webhook conversation lookup, which is SELECT-only (`MIG/0022_voice_webhook_lookup.sql` lines 16–31);
  * the background_jobs account scope (`MIG/0030_background_jobs.sql`, policy `bj_account_scope`).
* **FACT.** `tool_executions` is append-only for the app role: UPDATE and DELETE are revoked (`MIG/0012_tool_rls.sql`).
* **RECOMMENDATION.** An inbound ATS webhook can reuse the 0022 pattern: verify the signature first, then a narrow SELECT-only policy on an "integration connection" row resolves the org, then all writes run under `inOrg`. Nothing in the current design needs a bypass.

### 3.3 Migrations inventory (0000–0030)

**FACT.** All files are in `MIG/`. 0000 holds the identity tables. 0001/0003 add RLS. 0002/0008 seed permissions. 0004 is a jobs schema; 0005 installs pg-boss (Nest only). 0006/0007 add agents. 0009/0010 add knowledge. 0011/0012 add tools. 0013/0014 add the voice tables. 0015/0016 add the hiring desk. 0017 links voice to job and candidate. 0018 makes candidates job-scoped. 0019 makes screening job-owned. 0020 adds the provision snapshot. 0021 is a backfill. 0022 adds the webhook lookup. 0023 adds hybrid search. 0024 adds custom-role grants. 0025 adds the cost ledger, limits and scheduled calls. 0026 adds the `declined` stage. 0027 adds failure_reason. 0028 lets the admin manage roles. 0029 adds the embedding switch. 0030 adds background_jobs. Java added 0022–0030 and they are additive (`MIGRATION_STATUS.md` lines 139–151).

---

## 4. Authentication (who is calling)

* **FACT.** Sessions are opaque server-side rows in the `sessions` table, in the format Better Auth uses (ADR-002). The cookie is `better-auth.session_token`, with the prefix `__Secure-` when `COOKIE_SECURE=true` (`JAVA/auth/SessionStore.java` lines 31–33). The cookie value is `token.base64(HMAC-SHA256(BETTER_AUTH_SECRET, token))` (`JAVA/auth/BetterAuthCrypto.java` header comment and lines 47–71). Attributes are `HttpOnly; SameSite=Lax; Path=/`, plus `Secure` when configured (`SessionStore.java` lines 71–75).
* **FACT.** Lifetime is `SESSION_EXPIRY_SECONDS`, default 604,800 (7 days), and it is extended at most once a day. An expired row is deleted when it is loaded (`SessionStore.java` lines 103–133; `JAVA/platform/Env.java` line 91).
* **FACT.** Every request re-resolves the session and **re-validates the active membership and its permissions from the database**, with no cache (`JAVA/authz/AuthResolver.java` lines 12–22 and 35–82). The org comes only from `sessions.active_organization_id` (line 21).
* **FACT.** Cookie-carrying auth POSTs are checked against trusted origins, which are the web and API URLs (`JAVA/auth/BetterAuthController.java` lines 66–80 and 430–455).
* **FACT.** Passwords use scrypt and are byte-compatible with Better Auth (`BetterAuthCrypto.java` header). Email verification uses a JWT signed with the auth secret (`BetterAuthCrypto.java` lines 109–118; `BetterAuthController.java` lines 394 and 409).
* **FACT.** Not ported to Java: Better Auth list/revoke sessions, change-email, delete-user and social sign-in (`MIGRATION_STATUS.md` line 98).
* **FACT.** The `accounts` table (Better Auth) has plaintext columns `access_token`, `refresh_token` and `id_token` (`MIG/0000_initial_schema.sql` lines 1–15). They exist for social sign-in, which is unused.
  * **RECOMMENDATION:** do not reuse them for ATS or CRM credentials.
* **FACT.** Machine-to-machine policy is written down but not built. `BRD's/04_DATABASE_API_SPEC.md` line 410 says: "Provider webhooks authenticate by HMAC signature verification; future customer API access uses hashed, scoped, revocable API keys bound to an organization."

---

## 5. Authorization (what they may do)

* **FACT.** `AuthInterceptor` (`JAVA/authz/AuthInterceptor.java` lines 13–64) works in this order:
  1. `@Public` → allow.
  2. No annotation → **403 (fail closed)**.
  3. No session → 401.
  4. `@Authenticated` → allow.
  5. Otherwise the route needs an active org and a live membership that holds the permission, or else 403 plus an `authz.denied` audit row.
  6. Use of a sensitive permission writes an `authz.sensitive_access` audit row.
* **FACT.** The catalogue has 54 keys (`JAVA/authz/Permissions.java` lines 21–75). It mirrors `packages/permissions/src/permissions.ts`, and the source of truth is `BRD's/11_PERMISSION_MATRIX.md`. Sensitive keys are `candidates.read_pii`, `candidates.export`, `calls.read_transcript`, `calls.read_recording` and `agents.sessions.read` (lines 80–83).
* **FACT.** There are 7 system roles, defined in `Permissions.java` lines 101–131 and `packages/permissions/src/roles.ts`:
  * `owner` and `administrator` (all keys except `organization.delete` and `billing.manage`);
  * `agent_manager`, `knowledge_manager`, `recruiter`, `analyst`, `viewer`.

  Custom roles are per org (`custom_<slug>`). Grants are limited to the editor's own permissions, enforced by a trigger (`MIG/0024_custom_role_permissions.sql`) and by `JAVA/team/Roles.java`.
* **FACT.** PII is handled per field, not per route:
  * Without `candidates.read_pii`, phone, email and resume are **absent** from candidate payloads (`JAVA/hiring/Candidates.java` lines 29–35; `Jobs.java` lines 181–189).
  * Without `calls.read_transcript`, the transcript, summary, answers and `fitPercent` are nulled (`HiringController.java` lines 246–255; `JAVA/voice/VoiceController.java` lines 41–52).
  * Without `calls.read_recording`, `recordingAvailable` is false.
* **FACT.** Who holds `integrations.*`: `recruiter` holds `integrations.read` (`Permissions.java` line 124), `agent_manager` holds `integrations.read`, and administrator and owner hold all of them. `workflows.run` gates the stand-in business-action tool (`JAVA/runtime/Tools.java` lines 110–124).
* **RECOMMENDATION.** Store connection setup under `integrations.create/update/delete`, which already exist and are seeded. A machine principal (API key or OAuth client) should resolve to an org plus an explicit permission set, so the same interceptor and the same PII redaction apply. It should not bypass them.

---

## 6. Data model (fields an integration maps to)

### 6.1 Jobs (work units)

**FACT.** Defined in `MIG/0015_hiring_desk_foundation.sql` lines 1–11 and `MIG/0019_job_owned_screening.sql`.

| Column | Notes |
|---|---|
| `id` uuid, `organization_id` | |
| `title` text, `description` text default `''` | The API allows title ≤200 and description ≤5000 (`HiringController.java` lines 98–106). Typed JD text up to 40,000 chars is saved as a knowledge document (`JdText`, lines 151–177) |
| `status` | `draft \| open \| closed` (check constraint) |
| `agent_id` | The linked hiring agent; nullable; ON DELETE SET NULL |
| `screening_questions` jsonb | `[{id:"q1", label}]`; at most 30 questions of ≤300 chars (`HiringController.java` line 103; `Jobs.java` lines 82–91) |
| `screening_language` | `en \| hi` |
| `created_by_user_id`, `created_at`, `updated_at` | |

`job_knowledge_sources` links a job to its knowledge sources (JD and role docs; `MIG/0019_job_owned_screening.sql`).

### 6.2 Candidates (contacts), job-scoped

**FACT.** Defined in `MIG/0015_…` lines 13–23 and `MIG/0018_job_scoped_candidates.sql`. A candidate row belongs to **exactly one job**. The same person on two jobs is two rows. `job_id` is NOT NULL and ON DELETE CASCADE.

| Column | Notes |
|---|---|
| `id`, `organization_id`, `job_id` | |
| `full_name` | |
| `phone` text (nullable in the DB, required by the API on create), `country_code` text | Import stores national digits in `phone` and the dial code in `country_code`. Manual entry stores the phone **as typed** (`Candidates.java` lines 63–96) |
| `email`, `resume_text` (≤50,000 chars) | The resume **file is not stored**, only the extracted text (`HiringController.java` lines 424–446) |
| `source` | **CHECK `IN ('manual','resume')`** (`MIG/0015…` line 20). An ATS source value needs a migration |
| `screening_status` | Pipeline stage, **CHECK `IN ('new','screening','reviewed','declined')`** (`MIG/0026_candidate_declined_stage.sql`) |
| `created_at`, `updated_at` | |

* **FACT.** Uniqueness is `UNIQUE (job_id, phone) WHERE phone IS NOT NULL` on the **raw text** (`MIG/0018…`, index `candidates_job_phone_unique`). Import dedupe also compares digits only (`JAVA/hiring/CandidateImport.java` lines 209–228 and 242–266). Manual create relies only on the raw-text index (`Candidates.java` lines 91–93).
* **FACT.** `job_candidates` (0015) is a **read-only archive** after 0018 ("no new writes", header of `MIG/0018…`).
* **FACT.** The stage labels come from the use case: `new` = "Not called yet", `screening` = "On hold", `reviewed` = "Moved forward", `declined` = "Not moving forward" (`RES/usecases/hiring.json`, `stages`).
* **FACT.** Stage changes are made **only by people**, through `PATCH /jobs/{j}/candidates/{c}` or `POST /jobs/{j}/candidates/bulk-status` (≤100 per call). Each change writes an audit event `hiring.candidate_status_changed` with metadata `{jobId, from, to, reason?}` and `resource_id = candidateId` (`HiringController.java` lines 362–396). Stage history is read back from `audit_events` (`Jobs.java` lines 273–296). No domain event is published on a stage change.

### 6.3 Calls: agent_sessions + voice_sessions

**FACT.** Defined in `MIG/0006_agent_foundation.sql`, `MIG/0013_elevenlabs_foundation.sql` lines 33–50, 0017, 0020 and 0027.

* `agent_sessions` has `channel` (`'text' | 'browser' | 'phone'`; a voice call uses `browser` or `phone`), `agent_version_id`, `started_by_user_id` and a **`business_context` jsonb** column. Java never writes `business_context` (grep).
* `voice_sessions` has one row per call:

| Column | Notes |
|---|---|
| `session_id` → agent_sessions, `deployment_id` → voice_provider_deployments, `provider` | |
| `external_conversation_id` | The provider's conversation id; the webhook lookup key |
| `status` | `pending \| active \| ended \| failed` (by usage in `VoiceSessions.java`; no check constraint in 0013) |
| `transcript` jsonb | `[{role, message, timeInCallSecs?}]` (`JAVA/voice/VoicePorts.java` line 19) |
| `summary` text | Advice-scrubbed **on read** (`HiringController.java` line 250; `VoiceController.java` line 45). PostCallExtractor also scrubs before storing when it fills the gap (`JAVA/engine/PostCallExtractor.java` lines 37–43 and 80–83) |
| `structured_answers` jsonb | An object keyed by `Coverage.key(questionLabel)`: lowercase, `[a-z0-9_]`, ≤64 chars (`JAVA/engine/Coverage.java` lines 18–23). Values are strings, ≤500 chars when the platform extracted them |
| `duration_seconds`, `cost_credits`, `started_at`, `ended_at`, `webhook_received_at`, `created_at` | **No `updated_at` column** |
| `job_id`, `candidate_id` | ON DELETE SET NULL |
| `provision_snapshot` jsonb | Frozen at call start: questions (`evaluationCriteria`), prompt, language, knowledge ids, use case and version, context hash (`JAVA/engine/CallContextCompiler.java` lines 252–274) |
| `failure_reason` | CHECK `no_answer \| busy \| voicemail \| line_not_connected \| invalid_number \| carrier_blocked \| network \| unknown` (`MIG/0027…`) |

* **FACT.** Derived call status for a candidate row: `not_called | calling | completed | failed`, taken from the **latest phone** session (`Jobs.java` lines 167–179). Voicemail counts as `failed` (`MIGRATION_STATUS.md` line 114).
* **FACT.** `fitPercent` is the **share of must-ask questions with a non-empty answer**. It is null when there are no questions or no answers (`Coverage.java` lines 8–12 and 49–62). It is computed on read in `Jobs.results` (line 344) and is not stored.
* **RECOMMENDATION:** `fitPercent` is not a hire score. Never write it to an ATS field that reads as a "score" or "rating". The product rule is no scoring, and the web already labels it "Must-ask coverage" (`RES/usecases/hiring.json` `rubric.coverageLabel`, `review.coverageMessage`).

### 6.4 Other tables integrations will touch

* **FACT.** `call_cost_ledger` has one row per voice session (unique `voice_session_id`). It stores measured quantities, null costs when a rate is unknown, and `use_case` (`MIG/0025…` lines 13–62; upsert in `JAVA/cost/CostLedger.java` lines 80–100).
* **FACT.** `usage_limits` holds monthly minutes and cost caps, checked before any dial (`JAVA/cost/BudgetGuard.java`; called at `VoiceSessions.java` lines 294 and 372).
* **FACT.** `scheduled_calls` (`MIG/0025…` lines 95–136): `status` is `scheduled|dialing|done|cancelled|skipped`, with one open row per candidate. Java **inserts** rows when `callPolicy.retry.enabled` (`VoiceSessions.java` lines 572–596; `CallOutcomes.nextAttempt` at `JAVA/engine/CallOutcomes.java` lines 89–108). **Nothing reads or dials them.** grep for `scheduled_calls` finds only the insert. Retry is off in `hiring.json`.
* **FACT.** `organizations` holds only `id, name, slug, status, created_at, updated_at` (`MIG/0000…` lines 57–65). There is **no per-org settings or config table** where connection settings could live.

### 6.5 External ids

**FACT.** No job, candidate, voice session or organization table has an external-system id column. The only `external_*` columns are vendor ids for the voice provider: `voice_provider_deployments.external_agent_id`, `external_kb_doc_id` and `voice_sessions.external_conversation_id` (`MIG/0013…`). The `CRMProvider.upsertRecord` interface in `packages/providers` takes an `externalId` (`packages/providers/src/interfaces.ts` lines 244–253), but nothing implements or calls it.

---

## 7. Existing APIs relevant to candidates, jobs, calls and results

**FACT.** All routes are in Java. Path prefix as seen by the API (the web adds `/backend`). Error shape: `{code, message, request_id, errors?:[{field,message}]}` (`MIGRATION_STATUS.md` line 159; `JAVA/platform/ApiError.java`).

| Route | Permission | Notes / source |
|---|---|---|
| `GET /jobs` | jobs.read | All jobs, no pagination (`Jobs.java` lines 72–76) |
| `POST /jobs`, `PATCH /jobs/{id}`, `GET /jobs/{id}` | jobs.create / jobs.update / jobs.read | `HiringController.java` lines 98–123 |
| `GET/POST /jobs/{id}/knowledge`, `POST /jobs/{id}/jd/assist`, `POST /jobs/{id}/jd/text` | jobs.read / jobs.update | lines 125–177 |
| `GET /hiring/summary` | jobs.read | Home queues and per-job stage/outcome counts (`Jobs.java` lines 357–428) |
| `POST /jobs/{j}/candidates/import/preview` | candidates.create | `{csvText}` ≤2,000,000 chars → rows with `issues` (lines 181–187) |
| `POST /jobs/{j}/candidates/import/confirm` | candidates.create | `{rows:[{fullName,countryCode,phone,email?}]}` 1–2000 → `{created, skipped, rejected}`; a savepoint per row (lines 189–199; `Candidates.java` lines 147–180) |
| `GET /jobs/{j}/candidates` | jobs.read + candidates.read | Cursor pagination (`limit` 1–200, `cursor`, `status`, `q`) with `totals` (lines 211–233) |
| `GET /jobs/{j}/candidates/{c}` | jobs.read + candidates.read | One row (lines 235–244) |
| `GET /jobs/{j}/candidates/{c}/results` | jobs.read + candidates.read (+ calls.read_transcript / calls.read_recording for content) | The latest result plus up to 50 `sessions`. **Side effect:** may call the provider to reconcile missing data (lines 257–285) |
| `POST /jobs/{j}/candidates/{c}/review-chat[/stream]` | jobs.read + calls.read_transcript | Q&A over the transcript with an LLM; advice refused (lines 302–345) |
| `POST /jobs/{j}/candidates/{c}/outbound-call` | calls.initiate | Places a phone screen (lines 347–354) |
| `PATCH /jobs/{j}/candidates/{c}`, `POST /jobs/{j}/candidates/bulk-status` | jobs.update | Stage change plus audit (lines 362–389) |
| `GET /jobs/{j}/candidates/{c}/stage-history` | candidates.read | From audit (lines 356–360) |
| `GET /candidates?jobId=` | candidates.read | All candidates of a job, no pagination (lines 400–408) |
| `POST /candidates` | candidates.create | `{jobId, fullName, phone?, countryCode?(+91), email?, resumeText? \| resumeFile{name,contentType,content(base64),contentEncoding}}` (lines 410–449) |
| `GET/PATCH/DELETE /candidates/{id}` | candidates.read / update / delete | lines 460–490 |
| `GET /candidates/{id}/export` | candidates.export | `{exportedAt, candidate}`: the candidate row only (lines 451–458) |
| `GET /voice-sessions?candidateId=&jobId=` | agents.sessions.read | The 50 newest, no cursor (`VoiceController.java` lines 109–117; `VoiceSessions.java` lines 231–245) |
| `GET /agents/{a}/voice-sessions/{vs}`, `…/reconcile`, `…/end`, `…/recording` | various | `VoiceController.java` lines 80–107 |
| `GET /telephony/status` | agents.test or calls.initiate | lines 119–129 |
| `GET /audit`, `POST /audit/export.csv` (`kind=stage` gives a stage-move CSV), `POST /audit/exports` | audit.read | Up to 100k rows streamed (`JAVA/audit/AuditController.java` lines 147–230) |
| `GET /use-cases`, `GET /use-cases/{id}` | agents.read or agents.create | `JAVA/usecase/UseCaseRegistry.java` lines 91–108 |
| `GET /usage/summary`, `/usage/costs`, `GET/PUT /usage/limits` | usage.read / usage.manage_limits | `JAVA/cost/UsageController.java` |

**FACT.** The domain spec lists `GET/POST/DELETE /integrations` (`BRD's/04_DATABASE_API_SPEC.md` lines 529–533) and an `Integration` entity: `id, organization_id, type, provider, status, credential_reference, metadata`, with the note "Do not store provider secrets as ordinary plaintext database values" (lines 303–316). **None of this is implemented.**

---

## 8. How candidates get in today, and how data gets out

### 8.1 In

1. **Manual entry (FACT).** `POST /candidates`. The phone is required unless it can be pulled from the resume text. `source` is `manual`, or `resume` when resume text is present (`Candidates.java` lines 62–96).
2. **Resume upload (FACT).** The file arrives as base64 JSON inside `POST /candidates` (body cap 15 MB at `EdgeFilter.java` line 26; file cap 10 MB). The type is validated, then the text is extracted with `Documents.extractText` (Apache Tika). Indian mobiles are pulled from the text, at most 5 (`JAVA/hiring/Phones.java` lines 46–65). The file itself is discarded. A scanned resume with no text still creates the person if a phone was typed (`HiringController.java` lines 424–446).
3. **CSV/TSV (FACT).** A two-step preview then confirm (`JAVA/hiring/CandidateImport.java`):
   * header aliases are recognised (`name`, `mobile`, `email`, `country`, first and last name, …) at lines 18–29;
   * the delimiter is auto-detected (`,`, tab, `;`);
   * ISO country codes are mapped to dial codes (lines 31–34);
   * phones are normalised India-first (lines 92–115);
   * the issue codes are `missing_full_name`, `missing_country_code`, `missing_phone`, `invalid_phone`, `invalid_email`, `duplicate_in_batch` and `duplicate_on_job`;
   * confirm re-validates server-side and inserts with `source='manual'` (`Candidates.java` line 166).

   There are no custom fields; only name, phone, country code and email are kept. The `raw` columns appear in the preview only.
4. **There is no API-key route, no bulk JSON upsert by external id, no inbound ATS webhook, no email or forwarding intake, and no scheduled pull (FACT,** found by grep and the route inventory above).

### 8.2 Out

* **FACT.** Everything leaves by pull through the session-cookie routes in §7. Results are per candidate (`/results`). The single-candidate JSON export does not include call results. The audit CSV can export stage moves for the whole org.
* **FACT.** There is no outbound HTTP to any customer system, no webhook subscription table and no delivery log. The only outbound HTTP clients are the voice provider (`HostedVoiceAdapter`), Google LLM and embeddings, S3 and SMTP.
* **FACT.** Recording audio is streamed through the API from the provider on demand (`VoiceSessions.recording`, lines 618–627). It is **not stored** by the platform.

---

## 9. Call lifecycle: where results are produced

**FACT.** The steps, all in `JAVA/voice/VoiceSessions.java` unless noted:

1. `startOutbound`, lines 362–376:
   * kill switch (`ELEVENLABS_ENABLED`);
   * outbound line configured;
   * the agent is published;
   * `BudgetGuard.assertCanCall`;
   * then an advisory lock on the agent version, so a second job sharing the agent cannot swap the prompt before the dial.
2. `dialLocked`, lines 378–463:
   1. Provision, which re-syncs the hosted agent only if the compiled context hash changed (lines 155–219).
   2. Check concurrency and daily caps.
   3. Check that the job and agent match, and lock the candidate row.
   4. Convert the phone with `PhoneNumbers.toE164(candidate.phone)`.
   5. Refuse if a live call already exists.
   6. Insert `agent_sessions` (`channel='phone'`) and `voice_sessions` (`pending`, with `provision_snapshot`).
   7. Call `voice.dial`.
   8. On success: mark the session `active`, store `external_conversation_id`, write an audit row and publish `call.started`.
3. Results arrive in two ways:
   * the **webhook** (`webhook`, lines 629–675);
   * **reconcile** (pull from the provider, lines 467–483). Reconcile is triggered by the user ending the call (lines 598–616) or by **opening the results page** (`HiringController.java` lines 268–276).

   Both call `apply` (lines 500–554), which does the following:
   1. Coalesce-writes the transcript, summary, answers, duration, cost and failure_reason.
   2. If the session ended, runs at most **one** cheap LLM JSON call to fill a missing summary or answers. The output is scrubbed for advice and limited to the expected keys (`JAVA/engine/PostCallExtractor.java`).
   3. Writes or updates the cost ledger.
   4. Publishes `call.ended`, and also `result.ready` when there is a summary or answers.
   5. Optionally inserts a `scheduled_calls` retry.
4. `expireStale`, an `@Scheduled` job every 5 minutes, ends sessions that ran past the max minutes plus a buffer (lines 677–687).

**FACT (an idempotency gap relevant to outbound delivery).**
* `apply` is mostly safe to repeat: the column writes use `coalesce` and the ledger is an upsert.
* It **re-publishes** `call.ended` / `result.ready` every time it runs for an ended session. That can happen through the webhook, reconcile or the results page.
* There is no dedupe on events or on webhook deliveries. ElevenLabs documents that post-call webhooks can be retried (https://elevenlabs.io/docs/agents-platform/workflows/post-call-webhooks).
* **RECOMMENDATION:** any customer-facing delivery built on these events needs its own dedupe key, for example `(voice_session_id, event_type)`.

**FACT (dialing).** `PhoneNumbers.toE164` (`JAVA/engine/PhoneNumbers.java` lines 8–20) reads only `candidates.phone`. It does not use `country_code`.
* CSV import stores national digits in `phone` and the dial code separately. A non-Indian imported number would be dialed as `+<national digits>`. For example, a 9-digit UAE mobile becomes `+5xxxxxxxx`.
* I found this by reading the code; it was **not executed or tested**.
* **RECOMMENDATION:** ATS feeds often carry E.164 numbers. Decide on one canonical stored form before automated intake.

---

## 10. Background job queue (`background_jobs`) and retries

* **FACT (table).** `MIG/0030_background_jobs.sql`:
  * columns `id, organization_id (nullable), kind, payload jsonb, idempotency_key, status (queued|running|dead), attempts, max_attempts (1–20), run_at, locked_until, last_error`;
  * `kind CHECK IN ('email','document')`;
  * a partial unique index on `(kind, idempotency_key)` while queued or running.
  * RLS: tenant rows are visible only inside their org; account rows (org NULL) are visible only outside any org.
* **FACT (worker).** `JAVA/jobs/JobQueue.java`:
  * `enqueue` (lines 66–76) uses `ON CONFLICT DO NOTHING` on the idempotency key, then wakes a worker.
  * Claims take 10 at a time with `FOR UPDATE SKIP LOCKED` and a 900-second lease (`CLAIM_SECONDS`, lines 39 and 116–134).
  * On success the row is **deleted**. On failure it backs off as base × 2^(attempt-1), capped at 3600 s; after max attempts it is marked `dead` (email payloads are wiped when dead), lines 136–161.
  * The policy is email 6 attempts from 30 s, document 4 attempts from 15 s (line 38).
  * A safety-net poll runs every 30 s across all active orgs (lines 83–109).
  * There are 2 daemon worker threads (lines 50–54). `JOBS_ENABLED=false` turns off the automatic run.
* **FACT.** Handlers register by kind: email in `JAVA/notify/Notifications.java` line 49, document in `JAVA/knowledge/DocumentProcessor.java` line 55.
  * A handler gets `(organizationId, payload, finalAttempt)` and runs **without a user**; `inOrg(org, NIL)` is used.
  * `enqueue` would throw a NullPointerException for any kind missing from `POLICY`, because it reads `policy[0]` on line 67.
  * Adding a new kind therefore needs a migration (the check constraint) **and** a POLICY entry.
* **FACT.** Nest uses pg-boss (`MIG/0005_pgboss_install.sql`; `NEST/jobs/queue.ts`, queues `notifications.email` and `knowledge.document.process`). Java deliberately does not share it: pg-boss rows carry no org, have no RLS and hold raw tokens (`MIGRATION_STATUS.md` lines 120–125).
* **FACT.** No dead-letter UI or route exists. The only visibility is `jobsBacklog` in `/health` (`MIGRATION_STATUS.md` line 276) and logs.
* **RECOMMENDATION.** This queue is a sound base for sync pulls and outbound deliveries. It is per-tenant, durable, idempotent and replica-safe. It needs new kinds, per-kind policies, a scheduling or recurring mechanism (today only `run_at` exists, with no cron per org) and an operator view of `dead` rows.

---

## 11. Webhook receiver(s) and how they authenticate

**FACT.** There is one receiver: `POST /webhooks/elevenlabs`, marked `@Public` (`JAVA/voice/VoiceController.java` lines 131–156).

* It reads the raw `byte[]` body. The signature header is `elevenlabs-signature`, with legacy `xi-signature-256` also accepted.
* Verification is in `HostedVoiceAdapter.verify` (lines 203–230):
  * format `t=<unix>,v0=<hex>`, HMAC-SHA256 of `"<t>." + rawBody` with `ELEVENLABS_WEBHOOK_SECRET`;
  * a **±30-minute** timestamp tolerance;
  * a constant-time compare (`MessageDigest.isEqual`);
  * the legacy format is HMAC of the raw body **with no timestamp**, so it has no replay window.
* A bad signature returns `422 "Invalid or missing webhook signature"`.
* The tenant is resolved by `Db.withWebhookConversation`, a SELECT-only policy that matches `external_conversation_id` (`MIG/0022…`). The writes then run under `inOrg(org, NIL)`.
* Event types handled (`VoiceSessions.java` lines 642–674):
  * `post_call_transcription`, `conversation.ended`, `call.ended`, `conversation_ended`: apply the result;
  * `call_initiation_failure`: mark failed, write the ledger, maybe schedule a retry;
  * `conversation.started`, `call.started`, `conversation_started`: mark active;
  * anything else: audit row `voice.session.webhook_ignored`.

  ElevenLabs also documents a `post_call_audio` type (https://elevenlabs.io/docs/agents-platform/workflows/post-call-webhooks). Java ignores it.
* There is no stored delivery id and no dedupe table (FACT). The webhook path **is** rate-limited per IP like any other route (`EdgeFilter.java` lines 55–62).
* The secret is one global env value, not per org (`JAVA/platform/Env.java` line 126).
* **RECOMMENDATION.** Inbound ATS webhooks will need **per-connection** secrets. Different vendors use different schemes (HMAC header names, basic auth, or none). The current single global env secret does not generalise.

---

## 12. Secrets and encryption helpers

* **FACT.** All secrets are process env vars read in `JAVA/platform/Env.java`: the voice API key and webhook secret, the LLM key, S3 keys, SMTP and `BETTER_AUTH_SECRET`. There is **no per-tenant secret storage, no KMS client and no vault integration**.
* **FACT.** The one encrypt-at-rest helper is `Notifications.seal` / `open` (`JAVA/notify/Notifications.java` lines 48 and 75–97):
  * AES-256-GCM with a 12-byte IV;
  * the key is `SHA-256("desk.jobs.email.v1:" + BETTER_AUTH_SECRET)`;
  * the output format is `"v1." + base64(iv‖ct)`;
  * `open` is package-private and specific to email.

  `MIGRATION_STATUS.md` line 358 records the risk: rotating `BETTER_AUTH_SECRET` kills pending sealed mail.
* **FACT.** Other crypto helpers in `JAVA/auth/BetterAuthCrypto.java`: `hmacBase64`, `sha256Hex`, `randomId`, scrypt `hashPassword`/`verifyPassword` and an HS256 `signJwt`/`verifyJwt`. Invitation tokens are stored as SHA-256 hashes (`Db.withInvitationToken` needs a 64-hex hash).
* **RECOMMENDATION.**
  * ATS and CRM credentials (OAuth refresh tokens, API keys) need envelope encryption with a key that is **not** `BETTER_AUTH_SECRET`, plus a key version so keys can be rotated. The spec's `credential_reference` hints at this (`BRD's/04_DATABASE_API_SPEC.md` lines 303–316).
  * Customer API keys should be stored hashed, following the invitation-token pattern.

---

## 13. Tool and function-calling architecture

* **FACT (tables).** `MIG/0011_tool_foundation.sql` and `MIG/0012_tool_rls.sql`:
  * `tools`: per org; `name` unique per org; `input_schema`, `output_schema`, `required_permission`, `enabled`, `version`.
  * `agent_tools`: a grant from an agent to a tool.
  * `tool_executions`: append-only; `status`, `denial_reason`, `duration_ms`, `output_chars`. Input and output are not stored.
* **FACT (behaviour).** `JAVA/runtime/Tools.java`:
  * A catalogue row is only a declaration. The behaviour exists only in the in-code `BUILT_INS` map (lines 47–125): `calculator`, `test_echo`, `test_structured_output` and `deterministic_business_action`. The last needs `workflows.run`; it returns `{recorded, actionType, reference, idempotencyKey}` and has **no side effect**.
  * Five checks gate every run (lines 19–26 and 245–253): the tool exists, it has an implementation, it is enabled, it is granted to the agent, and the **acting membership** holds `required_permission`.
  * Runs have a 5-second timeout and output truncation. Every outcome writes a `tool_executions` row and an audit row (lines 255–304).
  * `POST /tools/install-builtins` upserts the four built-ins for an org (lines 153–169).
* **FACT.** Nest's comment on `deterministic_business_action` says: "Wiring a real one (ATS, calendar, email) is a later phase" (`NEST/tools/builtin-tools.ts` lines 229–239).
* **FACT (who uses tools).** Only the text runtime does (`JAVA/runtime/AgentRuntime.java` around lines 96–102 and 181; `JAVA/runtime/Intelligence.java`).
  * With the real model provider, **tool calling is off**: "text answers (tool calling stays with the deterministic provider for now)" (`Intelligence.java` lines 284–310; `MIGRATION_STATUS.md` line 99).
  * Tool execution runs as a **signed-in member**, because `Actor` is required. There is no system or agent principal.
* **FACT (live voice).** The hosted voice agent gets `built_in_tools` built in `CallContextCompiler.compile` (lines 220–237):
  * `end_call`;
  * `voicemail_detection`, with a callback message;
  * `transfer_to_number`, only when the use case allows it and the agent config has transfer phones.

  These are provider **system** tools. `tools` and `agent_tools` rows are **never** sent to the voice provider, and there is no server-tool or webhook-tool endpoint for the provider to call during a call. The agent config's `tools: [{name, enabled}]` (`JAVA/agents/AgentConfig.java` lines 103–106) is validated and stored, and nothing reads it.
* **FACT.** Knowledge reaches the live call **only once, at provisioning**: a token-budgeted brief compiled into the prompt (`CallContextCompiler.java` lines 26–37 and 138–165). Nothing is retrieved mid-call. The compiled context is hashed, and the hosted agent is re-synced only when the hash changes (`VoiceSessions.java` lines 178–195).
* **RECOMMENDATION.** Live, in-call reads or writes against a customer system (for example "check interview slots") would need a new path: provider server tools calling a signed endpoint on our API, a call-scoped principal, and the same five-condition authorization. ASSUMPTION: the provider supports server tools (unverified here). For HRVoice's current flow the need is mostly **before the call** (data in) and **after the call** (results out), which the queue and events can serve without in-call tools.

---

## 14. Provider abstractions (ports and adapters)

* **FACT (Java ports).**
  * `VoicePorts.VoiceAgentPort` and `TelephonyPort`, combined as `Provider` (`JAVA/voice/VoicePorts.java`). The adapters are `HostedVoiceAdapter` (ElevenLabs REST; the carrier route is `twilio`, or `exotel` when `ELEVENLABS_OUTBOUND_PROVIDER=india`, lines 252–271) and `FakeVoice`.
  * `LlmPort` (`JAVA/ai/LlmPort.java`; tiers, never model names).
  * `EmbeddingPort` (`JAVA/rag/EmbeddingPort.java`).
  * `Notifications.Port` (console or SMTP).
  * `ObjectStorage` (local or S3; keys namespaced by org; `JAVA/knowledge/ObjectStorage.java`).
* **FACT.** The rule in the voice ports is: "Business code depends on these only; the hosted-agent adapter is the single place a vendor API is called" (`VoicePorts.java` lines 7–10). User-facing errors never name a vendor (`MIGRATION_STATUS.md` line 111).
* **FACT (TypeScript definitions).** `packages/providers/src/interfaces.ts` defines `CalendarProvider` (`createEvent` / `cancelEvent`, with a required `idempotencyKey`) and `CRMProvider` (`upsertRecord({organizationId, recordType, externalId?, fields, idempotencyKey}) → {externalId}`) at lines 229–253. The header says "DEFINITIONS ONLY … NO PROVIDER IS SELECTED OR IMPLEMENTED" (lines 2–29), and the comment marks both interfaces for phase 6. grep finds no implementation or caller in either API.
* **FACT.** Adapters must receive an already-validated tenant context and must "never resolve tenancy themselves" (`interfaces.ts` lines 26–28).
* **RECOMMENDATION.** Port the `CRMProvider`/`CalendarProvider` shape to Java as an ATS/CRM port, keyed by connection id, with `idempotencyKey` and `externalId`. One adapter per vendor, with the vendor name and API only inside the adapter, the same as the voice adapter.

---

## 15. Audit log

* **FACT.** The `audit_events` table: `organization_id` (nullable for platform events), `actor_user_id`, `event_type`, `resource_type`, `resource_id`, `metadata` jsonb, `ip_address`, `user_agent`, `created_at` (`MIG/0000…` lines 17–28). Reads are tenant-only (`MIG/0001…` lines 114–122). Java does not fill `ip_address` or `user_agent` (`JAVA/audit/AuditService.java` lines 41–53).
* **FACT.** A failed audit write is **logged and swallowed** (`AuditService.java` lines 9–14 and 56–59).
* **FACT.** Events relevant here:
  * `authz.denied`, `authz.sensitive_access` (for every PII, transcript or recording read and every export);
  * `hiring.candidate_status_changed`, `candidates.deleted`;
  * `voice.session.*` (`started`, `outbound_started`, `outbound_failed`, `reconciled`, `webhook_ended`, `webhook_failed`, `webhook_ignored`, `ended_by_user`), `voice.deployment.provisioned`;
  * `agent.tool.*`, `tool.enabled/disabled`, `tools.installed`;
  * `<useCase>.screening.fallback_agent`.

  Sources: `HiringController.java`, `VoiceSessions.java`, `Tools.java`, `CallContextCompiler.java` lines 133–136.
* **FACT.** Audit is readable through `GET /audit` with a cursor and filters (`eventType`, `from`, `to`), and exportable as CSV up to 100k rows (`JAVA/audit/AuditController.java` lines 147–230).
* **ASSUMPTION.** The audit table works as an append-only change log of stage moves today, and could seed a "changes since" feed for write-back. It is not designed as an outbox: audit writes can be lost, and they are not in the same transaction as the business write. In `HiringController.java` lines 373–374 the stage update and the audit insert are separate transactions.

---

## 16. Domain events

* **FACT.** `DomainEvents.CallEvent(type, organizationId, voiceSessionId, useCase, workUnitId, contactId)` (`JAVA/engine/DomainEvents.java` lines 18–19):
  * It is published synchronously in-process through Spring `ApplicationEventPublisher`.
  * The only listener logs it (lines 32–36).
  * It is not persisted. If the process crashes after the DB write but before or during the publish, the event is lost.
  * `transfer.requested` is named in the comment and the spec but is **never published** (grep).
* **FACT.** The launch spec intends: "Webhooks/MCP subscribe to these; hiring UI reads DB" (`docs/superpowers/specs/2026-09-16-hiring-production-launch-design.md` line 82). The same spec lists customer webhooks and MCP as "Not day-one" (line 12) and MCP as "a façade later" (line 72).
* **RECOMMENDATION.** Before customer delivery, make events durable with a transactional outbox: write the event row in the same transaction as the result update, then deliver through `background_jobs`. Add events for stage changes (`candidate.stage_changed`), which have no event today.

---

## 17. Integration-related code, placeholders and flags already in the tree

| Item | Where | State |
|---|---|---|
| `integrations.*` and `workflows.*` permissions | `JAVA/authz/Permissions.java` lines 61–69; `MIG/0008…` lines 63–66 | Seeded, granted to roles, used by no route except `workflows.run` on the stand-in tool |
| Use-case `actions.webhook: false`, `actions.followUp: false` | `RES/usecases/hiring.json` `actions` | Flags only; no code reads them (grep) |
| Agent config `followUp {enabled, maxAttempts, delayMinutes}`, `escalation.notifyEmails`, `tools[]` | `JAVA/agents/AgentConfig.java` lines 103–125 | Validated and stored, never executed (grep) |
| `agent_sessions.business_context` jsonb | `MIG/0006_agent_foundation.sql` | Column exists; Java never writes it |
| `DomainEvents` | `JAVA/engine/DomainEvents.java` | Log-only listener; comment names webhooks/MCP as future subscribers |
| `scheduled_calls` | `MIG/0025…`; `VoiceSessions.java` lines 572–596 | Written when retry is enabled; **no dispatcher** |
| `deterministic_business_action` tool | `JAVA/runtime/Tools.java` lines 110–124; `NEST/tools/builtin-tools.ts` lines 229–239 | Stand-in; "wiring a real one (ATS, calendar, email) is a later phase" |
| `CRMProvider`, `CalendarProvider` | `packages/providers/src/interfaces.ts` lines 229–253 | Interfaces only (TypeScript), never implemented |
| Spec entities and routes: `Integration`, `/integrations`, API keys | `BRD's/04_DATABASE_API_SPEC.md` lines 303–316, 410 and 529–533 | Spec only |
| Customer webhooks / MCP | `docs/superpowers/specs/2026-09-16-hiring-production-launch-design.md` lines 12, 71–72, 82, 88 and 140 | Explicitly "not day-one"; "Shipping fake webhook/MCP UI" is listed as a non-goal |

**FACT.** I found no `TODO` or `FIXME` comments in `apps/api-java/src/main/java` or `apps/api/src` (grep).

---

## 18. What is NOT there (gap list for integration architects)

All items are FACT by absence: grep over `apps/api-java/src/main`, `apps/api/src` and `packages/db/drizzle`, plus the route inventory in §7.

1. No `integrations`/`connections` table, no per-org config or settings table, and no field-mapping or stage-mapping storage.
2. No external ids or source-system references on jobs, candidates or calls. `candidates.source` only allows `manual` and `resume`.
3. No machine authentication: no API keys, OAuth client credentials, OAuth authorization-code flow for connecting third-party apps, service accounts or system principals. `Actor` always needs a user and a membership.
4. No per-tenant secret storage or general-purpose encryption service. The only one is the email seal, keyed off the auth secret.
5. No outbound HTTP to customer systems: no customer webhooks, no subscription table, no delivery log, no signing of outgoing payloads.
6. No transactional outbox. Domain events are in-memory and log-only, and stage changes emit no event.
7. No inbound customer or ATS webhooks. The single webhook is the voice provider's, with one global secret.
8. No scheduler for recurring per-org work, such as "pull new applicants every 15 min". Only fixed global `@Scheduled` loops exist (`JobQueue.poll`, `VoiceSessions.expireStale`). `scheduled_calls` has no dispatcher.
9. No automatic dialing. Every phone screen starts from a human click (`calls.initiate`). Auto-retry is coded but switched off and undispatched, and needs a founder decision on consent and DND (`MIGRATION_STATUS.md` line 373).
10. No bulk export of results, and no "changes since" or updated-since query. `voice_sessions` has no `updated_at`. `/voice-sessions` is capped at 50 with no cursor.
11. No tool calling on live voice calls, and none with the real text model.
12. No idempotency keys on create routes (`POST /candidates`, import confirm). Dedupe for candidates is `(job_id, phone)` only.
13. No resume file storage. Only the extracted text is kept, so it cannot be pushed back to an ATS as a file.
14. No MCP server, no OpenAPI/Swagger document (no `springdoc`/`openapi` entry in `apps/api-java/pom.xml`), and no public API versioning.
15. No distributed rate limiting. It is in-process per IP, and there is no per-org or per-key quota on the API itself. Call-level budgets do exist.

---

## 19. Nest-only items worth noting

* **FACT.** Nest has nothing integration-related that Java lacks. The Nest-only things are:
  * the pg-boss queue (`NEST/jobs/queue.ts`, `NEST/jobs/worker.ts`; Java replaced it with `background_jobs`);
  * the Fastify raw-body hook for the webhook (`NEST/providers/elevenlabs/webhook-raw-body.ts`; Java reads `byte[]` directly);
  * the Better Auth endpoints not ported (sessions list/revoke, change-email, delete-user, social sign-in; `MIGRATION_STATUS.md` line 98).
* **FACT.** Nest's webhook org lookup was blocked by RLS, so it did not record results under the real app role. Java fixed this with 0022 (`MIGRATION_STATUS.md` line 110; `MIG/0022…` header).
* **FACT.** Nest reported voicemail as `completed` (`MIGRATION_STATUS.md` line 114). Any integration should read results from Java's semantics.

---

## 20. Constraints an integration design must respect (drawn from the facts above)

* **RECOMMENDATION.** These carry over directly from the existing design:
  * keep every write under `Db.inOrg`;
  * resolve tenancy from server-side state, never from a payload field;
  * map vendor errors to plain sentences and keep vendor names inside adapters;
  * audit every sensitive read or export;
  * keep the PII split, so a connector that only reads stages does not need `candidates.read_pii`.
* **RECOMMENDATION.** Write-back must pass through the same no-advice rule:
  * push only collected facts (answers, transcript or summary text after `AdviceGuard.scrub`, call status, `failure_reason`) and the human-set stage;
  * never push a computed recommendation, rank, or `fitPercent` labelled as a score.

  Source of the rule: `RES/usecases/hiring.json` (`description`, prompt block 2, `result.adviceGuard`); `JAVA/engine/AdviceGuard.java`.
* **RECOMMENDATION.** Stage mapping has to be explicit. The internal stages are four fixed values protected by a check constraint, and ATS pipelines differ per customer. A human decision ("Moved forward" / "Not moving forward") is the only trigger for a stage write-back.

## 21. Unverified or open

* Whether the hosted voice adapter works against the live API end to end. Nobody has run it live yet: "not been exercised live" (`MIGRATION_STATUS.md` lines 89 and 353).
* The exact ElevenLabs signature format and tolerance. The public page I checked confirms the header name `ElevenLabs-Signature`, the event types `post_call_transcription`, `post_call_audio` and `call_initiation_failure`, and that retries happen. It did not state the `t=…,v0=…` format or a tolerance. Java's ±30-minute window and the format come from the code, not from the vendor docs (https://elevenlabs.io/docs/agents-platform/workflows/post-call-webhooks).
* The non-Indian dialing issue in §9 was found by reading the code and has not been tested.
* OpenAPI: `apps/api-java/pom.xml` has no `springdoc`/`openapi` dependency (grep), so no generated API document exists today.
* Production deployment topology (number of replicas, proxy). It affects the in-process rate limit and the queue workers. See `BRD's/10_ADRs/ADR-006-hosting-deployment.md`, which I did not read for this map.
