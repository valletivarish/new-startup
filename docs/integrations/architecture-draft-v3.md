# Integration architecture: draft v3 (after review round 2)

Date: 2026-10-03. Author role: resolution lead. Status: **DRAFT v3 for founder review**. Research and writing only: no code, config, migration or test was changed.

Read with:
- `docs/integrations/02-resolutions.md`, sections "Round 1" and "Round 2": every reviewer objection, the decision taken, why, and what changed.
- `docs/integrations/architecture-draft-v2.md`: the previous draft. This document replaces it.
- `docs/integrations/01-comparison.md` (D1-D19), `00-current-system-backend.md` ("backend map"), `00-current-system-product.md` ("product map"), `research/01..07-*.md` (IA, AM, EA, SA, UX, BE, CR).

Labels: **FACT** (source: URL or repo path), **RECOMMENDATION**, **ASSUMPTION**, **unverified**. Paths are relative to `/Users/valletivarish/Documents/new startup/`. `JAVA/` = `apps/api-java/src/main/java/desk/`, `MIG/` = `packages/db/drizzle/`. Everything below is a RECOMMENDATION unless labelled otherwise.

### What changed from v2 (summary; details in `02-resolutions.md`, "Round 2")

| Area | v2 | v3 |
|---|---|---|
| Connection state | One `status` mixed credentials, outbound delivery health and the sending principal. A failing customer webhook made every API key on that connection return 401, including the events feed that was meant to be the fallback | `status` is only `connecting / active / needs_attention / disconnected`, with a reason. Delivery health has its own columns. An API key depends only on itself, its creator and "not disconnected". The outcome sweep runs for every connection that is not disconnected (sections 2.3, 5, 10) |
| Bulk calls (A2) | One `call` queue job per `scheduled_calls` row; post-dial failures fell through to the generic queue retry, which could dial a person twice | `scheduled_calls` is the queue. A row moves to `dialing` before the dial and is never dialed again (at most once). Dial errors get stable codes. Only rows with `reason = 'bulk'` are dialed. No new queue kind, no migration (section 13.1) |
| Shared hosted agent | A batch could re-sync the one hosted agent for job B while a job-A call was still ringing | The hosted agent is not re-synced while a live session on that agent version uses a different job context; the dial waits (`calls.agent_in_use`) (section 13.1) |
| Summary going out | The provider's own summary, filtered by a 9-word regex, went into ATS notes, webhooks, the feed and the CSV | No outbound body carries a summary until we generate our own. Answers come only from the job's must-ask keys, never from the provider's `rationale` text (section 6.2) |
| Stage write-back | Turning it on pushed every earlier decision | Baseline: only decisions made after write-back is on (or after a row is linked) are sent. The "restore the earlier ATS status" path is dropped (section 7) |
| First connect | Emitted `call.ended` for every call of the previous 7 days | Only calls that end after the connection was created are emitted; delivery starts at the current end of the event log (section 6.1) |
| Background reconcile | Only for orgs with a connection, as a queue job | For every org, in the existing 5-minute call loop, shipped with A2. Also catches calls stuck `active`. A connected call where nobody spoke is `no_conversation`, not "result unavailable" (section 6.1) |
| Developer surface | Keys, `/v1`, the feed **and** signed webhooks | Keys, `/v1` and the feed first. Signed webhooks (with `SafeHttp`) only when a pilot says it needs push (section 13.1) |
| Delivery mechanics | One queue job per event and connection; global `seq` shown in bodies | One `drain:<connection>` job per connection walks the event log in order. `seq` is per organization (section 6.1, 6.5) |
| Erasure | Nulled our columns only; the voice provider kept audio and transcript | Also deletes the provider's conversation, refuses the recording route, stops `apply` refilling, and covers manual candidate deletion (section 11.1 item 10) |

---

## 1. The decisions on one page

1. **The goal is a sync problem, not an AI problem.** "Connect once, data flows in, the agent works, results flow back" needs: a machine identity, provenance (external ids), a durable record of what happened, a way to send it out, and one adapter per named system. MCP does not provide delivery, retries or sync (FACT, https://modelcontextprotocol.io/specification/2026-07-28/changelog: "a broken response stream loses the in-flight request").
2. **Everything lives inside `apps/api-java`, on the same Postgres.** No new service, broker, Redis, Kafka or workflow engine. Reuse `Db.inOrg` and forced RLS, the narrow-lookup pattern, `background_jobs`, `AuthInterceptor` with per-field PII redaction, `AuditService`, `AdviceGuard`, the CSV-import validation and the existing `scheduled_calls` table (FACT, backend map §2, §3, §5, §6.4, §10).
3. **Order of work:** prerequisites → results CSV export → "Call selected (N)" with background reconcile for every org → then, **only when a pilot confirms which path it will use**, the integration core plus either the named connector (Zoho Recruit by default) or the developer surface (API keys, `/v1`, events feed). Signed webhooks follow only if a pilot needs push. Founder decision 1 picks the branch.
4. **Data flows one way per field.** Jobs and candidate contact details flow **in**. Call results and human decisions flow **out**. For ATS-linked rows the ATS owns contact fields, and the server enforces that.
5. **The product rule holds at the boundary.** Only facts and decisions a named person made leave HRVoice. Never `fitPercent`, a coverage percentage, a score, a rank, "qualified", or a stage the system chose. The call summary we store today is written by the voice provider, not by our no-judgement instruction, so **no summary leaves HRVoice** until we write our own (founder decision 4). One serializer builds every outbound body and is tested for this.
6. **Results flow back even if nobody opens HRVoice.** Background reconcile repairs a lost provider webhook for every org. Every phone call with a candidate that ends after a connection exists produces exactly one `call.ended`, including unanswered ones. If no result can be fetched, the customer gets "result unavailable" instead of silence.
7. **Calls start from a person.** Either one Call click, or one confirmed "Call selected (N)" that queues the chosen people. Each queued row is dialed at most once. Fully automatic calling of imported candidates waits for a written founder decision on consent, calling hours and DND (FACT, `apps/api-java/MIGRATION_STATUS.md` line 373).
8. **Outbound delivery problems never stop inbound data.** API keys, intake and the events feed do not depend on whether a customer's endpoint or ATS write is healthy.
9. **MCP:** never inside a live call; never as the sync channel; our own read-only MCP server later, when a paying customer asks.

The honest MVP loop is therefore: **in automatically (once a pilot's system is known), call with one click per batch, out automatically.**

---

## 2. Final architecture

### 2.1 Picture

```
 CUSTOMER SIDE                               HRVOICE (apps/api-java: one Spring process, one Postgres, forced RLS)

 Own app / script / iPaaS / cloud bus        EdgeFilter (per-key window on /v1) ─► AuthResolver: key hash ─► creator's live
 [developer surface, gated on a pilot]         membership ∩ key permissions ─► AuthInterceptor (same PII rules, same audit)
   PUT/DELETE /v1/candidates/by-external ───►                                   │
   POST /v1/candidates:batch                     CSV-import validation ─► Db.inOrg ─► jobs / candidates + job_links / candidate_links
   GET  /v1/events?after= ◄─────────────┐                                                   │
   (signed webhooks: later, on request) │      person: Call, or "Call selected (N)" ─► scheduled_calls ─► dial thread (once per row)
                                        │                                                   ▼
 SaaS ATS [named connector, gated]      │      voice provider ─► webhook, or the 5-minute call loop (every org) ─► apply() ─► voice_sessions
   poll If-Modified-Since ◄── pull job  │                                                   │
   one note per call ◄──────────────────┤      60 s tick, per org with a connection that is not disconnected:
   stage: opt-in, a person's decision,  │        sweep:<org> job ─► outcome sweep (compare-and-set on voice_sessions)
   2-minute hold, current stage only ◄──┤        drain:<connection> jobs, due pulls, stage mismatches, purge
                                        │                                                   ▼
                                        │      integration_events (ids + state, seq per org, 30 days)
                                        │        ▲ the stage-change transaction also emits here (outbox)
                                        │                                                   ▼
                                        └───── outbound lane: drain:<connection> walks the log from fanout_seq, in order
```

### 2.2 Components (all new code in `JAVA/integrations/`, except where named)

| Component | Responsibility | Reuses (FACT, backend map) | Slice |
|---|---|---|---|
| `ExternalPayloads` | The single builder for every outbound body (feed item, `/v1` result, ATS note, CSV row, later webhooks), checked against the receiving principal's **current** permissions. No summary; answers from must-ask keys only; public decision values; writes the sensitive-read audit (section 6.2) | `AdviceGuard.scrub`, `Coverage` question order, `HiringController.redactResult` rules | 0 |
| `Sealer` (in `platform/`) | AES-256-GCM, dedicated versioned key with a current version, per-row AAD, a re-seal command | generalises `Notifications.seal/open`; the `--desk.reembed` CLI pattern | 0 |
| `HostedVoiceAdapter` fix | An answer is taken only from the provider's `value` / `result` / `answer`; never from `rationale` or the raw object | — | 0 |
| `VoiceSessions` changes | Stable error codes on every refusal in `startOutbound` / `dialLocked` (`ApiError.conflict(code, message)`, still HTTP 409); the re-sync guard in `provisionLocked`; org-scoped `reconcileSystem(org, vsId)`; background reconcile inside the existing 5-minute loop | `ApiError`, `apply(org, null, ...)`, `expireStale` | A2 |
| `BulkCalls` | "Call selected (N)": writes `scheduled_calls` rows; one daemon dial thread claims due `bulk` rows, at most once each (section 13.1) | `scheduled_calls` (MIG/0025), `VoiceSessions.startOutbound`, `BudgetGuard`, `callPolicy.retry.window` | A2 |
| `JobQueue` changes | `Snooze` outcome; an outbound lane for kind `integration` with its own 2 threads; a round-robin set of orgs with due lane work (section 6.8) | `JobQueue` | Core |
| `Connections` | CRUD and status for connected systems; seal/open secrets; take-over by an admin | `Db.inOrg`, `AuditService`, `integrations.*` permissions | Core |
| `Events` | `emit(Db.Sql sql, ...)` inside the caller's transaction, under a per-org lock, with a per-org `seq` | `Db.Sql` | Core |
| `IntegrationScheduler` | One `@Scheduled` tick every 60 s that only enqueues lane jobs: `sweep:<org>`, `drain:<connection>`, due pulls, stage mismatches, purge | the per-org loop pattern of `JobQueue.poll` | Core |
| `IntegrationWorker` | Lane handlers: `sweep`, `drain`, `pull`, `push_stage` | `JobQueue.register` | Core, E |
| Erasure | `VoiceAgentPort.deleteConversation`; `voice_sessions.content_erased_at`; used by ATS-deletion anonymisation, the retention purge and manual candidate deletion | `VoicePorts`, `FakeVoice` | Core (launch gate) |
| `ApiKeys` + one branch in `AuthResolver` | Bearer key → creator's live membership ∩ key permissions | invitation-token hash pattern, `AuthResolver.membership` | Dev |
| `PublicApiController` (`/v1`) | Seven routes (section 6.6) | `Input`, `ApiError`, `CandidateImport`, `Candidates` | Dev |
| `AtsPort` + `ZohoRecruitAts` + `FakeAts` | The connector seam (section 3) | the `VoicePorts` / `HostedVoiceAdapter` / `FakeVoice` convention | E |
| `SafeHttp`, webhook signing | Outbound HTTP to customer URLs with the SSRF guard (section 6.4) | OkHttp 4.12.0, already on the classpath | Webhooks (later) |

### 2.3 Data model additions (one additive migration per slice; sketch, not final DDL)

Every new table is a tenant table: `ENABLE` + `FORCE ROW LEVEL SECURITY`, policy `organization_id = current_org_id()` for USING and WITH CHECK, added to `StructuralTest` (FACT pattern: `MIG/0016_hiring_desk_rls.sql`, `MIG/0030_background_jobs.sql`).

Slices 0, A and A2 need **no migration**, except slice 0's phone backfill (data, not schema).

| Table / change | Key columns | Notes | Slice |
|---|---|---|---|
| `integration_connections` | `id, organization_id, provider ('custom' \| 'zoho_recruit'), status ('connecting' \| 'active' \| 'needs_attention' \| 'disconnected'), attention_reason ('consent_revoked' \| 'principal_lost' \| 'status_unmapped'), secrets_sealed, config jsonb, cursor jsonb, next_sync_at, rate_limited_until, consecutive_failures, failing_since, last_attempt_at, last_success_at, last_error_code, fanout_seq bigint, missed_until, last_sync_issues jsonb, oauth_state_hash, oauth_state_expires_at, created_by_user_id, created_at, updated_at, disconnected_at` | **`status` says only whether the connection itself can work** (credentials, sending principal, mapping). **Delivery health** lives in `consecutive_failures`, `failing_since`, `last_attempt_at`, `last_success_at`, `last_error_code` and never changes `status`. `rate_limited_until` is the vendor's daily limit. `fanout_seq` is the drain cursor, set to the org's current maximum `seq` when the connection is created, so a new connection gets no backlog. `missed_until` is set when the purge drops events this connection had not sent (section 6.1). `secrets_sealed` is the only place a secret lives (OAuth tokens and PKCE verifier; later the webhook URL and signing secrets), AAD = `organization_id:connection_id:secrets`; the key version is in the sealed value's `k<version>.` prefix. `config` keys come from a fixed allowlist, enforced by a test, and never hold a secret. At most one `custom` connection and one per ATS provider per workspace | Core |
| `api_keys` | `id, organization_id, connection_id, name, prefix, key_hash (unique), permissions text[], created_by_user_id, last_used_at, expires_at, revoked_at, created_at` | `prefix` = `hv_live_` plus the first 6 characters of the random part. Narrow SELECT-only lookup policy keyed on a transaction-local `app.api_key_hash`, copying `Db.withInvitationToken`. Validity rule in section 10 | Dev |
| `job_links` | `job_id → jobs ON DELETE CASCADE, connection_id → integration_connections ON DELETE CASCADE, organization_id, external_id, remote_updated_at, remote_state ('open' \| 'closed' \| 'deleted'), inbound_hash` | `UNIQUE (connection_id, external_id)`, `UNIQUE (connection_id, job_id)` | Core |
| `candidate_links` | `candidate_id → candidates ON DELETE CASCADE, connection_id → ..., organization_id, job_id, external_id, external_parent_id, remote_updated_at, remote_state, remote_state_changed_at, inbound_hash, remote_status_seen, pushed_stage` | `UNIQUE (connection_id, job_id, external_id)`, `UNIQUE (connection_id, candidate_id)`. `pushed_stage` is "the decision the ATS already reflects": set to the candidate's current stage when the link is created or adopted, and for all of a connection's links when stage write-back is switched on or its status map changes (section 7). v2's `stage_seen_at_push` is removed | Core |
| `integration_events` | `id, organization_id, seq bigint, type ('call.ended' \| 'contact.stage_changed'), job_id, candidate_id, voice_session_id, data jsonb, created_at` | **Ids and state only.** `data` holds `{version}` for calls or `{from, to, decidedByUserId}` for stage changes. `seq` is **per organization**: `max(seq) + 1` for the org, taken under the per-org emit lock (section 6.1). `UNIQUE (organization_id, seq)` also serves the feed. v2's global `bigserial` is removed. Purged after 30 days | Core |
| `integration_deliveries` | `id, organization_id, connection_id, event_id, status ('sent' \| 'failed' \| 'skipped'), http_status, error_code, created_at` | A log written by the drain, one row per event it finished with. Nothing is "pending" here: everything after `fanout_seq` is pending. `UNIQUE (connection_id, event_id)`. Purged after 30 days | E (or Webhooks) |
| `voice_sessions` | add `result_emitted_hash text`, `result_version int not null default 0`, `content_erased_at timestamptz` | The per-call dedupe (section 6.1) and the erasure marker (section 11.1 item 10) | Core |
| `candidates.source` CHECK | add `'api'`, `'integration'`; optional `'import'` for CSV rows | FACT, `MIG/0015_hiring_desk_foundation.sql` line 20 | Core |
| `background_jobs.kind` CHECK + `JobQueue.POLICY` | add `'integration'`, POLICY `{5, 30}` | Both must change together, or `enqueue` throws a NullPointerException (FACT, `JAVA/jobs/JobQueue.java` lines 38, 67). No `call` kind: A2 uses `scheduled_calls` directly | Core |
| `scheduled_calls` | no schema change; rows with `reason = 'bulk'`; `voice_session_id` set after a dial | FACT: the table has `status scheduled\|dialing\|done\|cancelled\|skipped`, `reason`, `voice_session_id`, `requested_by_user_id`, `agent_id NOT NULL`, and one open row per candidate (`MIG/0025_call_cost_ledger.sql` lines 95-136) | A2 |
| Phone canonical form | store E.164; `PhoneNumbers.toE164` uses it | See section 13.1 for the collision pre-check | 0 |
| `usecases/hiring.json` | rename `actions.webhook` → `actions.integrations` | FACT: no Java or web code reads `actions.webhook` (grep; `CallContextCompiler` reads only `endCall`, `voicemailDetection`, `transferToHuman`, `transferCondition`, lines 171-235) | Core |

Removed since v2: the `call` queue kind, `integration_connections.paused_until` and the `paused` status, `candidate_links.stage_seen_at_push`, the global `seq bigserial`, `integration_deliveries.status 'pending'`.

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
  SET_STAGE   // trigger: a person's decision, read at send time. Never a call outcome, never a model.
}

interface AtsPort {
  ConnectorSpec spec();
  Page<ExternalJob>         listJobs(Conn c, String cursor);
  Page<ExternalApplication> listApplications(Conn c, Instant modifiedSince, String cursor);
  ExternalApplication       getApplication(Conn c, String applicationRef);   // also confirms a deletion (section 5)
  List<ExternalStage>       listStages(Conn c, String jobRef);              // read live; stages get renamed
  List<String>              deletedSince(Conn c, Instant since);            // empty when unsupported
  List<String>              noteMarkers(Conn c, ExternalApplication app);
  void addNote(Conn c, ExternalApplication app, String text, String marker);
  void setStage(Conn c, ExternalApplication app, String stageRef, String comment);
  // Typed errors: RateLimited(retryAfter), AuthRevoked, NotFound, Rejected(fieldErrors), Transient
}
```

- `ExternalJob`, `ExternalApplication`, `ExternalStage` and `Page` are the whole cross-vendor model. Vendor field names never leave the adapter (FACT, rule in `JAVA/voice/VoicePorts.java` lines 7-10).
- Token requests are sent as a form body, never with credentials in the URL (FACT: OAuth token requests use `application/x-www-form-urlencoded` in the request body, RFC 6749 §4.1.3, https://datatracker.ietf.org/doc/html/rfc6749#section-4.1.3). Adapters never put a URL with a query string into an exception message.
- The `custom` connection has no adapter. It is our own surface.
- A unified-API vendor (Kombo, Merge) would later be one more `AtsPort` implementation.

### 3.2 Declared capabilities for the systems in view

Unchanged from v1 (Zoho Recruit: OAuth per data centre, notes on the candidate record, Change Status with `jobids`; Keka Hire V2; Greenhouse and Lever later through partner programmes; Darwinbox, Naukri RMS, Freshteam later or avoid). Evidence: https://www.zoho.com/recruit/developer-guide/apiv2/create-notes.html, https://www.zoho.com/recruit/developer-guide/apiv2/change-status.html, https://www.zoho.com/recruit/plan-comparison.html, https://www.zoho.com/recruit/developer-guide/apiv2/multi-dc.html.

---

## 4. Canonical model

**RECOMMENDATION.** No separate canonical schema. Our tables are the model; adapters map vendor objects straight onto them.

| Our noun (table) | Outside concept | Direction | Owner after linking |
|---|---|---|---|
| Work item (`jobs`) | ATS job opening; customer's requisition | in, **create only** | Title and description are copied **once, when the job is created** (by the connector's link step or by `PUT /v1/jobs/by-external/{id}`), then they are ours. The JD drives the call prompt (FACT, `JAVA/engine/CallContextCompiler.java`; a changed context hash re-provisions the hosted agent before the next dial, `JAVA/voice/VoiceSessions.java` lines 178-195), so no machine path may change it later. Must-ask questions are never imported |
| Contact (`candidates`, job-scoped) | ATS **application**; customer's person-on-a-job | in | ATS-linked rows: name, phone, email and resume text are owned by the ATS. **`Candidates.update` refuses edits to them** with code `candidates.managed_externally`, which the web shows as "Edit this in Zoho Recruit" (FACT: today `JAVA/hiring/Candidates.java` line 101 `update` has no such check). Rows linked to the `custom` connection stay editable; the customer's next `PUT` for that external id overwrites them (last write wins, documented) |
| Call result (`voice_sessions`) | note on the application; `call.ended` event | out | Ours |
| Decision (`candidates.screening_status`, set by a person) | ATS status; public `decision` value | out, mapped, opt-in for the ATS | Ours. Only `reviewed` ("Moved forward") and `declined` ("Not moving forward") are ever written to an ATS |

**Public decision values.** Outside HRVoice the stage is never shown as the storage value. `ExternalPayloads` maps `new → undecided`, `screening → on_hold`, `reviewed → moved_forward`, `declined → not_moving_forward`, and adds `decisionLabel` from the use case ("No decision yet", "On hold", "Moved forward", "Not moving forward"). FACT why: `screening` means "On hold" and `reviewed` means "Moved forward" (`apps/web/lib/status-labels.ts` lines 57-64), and raw values never reach the screen (`docs/superpowers/specs/2026-10-02-app-consistency.md` section 5). This must be fixed before the first public version, because field meanings are frozen inside a version (R12).

**Field allowlist (DPDP minimisation).** Inbound we store only: name, phone (E.164), email, resume text, job link, external ids, remote updated time, remote state and the remote status label. Never date of birth, gender, salary, address, ATS notes, ratings or scores (FACT, Zoho has an AI match rating on candidates, UX Z6).

**Event names (D18).** Use-case-neutral: `call.ended` and `contact.stage_changed`, each with `useCase` in the body. The in-process `DomainEvents` (`call.started`, `call.ended`, `result.ready`) stay as they are and are not the public contract (FACT, `JAVA/engine/DomainEvents.java`).

---

## 5. Sync design (inbound, slice E)

| Concern | Design | Evidence |
|---|---|---|
| **Initial import** | After connect: the customer ticks jobs (none pre-ticked) and picks a trigger status. One `pull` lane job per connection, key `pull:<connectionId>`. It imports one page (up to 200 records), writes it and advances `cursor` **in the same transaction**, then returns `Snooze(0)` so the **same row** goes back to the queue for the next page. The queue row is the single-flight lease | FACT: `enqueue` does `ON CONFLICT ... WHERE status IN ('queued','running') DO NOTHING` and the row is deleted only after the handler returns (`JAVA/jobs/JobQueue.java` lines 66-75, 145). Zoho `per_page` default 200 (https://www.zoho.com/recruit/developer-guide/apiv2/get-records.html) |
| **Incremental** | Every 15 minutes by default: Get Records with `If-Modified-Since` = last high-water mark minus a 2-minute overlap. Upserts are idempotent (link uniqueness plus `inbound_hash`) | FACT: `If-Modified-Since` supported on Get Records (same page) |
| **Real time** | None in the first release. V2: vendor webhooks become hints that enqueue a re-fetch | FACT: Zoho webhooks only on Professional and Enterprise (https://www.zoho.com/recruit/plan-comparison.html) |
| **Reconciliation** | Nightly: list all applications on linked open jobs, compare with `candidate_links`, mark missing ones. Plus a "Sync now" button | Vendors do not guarantee webhook delivery (CR F6-F7) |
| **Deletions and erasure** (changed) | Deleted or anonymised in the ATS → `remote_state = 'deleted'`, `remote_state_changed_at = now()`; the person leaves "Not called yet" and cannot be dialed. After a grace period (founder decision 9; proposed 7 days) a daily step: (1) calls `getApplication`; anything but `NotFound` puts the link back to `open`; (2) otherwise **anonymises** the row through the erasure path (section 11.1 item 10): name replaced by "Removed in <system>", phone, email and resume text nulled, call content nulled and deleted at the voice provider; ids, timings, outcomes and cost rows kept; one audit row with ids only. The status card shows "2 people removed in Zoho Recruit will be anonymised on 10 Oct" | ATSs often delete one record when merging duplicates (behaviour for Zoho unverified). ASSUMPTION: we are the employer's DPDP data processor (needs a lawyer). Zoho deleted-records API costs 2 credits a call (https://www.zoho.com/recruit/developer-guide/apiv2/limits.html) |
| **Status changes in the ATS** | Never change our stage (D11). Rejected, hired, withdrawn → `remote_state = 'closed'`: the row shows "Closed in Zoho Recruit", is left out of "Not called yet" counts and of bulk calls, and **dialing is blocked** by one guard in `VoiceSessions.dialLocked`, the single dial choke point. Every linked row shows the remote status label read-only ("In Zoho Recruit: Interview") | FACT: `dialLocked` is the only dial path (backend map §9) |
| **Jobs closed in the ATS** | `job_links.remote_state = 'closed'`: stop pulling that job, show "Closed in Zoho Recruit" on the job, never close our job automatically | |
| **Validation** | Mapped rows go through the CSV-import rules and the savepoint-per-row insert. A rejected record is not stored; its external id and issue code are counted in `last_sync_issues` and shown on the status card ("3 people couldn't come in: number not valid. Fix them in Zoho Recruit."), with "Sync now" | FACT: `JAVA/hiring/CandidateImport.java`; the CSV preview shows these issue codes today (`apps/web/components/candidates/add-candidates.tsx` lines 196-366) |
| **Phone match with existing rows** (changed) | Connector only: if no link exists for the external id but the job has a row with the same E.164 phone that is **unlinked, or whose link is `deleted`** (a merge in the ATS), adopt it: create or re-point the link, set `pushed_stage` to the row's current stage (section 7), audit `integration.candidate_adopted` with ids. `/v1` never adopts (section 6.6) | FACT: unique `(job_id, phone)` (`MIG/0018`) |
| **Failures** (changed) | Typed adapter errors. `AuthRevoked` / `invalid_grant` → `needs_attention` with reason `consent_revoked`, admins emailed once; the tick enqueues no job that needs the token until someone reconnects. `RateLimited` → `rate_limited_until` and `Snooze(retryAfter)`, no attempt used. `Transient` → the handler's own backoff (section 6.1, drain). None of these touch API keys or the outcome sweep | SA M3, BE §3.7 |
| **Idempotency** | Inbound: link uniqueness + `inbound_hash`. Notes: marker `HRVoice ref <session id prefix>.<content hash prefix>`; before writing, the adapter lists the application's note markers and skips if the same marker exists. Stage: compare `pushed_stage` (section 7) | |
| **Rate limits and budget** | Per-connection budget from the customer's plan: at most about 20% of daily credits, of which a fixed share is **reserved for writes**; when the budget tightens, polling slows first. No advisory lock around vendor calls: the lane has 2 threads, far under Zoho's 5-20 concurrency. Token refresh uses `pg_try_advisory_xact_lock("conn:"+id)` held only for the refresh call; a job that does not get the lock returns `Snooze(5)` and re-reads the token | FACT: Get Records costs 3 credits; Free 5,000/day; concurrency Free 5 to Enterprise 20 (https://www.zoho.com/recruit/developer-guide/apiv2/limits.html). FACT: `Db.underAdvisoryLock` holds a pooled connection for the whole `work` (`JAVA/platform/Db.java` lines 97-115) |
| **Fail-closed revocation** (changed) | Every job reloads the connection row and stops if it is `disconnected`. Beyond that, **each job checks only its own precondition**: a pull needs a working token, a send needs a live sending principal (section 10), a stage push needs a mapped status. A failed precondition sets `needs_attention` with its reason and stops that kind of job only. Disconnect, in one transaction: status `disconnected`, null `secrets_sealed`, revoke the connection's API keys; then call the vendor's revoke endpoint as a best effort | SA M6 |

Credit arithmetic for the default polling (ASSUMPTION: two Get Records calls per tick): 96 ticks × 2 × 3 credits = 576 credits a day, about 12% of the Free plan's 5,000.

---

## 6. Outbound: events, feed, notes, CSV

### 6.1 How events are created and delivered (changed)

**FACT (code read).**
- `VoiceSessions.apply` writes provider data in one transaction, runs the post-call extractor outside any transaction, may write a filled summary in a second transaction, records the ledger outcome (`completed` when a user turn exists, else `no_conversation`, or the failure), then publishes in-process events; it runs again on every webhook, reconcile and results-page open (`JAVA/voice/VoiceSessions.java` lines 505-551).
- The scheduled `expireStale` runs every 5 minutes for every active org but only sets stale sessions to `ended` (phone after `voiceMaxPhoneMinutes + 10` = 30 minutes by default); it fetches nothing (lines 263-271, 678-687; `JAVA/platform/Env.java` line 131). Reconcile runs only when a person ends a call or opens the results page (`JAVA/hiring/HiringController.java` line 271).
- `markFailed` and the `call_initiation_failure` branch set `ended_at` and `failure_reason` and publish no event (lines 354-358, 649-666).
- `Jobs.updateStatuses` reads `previous` with a plain SELECT, without `FOR UPDATE` (`JAVA/hiring/Jobs.java` lines 255-270).
- `Db.inOrg` always opens a new transaction (`REQUIRES_NEW`, `JAVA/platform/Db.java` lines 28-30, 48).

**Background reconcile (slice A2, every org).** Inside the existing 5-minute `expireStale` loop, for each active org, before the stale expiry runs: phone sessions with a candidate and an `external_conversation_id` that are either
- `ended` 3 to 60 minutes ago with no transcript and no `failure_reason`, or
- still `active` and started more than `voiceMaxPhoneMinutes + 2` minutes ago (the provider webhook is late or lost),

are passed to `reconcileSystem(org, vsId)` (the existing fetch plus `apply(org, null, ...)`), at most 5 per org per run. The loop itself is the retry: about 12 tries over the hour, no queue job, no dead rows. `ponytail:` inline provider fetches on the scheduler thread, one org at a time; move to the lane if a run takes longer than a minute.

**A phone call with a candidate is settled** (`agent_sessions.channel = 'phone'`, `voice_sessions.candidate_id` set; browser test calls never emit) when:
- its status is `ended` or `failed`, **and**
- `ended_at` is more than 3 minutes ago (time for the post-call extractor), **and**
- it has a transcript, a summary, answers or a `failure_reason`, **or** `ended_at` is more than 90 minutes ago.

**Outcome in every body:** `failure_reason` when set; otherwise `completed` when the transcript has a user turn; `no_conversation` ("Picked up, didn't speak") when there is a transcript with no user turn; otherwise `result_unavailable` ("We couldn't get this call's result. Open the candidate in HRVoice to try again."). This reuses the ledger's own `completed` / `no_conversation` rule.

**Outcome sweep (Core).** The 60-second tick enqueues one `sweep:<orgId>` lane job for every org with a connection that is not `disconnected` (status `needs_attention` included). The handler, in one transaction, first takes the org's events lock, then selects settled calls with:
- `started_at > now() - interval '8 days'` (uses the existing `(organization_id, started_at)` index) and `ended_at` within 7 days;
- `ended_at` later than the **earliest `created_at` of the org's connections that are not disconnected** (so connecting never replays earlier calls);
- `content_erased_at IS NULL`;
- `result_emitted_hash IS DISTINCT FROM md5(status, failure_reason, summary, structured_answers, transcript is not null)`.

For each: `UPDATE voice_sessions SET result_emitted_hash = <hash>, result_version = result_version + 1 WHERE id = ? AND result_emitted_hash IS DISTINCT FROM <hash> RETURNING result_version`, and only if a row came back, `Events.emit(sql, 'call.ended', ...)` with `{version}`. `ponytail:` rehashes up to 7 days of calls every minute per connected org; the upgrade is a `result_dirty` flag set by `apply`.

Consequences:
- **One `call.ended` per call** in the normal case; a second version only when the result changes after it was sent. Bodies always show the call's current state; receivers keep the latest `version`.
- **Unanswered, failed and silent calls** emit, with their outcome.
- **No backlog on first connect**, and no duplicate after the 30-day purge (the dedupe is on the call row, and the sweep never looks back more than 7 days).
- **A connection that needs attention keeps its history.** The sweep does not depend on the connection being `active`, so events keep being recorded and are sent when it recovers.
- **Nest-written results are caught too**, because the sweep reads the database.

**Stage changes are a true outbox.** `Jobs.updateStatuses` reads `previous` with `SELECT ... FOR UPDATE` (always; it makes `from` exact under concurrent requests). When the org has a connection that is not disconnected, it takes the org events lock **as its first statement**, before reading any row, and calls `Events.emit(sql, 'contact.stage_changed', ...)` with `{from, to, decidedByUserId}` inside the existing `if (!previous.equals(new))` branch. No-op changes emit nothing. The free-text reason is not sent outside.

**Ordering lock and per-org `seq`.** Rule: **every emitting transaction takes `pg_advisory_xact_lock(hashtextextended('events:' || org, 0))` before touching any row.** `Events.emit` takes it again (a no-op when already held), reads `coalesce(max(seq), 0) + 1` for the org and inserts. The lock is released only at commit or rollback (FACT, https://www.postgresql.org/docs/current/explicit-locking.html), so inside one org events commit in `seq` order and a rolled-back number is simply reused. Taking the lock first everywhere gives one lock order (org lock, then rows), so two bulk stage changes cannot deadlock on it.

**Delivery: one drain per connection (E, and later webhooks).** The tick enqueues `drain:<connectionId>` when the org's maximum `seq` is above the connection's `fanout_seq`, the connection is not disconnected, its sending principal is live and it is not inside a backoff. The handler:
1. reads up to 50 events with `seq > fanout_seq`, in order;
2. skips types this connection does not take (an ATS takes `call.ended` notes; stage write-back is separate, section 7) and advances the cursor past them;
3. builds the body with `ExternalPayloads` for the sending principal and sends it;
4. on success, or a permanent refusal (`Rejected`, `NotFound`, other 4xx), writes an `integration_deliveries` row and advances `fanout_seq` **in the same transaction**; resets `consecutive_failures`, sets `last_success_at`;
5. on `RateLimited`, returns `Snooze(retryAfter)`;
6. on a timeout, 408, 429, 5xx or `Transient`, increments `consecutive_failures` (setting `failing_since` on the first), and returns `Snooze(60)`; from the third failure on, `Snooze(300)` and one email to admins ("Couldn't send since 10:40");
7. on `AuthRevoked`, sets `needs_attention` (`consent_revoked`) and returns.

The drain never throws for a delivery failure, so queue attempts are spent only on bugs. One queue row per connection means one probe at a time and nothing waking up per event. Order is kept per connection.

**Purge.** Daily: delete `integration_events` and `integration_deliveries` older than 30 days. Before that, for each connection whose `fanout_seq` is below the newest event being purged, set `fanout_seq` to it and `missed_until` to its time. The status card then says "Results of calls before 3 Nov could not be sent. Open them in HRVoice." Nothing disappears silently.

**Use-case gate.** Emission and delivery happen only when the use case's `actions.integrations` is `true` (renamed from `webhook`). Stage write-back additionally needs the per-connection opt-in.

### 6.2 The one serializer (`ExternalPayloads`) and the one export rule (changed)

FACT (why the summary does not leave):
- The stored summary is the voice provider's `analysis.transcript_summary`, saved as it arrives (`JAVA/voice/HostedVoiceAdapter.java` lines 149-150; `VoiceSessions.apply` writes `coalesce(?, summary)` with the provider value, line 514).
- Our `result.summaryInstruction` ("do not score, rank or judge fit", `usecases/hiring.json`) is used only when `PostCallExtractor` fills a missing summary (`JAVA/engine/PostCallExtractor.java` line 63), and the filled value is written only with `coalesce(summary, ?)`.
- `AdviceGuard.scrub` drops a sentence only if it contains one of nine words (`JAVA/engine/AdviceGuard.java`; `hiring.json` `result.adviceGuard.patterns`). "Strong candidate" or "lacks relevant experience" pass through.
- The provider's agent settings document `summary_language` but no summary instruction (https://elevenlabs.io/docs/api-reference/agents/create; whether one exists elsewhere is unverified).
- When a data-collection result has no `value`, `result` or `answer` field, the adapter stores the provider's `rationale` text, or the raw object, as the answer (`HostedVoiceAdapter.java` lines 151-161).

Rules, at send or read time, for a named principal (the API key, the connection's `created_by_user_id`, or the exporting person), using that principal's **current** permissions intersected with the connection's include flags:
- **No summary in any outbound body** (feed, `/v1` results, ATS note, results CSV, later webhooks). The in-app summary is unchanged. A summary may go out only once we generate it ourselves with `summaryInstruction` and store it separately (V2, when a pilot asks).
- **Answers** are the job's must-ask questions only, in the order frozen in the call's `provision_snapshot`, each value scrubbed with `AdviceGuard.scrub`, capped at 500 characters, "not answered" for gaps. Slice 0 changes the adapter so an answer comes only from `value`, `result` or `answer`; otherwise the question is not answered.
- **One export rule everywhere:** answers are included only if the principal holds `calls.read_transcript` **and** `candidates.export`. Contact PII (phone, email) also needs `candidates.read_pii`, and never travels in the feed or webhooks. Otherwise the body says what happened (outcome, times, ids, decision) without content.
- No field for `fitPercent`, coverage, score, rating, summary or recommendation.
- **Audit:** when a request-built body (feed, `/v1` result, CSV) includes answers or PII, `ExternalPayloads` writes one `authz.sensitive_access` row per request, with `apiKeyId` when a key is used. FACT why: `AuthInterceptor` audits only the route's declared permission (line 60), and the existing results route audits content reads itself (`HiringController.java` line 279). Worker sends record `content: true|false` and the principal id on `integration.pushed`.

**Merge-blocking test:** fails if any outbound schema contains `fitPercent`, `score`, `rating`, `recommend`, `coverage` or `summary`; if a principal without the content permissions receives `answers`; or if any phrase from a small evaluative corpus ("strong candidate", "well suited for the role", "lacks relevant experience", "recommend", "good fit") placed in a fixture's provider summary or in a `rationale`-only answer appears in any outbound body. Scrub is the backstop; leaving the summary out is the control.

### 6.3 Webhooks (later, only when a pilot needs push)

Not in the first developer slice (section 13.1). When built:
- body: `id` (= `webhook-id`), `type`, `occurredAt`, `useCase`, `data` with `job`, `candidate` (`decision`, `decisionLabel` at send time), `call` (`version`, `outcome`, times), `answers` under the export rule, and `links`. **No `seq`** (receivers dedupe on `id`; order comes from the feed). Receivers keep the latest `call.version`; a retry reuses `webhook-id` but carries the call's current state.
- `contact.stage_changed` is delivered only after the same 2-minute hold as ATS write-back, and is **skipped if superseded**: if its `to` is no longer the candidate's current decision at send time, it is not sent. A decide-then-undo then sends nothing irreversible to a no-code workflow. The feed stays immediate and complete.
- Standard Webhooks signing: `webhook-id`, `webhook-timestamp`, `webhook-signature: v1,<base64 HMAC-SHA256 of id.timestamp.body>`, secret `whsec_` + 24-64 random bytes, one secret per endpoint, 24-hour overlap on rotation (FACT, https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md).
- Delivery is the same drain as section 6.1, through `SafeHttp` (section 6.4).

### 6.4 Delivery health and SSRF

- **Delivery health is not connection status.** The drain's failure counters (section 6.1) drive the "Couldn't send since 10:40" line, the email and the backoff. They never change `status`, never reject an API key and never stop the sweep, pulls or the feed. "Retry" resets `consecutive_failures` and wakes the drain.
- Timeouts for any customer or vendor HTTP: connect 3 s, whole call 10 s; response body capped at 64 KB and never logged.
- **`SafeHttp`** (Webhooks slice; also rung 4 later):
  - OkHttp 4.12.0 is already on the compile classpath (FACT, `mvn -o dependency:tree`, 2026-10-03). A custom `Dns` resolves with `InetAddress.getAllByName` and throws unless **every** address is public, so the check and the connection use the same resolution (FACT, OkHttp `Dns` contract, https://raw.githubusercontent.com/square/okhttp/parent-4.12.0/okhttp/src/main/kotlin/okhttp3/Dns.kt).
  - "Public" means: IPv6 only inside `2000::/3` (global unicast) and not in `64:ff9b::/96` (NAT64), `2002::/16` (6to4), `2001::/32` (Teredo) or `2001:db8::/32`; IPv4 not loopback, RFC 1918, link-local (169.254.169.254), CGNAT 100.64.0.0/10, 0.0.0.0/8, 192.0.0.0/24, 198.18.0.0/15, 224.0.0.0/4, 240.0.0.0/4 or 255.255.255.255; IPv4-mapped (`::ffff:0:0/96`) and IPv4-compatible addresses are checked as the IPv4 inside them. Also refused: our own server's public addresses and our own API and web hostnames.
  - OkHttp skips `Dns` for IP-literal hosts (FACT, `RouteSelector.kt` line 163 in 4.12.0), so URLs with an IP-literal host are refused. HTTPS on port 443 only. `proxy(Proxy.NO_PROXY)`, no redirects.
  - The webhook URL is stored inside `secrets_sealed` (many iPaaS hook URLs work as bearer secrets; ASSUMPTION, unverified per vendor). The UI shows only scheme and host after save. The URL never appears in logs, `last_error_code` or the delivery list.
  - The dev-only `ALLOW_PRIVATE_WEBHOOK_TARGETS` flag makes `Env` refuse to boot when `COOKIE_SECURE=true`. "Send a test event" is limited to 5 a minute per connection and reports only "reached / not reached / rejected (code)".
  - FACT (why this matters): API, Postgres and web share one VPS (`BRD's/10_ADRs/ADR-006-hosting-deployment.md` line 143).

### 6.5 Events feed (changed)

`GET /v1/events?after=<cursor>&types=` returns this org's `integration_events` with `seq > after`, ordered by `seq`, at most 200, bodies built by `ExternalPayloads` for the calling key.
- The cursor is an opaque string wrapping the per-org `seq`. Because `seq` is per org, it reveals nothing about other workspaces.
- The contract: **at-least-once, ordered within your workspace, 30-day window**. If `after` is older than the oldest retained event, the answer is `410 cursor_expired` ("Start again from the newest event; events older than 30 days are gone"), never a silent skip.
- Correctness rests on the per-org emit lock (section 6.1). Merge-blocking test: two concurrent emits in one org, the later one committed first; a poller sees both, in order.
- Polling every 1-5 minutes is the expected use. An iPaaS on a slower schedule sees results later (R12).

### 6.6 Public REST API v1 (Dev slice; changed)

| Route | Permission | Notes |
|---|---|---|
| `GET /v1/jobs` | `jobs.read` | keyset paginated; includes `externalId` |
| `PUT /v1/jobs/by-external/{externalId}` | `jobs.create` | **Create if missing.** Body `{title, description}`; the description is saved the way the job page saves pasted JD text (up to 40,000 characters, FACT `JAVA/hiring/HiringController.java` line 155). An existing job is returned unchanged with `"created": false` |
| `PUT /v1/candidates/by-external/{externalId}` | `candidates.create` + `candidates.update` | Body `{job: {id} \| {externalId}, fullName, phone, countryCode?, email?, resumeText?, state?: 'open' \| 'closed'}`. Same validation as CSV import; returns the row plus issues; a replay returns `200`. `state: 'closed'` sets `candidate_links.remote_state` (withdrawn, hired or rejected in their system): the row leaves "Not called yet" and cannot be dialed. Never adopts an unlinked row: a phone already on the job gives the CSV issue `duplicate_on_job` |
| `DELETE /v1/candidates/by-external/{externalId}?job=` | `candidates.delete` | Sets `remote_state = 'deleted'`; the same grace period and erasure path as an ATS deletion (section 5) |
| `POST /v1/candidates:batch` | `candidates.create` (+ `candidates.update` for rows with `externalId`) | Body `{job?: {...}, rows: [{job?: {...}, externalId?, fullName, phone, ..., state?}]}`, up to 200 rows; a row's `job` overrides the top-level one; or `text/csv` with `?jobId=` or `?jobExternalId=`. Per-row result; savepoint per row |
| `GET /v1/candidates/{id}/results` | `candidates.read` + `jobs.read`; content per section 6.2 | No provider reconcile side effect |
| `GET /v1/events` | `candidates.read` + `jobs.read`; content per section 6.2 | Section 6.5 |

- **Unknown job.** If the job named in a `PUT`, or the top-level job of a batch, does not exist yet, the answer is `409 job_not_found`. EventBridge retries 409 (FACT, https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-api-destinations.html), so a candidate event that arrives before its job event is delivered once the job exists. A row-level unknown job is that row's issue `job_not_found`. The reference docs tell rung-2 users to set a dead-letter queue on the rule.
- **Identity:** section 10. Keys are accepted **only** on `/v1`, only in the `Authorization: Bearer` header (never in a query string: `AuthInterceptor` writes the full URL into audit metadata, FACT `JAVA/authz/AuthInterceptor.java` line 52). `/v1` ignores cookies; cookie routes ignore bearer headers. The `/backend/:path*` rewrite also exposes `/backend/v1/...` on the web origin (FACT, `apps/web/next.config.mjs` line 22); with cookies ignored that is harmless.
- **Ingress:** Caddy routes `api.<domain>/v1/*` to the Java process, with `TRUST_PROXY=true` so `EdgeFilter` takes the first `X-Forwarded-For` entry (FACT, `JAVA/platform/EdgeFilter.java` lines 86-91). That is safe because Caddy's `reverse_proxy` ignores incoming `X-Forwarded-*` values unless `trusted_proxies` is configured (FACT, https://caddyserver.com/docs/caddyfile/directives/reverse_proxy: "by default, the proxy will ignore their values from incoming requests, to prevent spoofing"). Deployment checklist: no `trusted_proxies` for client ranges; the Java port is bound to the Compose network only; a check that a spoofed `X-Forwarded-For` does not change the rate-limit bucket, on both `api.<domain>/v1` and `<web>/backend/v1` (how Next's rewrite forwards the header is unverified).
- **Rate limit:** requests whose bearer hash belongs to a key `AuthResolver` validated in the last 5 minutes use a per-key fixed window instead of the per-IP window; every other request stays per IP (FACT, the limiter is per IP and runs before auth, `EdgeFilter.java` lines 55-83). `429` carries `Retry-After`.
- **Audit:** every `/v1` write records one audit row (`api.job_created`, `api.candidate_upserted`, `api.candidate_deleted`, `api.candidates_batch` with counts) with `apiKeyId` in metadata.
- Errors keep `{code, message, request_id, errors?}`; ISO-8601 UTC; a hand-written OpenAPI file; version in the path; never change a field's meaning inside a version.
- Reference docs for Kafka Connect HTTP Sink: `batch.prefix` = `{"rows":[`, `batch.suffix` = `]}`, each record carrying its own `job` (FACT: prefix and suffix are applied once per batch, https://docs.confluent.io/kafka-connectors/http/current/connector_config.html).

### 6.7 Results CSV export (slice A; changed)

A button on the job's candidates board. Each row is built by `ExternalPayloads` for the exporting person:
- always: decision label, latest call outcome, call time, duration and a link;
- with `calls.read_transcript`: each must-ask answer as a column (no summary column, section 6.2);
- with `candidates.read_pii`: phone and email.

Gated by `candidates.export` and audited as a sensitive read. File details:
- UTF-8 with a byte-order mark, so Hindi text opens correctly in Windows Excel (FACT: the existing audit CSV writes no BOM, `JAVA/audit/AuditController.java` line 182).
- Every cell is quoted. A cell starting with `=`, `+`, `-`, `@`, tab (0x09) or carriage return (0x0D) is escaped (FACT, https://owasp.org/www-community/attacks/CSV_Injection).
- Phone is written as `91 98765 43210` (country code, a space, the national number grouped, no leading `+`), so no spreadsheet reads it as a formula or a number. How Excel and Google Sheets show it is unverified; check both before shipping.

### 6.8 Queue changes (Core)

FACT about today's code (`JAVA/jobs/JobQueue.java`): 2 worker threads for every kind and tenant (lines 50-54); `runScope` drains one org until empty, 10 jobs per claim (116-134); `poll()` runs `runDue()` inline on Spring's scheduler thread (87-90); job rows are visible only inside their org (RLS), so finding work means one transaction per org (93-109).

Changes:
1. **Outbound lane.** Kind `integration` is claimed only by a separate 2-thread executor. Within the lane, a pass claims at most **one job per org**, round-robin over an in-memory set of orgs with due lane work. The set is fed by `wake()` and by the existing 30-second poll (the safety net). `ponytail:` in-memory set per replica; a due-orgs table past ~1k orgs. `email` and `document` behave exactly as today.
2. **`Snooze(seconds)`.** A handler may return a snooze. `execute()` sets the same row back to `queued` with `run_at = now() + seconds` and gives back the attempt. It serves page chaining, rate-limit pauses, the drain backoff and the stage-write hold.
3. **POLICY** `integration` `{5, 30}`. Handlers own their expected retries through `Snooze`; queue attempts only cover unexpected errors.
4. **Scheduler pool.** `spring.task.scheduling.pool.size: 3`, so the `@Scheduled` loops do not wait on each other.
5. **Unknown kinds** throw a clear error at `enqueue`.
6. `/health` reports backlog per kind.
7. **Connection pool check** in the Core definition of done: pool size ≥ 2 × (lane threads + legacy workers + 1 dial thread) + headroom for the scheduler and web traffic (FACT: `underAdvisoryLock` holds one pooled connection while its work uses others, `Db.java` lines 97-115; pool default 10, `Env.java` line 88).

Slice A2 needs none of these.

---

## 7. Two-way action architecture

```
Integration       integration_connections row (org-scoped, RLS): sending principal, status, config, delivery health
   ▼
Connector         AtsPort adapter + ConnectorSpec: auth type, readable objects, declared actions
   ▼
Available actions spec.actions ∩ enabled in connection.config ∩ use case actions.integrations
   ▼
Automation        fixed rules in code, not a rule builder:
                    call.ended (a settled call, a fact)        → ADD_NOTE   (always on for a connected ATS)
                    a person's decision: reviewed / declined   → SET_STAGE  (opt-in, customer-mapped, level-triggered, from a baseline)
                    custom connection                          → events feed (webhooks later)
   ▼
Agent             the voice agent never calls an action. It receives only the compiled job, questions and knowledge
                  (CallContextCompiler) and produces facts. It knows nothing about any connector.
```

**Provider independence of the core agent.** FACT: data reaches a live call only once, at provisioning, and the live agent gets only `end_call`, `voicemail_detection` and `transfer_to_number` (`JAVA/engine/CallContextCompiler.java` lines 26-37, 220-237). A connector changes rows in `jobs` and `candidates`; the compiler reads those rows as today.

**Where the never-recommend rule is enforced (three places, all testable):**
1. **Content:** only `ExternalPayloads` builds outbound text, without any summary (section 6.2).
2. **Trigger:** `SET_STAGE` sends only the candidate's current `screening_status`, and only `reviewed` or `declined`. That value is set only by a person through the stage routes (FACT, the only Java write of `screening_status` is `JAVA/hiring/Jobs.java` line 264). API keys cannot change stages. A call outcome never moves an ATS status. Model output never selects or triggers an external write (FACT, `BRD's/11_PERMISSION_MATRIX.md` line 149).
3. **Target:** adapters expose only `addNote` and `setStage`; no generic field update; never a score, rating, scorecard or recommendation field.

**Stage write-back (changed: from a baseline).** Off by default. The customer picks the target status for "Moved forward" and for "Not moving forward" from their live status list.

- **Baseline.** Only decisions made after write-back is on, or after a row was linked, are sent. When a link is created or adopted, `pushed_stage` = the candidate's current stage. When write-back is switched on or its status map changes, one UPDATE sets `pushed_stage` = current stage for all of the connection's links. Earlier decisions are never sent in bulk. (Sending earlier decisions on request is V2, if a pilot asks.)
- **Finding work:** the tick finds linked candidates where the current stage is `reviewed`/`declined` and differs from `pushed_stage`, or where the current stage is `new`/`screening` while `pushed_stage` is `reviewed`/`declined`. It enqueues `push_stage` with key `stage:<candidateLinkId>`.
- **The handler:**
  1. **Hold.** If the candidate's last `contact.stage_changed` is less than 2 minutes old, `Snooze` for the remainder. The in-app Undo lasts 8 seconds (FACT, `apps/web/components/ui/toaster.tsx` line 78; Undo re-posts the previous stage with reason "Undone", `apps/web/app/jobs/[id]/candidates/page.tsx` lines 680-698).
  2. **Read the current stage.** If it equals `pushed_stage`, stop.
  3. **Forward** (`reviewed`/`declined`): re-read the application's ATS status. If it differs from `remote_status_seen` (someone changed it in the ATS), do not overwrite: add a note "Moved forward by Priya Sharma in HRVoice; status left unchanged because it was changed in Zoho Recruit". Otherwise call `setStage` with the comment "Moved forward by Priya Sharma in HRVoice". Either way set `pushed_stage`.
  4. **Withdrawn** (`new`/`screening` after `reviewed`/`declined`): add a note "Decision withdrawn in HRVoice by Priya Sharma. Status in Zoho Recruit not changed." and set `pushed_stage` to the current stage. We do not try to restore the earlier ATS status: it cannot undo what the ATS already did (an email, an automation), and the 2-minute hold makes this case rare.
- Because the handler always reads current state, retries and reordering cannot leave the ATS on an older decision. Stage changes made through Nest are caught by the same comparison.

**Notes (one per call, a follow-up only if the result changed).** The drain writes one note per `call.ended` version, including unanswered calls ("HRVoice called on 3 Oct, 11:02: no answer"). The marker is `HRVoice ref <session prefix>.<content hash prefix>`; the adapter skips the write if that marker exists. A real follow-up note is titled "Updated result for the call on 3 Oct, 11:02".

```
HRVoice screening call · Sales executive · 3 Oct 2026, 11:02 · 6 min
Outcome: Call completed            (or: No answer / Reached voicemail / Picked up, didn't speak / Number not valid / Result unavailable)

What they said
- Notice period: 30 days
- Current location: Pune
- Expected salary: not answered

Recording, transcript and summary: <sign-in link to the candidate in HRVoice>
A person on your team decides who moves forward. HRVoice does not score or recommend.
HRVoice ref 3f2a9c1e.a41b
```

**Later in-call actions** (for example booking an interview slot) are **not** reachable today. The live voice agent gets only provider system tools, and the tool gate needs a member `Actor` (FACT, `JAVA/engine/CallContextCompiler.java` lines 220-237; `JAVA/runtime/Tools.java` lines 19-26, 245-253). That path would need: a provider webhook-tool endpoint on our API; a short-lived call-scoped token passed as a secret dynamic variable; a call principal kind; read-only tools with a timeout of 5 s or less and a spoken fallback. It stays Later. Our server would call the ATS through the connection; the model never would.

---

## 8. MCP position

| Question | Position | Evidence |
|---|---|---|
| Should the voice agent call a customer's or vendor's MCP server during a live call? | **[Avoid]** | No approving human on an outbound call; candidate speech and ATS text are prompt-injection input; credentials would sit in the shared voice-provider workspace (AM M9, M12, A8, E2, E3) |
| Should sync use vendors' MCP servers? | **[Avoid]** | User-OAuth, per-user rate-limited, beta, and wrapping the REST API anyway; no delivery guarantees (AM V1-V7, M6) |
| Should we run our own MCP server? | **[Later]**, triggered by a paying customer asking to use HRVoice from Claude, ChatGPT or Copilot | FACT: "Authorization is OPTIONAL for MCP implementations. When supported: Implementations using an HTTP-based transport SHOULD conform to this specification" (https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization). We choose spec-conformant OAuth 2.1 resource-server behaviour before any write tool. FACT: the launch spec calls MCP "a façade later" (`docs/superpowers/specs/2026-09-16-hiring-production-launch-design.md` line 72) |
| If triggered, what first? | A thin **read-only** facade that calls the **same services** as the web routes (`Jobs` candidate list by state, `stageHistory`, `ExternalPayloads`), with the same interceptor, permissions, PII rules and export rule. A key-based pilot only for hosts that accept a static bearer header (which hosts do is unverified), and only with a dedicated **"AI assistant (read-only)" preset**: decisions, call status and outcomes, **no call content and no contact details**, a required expiry of 90 days or less, and the tool list built from that key's permissions. Write tools only with user-delegated OAuth so each stage move traces to a person | AM review items (rounds 1 and 2); R15 |
| Placeholder MCP UI or claims | **[Avoid]** | FACT: "Shipping fake webhook/MCP UI" is a listed non-goal (launch spec line 88) |

---

## 9. Custom and legacy systems: the hierarchy

Stop at the first rung the customer can do. Rungs 1-3 depend on the developer surface, which ships only when a pilot needs it (section 13).

| Rung | Shape | Who it fits | Phase |
|---|---|---|---|
| 1 | Their script or iPaaS pushes to `/v1` and polls `/v1/events` | any custom or on-prem app with one developer; Pabbly, Zapier, Make, n8n users (scheduled polling) | Dev slice (curl + a small Python reference script, no SDK). Our webhooks only when a pilot needs push |
| 2 | Their cloud bus pushes HTTPS to `POST /v1/candidates:batch` | AWS EventBridge API destinations, Kafka HTTP Sink | Dev slice. Job and external ids travel **in the body**, per row if needed, so no lookup is required. Unknown job → `409 job_not_found`, which EventBridge retries (section 6.6). SNS and Pub/Sub envelopes V2 |
| 3 | File | systems that only export | MVP: UI CSV (exists), results CSV export (slice A); `text/csv` on the batch route (Dev). SFTP pull Later, paid. Hosting our own SFTP Avoid |
| 4 | They expose one narrow HTTPS endpoint through their own gateway or tunnel | enterprise wanting us to write into their system | Later; reuses `SafeHttp` |
| 5 | Read-only database view | enterprise with only a database | Later, paid exception with a DPA; never write, never CDC |
| 6 | An agent we ship into their network | | Avoid |
| 7 | Read-write DB, CDC, consuming their brokers, site-to-site VPN | | Never |

---

## 10. Multi-tenancy and identity (changed)

- Every new table: forced RLS on `organization_id = current_org_id()`; listed in `StructuralTest`; no BYPASSRLS; `Db` keeps "no method that disables row-level security" (FACT, `JAVA/platform/Db.java` line 33).
- Tenant is resolved only from server state: the API key hash (narrow SELECT-only lookup), the signed-in member's session (OAuth callback: the `state` hash is compared on that member's org's `connecting` row), or, in V2, an inbound webhook connection (order in section 11.1 item 8). Never from an `organization_id` or `job_id` in a payload.
- **Performance isolation:** the outbound lane with one job per org per pass, one drain per connection with its own backoff, the dial thread with one row per org per pass, and per-key rate windows (sections 6.1, 6.6, 6.8, 13.1).

**API key principal: the key acts as its creator, re-checked on every request.** (FACT why not `Db.NIL`: `audit_events.actor_user_id` and `jobs.created_by_user_id` have foreign keys to `users`, `MIG/0000_initial_schema.sql` line 132, `MIG/0015_hiring_desk_foundation.sql` line 43; `AuditService` swallows failures, lines 56-59; `Actor` requires a membership.)

1. `AuthResolver`, only for paths under `/v1` with `Authorization: Bearer hv_...`: hash the key and read it through the narrow lookup. **The key is valid unless** it is revoked, it has expired, its connection is `disconnected`, or its creator is no longer an active member (the existing `membership(createdByUserId, organizationId)`). **Nothing about delivery health, `needs_attention` or the connection's sending principal affects a key.**
2. Effective permissions = **key permissions ∩ the creator's live permissions**. Demoting the creator narrows the key on the next request.
3. `AuthContext` gains one nullable field, `apiKeyId`. `userId` is the creator, so every existing service, foreign key and audit path works unchanged. `AuthInterceptor` adds `apiKeyId` to the metadata of `authz.denied` and `authz.sensitive_access`; Settings > Activity shows "via API key '<name>'" when `metadata.apiKeyId` is present, and the audit CSV gets an `api_key_id` column.
4. No synthetic user or membership row is created for keys. Owner-only checks are unreachable with a key, because keys only work on `/v1`. A key never supplies `decidedBy`: there is no stage route in `/v1`.
5. A key whose creator left shows "Needs attention: the person who created this key no longer has access. Create a new key."

**Workers** (sync, drain, sweep, reconcile) run `inOrg(org, Db.NIL)` and pass **`null`** to `AuditService`, which stores NULL (FACT, `VoiceSessions.webhook` calls `audit.record(org, null, ...)`).

**The connection's sending principal** (`created_by_user_id`) matters only for connections that send (ATS notes and stage write-back; webhooks later). Its live permissions decide content (section 6.2). If that person leaves or loses `integrations.update`, the connection gets `needs_attention` with reason `principal_lost`, and sends stop until an admin presses "Take over" (audited). Pulls continue, and API keys are unaffected.

**The dial thread** (slice A2) rebuilds the clicking person's `Actor` from their live membership for each row. If they no longer hold `calls.initiate`, the row is skipped with a reason.

---

## 11. Security

### 11.1 MVP gates

1. **`Sealer`** generalised from `Notifications.seal`: AES-256-GCM, 12-byte random IV, keys from `INTEGRATIONS_KEYS` (`1:<base64>,2:<base64>`) and `INTEGRATIONS_KEY_CURRENT`, never derived from `BETTER_AUTH_SECRET` (FACT: rotating it already kills sealed mail, `apps/api-java/MIGRATION_STATUS.md` line 358). Output `k<version>.<base64>`, AAD = `organization_id:connection_id:secrets`. `Env` refuses to boot if the current version is not in the key list. A re-seal command (same pattern as the `--desk.reembed` CLI arguments, FACT `MIGRATION_STATUS.md` line 346) walks every org with `inOrg` and re-seals old versions; an old key is removed only after it reports zero rows left. A boot-time check of "every version still in use" is not possible: the rows are behind forced RLS and there is no bypass (FACT, `Db.java` line 33). A row sealed with a missing version opens as "reconnect needed". Do not reuse the plaintext `accounts.*_token` columns.
2. **API keys:**
   - format `hv_live_` + 32 random bytes; SHA-256 stored; shown once; UI prefix `hv_live_` + 6 characters;
   - presets, exactly:
     - "Send candidates in" (default): `jobs.read`, `jobs.create`, `candidates.read`, `candidates.create`, `candidates.update`, `candidates.delete`;
     - "Read results": `jobs.read`, `candidates.read`, `calls.read_transcript`, `candidates.export`;
     - "With contact details": "Read results" plus `candidates.read_pii`;
     - "AI assistant (read-only)" (only if the MCP pilot happens): `jobs.read`, `candidates.read`, expiry required, 90 days or less;
   - never `users.*`, `roles.*`, `integrations.*`, `organization.*`, `billing.*`;
   - effective permissions intersected with the creator's live permissions (section 10); validity rule in section 10;
   - revocable; optional expiry; `last_used_at`; creating one needs `integrations.create`; two keys may be live during rotation;
   - header only, `/v1` only. Disconnecting the `custom` connection revokes its keys in the same transaction.
3. **Who may connect what:** connect, edit, Retry and disconnect need `integrations.create/update/delete` (Owner, Administrator). Recruiters (who hold only `integrations.read`) see the status and "Ask a workspace admin". Content leaves only under the one export rule (section 6.2).
4. **OAuth client (slice E):** authorization code + PKCE (S256); one-time `state` (hash and 10-minute expiry on the `connecting` row; verifier inside `secrets_sealed`; both cleared on first use); exact redirect URI; narrowest scopes; data-centre hosts from a fixed allowlist; token requests as a form body; refresh under `pg_try_advisory_xact_lock`, held only for the refresh call; `invalid_grant` → `needs_attention` (`consent_revoked`); separate client ids per environment (FACT, RFC 9700 https://datatracker.ietf.org/doc/html/rfc9700).
5. **Outbound:** bodies per the export rule; webhooks, when built, with Standard Webhooks signing and `SafeHttp` (section 6.4).
6. **No secrets or PII in logs or `last_error`:** adapters and `SafeHttp` throw a code plus a plain sentence, never a URL with a query string, a token or a response body (FACT, `background_jobs.last_error` stores the exception message, `JobQueue.java` lines 149-153).
7. **Audit** (ids and counts only): `integration.connected`, `.updated`, `.taken_over`, `.disconnected`, `.reconnect_needed`, `.sync_completed`, `.candidate_adopted`, `.candidates_anonymised`, `.pushed` (with `content` flag); `api_key.created/revoked`; `api.*` writes (section 6.6); `authz.sensitive_access` for content reads through `/v1`, the feed and the CSV (section 6.2); `voice.session.content_erased`, `voice.session.provider_deleted`.
8. **Inbound webhooks (V2), in this order:** connection id from the path; a narrow SELECT-only lookup that returns only the org and the sealed inbound secret; verify on raw bytes with a constant-time compare; timestamp (±5 minutes where present) and delivery-id dedupe; only then `inOrg` writes, fetch-on-notify.
9. **Untrusted text:** ATS- and API-sourced text (JD, resume) is untrusted input. Lengths are capped. The JD is create-only on every machine path, so a key cannot rewrite what the agent says to candidates. `AdviceGuard` scrubs post-call text; it does **not** guard live speech, and nothing here claims it does.
10. **Retention, erasure and DPDP** — before the **first external connection of any kind** (Core going live with E or Dev):
    - a decided retention period with a working purge job for pulled-but-never-called candidates and for call content;
    - **one erasure path** used by ATS or `/v1` deletion after the grace period, by the retention purge and by manual candidate deletion in HRVoice (FACT: today `voice_sessions.candidate_id` is `ON DELETE SET NULL`, so deleting a candidate leaves their transcripts, backend map §6.3). In one transaction it nulls transcript, summary and answers and sets `content_erased_at`. `apply` writes only `WHERE content_erased_at IS NULL`, so a late provider webhook cannot refill it; the outcome sweep skips erased calls; `/recording` returns "no longer available" for them. The existing 5-minute call loop then calls the new `VoiceAgentPort.deleteConversation(externalConversationId)` for erased calls that still have a conversation id, and on success clears `external_conversation_id` (a later provider webhook then finds nothing and is ignored). FACT: the provider documents `DELETE` for a conversation (https://elevenlabs.io/docs/api-reference/conversations/delete); whether that removes audio, transcript and backups is unverified;
    - a customer DPA that lists the voice provider and the LLM provider as sub-processors;
    - a breach runbook.

    ASSUMPTION: we act as a DPDP data processor; needs a lawyer. FACT (secondary): DPDP Rules 2025 notified November 2025, most obligations from about May 2027 (SA R12; Gazette text unverified).
11. **Voice-provider webhook:** narrowing the ±30-minute window waits until we confirm how the vendor timestamps retries (unverified). Replays are harmless downstream, because the outcome sweep emits only when the call's content hash changes.
12. **Ingress:** Caddy overwrites `X-Forwarded-For`, the Java port is reachable only through Caddy, and a spoofed header does not change the rate-limit bucket (section 6.6). Recorded in ADR-010.

**Merge-blocking tests** (one each):
- RLS drift for new tables.
- `Sealer` round trip; a wrong AAD fails; a wrong key version fails; boot refuses a missing current key.
- The forbidden-field, export-rule and evaluative-corpus test (section 6.2).
- **Keys survive delivery failure:** with the ATS drain or (later) the webhook failing until the connection shows "Couldn't send", the same key still gets `200` from `PUT /v1/candidates/by-external/...` and `GET /v1/events`.
- An API-key read of a PII field writes `authz.sensitive_access` with `actor_user_id` = creator and `metadata.apiKeyId`; `PUT /v1/jobs/by-external` creates a job; a key whose creator was removed gets 401.
- **Lost provider webhook:** the session is ended (or stuck `active`) with no result, the 5-minute loop reconciles it, and `call.ended` is emitted. A connected call with no user turn emits `no_conversation`. Provider unreachable: `result_unavailable` after the deadline.
- **No backlog:** an org with 7 days of settled calls connects; nothing is emitted for them; a call ending afterwards emits once.
- **Purge:** delete all `integration_events`, re-run `apply` and the sweep on a 40-day-old call, and nothing is emitted. A connection that missed purged events shows `missed_until`.
- **Feed ordering:** two concurrent emits commit out of order; a poller sees both. An expired cursor gets `410 cursor_expired`.
- **Stage outbox:** two concurrent identical stage changes emit one event, with the right `from`.
- **Baseline:** link a job with 10 declined candidates, turn on write-back: zero `setStage` calls (`FakeAts`).
- **Undo:** decide, undo within 10 s, and no ATS write happens (`FakeAts`).
- **Erasure:** anonymise a candidate; `FakeVoice.deleteConversation` is called; `/recording` is refused; a replayed provider webhook does not refill content; the sweep emits nothing.
- **Linked fields:** editing the phone of an ATS-linked candidate is refused with `candidates.managed_externally`.
- **A2 at most once:** `FakeVoice.dial` throws after the `voice_sessions` insert: exactly one session exists and the row is never dialed again. A row with a retry `reason` is never dialed. Each dial error code maps as in section 13.1.
- **Shared agent:** with a live call for job A on an agent version, a dial for job B on the same version gets `calls.agent_in_use` and does not re-provision.
- **Isolation:** a slow ATS or receiver does not delay an email job.
- No token text in `last_error` after a failed refresh.

### 11.2 Enterprise (Later, only when a deal requires it)

Unchanged: KMS envelope encryption once hosting moves to AWS `ap-south-1`; customer-managed keys; SSO/SAML; IP allowlists on keys; a documented static egress IP; an egress proxy (e.g. Smokescreen) in front of `SafeHttp`; rungs 4-5 under a signed DPA.

---

## 12. Onboarding flow

All in one new Settings tab, **"Connected systems"**, shown with `integrations.read`; buttons need `integrations.create/update/delete`. Status uses the "Calling number" card pattern (FACT, `apps/web/components/settings/sections.tsx` lines 238-318). The server returns stable codes and the web maps them to sentences, because `apps/web/lib/errors.ts` (line 77) discards messages containing "webhook", "token", "api key" or "payload". Before shipping:
- rename the agent page's existing "Integrations" group for test tools (FACT, `apps/web/app/agents/[id]/page.tsx` lines 700-735);
- unhide the Integrations permission group (`apps/web/components/settings/access.ts` line 109).

**Definition of done for every integration slice:** the website FAQ answer on ATS integration (FACT, currently "Not yet", `apps/web/components/site/faq.tsx` lines 53-55) and the Tools page "Your own systems: Later" card (`apps/web/app/tools/page.tsx` lines 106-119) say exactly what works after that slice, and nothing more (FACT, launch spec anti-pattern line 88).

### 12.1 "Your own system" (Dev slice; for a developer or an iPaaS user)

1. **Create a key.** Name it, pick one preset (default "Send candidates in"). The key is shown once with a copy button, the base URL and a link to the reference script.
2. **Read results.** The page shows how to poll `GET /v1/events` and links the reference docs. No webhook step until webhooks exist.
3. **Status card:** each key's "Last used 3 minutes ago", "Expires on …", or "Needs attention: the person who created this key no longer has access".

### 12.2 "Zoho Recruit" (slice E; for a non-technical admin)

| Step | What the person sees | What we decide |
|---|---|---|
| 0 | Empty state: "Bring candidates in from the hiring system you already use, and send each call's results back to it." Only systems that really work are listed | |
| 1 | "We'll read" (the job openings you pick and their candidates: name, mobile, email, resume text, status) / "We'll write" (a note after each call with the answers; their status only if you turn that on). "We never send a score or a recommendation." | Scopes, fixed and narrow |
| 2 | Redirect to Zoho; sign in; approve. India data centre handled from the response | |
| 3 | Pick jobs (none pre-ticked); link each to an existing HRVoice job, or create a new job with the title and the **full** JD copied through the existing JD-text path | Title matching pre-selects a link |
| 4 | "Bring people in when their status is …", read live from their list | Pre-select the first status containing "new", "screen" or "applied", else nothing |
| 5 | "Send decisions back?" switch, **off**; when on, pick the status for "Moved forward" and for "Not moving forward", with the line "Decisions you make from now on are sent 2 minutes after you make them, so you can change your mind. Earlier decisions are not sent." | Note write-back is always on |
| 6 | "Check the connection": read-only; "We can see 3 jobs and 41 people at Applied" (names only for holders of `candidates.read_pii`) | |
| 7 | "Start bringing people in" → "New people will show up on your jobs within 15 minutes. Results of calls from now on are sent to Zoho Recruit." **Then** a list of each newly created job with "Link an agent (needed to call) and add must-ask questions (recommended)". The agent is pre-selected when the workspace has exactly one published agent | FACT: a job without an agent cannot be phoned (`HiringController.java` line 352); a job without questions can, using the JD or the agent's own criteria (`CallContextCompiler.java` lines 119-136) |

States: **Connected** ("Last checked 4 minutes ago. 3 jobs linked. Connected by Priya."), **Needs attention** (access withdrawn in Zoho Recruit; a mapped status was renamed; the person who connected it left, with Take over), **Paused until 4:10 pm** (Zoho's daily limit), **Not connected**. Separate lines, not states: "Couldn't send since 10:40" with Retry (admins); "3 people couldn't come in: number not valid. Fix them in Zoho Recruit." with Sync now; "2 people removed in Zoho Recruit will be anonymised on 10 Oct"; "Results of calls before 3 Nov could not be sent". Reconnect keeps all choices. Disconnect confirms with `ConfirmDialog` and keeps everything already in HRVoice.

Day to day:
- board rows say "From Zoho Recruit" and show the remote status read-only ("In Zoho Recruit: Interview");
- linked contact fields are read-only with "Edit this in Zoho Recruit" (enforced by the server, section 4);
- people closed in the ATS show "Closed in Zoho Recruit" and are left out of "Not called yet";
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
| **0. Prerequisites** | E.164 stored form and `toE164` fix: first a read-only query listing rows that would collide on `(job_id, phone)` after normalisation; an operator merges or removes them; then the backfill runs, and it refuses to run while collisions exist. The web edit and import screens show and accept the stored form. `ExternalPayloads` (no summary, must-ask answers only, public decision values, sensitive-read audit) + its merge-blocking test; the adapter's `rationale` fix; `Sealer` with `INTEGRATIONS_KEYS` and `INTEGRATIONS_KEY_CURRENT` | Backfill only with the web pointed at Java (Nest still writes the old format) | 4-6 days |
| **A. Results CSV export** | Section 6.7 | none | 1-2 days |
| **A2. Call selected, and background reconcile** | See below | Founder decision 10a | 4-5 days |
| **Core** | Migration (`integration_connections`, `job_links`, `candidate_links`, `integration_events`, `voice_sessions` columns, `source` values, `integration` kind); `Events.emit` with the per-org lock and per-org `seq`; the stage outbox in `updateStatuses` (lock first, `FOR UPDATE`); `IntegrationScheduler` and the `sweep` handler; outbound lane and `Snooze`; the erasure path; `actions.integrations`; pool-size check | Built **together with** the first of E or Dev; never on its own. ADR-010 written and ADR-008 accepted (or Nest's stage routes unreachable from the web) | 5-7 days |
| **E. First named connector** | OAuth client, `ZohoRecruitAts` + `FakeAts`, pulls, nightly reconcile, deletions with confirmation and re-link, anonymisation, dial guard, `integration_deliveries` and the drain, notes, opt-in stage write-back from a baseline, server-side read-only linked fields, the 7-step UI | A pilot confirms Zoho Recruit (or names its system) | 3-4 weeks |
| **Dev. Developer surface** | `api_keys` and the `AuthResolver` branch, seven `/v1` routes, per-key limit, ingress checks, the feed, OpenAPI file, reference script, "Your own system" UI, "via API key" in Activity | A pilot confirms it will connect through its own developer or an iPaaS (FACT, the comparison's own condition, `docs/integrations/01-comparison.md` line 107) | 6-8 days |
| **Webhooks** (new split) | `SafeHttp`, Standard Webhooks signing and rotation, the drain for an endpoint, `integration_deliveries`, test event, delivery list, sealed URL, the stage-event hold | The Dev pilot says polling the feed is not enough | 4-5 days |

**Slice A2 in detail.**
- **Where:** the job's candidates bulk bar gets "Call selected (N)", plus a "Select everyone not called yet" shortcut (the redesign spec asked for a bulk call there, `docs/superpowers/specs/2026-10-01-saas-redesign-design.md` line 202). Needs `calls.initiate`. Disabled with a reason when the job has no agent. One `ConfirmDialog` with the count, calling hours and the remaining monthly budget (no invented cost estimate).
- **Rows:** one `scheduled_calls` row per selected candidate with a phone and no open row: `reason = 'bulk'`, `attempt = 1`, `due_at = now()`, `agent_id` = the job's agent, `requested_by_user_id`. No migration (FACT, MIG/0025).
- **Dispatcher:** one daemon dial thread, woken by the click and by a 15-second `@Scheduled` nudge. Each pass visits active orgs round-robin and, per org, claims **at most one** due row with `status = 'scheduled' AND reason = 'bulk' AND due_at <= now() ... FOR UPDATE SKIP LOCKED`, sets it to `dialing` and **commits before dialing**. It only ever reads `reason = 'bulk'` rows, so the retry rows that `apply` writes when `callPolicy.retry.enabled` is on are never dialed by it. `ponytail:` one thread, one dial per org per pass; a second thread when dials queue behind each other.
- **Per row:** rebuild the clicker's `Actor` (section 10); skip with a reason if the row was cancelled, the candidate is closed in the ATS, or the candidate got a phone call after the row was created; wait (move `due_at`) until the use case's calling window opens (FACT, `callPolicy.retry.window` 10:00-19:00 Asia/Kolkata in `usecases/hiring.json`; no Sundays in `CallOutcomes.nextAttempt` lines 89-108); call the existing `startOutbound`; on success set `done` and `voice_session_id`.
- **Stable error codes.** Today every refusal in `startOutbound` and `dialLocked` is `ApiError.conflict(message)` with code `conflict`, and the lock timeout and `BudgetGuard` refusals too (FACT, `JAVA/voice/VoiceSessions.java` lines 362-463, `JAVA/platform/ApiError.java` lines 54-56, `JAVA/platform/Db.java` lines 103-115, `JAVA/cost/BudgetGuard.java` lines 50-54). A2 gives each a code, keeping HTTP 409 and the message (FACT: no web code matches the literal code `conflict`, grep of `apps/web`):

  | Code | Raised | Row becomes |
  |---|---|---|
  | `calls.concurrency_cap`, `calls.agent_in_use`, `calls.busy` (lock timeout) | before any session row | `scheduled`, `due_at = now() + 60 s` |
  | `calls.daily_cap` | before any session row | `scheduled`, `due_at` = next calling window |
  | `calls.not_ready` (line not connected, agent not published, job linked to another agent), `budget.exceeded`, `calls.provision_failed` | before any session row | this row **and every other open bulk row of the job**: `skipped`, same visible reason (one UPDATE) |
  | `validation_failed` (phone), `calls.live_call` | before any session row | `skipped`, visible reason |
  | `calls.dial_failed`, or anything else | possibly after the session row | `done` or `skipped`; **never dialed again** |

- **At most once.** A row that reached `dialing` is never set back to `scheduled` unless the code says the refusal happened before a session row existed. A row left in `dialing` for more than 10 minutes (a crash) becomes `skipped` ("interrupted"), never re-dialed.
- **Shared hosted agent guard** (in `provisionLocked`, so it covers every dial and every browser test): one hosted agent per agent version is re-synced when the job context changes, and the advisory lock is held only until `voice.dial` returns (FACT, `VoiceSessions.java` lines 154-219, 362-376; the dial body carries no per-call config, `HostedVoiceAdapter.java` lines 252-256). Whether the provider reads a phone call's config at dial time or when the person answers is unverified. So: before a **re-sync**, if any `pending`/`active` session on the same agent version, started inside the stale-expiry window, has a `provision_snapshot.contextHash` different from the new one, refuse with `calls.agent_in_use` ("This hiring agent is on a call for another job. Try again when that call ends."). Same-job dials do not re-sync and are not affected. Per-call `conversation_config_override` on the phone path does not remove the need: it can carry prompt, first message and language, but not the per-job data-collection questions (FACT, `HostedVoiceAdapter.java` lines 95-99; the outbound-call API accepts `conversation_initiation_client_data.conversation_config_override`, https://elevenlabs.io/docs/api-reference/integrations/twilio/outbound-call).
- **Board:** "Queued to call", "Stop queued calls" (one UPDATE to `cancelled`), and each skipped row with its reason ("Not called: number not valid").
- **Background reconcile for every org** (section 6.1) ships here, because A2 places calls nobody is watching.

Launch gates: the retention, erasure and DPDP items of section 11.1 item 10 before the first external connection; integrations only with the web pointed at the Java API.

### 13.2 V2

- A second connector chosen by pilot data (Keka Hire, a Google Sheet, Workable).
- Inbound vendor webhooks as re-fetch hints.
- Per-job "Call new people automatically", **only after** a written founder decision with legal advice. It reuses the A2 dispatcher (FACT: TRAI TCCCPR Second Amendment, https://trai.gov.in/sites/default/files/2025-02/Regulation_12022025.pdf; applicability to screening calls unverified).
- Our own call summary (one `summaryInstruction` pass per call, stored separately) if a pilot wants summaries in the ATS or the feed.
- Sending decisions made before write-back was switched on, as an explicit choice, if a pilot asks.
- Leaving ATS-decided rows out of "Ready for review", if pilots who work in their ATS find the queue noisy (touches founder decision 6).
- Dial-time `dynamic_variables` with a minimal allow-list.
- Our own Zapier app; SNS and Pub/Sub envelopes; an internal dead-job view; per-key limits in Postgres once there is more than one replica.

### 13.3 Long term (Later)

Our own MCP server (section 8); a Kombo or Merge `AtsPort` once three or more ATSs are requested by paying customers; Greenhouse and Lever via partner programmes; Darwinbox; enterprise rungs 4-5; in-call tools (section 7); section 11.2; a CRM contact/deal shape when SalesVoice or SupportVoice need it.

### 13.4 Avoid

In-call MCP; MCP-based sync; direct DB access beyond the paid read-only exception; CDC; consuming customer brokers; our own on-prem agent; hosted SFTP; SDKs and widgets; a rules builder; a cross-vendor canonical schema or field-mapping editor; two-way editing of the same field; auto-rejecting people who did not answer; writing any score, coverage, rank, "qualified", summary written by a vendor model, or system-chosen stage anywhere outside; Freshteam and Naukri RMS connectors.

---

## 14. First real integration and how to test it without buying anything

### 14.1 Choice

- Slices 0, A and A2 help every customer now.
- **Zoho Recruit is the first named connector** if a pilot uses it: self-serve OAuth, an India data centre, a documented REST API with incremental polling, and a free plan with API access. The evidence that Indian SMBs use it is vendor-written, so the founder confirms with pilots first.
- The developer surface is first only if a pilot has a developer or an iPaaS.

### 14.2 Testing without buying anything

- **Automated:** the existing JUnit 5 + Testcontainers suite plus the merge-blocking tests in section 11.1, using `FakeVoice` (lost webhook, stuck `active`, silent call, unreachable provider, dial failure after insert, delete conversation) and `FakeAts` (baseline, Undo, rename, rate limit, deletion confirm).
- **Manual push-in:** `curl` and the reference Python script against a local Java API.
- **Manual pull-out:** the reference script polling `/v1/events`.
- **iPaaS path:** self-hosted n8n, free edition, polling the feed on a schedule (FACT, https://docs.n8n.io/deploy/host-n8n). Do not use Zapier for free testing.
- **Zoho:** a Zoho Recruit Free account in the India data centre (FACT: 1 active job, 5,000 API credits a day, no webhooks, https://www.zoho.com/recruit/plan-comparison.html); one Web-Based OAuth client per environment (https://www.zoho.com/recruit/developer-guide/apiv2/register-client.html); 5-10 test candidates using team members' own numbers with their consent.
- **Spreadsheets:** open the results CSV in Excel (Windows) and Google Sheets, with a Hindi answer and phone numbers.

Not testable for free: Zoho webhooks; custom-status behaviour on paid plans; Keka, Greenhouse, Lever, Darwinbox.

---

## 15. Risks

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R1 | Pilots do not use Zoho Recruit (or any ATS); a connector is built for nobody | Medium / High | E and Dev are both gated on a pilot; 0, A and A2 serve everyone |
| R2 | Duplicate results or notes in a customer's system | Medium / High | Dedupe on the call row (compare-and-set), no backlog on connect, note markers carry the content hash, one ordered drain per connection |
| R3 | Advice or a score leaks into an ATS | Medium / High | No summary leaves HRVoice; answers from must-ask keys only, never `rationale`; scrub as a backstop; evaluative-corpus test; adapters with no generic write |
| R4 | Duplicate candidates and misdialed numbers from automated intake | High / High | Slice 0 E.164 with collision pre-check before any automated intake |
| R5 | A connection silently stops (revoked consent, the connecting person left, plan downgrade) | Medium / High | `needs_attention` with a reason, one email to admins, "last checked" line, Take over; delivery problems shown as separate lines; `missed_until` |
| R6 | We exhaust a small customer's Zoho daily credits | Medium / Medium | Budget with write reserve, `If-Modified-Since`, polling slows first, "Paused until" |
| R7 | SSRF from a customer-supplied URL into our VPS | Low until webhooks ship / High | Webhooks deferred; when built, `SafeHttp` with public-only resolution, no IP literals, port 443, no proxy, no redirects |
| R8 | PII sprawl and DPDP exposure | High / High | Field allowlist; ids-only event rows; bodies built at send time; one erasure path that also reaches the voice provider; retention gate before any external connection; DPA with sub-processors; runbook |
| R9 | Pressure to auto-call imported candidates before consent and DND are settled | High / High | A2 needs one person's click per batch and dials each row at most once; auto-call is V2 behind a written founder decision |
| R10 | Nest and Java run side by side | Medium / Medium | Results and ATS stage write-back are level-triggered from the database and catch Nest writes; feed stage events are emitted only by Java, hence the gate in section 13.1 |
| R11 | Stage drift: a customer renames a status | Medium / Medium | Read the status list live; unmapped → "Needs attention" (`status_unmapped`), stage pushes stop, notes continue |
| R12 | The public API becomes a promise we cannot change | Medium / Medium | Seven routes, versioned path, public decision values, documented feed semantics. Ceiling: polling latency for iPaaS users until webhooks ship |
| R13 | Failures are invisible | High / Medium | Per-connection status, separate delivery, issues, anonymisation and missed lines; per-kind backlog in `/health`; skipped bulk rows with reasons |
| R14 | Vendor API churn | Certain over time / Medium | One connector until it has paying use; vendor code inside one adapter |
| R15 | A customer's own LLM ranks candidates from data we export | Medium / Medium (reputational) | Factual bodies without summaries; content only under the export rule; the MCP preset carries no content |
| R16 | The hosted voice adapter's fetch path has never run live, and background reconcile depends on it (FACT, `apps/api-java/MIGRATION_STATUS.md` lines 89, 353) | Medium / High | `FakeVoice` tests for each path; `result_unavailable` after 90 minutes; settle and deadline values tuned after the first live calls |
| R17 | One tenant's dead endpoint or slow vendor delays others | Medium / Medium | Lane with one job per org per pass, one drain per connection with backoff, 3 s / 10 s timeouts; dials on their own thread |
| R18 (new) | A batch dials job A's candidate with job B's script and questions on a shared hosted agent | Unknown (vendor behaviour unverified) / High | Re-sync guard `calls.agent_in_use`; one supervised live check of when the provider binds a phone call's config |
| R19 (new) | Erasure at the voice provider is incomplete (backups, retention) | Unknown / High | Delete the conversation through the documented endpoint; ask the vendor in writing; DPA lists it as a sub-processor |

---

## 16. Founder decisions needed (details and evidence in `01-comparison.md`)

1. Where do the first five pilots keep candidates, and does any have a developer or a paid iPaaS? **This decides whether E or Dev is built at all** (D1, D4).
2. Is pickup within about 15 minutes acceptable, and how many jobs does a pilot keep open? (D5, D6)
3. May keys carry answers, and only by explicit admin choice under the export rule? (D7, D8)
4. What goes into the ATS note? **Default now: outcome, answers and a sign-in link, no summary**, because the stored summary is the voice provider's, not ours. A summary outside HRVoice needs our own summary first (V2). (D9)
5. Is it acceptable that ATS-linked contact fields are read-only in HRVoice? (D10)
6. May a stage change ever come from another system rather than a named person in HRVoice? (D11)
7. May "Not moving forward" set a reject status in the ATS (which may email the candidate), given the 2-minute hold and that earlier decisions are never sent? (D12)
8. May the customer's own system name ("Zoho Recruit") appear in the UI?
9. Retention period for pulled-but-never-called candidates and transcripts; the grace period before anonymising people deleted in the ATS or through `/v1`; confirmation that we act as a DPDP processor; DPA. (D17)
10. Automatic calling of imported candidates: yes or no, and under what consent, hours and DND rules? (needs legal advice)
    - **10a.** Ship "Call selected (N)": one person's confirmed click queues calls for the chosen people within calling hours, each dialed at most once. A legal check is needed on whether a queued batch counts as an "auto-dialer" under TCCCPR (unverified).
11. Price per SMB customer and whether "data stays in India" is a sales promise. (D19)
12. Will support and sales use cases reuse `jobs`/`candidates` or get their own tables? (D18)
13. Is it acceptable that a key stops when the person who created it leaves, and that ATS sending stops until an admin takes the connection over?
14. (new, outside integration scope) The in-app summary is also the voice provider's summary, filtered only by the 9-word guard. Should HRVoice generate its own summary for the app too?

## 17. Unverified items to check during the build

- When the voice provider binds a phone conversation's configuration: at the dial request or when the person answers (decides whether the re-sync guard can ever be relaxed).
- Whether the provider's conversation delete removes audio, transcript and backups; whether a summary instruction can be configured on the provider (only `summary_language` is documented on agent creation).
- Whether one Zoho `If-Modified-Since` call covers applications across all linked jobs; Zoho Change Status with `jobids` for custom statuses; Zoho data-centre token hosts for Indian accounts; whether Zoho notes can be listed cheaply for the marker check; whether Zoho deletes a record when merging duplicates.
- How long after a call the provider's post-call webhook usually arrives; the 3-minute settle and 90-minute deadline are guesses until live calls are measured.
- Whether the voice provider re-signs retried webhooks with a fresh timestamp.
- How Next's `/backend` rewrite forwards `X-Forwarded-For`.
- How Excel and Google Sheets show the CSV phone format.
- Spring Framework's deprecation of its OkHttp request factory (the reason `SafeHttp` uses OkHttp directly); which MCP hosts accept a static bearer header; whether iPaaS hook URLs act as bearer secrets.
- Whether a queued, human-confirmed batch of calls is an "auto-dialer" under TCCCPR.
- Keka Hire write endpoints; Merge and Kombo data location; DPDP Rules wording against Gazette G.S.R. 846(E); whether 3001 is the Nest API in every environment.
