# 06 — Backend / distributed systems view: integration service inside apps/api-java

_Written 2026-10-03. Research only: no code, config, migration or test was changed. Author role: backend / distributed systems architect, working independently of the other experts._

Labels: **FACT** (source: repo path or URL), **RECOMMENDATION**, **ASSUMPTION**, **unverified**.
Path shorthands follow `00-current-system-backend.md`: `JAVA/` = `apps/api-java/src/main/java/desk/`, `MIG/` = `packages/db/drizzle/`.

---

## 1. Summary

The founder wants "connect once, data flows in, agent works, results flow back". The existing Java backend already holds most of the machinery: a durable per-tenant job queue, RLS with narrow lookup policies for unauthenticated webhooks, HMAC verification, in-process domain events, an audit log and a ports-and-adapters convention. What is missing is a thin layer of data and code. That means a connection record with sealed credentials, an external-id link table, one new queue kind, a scheduler tick, an inbound webhook route, an outbound delivery path, org API keys, and one connector adapter.

My central design choice is **level-triggered, state-based sync rather than event-based sync**. The current events are re-published every time `VoiceSessions.apply` runs, are lost on a crash, and do not exist for stage changes. So write-back should not depend on them. A periodic sweep compares "what our tables say now" with "what we last pushed" (a hash stored on the link row) and enqueues pushes for the difference. The events are kept only as a wake-up signal for low latency. This gives idempotency, crash recovery and loop prevention without a transactional outbox, Kafka or a new service.

The second key choice is about mapping. **Our job-scoped `candidates` row is, one to one, an ATS "application"** (one person on one job). The ATS candidate id is stored as a parent id. So there is no need for a parallel candidate model, and the existing intake rules (phone normalisation, `(job_id, phone)` uniqueness) apply unchanged.

For a two-to-three person team, the MVP is:
1. One additive migration.
2. Org API keys plus a small `/v1` REST surface with upsert-by-external-id. This covers custom apps and no-code tools.
3. Signed outbound webhooks in the Standard Webhooks format.
4. Exactly one native ATS connector, chosen by the first paying customer's actual system.

Write-back is limited to two actions: a factual note (call outcome, summary, answers to the customer's own questions, a link back) and a stage move that a person chose, mapped by the customer. No score, no `fitPercent`.

Buy vs build: unified APIs are real and well documented. Merge is $650/month for up to 10 linked accounts, then $65 each. Apideck starts at $599/month for 25 consumers. Kombo is contract-priced. The coverage that matters for Indian SMBs is patchy: Kombo lists Zoho Recruit but not Keka or Darwinbox, and Merge lists Zoho Recruit as Beta. Per-account pricing is heavy against Indian SMB contract values. I recommend building the first connector behind a Java `AtsPort`, so that a Kombo or Merge adapter can later be added as just another adapter, when three or more ATSs are demanded or an enterprise ATS appears.

Scaling to thousands of connections needs no new service. The same Spring process scales by adding worker threads and replicas on `FOR UPDATE SKIP LOCKED`, with one in-flight pull per connection and a due-index table once org count passes the ceiling the code already flags.

Not to build now: an OAuth authorization server, an MCP server, an SDK or embed, direct customer-DB access, customer-side agents, SFTP, a generic workflow engine, a cross-domain canonical data model, field-level two-way editing, in-call ATS tools and auto-dialing on import.

---

## 2. Findings

### 2.1 What the existing backend gives us (and its sharp edges)

| # | Label | Finding | Source |
|---|---|---|---|
| B1 | FACT | `JobQueue.enqueue` runs in its own transaction: `inScope` → `db.inOrg` → `TransactionTemplate` with `PROPAGATION_REQUIRES_NEW`. You therefore **cannot** enqueue atomically with a business write by calling it inside another `inOrg` block. | `JAVA/jobs/JobQueue.java` lines 66–76, 163–165; `JAVA/platform/Db.java` lines 44–61 |
| B2 | FACT | A successful job row is **deleted** (`delete from background_jobs where id = ?`). The idempotency index only covers `status in ('queued','running')`. After success, the same key can be enqueued again. The queue therefore gives "no duplicate while pending" and is **not** a permanent dedupe store or delivery history. | `JobQueue.java` lines 143–144; `MIG/0030_background_jobs.sql` index `background_jobs_idempotency_idx` |
| B3 | FACT | `runScope` loops `for (;;)` claiming 10 jobs at a time for one org until that org has none due. A tenant with a large backlog keeps one of the **2** worker threads until the backlog is drained, so it is not fair across tenants. | `JobQueue.java` lines 50–54, 113–130 |
| B4 | FACT | The safety-net poll opens one transaction per active org every 30 s. The code carries `ponytail: … add a due-organizations index table past ~1k orgs`. | `JobQueue.java` lines 79–109 |
| B5 | FACT | Retry backoff is `base × 2^(attempt-1)`, capped at 3600 s. `max_attempts` is 1–20. A handler can see `finalAttempt`. There is **no way to enqueue with a future `run_at`**, because `enqueue` has no delay parameter. | `JobQueue.java` lines 41–43, 146–160; `MIG/0030…` |
| B6 | FACT | `VoiceSessions.apply` coalesce-writes results in one transaction. Then, outside it, it publishes `call.ended`, and `result.ready` when there is content. It does this on every call to `apply` for an ended session: webhook, reconcile, or opening the results page. Events are synchronous Spring events with a log-only listener. | `JAVA/voice/VoiceSessions.java` (method `apply`); `JAVA/engine/DomainEvents.java` |
| B7 | FACT | Stage changes go through `jobs.updateStatuses`, then `stageAudit` in a separate call. No domain event exists for a stage change. | `JAVA/hiring/HiringController.java` lines 362–396 |
| B8 | FACT | Candidates have `updated_at` (set explicitly in `Candidates.update`). `voice_sessions` has none. The jobs and candidates tables both have `updated_at`. | `MIG/0015_hiring_desk_foundation.sql` lines 10, 22; `JAVA/hiring/Candidates.java` `update` |
| B9 | FACT | Candidate create and CSV confirm insert with `source` `'manual'`/`'resume'`, `screening_status 'new'`. Duplicates are detected via unique violation on `(job_id, phone)`. Confirm uses a savepoint per row. | `JAVA/hiring/Candidates.java` `create`, `confirmImport` |
| B10 | FACT | The unauthenticated-webhook pattern already exists. Verify HMAC on the raw bytes first. Then `Db.withWebhookConversation` sets one transaction-local setting, and a SELECT-only policy exposes exactly one row. Writes then run under `inOrg(org, NIL)`. | `MIG/0022_voice_webhook_lookup.sql`; `Db.java` lines 83–95; `VoiceSessions.webhook` |
| B11 | FACT | `Db.underAdvisoryLock(key, work)` gives a cross-replica mutex through `pg_advisory_xact_lock(hashtextextended(key,0))`. | `Db.java` lines 97–115 |
| B12 | FACT | The Java target is 17 with Spring Boot 3.4.5, so virtual threads (Java 21) are not available. `RestClient` is already used for the voice vendor. | `apps/api-java/pom.xml` lines 8–18; `JAVA/voice/HostedVoiceAdapter.java` line 23 |
| B13 | FACT | The hosting ADR prefers a single Docker Compose stack on one Indian VPS (4 vCPU / 8 GB) as the starting point. | `BRD's/10_ADRs/ADR-006-hosting-deployment.md` lines 61–66, 143 |
| B14 | FACT | The spec's `Integration` entity is `id, organization_id, type, provider, status, credential_reference, metadata`, with "Do not store provider secrets as ordinary plaintext database values." | `BRD's/04_DATABASE_API_SPEC.md` lines 303–316 |
| B15 | FACT | Dialing reads `candidates.phone` only (`PhoneNumbers.toE164`), and CSV import stores national digits plus a separate `country_code`. ATS feeds usually hold full international numbers (ASSUMPTION, unverified per vendor). | `00-current-system-backend.md` §9 |

### 2.2 External facts (vendors, standards)

| # | Label | Finding | Source |
|---|---|---|---|
| E1 | FACT | **Zoho Recruit API v2.** OAuth 2.0 authorization code. Access tokens are valid for 1 hour. The refresh token "has an unlimited lifetime until it is revoked by the end-user". Scopes are per module, for example `ZohoRecruit.modules.candidates.READ` and `ZohoRecruit.modules.jobopenings.READ`, plus `notifications.*`. | https://www.zoho.com/recruit/developer-guide/apiv2/oauth-overview.html |
| E2 | FACT | **Zoho Recruit limits.** Daily credits on a rolling 24 h window: Free 5,000; Standard 5,000 + 250 per user (max 100,000); Professional 10,000 + 500 per user; Enterprise 15,000 + 1,000 per user. Concurrency is per user per app (10/15/20 by edition), with a sub-concurrency limit of 10 on heavy APIs. There is no per-minute limit. Up to 100 records per insert/update call. | https://www.zoho.com/recruit/developer-guide/apiv2/limits.html (read through a search summary; the page's own figures should be re-checked before build) |
| E3 | unverified | Zoho Recruit has a `notifications` OAuth scope. The `actions/watch` channel API (including `channel_expiry`) is documented for Zoho CRM and Zoho vertical solutions, where the expiry is at most 1 day (vertical) or 1 week (CRM v8). I found no Recruit-specific page, so any Zoho webhook would need channel renewal and must be tested. | https://www.zoho.com/developer/docs/vertical-solutions/api/v2/notifications/overview.html; https://www.zoho.com/crm/developer/docs/api/v8/notifications/update-info.html |
| E4 | FACT | **Greenhouse Harvest.** v1/v2 were deprecated and removed on 2026-08-31. v3 uses OAuth: client credentials for a customer-built integration, or the authorization code grant for partners. Rate limits are per 10-second window (`X-RateLimit-*`, HTTP 429). Pagination uses an RFC 5988 `Link` header. Recruiting webhooks are signed: HMAC of the raw body with the webhook's secret, sent in a `Signature` header. | https://docs.greenhouse.io/harvest.html; https://harvestdocs.greenhouse.io/docs/authentication; https://developers.greenhouse.io/webhooks.html |
| E5 | FACT | **Keka.** It has a public developer portal with Hire endpoints: list a job's candidates, update a candidate (`PUT /v1/hire/jobs/{jobId}/candidate/{candidateId}`) and add a candidate note. It also has an assessment-partner API for pushing results back. Auth is OAuth2 bearer, with authorization code for marketplace partners. Rate limits are documented on its own page. | https://developers.keka.com/; https://developers.keka.com/docs/assessment-partners-guide (details partly from a search summary) |
| E6 | FACT (third-party sourced) | **Darwinbox.** API access is "on request". Recruitment endpoints include bulk candidate data with `updated_from`/`updated_to` filters, reject candidate, and add tags. Auth is described differently by different sources. | https://api-docs.darwinbox.com/ (official link); details from https://www.getknit.dev/blog/darwinbox-api-directory-qrxqrz (third party; treat as unverified) |
| E7 | FACT | **Standard Webhooks.** Headers are `webhook-id`, `webhook-timestamp` and `webhook-signature`. The signed content is `msg_id.timestamp.payload`. Signatures are `v1,` + base64 HMAC-SHA256, or `v1a` for ed25519. Receivers should check timestamp tolerance and use `webhook-id` as the idempotency key. The suggested retry schedule runs from immediately, then 5 s, 5 min, 30 min and on to about 75 h, with jitter. | https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md |
| E8 | FACT | **Merge (unified API).** Launch plan: 3 production linked accounts free, then $650/month for up to 10, then $65 per linked account. Daily sync frequency on Launch. Rate limit 100/min on Launch. Webhooks are signed with `X-Merge-Webhook-Signature` (HMAC-SHA256, base64url). Event types include `Candidate.changed` and `{model}.removed`. ATS writes include `POST /applications`, `POST /applications/{id}/change-stage` and `POST /activities` (type `NOTE`). Zoho Recruit is listed as **Beta**. A Keka integration page exists. | https://www.merge.dev/pricing; https://docs.merge.dev/merge-unified/reading-data/webhooks/merge-webhooks; https://www.merge.dev/integrations/zoho-recruit; https://www.merge.dev/integrations/keka; https://docs.merge.dev/merge-unified/ats/common-models/applications/the-application-object |
| E9 | FACT | **Kombo.** Pricing is a fixed annual platform fee plus a per-connected-customer fee, with no public price. There is a free proof-of-concept phase. Webhooks `data-changed` are signed with `X-Kombo-Signature` (HMAC-SHA256, base64url). Kombo recommends fetching changes with `updated_after`. ATS writes: `PUT /ats/applications/{id}/stage` (job-specific stages), `POST /ats/applications/{id}/notes` and `POST /ats/applications/{id}/result-links`. It also has an Assessment API for screening vendors (order received, then result written back). Zoho Recruit, Greenhouse, Lever and Workable are listed. **Keka, Darwinbox, Freshteam and Naukri RMS are not listed** on the integrations page. A published case study covers a phone-screening vendor ("Classet … real-time phone screening with Kombo"). | https://www.kombo.dev/pricing; https://docs.kombo.dev/ats/guides/webhooks; https://docs.kombo.dev/ats/v1/put-applications-application-id-stage; https://docs.kombo.dev/ats/v1/post-applications-application-id-notes; https://docs.kombo.dev/ats/v1/post-applications-application-id-result-links; https://www.kombo.dev/integrations; https://www.kombo.dev/integrations/zohorecruit/ats |
| E10 | FACT | **Apideck.** Launch is $599/month for 25 active consumers, and Scale runs from $1,299/month (100 consumers) to $4,250/month (500). An "active consumer" made at least one API call or webhook in the month. ATS is one of the categories. | https://www.apideck.com/pricing |
| E11 | FACT | **Finch** covers HRIS, payroll and benefits only, with no ATS today. Its 2022 ATS beta is not in its current docs. **N/A** for this product. | https://developer.tryfinch.com/how-finch-works/finch-overview; https://www.tryfinch.com/blog/best-unified-apis-hris-payroll |
| E12 | FACT | **Knit** (another unified API) lists Keka ATS, Darwinbox ATS and PeopleStrong ATS connectors. The Start Up plan is $499/month with 24-hour sync. Its pricing page did not mention ATS by name. | https://getknit.dev/integration/keka-ats/; https://www.getknit.dev/pricing |
| E13 | FACT | **MCP authorization** is optional. When it is used over HTTP, the MCP server is an OAuth 2.1 resource server and MUST implement RFC 9728 Protected Resource Metadata. Clients MUST send RFC 8707 `resource`. Servers MUST validate the audience and MUST NOT pass through tokens. | https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization |
| E14 | FACT | **ElevenLabs** agents support "webhook tools" (formerly server tools) that call external APIs during a conversation, with OAuth2 client-credentials or bearer-secret auth. There are also conversation-initiation and post-call webhooks. This resolves the "ASSUMPTION: the provider supports server tools" in `00-current-system-backend.md` §13. | https://elevenlabs.io/docs/agents-platform/customization/tools/server-tools; https://elevenlabs.io/docs/agents-platform/customization/tools |

### 2.3 The key mapping insight

- **FACT.** A candidate row is job-scoped (`job_id NOT NULL`, unique `(job_id, phone)`; `MIG/0018_job_scoped_candidates.sql`). The same person on two jobs is two rows.
- **FACT.** Merge, Kombo and Greenhouse all model a person (candidate) separately from a person-on-a-job (application). Stages and notes hang off the application: Kombo's `PUT /ats/applications/{id}/stage` and `POST /ats/applications/{id}/notes`, and Merge's `POST /applications/{id}/change-stage` (E8, E9).
- **RECOMMENDATION.** Link **our candidate row ↔ their application id**, and store their candidate id as the parent id. Link our job row ↔ their job id. That is the whole inbound identity model. No `persons` table and no change to the job-scoped design.

---

## 3. Recommended architecture

All of this lives inside `apps/api-java`, as a new package `JAVA/integrations/`, on the same Postgres. No new deployable.

### 3.1 Data (one additive migration, sketch only)

**RECOMMENDATION.** The column lists below are illustrative. All four tables are tenant tables with `ENABLE` + `FORCE ROW LEVEL SECURITY` and the standard `organization_id = current_org_id()` policy, plus the narrow lookup policies noted.

```sql
-- 1. A connected system (the spec's Integration entity, B14)
integration_connections(
  id, organization_id, provider text,            -- 'zoho_recruit' | 'webhook' | later 'kombo' | 'merge' ...
  status text,                                   -- connecting | active | needs_attention | paused | disconnected
  credential_sealed text,                        -- "k1." + AES-256-GCM(iv||ct); key = INTEGRATIONS_KEY_V1 (not BETTER_AUTH_SECRET)
  config jsonb,                                  -- stage map, job filter, direction flags, webhook url/events
  scopes text[],                                 -- permission keys this connection acts with (subset of creator's)
  cursor jsonb,                                  -- per object: {"jobs": "<remote ts or token>", "applications": ...}
  inbound_token_hash text unique,                -- sha256 of the random path token in the inbound webhook URL
  next_sync_at timestamptz, paused_until timestamptz,  -- scheduler + provider back-pressure (429 / credits)
  last_success_at timestamptz, last_error text, error_count int,
  created_by_user_id uuid, created_at, updated_at)
-- narrow SELECT-only policy, same pattern as 0022:
--   USING (inbound_token_hash = current_setting('app.integration_token_hash', true))

-- 2. External identity + last-synced state (replaces "external_id columns on jobs/candidates")
external_links(
  id, organization_id, connection_id → integration_connections ON DELETE CASCADE,
  local_type text CHECK (local_type IN ('job','candidate')),
  local_id uuid,                                 -- jobs.id or candidates.id (ON DELETE handled by app/trigger)
  external_id text, external_parent_id text,     -- application id / ATS candidate id
  remote_updated_at timestamptz,                 -- for incremental pulls and stale-write guard
  remote_state text,                             -- 'open' | 'closed' (rejected/hired/withdrawn in ATS) | 'deleted'
  inbound_hash text,                             -- hash of last mapped inbound fields: skip no-op updates
  pushed_stage text, pushed_result_session uuid, pushed_hash text,  -- what we last wrote back
  UNIQUE (connection_id, local_type, external_id),
  UNIQUE (connection_id, local_type, local_id))

-- 3. One log for inbound receipts and outbound deliveries (UI "activity", dedupe, support)
integration_events(
  id, organization_id, connection_id, direction text,  -- 'in' | 'out'
  dedupe_key text,                               -- vendor event id / webhook-id / "push:<link>:<hash>"
  kind text, status text, attempts int, http_status int, error text,
  subject_type text, subject_id uuid, created_at, updated_at,
  UNIQUE (connection_id, direction, dedupe_key))
-- purge rows older than 30 days in the same scheduler tick

-- 4. Org API keys (spec: "hashed, scoped, revocable API keys bound to an organization")
api_keys(id, organization_id, name, prefix text, key_hash text unique, scopes text[],
         created_by_user_id, last_used_at, revoked_at, created_at)
-- narrow SELECT-only policy keyed on app.api_key_hash, same pattern as invitations

ALTER candidates  CHECK source IN ('manual','resume','integration');
ALTER background_jobs CHECK kind IN ('email','document','integration');
```

**RECOMMENDATION.** Do not add `external_id` columns to `jobs` and `candidates`. A link table:
- supports more than one connection per org (for example ATS plus a custom app);
- keeps the stable nouns clean (spec D11 in `00-current-system-product.md`);
- holds the per-link sync state (hashes, remote state) that would otherwise spread across core tables.

### 3.2 Code shape

**RECOMMENDATION.** Six classes. Each reuses an existing primitive.

| Class | Responsibility | Reuses |
|---|---|---|
| `AtsPort` (interface) + one adapter per vendor + `FakeAts` | `listJobs(cursor)`, `listApplications(jobRef, cursor)`, `getApplication(id)`, `listStages(jobRef)`, `addNote(appId, text, marker)`, `moveStage(appId, stageId)`, `verifyInbound(headers, rawBody, secret)`, `refresh(credential)`. Typed errors: `RateLimited(retryAfter)`, `AuthRevoked`, `NotFound`, `Rejected(fieldErrors)`, `Transient`. | The `VoicePorts` / `HostedVoiceAdapter` / `FakeVoice` convention; `RestClient` |
| `Connections` | CRUD, seal/open of credentials, OAuth callback, status transitions, "test connection" | `Db.inOrg`, `AuditService`, `@RequirePermission("integrations.*")` |
| `SyncWorker` | Handler for queue kind `integration` with ops `pull_page`, `push_result`, `push_stage`, `inbound`, `deliver_webhook` | `JobQueue.register`, `Db.underAdvisoryLock("conn:"+id)` |
| `SyncScheduler` | One `@Scheduled` tick, every 60 s: for each active org → each `active` connection with `next_sync_at <= now()` → enqueue `pull_page` (idempotency key `pull:<conn>`). Also runs the write-back sweep and the log purge. | The same org loop as `JobQueue.runDue` / `VoiceSessions.expireStale` |
| `InboundWebhookController` | `POST /webhooks/integrations/{token}`, `@Public`, raw `byte[]` body. sha256(token) → narrow policy → org + connection. `adapter.verifyInbound`. Insert into `integration_events` (dedupe). Enqueue `inbound`. Return 200 fast. | The `VoiceController` webhook pattern, `Db.withWebhookConversation` analogue |
| `PublicApiController` (`/v1/...`) + API-key branch in `AuthResolver` | Upsert jobs and candidates by `externalId`, read results, list changes since a cursor | `AuthInterceptor`, `Permissions`, PII redaction in `Candidates`/`Jobs` |

### 3.3 Sync engine (inbound: their system → our jobs and candidates)

**RECOMMENDATION.**

1. **Initial import is chained pages, not one big job.**
   - `pull_page` handles one page (for example 100 records) and writes it.
   - It advances `cursor` in the same `inOrg` transaction as the record writes, so cursor and data commit together.
   - It then enqueues the next page with idempotency key `pull:<conn>`.
   - There is exactly one in-flight pull per connection. This fixes the fairness problem in B3, because no tenant ever has more than a handful of queued pull jobs, and it keeps each job far inside the 900 s lease.
2. **Incremental sync uses a high-water mark.**
   - Use the provider's `modified_since` / `updated_after` (Kombo `updated_after` per E9, Darwinbox `updated_from` per E6) with a small overlap window (for example 2 minutes) to absorb clock skew.
   - Upserts are idempotent through `external_links` uniqueness plus `inbound_hash`, so overlap costs nothing.
   - Where a provider only offers `created_after`, as the Greenhouse Harvest summary in E4 suggests (unverified for v3), fall back to a periodic full scan of open jobs only.
3. **Webhooks are a hint, never the data.** An inbound webhook only enqueues an `inbound` op, which re-fetches the referenced record (or triggers a pull) through the API. Kombo documents this exact pattern (E9). It means:
   - we never trust payload content;
   - out-of-order and duplicate deliveries do not matter;
   - a missed webhook is caught by the next scheduled pull.
4. **Reconciliation.** Every connection gets a scheduled incremental pull, by default every 15 minutes (configurable per connection), whether or not webhooks exist. A nightly "open jobs, full list" pass detects deletions and closures, then tombstones them by setting `external_links.remote_state = 'deleted'/'closed'`.
5. **Deletions and closures.**
   - Never hard-delete our candidate rows because of a remote change: they carry call evidence and audit history.
   - A `closed` or `deleted` remote state:
     - removes the person from the "Not called yet" queue;
     - **blocks dialing**: one guard in `VoiceSessions.dialLocked`, the single choke point for dials;
     - shows "Closed in <their system>".
   - A local delete cascades the link row and is **not** pushed to the ATS.
6. **Writes go through the existing intake rules.** The mapper produces `CandidateImport.Row`-shaped data and reuses the CSV path's normalisation and the savepoint-per-row insert (B9), so an ATS import is a CSV import without the file. Phone canonical form (B15) must be decided first. Otherwise non-Indian ATS numbers will be dialed wrongly.
7. **Resume files.** If the ATS exposes the CV as an attachment, download it once and run it through the existing `Documents.extractText`. Store only the text, as today.

### 3.4 Write-back (our results and decisions → their system)

**RECOMMENDATION.** Make write-back level-triggered.

- **Desired state per linked candidate:**
  - `stage`: the current `screening_status`, mapped through `config.stageMap`. Only `reviewed` and `declined` map to anything by default; `new` and `screening` map to "no action".
  - `result`: the latest ended phone session with content.
- **Pushed state:** `external_links.pushed_stage`, `pushed_result_session` and `pushed_hash`.
- **Sweep** (each scheduler tick, per active connection, one indexed query): rows where desired ≠ pushed → enqueue `push_stage` / `push_result` with idempotency key `push:<link>:<hash>`.
- **Fast path:** a `@EventListener` on `DomainEvents.CallEvent` (`result.ready`) runs the same "compute desired, compare, enqueue" function for that one candidate. A call to that function at the end of `updateStatuses` does the same for stage changes. Duplicate events (B6) are harmless, because the comparison sees nothing new. A lost event is harmless, because the sweep catches it within a minute. **No transactional outbox is needed.**
- **Loop prevention:**
  - Inbound sync never triggers outbound sync.
  - If an inbound stage equals `pushed_stage`, it is our own echo and is ignored.
- **Non-idempotent remote writes (notes):**
  - Every note carries a short marker, `HRVoice ref <session-uuid-prefix>`.
  - On attempt > 1, the adapter first lists the application's notes and skips the write if the marker is present.
  - This turns at-least-once into effectively-once without needing vendor idempotency keys. Whether Merge or Kombo accept one: unverified.
- **Content rule (product):**
  - The note holds: call outcome (`completed` / `failure_reason` in plain words), date, duration, the advice-scrubbed summary (`AdviceGuard.scrub`), the customer's own must-ask questions with the answers given, and a link back to the candidate in our app.
  - It never holds `fitPercent`, a rank, a "qualified" flag or any stage the system chose itself.
  - The transcript and recording stay behind our link by default, because they are PII-heavy and gated by `calls.read_transcript` / `calls.read_recording`.
  - Kombo's "result links" and assessment `score` fields exist (E9), but we fill only `label`/`url`/`details` with facts, **never `score`**.
- **Stage push** only happens for a stage a named person set. `stage-history` already records that person (B7). The audit row for the push records `connectionId`, `candidateId`, `from` and `to`.

### 3.5 Outbound webhooks (custom apps, no-code tools)

**RECOMMENDATION.**

- A connection with `provider='webhook'` holds a URL, the chosen event types and a sealed signing secret.
- Events: `candidate.result_ready`, `candidate.stage_changed`, `call.failed`. All three are produced by the same level-triggered sweep, so they share its guarantees.
- Format: Standard Webhooks (E7). `webhook-id` = `integration_events.dedupe_key`, which gives receivers a stable idempotency key. HMAC-SHA256 `v1` for MVP.
- Retries come from the existing queue backoff. Dead after N attempts → connection `needs_attention`, plus an in-app message.
- Payload:
  - ids plus the same factual fields as the note;
  - PII fields only if the connection's `scopes` include `candidates.read_pii` / `calls.read_transcript`, so the existing per-field redaction rules apply to machines too.
- **Security:**
  - HTTPS only.
  - Resolve the DNS of the target and refuse private, loopback and link-local ranges. This is SSRF protection, which the Standard Webhooks site calls out.
  - 10 s timeout and no redirects.

### 3.6 Machine identity and authorization

**RECOMMENDATION.**

- **API keys:** a random 32-byte secret with a visible prefix. Store `sha256` only, following the invitation-token pattern in `Db.withInvitationToken`.
- **Lookup:** through a narrow SELECT-only policy. `AuthResolver` gains one branch: an `Authorization: Bearer hv_…` header resolves to an `Actor` whose org is the key's org and whose permission set is the key's `scopes`.
- **Same gates for machines:** `AuthInterceptor`, `@RequirePermission` and PII redaction then work unchanged. Audit rows carry the API key id in metadata.
- **Connections** act with their `scopes`, which are bounded at creation by the creator's own permissions. This uses the same rule as custom roles (`MIG/0024`). When the creator is removed, or loses a scope, the next use fails closed and sets `needs_attention`. It does not silently keep running on a departed employee's authority.
- **Credentials for their systems:**
  - Seal them with AES-256-GCM using a dedicated `INTEGRATIONS_KEY_V1` env key, with a key-version prefix for rotation. Copy the shape of `Notifications.seal`, but never derive the key from `BETTER_AUTH_SECRET` (that coupling is a recorded risk in `MIGRATION_STATUS.md` line 358).
  - Token refresh runs under `Db.underAdvisoryLock("conn:"+id)`, so two workers never refresh at once. That matters for providers that rotate refresh tokens. Zoho's refresh token does not expire (E1).
- **OAuth as a client** (connecting to Zoho, or to Greenhouse via the partner flow):
  - authorization code with `state`, plus PKCE where the provider supports it;
  - the callback is a normal authenticated route requiring `integrations.create`.
- **Greenhouse custom integrations:** the customer pastes a client id and secret (client credentials, E4).

### 3.7 Rate limiting, back-pressure and partial failure

**RECOMMENDATION.**

- **Per-connection back-pressure:**
  - An adapter throws `RateLimited(retryAfter)`.
  - The worker sets `paused_until`, then re-enqueues with a delay. This needs a small `JobQueue.enqueue(..., delaySeconds)` overload, which today does not exist (B5).
  - It must not burn the retry budget: the handler returns normally after re-enqueueing, instead of throwing.
- **Daily-credit providers (Zoho, E2):** budget the pull interval, for example 15 min × 1–3 calls = about 300 calls/day, far under 5,000. Pages of 100 records keep imports cheap.
- **Concurrency per connection** is 1, enforced by the advisory lock and the single in-flight pull. This sits well under Zoho's 10–20 concurrent-call limits.
- **Partial failure:** each record in a page is its own savepoint (as in CSV confirm). A bad record is written to `integration_events` with a plain-English reason, and the page still commits and the cursor advances. A whole-page failure retries through the queue.
- **Error surfacing:** `integration_events` feeds a per-connection "Activity" list. Connection `status` plus `last_error` feeds the Settings tab. Error copy must avoid words the web error filter strips ("webhook", "token", "api key"; `apps/web/lib/errors.ts:77`, FACT per the product map). `AuthRevoked` → `needs_attention` with "Reconnect <system>".

### 3.8 Scaling from 1 to thousands of connections (no new services)

| Pressure | At about 10 connections | At about 3,000 connections | Change needed |
|---|---|---|---|
| Pull volume | trivial | 3,000 every 15 min = 200 pull jobs/min ≈ 3.3/s, each 1–3 HTTP calls of about 0.3–1 s | Raise `JobQueue` worker threads from 2 to about 16–32 via env (Java 17, so platform threads, B12). Add a second replica if needed; `SKIP LOCKED` already makes replicas safe. |
| Scheduler and poll cost | trivial | The per-org transaction loops (B4) reach about 3,000 transactions per tick | Build the due-organizations index the code already names: a small table of `organization_id, next_due_at` with no secrets and a narrow policy. ASSUMPTION: needed somewhere past about 500–1,000 active orgs. |
| Fairness | n/a | One big tenant importing 50k applications | Already solved by chained single-page pulls (§3.3). |
| `background_jobs` churn | trivial | Insert/delete heavy | Postgres autovacuum handles this at these rates. ASSUMPTION; watch table bloat. |
| `integration_events` growth | trivial | Millions of rows a month | 30-day purge, plus an index on `(connection_id, created_at)`. |
| Inbound webhook bursts | trivial | Bulk ATS actions send hundreds per second | The receiver does verify → insert → enqueue only. The `EdgeFilter` per-IP limit must exempt or raise the limit for `/webhooks/integrations/*`, because vendors send from few IPs. |
| Public API abuse | trivial | Many keys | Add a per-key fixed window next to the per-IP one in `EdgeFilter`. In-process is fine on one VPS; move to Postgres when there are replicas (the existing ponytail note). |

The point where a separate integration worker process would make sense is when sync work starts to hurt voice-call latency on the same VPS. ADR-006 pins call state to the process. **RECOMMENDATION:** the same jar can then run with a `ROLE=worker` env flag (web routes off, `JOBS_ENABLED=true`) on a second box. That is a deployment change, not a new service.

### 3.9 Build vs buy (unified APIs)

| | Build (direct connector) | Merge | Kombo | Apideck | Finch |
|---|---|---|---|---|---|
| Public price | Engineering time | $650/mo for ≤10 accounts, then $65 each; 3 free (E8) | Platform fee plus per customer; not public; free POC (E9) | $599/mo for 25 consumers (E10) | n/a |
| Indian SMB ATS coverage | Whatever we build | Zoho Recruit (Beta), Keka page exists (E8) | Zoho Recruit yes; Keka, Darwinbox, Freshteam not listed (E9) | unverified | No ATS (E11) |
| Write: stage plus note | Per vendor API | Yes (`change-stage`, Activity NOTE) | Yes (stage, notes, result links) | unverified | — |
| Sync freshness | Ours (15 min plus webhook hints) | Daily on Launch | Plan-dependent | unverified | — |
| Data residency | Our Indian region | US/EU vendor (ASSUMPTION) | Multi-region on Enterprise only | unverified | — |

- **RECOMMENDATION: build first, design to buy later.**
  - At a guessed SMB contract of ₹10–30k/month (ASSUMPTION: no pricing in the repo), $65/account/month on Merge (about ₹5.4k) or roughly $24/consumer on Apideck takes a large share of revenue.
  - Merge's Launch plan syncs daily, which is too slow for "results flow back". 
  - The ATSs most named for Indian AI phone screening (Zoho Recruit, Keka, Darwinbox) are only partly covered.
  - Because `AtsPort` is the seam, a `KomboAts` or `MergeAts` adapter later is one class that unlocks dozens of ATSs. Their object model (application, stage, note) is the same one §2.3 already adopts.
- **Trigger to revisit:** three or more distinct ATSs requested by paying customers, or one enterprise customer on Workday, SuccessFactors or iCIMS.
- **Lowest-risk test:** Kombo's free POC on the first pilot.

---

## 4. Positions by topic

| Topic | Position | Phase | Rationale | Concerns |
|---|---|---|---|---|
| REST API | A small versioned `/v1` surface: upsert job and candidate by `externalId`, get results, list changes since a cursor. API-key auth. Same permissions and redaction. | MVP | It serves every "custom app" customer and every no-code tool (Zapier/Make/n8n) with one build. It is also the stable org-scoped API that the launch spec says MCP must sit on. | Needs an OpenAPI doc (none exists; no springdoc). Keep the surface tiny to avoid a support burden. Results reads are PII exports and must be audited. |
| OAuth | As a **client** of their ATS: build it for the first connector only (authorization code + state + PKCE where offered). As an **authorization server** for third parties: Later. | MVP (client) / Later (server) | Zoho and Greenhouse partner flows require it (E1, E4). Being an authorization server is heavy and only needed for a marketplace or MCP. | Refresh races (use the advisory lock). Revoked consent must become `needs_attention`. Zoho data centres (.in/.com/.eu) may change the token host: unverified. |
| API keys | Org-bound, hashed, scoped by existing permission keys, revocable, prefix shown. | MVP | Already decided in the spec (`BRD's/04` line 410). The invitation-token hash pattern exists. | Keys leak. Show once, support rotate and revoke, log `last_used_at`. |
| Service accounts | Do not create fake user rows. A connection or API key is the machine principal, with explicit `scopes` bounded by its creator. | MVP (as connection principal) | Reuses `AuthInterceptor`. Avoids a parallel user model. `Db.NIL` already covers system writes. | Creator offboarding must fail closed, visibly. |
| Webhooks | Outbound: Standard Webhooks-signed, queued, logged. Inbound: per-connection URL token plus vendor signature, treated as a re-fetch hint. | MVP | Push is the founder's "results flow back" for custom apps. Inbound hints reduce latency at no correctness cost. | SSRF on outbound URLs. The vendor IP rate limit in `EdgeFilter`. Zoho channel expiry renewal (E3). |
| SDK / embedded | No SDK and no embeddable widget. | Avoid (for now) | REST + OpenAPI + webhooks is enough for SMB custom apps. An SDK is a maintenance tax per language. | Revisit if a partner ATS wants us embedded in its UI. |
| MCP | A facade over `/v1` once OAuth-server work is justified. Read-only first. | Later | The spec requires OAuth 2.1 resource-server behaviour, RFC 9728 and audience validation (E13). The launch spec defers it. | Must never bypass PII redaction. No write tools until the API is stable. |
| Direct DB | Never connect to a customer's database, and never give customers ours. | Avoid | It breaks RLS isolation, forces a schema contract, and means credential custody for prod DBs. | Customers with only a DB can use the `/v1` API or a CSV. |
| Event / queue | Reuse `background_jobs` with one new kind, `integration`. Level-triggered sweep plus event wake-ups. No Kafka, Redis or outbox table. | MVP | Durable, RLS-safe and replica-safe already. The sweep sidesteps the event loss and duplication in B1/B2/B6. | Needs a delayed-enqueue overload, a fair pull design, worker-count config and a dead-row view in the UI. |
| Customer-side connector | No on-premises agent. | Avoid (Later only for an enterprise deal) | Install and support cost is far beyond a 2–3 person team. Target customers use SaaS ATSs or spreadsheets. | — |
| File / SFTP fallback | Keep CSV import. Add a results CSV export (gated by `candidates.export`) as the universal fallback. No SFTP. | MVP (CSV) / Later (SFTP) | Cheapest bridge for anyone not yet connected. It also fixes the write-back field list. | SFTP is ops-heavy: keys, polling, file formats. Only for an enterprise customer. |
| Canonical model | Thin: four Java records (`ExternalJob`, `ExternalApplication`, `ResultNote`, `StageMove`) mapped straight into existing `jobs` / `candidates`. No cross-domain CDM. | MVP | §2.3. The application ≈ job-scoped candidate mapping means no parallel tables. | Support and sales use cases will need a CRM "contact/deal" shape later. Add it then, as its own records. |
| Sync engine | Scheduled incremental pulls (15 min), chained pages, webhook hints, nightly open-jobs reconcile, tombstones, hash-based no-op skip. | MVP | Correct even if every webhook is lost. Fair across tenants. Idempotent. | Providers without `updated_since` need full scans of open jobs. Clock skew needs an overlap window. |
| Two-way actions | Out: a factual note plus a person-chosen stage through the customer's stage map. In: identity fields, the job, and remote closed/deleted (which blocks dialing). No other field-level two-way editing. | MVP (narrow) / V2 (tags, attachments, interview scheduling) | Meets the goal while keeping one owner per field. Respects the no-advice rule. | Stage maps break when customers rename stages, so read stages live and flag an unmapped stage as `needs_attention`. |
| Multi-tenancy | Every new table under FORCE RLS. Narrow SELECT-only lookup policies for the webhook token and API key hash. All writes via `Db.inOrg`. | MVP | Matches ADR-003 and the "no bypass" rule in `Db.java`. | A cross-org scheduler scan must stay a per-org loop or use a secret-free due-index table. |
| Security | Sealed credentials with a dedicated, versioned key. Hashed API keys and URL tokens. Vendor signature checks on raw bytes. SSRF guard. Audit of every connect, disconnect, push and PII export. | MVP | Spec D6–D9. Customer HR data is personal data under Indian law (DPDP Act 2023; ASSUMPTION about its specific duties here, not legal advice). | Key rotation procedure. Least-privilege scopes on the ATS side (request only candidates and jobs, not all modules). |
| Onboarding UX | One Settings tab "Connected systems": connect (OAuth or paste key), pick which jobs to sync, map their stages to "Moved forward" / "Not moving forward", test, then see an activity list and status. | MVP | Required for "connect once". Without stage mapping, write-back is unsafe. | Words must follow `2026-10-02-app-consistency.md`. Decide whether the customer's ATS brand name may appear (open question). |
| Build vs buy (unified API) | Build the first connector. Keep `AtsPort` so a Kombo or Merge adapter is a drop-in. Run Kombo's free POC if the first customers span several ATSs. | MVP build / V2 re-evaluate | Price per account vs SMB contract values. Daily sync on Merge Launch. Patchy Indian ATS coverage (E8–E12). | Each direct connector is ongoing maintenance (Greenhouse removed v1/v2 on 2026-08-31, E4). |
| First integration | (1) `/v1` API + outbound webhooks (generic). (2) One native ATS connector for the first paying customer's ATS. My prior is Zoho Recruit: public OAuth, documented limits, Kombo and Merge coverage as fallback. | MVP | The generic path serves custom apps immediately. The native connector proves the "connect once" loop end to end. | ASSUMPTION: Zoho Recruit is common among target customers. The repo has no customer data on this. Confirm with pilots before building. |
| Other: auto-dial on import | Imported candidates land in "Not called yet". Dialing stays a human click (or a future bulk "Call all"). | V2 (founder decision) | The current product calls only on a click. Consent and DND rules (`MIGRATION_STATUS.md` line 373) are undecided. | "Fully automatic" calling of people who applied elsewhere is a compliance decision, not an engineering one. |
| Other: phone canonical form | Decide one stored form (E.164 recommended) and fix `PhoneNumbers.toE164` to use `country_code` before any automated intake. | MVP (prerequisite) | B15: non-Indian numbers would be misdialed. | Changes existing CSV behaviour and needs a backfill decision. |
| Other: in-call ATS tools | Not now. ElevenLabs webhook tools make it possible later (E14), behind a call-scoped principal and the five-condition tool check. | Later | HRVoice needs data before and after the call, not during it. | Latency, plus auth for a tool endpoint our API exposes to the voice vendor. |

---

## 5. What not to build (and when to reconsider)

1. **A separate integration microservice, Kafka, Redis or Temporal.** `background_jobs` + `SKIP LOCKED` + advisory locks cover thousands of connections (§3.8). Reconsider only if sync work measurably degrades voice latency; even then, run the same jar in a worker role first.
2. **A transactional outbox table.** The level-triggered sweep plus hashes on `external_links` gives the same guarantees here. Reconsider if external consumers need a strictly ordered event stream.
3. **A general canonical data model or field-mapping engine.** There are four records and a stage map. Reconsider with the second use case (CRM for SalesVoice).
4. **Custom field mapping UI.** Map only name, phone, email, resume, job title and description. Reconsider when a paying customer needs one specific extra field.
5. **Bi-directional field editing with conflict resolution.** One owner per field: the ATS owns identity and job fields, we own screening setup, results and our decisions. Linked identity fields are read-only in our UI.
6. **An OAuth authorization server, an MCP server, SDKs or embeds.** API keys first.
7. **SFTP, email-parsing intake, on-premises agents, direct DB connections.**
8. **A connector marketplace or more than one native ATS connector before a second paying customer asks.**
9. **Pushing transcripts, recordings, `fitPercent` or any score into an ATS.**
10. **Auto-dialing imported candidates** until consent and DND rules are decided.

---

## 6. Open questions

1. Which ATS or CRM do the first 3–5 paying or pilot customers actually use? (Zoho Recruit, Keka, Darwinbox, Naukri RMS, Freshteam, a spreadsheet, a custom app.) This decides the first connector and whether to run a Kombo POC.
2. Should imported candidates be called automatically, or always by a person's click? What consent and DND rules apply to candidates who applied through a third-party system?
3. Which ATS stage does a "Moved forward" and a "Not moving forward" decision map to by default? And should "Not moving forward" ever reject in the ATS, or only add a note? Rejection in many ATSs sends the candidate an email (ASSUMPTION; varies by vendor).
4. May the note in the ATS include the summary and answers, or only a link back? This depends on what customers consider acceptable PII duplication.
5. What is the expected contract value per customer? This decides whether $24–65 per connected account per month (Apideck, Merge) is affordable.
6. Is a data-residency guarantee (data stays in India) part of the sales promise? If so, unified-API vendors outside India may be ruled out.
7. Phone canonical form: may existing CSV-imported rows be backfilled to E.164?
8. Unverified technical points to check during the build:
   - Zoho Recruit's notification `watch` API and its channel expiry (E3);
   - Zoho data-centre-specific OAuth hosts for Indian accounts;
   - whether Greenhouse Harvest v3 supports an `updated_after` filter;
   - Keka's exact rate limits;
   - Darwinbox's auth scheme;
   - Merge write support specifically for Zoho Recruit (Beta).
