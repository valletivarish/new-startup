# Integration architecture: draft v1 (consensus proposal)

Date: 2026-10-03. Author role: lead architect, synthesising seven independent expert reports. Status: **DRAFT for founder review**. Research and writing only: no code, config, migration or test was changed.

Read with:
- `docs/integrations/01-comparison.md`: the per-topic table and the 19 disagreements (D1-D19) with the questions that settle them.
- `docs/integrations/00-current-system-backend.md` ("backend map") and `00-current-system-product.md` ("product map").
- `docs/integrations/research/01..07-*.md`: the expert reports (IA, AM, EA, SA, UX, BE, CR).

Labels: **FACT** (source: URL or repo path), **RECOMMENDATION**, **ASSUMPTION**, **unverified**. Paths are relative to `/Users/valletivarish/Documents/new startup/`. `JAVA/` = `apps/api-java/src/main/java/desk/`, `MIG/` = `packages/db/drizzle/`. Everything below is a RECOMMENDATION unless labelled otherwise.

---

## 1. The decisions on one page

1. **The goal is a sync problem, not an AI problem.** "Connect once, data flows in, the agent works, results flow back" needs: a machine identity, provenance (external ids), a durable record of what happened, a way to push it out, and one adapter per named system. MCP does not provide delivery, retries or sync (FACT, https://modelcontextprotocol.io/specification/2026-07-28/changelog: "a broken response stream loses the in-flight request"). All seven experts agree.
2. **Everything lives inside `apps/api-java`, on the same Postgres.** No new service, broker, Redis, Kafka or workflow engine. Reuse `Db.inOrg` and forced RLS, the 0022 narrow-lookup pattern, `background_jobs`, `AuthInterceptor` with the permission catalogue and per-field PII redaction, `AuditService`, `AdviceGuard`, and the CSV-import validation (FACT, backend map §2, §3, §5, §10, §11).
3. **Order of work:** prerequisites (phone format, one outbound serializer, a sealing key) → results CSV export → API keys and a six-route `/v1` API → durable events, signed webhooks and an events feed → **one named connector, Zoho Recruit by default, built only after a pilot confirms it** (D1).
4. **Data flows one way per field.** Jobs and candidate contact details flow **in** (the customer's system owns them). Call results and human decisions flow **out** (HRVoice owns them). Nothing is edited on both sides, so there is no conflict resolution to build.
5. **The product rule holds at the boundary.** Only facts and decisions a named person made leave HRVoice. Never `fitPercent`, a coverage percentage, a score, a rank, "qualified", or a stage the system chose. One serializer builds every outbound payload and is tested for this.
6. **Calls still start from a human click.** Candidates that arrive by API or connector land in "Not called yet". Automatic calling waits for a written founder decision on consent, calling hours and DND (FACT, `apps/api-java/MIGRATION_STATUS.md` line 373).
7. **MCP:** never inside a live call; never as the sync channel; our own MCP server later, when a paying customer asks.

---

## 2. Final architecture

### 2.1 Picture

```
 CUSTOMER SIDE                                         HRVOICE  (apps/api-java: one Spring process, one Postgres, forced RLS)

 Own app / script / iPaaS / cloud bus
   (1) PUT /v1/...by-external/{id}  ───────────► AuthResolver: Bearer hv_... key ─► AuthInterceptor (same permissions,
       POST /v1/jobs/{j}/candidates:batch           (narrow lookup by key hash)       same PII redaction, same audit)
                                                                                          │
                                                                                          ▼
                                                    CSV-import validation path ─► Db.inOrg ─► jobs / candidates
                                                                                          + job_links / candidate_links
   (2) GET /v1/events?after=  ◄───────────┐                                               │
   (3) signed POST (Standard Webhooks) ◄──┤                                               │  person clicks Call (unchanged)
                                          │                                               ▼
 SaaS ATS (slice E: Zoho Recruit)         │                              VoiceSessions.apply ─► results on voice_sessions
   (4) poll If-Modified-Since ◄── SyncWorker (AtsPort adapter)                            │
   (5) note on result;          ◄──┐                                                      │ emit (idempotent, unique key)
       stage only on a human       │                                                      ▼
       decision                    │                         integration_events  (permanent dedupe key, 30-day feed)
                                   │                                                      │
                                   │                     after-commit wake + 60 s sweep   │
                                   │                                                      ▼
                                   └──── background_jobs kind 'integration' ──► integration_deliveries (unique per
                                                                                 connection × event; delivery log)
```

### 2.2 Components (all new code goes in one package, `JAVA/integrations/`)

| Component | Responsibility | Reuses (FACT, backend map) | Slice |
|---|---|---|---|
| `ApiKeys` + one branch in `AuthResolver` | Resolve `Authorization: Bearer hv_...` to an org principal with the key's permissions | invitation-token hash pattern, `AuthInterceptor`, `Permissions` | B |
| `Sealer` (in `platform/`) | AES-256-GCM with a dedicated versioned key and per-row AAD | generalises `Notifications.seal/open` | B |
| `Connections` | CRUD and status for connected systems; seal/open credentials; OAuth callback (slice E) | `Db.inOrg`, `AuditService`, `integrations.*` permissions | B, E |
| `PublicApiController` (`/v1`) | Six routes (section 6.6) | `Cursor`, `Input`, `ApiError`, `CandidateImport`, `Candidates` | C |
| `ExternalPayloads` | The single builder for every outbound body: webhook, `/v1` result, ATS note, CSV row | `AdviceGuard.scrub`, `Coverage` question order | 0 |
| `Events` | `emit(...)` into `integration_events` with a permanent unique key; after-commit wake | `Db.inOrg` | D |
| `IntegrationWorker` | Queue handler for kind `integration`: `deliver`, `pull_page`, `push_note`, `push_stage`, `inbound` | `JobQueue.register`, `Db.underAdvisoryLock` | D, E |
| `IntegrationScheduler` | One `@Scheduled` tick every 60 s: missing deliveries, due pulls, write-back sweep, purge | the per-org loop in `JobQueue.poll` / `VoiceSessions.expireStale` | D, E |
| `SafeHttp` | Outbound HTTP to customer URLs with the SSRF guard | Spring `RestClient` (already used by `HostedVoiceAdapter`) | D |
| `AtsPort` + `ZohoRecruitAts` + `FakeAts` | The connector seam (section 3) | the `VoicePorts` / `HostedVoiceAdapter` / `FakeVoice` convention | E |

### 2.3 Data model additions (one additive migration per slice; sketch, not final DDL)

Every new table is a tenant table: `ENABLE` + `FORCE ROW LEVEL SECURITY`, policy `organization_id = current_org_id()` for USING and WITH CHECK, added to `StructuralTest` (FACT pattern: `MIG/0016_hiring_desk_rls.sql`, `MIG/0030_background_jobs.sql`).

| Table / change | Key columns | Notes | Slice |
|---|---|---|---|
| `integration_connections` | `id, organization_id, provider ('custom' \| 'zoho_recruit' \| ...), status ('connecting' \| 'active' \| 'needs_attention' \| 'paused' \| 'disconnected'), credential_sealed, key_version, scopes text[], config jsonb, cursor jsonb, next_sync_at, paused_until, last_success_at, last_error_code, created_by_user_id, created_at, updated_at, disconnected_at` | `config` holds the webhook URL, event types and include flags (custom), or linked jobs, trigger status and stage map (ATS). `last_error_code` is a code, never a vendor body (SA M1). In MVP: at most one `custom` connection and one connection per ATS provider per workspace (UX) | B |
| `api_keys` | `id, organization_id, connection_id, name, prefix, key_hash (unique), permissions text[], created_by_user_id, last_used_at, expires_at, revoked_at, created_at` | Narrow SELECT-only lookup policy keyed on a transaction-local `app.api_key_hash`, copying `Db.withInvitationToken` | B |
| `job_links` | `job_id → jobs ON DELETE CASCADE, connection_id → integration_connections ON DELETE CASCADE, organization_id, external_id, remote_updated_at, remote_state, inbound_hash` | `UNIQUE (connection_id, external_id)`, `UNIQUE (connection_id, job_id)` | B |
| `candidate_links` | `candidate_id → candidates ON DELETE CASCADE, connection_id → ..., organization_id, external_id (ATS application id or the customer's own id), external_parent_id (ATS candidate id), remote_updated_at, remote_state ('open' \| 'closed' \| 'deleted'), inbound_hash, pushed_stage, pushed_result_key, stage_seen_at_push` | `UNIQUE (connection_id, external_id)`, `UNIQUE (connection_id, candidate_id)`. Resolves D3 with real foreign keys | B |
| `integration_events` | `id, organization_id, seq bigserial, type, subject_type, subject_id, dedupe_key, payload jsonb, created_at` | `UNIQUE (organization_id, dedupe_key)`. The feed pages on `seq`. Purged after 30 days | D |
| `integration_deliveries` | `id, organization_id, connection_id, direction ('out' \| 'in'), dedupe_key, event_id, status ('pending' \| 'sent' \| 'failed'), attempts, http_status, error_code, created_at, updated_at` | `UNIQUE (connection_id, direction, dedupe_key)`. The permanent dedupe that `background_jobs` cannot give (FACT, `JAVA/jobs/JobQueue.java` line 145 deletes succeeded rows). Inbound rows dedupe vendor delivery ids (SA M4). Purged after 30 days | D |
| `candidates.source` CHECK | add `'api'`, `'integration'` | Board label without a join (FACT, `MIG/0015_hiring_desk_foundation.sql` line 20). Optional: `'import'` so CSV rows stop showing "Added by hand" (EA) | B |
| `background_jobs.kind` CHECK + `JobQueue.POLICY` | add `'integration'` | Both must change together, or `enqueue` throws a NullPointerException (FACT, `JobQueue.java` lines 38, 66-67). Add a clear error for unknown kinds at the same time | D |
| `JobQueue.enqueue(..., delaySeconds)` | new overload | Needed for rate-limit pauses without burning retries (FACT, BE B5: no delay parameter today) | E |
| Phone canonical form | store E.164; `PhoneNumbers.toE164` uses it | FACT: the dialer reads only `candidates.phone` and ignores `country_code` (`JAVA/engine/PhoneNumbers.java` lines 8-20); uniqueness is on raw text (`MIG/0018_job_scoped_candidates.sql`). Needs a backfill decision for existing CSV rows | 0 |

Why links and not columns (D3): the connector needs per-link sync state (`remote_state`, `pushed_stage`, hashes) and the API needs the same identity lookup, so one structure serves both from day one. Real foreign keys mean deleting a candidate or a connection cleans up its links with no trigger. If the founder confirms a row can never belong to two systems, two columns on `jobs`/`candidates` would also work.

---

## 3. Connector abstraction

### 3.1 What a connector declares

**RECOMMENDATION.** A connector is one Spring bean implementing `AtsPort`, plus a static `ConnectorSpec`. There is no plugin loader and no DSL: adapters are registered in a map by key, the same way `JobQueue` handlers register by kind (FACT, `JAVA/notify/Notifications.java` line 49, `JAVA/knowledge/DocumentProcessor.java` line 55).

```java
// Sketch only. Not code to commit.
record ConnectorSpec(
    String key,                 // "zoho_recruit"
    String displayName,         // the customer's own system name, e.g. "Zoho Recruit" (founder decision 8, section 16)
    Auth auth,                  // OAUTH2_CODE | PASTED_CREDENTIALS
    List<String> scopes,        // fixed by us, narrowest that works; no scope picker in the UI
    Set<Reads> reads,           // JOBS, APPLICATIONS, STAGES, DELETIONS, RESUME_TEXT
    Set<Action> actions,        // what this system lets us write
    boolean inboundHints,       // vendor webhooks usable as re-fetch hints (V2)
    Budget budget) {}           // e.g. Zoho: daily credits by plan, concurrency 5-20

enum Action {
  ADD_NOTE,   // trigger: a fact (result.ready). Content from ExternalPayloads only.
  SET_STAGE   // trigger: a human stage decision only. Never a call outcome, never a model.
}

interface AtsPort {
  ConnectorSpec spec();
  Page<ExternalJob>         listJobs(Conn c, String cursor);
  Page<ExternalApplication> listApplications(Conn c, Instant modifiedSince, String cursor);
  ExternalApplication       getApplication(Conn c, String applicationRef);
  List<ExternalStage>       listStages(Conn c, String jobRef);       // read live; stages get renamed
  List<String>              deletedSince(Conn c, Instant since);     // empty when unsupported
  void addNote(Conn c, ExternalApplication app, String text, String marker);
  void setStage(Conn c, ExternalApplication app, String stageRef, String comment);
  // Typed errors: RateLimited(retryAfter), AuthRevoked, NotFound, Rejected(fieldErrors), Transient
}
```

- The four records `ExternalJob`, `ExternalApplication`, `ExternalStage` and `Page` are the whole cross-vendor model (BE §3.2). Vendor field names never leave the adapter (FACT, rule in `JAVA/voice/VoicePorts.java` lines 7-10).
- The `custom` connection (our API plus webhooks) has no adapter. It is our own surface.
- A unified-API vendor (Kombo, Merge) would later be one more `AtsPort` implementation (BE §3.9).

### 3.2 Declared capabilities for the systems in view

| System | auth | reads | actions | inbound hints | Phase | Evidence |
|---|---|---|---|---|---|---|
| Zoho Recruit | `OAUTH2_CODE` (per data centre; India `accounts.zoho.in`) | jobs, applications, stages, deletions, resume text (attachments) | `ADD_NOTE` (attached to the **candidate** record, not the application), `SET_STAGE` (Change Status API with `jobids`) | Professional and Enterprise only | E | FACT: https://www.zoho.com/recruit/developer-guide/apiv2/create-notes.html (supported modules include candidate and jobopenings, not applications); https://www.zoho.com/recruit/developer-guide/apiv2/change-status.html (via UX Z4); https://www.zoho.com/recruit/plan-comparison.html; https://www.zoho.com/recruit/developer-guide/apiv2/multi-dc.html (via UX Z2) |
| Keka Hire | `PASTED_CREDENTIALS` (client id, secret, API key; Global admin; paid add-on) | jobs, job candidates (`lastModified`) | `ADD_NOTE` (documented per IA); `SET_STAGE` unverified | unverified | V2 | FACT (secondary): IA §2.2, UX K1 |
| Greenhouse, Lever | partner OAuth | yes | notes, stage | yes | Later (partner programmes) | FACT: IA §2.2 |
| Darwinbox, Naukri RMS, Freshteam | on request / no public docs / being shut down | | | | Later / Avoid | IA, UX |

---

## 4. Canonical model

**RECOMMENDATION.** There is no separate canonical schema. Our existing tables are the model, and the adapters map vendor objects straight onto them (all seven experts agree; CR F2: Zoho does not even expose custom stages through its public API, per Kombo's connector docs https://docs.kombo.dev/ats/connectors/zohorecruit).

| Our noun (table) | Outside concept | Direction | Owner after linking |
|---|---|---|---|
| Work item (`jobs`) | ATS job / job opening; customer's requisition | in | Title and description are copied once at link time, then **ours**: the JD drives the call prompt and must not change silently (UX §3.3; FACT, the compiled context is hashed and re-synced on change, `JAVA/voice/VoiceSessions.java` lines 178-195). Must-ask questions are never imported. |
| Contact (`candidates`, job-scoped) | ATS **application** (one person on one job) | in | Name, phone, email, resume text owned by the ATS and **read-only in HRVoice** (D10). FACT: one candidate row per job (`MIG/0018_job_scoped_candidates.sql`), which is exactly an application (BE §2.3). |
| Call result (`voice_sessions`) | note / activity on the application | out | Ours |
| Decision (`candidates.screening_status`, set by a person) | ATS status / stage | out, mapped, opt-in | Ours. Only `reviewed` ("Moved forward") and `declined` ("Not moving forward") are ever sent (UX H5). |

**Field allowlist (SA §4, DPDP minimisation).** Inbound we store only: name, phone (E.164), email, resume text, job link, external ids, remote updated time and remote state. Never date of birth, gender, salary, address, ATS notes, ratings or scores (FACT, Zoho has an AI match rating on candidates, UX Z6). Unmapped vendor fields are not stored.

**Event names (D18).** Use-case-neutral, matching the existing `DomainEvents` (FACT, `JAVA/engine/DomainEvents.java`: `call.ended`, `result.ready` with `workUnitId`, `contactId`): `call.ended`, `result.ready`, `contact.stage_changed`, each with `useCase` in the payload. REST paths stay `/v1/jobs` and `/v1/candidates`, because those are the real tables.

---

## 5. Sync design (inbound, slice E)

| Concern | Design | Evidence |
|---|---|---|
| **Initial import** | After connect: the customer ticks jobs (none pre-ticked) and picks a trigger status. `pull_page` jobs import one page (up to 200 records) at a time, write it, advance `cursor` **in the same transaction** as the rows, then enqueue the next page with idempotency key `pull:<connectionId>`. Exactly one pull in flight per connection. | FACT: Zoho `per_page` default 200 (https://www.zoho.com/recruit/developer-guide/apiv2/get-records.html). FACT: `JobQueue.runScope` drains one org at a time on 2 threads, so one big tenant could hog a worker; single-page chaining avoids that (BE B3) |
| **Incremental** | Every 15 minutes by default: Get Records with `If-Modified-Since` = last high-water mark minus a 2-minute overlap. Upserts are idempotent (link uniqueness plus `inbound_hash`), so the overlap costs nothing. | FACT: `If-Modified-Since` is supported on Get Records (same page). Interval: D6 |
| **Real time** | None in the first release. Zoho webhooks exist only on Professional and Enterprise and need an admin-built workflow rule. V2: vendor webhooks become **hints** that enqueue a re-fetch; payload content is never trusted. | FACT: https://www.zoho.com/recruit/plan-comparison.html. Pattern: IA §3.6, SA M4, BE §3.3 |
| **Reconciliation** | Nightly: list all applications on linked open jobs, compare with `candidate_links`, mark missing ones. Plus a "Sync now" button. Every connection is correct even if every webhook is lost. | CR F6-F7: vendors do not guarantee webhook delivery |
| **Deletions** | Use Zoho's deleted-record ids (2 credits a call) and the nightly pass. A deleted or anonymised application sets `remote_state = 'deleted'`. We **never hard-delete** our candidate row automatically (it carries call evidence and audit). An explicit, confirmed, audited "delete people from this connection" action exists for erasure requests (SA M6). | FACT: deleted-records API and its 2-credit cost, https://www.zoho.com/recruit/developer-guide/apiv2/limits.html |
| **Status changes in the ATS** | Never change our stage (D11). Rejected, hired, withdrawn or deleted → `remote_state = 'closed'/'deleted'`: the person leaves "Not called yet", shows "Closed in Zoho Recruit", and **dialing is blocked** by one guard in `VoiceSessions.dialLocked`, the single dial choke point. | FACT: `dialLocked` is the only dial path (backend map §9) |
| **Validation** | Mapped rows go through the CSV-import rules (phone normalisation, `+91` default, issue codes) and the savepoint-per-row insert. A bad record is logged with a plain reason; the page still commits. | FACT: `JAVA/hiring/CandidateImport.java`, `Candidates.confirmImport` (backend map §8.1) |
| **Phone match with existing rows** | If no link exists but the job already has a row with the same E.164 phone and no link, **adopt** that row (create the link) instead of failing on `(job_id, phone)`. | FACT: unique `(job_id, phone)` (`MIG/0018`) |
| **Failures** | Typed adapter errors. `AuthRevoked` / `invalid_grant` → `needs_attention`, all jobs stop, admins emailed once via the existing email queue; never retried in a loop. `RateLimited` → `paused_until` and a delayed re-enqueue that does not count as a failed attempt. `Transient` → queue retry. | SA M3, BE §3.7, IA §2.4 |
| **Idempotency** | Inbound: link uniqueness + `inbound_hash` skip. Outbound notes: a marker `HRVoice ref <session id prefix>` in each note; on a retry the adapter lists the candidate's notes and skips if the marker exists. Outbound stage: compare `pushed_stage`. | BE §3.4 |
| **Rate limits and budget** | Per-connection budget derived from the customer's plan: at most about 20% of daily credits, slowing the interval automatically. One concurrent call per connection (advisory lock), far under Zoho's 5-20 concurrency. Separate OAuth client ids per environment. | FACT: Get Records costs 3 credits; Free 5,000/day; Standard 5,000 + 250 per user; concurrency Free 5 to Enterprise 20 (https://www.zoho.com/recruit/developer-guide/apiv2/limits.html). FACT (via CR F25): a Zoho client keeps at most 20 refresh tokens per user and invalidates the oldest (https://www.zoho.com/accounts/protocol/oauth/token-limits.html) |
| **Fail-closed revocation** | Every job reloads the connection row when it runs and stops unless `active`. Payloads never carry credentials. Disconnect nulls the sealed columns in one transaction, then calls the vendor's revoke endpoint as a best effort. | SA M6 |

Credit arithmetic for the default (ASSUMPTION: two Get Records calls per tick, one for changed applications and one for jobs): 96 ticks × 2 × 3 credits = **576 credits a day, about 12% of the Free plan's 5,000**. If the adapter needs one call per linked job (unverified until built), the budget cap slows the interval rather than starving the customer's other integrations.

---

## 6. Outbound: events, webhooks, feed, CSV (slices A, C, D)

### 6.1 How an event is created (resolves D2)

**FACT (code read for this synthesis).** A call result is not written in one transaction. `VoiceSessions.apply` updates `voice_sessions` in one transaction, runs the post-call LLM extractor outside any transaction, may write the filled summary in a second transaction, then publishes `call.ended` and `result.ready` (`JAVA/voice/VoiceSessions.java` lines 505-554). It runs again on every webhook, reconcile and results-page open (backend map §9). Stage changes are one transaction in `jobs.updateStatuses`, with the audit row written separately and no event (`JAVA/hiring/HiringController.java` lines 362-396).

**RECOMMENDATION.**
- `Events.emit(type, subject, dedupeKey, payload)` inserts into `integration_events` with `ON CONFLICT (organization_id, dedupe_key) DO NOTHING`. This table is the permanent dedupe that the queue cannot provide (CR F10).
- **Stage changes:** emit `contact.stage_changed` inside the same transaction as the stage update (a true outbox). Payload carries `from`, `to`, `decidedBy` (the acting user) and `reason`. Key: a fresh UUID per change (each human decision is its own event).
- **Results:** emit `call.ended` and `result.ready` at the end of `apply`. Key: `result.ready:<voiceSessionId>:<contentHash>`, where the hash covers status, failure reason, summary and answers. Repeated `apply` runs produce nothing new; a later, richer result produces exactly one new event, documented to receivers as "the latest result for this call".
- **Safety net:** the 60-second scheduler tick emits for any ended session with content but no event row, so a crash between the result write and `emit` loses nothing. This is BE's level-triggered idea applied to event creation.
- **Delivery:** after commit, `Events.wake` enqueues `deliver` jobs for each subscribed connection; the tick also enqueues for any event that lacks a delivery row. No change to `JobQueue`'s own transaction handling is needed (FACT: `enqueue` opens its own transaction, `JobQueue.java` line 66).
- Read `actions.webhook` from the use-case definition before emitting, and set it to `true` for hiring when slice D ships (FACT, `apps/api-java/src/main/resources/usecases/hiring.json` lines 122-128).

### 6.2 The one serializer (`ExternalPayloads`)

FACT: the summary is advice-scrubbed only in the controller (`JAVA/hiring/HiringController.java` line 250); `Jobs.results` returns the stored text as is (`JAVA/hiring/Jobs.java` line 340). A worker that called `Jobs.results` directly would push unscrubbed text out (CR F21).

RECOMMENDATION: every external body (webhook, `/v1` result, ATS note, results CSV row) is built by `ExternalPayloads`, which:
- runs `AdviceGuard.scrub` on the summary;
- lists answers in the job's must-ask order, with "not answered" for gaps;
- has no field for `fitPercent`, coverage, score, rating or recommendation;
- is covered by one test that fails if any outbound schema contains `fitPercent`, `score`, `rating`, `recommend` or `coverage`.

### 6.3 Webhook payload (D8)

```json
{
  "type": "result.ready",
  "createdAt": "2026-10-03T05:32:00Z",
  "useCase": "hiring",
  "data": {
    "job":       { "id": "…", "externalId": "REQ-12" },
    "candidate": { "id": "…", "externalId": "APP-991" },
    "call":      { "id": "…", "status": "completed", "failureReason": null,
                   "startedAt": "…", "endedAt": "…", "durationSeconds": 372 },
    "answers":   [ { "question": "Notice period", "answer": "30 days" } ],
    "summary":   "…",
    "links":     { "candidate": "https://<app>/jobs/…/candidates/…" }
  }
}
```

- `answers` and `summary` appear only when the endpoint opted in **and** its creator held `calls.read_transcript` when saving it. Contact PII (phone, email, resume) never travels in a webhook body; receivers fetch it through `/v1` with a key that holds `candidates.read_pii`. Transcript and recording are links only.
- Headers per Standard Webhooks: `webhook-id` (= the event id, so receivers can dedupe), `webhook-timestamp`, `webhook-signature: v1,<base64 HMAC-SHA256 of id.timestamp.body>`, secret `whsec_` + 24-64 random bytes, one secret per endpoint, 24-hour overlap on rotation (FACT, https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md; Stripe's 24-hour roll, https://docs.stripe.com/webhooks).

### 6.4 Delivery and failure

- 2xx = sent. 408, 429, 5xx and network errors = retry through the queue. Other 4xx = record and stop.
- With 20 attempts from a 30-second base and the existing 3600-second cap, retries span about 13 hours (ASSUMPTION: arithmetic on FACT `JobQueue.java` lines 41-43, 146-160). The events feed covers anything longer.
- After 3 consecutive failed events the endpoint is `needs_attention` and admins get one email; after a day of failures it is paused (Standard Webhooks and Slack both disable failing endpoints, IA §2.3).
- `SafeHttp`: HTTPS only; resolve the host and reject every loopback, RFC 1918, link-local (including 169.254.169.254), 100.64.0.0/10, 0.0.0.0/8, multicast, `fc00::/7`, `fe80::/10` and IPv4-mapped IPv6 address; connect to the checked IP; no redirects; 10-second timeout; response body capped and never logged (FACT, OWASP SSRF cheat sheet https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html; SA §3.2). This matters more because API, Postgres and web share one VPS (FACT, `BRD's/10_ADRs/ADR-006-hosting-deployment.md` line 143). A dev-only env flag may allow private targets so a local receiver can be tested; it must be off in production.

### 6.5 Events feed

`GET /v1/events?after=<cursor>&types=` reads `integration_events` by `seq` with the existing `Cursor`, 30-day window. Customers behind a firewall, or without a public URL, poll it outbound (EA rung 1; Stripe lists events for 30 days, https://docs.stripe.com/api/events/list).

### 6.6 Public REST API v1 (slice C)

| Route | Permission | Notes |
|---|---|---|
| `GET /v1/jobs` | `jobs.read` | keyset paginated |
| `PUT /v1/jobs/by-external/{externalId}` | `jobs.create` + `jobs.update` | idempotent by natural key; title, description, status |
| `PUT /v1/jobs/{jobId}/candidates/by-external/{externalId}` | `candidates.create` + `candidates.update` | same validation as CSV import; returns row plus issues; adopts a phone-matching unlinked row |
| `POST /v1/jobs/{jobId}/candidates:batch` | `candidates.create` | up to 200 rows, JSON or `text/csv` (EA), per-row result, savepoint per row |
| `GET /v1/candidates/{id}/results` | `candidates.read` (+ `calls.read_transcript` for content) | built by `ExternalPayloads`; **no** provider reconcile side effect (FACT, the web route can call the provider, `HiringController.java` lines 268-276) |
| `GET /v1/events` | per event type | section 6.5 |

- No stage-write route and no call-placing route in `/v1` (D11, auto-dial gate).
- Errors keep the existing `{code, message, request_id, errors?}` shape; ISO-8601 UTC; `429` with `Retry-After` from a per-key fixed window added next to the per-IP window in `EdgeFilter` (FACT, the limit is in-process per IP, `JAVA/platform/EdgeFilter.java` lines 55-83).
- A hand-written OpenAPI file for these six routes; `springdoc` only when the API passes about 15 routes (IA).
- Version in the path; never change a field's meaning inside a version.

### 6.7 Results CSV export (slice A)

One button on the job's candidates board: one row per candidate with stage, latest call status, failure reason, call time, duration, each must-ask answer as a column, the scrubbed summary and a link. Gated by `candidates.export` (Analysts excluded, FACT `BRD's/11_PERMISSION_MATRIX.md`), audited, and cells starting with `= + - @` escaped against formula injection (CR). It also fixes the field list every later write-back uses.

---

## 7. Two-way action architecture

```
Integration           integration_connections row (org-scoped, RLS): who connected it, status, config
   │
   ▼
Connector             AtsPort adapter + ConnectorSpec: auth type, readable objects, declared actions
   │
   ▼
Available actions     spec.actions  ∩  enabled in connection.config  ∩  allowed by the use case (actions.webhook)
   │
   ▼
Automation            fixed rules in code, not a rule builder:
                        result.ready (a fact)                       → ADD_NOTE    (always on for a connected ATS)
                        human decision: reviewed / declined         → SET_STAGE   (opt-in, customer-mapped)
                        custom connection                           → signed webhook + feed (section 6)
   │
   ▼
Agent                 the voice agent never calls an action. It receives only the compiled job, questions and
                      knowledge (CallContextCompiler) and produces facts. It has no knowledge of any connector.
```

**Provider independence of the core agent.** FACT: data reaches a live call only once, at provisioning, as a compiled prompt and knowledge brief, and the live agent gets only `end_call`, `voicemail_detection` and `transfer_to_number` (`JAVA/engine/CallContextCompiler.java` lines 26-37, 220-237). RECOMMENDATION: keep it that way. A connector changes rows in `jobs` and `candidates`; the compiler reads those rows as it does today. Nothing vendor-specific reaches the prompt.

**Where the never-recommend rule is enforced (three places, all testable):**
1. **Content:** only `ExternalPayloads` builds outbound text (section 6.2).
2. **Trigger:** `SET_STAGE` runs only from a `contact.stage_changed` event whose `decidedBy` is a real user id written in the stage-change transaction. API keys cannot change stages in MVP. A call outcome ("No answer", "Call completed") never moves an ATS status; it only appears in the note (UX H2). Model output never selects or triggers an external write (SA M5; FACT, prompts are not a security boundary, `BRD's/11_PERMISSION_MATRIX.md` line 149).
3. **Target:** adapters expose only `addNote` and `setStage`; there is no generic "update field". They never write score, rating, scorecard, assessment-score or recommendation fields (FACT examples: Greenhouse `partner_score`, IA §2.2; Keka scorecards, IA §2.2; Kombo result-link `score`, BE E9).

**Stage write-back safeguards (D12):** off by default; the customer picks the target status for "Moved forward" and for "Not moving forward" from their live status list; "On hold" and "No decision yet" are never sent; before writing, re-read the ATS status and skip with a note if someone changed it since our last read; the comment names the person ("Moved forward by Priya Sharma in HRVoice"); Undo attempts a revert and says so if it fails.

**Note content (D9), written to the Zoho candidate record:**

```
HRVoice screening call · Sales executive · 3 Oct 2026, 11:02 · 6 min
Outcome: Call completed            (or: No answer / Reached voicemail / Number not valid)

What they said
- Notice period: 30 days
- Current location: Pune
- Expected salary: not answered

Summary
<summary after AdviceGuard.scrub>

Recording and full transcript: <sign-in link to the candidate in HRVoice>
A person on your team decides who moves forward. HRVoice does not score or recommend.
HRVoice ref 3f2a9c1e
```

No coverage count, no transcript, no recording file.

**Later actions** (for example booking an interview slot for the appointments module) go through the existing tool catalogue and its five-condition gate with a call-scoped principal, not through MCP (AM §3.3, CR F47).

---

## 8. MCP position

| Question | Position | Evidence |
|---|---|---|
| Should the voice agent call a customer's or vendor's MCP server during a live call? | **[Avoid]** | No approving human on an outbound call (MCP tools spec: a human SHOULD be able to deny tool calls; the provider recommends "Always Ask", FACT AM M9, E2); candidate speech and ATS text are prompt-injection input (OWASP LLM01, AM M12); a recruiter-scoped ATS token can see every candidate; credentials would sit in our single shared voice-provider workspace (FACT AM A8); provider MCP is unavailable in Zero Retention Mode (FACT AM E3) |
| Should sync use vendors' MCP servers (Zoho, Greenhouse, Ashby, Darwinbox ship them)? | **[Avoid]** | They are user-OAuth, per-user rate-limited, beta, and wrap the REST API anyway; MCP has no delivery guarantees (AM V1-V7, M6) |
| Should we run our own MCP server? | **[Later]**, triggered by a paying customer asking to use HRVoice from Claude, ChatGPT or Copilot | FACT: current revision 2026-07-28 (https://modelcontextprotocol.io/specification/latest); remote HTTP MCP requires OAuth 2.1 resource-server behaviour with RFC 9728 metadata, RFC 8707 resources and no token passthrough (AM M8, M11). FACT: the launch spec calls MCP "a façade later" (`docs/superpowers/specs/2026-09-16-hiring-production-launch-design.md` line 72) |
| If triggered, what first? | A thin, **read-only** facade over `/v1` (`list_jobs`, `list_candidates` by state, `get_call_result` without `fitPercent`, `get_stage_history`), same interceptor, permissions and PII rules. Write tools only with user-delegated OAuth so each stage move traces to a person | AM §3.6; the Java SDK's support for 2026-07-28 is unverified (AM S5) |
| Placeholder MCP UI or marketing claims | **[Avoid]** | FACT: "Shipping fake webhook/MCP UI" is a listed non-goal (launch spec line 88) |

---

## 9. Custom and legacy systems: the hierarchy

Adopted from EA §3. Stop at the first rung the customer can do. The common pattern in Microsoft's gateway, Workato's agent, Fivetran Hybrid and Cloudflare Tunnel is that the customer's side dials out (FACT, EA E1-E6). Rung 1 gives that property with nothing for us to ship.

| Rung | Shape | Who it fits | Phase |
|---|---|---|---|
| 1 | Their script or iPaaS pushes to `/v1` and polls `/v1/events` (or receives our webhook) | any custom or on-prem app with one developer; any team on Pabbly, Zapier, Make, n8n | **MVP** (we publish a curl + small Python reference script, not an SDK) |
| 2 | Their cloud bus pushes HTTPS to `/v1` | AWS EventBridge (API-key connection, input transformer), Kafka HTTP Sink | **MVP** works as is if the endpoint answers within about 1 s and returns 200, not 409, on duplicates (FACT: EventBridge 5-second timeout and retries 409, https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-api-destinations.html). SNS and Pub/Sub envelopes **V2**, on request |
| 3 | File | systems that only export | **MVP**: UI CSV (exists), `text/csv` on the batch route, results CSV export. SFTP pull from their server **Later**, paid. Hosting our own SFTP **Avoid** |
| 4 | They expose one narrow HTTPS endpoint through their own gateway or tunnel | enterprise wanting us to write into their system | **Later**; reuses `SafeHttp` |
| 5 | Read-only database view (`GRANT SELECT` on a view, TLS, our IP allowlisted) | enterprise with only a database | **Later**, paid exception with a DPA; never write, never CDC (FACT: a stalled replication slot keeps WAL and fills disk, https://debezium.io/documentation/reference/stable/connectors/postgresql.html; read-only session settings are not a boundary, https://www.postgresql.org/docs/current/runtime-config-client.html) |
| 6 | An agent we ship into their network | large regulated enterprise | **Avoid** |
| 7 | Read-write DB, CDC, consuming their Kafka/RabbitMQ/SQS, site-to-site VPN | | **Never** |

---

## 10. Multi-tenancy

All FACT patterns from the backend map §3; all seven experts agree.
- Every new table: forced RLS on `organization_id = current_org_id()`; listed in `StructuralTest`; no BYPASSRLS anywhere; `Db` keeps "no method that disables row-level security" (FACT, `JAVA/platform/Db.java` line 33).
- Tenant is resolved only from server state: the API key hash (narrow SELECT-only lookup, invitation-token style), the OAuth `state` row bound to the signed-in member and org, or (V2) an inbound webhook connection token (narrow lookup, 0022 style, only **after** the signature verifies). Never from `organization_id` or `job_id` in a payload; a `jobId` in a `/v1` path is checked inside `inOrg` like any route.
- Background work: `noContext` to list active orgs, then `inOrg(org, Db.NIL)` per org, per transaction (FACT, `JobQueue.java` lines 93-109).
- Machine principals: `userId = Db.NIL`, `apiKeyId` or `connectionId` in audit metadata (FACT, system actors are stored as `actor_user_id = NULL`, `JAVA/audit/AuditService.java` lines 38-45).
- Customer credentials live in our database, sealed, never in the voice provider's shared workspace (AM).
- Per-org API quota on `/v1`, separate from call budgets (EA).

---

## 11. Security

### 11.1 MVP (gate for shipping slices B-E)

1. **`Sealer`** generalised from `Notifications.seal`: AES-256-GCM, 12-byte random IV, key from a new env var `INTEGRATIONS_KEYS` (`1:<base64>,2:<base64>`), **never derived from `BETTER_AUTH_SECRET`** (FACT: rotating it already kills sealed mail, `apps/api-java/MIGRATION_STATUS.md` line 358), output `k<version>.<base64>`, AAD = `organization_id:connection_id:field` so a ciphertext cannot be moved between rows or tenants (SA M2). Rotation: add key 2, re-seal, remove key 1. Do not reuse the plaintext `accounts.*_token` columns (FACT, `MIG/0000_initial_schema.sql` lines 1-15).
2. **API keys:** `hv_live_` + 32 random bytes; store SHA-256 only; show once; first 8 characters shown in UI; permissions = explicit subset from presets, capped at the creator, never `users.*`, `roles.*`, `integrations.*`, `organization.*`, `billing.*`; **no PII permission by default**; revocable; optional expiry; `last_used_at`; creating one needs `integrations.create`; two keys may be live during rotation; bearer keys accepted only on `/v1`, never on cookie routes (SA §3.2).
3. **Who may connect what:** connect, edit and disconnect need `integrations.create/update/delete` (Owner, Administrator; FACT `BRD's/11_PERMISSION_MATRIX.md` lines 89-93). A connection or endpoint that sends summary, answers or contact data out also needs the creator to hold `candidates.export` and `calls.read_transcript` at creation, audited like a sensitive read (SA M5, CR F34). If the creator later loses those permissions or leaves, the next use fails closed and shows "Needs attention" (BE).
4. **OAuth client (slice E):** authorization code + PKCE (S256) + one-time `state` (server-side, bound to member and org, about 10 minutes) + exact redirect URI; narrowest scopes; data-centre hosts from a fixed allowlist; refresh under `Db.underAdvisoryLock("conn:"+id)`; `invalid_grant` → `needs_attention`, never a retry loop; separate client ids per environment (FACT, RFC 9700 https://datatracker.ietf.org/doc/html/rfc9700; Zoho 20-refresh-token cap via CR F25).
5. **Outbound:** Standard Webhooks signing, `SafeHttp` SSRF guard (section 6.4), thin-by-default payloads.
6. **No secrets or PII in logs or `last_error`:** adapters throw a code plus a plain sentence (FACT, `background_jobs.last_error` stores the exception message, SA E9).
7. **Audit events** (ids and counts only): `integration.connected`, `.updated`, `.disconnected`, `.reconnect_needed`, `.webhook_rejected` (at most one a minute per connection), `.sync_completed` (counts), `.pushed` (ids), `api_key.created/revoked`, `webhook_endpoint.created/updated`; results CSV export as a sensitive read (SA M7).
8. **Inbound webhooks (V2):** per-connection secret; vendor scheme verified on raw bytes in the adapter with a constant-time compare; ±5 minutes where a timestamp exists; vendor delivery id deduped in `integration_deliveries`; fetch on notify; exempt from the per-IP limit only after verification (SA M4, BE §3.8).
9. **Untrusted text:** ATS-sourced text (JD, resume) is untrusted input; cap lengths, keep `AdviceGuard` on every output (SA G7).
10. **Retention and DPDP (D17):** no automated intake goes live without a decided retention period and a working purge job for pulled-but-never-called candidates; a customer DPA and a breach runbook exist before the first paying connector customer. ASSUMPTION: we act as a DPDP data processor for the employer; needs a lawyer. FACT (secondary): DPDP Rules 2025 notified November 2025, most obligations from about May 2027, one-year log retention (SA R12; Gazette text unverified).
11. **Voice-provider webhook (D16):** permanent event keys make replays harmless to customers now; narrow the ±30-minute window (FACT, `JAVA/voice/HostedVoiceAdapter.java` lines 198-230) only after confirming how the vendor timestamps retries (unverified).

Merge-blocking tests (one each, SA M10 plus CR): RLS drift for new tables; `Sealer` round trip, wrong AAD fails, wrong key version fails; webhook verify rejects bad signature, stale timestamp, duplicate id; a job against a revoked connection does nothing; the outbound schema test from section 6.2; `SafeHttp` rejects a private and a metadata address.

### 11.2 Enterprise (Later, only when a deal requires it)

KMS envelope encryption (data key per org, wrapped by KMS) once hosting moves to AWS `ap-south-1` (FACT, named as the long-term home in ADR-006); customer-managed keys; SSO/SAML; IP allowlists on API keys; a documented static egress IP (the single VPS has one today; keep it when scaling, EA); egress proxy (e.g. Smokescreen) in front of `SafeHttp`; rungs 4-5 of section 9 under a signed DPA.

---

## 12. Onboarding flow

All in one new Settings tab, **"Connected systems"** (`?section=connections`), shown with `integrations.read`; buttons need `integrations.create/update/delete`. Status uses the "Calling number" card pattern: icon plus word plus one sentence plus at most one action (FACT, `apps/web/components/settings/sections.tsx` lines 238-318). The server returns stable codes (e.g. `connection.reauth_needed`) and the web maps them to sentences, because `apps/web/lib/errors.ts` (line 77) discards messages containing "webhook", "token", "api key" or "payload" (FACT, product map §11). Before shipping: rename the agent page's existing "Integrations" group for test tools (FACT, `apps/web/app/agents/[id]/page.tsx` lines 700-735) and unhide the Integrations permission group (`apps/web/components/settings/access.ts` line 109).

### 12.1 "Your own system" (slices B-D; for a developer or an iPaaS user, about 10 minutes)

1. **Create a key.** Name it, pick one access preset (default "Send candidates in", no contact details). The key is shown once with a copy button, next to the base URL and a link to the API page with the reference script.
2. **Send results to your system.** Paste an HTTPS URL, tick events (default `result.ready` and `contact.stage_changed`), choose whether to include summary and answers (disabled unless the person holds `calls.read_transcript`). Save shows the signing secret once.
3. **Send a test event.** Shows the receiver's status code in plain words.
4. **Status card:** "Last sent 3 minutes ago", "2 waiting to send", or "Couldn't send since 10:40" with Retry; a list of the last 50 deliveries.

### 12.2 "Zoho Recruit" (slice E; for a non-technical admin; UX §3.2, adjusted)

| Step | What the person sees | What we decide |
|---|---|---|
| 0 | Empty state: "Bring candidates in from the hiring system you already use, and send each call's results back to it." One primary button. Only systems that really work are listed (FACT, launch spec anti-pattern D14) | |
| 1 | "We'll read" (the job openings you pick and their candidates: name, mobile, email, resume text, status) / "We'll write" (a note after each call; their status only if you turn that on). "We never send a score or a recommendation." | Scopes, fixed and narrow |
| 2 | Redirect to Zoho; sign in; approve. India data centre handled from the response | |
| 3 | Pick jobs (none pre-ticked); link each to an existing HRVoice job or create a draft job (title and description copied) | Title matching pre-selects a link |
| 4 | "Bring people in when their status is …" read live from their list | Pre-select the first status containing "new", "screen" or "applied", else nothing |
| 5 | "Send decisions back?" switch, **off**; when on, pick the status for "Moved forward" and for "Not moving forward" | Note write-back is always on |
| 6 | "Check the connection": read-only; "We can see 3 jobs and 41 people at Applied" (names only for holders of `candidates.read_pii`) | |
| 7 | "Start bringing people in" → "New people will show up on your jobs within 15 minutes" | Interval and budget |

States: **Connected** ("Last checked 4 minutes ago. 3 jobs linked. Connected by Priya."), **Needs attention** (access withdrawn; a mapped status renamed; missing permission), **Paused until 4:10 pm** (daily limit), **Not connected**. Reconnect keeps all choices. Disconnect confirms with `ConfirmDialog` and keeps everything already in HRVoice.

Day to day (UX §3.5): board rows say "From Zoho Recruit"; linked contact fields are read-only with "Edit this in Zoho Recruit"; under each call a delivery line ("Sent to Zoho Recruit at 11:02" / "Waiting to send" / "Couldn't send. Retry"); the decision footer says "Also sets their status in Zoho Recruit to '<their label>'" when write-back is on; Settings > Activity gains plain sentences for connects, imports and sends.

Open: whether the customer's own system name may appear in the UI as an exception to the no-vendor-names rule (product map §11; UX Q6). This draft assumes yes.

---

## 13. Scope

### 13.1 MVP

Effort is IA's estimate for one engineer (ASSUMPTION, for ordering only).

| Slice | Contents | Effort |
|---|---|---|
| **0. Prerequisites** | E.164 stored form + `toE164` fix + backfill decision; `ExternalPayloads` + forbidden-field test; `Sealer` with `INTEGRATIONS_KEYS`; unknown-kind guard in `JobQueue` | 2-4 days |
| **A. Results CSV export** | Section 6.7 | 1-2 days |
| **B. Foundations** | Migration: `integration_connections`, `api_keys`, `job_links`, `candidate_links`, `source` values; API-key branch in `AuthResolver`; Connected systems tab with "Your own system" keys | 4-6 days |
| **C. `/v1` API** | Six routes, per-key limit, OpenAPI file, reference script | 4-6 days |
| **D. Events and webhooks** | `integration_events`, `integration_deliveries`, `integration` queue kind, `Events.emit` in `apply` and stage changes, sweep, `SafeHttp`, signing, feed, test event, delivery list, `actions.webhook: true` | 5-8 days |
| **E. First named connector (gated)** | Starts only when a pilot confirms Zoho Recruit (or switches to the pilot's system). OAuth client, `ZohoRecruitAts` + `FakeAts`, scheduler, chained pulls, nightly reconcile, tombstones and dial guard, note write-back, opt-in stage write-back, delayed-enqueue overload, the 7-step UI | 3-4 weeks |

Launch gates: retention decision and purge job before automated intake (D17); integrations only with the web pointed at the Java API (risk R10).

### 13.2 V2

- A second connector chosen by pilot data: Keka Hire (pasted credentials), a Google Sheet (Picker with `drive.file`, UX), or Workable (subscriptions created by API, IA).
- Inbound vendor webhooks as re-fetch hints (Zoho Professional and up).
- Per-job "Call new people automatically" with call hours and a daily cap, **only after** a written founder decision with legal advice (FACT: TRAI TCCCPR Second Amendment requires advance notice for auto-dialers, https://trai.gov.in/sites/default/files/2025-02/Regulation_12022025.pdf; applicability to screening calls unverified). Needs the missing `scheduled_calls` dispatcher (FACT, backend map §6.4).
- Dial-time `dynamic_variables` with a minimal allow-list (D14).
- Our own Zapier app with REST-hook triggers (UX R1).
- SNS and Pub/Sub envelope adapters on request.
- An internal dead-job view for all queue kinds; per-key limits moved to Postgres once there is more than one replica.

### 13.3 Long term (Later)

Our own MCP server (section 8) and the OAuth authorization server it needs; a Kombo or Merge `AtsPort` adapter once three or more ATSs are requested by paying customers (D19); Greenhouse and Lever via their partner programmes (Greenhouse's Assessment Partner API with `partner_score` always empty is the natural fit, IA §2.2); Darwinbox; enterprise rungs 4-5; in-call tools for the appointments module through the five-condition tool gate; the enterprise security items in 11.2; a CRM contact/deal shape when SalesVoice or SupportVoice need it.

### 13.4 Avoid

In-call MCP; MCP-based sync; direct DB access (beyond the paid read-only exception); CDC; consuming customer brokers; our own on-prem agent; hosted SFTP; SDKs and embeddable widgets; a generic workflow or rules builder; a cross-vendor canonical schema or field-mapping editor; two-way editing of the same field; auto-rejecting people who did not answer; writing any score, coverage, rank, "qualified" or system-chosen stage anywhere outside; connectors for Freshteam (being shut down) and Naukri RMS (no public API docs) (FACT, IA §2.2).

---

## 14. First real integration and how to test it without buying anything

### 14.1 Choice

- **The generic slices (A-D) are the first integration** that works for any customer with a developer or iPaaS.
- **Zoho Recruit is the first named connector**, provided a pilot uses it (D1). Why: self-serve OAuth, an India data centre, a documented REST API with incremental polling, a free plan with API access (FACT, pages cited in sections 3.2 and 5). The evidence that Indian SMBs use it is vendor-written (UX M1-M2), so the founder must confirm with pilots first.

### 14.2 Testing slices A-D: nothing to buy

- **Automated:** the existing JUnit 5 + Testcontainers suite (FACT, 85 tests, `apps/api-java/MIGRATION_STATUS.md`) plus the merge-blocking tests in section 11.1.
- **Manual push-in:** `curl` and the reference Python script against a local Java API.
- **Manual push-out:** a small local receiver that verifies Standard Webhooks signatures (the spec repository lists reference libraries), reached with the dev-only private-target flag on.
- **iPaaS path:** self-hosted n8n. FACT (search result from n8n's docs): without a licence key n8n runs as the free edition (https://docs.n8n.io/deploy/host-n8n). An n8n workflow that upserts candidates and receives results proves rung 1 end to end. Note: Zapier's webhook app is not on its free plan (FACT, UX R3), so do not use Zapier for free testing.

### 14.3 Testing slice E with Zoho Recruit: free accounts only

| Need | What to create | Facts and limits |
|---|---|---|
| An ATS account with data | A **Zoho Recruit Free** edition account created in the **India data centre** | FACT: Free = 1 active job, 5,000 API credits a day, no webhooks (https://www.zoho.com/recruit/plan-comparison.html). One job is enough for the full loop |
| An OAuth client | Register a **Web-Based** client in the Zoho Developer Console, one per environment (dev, staging, production) | FACT: client types include Web-Based and Self Client (https://www.zoho.com/recruit/developer-guide/apiv2/register-client.html). Registration fee: none found (unverified). Separate clients because of the 20-refresh-token cap |
| Test candidates | 5-10 candidates on the one job, using team members' own phone numbers with their consent; a custom status list to test mapping and rename detection | |
| Automated tests | `FakeAts` in CI (the `FakeVoice` pattern); the Zoho adapter tested manually against the free account | |

What cannot be tested for free:
- Zoho webhooks (Professional and up; whether Zoho offers a free trial of paid editions is unverified). This is one reason the first release polls only.
- Kombo's note that custom application stages are not available through Zoho's public API on paid plans (FACT via IA, https://docs.kombo.dev/ats/connectors/zohorecruit): stage write-back must fall back to a note when a mapped status is not reachable.
- Keka (sandbox needs a partner MSA or paid portal, IA), Greenhouse and Lever (partner programmes), Darwinbox (on request).
- Optional no-cost alternative for multi-ATS exploration: Kombo's free proof of concept (FACT, https://www.kombo.dev/pricing via BE E9; terms unverified). It is a sales conversation, not a purchase.

---

## 15. Risks

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R1 | Pilots do not use Zoho Recruit (or any ATS); slice E is built for nobody | Medium / High | Gate slice E on a confirmed pilot (D1); generic slices serve anyone with a developer or iPaaS; results CSV serves everyone |
| R2 | Duplicate results or notes in a customer's system | High without mitigation (FACT: `apply` re-publishes; queue keys stop protecting after success) / High | Permanent unique keys in `integration_events` and `integration_deliveries`; `webhook-id` for receivers; note marker check |
| R3 | Advice or a score leaks into an ATS | Medium (FACT: `Jobs.results` returns unscrubbed summary) / High (product rule) | `ExternalPayloads` only, forbidden-field test, adapters with no generic write |
| R4 | Duplicate candidates and misdialed numbers from automated intake | High (FACT: raw-text phone uniqueness; dialer ignores `country_code`) / High | Slice 0: E.164 stored form before any automated intake; adopt-by-phone rule |
| R5 | A connection silently stops (revoked consent, oldest refresh token invalidated, plan downgrade) | Medium / High | `needs_attention` state, one email to admins, visible "last checked" line, separate OAuth clients per environment |
| R6 | We exhaust a small customer's Zoho daily credits and break their other integrations | Medium / Medium | Per-connection budget (about 20% of daily credits), `If-Modified-Since`, automatic slowdown, "Paused until" state |
| R7 | SSRF from a customer-supplied webhook URL into our VPS (API, Postgres and web share one box) | Medium / High | `SafeHttp` checks every resolved address, pins the IP, no redirects; dev-only flag off in production |
| R8 | PII sprawl and DPDP exposure (people pulled in but never called; copies in delivery logs) | High / High | Field allowlist; retention gate; 30-day purge of events and deliveries; thin webhooks; links instead of transcripts; DPA and breach runbook |
| R9 | Pressure to auto-call imported candidates before consent and DND are settled | High / High | No call route in `/v1`; auto-call is a V2 per-job switch behind a written founder decision |
| R10 | Nest and Java run side by side: changes made through Nest emit no integration events | Medium / Medium | FACT: the web's `API_URL` default is `http://localhost:3001` (`apps/web/next.config.mjs` line 18) while Java listens on 3002 (`apps/api-java/src/main/resources/application.yml` line 5); ASSUMPTION: 3001 is Nest. Ship integrations only with the web pointed at Java; the result sweep catches ended sessions with content whichever API wrote them |
| R11 | Stage drift: customer renames a status, mapping silently breaks | Medium / Medium | Read the status list live on settings open and before every write; unmapped → "Needs attention" (UX R10) |
| R12 | The public API becomes a promise we cannot change | Medium / Medium | Six routes, versioned path, hand-written OpenAPI, no field meaning changes inside v1 |
| R13 | Failures are invisible (no dead-job view today) | High / Medium | Per-connection status and delivery list in MVP; internal dead-job view in V2 |
| R14 | Vendor API churn (Greenhouse removed Harvest v1/v2 on 31 Aug 2026) | Certain over time / Medium | One connector until it has paying use; all vendor code inside one adapter |
| R15 | A customer's own LLM ranks candidates from data we export (API, webhooks, later MCP) | Medium / Medium (reputational) | Factual payloads only; clear terms; legal position decided before MCP (AM Q4) |

---

## 16. Founder decisions needed (details and evidence in `01-comparison.md`)

1. Where do the first five pilots keep candidates, and does any have a developer or a paid iPaaS? (D1, D4)
2. Is pickup within about 15 minutes acceptable, and how many jobs does a pilot keep open? (D5, D6)
3. May integration keys or webhooks ever carry contact details, summary or answers, and only by explicit admin choice? (D7, D8)
4. What goes into the ATS note: answers and scrubbed summary, a coverage count, or only a link? (D9)
5. Is it acceptable that ATS-linked contact fields are read-only in HRVoice? (D10)
6. May a stage change ever come from another system rather than a named person in HRVoice? (D11)
7. May "Not moving forward" set a reject status in the ATS (which may email the candidate)? (D12)
8. May the customer's own system name ("Zoho Recruit") appear in the UI?
9. Retention period for pulled-but-never-called candidates and transcripts; confirmation that we act as a DPDP processor; DPA. (D17)
10. Automatic calling of imported candidates: yes or no, and under what consent, hours and DND rules? (needs legal advice)
11. Price per SMB customer and whether "data stays in India" is a sales promise. (D19)
12. Will support and sales use cases reuse `jobs`/`candidates` or get their own tables? (D18)

## 17. Unverified items to check during the build

- Whether one Zoho `If-Modified-Since` call can cover applications across all linked jobs, or one call per job is needed.
- Zoho Recruit Change Status behaviour with `jobids` for custom statuses on paid plans; Zoho data-centre token hosts for Indian accounts.
- Whether the voice provider re-signs retried webhooks with a fresh timestamp; whether the legacy signature header is still sent.
- Whether the Exotel outbound path accepts `dynamic_variables` (V2 only).
- Keka Hire write endpoints for stage; Keka webhook triggers for Hire.
- Where Merge and Kombo store data, and India-region availability.
- DPDP Rules 2025 dates and Rule 6/7 wording against Gazette G.S.R. 846(E).
- Whether 3001 is the Nest API in every environment.
