# Integration architecture: draft v2 (after review round 1)

Date: 2026-10-03. Author role: resolution lead. Status: **DRAFT v2 for founder review**. Research and writing only: no code, config, migration or test was changed.

Read with:
- `docs/integrations/02-resolutions.md`, section "Round 1": every reviewer objection on v1, the decision taken, why, and what changed here.
- `docs/integrations/architecture-draft-v1.md`: the previous draft. This document replaces it.
- `docs/integrations/01-comparison.md` (D1-D19), `00-current-system-backend.md` ("backend map"), `00-current-system-product.md` ("product map"), `research/01..07-*.md` (IA, AM, EA, SA, UX, BE, CR).

Labels: **FACT** (source: URL or repo path), **RECOMMENDATION**, **ASSUMPTION**, **unverified**. Paths are relative to `/Users/valletivarish/Documents/new startup/`. `JAVA/` = `apps/api-java/src/main/java/desk/`, `MIG/` = `packages/db/drizzle/`. Everything below is a RECOMMENDATION unless labelled otherwise.

### What changed from v1 (summary; details in `02-resolutions.md`)

| Area | v1 | v2 |
|---|---|---|
| Call results going out | Emitted at the end of `apply`, deduped by a "permanent" key in a table purged after 30 days; no recovery when the provider webhook is lost; failed calls emitted nothing | One level-triggered sweep emits `call.ended` once a call is settled. Dedupe lives on `voice_sessions` (`result_emitted_hash`, `result_version`), the sweep looks back 7 days only, a background reconcile repairs lost provider webhooks, failed and unanswered calls emit too, browser test calls never do (section 6.1) |
| Public event types | `call.ended` and `result.ready` (two per call, sometimes more) | `call.ended` once per phone call, with a `version` that rises only if the result changes after it was sent; `contact.stage_changed` |
| Events feed | Paged on a `bigserial`, which can skip rows that commit out of order | Emits take a per-organization transaction lock, so `seq` order equals commit order inside an org (section 6.5) |
| Event storage | `payload jsonb`, contents undefined | Ids and state only. Every body is built when it is sent or read, using the receiver's current permissions (section 6.2) |
| API key identity | `userId = Db.NIL` (breaks two foreign keys and silently drops audit rows) | A key acts as its creator: the creator's live membership is re-checked on every request and intersected with the key's permissions (section 10) |
| Queue | Integration HTTP on the shared 2-thread worker | An outbound lane with its own executor, one job per org per pass, a `Snooze` outcome, a circuit breaker per connection (section 6.8) |
| Stage write-back | One push per event; Undo "attempts a revert" | Level-triggered per candidate, after a 2-minute hold, sending only the current stage (section 7) |
| Order of work | API keys, `/v1`, webhooks, feed unconditional | The developer surface is gated on a pilot, like the named connector. Added: a human-triggered "call everyone not called yet" action (section 13) |
| SSRF guard | "Connect to the checked IP", no mechanism named | OkHttp (already on the classpath) with a filtering `Dns`, IP-literal URLs refused, no proxy, no redirects (section 6.4) |

---

## 1. The decisions on one page

1. **The goal is a sync problem, not an AI problem.** "Connect once, data flows in, the agent works, results flow back" needs: a machine identity, provenance (external ids), a durable record of what happened, a way to push it out, and one adapter per named system. MCP does not provide delivery, retries or sync (FACT, https://modelcontextprotocol.io/specification/2026-07-28/changelog: "a broken response stream loses the in-flight request").
2. **Everything lives inside `apps/api-java`, on the same Postgres.** No new service, broker, Redis, Kafka or workflow engine. Reuse `Db.inOrg` and forced RLS, the narrow-lookup pattern, `background_jobs`, `AuthInterceptor` with per-field PII redaction, `AuditService`, `AdviceGuard`, the CSV-import validation and the existing `scheduled_calls` table (FACT, backend map §2, §3, §5, §6.4, §10).
3. **Order of work (changed):** prerequisites → results CSV export → "call everyone not called yet" (one human click per batch) → then, **only when a pilot confirms which path it will use**, the integration core plus either the named connector (Zoho Recruit by default) or the developer surface (API keys, `/v1`, signed webhooks, events feed). Founder decision 1 picks the branch.
4. **Data flows one way per field.** Jobs and candidate contact details flow **in**. Call results and human decisions flow **out**. For ATS-linked rows the ATS owns contact fields; nothing is edited on both sides.
5. **The product rule holds at the boundary.** Only facts and decisions a named person made leave HRVoice. Never `fitPercent`, a coverage percentage, a score, a rank, "qualified", or a stage the system chose. One serializer builds every outbound body and is tested for this.
6. **Results flow back even if nobody opens HRVoice** (new). A background reconcile repairs a lost provider webhook; every phone call with a candidate produces exactly one `call.ended`, including unanswered ones; if no result can be fetched, the customer gets "result unavailable" instead of silence.
7. **Calls start from a person.** Either one Call click, or one confirmed click that queues every "not called yet" candidate on a job (new). Fully automatic calling of imported candidates waits for a written founder decision on consent, calling hours and DND (FACT, `apps/api-java/MIGRATION_STATUS.md` line 373).
8. **MCP:** never inside a live call; never as the sync channel; our own read-only MCP server later, when a paying customer asks.

The honest MVP loop is therefore: **in automatically (once a pilot's system is known), call with one click per batch, out automatically.**

---

## 2. Final architecture

### 2.1 Picture

```
 CUSTOMER SIDE                               HRVOICE (apps/api-java: one Spring process, one Postgres, forced RLS)

 Own app / script / iPaaS / cloud bus        EdgeFilter (per-key window on /v1) ─► AuthResolver: key hash ─► creator's live
 [developer surface, gated on a pilot]         membership ∩ key permissions ─► AuthInterceptor (same PII rules, same audit)
   PUT  /v1/candidates/by-external/{id} ─────►                                   │
   POST /v1/candidates:batch                     CSV-import validation ─► Db.inOrg ─► jobs / candidates + job_links / candidate_links
   GET  /v1/events?after= ◄─────────────┐                                                   │
   signed POST (Standard Webhooks) ◄────┤          person: Call, or "call everyone" ─► scheduled_calls ─► dial job
                                        │                                                   ▼
 SaaS ATS [named connector, gated]      │        voice provider ─► webhook or background reconcile ─► apply() ─► voice_sessions
   poll If-Modified-Since ◄── pull job  │                                                   │
   one note per call ◄──────────────────┤        60 s tick, per org with a live connection: │
   stage: opt-in, a person's decision,  │          • reconcile calls whose provider webhook never came
   2-minute hold, current stage only ◄──┤          • call outcome sweep: settled and changed? compare-and-set on voice_sessions
                                        │          • fan out new events, due pulls, stage mismatches, purge
                                        │                                                   ▼
                                        │        integration_events (ids + state, seq ordered per org, 30 days)
                                        │          ▲ the stage-change transaction also emits here (outbox)
                                        │                                                   ▼
                                        └─── outbound lane (own executor, one job per org per pass) ◄── integration_deliveries
```

### 2.2 Components (all new code in `JAVA/integrations/`, except the two queue changes)

| Component | Responsibility | Reuses (FACT, backend map) | Slice |
|---|---|---|---|
| `ExternalPayloads` | The single builder for every outbound body (webhook, `/v1` result, feed item, ATS note, CSV row), checked against the receiving principal's **current** permissions | `AdviceGuard.scrub`, `Coverage` question order, `HiringController.redactResult` rules | 0 |
| `Sealer` (in `platform/`) | AES-256-GCM, dedicated versioned key, per-row AAD | generalises `Notifications.seal/open` | 0 |
| `JobQueue` changes | `Snooze` outcome; outbound lane for kinds `call` and `integration` (section 6.8) | `JobQueue` | A2 or Core, whichever ships first |
| `BulkCalls` | "Call everyone not called yet": writes `scheduled_calls`, dial job per row (section 13.1) | `scheduled_calls` (MIG/0025), `VoiceSessions.startOutbound`, `BudgetGuard`, `callPolicy.retry.window` | A2 |
| `Connections` | CRUD and status for connected systems; seal/open secrets; take-over by an admin | `Db.inOrg`, `AuditService`, `integrations.*` permissions | Core |
| `Events` | `emit(Db.Sql sql, ...)` inside the caller's transaction, under a per-org lock | `Db.Sql` | Core |
| `IntegrationScheduler` | One `@Scheduled` tick every 60 s that only hands work to the outbound lane: reconcile, outcome sweep, fan-out, due pulls, stage mismatches, purge | the per-org loop pattern of `JobQueue.poll` | Core |
| `IntegrationWorker` | Lane handlers: `reconcile_call`, `deliver`, `pull`, `push_note`, `push_stage` | `JobQueue.register` | Core, E |
| `ApiKeys` + one branch in `AuthResolver` | Bearer key → creator's live membership ∩ key permissions | invitation-token hash pattern, `AuthResolver.membership` | Dev |
| `PublicApiController` (`/v1`) | Six routes (section 6.6) | `Input`, `ApiError`, `CandidateImport`, `Candidates` | Dev |
| `SafeHttp` | Outbound HTTP to customer URLs with the SSRF guard (section 6.4) | OkHttp 4.12.0, already on the classpath | Dev |
| `AtsPort` + `ZohoRecruitAts` + `FakeAts` | The connector seam (section 3) | the `VoicePorts` / `HostedVoiceAdapter` / `FakeVoice` convention | E |

### 2.3 Data model additions (one additive migration per slice; sketch, not final DDL)

Every new table is a tenant table: `ENABLE` + `FORCE ROW LEVEL SECURITY`, policy `organization_id = current_org_id()` for USING and WITH CHECK, added to `StructuralTest` (FACT pattern: `MIG/0016_hiring_desk_rls.sql`, `MIG/0030_background_jobs.sql`).

| Table / change | Key columns | Notes | Slice |
|---|---|---|---|
| `integration_connections` | `id, organization_id, provider ('custom' \| 'zoho_recruit'), status ('connecting' \| 'active' \| 'needs_attention' \| 'paused' \| 'disconnected'), secrets_sealed, key_version, config jsonb, cursor jsonb, next_sync_at, paused_until, consecutive_failures, last_attempt_at, last_success_at, last_error_code, last_sync_issues jsonb, oauth_state_hash, oauth_state_expires_at, created_by_user_id, created_at, updated_at, disconnected_at` | **`secrets_sealed`** is the only place a secret lives: one sealed JSON object (OAuth tokens and PKCE verifier, or the webhook signing secret plus the previous secret and its expiry), AAD = `organization_id:connection_id:secrets`. **`config` never holds a secret**: its keys come from a fixed allowlist (webhook URL, event types, include flags; or linked jobs, trigger status, stage map), enforced by a test. `last_sync_issues` holds counts by issue code and external ids only, no PII. `created_by_user_id` is the **sending principal** (section 10). At most one `custom` connection and one per ATS provider per workspace | Core |
| `api_keys` | `id, organization_id, connection_id, name, prefix, key_hash (unique), permissions text[], created_by_user_id, last_used_at, expires_at, revoked_at, created_at` | `prefix` = `hv_live_` plus the first 6 characters of the random part. Narrow SELECT-only lookup policy keyed on a transaction-local `app.api_key_hash`, copying `Db.withInvitationToken` | Dev |
| `job_links` | `job_id → jobs ON DELETE CASCADE, connection_id → integration_connections ON DELETE CASCADE, organization_id, external_id, remote_updated_at, remote_state ('open' \| 'closed' \| 'deleted'), inbound_hash` | `UNIQUE (connection_id, external_id)`, `UNIQUE (connection_id, job_id)` | Core |
| `candidate_links` | `candidate_id → candidates ON DELETE CASCADE, connection_id → ..., organization_id, job_id, external_id, external_parent_id, remote_updated_at, remote_state, remote_state_changed_at, inbound_hash, remote_status_seen, pushed_stage, stage_seen_at_push` | **`UNIQUE (connection_id, job_id, external_id)`** (changed): an external id names a person on a job, so the same person id on two jobs gives two rows, as candidates are job-scoped today (FACT, `MIG/0018_job_scoped_candidates.sql`). `UNIQUE (connection_id, candidate_id)`. `job_id` is copied from the candidate for the unique index | Core |
| `integration_events` | `id, organization_id, seq bigserial, type ('call.ended' \| 'contact.stage_changed'), job_id, candidate_id, voice_session_id, data jsonb, created_at` | **Ids and state only.** `data` holds `{version}` for calls or `{from, to, decidedByUserId}` for stage changes; never a summary, answer, transcript, phone, email or free-text reason. Index `(organization_id, seq)`. Purged after 30 days; nothing depends on old rows for dedupe | Core |
| `integration_deliveries` | `id, organization_id, connection_id, event_id, status ('pending' \| 'sent' \| 'failed' \| 'cancelled'), attempts, http_status, error_code, created_at, updated_at` | `UNIQUE (connection_id, event_id)`. Purged after 30 days. (v1's `direction 'in'` is dropped; inbound webhooks are V2 and bring their own table) | Core |
| `voice_sessions` | add `result_emitted_hash text`, `result_version int not null default 0` | The permanent per-call dedupe (section 6.1). Lives and dies with the call row | Core |
| `candidates.source` CHECK | add `'api'`, `'integration'`; optional `'import'` for CSV rows | FACT, `MIG/0015_hiring_desk_foundation.sql` line 20 | Core |
| `background_jobs.kind` CHECK + `JobQueue.POLICY` | add `'call'` (A2) and `'integration'` (Core) | Both must change together, or `enqueue` throws a NullPointerException (FACT, `JAVA/jobs/JobQueue.java` lines 38, 67). Add a clear error for unknown kinds | A2, Core |
| `scheduled_calls.reason` | value `'bulk'` for human-queued calls | FACT: the table exists with `status scheduled\|dialing\|done\|cancelled\|skipped`, `requested_by_user_id` and one open row per candidate; nothing dials it today (`MIG/0025_call_cost_ledger.sql` lines 95-136) | A2 |
| Phone canonical form | store E.164; `PhoneNumbers.toE164` uses it | Slice 0. See section 13.1 for the collision pre-check | 0 |
| `usecases/hiring.json` | rename `actions.webhook` → `actions.integrations` | FACT: no Java or web code reads `actions.webhook` today (grep of `apps/api-java/src/main/java` and `apps/web/lib`; `CallContextCompiler` reads only `endCall`, `voicemailDetection`, `transferToHuman`, `transferCondition`, lines 171-235) | Core |

v1's `JobQueue.enqueue(..., delaySeconds)` overload, `ConnectorSpec.inboundHints`, `candidate_links.pushed_result_key` and `integration_events.dedupe_key` are removed.

---

## 3. Connector abstraction

**RECOMMENDATION.** A connector is one Spring bean implementing `AtsPort`, plus a static `ConnectorSpec`. No plugin loader and no DSL: adapters are registered in a map by key, the same way `JobQueue` handlers register by kind (FACT, `JAVA/notify/Notifications.java` line 49, `JAVA/knowledge/DocumentProcessor.java` line 55).

```java
// Sketch only. Not code to commit.
record ConnectorSpec(
    String key,                 // "zoho_recruit"
    String displayName,         // the customer's own system name, e.g. "Zoho Recruit" (founder decision 8)
    Auth auth,                  // OAUTH2_CODE | PASTED_CREDENTIALS
    List<String> scopes,        // fixed by us, narrowest that works; no scope picker in the UI
    Set<Reads> reads,           // JOBS, APPLICATIONS, STAGES, DELETIONS, RESUME_TEXT
    Set<Action> actions,        // what this system lets us write
    Budget budget) {}           // daily credits by plan, with a reserve for writes (section 5)

enum Action {
  ADD_NOTE,   // trigger: a settled call (call.ended). Content from ExternalPayloads only.
  SET_STAGE   // trigger: a person's stage decision, read at send time. Never a call outcome, never a model.
}

interface AtsPort {
  ConnectorSpec spec();
  Page<ExternalJob>         listJobs(Conn c, String cursor);
  Page<ExternalApplication> listApplications(Conn c, Instant modifiedSince, String cursor);
  ExternalApplication       getApplication(Conn c, String applicationRef);
  List<ExternalStage>       listStages(Conn c, String jobRef);       // read live; stages get renamed
  List<String>              deletedSince(Conn c, Instant since);     // empty when unsupported
  List<String>              noteMarkers(Conn c, ExternalApplication app);
  void addNote(Conn c, ExternalApplication app, String text, String marker);
  void setStage(Conn c, ExternalApplication app, String stageRef, String comment);
  // Typed errors: RateLimited(retryAfter), AuthRevoked, NotFound, Rejected(fieldErrors), Transient
}
```

- `ExternalJob`, `ExternalApplication`, `ExternalStage` and `Page` are the whole cross-vendor model. Vendor field names never leave the adapter (FACT, rule in `JAVA/voice/VoicePorts.java` lines 7-10).
- The `custom` connection (our API plus webhooks) has no adapter. It is our own surface.
- A unified-API vendor (Kombo, Merge) would later be one more `AtsPort` implementation.

### 3.2 Declared capabilities for the systems in view

Unchanged from v1 (Zoho Recruit: OAuth per data centre, notes on the candidate record, Change Status with `jobids`; Keka Hire V2; Greenhouse and Lever later through partner programmes; Darwinbox, Naukri RMS, Freshteam later or avoid). Evidence: https://www.zoho.com/recruit/developer-guide/apiv2/create-notes.html, https://www.zoho.com/recruit/developer-guide/apiv2/change-status.html, https://www.zoho.com/recruit/plan-comparison.html, https://www.zoho.com/recruit/developer-guide/apiv2/multi-dc.html.

---

## 4. Canonical model

**RECOMMENDATION.** No separate canonical schema. Our tables are the model; adapters map vendor objects straight onto them.

| Our noun (table) | Outside concept | Direction | Owner after linking |
|---|---|---|---|
| Work item (`jobs`) | ATS job opening; customer's requisition | in, **create only** | Title and description are copied **once, when the job is created** (by the connector's link step or by `PUT /v1/jobs/by-external/{id}`), then they are ours. The JD drives the call prompt (FACT, `JAVA/engine/CallContextCompiler.java` reads `jobs.description` into the brief; a changed context hash re-provisions the hosted agent before the next dial, `JAVA/voice/VoiceSessions.java` lines 178-195), so no machine path may change it later. Must-ask questions are never imported |
| Contact (`candidates`, job-scoped) | ATS **application**; customer's person-on-a-job | in | ATS-linked rows: name, phone, email, resume text are owned by the ATS and **read-only in HRVoice**. Rows linked to the `custom` connection stay editable; the customer's next `PUT` for that external id overwrites them (last write wins, documented) |
| Call result (`voice_sessions`) | note on the application; `call.ended` event | out | Ours |
| Decision (`candidates.screening_status`, set by a person) | ATS status | out, mapped, opt-in | Ours. Only `reviewed` ("Moved forward") and `declined` ("Not moving forward") are ever sent |

**Field allowlist (DPDP minimisation).** Inbound we store only: name, phone (E.164), email, resume text, job link, external ids, remote updated time, remote state and the remote status label. Never date of birth, gender, salary, address, ATS notes, ratings or scores (FACT, Zoho has an AI match rating on candidates, UX Z6).

**Event names (D18).** Use-case-neutral: `call.ended` and `contact.stage_changed`, each with `useCase` in the body. The in-process `DomainEvents` (`call.started`, `call.ended`, `result.ready`) stay as they are and are not the public contract (FACT, `JAVA/engine/DomainEvents.java`).

---

## 5. Sync design (inbound, slice E)

| Concern | Design | Evidence |
|---|---|---|
| **Initial import** (changed) | After connect: the customer ticks jobs (none pre-ticked) and picks a trigger status. One `pull` queue job per connection, idempotency key `pull:<connectionId>`. It imports one page (up to 200 records), writes it and advances `cursor` **in the same transaction**, then returns `Snooze(0)` so the **same row** goes back to the queue for the next page. The queue row is the single-flight lease: a second `pull` for the connection cannot be queued while it exists, and pages from different orgs interleave | FACT: `enqueue` does `ON CONFLICT ... WHERE status IN ('queued','running') DO NOTHING` and the row is deleted only after the handler returns (`JAVA/jobs/JobQueue.java` lines 66-75, 145), so v1's "enqueue the next page with the same key" would have been silently dropped. Zoho `per_page` default 200 (https://www.zoho.com/recruit/developer-guide/apiv2/get-records.html) |
| **Incremental** | Every 15 minutes by default: Get Records with `If-Modified-Since` = last high-water mark minus a 2-minute overlap. Upserts are idempotent (link uniqueness plus `inbound_hash`) | FACT: `If-Modified-Since` supported on Get Records (same page) |
| **Real time** | None in the first release. V2: vendor webhooks become hints that enqueue a re-fetch | FACT: Zoho webhooks only on Professional and Enterprise (https://www.zoho.com/recruit/plan-comparison.html) |
| **Reconciliation** | Nightly: list all applications on linked open jobs, compare with `candidate_links`, mark missing ones. Plus a "Sync now" button | Vendors do not guarantee webhook delivery (CR F6-F7) |
| **Deletions and erasure** (changed) | Deleted or anonymised in the ATS → `remote_state = 'deleted'`, `remote_state_changed_at = now()`; the person leaves "Not called yet" and cannot be dialed. After a grace period (founder decision 9; proposed 7 days) a daily step **anonymises** the row: name replaced by "Removed in <system>", phone, email and resume text nulled, and transcript, summary and answers of that person's calls nulled; ids, timings, outcomes and cost rows kept; one audit row with ids only. A deletion in the ATS is often the employer's erasure instruction, and we act for the employer | ASSUMPTION: we are the employer's DPDP data processor (needs a lawyer). Zoho deleted-records API costs 2 credits a call (https://www.zoho.com/recruit/developer-guide/apiv2/limits.html) |
| **Status changes in the ATS** | Never change our stage (D11). Rejected, hired, withdrawn → `remote_state = 'closed'`: the row shows "Closed in Zoho Recruit", is left out of "Not called yet" counts and of bulk calls, and **dialing is blocked** by one guard in `VoiceSessions.dialLocked`, the single dial choke point | FACT: `dialLocked` is the only dial path (backend map §9) |
| **Jobs closed in the ATS** (new) | `job_links.remote_state = 'closed'`: stop pulling that job, show "Closed in Zoho Recruit" on the job, never close our job automatically | |
| **Validation** (changed) | Mapped rows go through the CSV-import rules and the savepoint-per-row insert. A rejected record is not stored; its external id and issue code are counted in `last_sync_issues` and shown on the status card ("3 people couldn't come in: number not valid. Fix them in Zoho Recruit."), with "Sync now" | FACT: `JAVA/hiring/CandidateImport.java`; the CSV preview shows these issue codes to the person today (`apps/web/components/candidates/add-candidates.tsx` lines 196-366) |
| **Phone match with existing rows** (changed) | Connector only: if no link exists but the job has an **unlinked** row with the same E.164 phone, adopt it (create the link); ATS values then own the contact fields; one audit row `integration.candidate_adopted` with ids. `/v1` never adopts (section 6.6) | FACT: unique `(job_id, phone)` (`MIG/0018`) |
| **Failures** | Typed adapter errors. `AuthRevoked` / `invalid_grant` → `needs_attention`, all jobs for the connection stop, admins emailed once; never retried in a loop. `RateLimited` → `paused_until` and `Snooze(retryAfter)`, which does not count as a failed attempt. `Transient` → normal queue retry | SA M3, BE §3.7 |
| **Idempotency** | Inbound: link uniqueness + `inbound_hash`. Notes: marker `HRVoice ref <session id prefix>.<content hash prefix>`; before writing, the adapter lists the application's note markers and skips if the same marker exists. Stage: compare `pushed_stage` (section 7) | |
| **Rate limits and budget** (changed) | Per-connection budget from the customer's plan: at most about 20% of daily credits, of which a fixed share is **reserved for writes** (note listing and writing, stage reads and writes); when the budget tightens, polling slows first. No advisory lock around vendor calls: the outbound lane has 2 threads in total, far under Zoho's 5-20 concurrency. Token refresh uses `pg_try_advisory_xact_lock("conn:"+id)` held only for the refresh call; a job that does not get the lock returns `Snooze(5)` and re-reads the token | FACT: Get Records costs 3 credits; Free 5,000/day; concurrency Free 5 to Enterprise 20 (https://www.zoho.com/recruit/developer-guide/apiv2/limits.html). FACT: `Db.underAdvisoryLock` holds a pooled connection idle for the whole `work` and waits up to `statement_timeout` (`JAVA/platform/Db.java` lines 97-115; pool default 10, `JAVA/platform/Env.java` line 88) |
| **Fail-closed revocation** | Every job reloads the connection row when it runs and stops unless `active` (or probes, section 6.4). Payloads never carry credentials. Disconnect, in one transaction: null `secrets_sealed`, revoke the connection's API keys, cancel pending deliveries; then call the vendor's revoke endpoint as a best effort | SA M6 |

Credit arithmetic for the default polling (ASSUMPTION: two Get Records calls per tick): 96 ticks × 2 × 3 credits = 576 credits a day, about 12% of the Free plan's 5,000.

---

## 6. Outbound: events, webhooks, feed, CSV

### 6.1 How events are created (changed)

**FACT (code read).**
- `VoiceSessions.apply` writes provider data in one transaction, runs the post-call extractor outside any transaction, may write a filled summary in a second transaction, then publishes in-process events; it runs again on every webhook, reconcile and results-page open (`JAVA/voice/VoiceSessions.java` lines 505-551).
- The scheduled `expireStale` only sets stale sessions to `ended`; it fetches nothing (lines 263-271, 678-687). Reconcile runs only when a person ends a call or opens the results page (`JAVA/hiring/HiringController.java` line 271). So a lost provider webhook is repaired today only by a person looking.
- `markFailed` and the `call_initiation_failure` webhook branch publish no event (lines 354-358, 649-666).
- `Jobs.updateStatuses` returns a row, and the controller audits it, even when the stage did not change (`JAVA/hiring/Jobs.java` lines 255-270; `HiringController.java` lines 362-396).
- `Db.inOrg` always opens a new transaction (`REQUIRES_NEW`, `JAVA/platform/Db.java` lines 28-30, 48).

**RECOMMENDATION: call outcomes are level-triggered from the call row.**

A phone call with a candidate (`agent_sessions.channel = 'phone'` and `voice_sessions.candidate_id` set; browser test calls never emit) is **settled** when:
- its status is `ended` or `failed`, **and**
- `ended_at` is more than 3 minutes ago (time for the post-call extractor to finish), **and**
- it has a summary or answers, **or** a `failure_reason`, **or** `ended_at` is more than 90 minutes ago (the background reconcile has given up).

The 60-second tick, for each org with a live connection, runs two steps:

1. **Background reconcile.** For phone calls with a candidate and an `external_conversation_id`, status `ended`, no summary, no answers and no `failure_reason`, ended 3 to 60 minutes ago: enqueue `reconcile_call` (key `reconcile:<voiceSessionId>`). The handler calls a new org-scoped `VoiceSessions.reconcileSystem(org, vsId)` (fetch + the existing `apply(org, null, ...)`); if there is still nothing and the call ended less than 60 minutes ago it throws to retry with backoff; otherwise it returns.
2. **Outcome sweep.** For settled calls that ended in the last **7 days** whose `result_emitted_hash` differs from `md5(status, failure_reason, summary, structured_answers)`: in one transaction, `UPDATE voice_sessions SET result_emitted_hash = <hash>, result_version = result_version + 1 WHERE id = ? AND result_emitted_hash IS DISTINCT FROM <hash> RETURNING result_version`, and, only if a row came back, `Events.emit(sql, 'call.ended', ...)` with `{version}`. Two replicas running the tick at once cannot both emit: the second update finds the hash already set.

Consequences:
- **One `call.ended` per call** in the normal case. A second version appears only when the result changes after it was sent (a provider webhook more than 3 minutes late, or a result fetched after "result unavailable"). Bodies always show the call's current state; receivers keep the latest version.
- **Unanswered and failed calls** emit, with their outcome.
- **No duplicate after the 30-day purge:** the dedupe state is on the call row, and the sweep never looks further back than 7 days.
- **Nest-written results are caught too**, because the sweep reads the database, whichever API wrote the row.
- `apply` itself does not change.

Body outcome: `failure_reason` when set; otherwise `completed` when there is a summary or answers; otherwise `result_unavailable` ("We couldn't get this call's result. Open the candidate in HRVoice to try again.").

**Stage changes are a true outbox.** Inside `Jobs.updateStatuses`, in the same `if (!previous.equals(new))` branch that runs the UPDATE, and only when the org has a connection that is not disconnected: `Events.emit(sql, 'contact.stage_changed', ...)` with `{from, to, decidedByUserId}`. No-op changes emit nothing. `Events.emit` takes the caller's `Db.Sql` so the event commits or rolls back with the stage. The free-text reason is **not** sent outside in MVP (it is recruiter free text and could hold anything), so `updateStatuses` does not need a new parameter.

**Ordering lock.** `Events.emit` first runs `select pg_advisory_xact_lock(hashtextextended('events:' || org, 0))` on the caller's transaction, then inserts. The lock is released only at commit or rollback (FACT, https://www.postgresql.org/docs/current/explicit-locking.html: transaction-level advisory locks "are automatically released at the end of the transaction"), so inside one org a later event cannot take a `seq` until the earlier emitting transaction has finished. At SMB volume the wait is a few milliseconds.

**Fan-out.** The tick creates `integration_deliveries` rows (`ON CONFLICT DO NOTHING`) for new events and each subscribed connection, and enqueues `deliver` / `push_note` jobs. After a stage-change request commits, the controller nudges the tick for that org (best effort, in memory); the tick is the guarantee. Stage events create no ATS deliveries: ATS stage write-back is level-triggered (section 7).

**Use-case gate.** Emission and fan-out happen only when the use case's `actions.integrations` is `true` (renamed from `webhook`; set to `true` for hiring when the core ships). One flag means "results and decisions of this use case may leave HRVoice through a connection". Stage write-back additionally needs the per-connection opt-in.

### 6.2 The one serializer (`ExternalPayloads`) and the one export rule (changed)

FACT: the summary is advice-scrubbed only in the controller (`JAVA/hiring/HiringController.java` lines 247-255); `Jobs.results` returns the stored text as is (CR F21).

`ExternalPayloads` builds every external body **at send or read time** from current rows, for a named principal:
- the API key (feed, `/v1` results), the connection's `created_by_user_id` (webhooks, ATS notes), or the signed-in person (results CSV);
- using that principal's **current** permissions, intersected with the connection's include flags.

**One export rule everywhere:**
- Call **content** (summary, answers) is included only if the principal holds `calls.read_transcript` **and** `candidates.export`.
- Contact PII (phone, email) is included only with `candidates.read_pii` as well. It is never included in webhooks or the feed.
- Otherwise the body says what happened (outcome, times, ids, stage) without content.

Other rules:
- It runs `AdviceGuard.scrub` on the summary and lists answers in the job's must-ask order with "not answered" for gaps.
- It has no field for `fitPercent`, coverage, score, rating or recommendation.
- A merge-blocking test fails if any outbound schema contains `fitPercent`, `score`, `rating`, `recommend` or `coverage`, or if a principal without the content permissions receives `summary` or `answers`.

### 6.3 Webhook body (changed)

```json
{
  "id": "6f1e…",                       // = webhook-id header; receivers dedupe on it
  "type": "call.ended",
  "seq": 1042,                         // per-org order; webhooks may arrive out of order, the feed is ordered
  "occurredAt": "2026-10-03T05:32:00Z",
  "useCase": "hiring",
  "data": {
    "job":       { "id": "…", "externalId": "REQ-12" },
    "candidate": { "id": "…", "externalId": "APP-991", "stage": "new" },    // stage at send time
    "call":      { "id": "…", "version": 1, "outcome": "completed",
                   "startedAt": "…", "endedAt": "…", "durationSeconds": 372 },
    "answers":   [ { "question": "Notice period", "answer": "30 days" } ],  // content rule, 6.2
    "summary":   "…",                                                          // content rule, 6.2
    "links":     { "candidate": "https://<app>/jobs/…/candidates/…" }
  }
}
```

`contact.stage_changed` carries `data.change = { from, to, decidedBy: { id, name }, at }` plus the same `job` and `candidate` blocks. A person can undo a decision; the undo arrives as a second `contact.stage_changed`. Receivers that trigger something irreversible should act on `candidate.stage` or wait a minute. Headers per Standard Webhooks: `webhook-id`, `webhook-timestamp`, `webhook-signature: v1,<base64 HMAC-SHA256 of id.timestamp.body>`, secret `whsec_` + 24-64 random bytes, one secret per endpoint, 24-hour overlap on rotation (FACT, https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md).

### 6.4 Delivery, failure and SSRF (changed)

- 2xx = sent. 408, 429, 5xx and network errors = retry. Other 4xx = record and stop.
- **Circuit breaker per connection.** After 3 consecutive failed sends the connection is `needs_attention` and admins get one email. While `needs_attention`, a `deliver` job sends only if no attempt was made on that connection in the last 5 minutes (a probe); otherwise it returns `Snooze(300)` without any HTTP and without using an attempt. A successful probe resets the connection to `active`. After 24 hours in `needs_attention` the connection is `paused`, and deliveries snooze until a person presses Retry. The events feed covers anything lost beyond 30 days.
- **Timeouts:** connect 3 s, whole call 10 s; response body capped at 64 KB and never logged.
- **`SafeHttp`** (Dev slice).
  - FACT: OkHttp 4.12.0 is already a compile-scope dependency, brought in by `com.google.genai:google-genai` 1.37.0 (`mvn -o dependency:tree`, run 2026-10-03). Its `Dns` interface "Returns the IP addresses of `hostname`, in the order they will be attempted by OkHttp" (https://raw.githubusercontent.com/square/okhttp/parent-4.12.0/okhttp/src/main/kotlin/okhttp3/Dns.kt).
  - So a custom `Dns` that resolves with `InetAddress.getAllByName` and throws if **any** returned address is loopback, site-local (RFC 1918), link-local (including 169.254.169.254), CGNAT 100.64.0.0/10, 0.0.0.0/8, multicast, `fc00::/7` or IPv4-mapped IPv6 makes the check and the connection use the **same** resolution. The checks use `InetAddress` methods (`isLoopbackAddress`, `isSiteLocalAddress`, `isLinkLocalAddress`, `isAnyLocalAddress`, `isMulticastAddress`) plus explicit prefix checks for the ranges they do not cover. SNI and certificate checks still use the hostname.
  - FACT: OkHttp skips `Dns` for IP-literal hosts (`RouteSelector.kt` line 163 in 4.12.0: `if (socketHost.canParseAsIpAddress()) listOf(InetAddress.getByName(socketHost))`). Therefore `SafeHttp` **refuses URLs whose host is an IP literal**, and sets `proxy(Proxy.NO_PROXY)`, `followRedirects(false)` and `followSslRedirects(false)`. HTTPS only.
  - Declare `com.squareup.okhttp3:okhttp` as a direct dependency at the version already shipped, so an upstream change cannot remove it silently. This adds no new artifact to the build.
  - The JDK `HttpClient` has no per-client resolver hook, and Spring's OkHttp request factory is deprecated, so `SafeHttp` uses OkHttp directly (ASSUMPTION based on Spring Framework 6.1 deprecation notes, unverified in this pass).
  - The dev-only `ALLOW_PRIVATE_WEBHOOK_TARGETS` flag makes `Env` refuse to boot when `COOKIE_SECURE=true` (precedent: `Env` already refuses to boot with the migrator role, `JAVA/platform/Env.java` lines 160-163).
  - "Send a test event" is limited to 5 a minute per connection and reports only "reached / not reached / rejected (code)".
  - FACT (why this matters): API, Postgres and web share one VPS (`BRD's/10_ADRs/ADR-006-hosting-deployment.md` line 143).

### 6.5 Events feed (changed)

`GET /v1/events?after=<cursor>&types=` returns this org's `integration_events` with `seq > after`, ordered by `seq`, at most 200, 30-day window, bodies built by `ExternalPayloads` for the calling key.
- The cursor is an opaque encoding of `seq`. It does not reuse `platform/Cursor`, which is `(createdAt, id)` (FACT, `JAVA/platform/Cursor.java`).
- The contract: **at-least-once, ordered by `seq` within your workspace, gaps in `seq` are normal** (FACT: sequence values are not reclaimed on rollback, https://www.postgresql.org/docs/current/functions-sequence.html).
- Correctness rests on the per-org emit lock in section 6.1. A merge-blocking test runs two concurrent emits in one org, commits the later one first, and asserts that a poller sees both.

### 6.6 Public REST API v1 (Dev slice; changed)

| Route | Permission | Notes |
|---|---|---|
| `GET /v1/jobs` | `jobs.read` | keyset paginated; includes `externalId` |
| `PUT /v1/jobs/by-external/{externalId}` | `jobs.create` | **Create if missing.** Body `{title, description}`; the description is saved the way the job page saves pasted JD text (up to 40,000 characters, FACT `JAVA/hiring/HiringController.java` line 155). An existing job is returned unchanged with `"created": false`. No status, no later edits (section 4) |
| `PUT /v1/candidates/by-external/{externalId}` | `candidates.create` + `candidates.update` | Body `{job: {id} \| {externalId}, fullName, phone, countryCode?, email?, resumeText?}`. Same validation as CSV import; returns the row plus issues; a replay returns `200` with the existing row. Never adopts an unlinked row: a phone already on the job gives the CSV issue `duplicate_on_job`, which CSV import already reports to any holder of `candidates.create` |
| `POST /v1/candidates:batch` | `candidates.create` (+ `candidates.update` for rows with `externalId`) | Body `{job: {...}, rows: [{externalId?, fullName, phone, ...}]}`, up to 200 rows, or `text/csv` with `?jobId=` or `?jobExternalId=`. Rows with `externalId` are upserts. Per-row result; savepoint per row; never `409` |
| `GET /v1/candidates/{id}/results` | `candidates.read` + `jobs.read`; content per section 6.2 | No provider reconcile side effect |
| `GET /v1/events` | `candidates.read` + `jobs.read`; content per section 6.2 | Section 6.5 |

- **Identity:** see section 10. Keys are accepted **only** on `/v1`, only in the `Authorization: Bearer` header (never in a query string: `AuthInterceptor` writes the full URL, query included, into audit metadata, FACT `JAVA/authz/AuthInterceptor.java` line 52). `/v1` ignores cookies, so CSRF and CORS do not apply; cookie routes ignore bearer headers. The `/backend/:path*` rewrite also exposes `/backend/v1/...` on the web origin (FACT, `apps/web/next.config.mjs` line 22); with cookies ignored that is harmless.
- **Ingress:** Caddy (FACT, `BRD's/10_ADRs/ADR-006-hosting-deployment.md` line 147) routes `api.<domain>/v1/*` straight to the Java process, with `TRUST_PROXY=true` so `EdgeFilter` sees the client address (FACT, `JAVA/platform/Env.java` line 93, `EdgeFilter.java` line 87).
- **Rate limit:**
  - Requests whose bearer hash belongs to a key that `AuthResolver` validated in the last 5 minutes (a small in-memory set) use a per-key fixed window **instead of** the per-IP window.
  - Every other request, including unknown or failed keys, stays on the per-IP window.
  - So tenants sharing an iPaaS egress IP do not throttle each other, and random tokens cannot dodge the IP limit (FACT, the current limiter is per IP and runs before auth, `JAVA/platform/EdgeFilter.java` lines 55-83).
  - `429` carries `Retry-After`.
- **Audit:** every `/v1` write records one audit row (`api.job_created`, `api.candidate_upserted`, `api.candidates_batch` with counts) with `apiKeyId` in metadata.
- Errors keep `{code, message, request_id, errors?}`; ISO-8601 UTC; a hand-written OpenAPI file; version in the path; never change a field's meaning inside a version.

### 6.7 Results CSV export (slice A; changed)

One button on the job's candidates board. Each row is built by `ExternalPayloads` for the exporting person:
- always: stage, latest call outcome, call time, duration and a link;
- with `calls.read_transcript`: each must-ask answer as a column and the scrubbed summary;
- with `candidates.read_pii`: phone and email.

Gated by `candidates.export` (the route) and audited as a sensitive read. Cells starting with `= + - @` are escaped. A custom role holding `candidates.export` without `calls.read_transcript` gets no content columns (FACT, custom roles are live, `BRD's/10_ADRs/ADR-009-administrators-manage-custom-roles.md`).

### 6.8 Queue changes (new; first slice that needs them)

All FACT about today's code is from `JAVA/jobs/JobQueue.java`:
- Today there are 2 worker threads for every kind and tenant (lines 50-54).
- `runScope` drains one org until it is empty, 10 jobs per claim (lines 116-134).
- `poll()` runs `runDue()` inline on Spring's scheduler thread (lines 87-90). No `TaskScheduler` or `spring.task.scheduling` setting exists in the app (grep), so Spring Boot's single-thread default is shared with `VoiceSessions.expireStale` and `DocumentProcessor` (line 248).

Changes:
1. **Outbound lane.** Kinds `call` and `integration` are claimed only by a separate 2-thread executor, never by the existing workers and never on the scheduler thread. Within the lane, a pass claims at most **one job per org** and moves on, repeating while any pass ran something, so one tenant's backlog cannot hold the lane. `email` and `document` behave exactly as today.
2. **`Snooze(seconds)`.** A handler may return a snooze. `execute()` then sets the same row back to `queued` with `run_at = now() + seconds` and gives back the attempt. This one mechanism serves page chaining, rate-limit pauses, circuit-breaker waits, the stage-write hold and calling-hours waits. It replaces v1's `delaySeconds` overload.
3. **Scheduler pool.** Set `spring.task.scheduling.pool.size: 3` so the four `@Scheduled` loops do not wait on each other. `IntegrationScheduler.tick()` only hands work to the lane.
4. **Unknown kinds** throw a clear error at `enqueue` instead of a NullPointerException.
5. `/health` reports backlog per kind.

---

## 7. Two-way action architecture

```
Integration       integration_connections row (org-scoped, RLS): who connected it (the sending principal), status, config
   ▼
Connector         AtsPort adapter + ConnectorSpec: auth type, readable objects, declared actions
   ▼
Available actions spec.actions ∩ enabled in connection.config ∩ use case actions.integrations
   ▼
Automation        fixed rules in code, not a rule builder:
                    call.ended (a settled call, a fact)        → ADD_NOTE   (always on for a connected ATS)
                    a person's decision: reviewed / declined   → SET_STAGE  (opt-in, customer-mapped, level-triggered)
                    custom connection                          → signed webhook + feed (section 6)
   ▼
Agent             the voice agent never calls an action. It receives only the compiled job, questions and knowledge
                  (CallContextCompiler) and produces facts. It knows nothing about any connector.
```

**Provider independence of the core agent.** FACT: data reaches a live call only once, at provisioning, and the live agent gets only `end_call`, `voicemail_detection` and `transfer_to_number` (`JAVA/engine/CallContextCompiler.java` lines 26-37, 220-237). A connector changes rows in `jobs` and `candidates`; the compiler reads those rows as today.

**Where the never-recommend rule is enforced (three places, all testable):**
1. **Content:** only `ExternalPayloads` builds outbound text (section 6.2).
2. **Trigger:** `SET_STAGE` sends only the candidate's current `screening_status`, and only `reviewed` or `declined`. That value is set only by a person through the stage routes (FACT, the only Java write of `screening_status` is `JAVA/hiring/Jobs.java` line 264, reached from the two stage routes; backend map §6.2). API keys cannot change stages. A call outcome never moves an ATS status. Model output never selects or triggers an external write (FACT, prompts are not a security boundary, `BRD's/11_PERMISSION_MATRIX.md` line 149).
3. **Target:** adapters expose only `addNote` and `setStage`; no generic field update; never a score, rating, scorecard or recommendation field.

**Stage write-back (changed: level-triggered, held, current stage only).** Off by default. The customer picks the target status for "Moved forward" and for "Not moving forward" from their live status list.

- **Finding work:** the tick finds linked candidates where the current stage is `reviewed`/`declined` and differs from `pushed_stage`, or where the current stage is `new`/`screening` while `pushed_stage` is `reviewed`/`declined`. It enqueues `push_stage` with key `stage:<candidateLinkId>`, so there is at most one queued push per candidate.
- **The handler** runs these steps in order:
  1. **Hold.** If the candidate's last `contact.stage_changed` is less than 2 minutes old, return `Snooze` for the remainder. The in-app Undo lasts 8 seconds (FACT, `apps/web/components/ui/toaster.tsx` line 78, `duration: 8000`; Undo re-posts the previous stages with reason "Undone", `apps/web/app/jobs/[id]/candidates/page.tsx` lines 680-698). A decision undone or corrected within 2 minutes therefore never reaches the ATS.
  2. **Read the current stage.** If it equals `pushed_stage`, there is nothing to do.
  3. **Forward** (`reviewed`/`declined`):
     - Re-read the application's ATS status.
     - If it differs from `remote_status_seen` (someone changed it in the ATS since our last read), do not overwrite. Add a note "Moved forward by Priya Sharma in HRVoice; status left unchanged because it was changed in Zoho Recruit", and set `pushed_stage` to the current stage.
     - Otherwise save `stage_seen_at_push` = the ATS status before writing, call `setStage` with the comment "Moved forward by Priya Sharma in HRVoice", and set `pushed_stage`.
  4. **Back** (`new`/`screening` after a push): if the ATS status is still the one we set, restore `stage_seen_at_push`, clear `pushed_stage`, and say so in the delivery line. If someone changed it in the ATS meanwhile, leave it and add a note.
- Because the handler always reads current state, retries and reordering cannot leave the ATS on an older decision. Stage changes made through Nest are caught by the same sweep.

**Notes (changed: one per call, a follow-up only if the result changed).** `push_note` runs for each `call.ended` version, including unanswered calls ("HRVoice called on 3 Oct, 11:02: no answer"). The marker is `HRVoice ref <session prefix>.<content hash prefix>`, and the adapter skips the write if that marker already exists. Since the body is built at send time, a late v1 delivery that already carries v2's content makes the v2 delivery a no-op. A real follow-up note is titled "Updated result for the call on 3 Oct, 11:02". With the 3-minute settle rule this is rare.

```
HRVoice screening call · Sales executive · 3 Oct 2026, 11:02 · 6 min
Outcome: Call completed            (or: No answer / Reached voicemail / Number not valid / Result unavailable)

What they said
- Notice period: 30 days
- Current location: Pune
- Expected salary: not answered

Summary
<summary after AdviceGuard.scrub>

Recording and full transcript: <sign-in link to the candidate in HRVoice>
A person on your team decides who moves forward. HRVoice does not score or recommend.
HRVoice ref 3f2a9c1e.a41b
```

**Later in-call actions** (for example booking an interview slot for the appointments module) are **not** reachable today. The live voice agent gets only provider system tools, and the tool gate needs a member `Actor` (FACT, `JAVA/engine/CallContextCompiler.java` lines 220-237; `JAVA/runtime/Tools.java` lines 19-26, 245-253). That path would need four things, and it stays Later:
1. a provider webhook-tool endpoint on our API;
2. a short-lived call-scoped token passed to the provider as a secret dynamic variable;
3. a call principal kind;
4. read-only tools with a timeout of 5 s or less and a spoken fallback.

Our server would call the ATS through the connection; the model never would.

---

## 8. MCP position

| Question | Position | Evidence |
|---|---|---|
| Should the voice agent call a customer's or vendor's MCP server during a live call? | **[Avoid]** | No approving human on an outbound call; candidate speech and ATS text are prompt-injection input; credentials would sit in the shared voice-provider workspace (AM M9, M12, A8, E2, E3) |
| Should sync use vendors' MCP servers? | **[Avoid]** | User-OAuth, per-user rate-limited, beta, and wrapping the REST API anyway; no delivery guarantees (AM V1-V7, M6) |
| Should we run our own MCP server? | **[Later]**, triggered by a paying customer asking to use HRVoice from Claude, ChatGPT or Copilot | FACT: current revision 2026-07-28; remote HTTP MCP requires OAuth 2.1 resource-server behaviour with RFC 9728 metadata, audience-bound tokens and no token passthrough (https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization). FACT: the launch spec calls MCP "a façade later" (`docs/superpowers/specs/2026-09-16-hiring-production-launch-design.md` line 72) |
| If triggered, what first? (changed) | A thin **read-only** facade that calls the **same services** as the web routes (`Jobs` candidate list by state, `stageHistory`, `ExternalPayloads` for results), not only the six `/v1` routes, which have no candidate list or stage history. It uses the same interceptor, permissions, PII rules and export rule. A key-based read-only pilot only for hosts that accept a static bearer header (which hosts do is unverified); spec-conformant OAuth before any write tool, and write tools only with user-delegated OAuth so each stage move traces to a person | AM review item 5 |
| Placeholder MCP UI or claims | **[Avoid]** | FACT: "Shipping fake webhook/MCP UI" is a listed non-goal (launch spec line 88) |

---

## 9. Custom and legacy systems: the hierarchy

Stop at the first rung the customer can do. Rungs 1-3 depend on the developer surface, which ships only when a pilot needs it (section 13).

| Rung | Shape | Who it fits | Phase |
|---|---|---|---|
| 1 | Their script or iPaaS pushes to `/v1` and polls `/v1/events` (or receives our webhook) | any custom or on-prem app with one developer; Pabbly, Zapier, Make, n8n users | Dev slice (curl + a small Python reference script, no SDK) |
| 2 (changed) | Their cloud bus pushes HTTPS to `POST /v1/candidates:batch` | AWS EventBridge API destinations, Kafka HTTP Sink | Dev slice. The batch route takes the job and each row's external id **in the body**, so an input transformer can map one event to one request with no lookup first. It answers within about 1 s and never returns `409`, which EventBridge retries (FACT: 5-second client timeout; retries `401, 407, 409, 429, 5xx`, https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-api-destinations.html). SNS and Pub/Sub envelopes V2 |
| 3 | File | systems that only export | MVP: UI CSV (exists), results CSV export (slice A); `text/csv` on the batch route (Dev). SFTP pull Later, paid. Hosting our own SFTP Avoid |
| 4 | They expose one narrow HTTPS endpoint through their own gateway or tunnel | enterprise wanting us to write into their system | Later; reuses `SafeHttp` |
| 5 | Read-only database view | enterprise with only a database | Later, paid exception with a DPA; never write, never CDC |
| 6 | An agent we ship into their network | | Avoid |
| 7 | Read-write DB, CDC, consuming their brokers, site-to-site VPN | | Never |

---

## 10. Multi-tenancy and identity (changed)

- Every new table: forced RLS on `organization_id = current_org_id()`; listed in `StructuralTest`; no BYPASSRLS; `Db` keeps "no method that disables row-level security" (FACT, `JAVA/platform/Db.java` line 33).
- Tenant is resolved only from server state: the API key hash (narrow SELECT-only lookup), the signed-in member's session (OAuth callback: the `state` hash is compared on that member's org's `connecting` row), or, in V2, an inbound webhook connection (order in section 11.1 item 8). Never from an `organization_id` or `job_id` in a payload.
- **Performance isolation** (new): the outbound lane, one job per org per pass, the circuit breaker and per-key rate windows (sections 6.4, 6.6, 6.8). RLS gives data isolation; these give fairness.

**API key principal: the key acts as its creator, re-checked on every request.**

FACT (why not `Db.NIL`, as v1 said):
- `audit_events.actor_user_id` and `jobs.created_by_user_id` both have foreign keys to `users` (`MIG/0000_initial_schema.sql` line 132; `MIG/0015_hiring_desk_foundation.sql` line 43).
- `AuditService.record` stores the actor id it is given and maps only a Java `null` to `NIL` for the context wrapper (`JAVA/audit/AuditService.java` lines 36-45). Failures are logged and swallowed (lines 56-59).
- `Jobs.create` writes `actor.userId()` into `created_by_user_id` (`JAVA/hiring/Jobs.java` lines 99-107).
- `Actor` requires a membership and role (`JAVA/authz/Actor.java`).
- So a NIL principal would fail job creation and silently lose every key's `authz.sensitive_access` audit row.

Design:
1. `AuthResolver`, only for paths under `/v1` with `Authorization: Bearer hv_...`:
   - hash the key, read the key row through the narrow lookup, reject it if revoked, expired, or if its connection is not `active`;
   - call the **existing** `membership(createdByUserId, organizationId)`. If the creator is no longer an active member, return no context (401).
2. Effective permissions = **key permissions ∩ the creator's live permissions**. Demoting the creator narrows the key on the next request; removing the creator stops it. This is the same posture `AuthResolver` already has for sessions (FACT, header comment, lines 12-21).
3. `AuthContext` gains one nullable field, `apiKeyId`. `userId` is the creator, so every existing service, foreign key and audit path works unchanged. `AuthInterceptor` adds `apiKeyId` to the metadata of `authz.denied` and `authz.sensitive_access`.
4. No synthetic user or membership row is created for keys.
5. Owner-only checks (`Actor.isOwner()`, used in `team/`) are unreachable with a key, because keys only work on `/v1`.
6. A key never supplies `decidedBy`: there is no stage route in `/v1`.
7. A key whose creator left shows "Needs attention: the person who created this key no longer has access. Create a new key."

**Workers** (sync, delivery, reconcile, dial) run `inOrg(org, Db.NIL)` and pass **`null`** to `AuditService`, which stores NULL. This is the existing convention (FACT, `VoiceSessions.webhook` calls `audit.record(org, null, ...)`). They never write `Db.NIL` into a column.

**The connection's sending principal** (`created_by_user_id`) follows the same rule: its live permissions decide content (section 6.2). If that person leaves or loses `integrations.update`, the connection goes to `needs_attention` and sends nothing until an admin presses "Take over", which re-saves the connection as theirs and is audited.

**The dial job** (slice A2) rebuilds the clicking person's `Actor` from their live membership when it runs. If they no longer hold `calls.initiate`, the queued call is `skipped`.

---

## 11. Security

### 11.1 MVP gates

1. **`Sealer`** generalised from `Notifications.seal`: AES-256-GCM, 12-byte random IV, key from a new env var `INTEGRATIONS_KEYS` (`1:<base64>,2:<base64>`), never derived from `BETTER_AUTH_SECRET` (FACT: rotating it already kills sealed mail, `apps/api-java/MIGRATION_STATUS.md` line 358), output `k<version>.<base64>`, AAD = `organization_id:connection_id:secrets`. Do not reuse the plaintext `accounts.*_token` columns.
2. **API keys:**
   - format `hv_live_` + 32 random bytes; SHA-256 stored; shown once; UI prefix `hv_live_` + 6 characters;
   - presets: "Send candidates in" (no content, no contact details, the default), "Read results" (adds `calls.read_transcript`, `candidates.export`), "With contact details" (adds `candidates.read_pii`);
   - never `users.*`, `roles.*`, `integrations.*`, `organization.*`, `billing.*`;
   - effective permissions intersected with the creator's live permissions (section 10);
   - revocable; optional expiry; `last_used_at`; creating one needs `integrations.create`; two keys may be live during rotation;
   - header only, `/v1` only. Disconnecting the `custom` connection revokes its keys in the same transaction.
3. **Who may connect what:** connect, edit, Retry and disconnect need `integrations.create/update/delete` (Owner, Administrator). Recruiters (who hold only `integrations.read`) see the status and "Ask a workspace admin". Content leaves only under the one export rule (section 6.2), checked at send time against the sending principal.
4. **OAuth client (slice E):**
   - authorization code + PKCE (S256);
   - one-time `state`: its hash and a 10-minute expiry on the `connecting` row, the verifier inside `secrets_sealed`, both cleared on first use;
   - exact redirect URI; narrowest scopes; data-centre hosts from a fixed allowlist;
   - token refresh under `pg_try_advisory_xact_lock`, held only for the refresh call;
   - `invalid_grant` → `needs_attention`;
   - separate client ids per environment (FACT, RFC 9700 https://datatracker.ietf.org/doc/html/rfc9700).
5. **Outbound:** Standard Webhooks signing; `SafeHttp` (section 6.4); bodies per the export rule.
6. **No secrets or PII in logs or `last_error`:** adapters throw a code plus a plain sentence (FACT, `background_jobs.last_error` stores the exception message, `JobQueue.java` lines 149-153).
7. **Audit** (ids and counts only): `integration.connected`, `.updated`, `.taken_over`, `.disconnected`, `.reconnect_needed`, `.sync_completed`, `.candidate_adopted`, `.candidates_anonymised`, `.pushed`; `api_key.created/revoked`; `api.*` writes (section 6.6); results CSV export as a sensitive read.
8. **Inbound webhooks (V2), in this order:**
   1. connection id from the path;
   2. a narrow SELECT-only lookup that returns only the org and the sealed inbound secret;
   3. verify on raw bytes with a constant-time compare;
   4. timestamp (±5 minutes where present) and delivery-id dedupe;
   5. only then `inOrg` writes, fetch-on-notify.

   Per-connection secrets make "look up only after verifying" (v1 wording) impossible, so the lookup must reveal nothing but the secret and org.
9. **Untrusted text:** ATS- and API-sourced text (JD, resume) is untrusted input. Lengths are capped. The JD is create-only on every machine path, so a key cannot rewrite what the agent says to candidates (FACT, the JD feeds the compiled prompt, section 4). `AdviceGuard` scrubs post-call text (summaries, chat answers); it does **not** guard live speech, and nothing here claims it does.
10. **Retention and DPDP (changed scope):** these apply before the **first external connection of any kind** (the core or the developer surface going live), not only before the named connector:
    - a decided retention period with a working purge job for pulled-but-never-called candidates;
    - automatic anonymisation after remote deletion (section 5);
    - a customer DPA;
    - a breach runbook.

    ASSUMPTION: we act as a DPDP data processor; needs a lawyer. FACT (secondary): DPDP Rules 2025 notified November 2025, most obligations from about May 2027 (SA R12; Gazette text unverified).
11. **Voice-provider webhook:** narrowing the ±30-minute window waits until we confirm how the vendor timestamps retries (unverified). Replays are harmless downstream, because the outcome sweep emits only when the call's content hash changes.

**Merge-blocking tests** (one each):
- RLS drift for new tables.
- `Sealer` round trip; a wrong AAD fails; a wrong key version fails.
- Webhook verify rejects a bad signature, a stale timestamp and a duplicate id.
- A job against a revoked connection does nothing.
- The forbidden-field and export-rule test (section 6.2).
- `SafeHttp` rejects a private IP literal, a metadata address, and a **hostname that resolves to a private address**.
- An API-key read of a PII field writes `authz.sensitive_access` with `actor_user_id` = creator and `metadata.apiKeyId`; `PUT /v1/jobs/by-external` creates a job; a key whose creator was removed gets 401.
- **Lost provider webhook:** the session is ended with no result, reconcile applies it, and `call.ended` is emitted. Provider unreachable: `result_unavailable` is emitted after the deadline.
- **Purge:** delete all `integration_events`, re-run `apply` and the sweep on a 40-day-old call, and nothing is emitted.
- **Feed ordering:** two concurrent emits commit out of order; a poller sees both.
- **Undo:** decide, undo within 10 s, and no ATS write happens (`FakeAts`).
- **Isolation:** a receiver that hangs does not delay an email job.

### 11.2 Enterprise (Later, only when a deal requires it)

Unchanged from v1: KMS envelope encryption once hosting moves to AWS `ap-south-1`; customer-managed keys; SSO/SAML; IP allowlists on keys; a documented static egress IP; an egress proxy (e.g. Smokescreen) in front of `SafeHttp`; rungs 4-5 under a signed DPA.

---

## 12. Onboarding flow

All in one new Settings tab, **"Connected systems"**, shown with `integrations.read`; buttons need `integrations.create/update/delete`. Status uses the "Calling number" card pattern (FACT, `apps/web/components/settings/sections.tsx` lines 238-318). The server returns stable codes and the web maps them to sentences, because `apps/web/lib/errors.ts` (line 77) discards messages containing "webhook", "token", "api key" or "payload". Before shipping:
- rename the agent page's existing "Integrations" group for test tools (FACT, `apps/web/app/agents/[id]/page.tsx` lines 700-735);
- unhide the Integrations permission group (`apps/web/components/settings/access.ts` line 109).

**Definition of done for every integration slice** (new): the website FAQ answer on ATS integration (FACT, currently "Not yet", `apps/web/components/site/faq.tsx` lines 53-55) and the Tools page "Your own systems: Later" card (`apps/web/app/tools/page.tsx` lines 106-119) say exactly what works after that slice, and nothing more (FACT, launch spec anti-pattern line 88).

### 12.1 "Your own system" (Dev slice; for a developer or an iPaaS user)

1. **Create a key.** Name it, pick one preset (default "Send candidates in"). The key is shown once with a copy button, the base URL and a link to the reference script.
2. **Send results to your system.** Paste an HTTPS URL, tick events (default `call.ended` and `contact.stage_changed`), and choose whether to include summary and answers. That choice is disabled unless the person holds `calls.read_transcript` and `candidates.export`. Save shows the signing secret once.
3. **Send a test event** (at most 5 a minute). Shows "reached", "not reached" or "rejected (code)".
4. **Status card:** "Last sent 3 minutes ago", "2 waiting to send", "Couldn't send since 10:40" with Retry (admins), "Paused" with Retry, or "Needs attention: the person who set this up no longer has access" with Take over. A list of the last 50 deliveries.

### 12.2 "Zoho Recruit" (slice E; for a non-technical admin)

| Step | What the person sees | What we decide |
|---|---|---|
| 0 | Empty state: "Bring candidates in from the hiring system you already use, and send each call's results back to it." Only systems that really work are listed | |
| 1 | "We'll read" (the job openings you pick and their candidates: name, mobile, email, resume text, status) / "We'll write" (a note after each call; their status only if you turn that on). "We never send a score or a recommendation." | Scopes, fixed and narrow |
| 2 | Redirect to Zoho; sign in; approve. India data centre handled from the response | |
| 3 | Pick jobs (none pre-ticked); link each to an existing HRVoice job, or create a new job with the title and the **full** JD copied through the existing JD-text path (up to 40,000 characters) | Title matching pre-selects a link |
| 4 | "Bring people in when their status is …", read live from their list | Pre-select the first status containing "new", "screen" or "applied", else nothing |
| 5 | "Send decisions back?" switch, **off**; when on, pick the status for "Moved forward" and for "Not moving forward", with the line "Decisions are sent 2 minutes after you make them, so you can undo." | Note write-back is always on |
| 6 | "Check the connection": read-only; "We can see 3 jobs and 41 people at Applied" (names only for holders of `candidates.read_pii`) | |
| 7 | "Start bringing people in" → "New people will show up on your jobs within 15 minutes". **Then** (new) a list of each newly created job with one action, "Add must-ask questions and an agent", because a job with neither cannot be called | Interval and budget |

States: **Connected** ("Last checked 4 minutes ago. 3 jobs linked. Connected by Priya."), **Needs attention** (access withdrawn; a mapped status renamed; the person who connected it left), **Paused until 4:10 pm** (daily limit), **Not connected**. Issues line: "3 people couldn't come in: number not valid. Fix them in Zoho Recruit." Reconnect keeps all choices. Disconnect confirms with `ConfirmDialog` and keeps everything already in HRVoice.

Day to day:
- board rows say "From Zoho Recruit";
- linked contact fields are read-only with "Edit this in Zoho Recruit";
- people closed in the ATS show "Closed in Zoho Recruit" (one new status label) and are left out of "Not called yet";
- under each call, a delivery line: "Sent to Zoho Recruit at 11:02", "Waiting to send" or "Couldn't send" (Retry for admins);
- the decision footer says "Also sets their status in Zoho Recruit to '<their label>' in 2 minutes" when write-back is on;
- Settings > Activity gains plain sentences for connects, imports and sends.

Open: whether the customer's own system name may appear in the UI (founder decision 8). This draft assumes yes.

---

## 13. Scope

### 13.1 MVP, in order (changed)

Effort is for one engineer and is an ASSUMPTION, for ordering only.

| Slice | Contents | Gate | Effort |
|---|---|---|---|
| **0. Prerequisites** | E.164 stored form and `toE164` fix: first a read-only query listing rows that would collide on `(job_id, phone)` after normalisation; an operator merges or removes them; then the backfill runs, and it refuses to run while collisions exist. The web edit and import screens show and accept the stored form. Also: `ExternalPayloads` + forbidden-field and export-rule test; `Sealer` with `INTEGRATIONS_KEYS`; unknown-kind guard | Backfill only with the web pointed at Java (Nest still writes the old format) | 4-6 days |
| **A. Results CSV export** | Section 6.7 | none | 1-2 days |
| **A2. Call everyone not called yet** (new) | A button on the job board: "Call everyone not called yet (N)", needs `calls.initiate`, one `ConfirmDialog` with the count, calling hours and the remaining monthly budget (no invented cost estimate). It inserts `scheduled_calls` rows (`reason 'bulk'`, `requested_by_user_id`) for candidates in "Not called yet" with a phone and no open row. One `call` job per row (key `call:<scheduledCallId>`) runs in the outbound lane and does the following: <ul><li>rebuild the clicking person's `Actor` (section 10);</li><li>skip if the row was cancelled or the candidate was called, decided or closed meanwhile;</li><li>`Snooze` until the use case's calling window opens (FACT, `callPolicy.retry.window` 10:00-19:00 Asia/Kolkata, no Sundays, `usecases/hiring.json`; `CallOutcomes.nextAttempt` lines 89-108);</li><li>call the existing `startOutbound`, which keeps `BudgetGuard`, the concurrency and daily caps and the version lock;</li><li>on the concurrency cap, `Snooze(60)`; on the daily cap, `Snooze` to the next window;</li><li>on a validation error, `skipped`.</li></ul>The board shows "Queued to call" and "Stop queued calls". This is also the `scheduled_calls` dispatcher that V2 auto-retry and auto-call need | Founder decision 10a | 3-4 days |
| **Core** | Migration: `integration_connections`, `job_links`, `candidate_links`, `integration_events`, `integration_deliveries`, `voice_sessions` columns, `source` values, `integration` kind; `Events.emit` with the per-org lock; stage outbox in `updateStatuses`; `IntegrationScheduler` (reconcile, outcome sweep, fan-out, purge); `reconcileSystem`; outbound lane and `Snooze` (if A2 did not ship them); `actions.integrations` | Built **together with** the first of E or Dev; never on its own. ADR-010 written and ADR-008 accepted (or Nest's stage routes unreachable from the web) | 5-7 days |
| **E. First named connector** | OAuth client, `ZohoRecruitAts` + `FakeAts`, pulls, nightly reconcile, deletions and anonymisation, dial guard, notes, opt-in stage write-back, the 7-step UI | A pilot confirms Zoho Recruit (or names its system) | 3-4 weeks |
| **Dev. Developer surface** | `api_keys` and the `AuthResolver` branch, six `/v1` routes, per-key limit, ingress, `SafeHttp`, signing, feed, test event, delivery list, OpenAPI file, reference script, "Your own system" UI | A pilot confirms it will connect through its own developer or an iPaaS (FACT, this was the comparison's own condition, `docs/integrations/01-comparison.md` line 107) | 8-12 days |

Launch gates: the retention and DPDP items of section 11.1 item 10 before the first external connection; integrations only with the web pointed at the Java API.

### 13.2 V2

- A second connector chosen by pilot data (Keka Hire, a Google Sheet, Workable).
- Inbound vendor webhooks as re-fetch hints.
- Per-job "Call new people automatically", **only after** a written founder decision with legal advice. It reuses the A2 dispatcher (FACT: TRAI TCCCPR Second Amendment, https://trai.gov.in/sites/default/files/2025-02/Regulation_12022025.pdf; applicability to screening calls unverified).
- Background reconcile for orgs without a connection (one condition removed), if Home-queue accuracy needs it.
- Dial-time `dynamic_variables` with a minimal allow-list.
- Our own Zapier app.
- SNS and Pub/Sub envelopes.
- An internal dead-job view; per-key limits in Postgres once there is more than one replica.

### 13.3 Long term (Later)

Our own MCP server (section 8); a Kombo or Merge `AtsPort` once three or more ATSs are requested by paying customers; Greenhouse and Lever via partner programmes; Darwinbox; enterprise rungs 4-5; in-call tools (section 7, four prerequisites); section 11.2; a CRM contact/deal shape when SalesVoice or SupportVoice need it.

### 13.4 Avoid

Unchanged from v1: in-call MCP; MCP-based sync; direct DB access beyond the paid read-only exception; CDC; consuming customer brokers; our own on-prem agent; hosted SFTP; SDKs and widgets; a rules builder; a cross-vendor canonical schema or field-mapping editor; two-way editing of the same field; auto-rejecting people who did not answer; writing any score, coverage, rank, "qualified" or system-chosen stage anywhere outside; Freshteam and Naukri RMS connectors.

---

## 14. First real integration and how to test it without buying anything

### 14.1 Choice

- Slices 0, A and A2 help every customer now.
- **Zoho Recruit is the first named connector** if a pilot uses it. Why: self-serve OAuth, an India data centre, a documented REST API with incremental polling, and a free plan with API access. The evidence that Indian SMBs use it is vendor-written, so the founder confirms with pilots first.
- The developer surface is first only if a pilot has a developer or an iPaaS.

### 14.2 Testing without buying anything

- **Automated:** the existing JUnit 5 + Testcontainers suite plus the merge-blocking tests in section 11.1, using `FakeVoice` (lost-webhook and unreachable-provider cases) and `FakeAts` (Undo, rename, rate-limit).
- **Manual push-in:** `curl` and the reference Python script against a local Java API.
- **Manual push-out:** a local receiver that verifies Standard Webhooks signatures, reached with the dev-only private-target flag on.
- **iPaaS path:** self-hosted n8n, free edition (FACT, search result from n8n's docs, https://docs.n8n.io/deploy/host-n8n). Do not use Zapier for free testing (its webhook app is not on the free plan).
- **Zoho:**
  - a Zoho Recruit Free account in the India data centre (FACT: 1 active job, 5,000 API credits a day, no webhooks, https://www.zoho.com/recruit/plan-comparison.html);
  - one Web-Based OAuth client per environment (https://www.zoho.com/recruit/developer-guide/apiv2/register-client.html);
  - 5-10 test candidates using team members' own numbers with their consent.

  Not testable for free: Zoho webhooks; custom-status behaviour on paid plans; Keka, Greenhouse, Lever, Darwinbox.

---

## 15. Risks

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R1 | Pilots do not use Zoho Recruit (or any ATS); a connector is built for nobody | Medium / High | E and Dev are both gated on a pilot; 0, A and A2 serve everyone |
| R2 | Duplicate results or notes in a customer's system | Medium / High | Dedupe on the call row (compare-and-set), 7-day sweep window, note markers carry the content hash, `webhook-id` for receivers |
| R3 | Advice or a score leaks into an ATS | Medium / High | `ExternalPayloads` only, forbidden-field test, adapters with no generic write |
| R4 | Duplicate candidates and misdialed numbers from automated intake | High / High | Slice 0 E.164 with collision pre-check before any automated intake |
| R5 | A connection silently stops (revoked consent, oldest refresh token invalidated, plan downgrade, the connecting person left) | Medium / High | `needs_attention` state, one email to admins, "last checked" line, Take over |
| R6 | We exhaust a small customer's Zoho daily credits | Medium / Medium | Budget with write reserve, `If-Modified-Since`, polling slows first, "Paused until" |
| R7 | SSRF from a customer-supplied webhook URL into our VPS | Medium / High | `SafeHttp` with a filtering `Dns`, no IP literals, no proxy, no redirects; boot refusal for the dev flag |
| R8 | PII sprawl and DPDP exposure | High / High | Field allowlist; ids-only event rows; bodies built at send time; retention gate before any external connection; anonymisation after remote deletion; DPA and runbook |
| R9 | Pressure to auto-call imported candidates before consent and DND are settled | High / High | A2 needs one person's click per batch; auto-call is V2 behind a written founder decision |
| R10 | Nest and Java run side by side | Medium / Medium | Results and ATS stage write-back are level-triggered from the database and catch Nest writes; webhook/feed stage events are emitted only by Java, hence the gate in section 13.1 |
| R11 | Stage drift: a customer renames a status | Medium / Medium | Read the status list live; unmapped → "Needs attention" |
| R12 | The public API becomes a promise we cannot change | Medium / Medium | Six routes, versioned path, external ids scoped to a job, documented feed and webhook semantics |
| R13 | Failures are invisible | High / Medium | Per-connection status, issues line and delivery list; per-kind backlog in `/health`; dead-job view V2 |
| R14 | Vendor API churn | Certain over time / Medium | One connector until it has paying use; vendor code inside one adapter |
| R15 | A customer's own LLM ranks candidates from data we export | Medium / Medium (reputational) | Factual bodies; content only under the export rule; terms decided before MCP |
| R16 (new) | The hosted voice adapter's fetch path has never run live, and background reconcile depends on it (FACT, `apps/api-java/MIGRATION_STATUS.md` lines 89, 353) | Medium / High | `FakeVoice` tests for both paths; `result_unavailable` after 90 minutes so a customer is never left waiting; the settle and deadline values are tuned after the first live calls |
| R17 (new) | One tenant's dead endpoint or slow vendor delays others | Medium / Medium | Outbound lane, one job per org per pass, circuit breaker, 3 s / 10 s timeouts |

---

## 16. Founder decisions needed (details and evidence in `01-comparison.md`)

1. Where do the first five pilots keep candidates, and does any have a developer or a paid iPaaS? **This now decides whether E or Dev is built at all** (D1, D4).
2. Is pickup within about 15 minutes acceptable, and how many jobs does a pilot keep open? (D5, D6)
3. May keys or webhooks carry summary and answers, and only by explicit admin choice under the export rule? (D7, D8)
4. What goes into the ATS note: answers and scrubbed summary, or only a link? (D9)
5. Is it acceptable that ATS-linked contact fields are read-only in HRVoice? (D10)
6. May a stage change ever come from another system rather than a named person in HRVoice? (D11)
7. May "Not moving forward" set a reject status in the ATS (which may email the candidate), given the 2-minute hold? (D12)
8. May the customer's own system name ("Zoho Recruit") appear in the UI?
9. Retention period for pulled-but-never-called candidates and transcripts; the grace period before anonymising people deleted in the ATS; confirmation that we act as a DPDP processor; DPA. (D17)
10. Automatic calling of imported candidates: yes or no, and under what consent, hours and DND rules? (needs legal advice)
    - **10a (new).** Ship "Call everyone not called yet": one person's confirmed click queues calls for N people within calling hours. A legal check is needed on whether a queued batch counts as an "auto-dialer" under TCCCPR (unverified).
11. Price per SMB customer and whether "data stays in India" is a sales promise. (D19)
12. Will support and sales use cases reuse `jobs`/`candidates` or get their own tables? (D18)
13. (new) Is it acceptable that a key, or a connection's sending, stops when the person who created it leaves, until an admin creates a new key or takes the connection over?

## 17. Unverified items to check during the build

- Whether one Zoho `If-Modified-Since` call covers applications across all linked jobs.
- Zoho Change Status with `jobids` for custom statuses; Zoho data-centre token hosts for Indian accounts; whether Zoho notes can be listed cheaply for the marker check.
- How long after a call the voice provider's post-call webhook usually arrives; the 3-minute settle and 90-minute deadline are guesses until live calls are measured.
- Whether the voice provider re-signs retried webhooks with a fresh timestamp.
- Spring Framework's deprecation of its OkHttp request factory (the reason `SafeHttp` uses OkHttp directly).
- Which MCP hosts accept a static bearer header for custom connectors.
- Whether a queued, human-confirmed batch of calls is an "auto-dialer" under TCCCPR.
- Keka Hire write endpoints; Merge and Kombo data location; DPDP Rules wording against Gazette G.S.R. 846(E); whether 3001 is the Nest API in every environment.
