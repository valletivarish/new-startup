# Integration architecture: draft v7 (lead decision after review round 6)

Date: 2026-10-03. Author role: lead architect, applying a binding lead decision. Status: **DRAFT v7 for founder review**. Research and writing only: no code, config, migration or test was changed.

Read with:
- `docs/integrations/02-resolutions.md`, "Round 7 (lead decision)": every mechanism removed and why, and how each round-6 objection was handled. Rounds 1-5 hold the earlier decisions this draft still relies on.
- `docs/integrations/later-bulk-calling.md`: slice A2 ("Call selected (N)") as designed so far, with its open objections. **Not approved and not part of this plan.**
- `docs/integrations/03-round6-reviews.md`: the reviews of v6, verbatim.
- `docs/integrations/architecture-draft-v6.md`: the previous draft, replaced by this one. Where v7 says "as v6 §x", that v6 text and its evidence still apply unchanged.
- `01-comparison.md` (D1-D19), `00-current-system-backend.md` ("backend map"), `00-current-system-product.md` ("product map"), `research/01..07-*.md` (IA, AM, EA, SA, UX, BE, CR).

Labels: **FACT** (source: URL or repo path), **RECOMMENDATION**, **ASSUMPTION**, **unverified**. Paths are relative to `/Users/valletivarish/Documents/new startup/`. `JAVA/` = `apps/api-java/src/main/java/desk/`, `MIG/` = `packages/db/drizzle/`. Everything below is a RECOMMENDATION unless labelled otherwise.

**How to use this document.** It is the rationale record, not the build spec. Before a slice starts, ADR-010 (section 18 lists its contents) and that slice's short build sheet are lifted from it (section 13.1).

### What changed from v6 (details in `02-resolutions.md`, "Round 7")

| Area | v6 | v7 |
|---|---|---|
| Bulk calling (slice A2) | "Call selected (N)": a bulk dispatcher on its own dial thread with an error-code table, one hosted agent per job, stale-agent deletion at the provider, provider and capacity refusal classes with a `voice_sessions` delete policy, `VOICE_BULK_MAX_CONCURRENT` | **Out of this plan.** Moved with every open objection to `later-bulk-calling.md`, marked NOT APPROVED. A call starts exactly as it does today: a person clicks Call for one candidate (the existing endpoint and its existing guards). Imported candidates appear on the job's board ready to call |
| Outbound for Core + the named connector (E) | An ordered `integration_events` log with a per-org `seq`, the events lock as the first statement of every stage change, a `fanout_seq` drain per connection, a poison-head probe, `missed_until` | **Level-triggered from rows that already exist.** One `integration_deliveries` row per (connection, call) for notes and per (connection, candidate) for stage write-back, holding the content hash, status, attempts and `next_attempt_at`. Each item backs off on its own: no ordering, no head-of-line blocking, no probe, no extra lock on a recruiter's decision (sections 6.1, 7) |
| Event log and feed | Core | **Dev slice only**, with the rules already agreed: the purge never lowers the org's max `seq`, `410` is defined against the oldest retained `seq`, an undone stage event is marked `superseded`; plus round 6's erased-call guard (section 6.5) |
| Background reconcile | A2, every org, inside the 5-minute loop on Spring's scheduler thread (pool raised to 3) | Core, **only orgs with a live connection** (their results must leave without anyone opening HRVoice). A job on the integration lane's own executor: at most 5 calls and 40 s a run, stopping at the first provider timeout or 5xx (section 6.1) |
| Provider deletes | Provider step of the 5-minute loop | A job on the integration lane. The 5-minute loop now does database work only (section 6.1) |
| Health | Heartbeats, a `degraded` `/health`, lag numbers, scheduler pool size and its test | **Removed** (they served the dial thread and provider HTTP on the scheduler thread, both gone). Gate P keeps one external uptime monitor on `/health` |
| Queue | Lane, round-robin, `Snooze`, POLICY | Lane, round-robin and POLICY kept. **`Snooze` removed:** the 60-second tick re-enqueues work that is still due |
| Self-serve calling, destination allowlist, shared number | Inside A2 and slice 0 | **One small separate item, G**, recorded as a launch gate and founder decision 15 (a risk that exists today, independent of integrations): an operator turns phone calls on per workspace, the acting person's email is verified, a default usage-limit row at workspace creation, plus the dial-time destination allowlist already agreed. Not designed further here. Intake no longer rejects numbers outside the allowlist (round 6 IA-5) |
| Dial classification | Transport-based `network` rule, `dial_uncertain`, `provider_busy`, the `voice_sessions` delete policy | **Removed** (A2's at-most-once and capacity handling). A dial that never got a conversation id still never leaves HRVoice. No migration before Core |
| Restore | Erasure objects at `erasures/<org>/...`, written inside the transaction | Key `<org>/erasures/<candidateId>` with a new `ObjectStorage.list`; written before the transaction; the re-apply command runs before the service starts; gate P requires S3 storage for Java (section 11.1 item 13) |
| Round-6 fixes that stay in scope | | Job description and title fence fix (AM-1); vendor HTTP limits separate from `SafeHttp` (SA-3); provider retention never applied to existing conversations (EIA-4); truthful removal copy (UX-2); `jobs.create` opt-in on the inbound key (SA-4); erased-call guards (IA-3, BE-2); erasure-record fixes (EIA-2, BE-4) |
| Effort (ASSUMPTION) | P 1-2 d; 0 5-7 d; A2 8-10 d; Core about 3 w; Core + E 7-8 w | P 3-5 d; 0 4-6 d; G 1-2 d; Core 2-3 w; Core + E 6-8 w; Dev (now carrying the log) about 3 w |

---

## 1. The decisions on one page

1. **The goal is a sync problem, not an AI problem.** "Connect once, data flows in, the agent works, results flow back" needs a machine identity, provenance (external ids), a durable record of what is still to be sent, a way to send it, and one adapter per named system. MCP does not provide delivery, retries or sync (FACT, https://modelcontextprotocol.io/specification/2026-07-28/changelog: "a broken response stream loses the in-flight request").
2. **Everything lives inside `apps/api-java`, on the same Postgres.** No new service, broker, Redis, Kafka or workflow engine. Reuse `Db.inOrg` and forced RLS, the narrow-lookup pattern, `background_jobs`, `AuthInterceptor` with per-field PII redaction, `AuditService`, `AdviceGuard` and the CSV-import validation (FACT, backend map §2, §3, §5, §6.4, §10).
3. **Order of work:** gate P → prerequisites (0) → results CSV export (A) → then, **only when a pilot confirms which path it will use**, the integration core plus either the named connector (E, Zoho Recruit by default) or the developer surface (Dev: API keys, `/v1`, events feed). Webhooks only if a pilot needs push. Founder decision 1 picks the branch. For a pilot that keeps candidates in Excel or Google Sheets and has no developer, the MVP is CSV in and CSV out, so "connect once" is **not** met for that customer; the follow-up is a Google Sheet connection (section 13.2). **None of it reaches customers until the Java API serves production** (gate P): FACT, production builds and routes only the Nest API (`Dockerfile` line 61 `CMD ["node", "apps/api/dist/main.js"]`; `docker/Caddyfile`). Separately, item G (section 13.1) is a launch gate for self-serve phone calling, which is a risk today whatever happens to integrations.
4. **Data flows one way per field.** Jobs and candidate contact details flow **in**; call results and human decisions flow **out**. For ATS-linked rows the ATS owns contact fields, and the server enforces that.
5. **The product rule holds at the boundary.** Only facts and decisions a named person made leave HRVoice: never `fitPercent`, a coverage percentage, a score, a rank, "qualified", or a stage the system chose. The stored call summary is written by the voice provider, so **no summary leaves HRVoice** until we write our own (founder decision 4). One serializer builds every outbound body and is tested for this.
6. **Results flow back even if nobody opens HRVoice.** In an org with a live connection, a background job fetches results whose provider webhook was lost. Every phone call the voice provider accepted (it has a conversation id) that ends after the connection exists produces one ATS note (E) or one `call.ended` (Dev), unanswered calls included. A dial that never reached the provider stays inside HRVoice. If no result can be fetched, the customer gets "result unavailable" instead of silence.
7. **Calls start from a person, as today:** one Call click for one candidate, through the existing route and guards. Calling many people with one click is a separate design that is not approved (`later-bulk-calling.md`). Fully automatic calling of imported candidates waits for a written founder decision on consent, calling hours and DND (FACT, `apps/api-java/MIGRATION_STATUS.md` line 373).
8. **Outbound problems never stop inbound data, and one failing item never stops the others.** API keys, intake and the events feed do not depend on whether a customer's ATS write is healthy; each outbound item retries on its own schedule.
9. **MCP:** never inside a live call; never as the sync channel; our own read-only MCP server later, when a paying customer asks.

The honest MVP loop is therefore: **in automatically (once a pilot's system is known), one Call click per person, out automatically.** The founder's "our agents perform the workflow" is met for data in and results out, not for starting calls (R25).

---

## 2. Final architecture

### 2.1 Picture

```
 CUSTOMER SIDE                               HRVOICE (apps/api-java: one Spring process, one Postgres, forced RLS)

 Own app / script / iPaaS  [Dev, gated]      EdgeFilter (per-key window on /v1) ─► AuthResolver: key hash ─► creator's live
   PUT/DELETE /v1/candidates/by-external ──►   membership ∩ key permissions ─► AuthInterceptor (same PII rules, same audit)
   POST /v1/candidates:batch                   CSV-import validation ─► Db.inOrg ─► jobs / candidates + job_links / candidate_links
   GET  /v1/events?after= ◄── integration_events (Dev only: ids + state, per-org seq, 30 days)                │
                                                                                                             ▼
 SaaS ATS  [E, gated]                        a person clicks Call for one candidate (existing route) ─► dialLocked ─► voice provider
   poll If-Modified-Since ◄── pull:<conn>                                                                    │
   one note per call ◄──────────┐            provider webhook, or fetch_results:<org> (lane) ─► apply() ─► voice_sessions
   stage: opt-in, a person's    │                                                                            │
   decision, 2-minute hold ◄────┤            60 s tick, database only, orgs with a live connection:          ▼
                                │              upsert integration_deliveries rows (per call; per candidate stage)
                                │              Dev: emit call.ended into the event log
                                │              enqueue send:<conn>, pull:<conn>, nightly:<conn>, fetch_results:<org>
                                └─────────── send:<conn> on the integration lane (own 2 threads): due items, each with its own backoff
```

### 2.2 Components (all new code in `JAVA/integrations/`, except where named)

| Component | Responsibility | Reuses (FACT, backend map) | Slice |
|---|---|---|---|
| `CallOutcomes.outcome` | One function for a call's outcome word, used by `Jobs.callStatus` / `queue` / `outcome`, the results route and `ExternalPayloads` (section 6.1) | `CallOutcomes`, the ledger's `completed` / `no_conversation` rule | 0 |
| `ExternalPayloads` | The single builder for every outbound body (ATS note, stage comment, CSV row, `/v1` result, feed item, MCP tool result, later webhooks), checked against the receiving principal's **current** permissions. No summary; answers from the job's own must-ask questions only; public decision values; plain text; sensitive-read audit that fails closed for request-built bodies (section 6.2) | `AdviceGuard.scrub`, `Coverage` question order, `HiringController.redactResult` rules | 0 |
| `HostedVoiceAdapter` fixes | An answer is taken only from the provider's `value` / `result` / `answer`, never from `rationale` or the raw object (0). `deleteConversation`, and `deleteAgent` for workspace deletion only (Core) | `VoicePorts`, `FakeVoice` | 0, Core |
| Prompt fence fix | The role block is fenced with the markers `ContextPacker.sanitize` already neutralises, and the job title is cleaned to one line without fence markers (round 6 AM-1; section 11.1 item 9) | `ContextPacker.fence` | Core |
| `Sealer` (in `platform/`) | AES-256-GCM, versioned key, per-row AAD, re-seal command | generalises `Notifications.seal/open`; the `--desk.reembed` CLI pattern | E or Webhooks, whichever ships first |
| `JobQueue` changes | Kind `integration` claimed only by a separate 2-thread lane executor, one job per org per pass, round-robin; POLICY; a clear error for unknown kinds (section 6.8) | `JobQueue` | Core |
| `Connections` | CRUD and status for connected systems; seal/open secrets; take-over by an admin | `Db.inOrg`, `AuditService`, `integrations.*` permissions | Core |
| `IntegrationScheduler` | One `@Scheduled` tick every 60 s, **database only**, per org with a live connection: upserts delivery rows (E), emits events (Dev), enqueues lane jobs that are due | the per-org loop pattern of `JobQueue.poll` | Core |
| `IntegrationWorker` | Lane handlers, each with a per-run budget: `pull`, `nightly`, `send` (E), `fetch_results`, `provider_delete` (Core) | `JobQueue.register` | Core, E |
| Erasure | One erasure path for "Remove this person", ATS and `/v1` deletions after their grace period, the retention purge and workspace deletion; `voice_sessions.content_erased_at`; provider deletes; an erasure record outside Postgres and `--desk.reapply-erasures` (section 11.1 items 10, 13) | `VoicePorts`, `ObjectStorage` (plus a new `list`), the `--desk.reembed` CLI pattern | Core (launch gate) |
| `AUTOMATION_PAUSED` (`Env`) | One switch that stops the tick and the integration lane; used when re-applying erasures after a restore and in incidents | `Env` | Core |
| `Events` | `emit(Db.Sql sql, ...)` inside the caller's transaction under the per-org lock, per-org `seq`, `created_at = clock_timestamp()` | `Db.Sql`, the 57014 mapping in `Db.underAdvisoryLock` | Dev |
| `ApiKeys` + one branch in `AuthResolver` | Bearer key → creator's live membership ∩ key permissions; synthetic role `api_key` | invitation-token hash pattern, `AuthResolver.membership` | Dev |
| `PublicApiController` (`/v1`) | Seven routes (section 6.6) | `Input`, `ApiError`, `CandidateImport`, `Candidates` | Dev |
| `AtsPort` + `ZohoRecruitAts` + `FakeAts` | The connector seam (section 3) | the `VoicePorts` / `HostedVoiceAdapter` / `FakeVoice` convention | E |
| `SafeHttp`, webhook signing | Outbound HTTP to customer URLs with the SSRF guard (section 6.4) | OkHttp 4.12.0, already on the classpath | Webhooks (later) |

### 2.3 Data model additions (one additive migration per slice; sketch, not final DDL)

Every new table is a tenant table: `ENABLE` + `FORCE ROW LEVEL SECURITY`, policy `organization_id = current_org_id()` for USING and WITH CHECK, added to `StructuralTest` (FACT pattern: `MIG/0016_hiring_desk_rls.sql`, `MIG/0030_background_jobs.sql`).

Slices 0 and A need **no migration**, except slice 0's phone backfill (data, not schema). Rule R10: while Nest can still be routed to in production, a migration may only add things Nest ignores. Core goes live only once Nest is no longer routed (section 13.1), so no migration in this plan is held back by R10; the rule stays recorded for any change made before then.

| Table / change | Key columns | Notes | Slice |
|---|---|---|---|
| `integration_connections` | `id, organization_id, provider ('custom' \| 'zoho_recruit'), status ('connecting' \| 'active' \| 'needs_attention' \| 'disconnected'), attention_reason ('consent_revoked' \| 'principal_lost' \| 'status_unmapped'), secrets_sealed, config jsonb, cursor jsonb, next_sync_at, rate_limited_until, consecutive_failures, failing_since, last_attempt_at, last_success_at, last_error_code, last_sync_issues jsonb, oauth_state_hash, oauth_state_expires_at, created_by_user_id, created_at, connected_at, updated_at, disconnected_at` | As v6 §2.3, without `fanout_seq` and `missed_until`. `status` says only whether the connection can work; delivery health lives in the failure columns and never changes `status`. `connected_at` is set when the connection first becomes `active` and again on every reconnect; it is the floor below which no call is sent, so a new connection has no backlog. `secrets_sealed` is the only place a secret lives; AAD = `organization_id:connection_id:secrets`. `config` keys come from a fixed allowlist and never hold a secret. `UNIQUE (organization_id, provider)`, disconnected rows included. **A connection row is never deleted while the workspace exists:** `integrations.delete` means disconnect, and a reconnect reuses the row, because the suppression hash of removed people includes its id (section 11.1 item 10) | Core |
| `job_links` | `job_id → jobs ON DELETE CASCADE, connection_id, organization_id, external_id, remote_updated_at, remote_state ('open' \| 'closed' \| 'deleted'), inbound_hash` | `UNIQUE (connection_id, external_id)`, `UNIQUE (connection_id, job_id)` | Core |
| `candidate_links` | `candidate_id → candidates ON DELETE CASCADE, connection_id, organization_id, job_id, external_id, external_parent_id, remote_updated_at, remote_state, remote_state_changed_at, inbound_hash, remote_status_seen, pushed_stage` | As v6 §2.3. `pushed_stage` is "the decision the ATS already reflects": set to the current stage when the link is created or adopted, and for all of a connection's links when write-back is switched on or its status map changes. On anonymisation `external_id` becomes `x:` + HMAC-SHA256(`INTEGRATIONS_HASH_KEY`, `connection_id:external_id`) for an ATS link (a suppression a pull checks before importing) or a random value for a `custom` link; in the same transaction `external_parent_id`, `inbound_hash`, `remote_status_seen` become NULL, `remote_state` `'deleted'`, `pushed_stage` the current stage | Core |
| `integration_deliveries` | `id, organization_id, connection_id → integration_connections, kind ('note' \| 'stage'), candidate_id NOT NULL → candidates ON DELETE CASCADE, voice_session_id → voice_sessions ON DELETE CASCADE (notes only), content_hash, status ('pending' \| 'sent' \| 'failed'), attempts int, next_attempt_at, last_error_code, sent_at, created_at, updated_at` | **One row per (connection, call) for a note and per (connection, candidate) for stage write-back**, updated in place. `UNIQUE (connection_id, voice_session_id)` for notes (stage rows have it NULL, and a unique index treats NULLs as distinct by default: FACT, https://www.postgresql.org/docs/current/indexes-unique.html) and a partial `UNIQUE (connection_id, candidate_id) WHERE kind = 'stage'`. Index `(connection_id, status, next_attempt_at)`. `content_hash` is the hash of what is to leave: for a note, the call fields that can leave (section 6.1); for a stage row, the target stage. Ids and hashes only, no PII; the erasure path deletes the person's rows. `ponytail:` no purge, one small row per call; add one to the retention purge if the table grows | E (Webhooks later reuse it) |
| `voice_sessions` | add `content_erased_at timestamptz` | The erasure marker (section 11.1 item 10) | Core |
| `candidates.source` CHECK | add `'api'`, `'integration'` | FACT, `MIG/0015_hiring_desk_foundation.sql` line 20 | Core |
| `background_jobs.kind` CHECK + `JobQueue.POLICY` | add `'integration'`, POLICY `{5, 30}` | Both must change together, or `enqueue` throws a NullPointerException (FACT, `JAVA/jobs/JobQueue.java` lines 38, 66-67) | Core |
| `usecases/hiring.json` | rename `actions.webhook` → `actions.integrations` | FACT: no Java or web code reads `actions.webhook` (grep; `CallContextCompiler` lines 171-235) | Core |
| `api_keys` | `id, organization_id, connection_id, name, prefix, key_hash (unique), permissions text[], created_by_user_id, last_used_at, expires_at, revoked_at, created_at` | As v6 §2.3 | Dev |
| `integration_events` | `id, organization_id, seq bigint, type ('call.ended' \| 'contact.stage_changed'), job_id, candidate_id, voice_session_id, data jsonb, created_at` | As v6 §2.3: ids and state only; per-org `seq` taken under the per-org emit lock; `created_at = clock_timestamp()`; `UNIQUE (organization_id, seq)`; index `(organization_id, candidate_id, seq)` for `superseded`; no foreign keys to people, jobs or calls; purged after 30 days by a `seq` boundary that **always keeps each org's newest event** (section 6.5) | Dev |
| `voice_sessions` | add `result_emitted_hash text`, `result_version int not null default 0` | The per-call dedupe for `call.ended` (section 6.5) | Dev |
| Phone canonical form | store E.164; `PhoneNumbers.toE164` uses it | Collision pre-check first (section 13.1) | 0 |

Removed from v6: the `voice_sessions` delete policy, the `scheduled_calls` usage and the `voice_provider_deployments` job slot (all A2); `fanout_seq`, `missed_until` and the delivery log keyed by event (the ordered drain).

---

## 3. Connector abstraction

**RECOMMENDATION.** A connector is one Spring bean implementing `AtsPort`, plus a static `ConnectorSpec`. No plugin loader and no DSL: adapters are registered in a map by key, the same way `JobQueue` handlers register by kind (FACT, `JAVA/notify/Notifications.java` line 49, `JAVA/knowledge/DocumentProcessor.java` line 55).

```java
// Sketch only. Not code to commit.
record ConnectorSpec(String key, String displayName, Auth auth, List<String> scopes,
                     Set<Reads> reads, Set<Action> actions, Budget budget) {}

enum Action {
  ADD_NOTE,   // trigger: a settled call. Content from ExternalPayloads only.
  SET_STAGE   // trigger: a person's decision, read at send time. Never a call outcome, never a model.
}

interface AtsPort {
  ConnectorSpec spec();
  Page<ExternalJob>         listJobs(Conn c, String cursor);
  Page<ExternalApplication> listApplications(Conn c, Instant modifiedSince, String cursor);
  ExternalApplication       getApplication(Conn c, String applicationRef);   // also confirms a deletion
  List<ExternalStage>       listStages(Conn c, String jobRef);              // read live; stages get renamed
  List<String>              deletedSince(Conn c, Instant since);            // empty when unsupported
  List<String>              noteMarkers(Conn c, ExternalApplication app);
  void addNote(Conn c, ExternalApplication app, String text, String marker);
  void setStage(Conn c, ExternalApplication app, String stageRef, String comment);
  // Typed errors: RateLimited(retryAfter), AuthRevoked, NotFound, Rejected(fieldErrors), Transient
}
```

- `ExternalJob`, `ExternalApplication`, `ExternalStage` and `Page` are the whole cross-vendor model; vendor field names never leave the adapter (FACT, rule in `JAVA/voice/VoicePorts.java` lines 7-10).
- `ExternalJob.description` is plain text: an adapter whose system returns HTML converts it before the create-once copy (FACT: Zoho's sample `Job_Description` is HTML, https://www.zoho.com/recruit/developer-guide/apiv2/get-associated-records.html; Tika's HTML parser is already on the compile classpath, `apps/api-java/pom.xml` line 78).
- Token requests are sent as a form body (FACT, RFC 6749 §4.1.3, https://datatracker.ietf.org/doc/html/rfc6749#section-4.1.3). Adapters never put a URL with a query string into an exception message.
- **HTTP limits for vendor APIs** (round 6 SA-3): connect 5 s, read 30 s, response body read by streaming and capped at 10 MB. The 64 KB / 10 s limits of section 6.4 are for customer-supplied URLs only: a Zoho page of up to 200 applications with resume text is larger than 64 KB (FACT: `per_page` default 200, https://www.zoho.com/recruit/developer-guide/apiv2/get-records.html; `candidates.resume_text` up to 50,000 characters, backend map §6.2).
- The `custom` connection has no adapter. A unified-API vendor (Kombo, Merge) would later be one more `AtsPort`.

Declared capabilities for the systems in view: as v6 §3.2 (Zoho Recruit first; Keka Hire V2; Greenhouse and Lever later through partner programmes; Darwinbox, Naukri RMS, Freshteam later or avoid).

---

## 4. Canonical model

**RECOMMENDATION.** No separate canonical schema. Our tables are the model; adapters map vendor objects straight onto them. As v6 §4, with these points restated:

| Our noun (table) | Outside concept | Direction | Owner after linking |
|---|---|---|---|
| Work item (`jobs`) | ATS job opening; requisition | in, **create only** | Title and description are copied once, when the job is created, then they are ours. The JD drives the call prompt (FACT, `JAVA/engine/CallContextCompiler.java`), so no machine path may change it later. Must-ask questions are never imported. A person links an agent before anyone can call (FACT, `HiringController.java` line 352) |
| Contact (`candidates`, job-scoped) | ATS application; customer's person-on-a-job | in | ATS-linked rows: name, phone, email and resume text are owned by the ATS while HRVoice still reads that person from it; `Candidates.update` then refuses edits with `candidates.managed_externally` (FACT: today `JAVA/hiring/Candidates.java` line 101 has no such check). Removing a person is never refused: unlinked and `custom`-linked rows are deleted after their content is erased; ATS-linked rows are anonymised in place and the link stays as a per-application suppression (section 11.1 item 10). Rejected or deleted in the ATS → closed or removed within one pull; closed rows cannot be dialed |
| Call result (`voice_sessions`) | note on the application; `call.ended` | out | Ours |
| Decision (`candidates.screening_status`, set by a person) | ATS status; public `decision` value | out, mapped, opt-in for the ATS | Ours. Only `reviewed` ("Moved forward") and `declined` ("Not moving forward") are ever written to an ATS |

**Public decision values** (as v6 §4): `new → undecided`, `screening → on_hold`, `reviewed → moved_forward`, `declined → not_moving_forward`, plus `decisionLabel`. Slice 0 changes `hiring.json`'s `new` label from "Not called yet" to "No decision yet" (FACT, `apps/api-java/src/main/resources/usecases/hiring.json` line 19; the web already overrides it, `apps/web/lib/use-case-definitions.ts` lines 53-59).

**Field allowlist (DPDP minimisation).** Inbound we store only name, phone (E.164), email, resume text, job link, external ids, remote updated time, remote state and the remote status label. Never date of birth, gender, salary, address, ATS notes, ratings or scores.

**Event names (D18).** `call.ended` and `contact.stage_changed`, each with `useCase` in the body (Dev). The in-process `DomainEvents` stay as they are (FACT, `JAVA/engine/DomainEvents.java`).

---

## 5. Sync design (inbound, slice E)

As v6 §5, with these changes: every vendor call runs on the integration lane with a per-run budget; nothing uses `Snooze`; the tick re-enqueues what is still due.

| Concern | Design | Evidence |
|---|---|---|
| **Initial import** | After connect: the customer ticks jobs (none pre-ticked) and picks a trigger status. One lane job per connection, key `pull:<connectionId>`. It imports page after page (up to 200 records each), writing each page and advancing `cursor` **in the same transaction**, until done or 120 s have passed; the next tick re-enqueues it while `next_sync_at` is still due. The queue key is the single-flight lease | FACT: `enqueue` does `ON CONFLICT ... WHERE status IN ('queued','running') DO NOTHING`; the row is deleted only after the handler returns (`JAVA/jobs/JobQueue.java` lines 66-75, 136-145) |
| **Incremental** | Every 15 minutes: Get Records with `If-Modified-Since` = start time of the previous scan minus 2 minutes. Already-linked applications update `remote_status_seen` and `remote_state` whatever their status; the trigger status decides only which new applications are imported. Idempotent upserts (link uniqueness plus `inbound_hash`) | FACT: `If-Modified-Since` on Get Records (https://www.zoho.com/recruit/developer-guide/apiv2/get-records.html) |
| **Real time** | None in the first release; V2 vendor webhooks as re-fetch hints | FACT: Zoho webhooks only on Professional and Enterprise (https://www.zoho.com/recruit/plan-comparison.html) |
| **Nightly** | One lane job `nightly:<connectionId>`: list all applications on linked open jobs, compare with `candidate_links`, mark missing ones; confirm and anonymise deletions past their grace period (next row). "Sync now" enqueues a pull | Vendors do not guarantee webhook delivery |
| **Deletions and erasure** | Deleted in the ATS → `remote_state = 'deleted'`; the person leaves every queue and cannot be dialed. After the grace period (founder decision 9; proposed 7 days) the nightly job, skipping `x:` links, calls `getApplication`: anything but `NotFound` reopens the link; otherwise it anonymises through the erasure path (section 11.1 item 10). Status card: "2 people removed in Zoho Recruit will be anonymised on 10 Oct". **Suppression:** before importing an application with no link, the pull checks for `external_id = 'x:' + HMAC(connection_id:external_id)` on that job and skips it, counted as `removed_in_hrvoice` | Behaviour on Zoho merges unverified. ASSUMPTION: we are the employer's DPDP data processor (needs a lawyer) |
| **Status changes in the ATS** | Never change our stage (D11). Rejected, hired, withdrawn → `remote_state = 'closed'`: "Closed in Zoho Recruit", left out of "Not called yet", and **dialing is blocked** by one guard in `VoiceSessions.dialLocked`, the single dial choke point, so a person's Call click is refused. Every linked row shows the remote status read-only | FACT: `dialLocked` is the only dial path (backend map §9; `JAVA/voice/VoiceSessions.java` lines 389-415 read the job and candidate there) |
| **Jobs closed in the ATS** | `job_links.remote_state = 'closed'`: stop pulling that job, show it, never close our job automatically | |
| **Validation** | Mapped rows go through the CSV-import rules and the savepoint-per-row insert; rejected records are counted in `last_sync_issues` and shown with "Sync now" | FACT: `JAVA/hiring/CandidateImport.java` |
| **Phone match with existing rows** | Connector only: a job row with the same E.164 phone that is unlinked, or whose link is `deleted`, is adopted (`pushed_stage` = its current stage, audit `integration.candidate_adopted`). `/v1` never adopts | FACT: unique `(job_id, phone)` (`MIG/0018`) |
| **Failures** | `AuthRevoked` / `invalid_grant` → `needs_attention` (`consent_revoked`), admins emailed once; the tick enqueues nothing that needs the token. `RateLimited` → `rate_limited_until`; the tick enqueues nothing for that connection until then. `Transient` → the job stops and the next tick retries | |
| **Idempotency** | Inbound: link uniqueness + `inbound_hash`. Notes: the delivery row plus the marker `HRVoice ref <session prefix>.<rendered-note hash prefix>`, checked before every write. Stage: `pushed_stage` (section 7) | |
| **Rate limits and budget** | Per-connection budget from the customer's plan, about 20% of daily credits, part reserved for writes; polling slows first. Token refresh under `pg_try_advisory_xact_lock("conn:"+id)` held only for the refresh call; a job that does not get the lock returns and the next tick retries | FACT: Get Records 3 credits; Free 5,000/day; concurrency 5-20 (https://www.zoho.com/recruit/developer-guide/apiv2/limits.html) |
| **Fail-closed revocation** | Every job reloads the connection and stops if `disconnected`; each job checks only its own precondition (a pull needs a token, a send needs a live sending principal, a stage push a mapped status). Disconnect: open the token in memory, then in one transaction status `disconnected`, null `secrets_sealed`, revoke the connection's API keys; after commit, best-effort vendor revoke | |

Credit arithmetic (ASSUMPTION: two Get Records calls per poll): 96 × 2 × 3 = 576 credits a day, about 12% of the Free plan.

---

## 6. Outbound: notes, stage, CSV, feed

### 6.1 How results are found and delivered

**FACT (code read).**
- `VoiceSessions.apply` writes provider data in one transaction, runs the post-call extractor outside any transaction, may write a filled summary in a second transaction, records the ledger outcome, then publishes in-process events; it runs on every webhook, reconcile and results-page open (`JAVA/voice/VoiceSessions.java` lines 505-551).
- `expireStale` runs every 5 minutes, visits only orgs with `status = 'active'`, returns at once when `ELEVENLABS_ENABLED` is false (the default), and only sets stale sessions to `ended`; it fetches nothing (lines 678-687; `JAVA/platform/Env.java` line 124). Reconcile runs only when a person ends a call or opens the results page (`JAVA/hiring/HiringController.java` line 271).
- A dial the adapter could not complete leaves a `failed` session with no conversation id (`VoiceSessions.java` lines 441-449).
- `JobQueue.enqueue` opens its own transaction, so a job cannot be enqueued inside a caller's transaction; `runDue` visits only orgs with `status = 'active'`; a failed handler is retried with backoff and ends `dead` after its attempts (`JAVA/jobs/JobQueue.java` lines 66-75, 93-97, 136-161).
- `Jobs.updateStatuses` sets `candidates.updated_at = now()` whenever the stage changes (`JAVA/hiring/Jobs.java` line 264). The route then writes one `hiring.candidate_status_changed` audit row per candidate, with `from` and `to`, after that transaction, through `AuditService.record`, which logs and swallows failures (`JAVA/hiring/HiringController.java` lines 374, 387, 391-396; `JAVA/audit/AuditService.java`). `Candidates.update` also sets `updated_at` (`JAVA/hiring/Candidates.java` line 113).

**A phone call with a candidate is settled** (`agent_sessions.channel = 'phone'`, `candidate_id` set, **`external_conversation_id` set**, meaning the provider accepted the dial; browser tests never leave) when its status is `ended` or `failed`, `ended_at` is more than 3 minutes ago, and it has a `failure_reason` or a transcript, or `ended_at` is more than 90 minutes ago. A dial the provider refused, or that failed on our side, is not a call for integrations: it is shown in HRVoice and never written to an ATS, because we cannot know whether it was placed.

**One outcome function (slice 0).** `CallOutcomes.outcome(session)` returns `failure_reason` when set; otherwise `completed` when the transcript has a user turn; `no_conversation` ("Picked up, didn't speak") with a transcript and no user turn; otherwise `result_unavailable` ("We couldn't get this call's result. Open the candidate in HRVoice to try again.") once `ended_at` is more than 90 minutes ago. One value exists only in the app: `content_erased` ("Call content removed"). `Jobs.callStatus`, `queue`, `outcome`, the results route, the results CSV and `ExternalPayloads` all call it (FACT: today `callStatus` maps any `ended` session without a failure reason to `completed`, `JAVA/hiring/Jobs.java` lines 170-178). Queues: `no_conversation` joins "Didn't connect"; `result_unavailable` stays in "Ready for review" with "Try again" (opening results already reconciles); `content_erased` is in no queue.

**Background result fetch (Core; only orgs with a live connection).** Every fifth run, the tick enqueues `fetch_results:<org>` when the org has phone sessions with a candidate and a conversation id that either ended 3 to 60 minutes ago with no transcript and no `failure_reason`, or are still `active` more than `voiceMaxPhoneMinutes + 2` minutes after they started. The handler runs on the integration lane (section 6.8), never on Spring's scheduler thread, and only while voice is on. It passes up to 5 such sessions to `reconcileSystem(org, vsId)` (the existing fetch plus `apply(org, null, ...)`), stops after 40 seconds or **at the first provider timeout or 5xx**, and returns. What is left is tried again 5 minutes later: about 12 tries over the hour, no dead rows. A `voice.reconcile` timer records each run. FACT why off the scheduler thread: Spring Boot's scheduler "uses one thread by default" (https://docs.spring.io/spring-boot/3.4/reference/features/task-execution-and-scheduling.html), `JobQueue.poll` runs jobs inline on it (`JobQueue.java` lines 87-90), and one fetch can take 10 s connect plus 30 s read (`HostedVoiceAdapter.java` lines 46-47). `ponytail:` orgs without a connection keep today's behaviour (a result is fetched when someone opens it); widen the set if the results CSV ever needs it.

**Notes (E): level-triggered, one delivery row per (connection, call).**

*Discovery* (the tick, database only, one `inOrg` per org, for each ATS connection that has `connected_at` set and is not `disconnected`, `needs_attention` included): for settled calls whose candidate has a live link on that connection (`remote_state <> 'deleted'`), with `started_at > now() - interval '8 days'` (the existing `(organization_id, started_at)` index), `ended_at` within 7 days and later than the connection's `connected_at`, and `content_erased_at IS NULL`, upsert:

```sql
-- Sketch. content_hash = md5(status, failure_reason, transcript is not null, <transcript has a user turn>, structured_answers)
insert into integration_deliveries (organization_id, connection_id, kind, candidate_id, voice_session_id,
                                    content_hash, status, attempts, next_attempt_at)
select ..., 'note', vs.candidate_id, vs.id, <hash>, 'pending', 0, now() from ...
on conflict (connection_id, voice_session_id) do update
  set content_hash = excluded.content_hash, status = 'pending', attempts = 0, next_attempt_at = now(), updated_at = now()
  where integration_deliveries.content_hash is distinct from excluded.content_hash;
```

Only what can leave is hashed (as v6): the summary never leaves, so a summary filled later makes no new version. Then, for each connection with a `pending` row whose `next_attempt_at <= now()`, not inside `rate_limited_until` and with its preconditions met, the tick enqueues `send:<connectionId>`. `ponytail:` rehashes up to 7 days of linked calls a minute per connected org; the upgrade is a dirty flag set by `apply`.

*Sending* (`send:<connectionId>`, on the lane): reload the connection and stop if it is `disconnected` or its sending principal is not live (section 10). Take up to 20 due rows ordered by `next_attempt_at`. For each:
1. Re-read the row's call and link: if the call is erased (`content_erased_at` set), the link is no longer live, or the row is gone, skip it (the erasure path deletes the person's rows; this re-check covers an erasure committed after discovery, round 6 IA-3 / BE-2).
2. Build the note with `ExternalPayloads` for the sending principal; the marker carries the rendered note's hash prefix. List the application's note markers; if the marker exists, write nothing; otherwise `addNote`.
3. **Success** (or the marker existed): `UPDATE ... SET status = 'sent', sent_at = now(), attempts = 0, last_error_code = NULL WHERE id = ? AND content_hash = :hashReadInStep1`. If the hash moved meanwhile, the row stays `pending` and the next run sends the newer version once (the marker stops a duplicate). The connection's `consecutive_failures` resets and `last_success_at` is set.
4. **Permanent refusal** (`Rejected`, `NotFound`, other 4xx except 408 and 429): the row becomes `failed` with its error code, and the run carries on with the next row. Card: "1 call result couldn't be sent to Zoho Recruit. Open it in HRVoice."
5. **Rate limited:** set `rate_limited_until` and stop.
6. **Transient** (timeout, 408, 5xx, `Transient`): `attempts + 1`, `next_attempt_at = now() + least(1 hour, 1 minute × 2^attempts)`; the connection's `consecutive_failures + 1` (`failing_since` on the first; one email to admins at the third: "Couldn't send since 10:40"); **the run stops**, because the vendor is probably in trouble. Rows are taken in `next_attempt_at` order, so a row that always fails moves behind the others and never holds them up: no probe is needed.
7. **`AuthRevoked`:** `needs_attention` (`consent_revoked`) and stop.
8. A row still `pending` 7 days after its call ended becomes `failed` with `expired`; the card says "N call results from before 3 Nov couldn't be sent. Open them in HRVoice." Nothing disappears silently.
9. **Budget:** 20 rows or 120 seconds, far inside the queue's 900-second lease (FACT, `JobQueue.java` line 39); the next tick re-enqueues if rows are still due. The handler never throws for a delivery failure, so queue attempts are spent only on bugs.

Consequences:
- **One note per call** normally; a follow-up note ("Updated result for the call on 3 Oct, 11:02") only when the rendered note changed.
- **Unanswered, failed and silent calls** the provider accepted get a note with their outcome.
- **No backlog on first connect**: the floor is `connected_at`.
- **A connection that needs attention keeps its rows**; they are sent when it recovers, and anything older than 7 days is shown as expired.
- **No order is promised between notes**; each note is about one call (`02-resolutions.md` R3.5: "Strict order is not needed for notes (each note is about one call)").
- **Nest-written results are caught too**, because discovery reads the database.

**The 5-minute loop (Core).** `expireStale` keeps its schedule and its stale expiry, which still follows the voice switch. It gains steps that are **database work only** and run whatever the voice switch says, for every `active` **and `deleting`** org: the daily retention purge, the deleting-org steps (section 11.1 item 10), enqueueing `provider_delete:<org>` when erased calls still hold a conversation id or a deleting org still has hosted agents, and, from Dev, the daily events purge (section 6.5). All vendor and provider HTTP runs on the lane, so the scheduler pool needs no change. `ponytail:` one scheduler thread; the tick can lag behind a long inline document job in `JobQueue.poll` (already true for the 5-minute loop today); set `spring.task.scheduling.pool.size` if that lag is ever seen.

**Use-case gate.** Delivery happens only when the use case's `actions.integrations` is `true` (renamed from `webhook`). Stage write-back additionally needs the per-connection opt-in.

### 6.2 The one serializer (`ExternalPayloads`) and the one export rule

As v6 §6.2, unchanged. In short:
- **No summary in any outbound body** (FACT why: the stored summary is the provider's `analysis.transcript_summary`, `JAVA/voice/HostedVoiceAdapter.java` lines 149-150; our `summaryInstruction` applies only to a filled-in summary, `JAVA/engine/PostCallExtractor.java` line 63; `AdviceGuard.scrub` matches only nine words).
- **Answers** to the job's own must-ask questions only, in the snapshot's order, scrubbed, capped at 500 characters, "not answered" for gaps. Slice 0: the adapter takes an answer only from `value`, `result` or `answer` (FACT, `HostedVoiceAdapter.java` lines 151-161), and the compiler records `criteriaSource: 'job' | 'agent'` in the snapshot (FACT, `CallContextCompiler.java` lines 64-67, 122, 252-260); answers leave only when it is `'job'`.
- **One export rule:** answers only if the principal holds `calls.read_transcript` and `candidates.export`; phone and email also need `candidates.read_pii` and never travel in the feed or webhooks.
- No `fitPercent`, coverage, score, rating, summary or recommendation field. Stages only as public decision values; never the free-text stage reason; a team member by display name only, or "a team member", never an email (FACT, `Jobs.stageHistory` falls back to the email, `JAVA/hiring/Jobs.java` lines 273-295).
- **Plain text only:** control characters (except new lines) and `<` `>` removed from free text.
- **Audit:** request-built bodies with answers or PII write `authz.sensitive_access` before the response, through a variant of `AuditService.record` that throws; on failure `503` and no content (FACT: `record` swallows failures, `JAVA/audit/AuditService.java`).
- **Erased calls are gone:** a body for a call whose `content_erased_at` is set carries no content, and the feed skips its `call.ended` items (round 6 BE-2).

**Merge-blocking test** (as v6): fails on any forbidden field; on answers for a principal without the content permissions; on any phrase of the evaluative corpus ("strong candidate", "well suited for the role", "lacks relevant experience", "recommend", "good fit") placed in a fixture summary or a `rationale`-only answer appearing in any body; on angle brackets from `<img src=x onerror=alert(1)>`; on a stage `reason` or a team member's email; on an email-shaped string for a principal without `candidates.read_pii`; on an answer to an agent criterion. Scrub is the backstop; leaving the summary out is the control.

### 6.3 Webhooks (later, only when a pilot needs push)

Not designed beyond this. When built: Standard Webhooks signing (`webhook-id`, `webhook-timestamp`, `webhook-signature: v1,<base64 HMAC-SHA256>`; FACT, https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md); bodies from `ExternalPayloads`; delivery from the Dev event log with **one `integration_deliveries` row per (endpoint, event)** and the same per-item backoff as notes, so no ordered drain is needed (receivers dedupe on `webhook-id`; order comes from the feed); `contact.stage_changed` delivered only after the 2-minute hold and skipped if superseded; all HTTP through `SafeHttp`.

### 6.4 Delivery health, HTTP limits and SSRF

- **Delivery health is not connection status.** The failure columns drive "Couldn't send since 10:40", the one email and the per-call delivery line. They never change `status`, never reject an API key and never stop pulls or the feed. **Retry** (admins): sets the connection's `failed` rows (not `expired` ones older than 7 days) back to `pending` with `next_attempt_at = now()`, resets `consecutive_failures`, and enqueues `send:<connectionId>`.
- **Vendor APIs** (`AtsPort`): connect 5 s, read 30 s, streamed body capped at 10 MB (section 3).
- **Customer-supplied URLs** (`SafeHttp`, Webhooks slice; rung 4 later): connect 3 s, whole call 10 s, body capped at 64 KB and never logged; a custom `Dns` that refuses unless every resolved address is public; IP-literal hosts refused; HTTPS on 443 only; no proxy; no redirects; the URL kept inside `secrets_sealed`; the dev-only `ALLOW_PRIVATE_WEBHOOK_TARGETS` refuses to boot with `COOKIE_SECURE=true` (details and evidence as v6 §6.4).

### 6.5 Events feed and event log (Dev slice only)

The ordered log exists only for the feed, so it ships only with the developer surface. Rules as already agreed (v6 §6.1 and §6.5), restated:

- **Emitting `call.ended`.** In an org with a `custom` connection that has `connected_at` set and is not disconnected, the tick selects and hashes settled calls since that `connected_at` (within 7 days, `content_erased_at IS NULL`) **without** the events lock; only if a row's hash differs does it take the lock and run `UPDATE voice_sessions SET result_emitted_hash = :h, result_version = result_version + 1 WHERE id = ? AND result_emitted_hash IS DISTINCT FROM :h AND content_erased_at IS NULL RETURNING result_version` (the last condition is round 6's IA-3 / BE-2 fix: an erasure committed between scan and update emits nothing), then `Events.emit(sql, 'call.ended', {version})`.
- **Stage outbox.** In such an org, `Jobs.updateStatuses` takes the org events lock **as its first statement**, before `loadJob` locks the job row, and emits `contact.stage_changed` with `{from, to, decidedByUserId}` inside the existing `if (!previous.equals(...))` branch (FACT: the job row is locked first and this is the only Java writer of `screening_status`, `JAVA/hiring/Jobs.java` lines 255-264; `HiringController.java` lines 373, 386). Orgs without a feed take no events lock, so a recruiter's decision in an E-only workspace never waits on it.
- **Lock and `seq`.** `pg_advisory_xact_lock(hashtextextended('events:' || org, 0))` first in every emitting transaction; `Events.emit` reads `coalesce(max(seq), 0) + 1` and inserts with `created_at = clock_timestamp()` (FACT, https://www.postgresql.org/docs/current/functions-datetime.html); the 15-second `statement_timeout` maps to `ApiError.conflict("events.busy", ...)` as `Db.underAdvisoryLock` already does (FACT, `JAVA/platform/Db.java` lines 103-115). Lock order: the events lock, then the job row, then candidate rows; the sweep takes the events lock, then `voice_sessions` rows. Every transaction is READ COMMITTED (FACT: `Db` sets no isolation level), which the "lock, then read `max(seq)`" rule relies on.
- **Purge.** Once a day per org, from the 5-minute loop's database step: boundary `b = coalesce((select min(seq) ... where created_at >= now() - interval '30 days'), (select max(seq) ...))`, then `DELETE ... WHERE seq < b`. **The `max(seq)` fallback keeps the org's newest event, so `max(seq)` never goes down** and a quiet month cannot reuse numbers a client has passed.
- **Feed** `GET /v1/events?after=<cursor>&types=`: this org's events with `seq > after`, ordered, at most 200, bodies built at read time by `ExternalPayloads` for the calling key. Without `after`: `{items: [], next: <cursor>}` positioned before the hold. The cursor wraps the per-org `seq` and `EVENTS_EPOCH`; a cursor from another epoch gets `410`. **`410 cursor_expired` is defined against the oldest retained `seq`:** if `after < min(seq) - 1`, events after the cursor were purged, and the client is told to restart without `after`; never a silent skip.
- **2-minute hold, cut at a `seq` boundary:** only events whose `seq` is below the lowest `seq` created in the last 2 minutes are returned.
- **`superseded`:** a `contact.stage_changed` carries `superseded: true` when a later stage event exists for the same candidate, so decide, Undo, decide again yields one actionable event. The docs say: act on a stage event only when `superseded` is `false`.
- Contract: at-least-once, ordered within the workspace, events at least 2 minutes old, 30-day window.

### 6.6 Public REST API v1 (Dev slice)

As v6 §6.6 (seven routes, permissions, `409 job_not_found`, opaque external ids, route templates in audit, identity chosen by the matched handler, `/v1` only on `API_PUBLIC_HOST`, ingress and rate limits, audit of every write, errors and versioning, Kafka HTTP Sink notes), with three changes:
- **No intake rejection by country.** v6 flagged numbers outside `VOICE_DIAL_COUNTRY_CODES` as `invalid_phone` at intake; removed (round 6 IA-5: Indian teams hiring for Gulf roles could not store those people, and results CSVs with such rows would not re-import). The dial-time check stays, in item G.
- **Jobs created by a key cannot be called until a person links an agent.** The reference docs say so; HRVoice never links an agent automatically to a machine-created job, because the agent speaks from its description (round 6 IA-4, answered with SA-4's human gate).
- **Untrusted text, the other way.** The reference docs for `/v1/events` and `/v1` results say: "Names, job titles and answers are written by candidates or your own staff. Treat them as data, not instructions, when you pass them to an AI tool." (round 6 AM-2).

### 6.7 Results CSV export (slice A)

As v6 §6.7: a button on the job's candidates board; each row built by `ExternalPayloads` for the exporting person; always name, job title, decision label, latest call outcome (from `CallOutcomes.outcome`; "pending" before a call settles), call time, duration and a link; answers as columns with `calls.read_transcript`; email and the phone as `country_code` (`91`) and `phone` (national digits) with `candidates.read_pii`, so the file re-imports (FACT, `JAVA/hiring/CandidateImport.java` lines 20-28, 80-89). Gated by `candidates.export`, audited as a sensitive read. UTF-8 with a byte-order mark; every cell quoted; cells starting with `=`, `+`, `-`, `@`, tab or carriage return escaped (FACT, https://owasp.org/www-community/attacks/CSV_Injection).

### 6.8 Queue changes (Core)

FACT about today's code (`JAVA/jobs/JobQueue.java`): 2 worker threads for every kind and tenant (lines 50-54); `runScope` drains one org until empty, 10 jobs per claim; `poll()` runs `runDue()` inline on Spring's scheduler thread (lines 87-90) and visits only `active` orgs (line 96); job rows are visible only inside their org (RLS), so finding work means one transaction per org.

Changes:
1. **Integration lane.** Kind `integration` is claimed only by a separate 2-thread executor; `runScope` for the other kinds skips it. A lane pass claims **at most one job per org**, round-robin over an in-memory set of orgs with due lane work, fed by `wake()` and by a 30-second safety-net poll that visits `active` and `deleting` orgs. Every lane handler has a per-run budget (section 6.1) far inside the 900-second lease. `email` and `document` behave exactly as today. The tick likewise visits only an in-memory set of orgs with a live connection (fed by connect, reconnect and disconnect, filled once at startup). `ponytail:` in-memory sets per replica; a due-orgs table past about 1,000 orgs.
2. **No `Snooze`.** Every lane job is level-triggered: it does what is due within its budget and returns, and the tick (or, for `provider_delete`, the 5-minute loop) enqueues it again while work remains. Rate limits live on the connection (`rate_limited_until`), per-item backoff on the delivery row.
3. **POLICY** `integration` `{5, 30}`; handlers never throw for expected failures, so attempts only cover bugs.
4. **Unknown kinds** throw a clear error at `enqueue`.
5. **Connection pool check** in Core's definition of done: pool size ≥ lane threads (2) + legacy workers (2) + the scheduler thread + 1 connection held by a token refresh across its HTTP call + headroom for web traffic (FACT: pool default 10, `Env.java` line 88).

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
                    a settled call (a fact)                    → ADD_NOTE   (always on for a connected ATS)
                    a person's decision: reviewed / declined   → SET_STAGE  (opt-in, customer-mapped, level-triggered, from a baseline)
                    custom connection                          → events feed (webhooks later)
   ▼
Agent             the voice agent never calls an action. It receives only the compiled job, questions and knowledge.
```

**Provider independence of the core agent.** FACT: data reaches a live call only at provisioning, and the live agent gets only `end_call`, `voicemail_detection` and `transfer_to_number` (`JAVA/engine/CallContextCompiler.java` lines 26-37, 220-237).

**Where the never-recommend rule is enforced (three places, all testable):** content (only `ExternalPayloads`, no summary); trigger (`SET_STAGE` sends only the candidate's current `screening_status`, only `reviewed` or `declined`, set only by a person through the stage routes, FACT `JAVA/hiring/Jobs.java` line 264; API keys cannot change stages; a call outcome never moves an ATS status); target (adapters expose only `addNote` and `setStage`). The live call itself is protected by the prompt fence fix (section 11.1 item 9).

**Stage write-back (from a baseline, level-triggered).** Off by default. The customer picks the target status for "Moved forward" and "Not moving forward" from their live status list.
- **Baseline.** Only decisions made after write-back is on, or after a row was linked, are sent (`pushed_stage` as section 2.3). Earlier decisions are never sent in bulk.
- **Discovery** (the tick, for connections with write-back on and not `needs_attention` with `status_unmapped`): candidates with a live link where the current stage is `reviewed`/`declined` and differs from `pushed_stage`, or is `new`/`screening` while `pushed_stage` is `reviewed`/`declined`. Upsert their stage row: `content_hash` = the current stage, `status = 'pending'`, `attempts = 0`, `next_attempt_at = candidates.updated_at + interval '2 minutes'` (the hold), when `content_hash` differs.
- **The handler** (inside `send:<connectionId>`, same success, refusal and backoff rules as notes):
  1. **Hold.** If `candidates.updated_at` is less than 2 minutes ago, move `next_attempt_at` to 2 minutes after it and skip. The in-app Undo lasts 8 seconds and re-posts the previous stage (FACT, `apps/web/components/ui/toaster.tsx` line 78; `apps/web/app/jobs/[id]/candidates/page.tsx` lines 680-698), which moves `updated_at` again. `updated_at` also moves on a contact edit; that only delays the push.
  2. **Read the current stage.** If it equals `pushed_stage`, mark the row `sent` and stop.
  3. **Forward** (`reviewed`/`declined`): re-read the application's ATS status. If it already equals the mapped target (for example our own write just before a crash), record `pushed_stage` and `remote_status_seen`; no note, no `setStage`. If it differs from `remote_status_seen` (changed in the ATS), do not overwrite: add a note "Moved forward by Priya Sharma in HRVoice; status left unchanged because it was changed in Zoho Recruit". Otherwise `setStage` with the comment "Moved forward by Priya Sharma in HRVoice", and **in the same transaction that sets `pushed_stage`, set `remote_status_seen` to the status we wrote**.
  4. **Withdrawn** (`new`/`screening` after `reviewed`/`declined`): a note "Decision withdrawn in HRVoice by Priya Sharma. Status in Zoho Recruit not changed." and `pushed_stage` = the current stage.
- **The decider's name** comes from the latest `hiring.candidate_status_changed` audit row for that candidate and job whose `to` equals the stage being sent: the person's display name (`users.name`), or "a team member" when it is empty or the row is missing (the audit write can fail silently, section 6.1 FACT). Never an email.
- Because the handler reads current state, retries cannot leave the ATS on an older decision.

**Notes.** One per call, a follow-up only if the rendered note changed (section 6.1):

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

**Later in-call actions** (for example booking an interview slot) stay Later, as v6 §7.

---

## 8. MCP position

As v6 §8, unchanged: **[Avoid]** MCP inside a live call; **[Avoid]** vendors' MCP servers for sync; **[Later]** our own read-only MCP server at `/v1/mcp`, triggered by a paying customer, built on the same services, interceptor and `ExternalPayloads`, with an "AI assistant (read-only)" key preset (no call content, no contact details, expiry of 90 days or less), the `Origin` check (FACT, https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http), the 2026-07-28 notes (stateless, `server/discover`, `cacheScope: "private"`; FACT, https://modelcontextprotocol.io/specification/2026-07-28/changelog), and the static key labelled "non-standard authorization" (FACT, https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization). One addition (round 6 AM-2): every tool result is returned as `structuredContent` with an `outputSchema`, with names, titles and answers as separate data fields, never joined into prose, and names and titles length-capped (FACT: servers MUST "Sanitize tool outputs", https://modelcontextprotocol.io/specification/2026-07-28/server/tools). **[Avoid]** placeholder MCP UI (FACT, launch spec line 88).

---

## 9. Custom and legacy systems: the hierarchy

As v6 §9: (1) their script or iPaaS pushes to `/v1` and polls `/v1/events` (Dev); (2) their cloud bus pushes to `POST /v1/candidates:batch` (Dev); (3) files: CSV in (exists), results CSV out (A), `text/csv` on the batch route (Dev); (4) one narrow HTTPS endpoint of theirs (Later, `SafeHttp`); (5) a read-only database view (Later, paid exception with a DPA); (6) an agent in their network (Avoid); (7) read-write DB, CDC, their brokers, VPN (Never).

---

## 10. Multi-tenancy and identity

- Every new table: forced RLS on `organization_id = current_org_id()`; listed in `StructuralTest`; no BYPASSRLS (FACT, `JAVA/platform/Db.java` line 33).
- Tenant resolved only from server state: the API key hash (narrow SELECT-only lookup), the signed-in member's session (the OAuth callback compares the `state` hash on that member's org's `connecting` row), or in V2 an inbound webhook connection. Never from an `organization_id` or `job_id` in a payload.
- **Performance isolation:** the integration lane with one job per org per pass, a per-run budget on every lane job, per-item backoff, and per-key rate windows (sections 6.1, 6.6, 6.8).
- **API key principal** (Dev): as v6 §10 items 1-5. The key acts as its creator, re-checked on every request; valid unless revoked, expired, its connection is disconnected, or its creator is no longer an active member of an active workspace with an active user account. **`AuthResolver.membership` itself gains the user and workspace status checks** (Core), so a workspace in `deleting` locks out sessions and keys at once (FACT: today `membership` checks only the membership's status, `JAVA/authz/AuthResolver.java` lines 59-80). Effective permissions = key ∩ creator's live permissions; `AuthContext.apiKeyId`; synthetic `roleKey` `api_key`, so `Actor.isOwner()` is false (FACT, `JAVA/authz/Actor.java` lines 25-26); code reachable from `/v1` never re-reads `role_permissions` (a grep test fixes the allowed files; FACT one re-read exists outside `/v1`, `JAVA/runtime/AgentRuntime.java` lines 169-174).
- **Workers** (pull, send, nightly, fetch, provider deletes, the tick) run `inOrg(org, Db.NIL)` and audit with a NULL actor (FACT, `VoiceSessions.webhook` calls `audit.record(org, null, ...)`).
- **The connection's sending principal** (`created_by_user_id`) matters only for ATS connections (and later webhooks): its live permissions decide content; if that person leaves or loses `integrations.update`, the connection gets `needs_attention` (`principal_lost`), sends stop until an admin presses "Take over", pulls continue, keys are unaffected.
- **Dialing** is unchanged: one person, one Call click, through `dialLocked` and its existing guards, plus the closed-in-ATS block (E). The shared provider account and calling number, and who may dial at all, are item G (section 13.1), not integration work.

---

## 11. Security

### 11.1 MVP gates

1. **`Sealer`** (E or Webhooks, whichever ships first): as v6 §11.1 item 1 (AES-256-GCM, `INTEGRATIONS_KEYS` and `INTEGRATIONS_KEY_CURRENT`, never derived from `BETTER_AUTH_SECRET`, output `k<version>.<base64>`, re-seal command, a missing version opens as "reconnect needed").
2. **API keys** (Dev): as v6 §11.1 item 2, with one preset change (round 6 SA-4): "Send candidates in" (default) is `jobs.read`, `candidates.create`, `candidates.update`; **"May create jobs"** adds `jobs.create` and **"May remove people"** adds `candidates.delete`, both explicit checkboxes, so a leaked default key can neither create jobs whose text an agent would speak nor start erasures. "Read results", "With contact details" and (if the MCP pilot happens) "AI assistant (read-only)" as v6. Never `users.*`, `roles.*`, `integrations.*`, `organization.*`, `billing.*`. `hv_live_` + 32 random bytes, SHA-256 stored, shown once, header only, `/v1` only, one-year default expiry, revocable, two live during rotation; creating one needs `integrations.create`.
3. **Who may connect what:** `integrations.create/update/delete` (Owner, Administrator); Recruiters see the status and "Ask a workspace admin".
4. **OAuth client (E):** as v6 §11.1 item 4 (code + PKCE S256, one-time `state` on the `connecting` row, exact redirect URI, fixed narrow scopes, data-centre hosts from an allowlist, token requests as a form body, refresh under a try-lock, `invalid_grant` → `consent_revoked`, separate client ids per environment; the callback verifies `state` first and refuses an `accounts-server` that differs from the allowlisted host for `location`; FACT, https://www.zoho.com/recruit/developer-guide/apiv2/multi-dc.html; RFC 9700).
5. **Outbound:** bodies per the export rule; webhooks, when built, signed and through `SafeHttp`.
6. **No secrets or PII in logs or `last_error`** (FACT, `background_jobs.last_error` stores the exception message, `JobQueue.java` lines 149-153).
7. **Audit** (ids and counts only): `integration.connected`, `.updated`, `.taken_over`, `.disconnected`, `.reconnect_needed`, `.sync_completed`, `.candidate_adopted`, `.candidates_anonymised`, `.pushed` (with `content` flag); `api_key.created/revoked`; `api.*` writes; `authz.sensitive_access` for content reads through `/v1`, the feed and the CSV; `voice.session.content_erased`, `.provider_deleted`, `.provider_delete_failed`; `candidate.removed`. Every `authz.*` row stores the route template, never the query string, through one helper shared by `AuthInterceptor` and `HiringController` (FACT: both write path plus query today, `JAVA/authz/AuthInterceptor.java` line 52, `JAVA/hiring/HiringController.java` lines 65-72); a grep test bans `getQueryString` in audit code.
8. **Inbound webhooks (V2):** as v6 §11.1 item 8.
9. **Untrusted text** (machine-sourced job titles and descriptions). Lengths capped; the JD is create-only on every machine path. **Fence fix (Core, round 6 AM-1):** the hiring prompt fences the brief with `<<<ROLE` / `ROLE>>>`, but `ContextPacker.sanitize` neutralises only `<<<UNTRUSTED_DATA` / `END_UNTRUSTED_DATA>>>`, and the title is inserted raw (FACT, `apps/api-java/src/main/resources/usecases/hiring.json` line 86; `JAVA/rag/ContextPacker.java` lines 14-23; `JAVA/engine/CallContextCompiler.java` lines 178-182). Render the role block with `ContextPacker.fence("role", brief)` (or make `sanitize` neutralise the `ROLE` markers too), strip new lines and fence markers from the title, and add one merge-blocking test (a JD containing `ROLE>>>` plus an instruction, and a title containing a new line plus an instruction, both stay inside the fence). The prompt text changes the context hash, so each hosted agent re-syncs once at its next dial. **Human gate (SA-4):** agent linking stays human-only; on a job created by a key or copied from an ATS, the job page and the agent picker say "Created by your system" (or "Copied from Zoho Recruit") and "The agent speaks from this description; read it before linking an agent." `AdviceGuard` scrubs post-call text only; it does not guard live speech.
10. **Retention, erasure and DPDP**, before the **first external connection of any kind** (Core going live with E or Dev):
    - a decided retention period with a working daily purge (the 5-minute loop's database step) for pulled-but-never-called candidates and for call content;
    - **a person-facing removal.** The candidate sheet gains "Remove this person and their calls", gated by `candidates.delete` (FACT: Owner and Administrator only, `JAVA/authz/Permissions.java` lines 101-131; today only `apps/web/lib/api.ts` calls `deleteCandidate`, backed by `HiringController.java` line 485). `ConfirmDialog` copy, true in every case (round 6 UX-2): "Their recordings, transcripts and answers are deleted from HRVoice now, and we ask our call provider to delete its copy. This can't be undone." For an ATS-linked person it adds "They stay in Zoho Recruit. HRVoice won't bring them in again for this job." Audited `candidate.removed` with ids only;
    - **one erasure path** used by that action, by ATS or `/v1` deletion after the grace period (the `nightly` job), by the retention purge and by workspace deletion. First the erasure record (item 13); then, in one transaction, null transcript, summary and answers, set `content_erased_at`, delete the person's `integration_deliveries` rows; then an unlinked or `custom`-linked row removed in HRVoice is deleted (FACT: `voice_sessions.candidate_id` is `ON DELETE SET NULL`, so a plain delete would leave transcripts, backend map §6.3), and an ATS-linked row is anonymised in place with the keyed suppression hash and a cleared link (section 2.3). `Env` refuses to boot slice E without an `INTEGRATIONS_HASH_KEY` of at least 32 bytes that differs from every `INTEGRATIONS_KEYS` value. A `custom`-linked row anonymised after a `/v1` deletion gets a random `external_id`. `apply` returns at once when `content_erased_at` is set, and both its UPDATEs also carry `WHERE content_erased_at IS NULL` (FACT: two separate writes around an extractor call, `VoiceSessions.java` lines 505-551); `/recording` answers "no longer available";
    - **provider deletes** (`provider_delete:<org>`, a lane job, only while voice is on): `VoiceAgentPort.deleteConversation` for erased calls that still hold a conversation id, clearing the id on success (FACT: https://elevenlabs.io/docs/api-reference/conversations/delete; whether it removes audio, transcript and backups is unverified). A 404 counts as deleted; another 4xx (except 408, 429) is not retried: the id is cleared and `voice.session.provider_delete_failed` audited; a timeout, 429 or 5xx is retried on a later run. Each run handles up to 50 items, stops after 40 s or at the first timeout or 5xx;
    - **workspace deletion:** `DELETE /organization` writes the erasure record, sets `organizations.status = 'deleting'` (free text, no CHECK, FACT `MIG/0000_initial_schema.sql` line 61) and disconnects every connection (tokens revoked after commit); members and keys lose access at once through `membership`. The 5-minute loop's database step erases call content in batches of 500 rows; `provider_delete` deletes conversations, then calls `deleteAgent` for every `voice_provider_deployments` row and blanks its `external_agent_id` (each hosted agent's prompt holds the JD and company-document excerpts: FACT `CallContextCompiler.companyFacts`, `HostedVoiceAdapter.agentBody` lines 81-101; https://elevenlabs.io/docs/api-reference/agents/delete). When no conversation id and no agent id is left, or **7 days after the org entered `deleting`**, the database step runs the existing hard delete (FACT: today `Organizations.remove` hard-deletes at once, `JAVA/team/Organizations.java` lines 100-107, and the cascade drops every conversation id, so provider copies could never be deleted). `deleteAgent` runs only here, after the conversations are gone (round 6 EIA-1: what deleting an agent does to its conversations is undocumented);
    - **hard-delete check** (Core): one Testcontainers test hard-deletes an org with an agent session, a voice session and a ledger row (FACT: RESTRICT foreign keys on that path, `MIG/0013_elevenlabs_foundation.sql` lines 66, 70; `MIG/0025_call_cost_ledger.sql` line 50). ASSUMPTION from the PostgreSQL source (`ri_triggers.c`, `fire_triggers = false`): it passes. Not run. If it fails, the final hard delete becomes a runbook step run as the migrator role;
    - **provider-side retention as a backstop, never applied to existing data** (round 6 EIA-4): each hosted agent's conversation retention is set to our retention period plus 7 days **for new conversations only**. FACT: "By default, ElevenLabs retains conversation data for 2 years", configurable per agent, and "Reducing the retention period may result in immediate deletion of data older than the new retention period if you choose to apply changes to existing data" (https://elevenlabs.io/docs/eleven-agents/customization/privacy/retention); `agentBody` sets none today (lines 81-101). The setting goes into `agentBody` and the context hash only if a check on a test account shows the API applies it to new conversations only (unverified); otherwise it stays out of provisioning, an operator sets it by runbook, and the DPA says so;
    - a customer DPA whose sub-processor list names the voice provider, the telephony carrier (`twilio` or `exotel`, FACT `HostedVoiceAdapter.java` line 258), the LLM provider, hosting, object storage and SMTP. It says what the voice provider holds: recordings, transcripts, and hosted agents whose prompts contain job descriptions and company documents (one per agent version, re-synced only at that agent's next dial, so a deleted company document stays in it until then: FACT, `VoiceSessions.provisionLocked`, lines 154-219; deleted on workspace deletion). It says that provider deletion is requested, not confirmed, matching the removal copy. It says that audit rows are kept, including any free-text stage reason (FACT: no UPDATE on `audit_events`, `MIG/0003_rls_hardening.sql` line 51), that rows written before slice 0 may contain board search terms, and how long backups keep erased data;
    - **finding one person across jobs** for an erasure request (round 6 SA-6): until an admin lookup exists, founder decision 9 and the DPA state how such a request is handled (an operator search by phone or email across the workspace's jobs, closed ones included, then "Remove this person" on each row);
    - a breach runbook.

    ASSUMPTION: we act as a DPDP data processor; needs a lawyer.
11. **Voice-provider webhook:** as v6 §11.1 item 11.
12. **Ingress:** as v6 §11.1 item 12 (Caddy overwrites `X-Forwarded-For`; the Java port only behind Caddy; `/v1` only on `API_PUBLIC_HOST`, enforced in Java; Caddy's `/backend/v1/*` 404 as defence in depth; FACT, the Next rewrite is unconditional, `apps/web/next.config.mjs` lines 15-23).
13. **Database restore** (Core; the feed epoch with Dev). A `pg_dump` restore or point-in-time recovery (FACT, both planned, `BRD's/10_ADRs/ADR-006-hosting-deployment.md`, "Database progression") would bring back people erased after the backup.
    - Every person-level erasure and every workspace deletion first writes one object to the existing object storage, **before its database transaction opens** (an intent record; re-applying an erasure is idempotent, so a record for an erasure that then failed is harmless). Key `<org>/erasures/<candidateId>` or `<org>/erasures/workspace`, matching `ObjectStorage`'s `<org>/<key>` layout, with ids and the suppression hash only (FACT: `objectKey` = org + "/" + key, `JAVA/knowledge/ObjectStorage.java` lines 63-73). Explicit S3 timeouts. A failed write fails the removal, and the person tries again. The retention purge needs no record: it runs by date and runs again after a restore.
    - Core adds `ObjectStorage.list(org, prefix)` (FACT: today only `put` and `get`, lines 81-99).
    - Gate P requires the Java service to use `STORAGE_BACKEND=s3` (R2), so the records live off the database host (FACT: Java defaults to local disk, `JAVA/platform/Env.java` line 98; the Nest services in `docker-compose.prod.yml` set `s3`).
    - After any restore, before the service starts, an operator runs `java -jar api-java.jar --spring.main.web-application-type=none --desk.reapply-erasures` with `AUTOMATION_PAUSED=true` and `JOBS_ENABLED=false` (the `--desk.reembed` CLI pattern, FACT `JAVA/rag/EmbeddingSwitch.java` lines 157-162; `JOBS_ENABLED`, `Env.java` line 113). It iterates the organisations in the restored database and re-runs the erasure path for every record under `<org>/erasures/` (a workspace record puts the org back into `deleting`). Dev also bumps `EVENTS_EPOCH`, so feed cursors get `410`. Then the service starts normally.
    - ATS sends need no reset: restored delivery rows and links are consistent with each other, and note markers stop duplicates.

**Merge-blocking tests** (one each):
- RLS drift for new tables.
- `Sealer` round trip; wrong AAD and wrong key version fail; boot refuses a missing current key.
- The forbidden-field, export-rule and evaluative-corpus test (section 6.2).
- **Prompt fence:** a JD with `ROLE>>>` plus an instruction, and a title with a new line plus an instruction, stay inside the fence in the compiled prompt.
- **Lost provider webhook** (connected org): the session is ended or stuck `active` with no result; `fetch_results` reconciles it; one note (E) or one `call.ended` (Dev) follows. A connected call with no user turn gives `no_conversation`; with the provider unreachable, `result_unavailable` after the deadline.
- **Fetch budget:** `FakeVoice.fetch` times out; the run stops at the first timeout; the tick and `JobQueue.poll` run on time.
- **No backlog:** an org with 7 days of settled calls connects; nothing is sent for them; a call ending afterwards is sent once.
- **One item never blocks another:** `FakeAts` returns 500 for call 1's note forever; notes for calls 2..n are delivered; call 1 is retried with growing gaps and marked `expired` after 7 days. With every note failing, each run stops at its first failure and nothing is marked failed before 7 days.
- **Permanent refusal:** a 422 for one note marks it `failed`, and the next note is sent in the same run.
- **Versions:** after a "Result unavailable" note, a late transcript writes one "Updated result" note; a summary filled later writes nothing; a hash that changes during a send leaves the row `pending`, and the next run writes the newer note once.
- **Erased between discovery and send:** nothing is sent and the row is gone. **Dev:** an erasure between the sweep's scan and its update emits nothing.
- **Unlinked person on a linked job:** no delivery row, no note.
- **A dial with no conversation id** produces no note and no `call.ended`.
- **Baseline:** link a job with 10 declined candidates, turn on write-back: zero `setStage` calls (`FakeAts`).
- **Undo:** decide, undo within 10 s: no ATS write (`FakeAts`). Dev: the feed, read after the hold, shows the decision with `superseded: true`; decide, Undo, decide again gives exactly one actionable event.
- **Our own write is not "changed in the ATS"**, and **stage push after a crash** records the push and writes no note (as v6).
- **Decider name:** the comment uses the display name from the audit row; with the row missing or the name empty, "a team member"; never an email.
- **Dev ordering and purge:** two concurrent emits commit out of order and a poller sees both in order; an event younger than 2 minutes is not returned; after a quiet month a new event gets a `seq` above every earlier one; a cursor below the oldest retained `seq` minus one gets `410`; two concurrent identical stage changes emit one event with the right `from`.
- **Keys survive delivery failure:** with the ATS sender failing, a key still gets `200` from `PUT /v1/candidates/by-external/...` and `GET /v1/events`.
- **API-key audit:** a PII read writes `authz.sensitive_access` with the creator and `metadata.apiKeyId`; a failed audit write returns `503` with no content; a key whose creator was removed, is suspended, or whose workspace is `deleting` gets `401`; `isOwner()` is false; the default key cannot `PUT /v1/jobs/by-external`.
- **Erasure:** anonymise a candidate; `FakeVoice.deleteConversation` is called; `/recording` is refused; a replayed provider webhook neither refills content nor calls the extractor. A 404 on delete counts as done.
- **Workspace deletion:** members lose access at once; `deleteConversation` for every call, then `deleteAgent` for every deployment; the org is gone afterwards. With voice off, the content erasure and the 7-day hard-delete fallback still run.
- **Hard delete** of an org with an agent session, a voice session and a ledger row.
- **Linked fields:** editing an ATS-linked phone is refused with `candidates.managed_externally` while connected, allowed after disconnect.
- **Removing a linked person:** anonymised, content deleted, the next `FakeAts` pull does not import it again (`removed_in_hrvoice`); the link is cleared; no send reaches it. **Reconnect** reuses the connection row and keeps the suppression.
- **Closed in the ATS:** an application rejected in `FakeAts` is marked closed by the next pull, and a Call click for that person is refused by `dialLocked`.
- **Callback host:** a forged `accounts-server` is refused and nothing is sent to it.
- **Isolation:** a slow ATS does not delay an email job or the tick; one org with 200 due notes does not delay another org's first note beyond one lane pass.
- **One outcome vocabulary:** a silent pickup is `no_conversation` on the board, in the results CSV and in the ATS note.
- **`/v1` origin:** `/backend/v1/events`, `/%62ackend/v1/events` and `/v1/../jobs` with a valid key never return `200`; a cookie on a `/v1` handler and a bearer key on a cookie handler are ignored.
- **MCP Origin** (when built).
- **Results CSV:** without `candidates.read_pii`, name and job title; with it, a file that re-imports with no issues.
- **Zoho:** the sample HTML `Job_Description` arrives as plain text; a 200-record page with long resume text is read in full (SA-3).
- **Restore:** after `--desk.reapply-erasures`, a person erased after the backup is erased again; a feed cursor from the old epoch gets `410` (Dev).
- No token text in `last_error` after a failed refresh.

### 11.2 Enterprise (Later, only when a deal requires it)

As v6 §11.2: KMS envelope encryption once hosting moves to AWS `ap-south-1`; customer-managed keys; SSO/SAML; IP allowlists on keys; a static egress IP; an egress proxy in front of `SafeHttp`; rungs 4-5 under a signed DPA.

---

## 12. Onboarding flow

All in one new Settings tab, **"Connected systems"**, shown with `integrations.read`; buttons need `integrations.create/update/delete`. Status uses the "Calling number" card pattern (FACT, `apps/web/components/settings/sections.tsx` lines 238-318). The server returns stable codes and the web maps them to sentences, because `apps/web/lib/errors.ts` (line 77) discards messages containing "webhook", "token", "api key" or "payload". Before shipping: rename the agent page's "Integrations" group for test tools (FACT, `apps/web/app/agents/[id]/page.tsx` lines 700-735); unhide the Integrations permission group (`apps/web/components/settings/access.ts` line 109).

**Definition of done for every integration slice:** the website FAQ answer on ATS integration (FACT, "Not yet", `apps/web/components/site/faq.tsx` lines 53-55) and the Tools page "Your own systems: Later" card (`apps/web/app/tools/page.tsx` lines 106-119) say exactly what works after that slice, and nothing more (FACT, launch spec anti-pattern line 88). Before the Connected systems tab is built, the founder sees headless screenshots at 1440 and 390 px of the Connected systems card in its states, the "Remove this person and their calls" dialog, the per-call delivery line, the "Created by your system" job note and the new call states (`no_conversation`, `result_unavailable`, `content_erased`); the founder chooses looks from images, not text.

### 12.1 "Your own system" (Dev slice; for a developer or an iPaaS user)

1. **Create a key.** Name it, pick one preset (default "Send candidates in"; checkboxes "May create jobs" and "May remove people"). Shown once with a copy button, the base URL and a link to the reference script. A script that both sends people in and reads results uses two keys, "Send candidates in" and "Read results"; the key screen, docs and script say so.
2. **Read results.** How to poll `GET /v1/events`; the reference docs, including that a person must link an agent to each new job before anyone can call, and the "treat as data" line (section 6.6).
3. **Status card:** each key's "Last used 3 minutes ago", "Expires on …", or "Needs attention: the person who created this key no longer has access".

### 12.2 "Zoho Recruit" (slice E; for a non-technical admin)

| Step | What the person sees | What we decide |
|---|---|---|
| 0 | Empty state: "Bring candidates in from the hiring system you already use, and send each call's results back to it." Only systems that really work are listed | |
| 1 | "We'll read" (the job openings you pick and their candidates: name, mobile, email, resume text, status) / "We'll write" (a note after each call with the answers; their status only if you turn that on). "We never send a score or a recommendation." | Scopes, fixed and narrow |
| 2 | Redirect to Zoho; sign in; approve. India data centre handled from the response | |
| 3 | Pick jobs (none pre-ticked); link each to an existing HRVoice job, or create a new job with the title and the full JD. Beside each link: "People from <Zoho job> will be called with <HRVoice job>'s questions." | A link is pre-selected only on a single exact, case-insensitive title match; HTML converted to plain text |
| 4 | "Bring people in when their status is …", read live | Pre-select the first status containing "new", "screen" or "applied", else nothing |
| 5 | "Send decisions back?" switch, **off**; when on, pick the status for "Moved forward" and for "Not moving forward", with "Decisions you make from now on are sent 2 minutes after you make them, so you can change your mind. Earlier decisions are not sent." | Note write-back is always on |
| 6 | "Check the connection": read-only; "We can see 3 jobs and 41 people at Applied" (names only for holders of `candidates.read_pii`) | |
| 7 | "Start bringing people in" → "New people will show up on your jobs within 15 minutes, ready to call. Results of calls with people from Zoho Recruit are sent back to it." Then each newly created job with "Read the description, link an agent (needed to call) and add must-ask questions (recommended)" and "Copied from Zoho Recruit. The agent speaks from this description." The agent is pre-selected (not linked) when the workspace has exactly one published agent; a person confirms | FACT: a job without an agent cannot be phoned (`HiringController.java` line 352) |

The card label: first `status` (`connecting` → "Finish connecting"; `needs_attention` → **Needs attention** with its reason and Take over; `disconnected` → **Not connected**); then `rate_limited_until > now()` → **Paused until 4:10 pm**; otherwise **Connected** ("Last checked 4 minutes ago. 3 jobs linked. Connected by Priya."). Separate lines: "Couldn't send since 10:40" with Retry (admins); "1 call result couldn't be sent to Zoho Recruit. Open it in HRVoice."; "N call results from before 3 Nov couldn't be sent"; "3 people couldn't come in: number not valid. Fix them in Zoho Recruit." with Sync now; "2 people removed in Zoho Recruit will be anonymised on 10 Oct"; "1 person removed in HRVoice is still in Zoho Recruit and was not brought in again". Disconnect confirms with `ConfirmDialog` and keeps everything already in HRVoice.

Day to day:
- board rows say "From Zoho Recruit" and show the remote status read-only; imported people sit on the job's board ready to call, like people added by hand;
- linked contact fields are read-only with "Edit this in Zoho Recruit" (enforced by the server);
- people closed or removed in the ATS show "Closed in Zoho Recruit", are left out of every action queue on Home and the board, and cannot be called; a "Closed or removed" filter still finds them;
- a linked job's description shows "Copied from Zoho Recruit on 3 Oct. Later changes there are not copied; edit it here.";
- the Add and Upload dialogs on a linked job say "People you add here stay in HRVoice and are not sent to Zoho Recruit.";
- under each call with a linked person, a delivery line from its delivery row: "Sent to Zoho Recruit at 11:02", "Waiting to send" or "Couldn't send" (Retry for admins);
- the decision footer says "Also sets their status in Zoho Recruit to '<their label>' in 2 minutes" when write-back is on; the existing bulk **decision** buttons and their Undo toast say "N of these will also be set to …" when the selection includes linked people;
- Settings > Activity gains plain sentences for connects, imports and sends;
- **question wording hint (every customer, slice 0):** a soft warning on evaluative must-ask wording ("rate", "score", "out of", "/10", "suitable", "confident", plus the use case's advice patterns), suggesting a factual question. Web only; nothing is blocked (FACT why: the extraction instruction is 'Extract the candidate's clear answer to: "{{question}}"', `usecases/hiring.json`).

Open: whether the customer's system name may appear in the UI (founder decision 8). This draft assumes yes.

---

## 13. Scope

### 13.1 MVP, in order

Effort is for one engineer and is an ASSUMPTION, for ordering only.

| Slice | Contents | Gate | Effort |
|---|---|---|---|
| **P. Java in production** | A Java image and Compose service; Caddy routes `/backend/*`, `/webhooks/*`, `/health` and `/api/auth/*` to Java (and later `api.<domain>/v1/*`); `TRUST_PROXY=true` only there; Java uses `STORAGE_BACKEND=s3` (section 11.1 item 13); the supervised live checks already listed in `apps/api-java/MIGRATION_STATUS.md` (one phone screen, one browser screen), **with fixing the hosted voice adapter in scope**, because it has never run live (FACT, `MIGRATION_STATUS.md` lines 89, 353); one external uptime monitor with a keyword check on `/health`, wired to the founder's phone or email (FACT: ADR-006 lists "monitoring with alerting" as our obligation; none is configured). Rollback: point Caddy back at `api:3001` | The founder accepts ADR-008, or decides to run Java in production while it stays PROPOSED | 3-5 days |
| **0. Prerequisites** | E.164 stored form and `toE164` fix (read-only collision query; an operator merges or removes collisions; the backfill refuses to run while any exist; web screens show and accept the stored form). `CallOutcomes.outcome` used by the app and every body. `ExternalPayloads` + its merge-blocking test; the adapter's `rationale` fix; `criteriaSource`; `hiring.json`'s `new` label "No decision yet"; `authz.*` audit rows store the route template; the question wording hint | Gate P (Nest stores phones as typed, so the backfill runs once Java serves production) | 4-6 days |
| **A. Results CSV export** | Section 6.7 | Gate P | 1-2 days |
| **G. Phone calling for self-serve workspaces** (pre-existing risk, not integration work) | Recorded here as a launch gate and founder decision 15; **not designed further in this plan**. Today anyone can register, which creates a workspace at once with an unverified email (FACT, `JAVA/auth/BetterAuthController.java` lines 85-113; `apps/web/app/login/page.tsx` line 5), a missing `usage_limits` row means no budget limit (FACT, `JAVA/cost/BudgetGuard.java` lines 45-58), and every workspace dials through one provider account and one calling number (FACT, `HostedVoiceAdapter.java` lines 47-49, 253-256). The item: (1) phone calling is off for a workspace until an operator turns it on (Security's sketch: an env allowlist checked in `dialLocked`, code `calls.not_enabled`); (2) the acting person's email is verified to dial (and, from Dev, to create an API key); (3) workspace creation inserts a default `usage_limits` row; (4) the destination allowlist agreed in v6, `VOICE_DIAL_COUNTRY_CODES` (default `91`), checked in `dialLocked` only, with the carrier's geo-permissions limited to the same list. One test: a new, unverified, not-enabled workspace gets `calls.not_enabled` and nothing reaches `FakeVoice.dial` | Founder decision 15; before production lets a self-registered workspace place phone calls (whether Nest allows that today is unverified) | 1-2 days |
| **Core** | Migration (`integration_connections`, `job_links`, `candidate_links`, `voice_sessions.content_erased_at`, `source` values, `integration` kind); the integration lane; the 60-second tick; `fetch_results`; the erasure path, "Remove this person", `provider_delete`, workspace deletion with `deleteAgent`; the erasure record, `ObjectStorage.list` and `--desk.reapply-erasures`; the hard-delete test; the daily retention purge in the 5-minute loop; `AuthResolver.membership` status checks; the prompt fence fix; `actions.integrations`; `AUTOMATION_PAUSED`; the connection-pool check | Built **together with** the first of E or Dev, never on its own. Gate P, ADR-010 written, and **Nest no longer routed in production** (FACT why: Nest lacks the erased-content guard in `apply`, the closed-row dial block, the linked-field edit guard and erasure on removal; `apps/api/src/providers/elevenlabs/voice-session.service.ts`; backend map §19) | 2-3 weeks |
| **E. First named connector** | `Sealer`, `INTEGRATIONS_HASH_KEY` and the pull suppression, OAuth client with the callback-host rule, `ZohoRecruitAts` + `FakeAts` with the vendor HTTP limits, pulls, nightly job, deletions with confirmation and re-link, anonymisation, the dial block for closed rows, `integration_deliveries` with discovery and `send`, notes, opt-in stage write-back from a baseline, read-only linked fields, closed rows out of every queue, HTML job descriptions to text, the 7-step UI | A pilot confirms Zoho Recruit (or names its system) | 4-5 weeks; **Core + E about 6-8 weeks**, the number to use before giving any pilot a date |
| **Dev. Developer surface** | `api_keys` and the `AuthResolver` branch chosen by handler, `API_PUBLIC_HOST`, seven `/v1` routes, per-key limit and daily row cap, ingress checks, **the event log** (`integration_events`, `Events.emit` with the per-org lock and `seq`, the stage outbox, the `call.ended` sweep with `result_emitted_hash`, the daily purge, `superseded`, `EVENTS_EPOCH`), the feed with its starting cursor, OpenAPI file, reference script, "Your own system" UI, "via API key" in Activity | A pilot confirms it will connect through its own developer or an iPaaS (FACT, `docs/integrations/01-comparison.md` line 107) | about 3 weeks; Core + Dev about 5-6 weeks |
| **Webhooks** | `Sealer` (unless E shipped it), `SafeHttp`, Standard Webhooks signing and rotation, per-(endpoint, event) delivery rows, test event, delivery list, sealed URL, the stage-event hold | The Dev pilot says polling the feed is not enough | about 1 week |

Launch gates: gate P before any slice reaches production; item G before self-registered workspaces can place calls; the retention, erasure and DPDP items of section 11.1 item 10 before the first external connection; Nest no longer routed in production before Core. Quote pilots only the Core + E figure, and only after gate P's live calls have worked (round 6 CR-4).

**Build documents.** Before a slice starts, write ADR-010 (at most 2 pages, lifted from section 18) and that slice's build sheet with only its own rules and merge-blocking tests. Sheets: P, 0, A, G, and Core + E or Core + Dev.

### 13.2 V2

- A second connector chosen by pilot data (Keka Hire, Workable).
- **A Google Sheet connection** for pilots who live in spreadsheets, sized as its own slice, not an `AtsPort` adapter (as v6 §13.2; source `docs/integrations/research/05-product-ux-architect.md` section 5; scope https://developers.google.com/workspace/drive/api/guides/api-specific-auth).
- **Bulk calling** ("Call selected (N)"), only after its own design and review: `later-bulk-calling.md` (NOT APPROVED).
- Per-job "Call new people automatically", only after bulk calling exists and a written founder decision with legal advice (FACT: TRAI TCCCPR Second Amendment, https://trai.gov.in/sites/default/files/2025-02/Regulation_12022025.pdf; applicability to screening calls unverified).
- A workspace do-not-call list and an admin lookup of one person across jobs, if founder decision 9 wants them.
- Inbound vendor webhooks as re-fetch hints.
- Our own call summary, if a pilot wants summaries in the ATS or the feed.
- Sending decisions made before write-back was switched on, as an explicit choice.
- Leaving ATS-decided rows out of "Ready for review", if pilots find the queue noisy.
- Our own Zapier app; SNS and Pub/Sub envelopes; per-key limits in Postgres once there is more than one replica; a per-call "Send again" for a `failed` note; a "Cancel removal" button for pending `/v1` removals; on disconnect, a confirmed "Also remove the people who came from this connection"; a checksum suffix on API keys.
- `apiKeyId` merged into service-level audit rows automatically (round 6 SA-2), if Activity attribution for key actions becomes a customer need.

### 13.3 Long term (Later)

Our own MCP server (section 8); a Kombo or Merge `AtsPort` once three or more ATSs are requested by paying customers; Greenhouse and Lever via partner programmes; Darwinbox; enterprise rungs 4-5; in-call tools (section 7); section 11.2; a CRM contact/deal shape when SalesVoice or SupportVoice need it.

### 13.4 Avoid

In-call MCP; MCP-based sync; direct DB access beyond the paid read-only exception; CDC; consuming customer brokers; our own on-prem agent; hosted SFTP; SDKs and widgets; a rules builder; a cross-vendor canonical schema or field-mapping editor; two-way editing of the same field; auto-rejecting people who did not answer; writing any score, coverage, rank, "qualified", vendor-written summary or system-chosen stage anywhere outside; Freshteam and Naukri RMS connectors.

---

## 14. First real integration and how to test it without buying anything

### 14.1 Choice

- Slices 0 and A help every customer now; item G protects every customer's calling.
- **Zoho Recruit is the first named connector** if a pilot uses it: self-serve OAuth, an India data centre, a documented REST API with incremental polling, and a free plan with API access. The evidence that Indian SMBs use it is vendor-written, so the founder confirms with pilots first.
- The developer surface is first only if a pilot has a developer or an iPaaS.

### 14.2 Testing without buying anything

- **Automated:** the existing JUnit 5 + Testcontainers suite plus the merge-blocking tests in section 11.1, using `FakeVoice` (lost webhook, stuck `active`, silent call, unreachable provider, delete conversation, delete agent) and `FakeAts` (baseline, Undo, rename, rate limit, deletion confirm, always-failing note, 422, large page).
- **Manual push-in:** `curl` and the reference Python script against a local Java API. **Pull-out:** the reference script polling `/v1/events`.
- **iPaaS path:** self-hosted n8n, free edition, polling the feed (FACT, https://docs.n8n.io/deploy/host-n8n).
- **Zoho:** a Zoho Recruit Free account in the India data centre (FACT: 1 active job, 5,000 API credits a day, no webhooks, https://www.zoho.com/recruit/plan-comparison.html); one Web-Based OAuth client per environment (https://www.zoho.com/recruit/developer-guide/apiv2/register-client.html); 5-10 test candidates using team members' own numbers with their consent.
- **Voice provider, on a test account:** whether a retention setting can apply to new conversations only (section 11.1 item 10).
- **Spreadsheets:** open the results CSV in Excel (Windows) and Google Sheets, with a Hindi answer and phone numbers.

Not testable for free: Zoho webhooks; custom-status behaviour on paid plans; Keka, Greenhouse, Lever, Darwinbox.

---

## 15. Risks

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R1 | Pilots do not use Zoho Recruit (or any ATS); a connector is built for nobody | Medium / High | E and Dev both gated on a pilot; 0 and A serve everyone |
| R2 | Duplicate notes in a customer's system | Medium / High | One delivery row per (connection, call) with a compare-and-set on its hash; the note marker carries the rendered hash and is checked before every write; no backlog on connect |
| R3 | Advice or a score leaks into an ATS, or into a live call | Medium / High | No summary leaves; answers from the job's own questions only (`criteriaSource`), never `rationale`; scrub as backstop; evaluative-corpus test; no generic write. Live calls: the prompt fence fix and human agent linking for machine-created jobs. Residual: a recruiter's evaluative question ("Rate their English 1-10") yields a model's judgement as the "answer"; the wording hint reduces this |
| R4 | Duplicate candidates and misdialed numbers from automated intake | High / High | E.164 with the collision pre-check (slice 0) |
| R5 | A connection silently stops | Medium / High | `needs_attention` with a reason, one email, "last checked", Take over; failed and expired lines; per-call delivery line |
| R6 | We exhaust a small customer's Zoho daily credits | Medium / Medium | Budget with write reserve, `If-Modified-Since`, polling slows first, "Paused until" |
| R7 | SSRF from a customer-supplied URL | Low until webhooks / High | Webhooks deferred; `SafeHttp` when built |
| R8 | PII sprawl and DPDP exposure | High / High | Field allowlist; ids-only rows; bodies built at send time; one erasure path that reaches the provider; retention gate before any external connection; DPA; runbook |
| R9 | Pressure to auto-call imported candidates before consent and DND are settled | High / High | Every call still needs a person's click on one candidate; bulk calling is a separate, unapproved design; auto-call is V2 behind decision 10 |
| R10 | Nest and Java run side by side | Medium / Medium | Slices 0 and A need no migration; Core goes live only once Nest is no longer routed in production |
| R11 | Stage drift: a customer renames a status | Medium / Medium | Status list read live; unmapped → `status_unmapped`, stage pushes stop, notes continue |
| R12 | The public API becomes a promise we cannot change | Medium / Medium | Seven routes, versioned path, public decision values, documented feed semantics |
| R13 | Failures are invisible | High / Medium | Per-connection status, per-call delivery line, failed and expired lines, an external uptime monitor on `/health`. Ceiling: a hung tick or lane thread is not alerted on by itself (heartbeats removed with the dial thread); `ponytail:` add a heartbeat for the tick if a hang is ever seen |
| R14 | Vendor API churn | Certain over time / Medium | One connector until it has paying use; vendor code inside one adapter |
| R15 | A customer's own LLM ranks candidates, or is steered by text, from data we export | Medium / Medium | Factual bodies without summaries; content only under the export rule; the MCP preset carries no content; the "treat as data" line in the reference docs; MCP results as `structuredContent` (round 6 AM-2) |
| R16 | The hosted adapter's fetch path has never run live, and background fetch depends on it (FACT, `MIGRATION_STATUS.md` lines 89, 353) | Medium / High | Gate P live checks with the adapter fix-up in scope; `FakeVoice` tests; `result_unavailable` after 90 minutes |
| R17 | One tenant's slow vendor delays others | Medium / Medium | Lane with one job per org per pass, per-run budgets, per-item backoff, vendor and customer HTTP timeouts |
| R18 | **Pre-existing, unchanged by this plan.** A call runs with another job's script: one hosted agent per agent version is re-synced to the job being dialed (FACT, `VoiceSessions.provisionLocked`, `environment = 'test'`, lines 154-219), so a near-simultaneous dial for another job on the same agent can change what a live candidate hears, if the provider binds a call's config when it is answered (unverified) | Low-Medium / Medium | Outbound answers are keyed by the question label (FACT, `Coverage.key(label)`, `JAVA/engine/CallContextCompiler.java` line 206) and read against the call's own snapshot, so another job's answers cannot leave under this job's questions; they show as "not answered". The fix (one hosted agent per job) is part of the bulk-calling design |
| R19 | Erasure at the voice provider is incomplete (backups, retention) | Unknown / High | Documented conversation delete, including on workspace deletion; provider retention backstop for new conversations; removal copy says "we ask"; DPA |
| R20 | A workflow acts on a decision that was undone | Medium / High | ATS write-back reads current state after a 2-minute hold from `candidates.updated_at`; the feed's hold plus `superseded` |
| R21 | One note the vendor always refuses with a transient error | Low / Medium | Per-item backoff; it moves behind the others; `expired` and shown after 7 days |
| R22 | **Pre-existing.** Self-registered workspaces place real calls on the shared provider account and number; abuse could get the number blocked for everyone and run up spend | Medium / High | Item G and founder decision 15 |
| R23 | Production still runs only Nest, so none of this reaches customers | Certain until gate P / High | Gate P |
| R24 | A database restore brings back erased people | Low / High | Erasure records outside Postgres; `--desk.reapply-erasures` before the service starts; `EVENTS_EPOCH` (Dev) |
| R25 (new) | "Connect once" still leaves one Call click per imported candidate | Certain / Medium | Imported people appear on the board ready to call; bulk calling designed and reviewed separately (`later-bulk-calling.md`) |

---

## 16. Founder decisions needed (details and evidence in `01-comparison.md`)

1. Where do the first five pilots keep candidates: in an ATS (which one), in their own system with a developer or a paid iPaaS, or in Excel or Google Sheets? **This picks one of three branches:** E, Dev, or, for spreadsheets, nothing beyond 0 and A in the MVP ("connect once" not met until a Google Sheet slice) (D1, D4).
2. Is pickup within about 15 minutes acceptable, and how many jobs does a pilot keep open? (D5, D6)
3. May keys carry answers, and only by explicit admin choice under the export rule? (D7, D8)
4. What goes into the ATS note? **Default: outcome, answers and a sign-in link, no summary.** (D9)
5. Is it acceptable that ATS-linked contact fields are read-only in HRVoice? (D10)
6. May a stage change ever come from another system rather than a named person in HRVoice? (D11)
7. May "Not moving forward" set a reject status in the ATS (which may email the candidate), given the 2-minute hold and that earlier decisions are never sent? (D12)
8. May the customer's own system name ("Zoho Recruit") appear in the UI?
9. Retention period for pulled-but-never-called candidates and transcripts (and whether the purge of a never-called ATS person stops the next pull bringing them back); the grace period before anonymising people deleted in the ATS or through `/v1`; DPDP processor role; DPA; how long backups keep erased data; whether "Remove this person" should stop that number being called for every job (a do-not-call list); and how an erasure request for one person across jobs, closed ones included, is handled until an admin lookup exists (D17).
10. Automatic calling of imported candidates: yes or no, and under what consent, hours and DND rules? (needs legal advice)
    - **10a (moved).** "Call selected (N)" is no longer asked in this plan; see `later-bulk-calling.md`.
11. Price per SMB customer and whether "data stays in India" is a sales promise. (D19)
12. Will support and sales use cases reuse `jobs`/`candidates` or get their own tables? (D18)
13. Is it acceptable that a key stops when the person who created it leaves, and that ATS sending stops until an admin takes the connection over?
14. (outside integration scope) The in-app summary is also the voice provider's summary. Should HRVoice generate its own?
15. **(new; item G, a risk that exists today)** Who may place real phone calls on the shared number: (a) does an operator turn calling on per workspace before its first call; (b) must the acting person's email be verified; (c) what default monthly usage limit does a new workspace get; (d) does any pilot call outside India (the dial allowlist defaults to `91`)? And when does this gate apply: now, or at gate P at the latest?

---

## 17. Unverified items to check during the build

- Whether the workspace hard delete passes the RESTRICT foreign keys (one Core test).
- Whether a hosted agent's conversation retention can be set for new conversations only through the API, and its field name; whether the provider's conversation delete removes audio, transcript and backups; what deleting an agent does to its conversations (we delete agents only after their conversations, so this is not relied on).
- When the voice provider binds a phone conversation's configuration (dial or answer) (R18).
- Whether Zoho renders note content as HTML.
- Whether one Zoho `If-Modified-Since` call covers applications across all linked jobs; Zoho Change Status with `jobids` for custom statuses; Zoho data-centre token hosts for Indian accounts; whether Zoho notes can be listed cheaply for the marker check; whether Zoho deletes a record when merging duplicates.
- How long after a call the provider's post-call webhook usually arrives (the 3-minute settle and 90-minute deadline are guesses until live calls are measured).
- Whether the voice provider re-signs retried webhooks with a fresh timestamp.
- How Excel and Google Sheets show the CSV phone format.
- Which MCP hosts accept a static bearer header; whether iPaaS hook URLs act as bearer secrets.
- Whether production (Nest) lets a self-registered workspace place calls today (item G).
- Keka Hire write endpoints; Merge and Kombo data location; DPDP Rules wording against the Gazette.

## 18. ADR-010 contents (to lift verbatim)

Every rule below is stated, with its evidence, elsewhere in this document.

**Gates**
1. Gate P: Java serves production before any slice ships there; it includes the adapter fix-up, one external uptime monitor and S3 object storage for Java (sections 11.1, 13.1).
2. Core is built only together with E or Dev, after ADR-010 is written, and goes live only once Nest is no longer routed in production (section 13.1).
3. The retention, erasure and DPDP items go live before the first external connection (section 11.1 item 10).
4. Item G (founder decision 15) before self-registered workspaces place calls (section 13.1).

**Tenancy and identity**
5. Every new table: forced RLS on `organization_id = current_org_id()`, listed in `StructuralTest`; no bypass; the tenant comes only from server state (section 10).
6. API keys work only on `/v1` handlers, only as a bearer header, only on `API_PUBLIC_HOST`; the principal type is chosen by the matched handler; effective permissions = key ∩ creator's live permissions; `AuthResolver.membership` checks the user, the workspace and the membership (sections 6.6, 10).
7. Code reachable from `/v1` never re-reads `role_permissions` (section 10).
8. Workers run `inOrg(org, Db.NIL)` and audit with a NULL actor (section 10).

**Product rule**
9. Only `ExternalPayloads` builds outbound bodies: no summary; no score, coverage, rank or recommendation; answers only to the job's own questions, scrubbed, plain text; public decision values; display names, never emails; one export rule (section 6.2).
10. Only a person's decision moves an ATS status: opt-in, after a 2-minute hold, from a baseline, reading current state, checking "already at target" first (section 7).
11. Machine-sourced job titles and descriptions are fenced and cleaned before they reach a prompt; agent linking stays human-only (section 11.1 item 9).

**Delivery (Core + E)**
12. Outbound to an ATS is level-triggered: one `integration_deliveries` row per (connection, call) and per (connection, candidate) for stages; no order is promised; each item backs off on its own; a run stops at the first transient failure; an item unsent after 7 days is marked `expired` and shown (section 6.1).
13. A call is settled when it has a failure reason or a transcript, or 90 minutes have passed; one `CallOutcomes.outcome` serves the app and every body; a dial with no conversation id never leaves (section 6.1).
14. Erased calls never leave: discovery, the sender and the Dev sweep's update all require `content_erased_at IS NULL` (sections 6.1, 6.5).

**Events (Dev only)**
15. In an org with a feed, every emitting transaction takes the org events lock as its first statement; lock order: the events lock, then the job row, then candidate rows (section 6.5).
16. `seq` is per org with `created_at = clock_timestamp()` after the lock; the purge cuts below a `seq` boundary and always keeps the newest event; `410` when the cursor is below the oldest retained `seq` minus one; cursors carry `EVENTS_EPOCH`; a stage event followed by a later one for the same candidate is `superseded` (section 6.5).

**Calls and background work**
17. Every dial goes through `dialLocked` and its existing guards, plus the closed-in-ATS block; this plan adds no bulk or automatic dialing (sections 5, 10).
18. The tick and the 5-minute loop do database work only; every vendor and provider HTTP call runs on the integration lane, with a per-run budget, stopping at the first timeout or 5xx (sections 6.1, 6.8).
19. `AUTOMATION_PAUSED` stops the tick and the lane (section 11.1 item 13).

**Data protection**
20. One erasure path. `apply` returns early for erased calls. An anonymised ATS link keeps only its suppression hash. Connection rows are never deleted while the workspace exists. Every person-level erasure and workspace deletion is recorded outside Postgres before its transaction and re-applied after a restore, before the service starts. Agents are deleted at the provider only on workspace deletion, after their conversations. Provider retention is never applied to existing conversations (section 11.1 items 10, 13).
21. Audit rows store route templates, never query strings; audit rows are kept, and the DPA says so (section 11.1 items 7, 10).
22. Until Nest is no longer routed in production, migrations only add things Nest ignores (R10).
