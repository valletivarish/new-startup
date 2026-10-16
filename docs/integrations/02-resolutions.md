# Integration architecture: review resolutions

Each round lists every reviewer objection, the decision, why, and what changed in the draft. Labels as in the drafts: **FACT** (source), **RECOMMENDATION**, **ASSUMPTION**, **unverified**. `JAVA/` = `apps/api-java/src/main/java/desk/`, `MIG/` = `packages/db/drizzle/`. Research and writing only: no code, config, migration or test was changed.

## Round 1

Date: 2026-10-03. Input: `architecture-draft-v1.md` and seven reviews, all "block". Output: `architecture-draft-v2.md`.

Reviewer codes: **IA** Integration Architect, **AM** AI Agent / MCP Architect, **EIA** Enterprise Integration Architect, **SA** Security Architect, **UX** Product / UX Architect, **BE** Backend / Distributed Systems Architect, **CR** Critical Reviewer. "IA-2" means the IA review's objection 2.

### R1.0 Evidence I re-checked myself for this round

All FACT. Line numbers are as of 2026-10-03.

- `JAVA/jobs/JobQueue.java`:
  - 2 worker threads (lines 50-54);
  - `poll()` runs `runDue()` inline on the Spring scheduler thread (87-90);
  - `runScope` drains one org until it is empty, 10 per claim (116-134);
  - `enqueue` does `ON CONFLICT ... WHERE status IN ('queued','running') DO NOTHING` (66-75);
  - the row is deleted only after the handler returns (145).
- No `spring.task.scheduling` setting in `apps/api-java/src/main/resources/application.yml` (grep). There are three `@Scheduled` loops today: `JobQueue.java:87`, `VoiceSessions.java:678`, `DocumentProcessor.java:248`.
- `JAVA/voice/VoiceSessions.java`:
  - `apply` has two transactions with the extractor between them and publishes `call.ended`/`result.ready` on every run (505-551);
  - `counts()`, called by `expireStale`, only sets `status = 'ended'` (263-271, 678-687);
  - `markFailed` (354-358) and the `call_initiation_failure` branch (649-666) publish nothing;
  - `reconcile` needs an `Actor` (468).
- `JAVA/hiring/HiringController.java`:
  - the results route reconciles (line 271);
  - stage routes audit every returned row, and the reason goes only to `stageAudit` (362-396).
- `JAVA/hiring/Jobs.java`: `updateStatuses` skips the UPDATE when `previous` equals the new value but still returns the row (255-270); `create` writes `actor.userId()` into `created_by_user_id` (99-107).
- Foreign keys to `users`: `jobs.created_by_user_id` (`MIG/0015_hiring_desk_foundation.sql` line 43) and `audit_events.actor_user_id` (`MIG/0000_initial_schema.sql` line 132).
- `JAVA/audit/AuditService.java` stores the given actor id and maps only `null` to NIL for the context (36-45); failures are swallowed (56-59).
- `JAVA/authz/AuthInterceptor.java` audits with `ctx.userId()` and writes the URL with its query string into metadata (52-62).
- `JAVA/authz/AuthResolver.java` re-validates membership on every request (12-21, 59-82).
- `JAVA/platform/Db.java`: every call is `REQUIRES_NEW` (28-30, 48); `underAdvisoryLock` holds its own pooled connection while the work runs (97-115). `Env.java`: pool default 10 (line 88), statement timeout 15 s (89).
- `apps/web/components/ui/toaster.tsx` line 78: the Undo toast lasts 8000 ms. `apps/web/app/jobs/[id]/candidates/page.tsx` lines 680-698: Undo re-posts the previous stages through bulk-status with reason "Undone".
- No Java or web code reads `actions.webhook`. `CallContextCompiler` reads only `endCall`, `voicemailDetection`, `transferToHuman` and `transferCondition` (lines 171-235).
- Job `status` does not gate dialing: `dialLocked` never reads `jobs.status`. The only status writer is `PATCH /jobs/{id}` (`HiringController.java` line 120), and the only reader is the summary count (`Jobs.java` line 424).
- `scheduled_calls` exists with statuses `scheduled|dialing|done|cancelled|skipped`, `requested_by_user_id` and one open row per candidate (`MIG/0025_call_cost_ledger.sql` lines 95-136). The use case has a calling window, 10:00-19:00 Asia/Kolkata (`usecases/hiring.json` `callPolicy.retry.window`; `JAVA/engine/CallOutcomes.java` lines 89-108).
- Classpath: `mvn -o dependency:tree` shows `com.squareup.okhttp3:okhttp:4.12.0` and `org.apache.httpcomponents:httpclient:4.5.14` at compile scope, brought in by `com.google.genai:google-genai:1.37.0`. There is no `httpclient5`.
- OkHttp `Dns.lookup` "Returns the IP addresses of `hostname`, in the order they will be attempted by OkHttp" (https://raw.githubusercontent.com/square/okhttp/parent-4.12.0/okhttp/src/main/kotlin/okhttp3/Dns.kt). OkHttp **skips** `Dns` for IP-literal hosts (`RouteSelector.kt` line 163 in 4.12.0).
- Postgres:
  - `nextval` values "are not reclaimed for re-use if the calling transaction later aborts" (https://www.postgresql.org/docs/current/functions-sequence.html);
  - transaction-level advisory locks "are automatically released at the end of the transaction" (https://www.postgresql.org/docs/current/explicit-locking.html).
- EventBridge API destinations have a 5-second client timeout and retry `401, 407, 409, 429, 5xx` (https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-api-destinations.html).

### R1.1 Failed checks

| Check | Failed by | Cause | Status after v2 |
|---|---|---|---|
| `results_flow_back` | IA, BE, CR | No recovery for a lost provider webhook; failed calls emitted nothing; dedupe lost after the purge; feed could skip; stage pushes could be reordered | **Resolved in design** by R1.2 (dedupe on the call row), R1.3 (feed order), R1.4 (background reconcile, failed calls emit), R1.8 (level-triggered stage write-back). The provider fetch path has never run live, so live behaviour stays unverified (risk R16) |
| `security_appropriate` | AM, SA | NIL machine principal breaks two foreign keys and silently drops audit rows; event payload contents and feed permissions undefined | **Resolved** by R1.6 and R1.7 |
| `multitenancy_correct` | EIA | Data isolation correct, performance isolation missing | **Resolved** by R1.5 |
| `not_overengineered` | UX | The developer surface was unconditional MVP work for a persona not shown to exist | **Resolved** by R1.9 (gated on a pilot) |
| `solves_actual_problem` | CR | 40 imported people still need 40 clicks; automatic inbound waits for a pilot | **Partly resolved.** R1.10 adds a one-click, human-confirmed batch call. Automatic inbound for an unknown system cannot be designed concretely: it depends on founder decision 1. Unresolved items are listed at the end |

### R1.2 Major: outbound dedupe was purged after 30 days (EIA-1, BE-1, CR-1)

- **Disagreement.** v1 called the `integration_events` key "permanent" but purged the table after 30 days, while both the sweep ("any ended session with content but no event row") and `apply` would emit again for any call without a row.
- **Evidence.** Confirmed: `apply` re-runs on webhook, reconcile and results-page open, and publishes every time (R1.0). The queue gives no lasting dedupe, because succeeded rows are deleted.
- **Options.**
  - (a) A permanent key table.
  - (b) A bounded sweep window.
  - (c) The dedupe state on the subject row.
- **Decision: (c) plus (b).** `voice_sessions` gets `result_emitted_hash` and `result_version`. The sweep compares `md5(status, failure_reason, summary, structured_answers)` with the stored hash and claims the emit with a compare-and-set UPDATE in the same transaction as the event insert. It only looks at calls that ended in the last 7 days. `integration_events.dedupe_key` and `candidate_links.pushed_result_key` are removed.
- **Why.** The dedupe lives exactly as long as the call. Nothing else has to be permanent, so the 30-day purge stays simple. The compare-and-set also makes concurrent ticks on two replicas safe. This was the smallest of the three proposals: two columns, no new table.
- **Change.** v2 sections 2.3 and 6.1. A merge-blocking test purges events, re-runs `apply` and the sweep on a 40-day-old call, and asserts nothing is emitted (section 11.1).

### R1.3 Major: the events feed could skip rows (IA-2, BE-2, CR-2)

- **Disagreement.** v1 paged the feed on a `bigserial`. Sequence values are taken at insert, not at commit, so a poller can pass a row that commits later.
- **Evidence.** Confirmed from the Postgres docs (R1.0). The existing `Cursor` is `(createdAt, id)`, and `created_at = now()` is the transaction start, which has the same problem.
- **Options.**
  - (a) A visibility lag on `xmin` (IA, CR). It is correct only if the cursor is the transaction id rather than `seq`: a transaction can be assigned its xid early and its `seq` late.
  - (b) A per-org counter row (BE).
  - (c) A per-org advisory transaction lock around emit (IA).
- **Decision: (c).** `Events.emit` takes the caller's `Db.Sql`, runs `pg_advisory_xact_lock(hashtextextended('events:'||org,0))`, then inserts. The lock is held until commit, so within an org a later emitter cannot obtain a `seq` until the earlier one has finished.
- **Why.** The guarantee is exact, not timing-based. It needs no table, no sweeper and no xid arithmetic. Contention is per org and only on emits, which is fine at SMB volume.
- **Change.** v2 sections 6.1 and 6.5. The feed contract is "at-least-once, ordered by `seq` within a workspace, gaps are normal"; the cursor is an opaque `seq`. Merge-blocking test with two concurrent emits committed out of order.

### R1.4 Major: results never flowed back when the provider webhook was lost (IA-1, CR-3; also BE-5)

- **Disagreement.** A lost provider webhook is repaired today only when a person opens the results page. `/v1` deliberately drops that side effect, and nobody opens the page in the automated flow. Failed calls never emitted anything.
- **Evidence.** Confirmed (R1.0): `expireStale` fetches nothing, and reconcile needs a person's action. `markFailed` and the initiation-failure branch publish nothing.
- **Decision.**
  - The 60-second tick (orgs with a live connection) enqueues `reconcile_call` for phone calls that ended 3-60 minutes ago with a conversation id but no summary, no answers and no failure reason. Its key is `reconcile:<voiceSessionId>`.
  - A new org-scoped `reconcileSystem(org, vsId)` calls the existing fetch and `apply(org, null, ...)`. The handler limits itself by age.
  - The outcome sweep emits `call.ended` for every **settled** phone call with a candidate, including failed and unanswered ones, and after 90 minutes with `outcome: result_unavailable`.
  - Browser test calls never emit (BE-9).
- **Why.** It is level-triggered from the database, so it also covers crashes, Nest-written results and replays. It reuses `apply` unchanged. The customer is never left waiting without a signal.
- **Not adopted.** Reconcile for orgs without any connection. It would change behaviour for customers who did not ask for it; it is listed as a one-condition V2 change.
- **Change.** v2 sections 1 (item 6), 6.1, 11.1 tests, and risk R16 (the fetch path has never run live).

### R1.5 Major: one tenant could stall every tenant's queue (EIA-2, BE-3; also IA-9)

- **Disagreement.** Customer HTTP on the shared 2-thread worker and on the single scheduler thread lets one dead endpoint delay invitations, password resets, document indexing and other tenants' deliveries.
- **Evidence.** Confirmed (R1.0).
- **Decision.**
  - An **outbound lane** for kinds `call` and `integration`: its own 2-thread executor, never on the scheduler thread, at most one job per org per pass, round-robin. `email` and `document` are untouched.
  - A per-connection **circuit breaker**: after 3 failures the connection is `needs_attention`, then one probe every 5 minutes. Other jobs `Snooze` with no HTTP call and no attempt used. After 24 hours the connection is `paused`.
  - Timeouts of 3 s to connect and 10 s for the whole call.
  - `spring.task.scheduling.pool.size: 3`.
  - Per-kind backlog in `/health`.
- **Partly not adopted.** BE asked that `poll()` only wake workers. That is not needed here: the new kinds never run inside `poll()`, and changing email and document behaviour is outside this work. The pool-size line stops the `@Scheduled` loops from blocking each other.
- **Change.** v2 sections 6.4, 6.8 and 10; test "a receiver that hangs does not delay an email job".

### R1.6 Major: machine principal as `Db.NIL` (AM-1, SA-1; also IA-3, EIA-3, BE-7, CR-9)

- **Disagreement.** v1 said keys resolve to `userId = Db.NIL` through "one branch in `AuthResolver`" and cited `AuditService` for "system actors stored as NULL".
- **Evidence.** Confirmed (R1.0):
  - NIL would violate the foreign keys on `jobs.created_by_user_id` and `audit_events.actor_user_id`;
  - `AuditService` swallows the failure, so every key's `authz.sensitive_access` row would silently vanish;
  - `Actor` requires a membership.

  v1's FACT line was wrong: `AuditService` stores NULL only when passed `null`.
- **Options.**
  - (a) A nullable-user machine principal: every service and FK column handles null, and `Actor` gets optional membership fields (SA, AM, EIA).
  - (b) The key acts as its creator, with the creator's live membership re-checked per request and intersected with the key's permissions (IA, BE).
- **Decision: (b).** `AuthResolver`, only on `/v1` with a bearer key:
  1. look up the key by hash;
  2. reject it if revoked, expired, or its connection is not active;
  3. call the existing `membership(createdByUserId, org)`;
  4. effective permissions = key ∩ creator.

  `AuthContext` gains a nullable `apiKeyId`, which `AuthInterceptor` adds to audit metadata. Workers pass `null` to `AuditService`, never NIL.
- **Why.**
  - Fewer changes: no service, FK column or `Actor` field changes; one existing method is reused.
  - It closes three objections at once: the FK failures, the lost audit rows, and permission drift when the creator is demoted or leaves (SA-4, AM-8, EIA-9).
  - It matches the existing "membership re-validated every request" posture and the fail-closed rule for connections.
  - Cost: a key stops when its creator leaves. That is surfaced as "Needs attention" and listed as founder decision 13.
  - Not adopted from SA-1: a null `userId` for keys. With option (b) every write has a real, accountable user id plus `apiKeyId`, which is better audit than NULL.
- **Change.** v2 section 10 and 11.1 item 2; tests: an API-key PII read writes `authz.sensitive_access` with the creator and `apiKeyId`; `PUT /v1/jobs/by-external` creates a job; a removed creator's key gets 401.

### R1.7 Major: event payload contents and feed authorization (SA-2; also IA-6, EIA-7, BE-9, CR-7, SA-3)

- **Disagreement.** `integration_events.payload jsonb` was undefined, and the feed was gated "per event type", which `AuthInterceptor` cannot express. Stored summaries would be a second PII copy, and the feed could bypass `calls.read_transcript`.
- **Evidence.** `AuthInterceptor` supports only static annotations. Redaction today happens per caller at read time (`HiringController.redactResult`, lines 247-255).
- **Decision.**
  - Event rows hold ids and state only: `{version}` for calls, `{from, to, decidedByUserId}` for stage changes.
  - `ExternalPayloads` builds every body at send or read time for a named principal (the key, the connection's sending principal, or the exporting person), using that principal's current permissions.
  - **One export rule everywhere** (SA-3): content needs `calls.read_transcript` **and** `candidates.export`; contact PII also needs `candidates.read_pii` and never travels in webhooks or the feed.
  - The feed needs `candidates.read` + `jobs.read`.
  - Events are emitted only for orgs with a connection that is not disconnected (CR-7).
- **Why.** No second PII store, no emit-time snapshot of permissions, and one place to test.
- **Change.** v2 sections 2.3, 6.2, 6.5, 6.6 and 6.7; the forbidden-field test now also checks the export rule.

### R1.8 Major: Undo and stage write-back, and reordered pushes (UX-2, CR-4; also BE-8, IA-12(2))

- **Disagreement.** v1 pushed `SET_STAGE` per event and said "Undo attempts a revert", but it also said `new`/`screening` are never sent. Retries on 2 threads could land an old decision last, possibly a reject status that emails the candidate.
- **Evidence.** Undo lasts 8 s and re-posts the previous stage with reason "Undone" (R1.0). Queue backoff reorders retries.
- **Decision.** `push_stage` is level-triggered per candidate link (key `stage:<candidateLinkId>`, at most one queued). The tick enqueues it on any mismatch between the current stage and `pushed_stage`. The handler:
  1. snoozes until the candidate's last stage change is 2 minutes old;
  2. reads the current stage and sends only that;
  3. on a forward decision, re-reads the ATS status first and does not overwrite a status someone changed in the ATS;
  4. on a decision withdrawn after a push, restores `stage_seen_at_push` if the ATS still shows our value.
- **Why.**
  - Reading current state makes order and retries irrelevant.
  - The hold prevents a withdrawn decision from ever leaving.
  - It also catches stage changes made through Nest.
  - 2 minutes rather than UX's 60 s or CR's 5 minutes: it covers the 8-second Undo and a quick manual correction, and the ATS still updates within minutes. One value for both directions keeps it simple.
- **Webhooks and the feed** still carry each human decision as a fact. An undo is a second event; bodies include the candidate's current stage, and the payload documents this. Holding webhooks too would hide real human actions from the customer's own system.
- **Change.** v2 section 7 and onboarding step 5; test "decide, undo within 10 s, no ATS write".

### R1.9 Major: developer surface not gated on any customer (UX-1)

- **Disagreement.** API keys, `/v1`, webhooks, the feed, `SafeHttp` and OpenAPI (about 8-12 days) were unconditional, aimed at SMB recruiters who may have no developer. The comparison doc had made this conditional (`01-comparison.md` line 107), and v1 dropped the condition.
- **Evidence.** Confirmed. Slice E needs connections, links, events, deliveries and the worker. It does not need keys, `/v1`, `SafeHttp`, signing or the feed.
- **Decision.**
  - Split into **Core** (connections, links, events, deliveries, lane, sweep, reconcile) and **Dev** (keys, `/v1`, `SafeHttp`, signing, feed, OpenAPI).
  - Core is built only together with its first consumer.
  - E and Dev are each gated on a pilot confirming that path (founder decision 1).
  - 0, A and A2 start now.
- **Why.** No work for an unconfirmed persona, and no table changes.
- **Change.** v2 sections 1 (item 3), 9 and 13.1.

### R1.10 Major: imported candidates still need one click each (CR-5)

- **Disagreement.** "No manual work" is not met if 40 people pulled from an ATS need 40 Call clicks and 40 confirms. A single human click that queues them is not auto-dial.
- **Evidence.**
  - No bulk call is shipped, although the redesign spec asked for one (`docs/superpowers/specs/2026-10-01-saas-redesign-design.md` line 202, per the product map C6).
  - `scheduled_calls` already exists and has no dispatcher.
  - The calling window already exists in the use case.
  - `startOutbound` already applies `BudgetGuard` and the caps (R1.0).
- **Decision.** Slice A2, "Call everyone not called yet (N)":
  - it needs `calls.initiate` and one `ConfirmDialog` with the count, calling hours and remaining budget;
  - it writes `scheduled_calls` rows (`reason 'bulk'`);
  - one `call` job per row runs in the outbound lane. Each job rebuilds the clicker's live `Actor`, snoozes outside calling hours or at the concurrency cap, and calls the existing `startOutbound`;
  - a "Stop queued calls" button cancels the rest.
- **Why.** It reuses an unused table and the existing dial path, and it builds the dispatcher that V2 auto-retry and auto-call need anyway.
- **Kept open.** It still depends on founder decision 10a and a legal check: whether a queued batch counts as an "auto-dialer" under TCCCPR is unverified.
- **Change.** v2 sections 1, 2.2, 2.3, 10 and 13.1; founder decision 10a.

### R1.11 Minor objections

| Id | Objection (short) | Decision | Justification and change |
|---|---|---|---|
| IA-3 | NIL principal breaks FK; key lifetime | Accepted | R1.6 |
| IA-4 | Chained pulls and delayed re-enqueue collide with their own idempotency key | Accepted: `Snooze` | A handler returns `Snooze(seconds)`; the same row is re-queued and the attempt is not counted. The queue row is the single-flight lease for `pull:<connectionId>`. This replaces v1's `delaySeconds` overload. v2 sections 5 and 6.8 |
| IA-5 | External id uniqueness vs job-scoped route | Accepted | `candidate_links` gets `job_id`; `UNIQUE (connection_id, job_id, external_id)`: an external id names a person on a job, matching job-scoped candidates (`MIG/0018`). v2 section 2.3 |
| IA-6 | Event payload storage and feed permission | Accepted | R1.7 |
| IA-7 | `result.ready` churn vs note marker | Accepted | One public event, `call.ended`, emitted after a 3-minute settle; a `version` rises only if the result changes after sending; the note marker includes the content hash, so a follow-up note is written only when content changed. v2 sections 6.1 and 7 |
| IA-8 | No-op stage changes emit; reason not passed | Accepted, simplified | Emit only inside the `previous != new` branch. The reason is not sent outside in MVP (it is free text), so `updateStatuses` needs no new parameter. v2 section 6.1 |
| IA-9 | Worker capacity shared with email | Accepted | R1.5 |
| IA-10 | No IP-pinning mechanism in the stack | Accepted, premise partly wrong | OkHttp 4.12.0 is already on the compile classpath (R1.0); a custom `Dns` filters and pins in one step. Added: refuse IP-literal hosts (OkHttp skips `Dns` for them), no proxy, no redirects; declare OkHttp as a direct dependency at the shipped version. No new artifact. v2 section 6.4 |
| IA-11 | Per-IP limit penalises iPaaS tenants | Accepted | Per-key window for keys `AuthResolver` validated in the last 5 minutes; everything else stays per IP, so random tokens cannot dodge it. v2 section 6.6 |
| IA-12 | (1) one flag for webhooks and ATS write-back; (2) Undo; (3) advisory lock across vendor HTTP | (1) Not adopted as proposed. (2) Accepted, R1.8. (3) Accepted | (1) No code reads `actions.webhook` (R1.0). It is renamed `actions.integrations` and means "results and decisions may leave through a connection". Stage write-back also needs the per-connection opt-in. A second use-case flag waits for a use case that needs it. (3) No lock around vendor calls; token refresh uses `pg_try_advisory_xact_lock` only around the refresh call, and a miss snoozes. v2 sections 2.3, 5, 6.1 |
| AM-2 | `/v1` could rewrite the JD that drives the call | Accepted, partly | `PUT /v1/jobs/by-external` is create-if-missing; no later title, description or status changes; every API write is audited. Not adopted: "API jobs start as draft, a person opens them", because job status does not gate dialing today (R1.0), so it would be a label, not a control. Section 11.1 item 9 now says plainly that `AdviceGuard` does not guard live speech. v2 sections 4, 6.6, 11.1 |
| AM-3 | No-op stage events | Accepted | As IA-8 |
| AM-4 | Note dedupe vs content-hash events | Accepted | As IA-7 |
| AM-5 | MCP facade needs routes `/v1` lacks; auth for a key pilot | Accepted | The facade calls the same services as the web routes; a key-based read-only pilot only for hosts that accept static bearer headers; OAuth before any write tool. v2 section 8 |
| AM-6 | In-call actions path underspecified | Accepted | Four prerequisites written down (webhook-tool endpoint, call-scoped token as a secret dynamic variable, call principal, read-only tools with a timeout of 5 s or less); stays Later. v2 section 7 |
| AM-7 | One flag gates two things | Not adopted as proposed | As IA-12(1) |
| AM-8 | Key lifetime when the creator loses access | Accepted | R1.6 (intersection with live permissions) |
| EIA-3 | NIL vs FKs | Accepted | R1.6 |
| EIA-4 | Pull chaining collision | Accepted | As IA-4 |
| EIA-5 | Rung 2 cannot use routes keyed by our job id; batch not an upsert | Accepted | Candidate routes select the job in the **body** (`{job: {id} or {externalId}}`); batch rows may carry `externalId` (upsert); replays return 200; never 409. Rung 2 uses the batch route, so no path parameters or lookups are needed. v2 sections 6.6 and 9 |
| EIA-6 | Sweep races the extractor; two `result.ready` | Accepted | 3-minute settle after `ended_at`; `version` in the body. v2 section 6.1 |
| EIA-7 | Snapshot vs build-at-delivery | Accepted | R1.7 |
| EIA-8 | Public ingress; per-IP limit; bearer-only | Accepted | Caddy routes `api.<domain>/v1/*` to Java with `TRUST_PROXY=true` (FACT, Caddy in ADR-006 line 147; `TRUST_PROXY` in `Env.java` line 93); per-key window; `/v1` ignores cookies. v2 section 6.6 |
| EIA-9 | Key permission drift | Accepted | R1.6 |
| EIA-10 | (1) flag coupling; (2) no `seq`/`occurredAt` in payloads; (3) reason not passed | (1) As IA-12(1). (2) Accepted. (3) Resolved by not sending the reason | Every body carries `id`, `seq`, `occurredAt`; the docs say webhooks may arrive out of order and the feed is ordered. v2 section 6.3 |
| EIA-11 | Record as ADR-010; gate on ADR-008 | Accepted as a gate | The Core slice requires ADR-010 written and ADR-008 accepted (or Nest's stage routes unreachable from the web). ADR-010 is not written in this round because the founder has not approved the design. With the level-triggered sweeps, Nest-written results and Nest stage changes still reach ATS write-back; only webhook/feed stage events are Java-only. v2 sections 13.1 and R10 |
| SA-3 | Export permission applied inconsistently | Accepted | One export rule in `ExternalPayloads` (R1.7) |
| SA-4 | Key lifetime; keys on disconnect | Accepted | R1.6; a key is rejected when its connection is not active; disconnect revokes the connection's keys in the same transaction. v2 sections 5 and 11.1 |
| SA-5 | Where non-credential secrets live | Accepted, simplified | One `secrets_sealed` column (a sealed JSON object for OAuth tokens and PKCE verifier, or the signing secret, the previous secret and its expiry), AAD `org:connection:secrets`. `oauth_state_hash` + expiry columns, cleared on first use. `config` keys come from an allowlist, enforced by a test. v2 sections 2.3 and 11.1 |
| SA-6 | SafeHttp details: resolver, boot guard, probing oracle, test case | Accepted | As IA-10; `Env` refuses to boot with the private-target flag and `COOKIE_SECURE=true`; test events limited to 5 a minute with coarse results; test includes a hostname that resolves to a private address. v2 sections 6.4 and 11.1 |
| SA-7 | Key prefix shows only `hv_live_`; keys in query strings | Accepted | Prefix `hv_live_` + 6 characters; header only (`AuthInterceptor` logs the query string, R1.0). v2 sections 2.3 and 6.6 |
| SA-8 | `/v1` must refuse cookies; web rewrite exposes `/v1` | Accepted, rewrite left alone | `/v1` ignores cookies, cookie routes ignore bearer headers; with that, exposure through the web origin is harmless, so the rewrite is not changed. v2 section 6.6 |
| SA-9 | Untrusted JD via `/v1` | Accepted | As AM-2 |
| SA-10 | Adopt-by-phone through the API: existence oracle and takeover | Accepted, premise partly wrong | Oracle: CSV import preview already reports `duplicate_on_job` to any holder of `candidates.create`, so `/v1` reveals nothing new. Takeover: real. `/v1` never adopts; adoption stays connector-only and is audited. v2 sections 5 and 6.6 |
| SA-11 | DPDP gates only for the named connector; remote deletion leaves PII | Accepted | Retention, purge, DPA and runbook gate the first external connection of any kind. After the ATS deletes a person and a grace period (founder decision 9; proposed 7 days), contact fields and call content are anonymised, ids and outcomes kept, audited. v2 sections 5 and 11.1 item 10 |
| SA-12 | Order of V2 inbound webhook lookup | Accepted | Order written out (path id → narrow lookup of org and sealed secret → verify → timestamp and dedupe → writes). v2 section 11.1 item 8 |
| UX-3 | Duplicate or noisy ATS notes | Accepted, partly | One note per call version; a follow-up note only when content changed after sending (rare with the settle window). A strict single note would leave the ATS with an incomplete note when a late provider result arrives. Unanswered calls get a one-line note, because "Didn't connect" is a core recruiter queue. v2 section 7 |
| UX-4 | Rejected inbound records invisible | Accepted | `last_sync_issues` (counts by issue code and external ids, no PII) on the status card with "Fix them in Zoho Recruit" and "Sync now". v2 sections 5 and 12.2 |
| UX-5 | CSV export ignores per-field permissions | Accepted | Rows built by `ExternalPayloads` for the exporter. v2 section 6.7 |
| UX-6 | Imported draft jobs cannot be called; JD truncated at 5,000 | Accepted | Step 7 lists new jobs with "Add must-ask questions and an agent"; the full JD goes through the JD-text path (up to 40,000 characters, `HiringController.java` line 155). v2 section 12.2 |
| UX-7 | Retry permission; custom-linked fields; closed label; FAQ/Tools | Accepted | Retry and Take over need `integrations.update`; recruiters see the state and "Ask a workspace admin"; custom-linked fields stay editable (last write wins); one "Closed in Zoho Recruit" label, excluded from "Not called yet" and bulk calls; FAQ and Tools copy in every slice's definition of done. v2 sections 4, 11.1, 12 |
| BE-4 | Same-key re-enqueue from a running job is a no-op | Accepted | As IA-4 |
| BE-5 | Failed calls never produce an event | Accepted | R1.4 |
| BE-6 | Outbox emit must join the caller's transaction; no-op rows; reason | Accepted | `Events.emit(Db.Sql sql, ...)`; emit in the `previous != new` branch; reason not sent. v2 section 6.1 |
| BE-7 | NIL vs `created_by` FK | Accepted | R1.6 |
| BE-8 | Stage and note write-back must be level-triggered | Accepted | R1.8 and IA-7 |
| BE-9 | Payload contents; browser test calls; signing secret | Accepted | R1.7; phone calls with a candidate only; signing secret in `secrets_sealed` |
| BE-10 | Advisory lock held across vendor HTTP | Accepted, different mechanism | No `sync_locked_until` column: the queue row of `pull:<connectionId>` is already a lease (claimed rows have `locked_until`). The lock is used only for the token refresh, with try-lock. v2 section 5 |
| CR-6 | Several `result.ready` vs the single note marker | Accepted | As IA-7 |
| CR-7 | Event payloads store PII for every org | Accepted | R1.7; emit only for orgs with a live connection |
| CR-8 | No client in the build can pin an IP | Accepted, premise partly wrong | As IA-10 |
| CR-9 | FK columns; key lifecycle | Accepted | R1.6 |
| CR-10 | Webhook secret rotation storage; OAuth state storage; closed-job behaviour | Accepted | As SA-5; ATS-closed jobs stop pulling, show "Closed in Zoho Recruit", and are never closed in HRVoice automatically. v2 sections 2.3 and 5 |
| CR-11 | E.164 backfill collisions; Nest writes old format; effort | Accepted | Read-only collision query first; an operator merges or removes rows; the backfill refuses to run while collisions exist; only with the web on Java; web screens updated; slice 0 re-estimated at 4-6 days. v2 section 13.1 |
| CR-12 | Unfixable ATS phone; adoption overwrites typed values | Accepted, partly | Rejected numbers appear on the status card with "Fix them in Zoho Recruit" and "Sync now"; adoption is audited. Not adopted: "keep local values until the next real remote change", which adds a per-field ownership state for a rare case. The ATS owns linked fields (D10), and the phone matched, so it is the same person |
| CR-13 | Credit budget ignores writes; V2 scaffolding; fourth `@Scheduled` loop | Accepted, partly | A write reserve in the budget, so polling slows first; `direction 'in'` and `inboundHints` removed. The tick stays a separate `@Scheduled` method that only hands work to the lane; putting it inside `JobQueue.poll` would couple the queue to integrations, and the pool-size line removes the blocking concern. v2 sections 2.3, 3, 5, 6.8 |

### R1.12 Things I could not resolve in this round

1. **Automatic inbound for an unknown system** (`solves_actual_problem`). The connector cannot be built until a pilot names its system (founder decision 1). If no pilot uses an ATS or has a developer, the MVP is 0, A and A2 only.
2. **Live voice-provider behaviour.** Background reconcile depends on a fetch path that has never run live (FACT, `apps/api-java/MIGRATION_STATUS.md` lines 89, 353). The 3-minute settle and 90-minute deadline are ASSUMPTIONS until real calls are measured.
3. **Legal:**
   - whether a human-confirmed queued batch (A2) is an "auto-dialer" under TCCCPR;
   - whether we are a DPDP processor;
   - the retention and anonymisation grace periods.

   Founder decisions 9, 10 and 10a.
4. **Unverified details that do not change the design:** Spring's deprecation of its OkHttp request factory (why `SafeHttp` uses OkHttp directly); which MCP hosts accept static bearer headers; whether Zoho notes can be listed cheaply for the marker check.
5. **ADR-010** is not written yet. It is a gate for the Core slice, to be written once the founder accepts v2.

---

## Round 2

Date: 2026-10-03. Input: `architecture-draft-v2.md` and seven reviews, all "block". Output: `architecture-draft-v3.md`.

Reviewer codes as in round 1. "SA-3" means the Security Architect's round-2 objection 3.

### R2.0 Evidence I re-checked myself for this round

All FACT. Line numbers are as of 2026-10-03.

- `JAVA/voice/VoiceSessions.java`:
  - `startOutbound` and `dialLocked` raise every refusal as `ApiError.conflict(message)`: line not connected, agent not published, provisioning failure, concurrency cap, daily cap, "linked to a different hiring agent", live call in progress, and both post-dial failures (lines 362-463).
  - `markFailed` runs after the `voice_sessions` insert, on a thrown `dial` and on a refused dial (440-449, 354-358).
  - One `voice_provider_deployments` row per agent version; a different `context_hash` re-provisions the hosted agent (154-219). The advisory lock wraps only `dialLocked`, which returns after `voice.dial` (362-376).
  - `apply` stores the provider summary with `coalesce(?, summary)` (514); the extractor's summary is written only with `coalesce(summary, ?)`; the ledger outcome is `completed` when a user turn exists, else `no_conversation` (540-545).
  - `counts()` expires phone sessions after `voiceMaxPhoneMinutes + 10` (263-271); `expireStale` runs every 5 minutes for every active org (677-687).
  - `recording` streams from the provider by conversation id (618-627); `webhook` ignores a conversation id it cannot find (632-637).
- `JAVA/platform/ApiError.java` lines 54-56: `conflict` always has code `conflict`, HTTP 409. `JAVA/platform/Db.java` lines 103-115: a lock timeout is also `conflict`. `JAVA/cost/BudgetGuard.java` lines 50 and 54: budget refusals are `conflict` too. grep of `apps/web`: no code matches the literal code `conflict`.
- `JAVA/voice/HostedVoiceAdapter.java`:
  - the summary is `analysis.transcript_summary` (149-150);
  - an answer falls back to `rationale`, then to the raw object, when `value`, `result` and `answer` are absent (151-161);
  - the dial body has only `agent_id`, `agent_phone_number_id`, `to_number` (252-256);
  - per-call overrides allow only prompt, first message and language; data collection is set on the agent (95-99).
- `JAVA/engine/PostCallExtractor.java` line 63 is the only reader of `summaryInstruction`. `JAVA/engine/AdviceGuard.java`: `scrub` drops a sentence only when one of the use case's words matches.
- `JAVA/engine/CallContextCompiler.java` line 273: the snapshot stores `contextHash`.
- `JAVA/jobs/JobQueue.java`: `execute` re-queues any exception until `attempts >= max` (136-161); POLICY is keyed by kind only (38).
- `JAVA/hiring/Jobs.java` lines 255-270: `previous` is read with a plain SELECT, no `FOR UPDATE`. `JAVA/hiring/Candidates.java` line 101: `update` has no link check. `JAVA/hiring/HiringController.java` line 352: a job without an agent cannot be phoned; line 279: the results route audits content reads itself. `JAVA/authz/AuthInterceptor.java` line 60 audits only the route's permission.
- `JAVA/platform/EdgeFilter.java` lines 86-91: with `TRUST_PROXY`, the first `X-Forwarded-For` entry is the client.
- `MIG/0025_call_cost_ledger.sql` lines 95-136: `scheduled_calls` already has `reason`, `voice_session_id`, `requested_by_user_id`, `agent_id NOT NULL`, `attempt NOT NULL`, and one open row per candidate.
- `apps/api-java/src/main/resources/usecases/hiring.json`: `callPolicy.retry.enabled` is `false`.
- `apps/api-java/MIGRATION_STATUS.md` lines 354-356: "Phone calls are safe" rests on the advisory lock; only `HiringLoopTest` covers it.
- Web sources:
  - ElevenLabs documents `DELETE` for a conversation (https://elevenlabs.io/docs/api-reference/conversations/delete).
  - The outbound-call API accepts `conversation_initiation_client_data.conversation_config_override` and `dynamic_variables` (https://elevenlabs.io/docs/api-reference/integrations/twilio/outbound-call).
  - Agent creation documents `summary_language` but no summary instruction (https://elevenlabs.io/docs/api-reference/agents/create).
  - MCP: "Authorization is OPTIONAL for MCP implementations. When supported: Implementations using an HTTP-based transport SHOULD conform to this specification" (https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization).
  - Caddy `reverse_proxy`: "For these X-Forwarded-* headers, by default, the proxy will ignore their values from incoming requests, to prevent spoofing", unless `trusted_proxies` is set (https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).
  - OWASP CSV injection lists `=`, `+`, `-`, `@`, tab (0x09) and carriage return (0x0D) (https://owasp.org/www-community/attacks/CSV_Injection).
  - Confluent HTTP Sink: `batch.prefix` and `batch.suffix` are applied once per batch (https://docs.confluent.io/kafka-connectors/http/current/connector_config.html).
  - RFC 6749 §4.1.3: token requests are form-encoded in the request body (https://datatracker.ietf.org/doc/html/rfc6749#section-4.1.3).

### R2.1 Failed checks

| Check | Failed by | Cause | Status after v3 |
|---|---|---|---|
| `data_flows_automatically` | IA, EIA | A failing customer webhook (or the connector leaving) turned every key on the connection into a 401, stopping inbound pushes | **Resolved** by R2.2: keys depend only on themselves, their creator and "not disconnected" |
| `agents_perform_permitted_actions` | IA | A2 could re-dial a person through the generic queue retry, which is automatic retry without a human click | **Resolved** by R2.3: at most one dial per queued row |
| `agents_access_required_data` | AM | A batch could make a candidate hear another job's JD and questions on a shared hosted agent | **Resolved in design** by R2.4 (re-sync guard). Vendor behaviour stays unverified (R18) |
| `results_flow_back` | EIA, CR | The feed (the fallback) died with the webhook; the sweep stopped while the connection was not `active`, so calls older than 7 days were never emitted; notes were dropped silently by the purge | **Resolved** by R2.2 (sweep runs for every connection that is not disconnected), the per-connection drain cursor and `missed_until` (CR-3) |
| `works_for_saas_and_custom` | EIA | Same coupling for custom systems; custom systems could not withdraw or delete a person | **Resolved** by R2.2 and EIA-2 (`state` and `DELETE` on `/v1`) |
| `security_appropriate` | SA | Key validity coupling; erasure left the provider's copy | **Resolved** by R2.2 and R2.6 |

UX and BE failed no check but blocked on a major each (R2.7 and R2.2).

### R2.2 Major: API key validity was tied to outbound delivery health (IA-2, AM-3, EIA-1, SA-1, BE-1, CR-1)

- **Disagreement.** All six reviewers: one `integration_connections.status` carried credential validity, outbound delivery health, the sending principal and whether jobs ran. v2 rejected a key when its connection was not `active`, while 3 failed webhook sends (or the connector leaving) moved the connection to `needs_attention` and later `paused`. So an outbound failure stopped inbound pushes and the events feed, which v2 itself named as the recovery path. CR and EIA added: the sweep ran only for orgs with a "live" connection, so a long outage lost calls beyond the 7-day window; v2's line "the events feed covers anything lost beyond 30 days" was wrong, because the feed holds 30 days.
- **Evidence.** Confirmed by reading v2 (section 10 step 1, section 6.4, section 5 "Fail-closed revocation", section 6.1 "live connection"). This was a design-text error introduced in round 1 (R1.5, R1.6); no code exists yet.
- **Options.** (a) A `webhook_state` / `delivery_state` enum (EIA, IA). (b) Delivery health in counter columns, `status` for the lifecycle only (CR). (c) Only the deliver handler reads the breaker state (AM).
- **Decision: (b), which also gives (c).**
  - `status` = `connecting | active | needs_attention | disconnected`, plus `attention_reason` (`consent_revoked | principal_lost | status_unmapped`).
  - Delivery health lives in `consecutive_failures`, `failing_since`, `last_attempt_at`, `last_success_at`, `last_error_code`. Only the drain reads and writes them. They never change `status`.
  - The `paused` status and `paused_until` are removed. The vendor's daily limit is `rate_limited_until`.
  - **A key is valid unless** it is revoked or expired, its connection is `disconnected`, or its creator is no longer an active member.
  - Every job stops only on `disconnected`; otherwise each job checks its own precondition (a pull needs a token, a send needs a live principal, a stage push needs a mapped status).
  - The tick and the outcome sweep run for every org with a connection that is not disconnected.
  - The wrong feed sentence is replaced by the purge rule with `missed_until` (CR-3).
- **Why.** It is the smallest model: four statuses instead of five, no new enum, counters that v2 already had. Each job's stop condition is its own failure, so no rule has to know about other directions.
- **Change.** v3 sections 1 (item 8), 2.3, 5, 6.1, 6.4, 10 and 12; merge-blocking test "keys survive delivery failure".

### R2.3 Major: A2 could dial a candidate twice; dial errors were indistinguishable (IA-1; also AM-8, BE-3, CR-4, CR-5, EIA-5, BE-7)

- **Disagreement.**
  - IA: v2 mapped only the caps and validation errors; every other `startOutbound` failure, including those after the `voice_sessions` insert and a `dial` timeout, went to the queue's generic retry. That could re-dial the person, which is auto-retry while it is switched off.
  - BE and CR: all refusals share the code `conflict`, so the handler would match on message text.
  - CR: two queues for one thing (`scheduled_calls` plus a `call` job) leave orphans, because `enqueue` commits separately.
  - AM: a dispatcher must never dial the retry rows that `apply` writes when `callPolicy.retry.enabled` is turned on.
  - EIA and BE: dials shared the 2-thread lane with slow customer HTTP.
- **Evidence.** All confirmed (R2.0).
- **Decision.**
  - **`scheduled_calls` is the queue** (CR-4). No `call` kind, no CHECK or POLICY change, no lane or `Snooze` needed for A2, and no migration for A2 at all.
  - One daemon dial thread claims at most one due row per org per pass, **only `reason = 'bulk'`**, sets it to `dialing` and commits before dialing.
  - **At most once:** a row goes back to `scheduled` only for codes raised before any session row exists. Everything else is terminal, and a row stuck in `dialing` for 10 minutes becomes `skipped` ("interrupted").
  - **Stable codes** on every refusal (`calls.concurrency_cap`, `calls.daily_cap`, `calls.agent_in_use`, `calls.busy`, `calls.not_ready`, `budget.exceeded`, `calls.provision_failed`, `calls.live_call`, `calls.dial_failed`), keeping HTTP 409 and the message. The mapping table is in v3 §13.1.
  - Errors that would hit every row the same way (`not_ready`, `budget.exceeded`, `provision_failed`) skip all open bulk rows of the job with one visible reason, in one UPDATE.
- **Partly not adopted.**
  - IA's "set the `call` POLICY to a small max_attempts": moot, because there is no `call` kind.
  - BE's "`provision_failed` → retry with backoff": not adopted. With N queued rows, a provisioning outage would retry N times per backoff step against the vendor. Skipping the job's remaining rows with one reason is bounded and visible, and the person clicks again. `calls.busy` (a lock timeout) is rescheduled in 60 seconds, because it clears by itself.
  - IA's "monthly budget → skipped with a visible reason": adopted, applied to the job's remaining rows at once.
- **Why.** One table instead of two removes the orphan case and a whole slice of queue work from A2. Committing `dialing` before the dial makes "at most once" structural rather than a classification exercise. It also moves dials off the lane, which settles EIA-5 and BE-7.
- **Change.** v3 sections 2.2, 2.3, 6.8 (A2 needs none of it), 10 and 13.1 (A2 in detail); tests "A2 at most once" and "a retry row is never dialed".

### R2.4 Major: a batch could screen a candidate with another job's context (AM-1)

- **Disagreement.** One hosted agent per agent version is re-synced per job context, and the lock covers only the dial request. If the vendor reads a phone call's config when the person answers, a job-B re-sync seconds later changes what the job-A candidate hears, and the answers that flow out to the ATS map to the wrong questions. A2's unattended dispatcher makes this routine.
- **Evidence.** Confirmed in code (R2.0). When the vendor binds config is unverified: I found nothing in the provider docs that settles it. The outbound-call API does accept `conversation_config_override`.
- **Decision.** A guard in `provisionLocked`, not only in the A2 job. Before a **re-sync**, if any `pending`/`active` session on the same agent version, started inside the stale-expiry window, has a different `provision_snapshot.contextHash`, refuse with `calls.agent_in_use`. A2 reschedules in 60 seconds; a manual click shows "This hiring agent is on a call for another job. Try again when that call ends." Same-job dials do not re-sync and are unaffected.
- **Partly not adopted: "send the job's prompt per call through `conversation_config_override`" as the better fix.** It is not sufficient. The per-job must-ask questions travel as `platform_settings.data_collection` on the agent, and the overrides we enable cover only prompt, first message and language (FACT, `HostedVoiceAdapter.java` lines 95-99, comment "nothing else is overridable"). Answers would still be extracted against the other job's questions. It stays a V2 item together with `dynamic_variables`.
- **Why the guard sits in `provisionLocked`.** That is the one place a re-sync happens. It covers manual clicks, A2 and browser tests with one query. The cost is a short wait when two jobs share one agent and both are calling, and the concurrency cap is already 3 by default (FACT, `JAVA/platform/Env.java` line 132).
- **Change.** v3 section 13.1 (A2, "Shared hosted agent guard"), section 17, risk R18, and a merge-blocking test.

### R2.5 Major: the summary leaving HRVoice was the vendor's, not ours (AM-2; also SA-3)

- **Disagreement.** AM: the stored summary is the provider's `transcript_summary`, and our "do not score, rank or judge fit" instruction runs only when a summary is missing. A 9-word scrub lets "strong candidate" or "lacks relevant experience" through into a permanent ATS record. SA-3: answers can be the provider's `rationale` text, which is model-written and unscrubbed.
- **Evidence.** Confirmed (R2.0). The provider documents `summary_language` but no summary instruction, so AM's option (c), configuring the vendor's summary, is not available as far as the docs show.
- **Options.** (a) Answers plus a link, no summary. (b) Our own summary from one `summaryInstruction` pass, stored separately. (c) Configure the provider's summary.
- **Decision: (a) now; (b) in V2 if a pilot asks.**
  - No outbound body (feed, `/v1` results, ATS note, CSV, later webhooks) carries a summary.
  - Answers come only from the job's must-ask keys, in snapshot order, scrubbed and capped at 500 characters.
  - Slice 0 changes the adapter so an answer comes only from `value`, `result` or `answer`, never `rationale` or the raw object.
  - The merge-blocking test adds `summary` to the forbidden fields and an evaluative-phrase corpus. v3 says plainly that scrub is the backstop and leaving the summary out is the control.
  - Founder decision 4 now defaults to "outcome, answers and a link".
- **Why.** (a) removes a field rather than adding a model call and a column. (b) costs one LLM call per call and a new stored field, which is worth it only if customers want summaries outside.
- **Also noticed (outside integration scope):** the in-app summary is the same vendor summary. That is listed as founder decision 14, not changed here.
- **Change.** v3 sections 1 (item 5), 6.2, 6.7, 7 (note template), 13.1 slice 0, 16 (decisions 4 and 14), R3.

### R2.6 Major: erasure left the voice provider's copy (SA-2; also IA-5)

- **Disagreement.** Anonymisation and the retention purge nulled our columns only. The provider keeps transcript and audio, and our `/recording` route kept streaming it, so presenting this as carrying out an erasure instruction would be false. IA added manual candidate deletion.
- **Evidence.** Confirmed: the recording is streamed by conversation id, and no delete call exists in Java (grep). The provider documents a conversation delete. Manual deletion leaves transcripts today, because `voice_sessions.candidate_id` is `ON DELETE SET NULL` (backend map §6.3).
- **Decision.** One erasure path, used by ATS or `/v1` deletion after the grace period, the retention purge and manual deletion:
  1. In one transaction, null transcript, summary and answers and set `voice_sessions.content_erased_at`.
  2. `apply` writes only where `content_erased_at IS NULL`; the outcome sweep skips erased calls (otherwise the content change would emit a new version); `/recording` refuses them.
  3. The existing 5-minute call loop calls the new `VoiceAgentPort.deleteConversation` and, on success, clears `external_conversation_id`. A later provider webhook then finds nothing and is ignored by the existing code.
  4. The DPA lists the voice and LLM providers as sub-processors.
- **Partly different from SA.** SA proposed keeping `external_conversation_id` so a late webhook still finds the row, plus a guard. I keep it only until the provider delete succeeds, then clear it. The guard covers the window, and afterwards the existing "not found → return" path does the rest. This needs one column, not a separate "provider deleted" flag, and no queue kind.
- **Unverified.** Whether the provider's delete removes audio, transcript and backups (R19).
- **Change.** v3 sections 2.2, 2.3, 5, 11.1 item 10, tests, R8 and R19.

### R2.7 Major: turning on stage write-back pushed every earlier decision (UX-1, CR-2; also CR-10)

- **Disagreement.** `pushed_stage` started NULL, so switching write-back on, linking a job or adopting a row pushed every past decision within one tick. The 2-minute hold did not apply, because those decisions had no recent stage event. With "Not moving forward" mapped to a reject status, one toggle could email many candidates. CR-10: the "restore the earlier ATS status" path adds a column, reads and a race, and cannot undo what the ATS already did.
- **Evidence.** Confirmed in v2 section 7 and section 2.3.
- **Decision.**
  - **Baseline:** `pushed_stage` is set to the current stage when a link is created or adopted, and for all of a connection's links (one UPDATE) when write-back is switched on or its map changes. Only decisions made after that are sent.
  - **Copy:** "Decisions you make from now on are sent 2 minutes after you make them, so you can change your mind. Earlier decisions are not sent." (This also takes UX-8's copy fix.)
  - **Withdrawn after a push:** write a note "Decision withdrawn in HRVoice by <name>. Status in Zoho Recruit not changed." and set `pushed_stage` to the current stage. `stage_seen_at_push` and the restore are dropped (CR-10).
- **Not adopted now:** UX's "Send those N earlier decisions too?" option. It is easy to add (one UPDATE), but it puts an irreversible bulk choice into onboarding before any pilot has asked for it. Listed as V2.
- **Change.** v3 sections 2.3, 5 (adoption sets the baseline), 7, 12.2 step 5, 13.2, test "Baseline".

### R2.8 Minor objections

| Id | Objection (short) | Decision | Justification and change |
|---|---|---|---|
| IA-3, EIA-4, BE-4, UX-2 | First connect replays 7 days of `call.ended` | Accepted | The sweep emits only for calls ending after the earliest `created_at` of the org's connections that are not disconnected; a new connection's drain cursor starts at the org's current maximum `seq`. One condition and one column default; no backfill, and the copy says "results of calls from now on". v3 §6.1, §12.2 step 7, test "No backlog" |
| IA-4 | Linked contact fields read-only only in the UI | Accepted | `Candidates.update` refuses name, phone, email and resume edits on rows linked to a non-custom connection, with `candidates.managed_externally`. v3 §4, test |
| IA-5 | Anonymisation leaves the recording at the provider | Accepted | R2.6 |
| IA-6 | No retry policy for the `integration` kind; two probes at once | Accepted, simpler | Handlers own their expected retries through `Snooze`; POLICY `{5, 30}` covers only unexpected errors. One `drain:<connection>` job per connection makes concurrent probes impossible. v3 §6.1, §6.8 |
| IA-7 | Reconcile waits for stale expiry on stuck `active` calls | Accepted | The 5-minute loop also reconciles phone sessions still `active` past `voiceMaxPhoneMinutes + 2`. v3 §6.1 |
| AM-4, CR-7 | A connected call where nobody spoke became "result unavailable" | Accepted | A transcript settles a call; outcome `no_conversation` when no user turn exists, reusing the ledger's rule; reconcile targets only calls with no transcript. v3 §6.1, §7 note template |
| AM-5 | §6.1 and §6.8 disagreed on where the sweep runs | Accepted | The tick enqueues `sweep:<org>`; the lane runs it. v3 §2.2, §6.1 |
| AM-6, SA-12 | MCP authorization wording; static-key pilot | Accepted | Wording now quotes "Authorization is OPTIONAL ... SHOULD conform"; we choose OAuth before any write tool. The pilot uses a dedicated "AI assistant (read-only)" preset with no content and no contact details, expiry of 90 days or less, and tools built from the key's permissions. v3 §8, §11.1 item 2 |
| AM-7 | Ship the feed first; webhooks only if a pilot needs push | Accepted | Webhooks (`SafeHttp`, signing, rotation, test event, delivery list, sealed URL) become their own slice, gated on a pilot saying polling is not enough. Dev drops from 8-12 to 6-8 days. The ceiling (polling latency) is in R12. v3 §6.3, §12.1, §13.1 |
| AM-8 | Dispatcher must claim only human-queued rows; typed errors | Accepted | R2.3 |
| EIA-2 | Custom systems cannot withdraw or delete a person | Accepted | Optional `state: open \| closed` on `PUT` and batch rows; `DELETE /v1/candidates/by-external/{id}?job=` (needs `candidates.delete`) uses the same grace period and erasure path. Same column, same guard; seven routes. v3 §6.6 |
| EIA-3 | Batch shape does not fit the Kafka HTTP Sink | Accepted | Optional `job` per row overrides the top-level one; reference docs give `batch.prefix` / `batch.suffix` (FACT, Confluent docs, R2.0). v3 §6.6 |
| EIA-5, BE-7 | Dials share 2 lane threads with customer HTTP; pool size | Resolved by removal | Dials run on their own thread from `scheduled_calls` (R2.3). The pool-size check is in the Core definition of done. v3 §6.8 item 7 |
| EIA-6, BE-5(4) | Global `seq` shows platform-wide volume | Accepted, different mechanism | `seq` is per org: `max(seq) + 1` under the per-org emit lock that already exists. No `bigserial`, no leak, and the feed can detect expired cursors exactly. `seq` is also dropped from webhook bodies. v3 §2.3, §6.1, §6.3, §6.5 |
| EIA-7 | Unknown job on push; preset permissions unspecified | Accepted, refined | Presets written out exactly (v3 §11.1 item 2). An unknown job answers `409 job_not_found` rather than a 4xx that EventBridge drops, because EventBridge retries 409 (FACT, R1.0): a candidate event that arrives before its job succeeds on retry. A row-level unknown job is a row issue. The docs still advise a dead-letter queue |
| EIA-8, SA-8 | Trusting the first `X-Forwarded-For` entry | Accepted as a deployment rule | FACT (R2.0): Caddy ignores incoming `X-Forwarded-*` unless `trusted_proxies` is set. So the rule is: no `trusted_proxies` for client ranges; the Java port only on the Compose network; a deploy check that a spoofed header does not move the bucket on both the API host and the web `/backend` path (Next's behaviour is unverified). No code change. v3 §6.6, §11.1 item 12 |
| SA-3 | Answers can carry provider `rationale` | Accepted | R2.5 |
| SA-4 | Field-level sensitive-read audit on `/v1` | Accepted | `ExternalPayloads` writes one `authz.sensitive_access` per request when answers or PII are included, with `apiKeyId`; worker sends record a `content` flag on `integration.pushed`. v3 §6.2 |
| SA-5 | Webhook URL treated as plain config | Accepted (Webhooks slice) | The URL lives in `secrets_sealed`; the UI shows scheme and host; never logged. v3 §6.4 |
| SA-6, CR-9 | SafeHttp misses ranges; no port limit | Accepted, merged | IPv6 only inside `2000::/3` and not NAT64, 6to4, Teredo or documentation ranges; the IPv4 deny list adds 192.0.0.0/24, 198.18.0.0/15, 240.0.0.0/4 and broadcast; embedded IPv4 is checked; our own IPs and hostnames refused; port 443 only. **Not adopted:** optional 8443 (no customer has asked). v3 §6.4 |
| SA-7 | Key actions shown as the creator's own | Accepted | Activity shows "via API key '<name>'"; the audit CSV gets `api_key_id`. v3 §10 item 3 |
| SA-9 | CSV escaping misses tab and CR | Accepted | Escape `= + - @`, tab and CR; quote every cell. v3 §6.7 |
| SA-10 | Credentials in vendor URLs and error text | Accepted | Token requests as a form body (FACT, RFC 6749 §4.1.3); no URL with a query string in any exception; a test that a failed refresh leaves no token text in `last_error`. v3 §3, §11.1 item 6 |
| SA-11 | Sealer rotation half specified | Partly accepted | `INTEGRATIONS_KEY_CURRENT`; boot refuses a missing current key; a re-seal command per org in the `--desk.reembed` CLI style; an old key is removed after it reports zero rows. **Not adopted:** "refuse to boot if any version in use is missing". The rows are behind forced RLS with no bypass, so a boot-time cross-org read is impossible by design (FACT, `Db.java` line 33). A row with a missing version opens as "reconnect needed". v3 §11.1 item 1 |
| UX-3 | Raw stage values frozen into the public contract | Accepted | Public `decision` (`undecided`, `on_hold`, `moved_forward`, `not_moving_forward`) plus `decisionLabel`; the storage enum never leaves. v3 §4 |
| UX-4 | Webhook stage events have no hold | Accepted (Webhooks slice) | The same 2-minute hold, and an event is skipped if its `to` is no longer the current decision at send time, so a decide-then-undo sends nothing irreversible. The feed stays immediate. v3 §6.3 |
| UX-5 | Step 7 wording; A2 with no agent | Accepted | "Link an agent (needed to call) and add must-ask questions (recommended)"; agent pre-selected when the workspace has one published agent; "Call selected" disabled with a reason when the job has no agent. v3 §12.2, §13.1 |
| UX-6 | ATS-decided people stay in "Ready for review" | Partly accepted | The remote status is shown read-only on the row ("In Zoho Recruit: Interview"). Leaving such rows out of the queue is V2: it adds a second queue rule driven by the ATS, which touches founder decision 6. v3 §5, §12.2, §13.2 |
| UX-7 | CSV opens badly in Excel | Accepted, changed | UTF-8 BOM. Phone written as `91 98765 43210`, without a leading `+`. UX proposed `+91 98765 43210` without escaping, but a leading `+` is itself a formula trigger (FACT, OWASP list, R2.0). Rendering in Excel and Sheets is unverified and is a slice-A check. v3 §6.7 |
| UX-8 | Copy and placement | Accepted | "so you can change your mind"; A2 is "Call selected (N)" in the bulk bar with "Select everyone not called yet" (matches `docs/superpowers/specs/2026-10-01-saas-redesign-design.md` line 202); skipped rows show their reason. v3 §12.2, §13.1 |
| BE-2 | Stale `from` and lock order in the stage outbox | Accepted | `previous` read with `FOR UPDATE`; every emitting transaction takes the org events lock first, so the lock order is always org lock, then rows. v3 §6.1, test "Stage outbox" |
| BE-3, CR-5 | A2 cannot tell errors apart | Accepted | R2.3 |
| BE-5 | Fan-out cursor, per-event jobs, expired cursors, `seq`, retried bodies | Accepted | `fanout_seq` per connection; one `drain:<connection>` job; `410 cursor_expired`; per-org `seq` (EIA-6); docs say receivers keep the latest `call.version`. v3 §6.1, §6.3, §6.5 |
| BE-6 | Lane work under RLS; POLICY; dead reconcile rows re-enqueued | Accepted / removed | Round-robin in-memory set of orgs fed by `wake()` and the 30-second poll; POLICY `{5, 30}`. Reconcile is no longer a queue job (CR-6), so dead `reconcile:` rows cannot occur. v3 §6.1, §6.8 |
| BE-8 | Sweep has no supporting index | Accepted | Filter on `started_at > now() - 8 days` (existing index), `ended_at` as a residual filter; `ponytail:` note naming the `result_dirty` upgrade. v3 §6.1 |
| CR-3 | 30-day purge versus long outages; a wrong sentence | Accepted | Sentence removed. Delivery is a per-connection cursor, so a recovered connection resumes where it stopped. When the purge drops events a connection had not sent, it moves that cursor and sets `missed_until`, and the card says so. v3 §6.1, §12.2 |
| CR-4 | Two queues for one thing | Accepted | R2.3 |
| CR-6 | Background reconcile should not need a connection | Accepted, **reversing R1.4's "not adopted"** | Round 1 kept it connection-only to avoid changing behaviour for customers who did not ask. That reason was weak: the only visible change is that missing results appear without someone opening the page. A2 places calls nobody watches, so slice A's CSV and the Home queues need it. It now runs inside the existing 5-minute `expireStale` loop for every org: no queue job, no lane, no dead rows. v3 §6.1, §13.1 |
| CR-8 | Anonymising after an ATS deletion can destroy a merged record's results | Accepted | Before anonymising, `getApplication` must return `NotFound`, or the link goes back to `open`. Rows whose link is `deleted` count as unlinked for phone-match adoption, so a merge's surviving record re-links to the existing row instead of importing a duplicate that A2 would call again. Pending anonymisations are shown on the card. Zoho merge behaviour is unverified. v3 §5 |
| CR-10 | Drop the stage-restore path | Accepted | R2.7 |

### R2.9 Where I disagreed with a reviewer

- **AM-1's "better fix"** (per-call overrides on the phone path) does not carry the per-job data-collection questions, so it would still mis-map answers (R2.4).
- **BE-3's "`provision_failed` → retry with backoff"** would hammer the vendor once per queued row; skipping the job's remaining rows with one reason is bounded (R2.3).
- **SA-11's boot check** of every key version in use cannot run across orgs under forced RLS (R2.8).
- **UX-7's phone format** would trigger formula parsing with its leading `+` (R2.8).
- **UX-1's backfill option** and **UX-6's queue exclusion** are deferred to V2 rather than built now (R2.7, R2.8).
- **EIA-7:** `409 job_not_found` instead of a plain 4xx, because EventBridge retries 409 (R2.8).
- **SA-6:** port 8443 not adopted (R2.8).
- **CR-6:** I reversed my own round-1 decision (R2.8).

### R2.10 Things I could not resolve in this round

1. **Vendor behaviour, all unverified:**
   - whether the voice provider binds a phone call's config at the dial request or when the person answers (R18);
   - whether its conversation delete removes audio, transcript and backups (R19);
   - whether a summary instruction can be configured at all.

   Each needs a supervised live check or a written answer from the vendor.
2. **Legal:**
   - whether "Call selected (N)" is an "auto-dialer" under TCCCPR (decision 10a);
   - whether we are a DPDP processor;
   - the retention and anonymisation grace periods (decision 9).
3. **Automatic inbound for an unknown system** still depends on founder decision 1. If no pilot uses an ATS or has a developer, the MVP is 0, A and A2.
4. **Small build-time checks:** how Next's `/backend` rewrite forwards `X-Forwarded-For`, and how Excel and Google Sheets show the CSV phone format.
5. **Outside integration scope:** the in-app summary is the vendor's (founder decision 14).
6. **ADR-010** is still not written. It remains a gate for Core and should record R2.2, R2.3 and R2.6 once the founder accepts v3.

## Round 3

Date: 2026-10-03. Input: `architecture-draft-v3.md` and seven reviews: IA and SA "approve with changes"; AM, EIA, UX, BE and CR "block". Output: `architecture-draft-v4.md`.

Reviewer codes as before. "BE-3" means the Backend / Distributed Systems Architect's round-3 objection 3.

### R3.0 Evidence I re-checked myself for this round

All FACT. Line numbers are as of 2026-10-03.

- **Hosted agents.** `voice_provider_deployments` has one row per (agent version, provider, environment): unique index `vpd_version_provider_env_unique` (`MIG/0013_elevenlabs_foundation.sql` lines 72-74). `provisionLocked` looks that row up by version and re-syncs the one hosted agent when the compiled hash differs (`JAVA/voice/VoiceSessions.java` lines 154-219). `HostedVoiceAdapter.provision` creates a new hosted agent when it is given no id and creates no knowledge-base document per sync (`JAVA/voice/HostedVoiceAdapter.java` lines 59-75). The version advisory lock wraps provision and dial only; the org's concurrency and daily caps are checked inside it (`VoiceSessions.java` lines 375, 385-392). `voice_sessions.deployment_id` is `ON DELETE RESTRICT` (`MIG/0013` line 70), and nothing deletes deployment rows today (grep).
- Local Compose runs `pgvector/pgvector:pg16` (`docker-compose.yml` line 5), so `NULLS NOT DISTINCT` (Postgres 15+, https://www.postgresql.org/docs/16/sql-createindex.html) is available.
- ElevenLabs: "There is no limit to the number of agents you can create on any plan. You are only limited by the number of concurrent calls available on your plan" (https://elevenlabs.io/pricing/agents, fetched 2026-10-03). The same page lists 4 concurrent calls on Free up to 40 on Business.
- **Scheduler.** "The ThreadPoolTaskScheduler uses one thread by default" (https://docs.spring.io/spring-boot/3.4/reference/features/task-execution-and-scheduling.html). `apps/api-java/pom.xml` line 9: Spring Boot 3.4.5. `application.yml` has no `spring.task.scheduling` key and no code defines a `TaskScheduler` (grep). Three `@Scheduled` methods share that thread: `JobQueue.poll` (line 87, runs jobs inline), `DocumentProcessor` (line 248), `VoiceSessions.expireStale` (line 678). The voice adapter uses 10 s connect and 30 s read timeouts (`HostedVoiceAdapter.java` lines 46-47).
- **Queue.** `JobQueue`: the claim takes `queued` rows with `run_at <= now()` and `running` rows whose `locked_until < now()`; `CLAIM_SECONDS = 900`; `enqueue` is `ON CONFLICT ... DO NOTHING` (`JAVA/jobs/JobQueue.java` lines 39, 66-75, 116-134).
- **Identity.** `AuthResolver.resolve` refuses a session whose user is not `active` (line 44); `membership()` filters only `m.status = 'active'` (lines 59-80); `Organizations.validateMembership` also requires `o.status = 'active'`. `organizations.status` is free text with no CHECK (`MIG/0000_initial_schema.sql` line 61). `Actor.isOwner()` reads `roleKey` (`JAVA/authz/Actor.java` lines 25-26). `AgentRuntime` re-reads permissions from `role_permissions` by user id (`JAVA/runtime/AgentRuntime.java` lines 169-174).
- **Deletion.** `Organizations.remove` hard-deletes the organization at once (`JAVA/team/Organizations.java` lines 100-107); voice tables cascade on `organization_id` (`MIG/0013` lines 54, 62). `Candidates.delete` is a plain `DELETE` (`JAVA/hiring/Candidates.java` lines 126-131).
- **Dial errors.** `HostedVoiceAdapter.dial` catches its own exceptions and returns a refused dial with a reason guessed from the error text (lines 253-272); `dialLocked` then marks the session `failed` with no conversation id (`VoiceSessions.java` lines 441-449). The webhook ignores a conversation id it cannot find (line 639). "Started" events update only `pending` sessions (line 669); an initiation failure never touches an `ended` one (line 655).
- **Labels.** `usecases/hiring.json` line 19 labels `new` "Not called yet"; `apps/web/lib/use-case-definitions.ts` drops that label on purpose (lines 53-59). No Java code reads stage labels (grep).
- **Retry rows.** `apply` inserts `scheduled_calls` retry rows when `callPolicy.retry.enabled` is on (`VoiceSessions.java` lines 572-596); one open row per candidate (`MIG/0025` index `scheduled_calls_one_open_per_candidate`); nothing dispatches them (grep).
- `Db` sets no transaction isolation, so Postgres's default READ COMMITTED applies (`JAVA/platform/Db.java` lines 42-48).
- `/health` already reports `jobsBacklog` (`JAVA/platform/HealthController.java` line 38). Actuator is on the classpath but `management.endpoints.web.exposure.exclude: "*"` (`application.yml`), and there is no Prometheus registry in `pom.xml`.
- ElevenLabs: "By default, ElevenLabs retains conversation data for 2 years", configurable per agent in days (https://elevenlabs.io/docs/eleven-agents/customization/privacy/retention). `HostedVoiceAdapter.agentBody` sets no retention (lines 81-101).
- Zoho's OAuth redirect is `{redirect_uri}?code={grant_token}&location=us&accounts-server=https://accounts.zoho.com` (https://www.zoho.com/recruit/developer-guide/apiv2/multi-dc.html).
- MCP: "clients MUST consider tool annotations to be untrusted unless they come from trusted servers" (https://modelcontextprotocol.io/specification/2026-07-28/server/tools).
- `now()` is the transaction's start time (https://www.postgresql.org/docs/current/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT).

### R3.1 Failed checks

| Check | Failed by | Cause | Status after v4 |
|---|---|---|---|
| `results_flow_back` | EIA, BE, CR | Per-org `seq` restarted at 1 after a quiet month's purge, so drains and feed cursors stopped silently (all three). One poison event stopped a connection's notes (BE) | **Resolved** by R3.2 (the purge keeps each org's newest event) and R3.5 (next-event probe) |
| `works_for_saas_and_custom` | AM | Reported honestly, not as an objection: neither the connector nor the developer surface is usable until a pilot names its system | **Unchanged by design.** This is founder decision 1, and gating E and Dev on a pilot was itself a round-1 decision (R1.9). Slices 0, A and A2 serve every customer meanwhile |

### R3.2 Major: event numbering restarted after the purge (EIA-1, BE-1, CR-1)

- **Disagreement.** `seq` = `max(seq) + 1` per org, and the daily purge deleted every event older than 30 days. An org with no calls or decisions for 30 days lost all its rows, and the next event got `seq` 1. Drains were enqueued only when the org's maximum was above a connection's `fanout_seq`, so notes stopped. Feed clients holding a higher cursor got empty pages, and the `410` rule did not fire because their cursor was newer, not older. The v3 "Purge" test set up exactly this state without checking later delivery. This came from round 2's acceptance of EIA-6 with a different mechanism (R2.8).
- **Evidence.** Confirmed in v3 sections 2.3, 6.1 and 6.5. The rule "a rolled-back number is reused" also means `seq` has no gaps.
- **Decision.** Keep per-org `seq`. The purge never deletes an org's newest event (one extra condition, `seq < (SELECT max(seq) FROM integration_events)`, with RLS scoping the subquery to the org). `max(seq)` then never goes down. The `410` rule becomes `after < min(seq) - 1`, which is exact because `seq` has no gaps.
- **Why.** It is one WHERE clause. CR's alternative (a global `bigserial` with a sealed cursor) re-opens the volume leak that round 2 closed. BE's alternative (a per-org counter table) adds a table and a write per event to solve the same problem.
- **Change.** v4 sections 2.3 (`integration_events`), 6.1 (ordering lock, purge), 6.5 (contract), 11.1 test "Purge and the quiet month".

### R3.3 Major: the shared hosted agent made jobs wait for each other (AM-1, UX-2, CR-2; also IA-4, EIA-5)

- **Disagreement.** v3 fixed the wrong-script race (R2.4) with a guard that refused a re-sync while any call on the same agent version belonged to another job. All five reviewers agree the guard is safe. The problem is its product effect: the normal setup is one published agent shared by every job, so while a batch for job A keeps a call live, every manual call, browser test and queued row for job B is refused, for hours. The error text ("try again when that call ends") was also wrong.
- **Evidence.** Confirmed (R3.0): one deployment row per agent version, re-synced on a hash change; the agent carries no JD by design (`docs/ARCHITECTURE.md` lines 10-12); `provision` already creates a new hosted agent when no row exists; the provider sets no limit on the number of agents.
- **Decision.** Remove the shared state instead of guarding it: **one hosted agent per (agent version, job)**.
  - A2 adds a nullable `voice_provider_deployments.job_id` and replaces the unique index with `UNIQUE NULLS NOT DISTINCT (agent_version_id, job_id, provider, environment)`. `provisionLocked` looks up `job_id IS NOT DISTINCT FROM ?`; the upsert's conflict target follows. Browser tests without a job use the `job_id NULL` row.
  - The advisory lock stays **per agent version, unchanged**. It is held only until `voice.dial` returns, so different jobs wait seconds for each other, never a call's length. Keeping it also keeps the org's concurrency check serialised for a shared agent; a per-(version, job) lock would let two dials pass the cap check at once.
  - The guard stays, limited to the same deployment: it fires only when a job's own JD or questions change during one of its own live calls, and clears within one call. New message: "This job's questions or description changed while one of its calls was in progress. Calls start again when it ends."
  - Within one org, queued rows now take turns between jobs (ordered by how many of that job's rows were dialed today), so a 200-person batch does not hold a second job's batch for days behind the daily cap. This was IA-4's optional point; it is one ORDER BY term.
- **Partly different from the reviewers.** CR proposed keying by (agent version, job context hash). That creates a new hosted agent on every JD edit and leaves the same-job case unchanged, so I key by job and update that job's agent in place. AM and CR proposed a per-(version, job) lock; not adopted (above). EIA-5's extension of the guard to recently ended calls is not adopted: with per-job agents another job can no longer affect a call, and the same-job case is recorded as residual risk R18.
- **Cost.** One small additive migration in A2, so v3's "A2 needs no migration" claim is dropped. Hosted agents of closed jobs are not deleted (`ponytail:`), the same as hosted agents of old versions today.
- **Change.** v4 sections 2.2, 2.3, 13.1 (A2 detail and definition of done), 11.1 test "Per-job hosted agents", R18, founder decision 10a, section 17.

### R3.4 Major: slice A2 put provider HTTP on Spring's single scheduler thread (BE-2; also IA-2, EIA-2, CR-3)

- **Disagreement.** A2 runs up to 5 provider fetches per org, plus a possible LLM extraction each, inside `expireStale`. v3 listed `spring.task.scheduling.pool.size: 3` under Core and said "Slice A2 needs none of these". With the default single thread, a provider outage (up to 40 s per fetch) would delay `JobQueue.poll`'s email and document safety net, the document sweep and the A2 dial nudge.
- **Evidence.** Confirmed (R3.0): Boot 3.4.5, no pool configured, the documented default is one thread, and `poll` runs jobs inline.
- **Decision.**
  - The pool size of 3 ships **with A2**, as part of its definition of done, with the connection-pool check.
  - Each reconcile run has a budget: stop after 60 seconds in total or at the first provider timeout or 5xx; a `voice.reconcile` timer records each run.
  - The dial thread waits on its own 15-second timer instead of a `@Scheduled` nudge (IA's suggestion), so it never queues behind the scheduler.
- **Not adopted now.** BE's `pg_try_advisory_xact_lock` per org for a second replica: deployment is a single VPS (ADR-006). Recorded as a `ponytail:` note with the upgrade path.
- **Change.** v4 sections 6.1, 6.8 items 4, 7 and 8, 13.1 (A2 dispatcher and definition of done), 11.1 test "Reconcile budget".

### R3.5 Major: one bad event could stop a connection's notes (BE-3)

- **Disagreement.** The drain advanced only on success or a permanent 4xx. An event the vendor always times out or answers with 5xx (an oversized note, a broken record) blocked every later note for that customer until the 30-day purge.
- **Evidence.** Confirmed in v3 section 6.1. Strict order is not needed for notes (each note is about one call), and stage write-back is a separate, level-triggered path.
- **Decision.** A next-event probe, not a timer. From the third failure of the same head event, the run sends the head and then the next event once. Head fails and next succeeds: the head is recorded `failed` with its error code, the cursor passes both, and the card says "1 call result couldn't be sent to Zoho Recruit. Open it in HRVoice." Both fail: it is an outage, and the existing backoff applies with nothing marked failed.
- **Partly different from BE.** BE proposed giving up on the head after 24 hours or N attempts. During a vendor outage longer than that, every event would be marked failed one after another. The probe tells "this event is bad" apart from "the vendor is down" with one extra request. No per-event resend for now (`ponytail:`; V2 if a pilot asks); the result stays readable in HRVoice.
- **Change.** v4 section 6.1 (drain step 7), section 12.2 card lines, R21, 11.1 test "Poison event".

### R3.6 Major: the events feed delivered decisions that were undone (UX-1; also CR-7)

- **Disagreement.** v3 gave webhook stage events a 2-minute hold and skipped superseded ones, but kept the feed "immediate and complete". Webhooks moved to a later slice, so the feed is the only channel the Dev slice ships, and Pabbly, Zapier, Make and n8n users are told to poll it. A per-item workflow ("not moving forward → send a rejection email") would act on a decision someone undid 8 seconds later. Feed semantics freeze once `/v1` ships (R12).
- **Evidence.** Confirmed: Undo lasts 8 s (`apps/web/components/ui/toaster.tsx` line 78) and re-posts the earlier stage, which emits a second event. R2.8 (UX-4) kept the feed immediate on the assumption that webhooks would carry the push case.
- **Decision.** Both of UX's parts, because neither works alone:
  - **Hold:** the feed returns only events below the lowest `seq` of any event created in the last 2 minutes. The cut is on `seq`, because `created_at` is the transaction start time and is not monotonic in `seq`; cutting on `seq` keeps order and at-least-once delivery.
  - **`superseded: true`:** bodies are built at read time; a stage event whose `to` is not the current decision is flagged. The docs tell consumers to act only on `superseded: false`.
  - A hold alone still shows both events to a poller that acts on each; a flag alone fails for a poller that reads within the 8-second Undo window.
- **Not adopted.** Omitting superseded events. That would break the feed's completeness and show consumers a reversal of a decision they never saw.
- **Change.** v4 sections 6.3, 6.5, R20, 11.1 tests "Feed ordering and hold" and "Undo".

### R3.7 Minor objections

| Id | Objection (short) | Decision | Justification and change |
|---|---|---|---|
| IA-1 | Deleting an ATS-linked person locally lets the next pull import them again | Accepted, option (a) | `Candidates.delete` refuses rows linked to an ATS connection with `candidates.managed_externally` ("Remove them in Zoho Recruit"). It is the same guard as edits (R2.8, IA-4), with no schema change. Rejecting or deleting them in the ATS closes or removes the row within one pull, and closed or deleted rows cannot be dialed. Custom-linked rows stay deletable, and a later `PUT` re-creates them (documented). Option (b), a tombstone link, needs an FK change and a skip rule, and leaves a person re-added by hand unlinked. v4 §2.3, §4, test "Linked fields" |
| IA-2, EIA-2, CR-3 | Scheduler pool belongs in A2 | Accepted | R3.4 |
| IA-3, AM-2, EIA-3, BE-6, CR-4 | The dedupe hash includes the summary, which never leaves | Accepted | Hash = `md5(status, failure_reason, transcript is not null, has a user turn, structured_answers)`. Raw answers stand in for scrubbed ones, because scrub is deterministic. The note marker hashes the rendered note text, so an unchanged note is never written twice. v4 §6.1, §7 |
| IA-4, EIA-5 | Shared-agent guard starves other jobs | Accepted | R3.3 |
| IA-5, EIA-4, SA-3(b), CR-6 | Workspace deletion skips the erasure path and token revocation | Accepted, two-phase | `DELETE /organization` sets `status = 'deleting'` (free text, no migration) and disconnects every connection. Access stops at once through the `membership` guard (SA-1). The existing 5-minute loop erases content, deletes provider conversations within its budget, then runs the existing hard delete (or after 7 days of provider failures, logged). This reuses the erasure loop; an account-scope queue kind would need a new kind, POLICY and handler. Hosted agents are not deleted: they hold job text, not candidate data. v4 §11.1 item 10, test "Workspace deletion" |
| AM-3 | MCP endpoint versus "keys only on `/v1`" | Accepted | The endpoint is `/v1/mcp` (Streamable HTTP), so the existing branch and invariants apply unchanged. Tools carry read-only annotations as a hint only (FACT: annotations are untrusted by spec); the control is the preset. The key screen says what goes to the customer's AI assistant. v4 §8 |
| AM-4 | Evaluative must-ask questions produce judgements as "answers" | Accepted | A soft wording hint when questions are saved (web only, slice 0); recorded as residual risk under R3. No blocking rule. v4 §12.2, §13.1, R3 |
| EIA-6 | Non-bulk `scheduled_calls` rows could block bulk queuing | Accepted, simpler | Slice 0 makes `UseCase` validation refuse `callPolicy.retry.enabled: true` while nothing dispatches retry rows. Then no such row can exist. This is simpler than cancel-on-queue or a boot check, and it matches founder decision 10 (automatic retry needs a written decision). `ponytail:` remove it when a retry dispatcher is built. v4 §13.1 |
| EIA-7 | No visibility of delivery lag or queued calls | Accepted, simpler | Two numbers on `/health` next to `jobsBacklog`: `oldestUndeliveredMinutes` and `oldestQueuedCallMinutes`, with a 30-minute alert. Gauges were not adopted: no metrics backend is exposed today (R3.0). v4 §6.8 item 8 |
| SA-1 | Key validity misses user suspension and workspace status | Accepted at the root | `AuthResolver.membership` itself requires `users.status = 'active'` and `organizations.status = 'active'`. One guard covers sessions, keys and the A2 dial thread, and makes the `deleting` state work. v4 §10 item 1, tests |
| SA-2 | The key/creator intersection depends on services using `Actor.permissions` | Accepted | A key's `Actor` carries the synthetic `roleKey` `api_key` (`roleIsSystem = false`), so `isOwner()` is always false. ADR-010 rule: no `role_permissions` re-read on paths reachable from `/v1`. A grep test fixes the list of files allowed to read that table. v4 §10 items 3-4 |
| SA-3(a) | The provider keeps conversations for 2 years by default | Accepted | Each hosted agent gets a retention of our period (founder decision 9) plus 7 days, inside the compiled hash. It cannot be shorter, because recordings are streamed from the provider. The API field name is unverified. v4 §11.1 item 10, R19, §17 |
| SA-4 | The default inbound key can delete | Accepted, partly | `candidates.delete` only through an explicit "May remove people" checkbox. **Not adopted now:** a "Cancel removal" button. A `PUT` for that external id during the grace period sets the link back to `open`, which needs no new UI. V2 if asked. v4 §6.6, §11.1 item 2, §12.1, §13.2 |
| SA-5 | External ids may be personal data | Accepted, changed | Docs require opaque ids. The API rejects ids containing `@`, or whose digits equal the phone in the same body (`external_id_personal`). `/v1` audit metadata stores the route template. On anonymisation `external_id` becomes its SHA-256. **Not adopted:** rejecting any id with 8 or more digits, because numeric database ids that long are common (ASSUMPTION) and would be refused. **Also not claimed:** that the hash blocks a re-insert. A later `PUT` with the same id after erasure should create a new person. v4 §6.6, §11.1 item 10 |
| SA-6 | Zoho callback hosts can be forged | Accepted | Verify and consume `state` first; map `location` to fixed hosts; refuse a mismatched `accounts-server`; never use an `api_domain` outside the allowlist; a test with a forged host. v4 §11.1 item 4 |
| SA-7 | Sub-processors incomplete; disconnect revoked with a deleted token | Accepted | The DPA lists the telephony carrier, hosting, object storage and SMTP as well. The token is opened in memory before the transaction and revoked after commit, with an admin line if that fails. v4 §5, §11.1 item 10 |
| SA-8 | Sensitive-read audit can be lost | Accepted, partly | For request-built bodies with answers or PII, the audit row is written first through a throwing variant, with `503` on failure. **Not adopted now:** the per-minute rollup (`ponytail:`). v4 §6.2 |
| SA-9 | Notes should be plain text | Accepted | Control characters (except new lines) and `<` `>` are removed from all outbound free text. Stripping is used instead of escaping, because whether Zoho renders HTML is unverified. A forbidden-content fixture is added. v4 §6.2 |
| SA-10 | Legacy unsigned-timestamp webhook header | Accepted, interim already true | Drop `xi-signature-256` once a live call confirms `ElevenLabs-Signature`. The interim measure SA asked for already exists: "started" updates only `pending` sessions and an initiation failure skips `ended` ones (R3.0). v4 §11.1 item 11 |
| UX-3 | `decisionLabel` for `new` would read "Not called yet" | Accepted | Slice 0 changes `hiring.json`'s label to "No decision yet", plus a test that no outbound `decisionLabel` equals a call-state label. No Java code reads stage labels, and the web already shows this wording (R3.0). v4 §4, §13.1 |
| UX-4 | The A2 dialog hides the caps; a batch starves manual calls | Accepted | The dialog computes "Up to 2 calls at a time from this batch and 50 a day. 200 people take about 4 days." The dispatcher dials only below `max(1, cap - 1)` live calls; `max` keeps a cap of 1 from stopping batches. The board shows "Queued to call (37 left, next call after 10:00 tomorrow)". v4 §13.1 |
| UX-5 | Jobs without questions send content-free notes | Accepted | A hint on linked jobs and on the results-CSV button: "Add must-ask questions. Only their answers are sent to Zoho Recruit." Web copy only. v4 §12.2 |
| UX-6 | No confirmed way to re-call people who didn't connect | Accepted | "Select everyone who didn't connect" feeds the same confirmed batch: still one click per batch, each row dialed at most once, no new backend. v4 §13.1 |
| UX-7 | "Paused until" shown as a removed state; `connecting` has no copy | Accepted | The card label is derived from `status`, then `rate_limited_until`, then "Connected", with "Finish connecting" copy for `connecting`. v4 §12.2 |
| BE-4 | A drain run can outlive the 900-second lease | Accepted | Budget of 20 events or 120 seconds per run, then `Snooze(0)`; compare-and-set on `fanout_seq`. v4 §6.1 |
| BE-5 | Retry cannot wake a snoozed drain | Accepted | Retry sets the queued row's `run_at` to now, then wakes it. v4 §6.4 |
| BE-7 | Reconnect after a disconnect is undefined | Accepted | `connected_at` is set on create and on every reconnect, and is the sweep's floor. A reconnect also sets `fanout_seq` to the org's current maximum, so a reconnect behaves like a first connect. v4 §2.3, §6.1 |
| BE-8 | A dial error on our side is reported to the ATS as a call outcome | Accepted | A call is settled only when it has an `external_conversation_id`. Refused or failed dials stay inside HRVoice. This removes a false "Call didn't connect" for calls that may have happened. v4 §1 item 6, §6.1, test "Dial error" |
| BE-9 | The pull high-water mark can miss records when pages shift | Accepted | The next `If-Modified-Since` is the previous scan's start time minus 2 minutes; the nightly reconcile stays the backstop. v4 §5 |
| BE-10 | Writes to `last_used_at`; pool sizing | Accepted | `last_used_at` at most once a minute. The pool formula counts the dial thread's two connections and the token-refresh lock, and is checked in A2. v4 §2.3, §6.8 item 7 |
| CR-5 | The ATS "closed" state may be stale at dial time | Accepted | Incremental pulls update `remote_status_seen` and `remote_state` for every linked application whatever its status; the trigger status applies only to new imports. FakeAts test "Closed in the ATS". v4 §5 |
| CR-7 | The feed has no Undo hold | Accepted | R3.6 |
| CR-8 | `Sealer` built before anything needs it | Accepted | It moves to whichever of E or Webhooks ships first; the Dev slice stores only hashed keys. Slice 0 drops to 3-5 days. v4 §2.2, §11.1 item 1, §13.1 |
| CR-9 | Effort; per-org loop cost | Accepted | Core + E together re-estimated at about 6-8 weeks, the number to use before giving a pilot a date. The tick and the dial thread visit only orgs in in-memory due sets, fed by connect or click and filled once at startup (`ponytail:` per replica). The existing 5-minute loop already visits every org and is unchanged. v4 §6.8, §13.1 |

### R3.8 Where I disagreed with a reviewer

- **IA-1:** option (a), refusing the delete, rather than (b), the tombstone. Same guard as edits, no schema change, and the ATS stays the record of whether the person exists (R3.7).
- **AM-1, CR-2:** the advisory lock stays per agent version, not per (version, job). Keying is by job, not by job context hash (R3.3).
- **EIA-5:** the guard is not extended to recently ended sessions (R3.3).
- **BE-3:** a next-event probe, not a 24-hour or N-attempt cut-off, which would mark events failed during a long outage (R3.5).
- **BE-2:** no per-org try-lock until there is a second replica (R3.4).
- **UX-1:** events are flagged `superseded`, not omitted (R3.6).
- **EIA-6:** retry is refused at definition load, rather than cancelling rows at queue time (R3.7).
- **EIA-7:** two `/health` numbers instead of Micrometer gauges (R3.7).
- **SA-4:** no "Cancel removal" button yet; a `PUT` restores (R3.7).
- **SA-5:** no "8 or more digits" rejection; no claim that the hash blocks a re-insert (R3.7).
- **SA-8:** no per-minute audit rollup yet (R3.7).
- **AM's failed check** (`works_for_saas_and_custom`) is a gating decision, not a design defect (R3.1).

### R3.9 Things I could not resolve in this round

1. **Vendor behaviour, unverified:**
   - when the voice provider binds a phone call's config (now only relevant for same-job edits, R18);
   - whether its conversation delete removes audio, transcript and backups (R19);
   - the API field for per-agent retention, and whether it can apply to existing conversations;
   - whether Zoho renders notes as HTML;
   - whether Zoho's offset pages shift under concurrent changes.
2. **Legal, unchanged:**
   - whether "Call selected (N)" is an auto-dialer under TCCCPR (decision 10a);
   - the DPDP processor role;
   - the retention and grace periods (decision 9), which now also set the provider-side retention.
3. **Automatic inbound** still depends on founder decision 1 (R3.1).
4. **Assumption to check:** that numeric external ids of 8 or more digits are common enough to make SA-5's digit rule harmful (unverified; it only affects the rule I did not adopt).
5. **ADR-010** is still not written. It should record R2.2, R2.3, R2.6, R3.2, R3.3 and the `/v1` permission rule (SA-2) once the founder accepts v4.

## Round 4

Reviews of `architecture-draft-v4.md`: Integration Architect (IA) **block**, AI Agent / MCP Architect (AM) approve with changes, Enterprise Integration Architect (EIA) **block**, Security Architect (SA) approve with changes, Product / UX Architect (UX) approve with changes, Backend / Distributed Systems Architect (BE) **block**, Critical Reviewer (CR) **block**. Two majors: IA-1 (the A2 index change breaks Nest), and one raised by EIA, BE and CR (shared voice-provider capacity). Result: `architecture-draft-v5.md`. No code, config, migration or test was changed.

### R4.0 Evidence I re-checked myself for this round

- **Nest and the deployments table.** FACT: Nest looks up a deployment by version, org, provider and `environment = ${environment}` (default `'test'`) and takes `rows[0]` (`apps/api/src/providers/elevenlabs/voice-session.service.ts` lines 253-270); it PATCHes the hosted agent through `provisionAgent` with `existing?.external_agent_id` before its upsert (lines 674-714); the upsert is `insert ... values (..., 'elevenlabs', 'test', ...) on conflict (agent_version_id, provider, environment) do update` (lines 726-733). Java does the same with `environment = 'test'` (`JAVA/voice/VoiceSessions.java` lines 171-173, 200-203). `environment` is `text NOT NULL DEFAULT 'test'` with **no CHECK** (`MIG/0013_elevenlabs_foundation.sql` line 24), and the unique index is `vpd_version_provider_env_unique (agent_version_id, provider, environment)` (lines 72-74). Nothing else in either API reads the table (grep); the web only types `environment` in `VoiceDeployment` and never displays it (`apps/web/lib/api.ts` line 662). Drizzle declares the same index (`packages/db/src/schema/voice.ts` line 61).
- **Dial refusals.** FACT: `HostedVoiceAdapter.dial` sends one global `voicePhoneNumberId` and catches every `RuntimeException` into `fromDialFailure(raw)` (lines 253-272); `CallOutcomes.fromDialFailure` has no pattern for 429, `too_many_concurrent_requests` or `system_busy` (`\bbusy\b` does not match after `_`), so it returns `unknown` (`JAVA/engine/CallOutcomes.java` lines 22-46). `dialLocked` inserts `agent_sessions` and `voice_sessions` before the dial, then `markFailed` and a ledger row on refusal (`VoiceSessions.java` lines 413-457); `counts()` counts every phone session started today, whatever its status (lines 263-280).
- **Provider capacity.** FACT: the agents plans allow "Free 15 minutes / 4 concurrent calls; Starter 75 / 6; Creator 275 / 10; Pro 1,238 / 20; Scale 3,738 / 30; Business 12,375 / 40" (https://elevenlabs.io/pricing/agents). "Calls exceeding the burst limit are rejected with an error, unless call queueing is enabled for the agent"; burst is "configured per agent" and charged "at double the standard rate" (https://elevenlabs.io/docs/eleven-agents/guides/burst-pricing). The 429 article documents `too_many_concurrent_requests` ("exceeded the concurrency limit for your subscription") and `system_busy` ("your request could not be processed ... if you retry the request, it will succeed") for the general API (https://help.elevenlabs.io/hc/en-us/articles/19571824571921-API-Error-Code-429). Whether the outbound-call endpoint uses 429 for this: unverified. "Delete an agent" is documented (https://elevenlabs.io/docs/api-reference/agents/delete).
- **Production.** FACT: the root `Dockerfile` runtime is `CMD ["node", "apps/api/dist/main.js"]` (line 61); `docker/Caddyfile` routes `/webhooks/*`, `/health`, `/backend/*` (with `uri strip_prefix /backend`) and `/api/auth/*` to `api:3001`, and its header says they "are routed to the Nest API"; there is no Java image or Compose service (`find` for Dockerfiles; grep of compose files for `java`/`3002`). `docker-compose.prod.yml` sets `TRUST_PROXY: "true"` and `RATE_LIMIT_MAX` default 1200 (lines 28-29).
- **Audit table.** FACT: `REVOKE UPDATE, DELETE ON "audit_events" FROM platform_app` (`MIG/0003_rls_hardening.sql` line 51). `AuthInterceptor` writes `uri` = path + `?` + query into `authz.denied` and `authz.sensitive_access` (`JAVA/authz/AuthInterceptor.java` line 52).
- **Permissions.** FACT: `candidates.delete` is held only by Owner and Administrator; Recruiter holds `candidates.export`, `candidates.read_pii` and `integrations.read` (`JAVA/authz/Permissions.java` lines 101-131). The matrix withholds `candidates.export` from Analysts because "a CSV export is the easiest path to bulk PII leaving the system" (`BRD's/11_PERMISSION_MATRIX.md` line 133).
- **Retrieval and the hash.** FACT: `Retriever.retrieve` catches any `RuntimeException` and returns outcome `failed` with no chunks (`JAVA/rag/Retriever.java` lines 76-89); the compiler packs chunks only when the outcome is `"ok"` (`JAVA/engine/CallContextCompiler.java` line 157) and hashes the whole canonical context (line 248).
- **Stage history.** FACT: `Jobs.stageHistory` selects `coalesce(nullif(u.name, ''), u.email::text) as "actorName"` and returns raw `previous`, `status` and `reason` (`JAVA/hiring/Jobs.java` lines 273-295). `Jobs.callStatus` maps `ended` without a failure reason to `completed`, and `queue` maps `completed` to "Ready for review" (lines 170-178, 430-437).
- **Lock timeout.** FACT: only `Db.underAdvisoryLock` maps SQLState 57014 to a 409 (`JAVA/platform/Db.java` lines 103-115); `statement_timeout` defaults to 15,000 ms (`JAVA/platform/Env.java` line 89).
- **Scheduled calls.** FACT: `scheduled_calls.reason` is free text; retry rows store the failure reason in it (`VoiceSessions.java` lines 572-596; `MIG/0025_call_cost_ledger.sql` lines 95-136).

### R4.1 Failed checks

- **`multitenancy_correct`** (EIA, BE, CR). All three agree that row-level isolation is sound; the failure is performance isolation on one shared resource, the voice-provider account. Resolved in R4.3. AM and UX, which passed it, raised the same point as a minor (AM-2) or did not examine it.
- No other check failed. AM now marks `works_for_saas_and_custom` true; UX and CR keep `data_flows_automatically` and `works_for_saas_and_custom` true with the founder-decision-1 caveat (unchanged since R3.1).

### R4.2 Major: A2's index change broke Nest and the rollback (IA-1)

- **Disagreement.** v4 replaced the deployments unique index with `UNIQUE NULLS NOT DISTINCT (agent_version_id, job_id, provider, environment)`. IA showed that Nest's `ON CONFLICT (agent_version_id, provider, environment)` then has no matching unique index and Postgres refuses it, so every Nest voice provision fails; that Nest's version-only lookup would take an arbitrary row; and that Nest PATCHes the hosted agent before its upsert, so a Nest call during a rollback could rewrite one job's hosted agent while Java keeps the old `context_hash`. It also broke the stated rule that new migrations only add things and Nest keeps working.
- **Evidence.** Confirmed (R4.0), and one more fact settles it: `environment` is free text with no CHECK, both APIs only ever use `'test'`, and nothing else reads the table.
- **Decision.** **No migration.** The existing `environment` column becomes the deployment slot: `'job:<jobId>'` for a job's phone calls, `'test'` for browser tests. The existing unique index then already gives one row, and one hosted agent, per (agent version, job). Nest reads and upserts only `'test'`, so its conflict target still matches, its lookup still finds exactly one row, and it can only ever rewrite the `test` slot's hosted agent, never a job's. The API_URL (dev) and Caddy (production) rollbacks keep working for voice. No drizzle change is needed.
- **Why not IA's options.** IA proposed gating A2 on Nest being unreachable or ADR-008 being accepted (which would hold the most useful near-term slice on a founder decision), or a one-line maintenance fix in Nest (an exception to "no new work in Nest"). The slot removes the conflict instead of guarding or patching around it: fewer moving parts, no migration, no Nest change.
- **Cost and ceiling.** The column's meaning changes from "environment" to "slot". Both APIs already write the literal `'test'` for every call, so it carried no real environment meaning. `ponytail:` a real `job_id` column once Nest is retired, if anything ever needs to query deployments by job (V2 list). Residual, pre-existing: Nest's upsert does not know `context_hash`, so after a rollback and return the `test` slot's hash is stale and the first Java browser test may run with Nest's script; publishing the agent again clears it. Today this affects every call; after A2 only browser tests (R10).
- **Rule written down** (IA asked for it): while Nest can still be routed to, every migration only adds things Nest ignores; a change Nest would trip over waits until Nest is retired (v5 §2.3, R10).
- **Change.** v5 §2.2 (`VoiceSessions` row), §2.3 (deployments row and the rule), §13.1 (A2 "One hosted agent per job, without a migration", A2 effort, definition of done), §11.1 test "Per-job hosted agents" (asserts Nest's upsert still succeeds), R10, §13.2.

### R4.3 Major: the voice-provider account is shared by every tenant (EIA-1, BE-1, CR-1; also AM-2, EIA-6)

- **Disagreement.** A2's caps are per workspace (2 batch slots of 3, 50 a day), but every workspace dials through one provider account, one API key and one number. When several workspaces batch at once, the account's concurrency is exceeded and the provider refuses dials. The adapter turns that into `unknown`, `dialLocked` marks the session failed, the A2 table maps it to "never dialed again", and the refusal counts toward the daily cap. A candidate who was never called shows "Call didn't connect"; one tenant's batch makes another tenant's clicks fail. BE added that `calls.provision_failed` from a transient provider error skips the job's whole remaining batch, and per-job hosted agents make that more likely because each job's first dial creates an agent.
- **Evidence.** Confirmed (R4.0): global key and number, no 429 pattern, session inserted before the dial, `today_phone` counts failed sessions, plan concurrency 4 to 40, over-capacity calls rejected unless burst or queueing is on. RLS has no bypass, so no query can count live calls across workspaces.
- **Decision** (v5 §10, §13.1):
  1. **A 429 is not a dial.** The adapter returns `provider_busy` for an HTTP 429 from the dial request. `dialLocked` deletes the `voice_sessions` and `agent_sessions` rows it just inserted (no ledger row, no `call.started`), audits `voice.session.provider_busy` with ids, and raises `calls.provider_busy` ("All call lines are busy right now. Try again in a minute."). A queued row goes back to `scheduled` at +60 s. The daily cap, the candidate's call status and the sweep are untouched without any exclusion logic. This one change in the shared dial path fixes both bulk rows and people's clicks. Deleting the rows was chosen over a new `failure_reason` value (CR's other option), which would need a migration of the CHECK in `MIG/0027` and an exclusion in every count. Any other refusal keeps today's handling, since only a 429 says clearly that nothing was placed.
  2. **A platform ceiling on bulk dials,** `VOICE_BULK_MAX_CONCURRENT` (default 2), enforced by the single dial thread from the live phone-call counts it already reads per org in its bulk set. People's clicks are not limited by it, so they keep the rest of the account. The founder sets it from the plan (decision 10a). `ponytail:` per replica; the 429 handling catches what it misses.
  3. **Provisioning.** The batch confirm prepares the job's hosted agent before writing rows (BE's "better still"), so a broken setup is refused in the dialog and the first dial no longer creates an agent under the version lock (also BE-10). A `calls.provision_failed` during the batch re-queues that row at +5 minutes with a visible waiting reason instead of skipping the batch; `oldestQueuedCallMinutes` alerts after 30 minutes and "Stop queued calls" is the person's exit.
  4. **Burst stays off,** asserted by a test on the provisioned body and recorded in ADR-010 (CR-1 (3)). The plan's concurrency is a capacity input in ADR-010 and decision 10a (EIA-1 (3)).
- **Partly different from the reviewers.**
  - CR proposed counting the dial thread's own live bulk calls in memory. It would need every way a call ends to tell the thread, and initiation failures publish no event (FACT, `VoiceSessions.java` lines 649-666), so I count from the per-org live counts the thread reads anyway.
  - BE proposed retrying provisioning about 6 times, then skipping. That needs a counter column or a hack. The health alert plus the Stop button is simpler and visible.
  - BE's `VOICE_MAX_CONCURRENT_PLATFORM`, counting all phone calls across those orgs: that is what item 2 does.
  - EIA's message wording is adopted.
- **EIA-6 (shared calling number),** folded in: R22 and decision 10a (number or header registration is a question for the legal check). No code change.
- **Change.** v5 §1 item 7, §2.2, §6.1 (FACT list), §10 "Shared voice-provider capacity", §13.1 (route, dialog line, dispatcher, error table, definition of done), §11.1 test "Provider busy", R22, decision 10a, §17.

### R4.4 Minor objections

| Id | Objection (short) | Decision | Justification and change |
|---|---|---|---|
| IA-2, EIA-3 (purge), BE-6 | The daily purge never reaches an org whose connections are all disconnected | Accepted | The purge moves to the existing 5-minute loop, which already visits every active org, once a day per org. No new set or loop. v5 §6.1 "Purge", §6.8 item 1, test "Purge reaches every org" |
| IA-3, EIA-4, CR-3 | `superseded` fires twice on decide, Undo, decide; no defined start cursor after `410` | Accepted | `superseded` = a later `contact.stage_changed` exists for that candidate, computed at read or send time, with an index on `(organization_id, candidate_id, seq)`. `GET /v1/events` without `after` returns `{items: [], next}` with the cursor just before the hold; the `410` body says so. Webhooks (later) use the same rule. v5 §2.3, §6.3, §6.5, tests "Feed ordering and hold" and "Undo" |
| IA-4, BE-3 | `created_at` is the transaction start, which weakens the hold and lets an age-based purge leave a gap | Accepted, both parts | `created_at = clock_timestamp()` in `Events.emit` after the lock, so it rises with `seq`. The purge deletes below a `seq` boundary, `coalesce(min seq younger than 30 days, max seq)`, which also keeps the newest event. The feed hold still cuts on `seq`. v5 §2.3, §6.1, §6.5 |
| IA-5 | An events-lock timeout surfaces as a 500 on a person's decision | Accepted | `Events` maps 57014 to `ApiError.conflict("events.busy", "This is busy right now. Try again in a few seconds.")`, the same as `Db.underAdvisoryLock`. The sweep's transaction holds only the select, the compare-and-set and the emits. v5 §6.1 |
| IA-6, AM-4, BE-11 | Hosted agents (now one per job) stay at the provider after workspace deletion | Accepted | `VoiceAgentPort.deleteAgent` for every deployment row in the `deleting` phase, before the hard delete. The DPA says what the provider holds. Closed-job cleanup stays V2. v5 §2.2, §11.1 item 10, test "Erasure" |
| AM-1 | A retrieval failure silently changes the hash, re-syncs a weaker prompt and trips the same-job guard; the guard message is wrong | Accepted | The compiled result carries `retrievalFailed`. `provisionLocked` then reuses the slot's agent without re-syncing and records its stored hash in the snapshot, or refuses with `calls.busy` when no agent exists. Generic guard message. A `FakeEmbedding` test. v5 §13.1 "Retrieval failure never re-syncs", "Same-job guard", §11.1 test |
| AM-2 | Shared provider concurrency | Accepted | R4.3 |
| AM-3 | MCP and write-back would leak the free-text reason, raw stage values and a colleague's email | Accepted | Every MCP tool result and every stage comment or note goes through `ExternalPayloads`: public decision values, no `reason`, display name or "a team member", never an email. The forbidden-field test also covers a fixture `reason`, an empty-name user's email, and any email-shaped string in a body built without `candidates.read_pii`. v5 §6.2, §7, §8 |
| EIA-1 | Shared provider capacity | Accepted | R4.3 |
| EIA-2 | After our own `setStage`, a later forward step blames the ATS for our change | Accepted | `remote_status_seen` = the status we wrote, in the same transaction as `pushed_stage`. A `FakeAts` test. v5 §7, §11.1 |
| EIA-3 (sweep) | A `connecting` row counts as "not disconnected": an abandoned OAuth starts the sweep and later a misleading `consent_revoked` | Accepted | `connected_at` and `fanout_seq` are set when the connection first becomes `active`; the sweep floor ignores NULL; the tick sets `connecting` rows with an expired `state` (10 minutes) to `disconnected`. v5 §2.3, §6.1 |
| EIA-5 | Background reconcile visits orgs in a fixed order under one budget | Accepted (with BE-8) | Rotating start offset per run. A failure on one conversation skips it; two timeouts or 5xx in a row stop the run. v5 §6.1, test "Reconcile budget" |
| EIA-6 | One calling number for every tenant | Accepted, documents only | R4.3 |
| SA-1, CR-2 | ATS-linked people can never be edited or deleted after a disconnect or revoked consent; no immediate erasure | Accepted, simplified | The edit guard applies only while HRVoice still reads the person from the ATS: the connection is `active`, or `needs_attention` for `principal_lost` / `status_unmapped`. Removal is never refused. One action, "Remove this person and their calls" (`candidates.delete`, which only Owner and Administrator hold), replaces SA's separate admin-only "Erase now". ATS-linked rows are anonymised in place, whatever the connection's status, and their link stays as a keyed-hash suppression the pull checks, so the IA-1 round-3 re-import cannot happen, before or after a reconnect. The "also erase everyone from this connection" option on disconnect is V2: workspace deletion and the retention purge cover offboarding. v5 §4, §5, §11.1 item 10, §12.2, tests "Linked fields", "Removing a linked person" |
| SA-2 | Production runs only Nest, so the ingress plan rests on a deployment that does not exist | Accepted, widened | This gates every slice, not only `/v1`. New **gate P**: a Java image and Compose service, with Caddy routing `/backend/*`, `/webhooks/*`, `/health` and `/api/auth/*` to Java, and `TRUST_PROXY` only on that service. Production rollback = Caddy back to Nest. The Next-rewrite X-Forwarded-For question is dev only. v5 §1 item 3, §6.6, §11.1 item 12, §13.1, R23, §17 |
| SA-3 | The default inbound key can read the whole workspace back through the feed | Accepted | The feed and `/v1` results need `candidates.export`. "Send candidates in" drops `candidates.read` and gets no export. `PUT` returns only `{id, externalId, created, issues}`. The MCP preset gains `candidates.export`, because names and decisions leave too. v5 §6.6, §11.1 item 2 |
| SA-4 | The anonymised external id is an unkeyed, reversible hash | Accepted | ATS links: `x:` + HMAC-SHA256 under `INTEGRATIONS_HASH_KEY` (slice E), needed for the suppression. Custom links: a random value, since nothing matches them. `ponytail:` one key, not rotated. v5 §2.3, §11.1 item 10 |
| SA-5 | Erasure leaves free text in audit metadata (stage reason; query strings) | Accepted in part | Every `authz.*` row stores the route template, without the query string, from slice 0. **Not adopted:** clearing `metadata.reason`. The app role has no UPDATE on `audit_events` (FACT, `MIG/0003_rls_hardening.sql` line 51), a deliberate tamper-proofing choice. The DPA and ADR-010 record that audit reasons are kept for the audit retention period, as SA's alternative allows. v5 §6.6, §11.1 items 7 and 10 |
| SA-6 | No per-key number or write ceiling; a leaked key could add many dialable rows | Accepted | `API_KEY_RATE_PER_MINUTE` default 120; `API_ROWS_PER_DAY` default 2,000 rows created through `/v1` per workspace; `429` + `Retry-After`. Rows show "Added by your system". v5 §6.6 |
| SA-7 | MCP needs Origin validation and is reachable under `/backend` | Accepted, widened | `403` on a foreign `Origin` for `/v1/mcp` (FACT, MCP 2026-07-28 Streamable HTTP). All of `/v1` is served only on `api.<domain>`; Caddy answers `/backend/v1/*` with 404. That also removes v4's second spoofing check host. v5 §6.6, §8, §11.1 |
| SA-8 | No checksum on keys; keys never expire by default | Accepted in part | Default expiry one year, with an explicit "No expiry". **Checksum deferred** (V2): the fixed `hv_live_` prefix already lets a customer's scanner match keys, and a checksum pays off only with a scanning partner programme. v5 §2.3, §11.1 item 2, §13.2 |
| UX-1 | The app and outbound bodies use different outcome vocabularies; closed, removed and erased rows sit in the wrong queues | Accepted | One `CallOutcomes.outcome` in slice 0, used by `Jobs.callStatus/queue/outcome`, the results route and `ExternalPayloads`. New app states: `no_conversation` (joins "Didn't connect"), `result_unavailable` (review, "Try again"), `content_erased` (no queue) and `dial_uncertain` (from CR-5). From slice E, closed and removed rows leave every action queue, with a board filter to find them. Test "One outcome vocabulary". v5 §6.1, §12.2, §13.1 |
| UX-2 | "Select everyone" would mean "everyone on this page" | Accepted | `POST /jobs/{j}/calls/queue` with `candidateIds` (100 at most) or `select`, resolved in the insert transaction, plus `dryRun` for the dialog count. `not_connected` leaves out `invalid_number`, `line_not_connected` and `dial_uncertain`. v5 §13.1 |
| UX-3 | No per-row queued state | Accepted, smaller | A "Queued to call" tag on the board and in the sheet, with "Remove from queue". **Not added:** "Call now instead". The normal Call button already does it, and the queued row is then skipped as "Called by hand". v5 §13.1 |
| UX-4 | Calls with unlinked people on a linked job would sit as "Waiting to send" | Accepted, simpler | The drain skips events whose candidate has no link and advances the cursor without a delivery row, like a type skip. Unlinked people show no delivery line. Dialog copy and step 7 copy are changed. Test "Unlinked person on a linked job". v5 §6.1, §12.2 |
| UX-5 | Title matching mislinks duplicate titles; no hint that the JD is copied once | Accepted | Pre-select only on a single exact, case-insensitive match; a line explaining which job's questions apply; "Copied from Zoho Recruit on 3 Oct ..." on a linked job's description. v5 §12.2 |
| UX-6 | The web has no person-facing removal, so erasure requests cannot be served | Accepted | The "Remove this person and their calls" action is part of the Core launch gate. v5 §11.1 item 10, §13.1 |
| UX-7 | Bulk decisions do not warn about write-back | Accepted | The bulk buttons and their Undo toast say "N of these will also be set to '<label>' in Zoho Recruit in 2 minutes". v5 §12.2 |
| BE-1 | Shared provider capacity; transient provisioning failure skips the batch | Accepted | R4.3 |
| BE-2 | The purge can move a cursor backwards | Accepted | `greatest(fanout_seq, b - 1)` with a guarded UPDATE; `missed_until` only when the cursor moved. v5 §6.1 |
| BE-4 | Foreign keys on event and delivery tables are unspecified | Accepted | No foreign keys from `integration_events` to candidates, jobs or voice sessions, and none on `integration_deliveries.event_id`. `organization_id` cascades as on every tenant table. v5 §2.3 |
| BE-5 | The outcome sweep waits behind vendor HTTP in the lane | Accepted | The sweep runs inline in the 60-second tick, one `inOrg` per connected org. The `sweep` job kind is removed. The pool check counts it. v5 §2.1, §2.2, §6.1, §6.8 |
| BE-7 | Drains run for connections that never send | Accepted | Only sending connections (an ATS, or a configured webhook endpoint) have a drain, a `fanout_seq` and a sending principal. v5 §2.3, §6.1 |
| BE-8 | Reconcile and erasure deletes can starve orgs or stick on one item | Accepted | Rotating start; per-item skip; stop after two provider-wide failures in a row; a 404 on delete counts as done; another 4xx (except 429) stops retrying, clears the id and audits `voice.session.provider_delete_failed`, and the provider-side retention expires the copy. v5 §6.1, §11.1 item 10 |
| BE-9 | A crash or deploy leaves rows "Not called" for people who were called | Accepted | Recovery marks a stuck `dialing` row `done` with the newest phone session created after its `updated_at`, or `skipped`. A `SmartLifecycle` stop waits up to 60 s for an in-flight dial. Test "Dial-thread restart". v5 §13.1 |
| BE-10 | Each job's first dial creates an agent while holding the version lock | Accepted for batches | The batch confirm provisions first (R4.3). A person's first manual Call for a job still provisions at dial time; that is no worse than today, where every switch between jobs re-syncs under the lock. v5 §13.1 |
| BE-12 | One UPDATE can pass the statement timeout; `Snooze(0)` waits for the poll | Accepted | Erase in batches of 500 rows; `Snooze` calls `wake(scope, seconds)`. v5 §6.8 item 2, §11.1 item 10 |
| CR-1 | Shared provider capacity, burst pricing | Accepted | R4.3 |
| CR-4 | The same-job guard is wider than stated; browser tests with overrides re-sync the job's agent | Accepted | Scope restated (JD, questions, language, company knowledge, voice); generic message; browser tests always use the `test` slot. R18 widened. v5 §13.1, R18 |
| CR-5 | A dial that timed out may have been placed; the result is lost and the person may be called again | Accepted in part | `dial_uncertain` ("Call may have gone through. Check before calling again.") is left out of the "didn't connect" shortcut. Matching the provider's webhook through our session id in the dial's client data is V2, with the dynamic-variables item. v5 §6.1, §13.1, §13.2 |
| CR-6 | Effort numbers disagree; the document is too big to build from | Accepted in part | Core 2-3 weeks plus E 4-5 weeks = 6-8 weeks; A2 7-9 days; slice 0 4-6 days; Dev 7-9 days. The A2 detail in §13.1 is self-contained and marked as the A2 build sheet, to be lifted into its own short document once decision 10a is approved. I did not create that file in this round. ADR-010 is still unwritten (R4.6). v5 §13.1 |

### R4.5 Where I disagreed with a reviewer

- **IA-1:** neither the Nest-retirement gate nor a Nest patch. The free-text `environment` slot removes the conflict (R4.2).
- **CR-1 / BE-1:** the ceiling counts live calls from the per-org reads the thread already makes, not from an in-memory set of the thread's own calls, because initiation failures publish no event. No retry counter for provisioning failures: a health alert plus the Stop button instead (R4.3).
- **SA-1:** one removal action for everyone who holds `candidates.delete` (already only admins), not a separate "Erase now". The edit guard follows "still pulling", which reads SA's "active only" and "inert once consent is revoked" together. Erase-on-disconnect is V2.
- **SA-5:** audit reasons are not cleared, because the audit table is append-only by design; this is recorded in the DPA instead.
- **SA-8:** no key checksum yet.
- **UX-3:** no "Call now instead" button.
- **UX-4:** no `skipped` delivery rows for unlinked people.
- **CR-5:** webhook matching for uncertain dials is V2.
- **CR-6:** no separate A2 file in this round.

### R4.6 Things I could not resolve in this round

1. **Vendor behaviour, unverified:**
   - that the outbound-call endpoint answers an over-capacity dial with HTTP 429 (the measure in R4.3 item 1 depends on it; until it is checked live, item 2 is the main protection);
   - that burst is off by default for API-created agents;
   - whether call queueing applies to outbound calls;
   - whether each per-job hosted agent needs the outbound number assigned to it;
   - the exact delete-agent path;
   - the per-agent retention field;
   - when a phone call's config binds;
   - whether conversation delete removes backups;
   - whether Zoho renders notes as HTML.
2. **Founder:**
   - decision 1 (which branch);
   - gate P (Java in production, ADR-008);
   - decision 10a, now including the provider plan, which sets `VOICE_BULK_MAX_CONCURRENT`.
3. **Legal:**
   - TCCCPR for queued batches, plus number or header registration for the shared calling number;
   - the DPDP processor role;
   - retention and grace periods;
   - whether keeping a keyed hash of an ATS application id as a suppression after erasure is acceptable (ASSUMPTION: yes, as a minimal suppression record).
4. **ADR-010** is still unwritten. Beyond the R3.9 list, it should record:
   - the additive-only migration rule and the deployment slot (R4.2);
   - the shared-capacity measures and "burst off" (R4.3);
   - that audit reasons are kept (SA-5);
   - that production `/backend` is proxied by Caddy (SA-2).

---

## Round 5

Reviews of `architecture-draft-v5.md`: Integration Architect (IA) **block**; AI Agent / MCP Architect (AM), Enterprise Integration Architect (EIA), Security Architect (SA), Product / UX Architect (UX), Backend / Distributed Systems Architect (BE) and Critical Reviewer (CR) approve with changes. One major (IA-1: the provider-busy fix deleted rows the application role may not delete) and one failed check (`multitenancy_correct`, IA, for the same reason). 40 minor objections. Result: `architecture-draft-v6.md`. No code, config, migration or test was changed.

### R5.0 Evidence I re-checked myself for this round

- **`voice_sessions` privileges.** FACT: `MIG/0014_elevenlabs_rls.sql` grants `SELECT, INSERT, UPDATE` on `voice_sessions` and then `REVOKE DELETE ... FROM platform_app`, with the comment "voice_sessions are append-only from the application perspective ... never deleted". No later migration grants DELETE on it (grep of 0015-0030). `agent_sessions` has DELETE (`MIG/0007_agent_rls.sql` line 103). `vs_session_fk` and `vs_deployment_fk` are `ON DELETE RESTRICT` (`MIG/0013_elevenlabs_foundation.sql` lines 66, 70); `voice_sessions.status` has no CHECK (line 40); `voice_provider_deployments.external_agent_id` is `NOT NULL` (line 25).
- **`StructuralTest`.** FACT: it checks forced RLS, `rolbypassrls`/`rolsuper` and that the app role owns no table (`apps/api-java/src/test/java/desk/StructuralTest.java` lines 34-63). It has no per-table privilege assertion, so the delete policy needs a new test, not an updated one.
- **PostgreSQL foreign-key internals** (REL_17_STABLE `src/backend/utils/adt/ri_triggers.c`). FACT: foreign-key checks and actions run as the table owner with `SECURITY_NOFORCE_RLS`, and their queries run through `SPI_execute_snapshot(qplan, vals, nulls, test_snapshot, crosscheck_snapshot, false, false, limit)`, that is with `fire_triggers = false`. So an org cascade ignores both the revoke and the new policy, and the RESTRICT checks queued by cascaded deletes run after the org's own cascades.
- **Dial path.** FACT: `dialLocked` inserts `agent_sessions` and `voice_sessions` before `voice.dial` (`JAVA/voice/VoiceSessions.java` lines 378-440), refuses "This job is linked to a different hiring agent" at line 403, and `counts()` counts every `pending` phone row as live and every phone row started today (lines 263-286). `HostedVoiceAdapter.dial` passes both a `success: false` message and any caught exception's text to `CallOutcomes.fromDialFailure` (lines 253-272), which falls through to `unknown` (`JAVA/engine/CallOutcomes.java` line 38 on).
- **Outbound-call API.** FACT: required `agent_id`, `agent_phone_number_id`, `to_number`; response `success`, `message`, `conversation_id`, `callSid`; Errors: 422 only (https://elevenlabs.io/docs/api-reference/integrations/twilio/outbound-call).
- **Loops.** FACT: `expireStale` starts with `if (!env.voiceEnabled) return;` (`VoiceSessions.java` lines 678-680); `ELEVENLABS_ENABLED` defaults to false (`JAVA/platform/Env.java` line 124). There are exactly three `@Scheduled` methods (`JobQueue.java` line 87, `VoiceSessions.java` line 678, `DocumentProcessor.java` line 248) and no pool setting in `application.yml`.
- **Stage changes.** FACT: `updateStatuses` calls `loadJob(sql, actor, jobId, true)` (line 257), which appends `for update` (lines 64-67); both stage routes call it (`HiringController.java` lines 373, 386).
- **Origin.** FACT: `apps/web/next.config.mjs` returns the `/backend/:path*` rewrite with no environment check (lines 15-23). Caddy "passes through incoming headers—including Host—to the backend without modifications", apart from the `X-Forwarded-*` headers (https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).
- **Audit and health.** FACT: `HiringController.url(req)` writes path plus query (lines 65-72; used at 67 and 456). `/health` is `@Public` and returns `jobsBacklog` (`HealthController.java` lines 26-39). The Compose healthcheck requires a 2xx from `/health` (`docker-compose.yml` lines 122-127); the Nest worker already uses a heartbeat file (lines 173-179).
- **Answers source.** FACT: the compiler seeds criteria from the agent's `evaluation.criteria` and replaces them only when the job has questions (`CallContextCompiler.java` lines 64-67, 122); the snapshot records no source (lines 252-260).
- **Knowledge delete** is a soft delete that sets `updated_at` (`JAVA/knowledge/Knowledge.java` line 117).
- **CSV import.** FACT: aliases include `country_code`, `country`, `dial code`, `phone`, `mobile`; `normalizeCountryCode("91")` returns `+91` (`JAVA/hiring/CandidateImport.java` lines 20-28, 80-89).
- **Tika HTML.** FACT: `tika-parser-html-module` 3.3.1 is on the compile classpath through `spring-ai-tika-document-reader` (`mvn -o dependency:tree -Dincludes=org.apache.tika`, 2026-10-03). Zoho's sample `Job_Description` is HTML (https://www.zoho.com/recruit/developer-guide/apiv2/get-associated-records.html).
- **Provider batch calling.** FACT: batch calls use "the minimum of either 50% of your workspace's concurrency limit or 70% of your agent's concurrency limit", and "Zero Retention Mode (ZRM) cannot be enabled for batch calls" (https://elevenlabs.io/docs/eleven-agents/phone-numbers/batch-calls).
- **MCP 2026-07-28.** FACT: sessions and `initialize` removed, `server/discover` a MUST, `ttlMs`/`cacheScope` required on list results (https://modelcontextprotocol.io/specification/2026-07-28/changelog); "Authorization is OPTIONAL", and "MCP servers MUST validate that access tokens were issued specifically for them as the intended audience" (https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization).
- **Backups.** FACT: ADR-006 plans `pg_dump` plus WAL archiving, then managed point-in-time recovery, lists "monitoring with alerting" as our obligation, and asks for recovery-time and recovery-point objectives before the first paying customer (`BRD's/10_ADRs/ADR-006-hosting-deployment.md`, "Database progression" and "Consequences").

### R5.1 Failed checks

- **`multitenancy_correct`** (IA only). Row isolation is not in question. The failure is that the v5 fix for shared provider capacity could not run under the application role, so one 429 would hold a concurrency slot of the workspace for about 30 minutes and burn the queued row: the opposite of what the fix was for. Resolved in R5.2.
- No other check failed. UX and CR keep `data_flows_automatically` and `works_for_saas_and_custom` true with the founder-decision-1 caveat; UX's spreadsheet caveat is now stated in v6 §1 and decision 1 (UX-1).

### R5.2 Major: the provider-busy fix deleted rows the application role cannot delete (IA-1; folded in AM-3 and UX-4)

- **Disagreement.** v5 had `dialLocked` delete the `voice_sessions` and `agent_sessions` rows it had just inserted when the provider refused a dial for capacity, and claimed A2 needed no migration. IA showed that the application role has no DELETE on `voice_sessions`, by design, so the first refusal fails with SQLSTATE 42501, the person gets a 500, the bulk row is burned, and the `pending` row holds a concurrency slot and a daily-cap slot. AM added that the provider documents only a 422 and a `success: false` body for this endpoint, so a capacity refusal may not arrive as a 429 at all. UX added that the adapter classifies refusals by text, so definite refusals end up as `unknown` and are shown as "may have gone through".
- **Evidence.** Confirmed (R5.0): the revoke, no later grant, RESTRICT on `vs_session_fk`, `counts()`, and the adapter's text classification.
- **Decision.** IA's option (a): one small additive A2 migration, `GRANT DELETE ON voice_sessions TO platform_app` plus `CREATE POLICY vs_delete_unplaced ON voice_sessions AS RESTRICTIVE FOR DELETE USING (status = 'pending' AND external_conversation_id IS NULL)`. Only a dial that was never placed can be deleted; every call the provider accepted stays append-only at the database level, which keeps the intent of the original revoke. The delete statement repeats the condition and returns the agent session id; if it matches no row, something else already changed the session and it is left alone and logged. In the same change, as AM and UX proposed:
  - a capacity refusal is a 429 **or** a `success: false` body with no conversation id whose message matches `concurren|too_many|system_busy|capacity`;
  - the adapter decides "not placed" or "may have been placed" from the transport: no reply, timeout, I/O error or 5xx is `network` (uncertain); any 4xx or `success: false` keeps its classified reason and is never `network`. `dial_uncertain` is then only `failed` + `network` + no conversation id, with new copy ("We lost contact while placing this call. They may have been called; ask before calling again.").
- **Why not option (b)** (keep the rows under a new `not_placed` status). It needs no migration, but every reader of `voice_sessions` would need an exclusion: `counts()`, `Jobs.callStatus`, `queue` and `outcome`, the Calls list, the results route's session list and analytics. Missing one shows a phantom call. One grant and one policy touch nothing that reads.
- **Cost.** A2 is no longer migration-free. The migration is additive and Nest ignores it, so R10 holds. Workspace deletion is unaffected, because foreign-key cascades run as the owner with row security off (R5.0).
- **Change.** v6 §2.2 (`VoiceSessions` and adapter rows), §2.3 (new policy row; slice note), §6.1 (FACT list; outcome function), §10 measure 1, §13.1 (A2 row, error table, definition of done with a live over-capacity check), §11.1 tests "Provider busy" (with a delete-policy case) and "Dial uncertainty", §17.

### R5.3 Minor objections

| Id | Objection (short) | Decision | Justification and change |
|---|---|---|---|
| IA-2 | Workspace hard delete may trip RESTRICT foreign keys and leave the org `deleting` for ever | Accepted (the test); fallback simplified | ASSUMPTION from the PostgreSQL source: it passes, because foreign-key actions run with `fire_triggers = false`, so RESTRICT checks queued by cascaded deletes run after the org's own cascades (R5.0). Not run. Core adds one Testcontainers test before relying on it. If it fails, the hard delete becomes a runbook step run as the migrator role; IA's child-first deletes inside `inOrg` would need broad DELETE on `voice_sessions`, which R5.2 deliberately avoids. Also corrected: deployment rows cannot be deleted while calls reference them, so "no deployment is left" became "every deployment's agent id is blank". v6 §11.1 item 10, tests, §17 |
| IA-3 | Queued rows are pinned to the agent at queue time; relinking a job cancels its batch | Accepted | The dial thread passes the job's current `agent_id`; the stored one is kept only for the NOT NULL column. `calls.not_ready` now covers "the job has no agent", not "another agent". v6 §10, §13.1, test "Current agent" |
| IA-4 | A two-way script needs two keys, and nothing says so | Accepted, docs only | §12.1 step 1, the reference docs and the reference script say a two-way script uses "Send candidates in" and "Read results". Presets stay single-purpose |
| IA-5 | "One number already serves several hosted agents" was presented as evidence but never ran live | Accepted | Reworded in §17: the request shape allows any agent per call (docs); confirmed in the A2 live batch, which now spans two jobs |
| AM-1 | An agent's own evaluation criteria can leave as "answers" | Accepted | Slice 0: the snapshot records `criteriaSource: 'job' \| 'agent'` (jsonb, no migration); `ExternalPayloads` sends answers only for `'job'`, or, for older snapshots, only labels that match a current job question. One more case in the forbidden-field test. v6 §6.2, §13.1, R3 |
| AM-2 | Retrieval-failure reuse can read answers against the wrong question list | Accepted, resolved differently | The reuse path is **removed**: a dial whose retrieval failed is refused with `calls.busy` and retried (+60 s for queued rows). AM's guard (copy or hash the questions and compare) would fix the bug but keep a branch whose only purpose is calling through an embedding outage, which cannot happen until the embedding cutover. `ponytail:` the guarded reuse is the recorded upgrade. v6 §13.1, test "Retrieval failure", §13.2 |
| AM-3 | A capacity refusal may arrive as `success: false`; the live check should span two jobs | Accepted | Folded into R5.2; the A2 live batch spans two jobs and includes one deliberate over-capacity attempt that logs the real refusal shape. v6 §10, §13.1, §17 |
| AM-4 | MCP section predates the 2026-07-28 revision; a static key is outside the authorization spec | Accepted, docs only | Stateless protocol, `server/discover`, `cacheScope: "private"` for a per-key tool list; the key pilot labelled "non-standard authorization". No MVP change. v6 §8 |
| EIA-1 | A database restore breaks "seq never goes down" and undoes erasures and suppressions | Accepted in a smaller form, plus one addition | `EVENTS_EPOCH` in the feed cursor (410 on mismatch); every person-level erasure and workspace deletion is also written as one object to the existing object storage before commit, and `--desk.reapply-erasures` re-applies them after a restore, while `AUTOMATION_PAUSED` keeps automation off. **Not adopted:** resetting `fanout_seq` and `missed_until` after a restore: the restored cursor and events are consistent, and note markers stop duplicates. **Added** (not in the review): the same command cancels open bulk rows, because a restore to an earlier point brings already-dialed rows back as `scheduled`. The retention purge needs no record, because it runs by date. v6 §6.5, §11.1 item 13, R24 |
| EIA-2 | Crash recovery compares with an `updated_at` nobody maintains | Accepted | Every status change on `scheduled_calls` sets `updated_at = now()` in the same UPDATE (FACT: default only, no trigger, `MIG/0025` line 110). Test: a manual call before the claim is not adopted. v6 §13.1 |
| EIA-3 | The platform bulk ceiling, not the workspace caps, sets A2 throughput | Accepted | The capacity formula is in decision 10a (≈ 216 calls a day for everyone with the defaults; ASSUMPTION of 5 minutes per slot). The dialog shows a lower bound only (with UX-5, CR-6). v6 §13.1, §16 |
| EIA-4 | The 5-minute loop has no fixed order or budget | Accepted, with BE-1 | Fixed order: database step always; reconcile at most 40 s; provider deletes the rest of 60 s, at least 15 s. The oldest pending provider delete goes into the health log line, not onto public `/health` (SA-6). v6 §6.1, §6.8 |
| EIA-5 | Per-job hosted agents pile up at the provider | Accepted with SA-4, in A2 | See SA-4 |
| EIA-6 | The draft is too large to build from; ADR-010 is unwritten | Accepted in part | v6 §13.1 adds a "Build documents" gate: ADR-010 (at most 2 pages) and one build sheet per slice before that slice starts. New v6 §18 lists every invariant in one place, so ADR-010 can be lifted from it verbatim. I did not write ADR-010 or the sheets in this round: this round's outputs are v6 and this record, the ADR belongs in `BRD's/10_ADRs/` with the founder's acceptance, and which sheets are needed depends on decision 1 |
| SA-1 | `/v1` is still reachable on the browser origin; the rewrite is not dev-only | Accepted | FACT corrected (the rewrite is unconditional). The principal type is chosen from the matched handler, not a path prefix; the key branch answers 404 unless `Host` equals `API_PUBLIC_HOST` (Caddy passes `Host` through); `Env` refuses to boot in production without it once Dev is on. Caddy's 404 stays as defence in depth. Test with encoded and dot-segment paths. v6 §6.6, §10, §11.1 item 12, §17 |
| SA-2 | Anonymisation leaves the parent id, an unkeyed contact hash and open queue rows | Accepted, simpler | The erasure transaction nulls `external_parent_id`, `inbound_hash` and `remote_status_seen` and cancels open `scheduled_calls` rows (`bulk:removed`). `inbound_hash` is not made a keyed HMAC: while the row exists it holds the same fields in clear anyway, and after anonymisation it is NULL. v6 §2.3, §11.1 item 10, test |
| SA-3 | Suppressions vanish if a connection row is ever deleted | Accepted | Connection rows are never deleted while the workspace exists; `integrations.delete` means disconnect; `UNIQUE (organization_id, provider)` includes disconnected rows, so a reconnect reuses the id. `Env` refuses slice E without a 32-byte `INTEGRATIONS_HASH_KEY` distinct from the sealing keys. Test "Reconnect". v6 §2.3, §11.1 item 10 |
| SA-4 | Per-job hosted agents keep deleted company documents at the provider | Accepted, corrected and moved to A2 | SA proposed deleting the deployment row too, but `vs_deployment_fk` is `ON DELETE RESTRICT`, so a row with calls cannot be deleted. Instead the provider step deletes the hosted agent of an **idle** `job:` slot that is **stale** (old agent version, closed job, or a knowledge document deleted since the slot's last dial) and blanks `external_agent_id` and `context_hash`; `provisionLocked` treats `''` as "no agent yet". This covers EIA-5 too. In A2, not Core, because A2 creates these agents and Core ships only with a pilot. `test` slots are left alone because Nest reads them. A2 effort +1 day. v6 §2.3, §11.1 item 10, §13.1, §13.2, test "Idle job agents" |
| SA-5 | No destination allowlist; toll-fraud and shared-number risk | Accepted, in slice 0 | `VOICE_DIAL_COUNTRY_CODES` (default `91`) checked in `dialLocked` (`calls.destination_not_allowed`, A2 `skipped`) and in the shared intake validation as `invalid_phone` with adjusted copy; carrier geo-permissions in the gate P checklist; R22. v6 §6.6, §10, §13.1, R22 |
| SA-6 | New `/health` numbers are public and cross-tenant | Accepted, merged with CR-1 | Public `/health` keeps its readiness fields except `jobsBacklog` and gains only `status: ok \| degraded`; the numbers go to one log line a minute. No operator route or token. v6 §6.8 item 8 |
| SA-7 | A second audit writer stores query strings | Accepted | One shared route-template helper for `AuthInterceptor` and `HiringController`; a grep test bans `getQueryString` in audit code; a DPA sentence about pre-slice-0 rows. v6 §11.1 items 7 and 10, §13.1 |
| UX-1 | Spreadsheet customers have no branch | Accepted, docs only | Decision 1 is a three-way choice. §1 says plainly that "connect once" is not met in the MVP for spreadsheet customers. A Google Sheet connection (`drive.file`, one sheet, three columns in, answers and decisions back) is named in V2 as its own slice, not an `AtsPort` adapter. v6 §1, §13.2, §16 |
| UX-2 | Results CSV has no name or job; phone format cannot be re-imported | Accepted | Always full name and job title; phone as `country_code` (`91`) and `phone` (national digits), matching the import aliases. Test: re-imports with no issues. v6 §6.7 |
| UX-3 | Removed people still sit in queues and batches | Accepted, merged with SA-2 and CR-7 | Anonymisation cancels open queue rows and sets the link to `remote_state = 'deleted'`, so the existing "closed or removed" exclusion keeps them out of every queue and bulk selection; the board filter is renamed "Closed or removed". No new column. v6 §2.3, §11.1 item 10, §12.2 |
| UX-4 | "Call may have gone through" shown for definite refusals | Accepted | Folded into R5.2 (transport-based `network`; new copy). Older `unknown` rows are no longer labelled uncertain |
| UX-5 | The dialog estimate ignores shared capacity | Accepted | UX's copy with "at least N days", computed from today's remaining cap; a true lower bound, not an estimate. v6 §13.1 |
| BE-1 | Purge, erasure and workspace deletion stop when voice is switched off | Accepted, simpler | No new loop: the voice check moves inside `expireStale`, so its database step always runs and only the provider steps follow the switch. The 7-day hard-delete fallback counts from entering `deleting`. Test "Voice off". v6 §6.1, §11.1 item 10 |
| BE-2 | Four loops on three scheduler threads after Core | Accepted | Pool 3 in A2, 4 from Core; a test fails when `@Scheduled` methods outnumber the pool. v6 §6.1, §6.8 item 4 |
| BE-3 | A call with only a summary or answers emits with no defined outcome | Accepted | Settled = a failure reason or a transcript, or 90 minutes passed. v6 §6.1 |
| BE-4 | The erasure guard on one UPDATE does not cover `apply`'s other writes | Accepted | Early return at the top of `apply` plus the WHERE guard on both UPDATEs; the test checks the extractor is not called. v6 §11.1 item 10 |
| BE-5 | The extra candidate `FOR UPDATE` is redundant; the FACT bullet was wrong | Accepted | FACT bullet corrected (the job row is already locked); no extra lock; lock order written out in full. v6 §6.1, §18 |
| BE-6 | A Nest rollback after Core silently drops new guards | Accepted, resolved differently | Neither a runbook nor a pause: there is no pause for a Nest-served request, and disconnecting is destructive. **Core goes live only once Nest is no longer routed in production**; rollback is the previous Java image. R10 binds slices 0, A and A2 only. v6 §2.3, §13.1, R10, §18 |
| BE-7 | A crash after `setStage` makes a false "changed in Zoho" note | Accepted | The handler first checks whether the ATS status already equals the mapped target; if so it records the push and stops. `FakeAts` test. v6 §7 |
| CR-1 | No alert, and lag numbers cannot show a dead loop | Accepted | Heartbeats per loop; `degraded` when one is older than 3 intervals or a lag passes 30 minutes; the dial loop catches `Throwable` per pass; gate P adds an external keyword monitor. **Not adopted:** HTTP 503, because the Compose healthcheck treats any non-2xx as unhealthy. v6 §6.8 item 8, §13.1, R13 |
| CR-2 | The provider's batch-calling API is not mentioned | Accepted, docs only | Recorded as rejected, with reasons (per-dial guards and webhook mapping need our own session row; no ZRM for batches; vendor lock-in), the 50% default as support for "half the plan", and an operating rule: no dashboard batches on the production account. v6 §13.1, R22 |
| CR-3 | Removal suppression is per job, but the copy promises more | Accepted, option (a) | The dialog says "for this job"; §4 states the per-application scope; decision 9 asks whether a workspace do-not-call list is wanted (named in V2). Keying on the ATS person id would block the person from every future job, which is a product decision, not a fix. v6 §4, §11.1 item 10, §13.2, §16 |
| CR-4 | The sweep holds the events lock during its 7-day scan | Accepted | Select and hash without the lock; take it only when a row differs; the compare-and-set re-checks under it. v6 §6.1 |
| CR-5 | Zoho job descriptions arrive as HTML | Accepted | `ExternalJob.description` is plain text; the Zoho adapter converts with Tika's HTML parser, already on the classpath. `FakeAts` test with Zoho's sample. v6 §3, §12.2, §13.1 |
| CR-6 | The dialog estimate ignores the platform ceiling | Accepted | Same as UX-5 and EIA-3 |
| CR-7 | Anonymised links are still reachable by stage push and the drain | Accepted | `pushed_stage` set to the current stage at anonymisation; drains and stage-mismatch discovery skip links with `remote_state = 'deleted'`; the deletion check skips `x:` links. v6 §2.3, §5, §6.1, §7 |

### R5.4 Where I disagreed with a reviewer

- **IA-1:** option (a), the narrow delete policy, not (b), a new status, because (b) needs an exclusion in every reader (R5.2).
- **IA-2:** the fallback, if the test fails, is a migrator-run runbook step, not child-first deletes, which would need broad DELETE on `voice_sessions`.
- **AM-2:** the retrieval-failure reuse is removed, not guarded.
- **SA-2:** `inbound_hash` is nulled at anonymisation, not keyed.
- **SA-4 / EIA-5:** the deployment row cannot be deleted (RESTRICT); its agent id is blanked. In A2, not Core.
- **SA-6 / CR-1:** no operator route or token, and no 503; numbers go to a log line, `status` carries the signal, and the HTTP status stays 200 for the Compose healthcheck.
- **BE-1:** no new `@Scheduled` method; the voice check moves inside the existing loop.
- **BE-6:** Nest is retired from production routing before Core instead of a rollback runbook.
- **EIA-1:** no `fanout_seq` reset after a restore; added cancelling open bulk rows.
- **EIA-6:** ADR-010 and the build sheets are a gate before each slice, with their contents collected in v6 §18, not written in this round.
- **CR-3:** exact copy plus a founder question, not a per-person suppression key.

### R5.5 Things I could not resolve in this round

1. **Vendor behaviour, unverified:**
   - how the outbound-call endpoint refuses an over-capacity dial (429 or `success: false`, and the message); the A2 live check logs it;
   - whether several hosted agents dial through one number in practice (the request shape allows it);
   - that burst is off by default for API-created agents; whether call queueing applies to outbound calls;
   - the exact delete-agent path; the per-agent retention field; when a phone call's config binds;
   - whether conversation delete removes backups; whether Zoho renders notes as HTML.
2. **Database, unverified:** that the workspace hard delete passes the RESTRICT foreign keys (expected from the PostgreSQL source; one Core test).
3. **Founder:**
   - decision 1, now a three-way choice that includes spreadsheets;
   - gate P and ADR-008, which Core now also needs (Nest no longer routed in production);
   - decision 10a, now with the platform capacity formula;
   - decision 9, now also covering a do-not-call list and how long backups keep erased data;
   - screenshots of the new A2 and Connected systems UI before they are built.
4. **Legal:** TCCCPR for queued batches and number or header registration; the DPDP processor role; keeping a keyed hash of an ATS application id as a suppression after erasure; backup retention of erased data.
5. **ADR-010 and the build sheets** are still unwritten; v6 §18 holds the ADR's contents and v6 §13.1 makes both a gate before each slice.
6. Effort numbers remain ASSUMPTIONS for ordering: slice 0 5-7 days, A2 8-10 days, Core about 3 weeks, Core + E about 7-8 weeks.

## Round 7 (lead decision)

Date: 2026-10-03. Input: `architecture-draft-v6.md` and the round-6 reviews (`03-round6-reviews.md`): Integration Architect (IA) **block**, AI Agent / MCP Architect (AM) approve with changes, Enterprise Integration Architect (EIA) **block**, Security Architect (SA) **block**, Product / UX Architect (UX) approve with changes, Backend / Distributed Systems Architect (BE) **block**, Critical Reviewer (CR) **block**. 5 majors (IA-1, EIA-1, SA-1, BE-1, CR-1) and 26 minors. Output: `architecture-draft-v7.md` and `later-bulk-calling.md`. No code, config, migration or test was changed.

This round is not a normal resolution round. Six review rounds did not converge (majors 17, 12, 9, 4, 1, then 5), and 4 of the 5 round-6 majors were about slice A2, a calling-engine feature that grew inside the integration plan; each fix added machinery that the next round found new holes in. The orchestrator therefore made a binding lead decision, which this round applies.

### R7.0 The lead decision (binding)

1. **Scope cut.** Slice A2 ("Call selected (N)", the bulk dispatcher and its error-code table, one hosted agent per job, stale-agent deletion, provider and Exotel capacity classes, `VOICE_BULK_MAX_CONCURRENT`, the dial thread) leaves the architecture and goes to `later-bulk-calling.md`, with every open objection, marked NOT APPROVED. A call starts as it does today: a person clicks Call for one candidate. Imported candidates appear on the job's board ready to call. Anything that existed only to serve A2 goes too.
2. **Simpler core** (CR-1). For Core + E: no ordered event log. ATS notes and stage write-back are level-triggered, with one `integration_deliveries` row per (connection, call) or (connection, candidate stage) holding the content hash, status, attempts and `next_attempt_at`, each backing off on its own. The ordered log, per-org `seq` and feed ship only with Dev, keeping the agreed rules (purge never lowers max `seq`; `410` against the oldest retained `seq`; undone stage events `superseded`). Background reconcile only where results must leave without anyone opening the app, on its own executor with a per-run budget and a stop at the first provider timeout, not on Spring's scheduler thread.
3. **Pre-existing platform risk, not designed here.** Self-registered workspaces placing real calls on the shared number is recorded as a launch gate and a founder decision (operator enables calling per workspace; verified email; a default usage-limit row), as one small separate item.
4. **Remove, don't add.** Delete every mechanism that only served something out of scope; add one only to stop data being lost, leaked, sent to the wrong tenant, or the product rule being broken; prefer existing tables, queues and code paths; keep what was agreed and is still in scope, trimmed.

### R7.1 Evidence I re-checked in the repo for this round

- **Stage changes.** FACT: `Jobs.updateStatuses` sets `candidates.updated_at = now()` only when the stage changes (`JAVA/hiring/Jobs.java` line 264). The route writes one `hiring.candidate_status_changed` audit row per candidate with `from`/`to` (and the optional reason) **after** that transaction (`JAVA/hiring/HiringController.java` lines 374, 387, 391-396), through `AuditService.record`, which logs and swallows failures (`JAVA/audit/AuditService.java`). `Jobs.stageHistory` reads these audit rows (lines 280-295). `Candidates.update` also sets `updated_at` (`JAVA/hiring/Candidates.java` line 113). So the 2-minute hold can use `candidates.updated_at`, and the decider's name can come from the audit row with "a team member" as the fallback.
- **Job queue.** FACT: `enqueue` opens its own transaction through `inScope`, so it cannot run inside a caller's transaction; `runDue` visits only `organizations.status = 'active'`; a failing handler is retried with backoff and ends `dead` (`JAVA/jobs/JobQueue.java` lines 66-75, 93-97, 136-161). Hence level-triggered discovery (the tick or the 5-minute loop re-enqueues due work) instead of enqueueing inside the erasure transaction, and a lane poll that also visits `deleting` orgs.
- **Object storage.** FACT: `ObjectStorage` has only `put` and `get`, and every key is `<org>/<key>` (`JAVA/knowledge/ObjectStorage.java` lines 63-73, 81-99). Java defaults to local storage (`JAVA/platform/Env.java` line 98).
- **CLI pattern.** FACT: the embedding cutover runs as `java -jar api-java.jar --spring.main.web-application-type=none --desk.reembed=...` (`JAVA/rag/EmbeddingSwitch.java` lines 157-162); `JOBS_ENABLED` exists (`Env.java` line 113). So `--desk.reapply-erasures` can run before the service starts.
- **Retry rows.** FACT: `callPolicy.retry.enabled` is `false` in `usecases/hiring.json` (line 136), and only `JAVA/voice/VoiceSessions.java` references `scheduled_calls` (grep of `apps/api-java/src/main/java` and `apps/api/src`). So v6's `UseCase` validation and the erasure's `scheduled_calls` cancel served only A2.
- **Prompt fence.** FACT: `hiring.json` line 86 fences the role brief with `<<<ROLE` / `ROLE>>>`, while `ContextPacker.sanitize` neutralises only `<<<UNTRUSTED_DATA` / `END_UNTRUSTED_DATA>>>` (`JAVA/rag/ContextPacker.java` lines 14-23). AM-1 is correct.
- **Hosted agents today.** FACT: `provisionLocked` always uses `environment = 'test'`, one hosted agent per agent version, re-synced when the job context hash changes; there is no re-sync guard in today's code (`JAVA/voice/VoiceSessions.java` lines 154-219; grep for `agent_in_use` finds nothing). Answer keys are derived from the question label (`Coverage.key(c.label())`, `JAVA/engine/CallContextCompiler.java` line 206). So the pre-existing wrong-script race can lose answers but cannot put another job's answers under this job's question labels.
- **Self-serve calling.** FACT: `BudgetGuard.assertCanCall` checks limits only when they are non-null (`JAVA/cost/BudgetGuard.java` lines 45-56); `Organizations.remove` hard-deletes at once (`JAVA/team/Organizations.java` lines 100-107); the outbound route defaults to `india` (Exotel) (`docker-compose.yml` line 101, `.env.example` line 144).

### R7.2 Mechanisms removed, and why

| # | Mechanism in v6 | Why removed | Where it went |
|---|---|---|---|
| 1 | "Call selected (N)", `POST /jobs/{j}/calls/queue`, the confirm dialog, "Queued to call" tags | Scope cut (R7.0 item 1) | `later-bulk-calling.md` §2.1 |
| 2 | Bulk dial thread, at-most-once row states, crash recovery, `SmartLifecycle` stop | A2 | later doc §2.2 |
| 3 | Stable dial error codes (`calls.concurrency_cap` ... `calls.dial_failed`) | Existed only so the dispatcher could decide each row's next state | later doc §2.2 |
| 4 | `UseCase` validation refusing `callPolicy.retry.enabled: true` | Only kept non-bulk open rows from blocking bulk rows; retry is off today (R7.1) | later doc §2.2 |
| 5 | One hosted agent per job (`job:<id>` deployment slot) | A2 | later doc §2.4 |
| 6 | Refusing a dial whose knowledge retrieval failed (`calls.busy`) | Protected the per-job slots and the same-job guard; today's behaviour stays as it is | later doc §2.4 |
| 7 | Same-job re-sync guard (`calls.agent_in_use`) | A2 | later doc §2.4 |
| 8 | Idle stale job-agent deletion; `deleteAgent` outside workspace deletion | A2, and the subject of two round-6 majors | later doc §2.4, §3 items 2-3 |
| 9 | `provider_busy` class, the `voice_sessions` delete-policy migration, `VOICE_BULK_MAX_CONCURRENT`, the burst-off test | A2's shared-capacity handling | later doc §2.3 |
| 10 | Transport-based `network` rule and the `dial_uncertain` app state | Served A2's at-most-once rule and its "didn't connect" shortcut; outbound already excludes any dial without a conversation id | later doc §2.3 |
| 11 | Background reconcile for **every** org inside the 5-minute loop | Lead decision: only orgs whose results must leave without anyone opening HRVoice, on the integration lane, 40 s budget, stop at the first timeout | v7 §6.1 (`fetch_results`) |
| 12 | 5-minute loop with a 40 s reconcile step and a 15 s provider-delete step | Provider HTTP moved to lane jobs; the loop now does database work only | v7 §6.1 |
| 13 | `spring.task.scheduling.pool.size` 3/4 and its test | Needed only because provider HTTP ran on the scheduler thread | later doc §2.5 |
| 14 | Heartbeats, `degraded` `/health`, `oldestQueuedCallMinutes`, `oldestUndeliveredMinutes`, the health log line | Served the dial thread and the ordered drain; round 6 (BE-5, CR-2) showed they would flap. Gate P's external uptime monitor stays; v7 R13 records the ceiling | later doc §2.5 |
| 15 | `AUTOMATION_PAUSED` for the dial thread; restore cancelling bulk rows; erasure cancelling `scheduled_calls` rows | A2 | later doc §2.5 |
| 16 | In Core: the ordered `integration_events` log, per-org `seq`, the events lock in every stage change, `fanout_seq` drain, poison-head probe, `missed_until`, delivery rows keyed by event | Lead decision 2 (CR-1). Notes do not need order; stage write-back was already level-triggered from `pushed_stage` | Log, `seq`, outbox, purge, `superseded`, epoch: Dev only. Drain, probe, `fanout_seq`, `missed_until`: deleted |
| 17 | `Snooze` as a queue outcome | Its uses (page chaining, rate-limit pause, drain backoff, stage hold) are covered by the tick re-enqueueing due work, `rate_limited_until` on the connection and `next_attempt_at` on delivery rows. Not asked by a reviewer; removed under R7.0 item 4 | deleted |
| 18 | `result_emitted_hash` / `result_version` in Core | Only the feed's per-call `call.ended` dedupe needs them | Dev |
| 19 | Intake rejection of numbers outside `VOICE_DIAL_COUNTRY_CODES` | Round 6 IA-5; the dial-time check is the control | deleted |
| 20 | Dial-time destination allowlist and carrier geo-permissions in slice 0 and gate P | A risk that exists today, independent of integrations (R7.0 item 3) | v7 item G |
| 21 | Decision 10a, the platform capacity formula, R22 as an A2 risk | A2 | later doc §2.8; R22 reframed as pre-existing under item G |
| 22 | "`/health` reports backlog per kind" (v6 §6.8 item 6) | Contradicted v6's own removal of `jobsBacklog` from public `/health`; nothing needs it | deleted |
| 23 | "Why not the provider's batch-calling API" and "no dashboard batches" | A2 | later doc §2.7 |
| 24 | V2 items tied to A2: dial-time `dynamic_variables` to match `dial_uncertain` webhooks; a `voice_provider_deployments.job_id` column | A2 | deleted from V2 |
| 25 | Founder screenshots of the A2 dialog and tags | A2 | the screenshot list now covers the Connected systems card, removal dialog, delivery line, job note and call states |

### R7.3 What v7 adds or changes, with the rule-4 reason

| Change | Rule-4 reason | v7 |
|---|---|---|
| `integration_deliveries`: one row per (connection, call) for notes and per (connection, candidate) for stage, with `content_hash`, status, attempts, `next_attempt_at`; discovery by the tick, a compare-and-set on the hash when marking `sent`; a run stops at the first transient failure; rows taken in `next_attempt_at` order | Replaces the ordered log for E (R7.0 item 2); prevents duplicate notes and lost results without ordering | §2.3, §6.1, §7 |
| A row unsent 7 days after its call becomes `expired` and is shown | Stops results disappearing silently; replaces `missed_until` | §6.1 |
| `fetch_results:<org>` and `provider_delete:<org>` as lane jobs with budgets | R7.0 item 2: provider HTTP off the scheduler thread | §6.1, §11.1 item 10 |
| Sender re-checks erasure; erasure deletes the person's delivery rows; the Dev sweep's update requires `content_erased_at IS NULL`; the feed skips `call.ended` of an erased call | Stops erased call data leaving (round 6 IA-3, BE-2) | §6.1, §6.2, §6.5 |
| Erasure record at `<org>/erasures/...`, `ObjectStorage.list`, written before the transaction, re-applied by a non-web CLI before start; Java on S3 in gate P | Stops erased data coming back after a restore (round 6 EIA-2, BE-4) | §11.1 item 13 |
| Prompt fence fix for machine-sourced JD and title | Protects the product rule on the live call (round 6 AM-1) | §11.1 item 9 |
| Vendor HTTP limits (5 s / 30 s / 10 MB) separate from `SafeHttp` (3 s / 10 s / 64 KB) | Narrows an over-broad rule that would make every Zoho import fail (round 6 SA-3) | §3, §6.4 |
| "May create jobs" checkbox on the inbound key; "The agent speaks from this description" on machine-created jobs | Protects the product rule on the live call; reuses the "May remove people" pattern (round 6 SA-4) | §11.1 items 2, 9 |
| Provider retention for new conversations only, else left out of provisioning | Stops a retention change deleting existing recordings (round 6 EIA-4) | §11.1 item 10 |
| `deleteAgent` only on workspace deletion, after conversations | Keeps recordings safe whatever the provider does (round 6 EIA-1, BE-1) | §11.1 item 10 |
| Stage hold from `candidates.updated_at`; decider name from the latest stage audit row, "a team member" otherwise | Removes the stage write-back's dependency on the event log (CR-1's proposal) | §7 |

### R7.4 Round-6 objections: how each was handled

| Id | Objection (short) | Handling | Reason and change |
|---|---|---|---|
| IA-1 (major) | Exotel's channel cap burns queued rows and daily caps across tenants | **Moved** to `later-bulk-calling.md` §3 item 1 | A2 left the plan. For a manual click, an Exotel refusal stays a failed dial as today; it has no conversation id, so it never leaves HRVoice |
| IA-2 | Idle-agent delete races a dial | **Moved** (later doc item 3) | A2 |
| IA-3 | The sweep's compare-and-set ignores erasure | **Applied** | Stops an erased call leaving. Dev update gets `AND content_erased_at IS NULL`; the E sender re-checks; erasure deletes delivery rows. v7 §6.1, §6.5 |
| IA-4 | `/v1`-created jobs cannot be called until someone links an agent | **Docs only** | Reference docs and the key screen say a person must link an agent. IA's auto-link of the single published agent is **not adopted**: it conflicts with SA-4's human gate on what the agent says. `needsSetup` dropped (not loss, leak or product rule). v7 §6.6, §12.1 |
| IA-5 | Intake rejects numbers outside the allowlist for every workspace | **Applied, as a removal** | The intake check is deleted; the dial-time check stays in item G. Whether any pilot calls outside India is in founder decision 15. v7 §6.6, §13.1 |
| IA-6 | Exotel docs show multi-agent dialing; no fallback | **Moved** (later doc item 5) | A2 |
| AM-1 | `ROLE>>>` in a JD breaks the prompt fence; the title is raw | **Applied** (Core) | Product rule on the live call. One merge-blocking test; one re-sync per hosted agent. v7 §11.1 item 9 |
| AM-2 | Outbound text is untrusted input for the customer's AI tools | **Applied, docs only** | One line in the reference docs; MCP results as `structuredContent` when built; R15. No mechanism. v7 §6.6, §8, R15 |
| EIA-1 (major) | Idle job-agent deletion can destroy recordings and break reconcile | **Moved** (later doc item 2) | A2. v7 keeps `deleteAgent` only for workspace deletion, after conversations, and says so in ADR-010 rule 20 |
| EIA-2 | Restore re-apply needs object-storage operations that do not exist | **Applied** | Stops erased data coming back. Key `<org>/erasures/...`, `ObjectStorage.list`, iterate restored orgs, S3 for Java in gate P. v7 §11.1 item 13 |
| EIA-3 | The delete policy protects "not yet recorded", not "never placed" | **Moved** (later doc item 4) | The policy left with A2 |
| EIA-4 | Retention in the context hash can delete existing recordings | **Applied** | Data loss. New conversations only, verified on a test account, else out of provisioning and set by runbook. v7 §11.1 item 10, §17 |
| EIA-5 | A2 outgrew its estimate | **Moved** (later doc item 13) | A2. All v7 slices re-estimated |
| SA-1 (major) | Self-registered workspaces can drive unattended calls on the shared number | **Recorded** as item G and founder decision 15 (R7.0 item 3) | A risk today, independent of integrations. Not designed further; the dial-time allowlist joins the same item. v7 §13.1, §16, R22 |
| SA-2 | Service-level audit rows attribute key actions to the creator | **Dropped** | Attribution, not loss, leak, tenancy or product rule; `authz.*` and `api.*` rows already carry `apiKeyId`. Listed in V2. v7 §13.2 |
| SA-3 | 64 KB / 10 s applied to vendor APIs breaks Zoho pulls | **Applied** (a narrowing) | Otherwise every initial import fails. v7 §3, §6.4, test |
| SA-4 | Machine-created JDs become the agent's script | **Applied in part** | `jobs.create` behind a checkbox; copy on machine-created jobs; agent linking human-only in ADR-010 rule 11. v7 §11.1 items 2, 9 |
| SA-5 | No per-candidate call frequency limit | **Moved** (later doc item 7) | Driven by one-click batches; for single clicks it is pre-existing and unchanged |
| SA-6 | No way to find one person across jobs for an erasure request | **Applied, docs only** | Decision 9 and the DPA say how a request is handled (operator search, then "Remove this person" per row) until an admin lookup exists (V2). No new mechanism. v7 §11.1 item 10, §16 |
| UX-1 | Bulk selection ignores decisions | **Moved** (later doc item 8) | A2 |
| UX-2 | Removal copy promises a provider deletion we cannot confirm | **Applied** (copy only) | "...deleted from HRVoice now, and we ask our call provider to delete its copy." DPA matches. v7 §11.1 item 10 |
| UX-3 | `dial_uncertain` copy gives no action | **Moved** with `dial_uncertain` (later doc item 9) | The state left the plan |
| BE-1 (major) | Idle job-agent deletion is irreversible and races dials | **Moved** (later doc item 2) | Same as EIA-1 |
| BE-2 | The sweep emits for an erased call | **Applied** with IA-3; the feed skips such items | v7 §6.2, §6.5 |
| BE-3 | The voice kill switch cancels every queued batch | **Moved** (later doc item 10) | A2 |
| BE-4 | Erasure record: no list, S3 PUT inside a transaction and inside the loop, local storage | **Applied** | Intent record before the transaction; ATS anonymisation runs in the `nightly` lane job, so no PUT in the 5-minute loop; S3 in gate P. v7 §5, §11.1 item 13 |
| BE-5 | The `JobQueue.poll` heartbeat threshold would flap | **Dropped** | Heartbeats removed; recorded for a future bulk design (later doc item 11) |
| CR-1 (major) | Core builds the ordered log for E, which does not need it | **Applied** (it is R7.0 item 2) | v7 §6.1, §6.5, §7, §18 |
| CR-2 | `/health` turns `degraded` on normal batches and one tenant's pause | **Dropped** | The mechanism is removed; recorded in later doc item 11 |
| CR-3 | Idle job-agent deletion race | **Moved** (later doc item 3) | A2 |
| CR-4 | Estimates for gate P and Core look too low | **Applied** | Gate P 3-5 days with the adapter fix-up in scope; Core 2-3 weeks; Core + E 6-8 weeks; quote pilots only after gate P's live calls. v7 §13.1 |

### R7.5 Where I departed from a reviewer or went beyond the decision

- **`Snooze` removed** (no reviewer asked): with every lane job level-triggered, it had no remaining use (R7.2 row 17).
- **Background fetch limited to orgs with a live connection**, per the decision's "only to the extent results must flow back without anyone opening the app". Orgs without a connection keep today's behaviour (a result is fetched when opened); recorded as a `ponytail:` in v7 §6.1.
- **`AUTOMATION_PAUSED` kept** for the tick and the lane (incidents, and set during the restore CLI), but the restore no longer depends on pausing a serving process: the re-apply runs before the service starts.
- **Workspace deletion kept** (agreed in rounds 4-5 as part of the erasure gate), but its provider calls moved to `provider_delete` on the lane, and `deleteAgent` runs only there, after conversations.
- **Decider name from the audit row** (CR-1's proposal) with a FACT caveat: the row is written after the stage transaction and failures are swallowed, so "a team member" is the fallback and the test covers it.
- **The stage hold uses `candidates.updated_at`**, which also moves on contact edits; that only delays a push, and is accepted.
- **R18 restated as pre-existing.** With per-job agents gone, the wrong-script race is today's behaviour, unchanged by this plan; outbound cannot mislabel answers because keys come from question labels (R7.1).

### R7.6 Things still open

1. **Founder:** decision 1 (branch); gate P and ADR-008; decision 9 (now also how a cross-job erasure request is handled, and whether the retention purge of a never-called ATS person stops the next pull); **decision 15 (new, item G)**; screenshots of the Connected systems UI before it is built.
2. **Vendor, unverified:** whether a hosted agent's retention can be set for new conversations only through the API; what conversation delete removes; when a call's configuration binds (R18); the Zoho items in v7 §17.
3. **Database, unverified:** that the workspace hard delete passes the RESTRICT foreign keys (one Core test).
4. **Legal:** DPDP processor role; keeping a keyed hash of an ATS application id as a suppression; backup retention of erased data. The TCCCPR question for queued batches moved with bulk calling.
5. **ADR-010 and the build sheets** are still unwritten; v7 §18 holds the ADR's contents.
6. **Bulk calling** is in `later-bulk-calling.md`, NOT APPROVED, with 14 open items; it is to be designed and reviewed separately.
7. Effort numbers remain ASSUMPTIONS for ordering: P 3-5 days, 0 4-6 days, A 1-2 days, G 1-2 days, Core 2-3 weeks, Core + E about 6-8 weeks, Dev about 3 weeks.

## Round 8

Date: 2026-10-03. Input: `architecture-draft-v7.md` and the round-7 reviews of it: Integration Architect (IA) **block**, AI Agent / MCP Architect (AM) approve with changes, Enterprise Integration Architect (EIA) **block**, Security Architect (SA) **block**, Product / UX Architect (UX) **block**, Backend / Distributed Systems Architect (BE) approve with changes, Critical Reviewer (CR) **block**. 5 majors (IA-1, EIA-1, SA-1, UX-1, CR-1), 30 minors, 2 failed checks (IA `results_flow_back`, SA `security_appropriate`). Output: `architecture-draft-v8.md`; two FACT lines added to `later-bulk-calling.md` §3 (items 12 and 14). No code, config, migration or test was changed.

Majors by round: 17, 12, 9, 4, 1, 5, 5. None of this round's majors is about bulk calling, and no reviewer asked for it back: every reviewer said removing A2 leaves the integration goal intact (data in and results out automatically, one Call click per person, stated as R25). Three of the five majors are one subsystem (stage write-back), one is a sentence lost in the v6 → v7 trim (SA-1), one is erasure from inferred evidence (EIA-1).

### R8.0 How I decided

Lead decision R7.0 stays binding. For each major I checked the evidence myself, then took the first rung that holds: (1) cut the scope that causes it, if the goal still holds; (2) reuse an existing mechanism; (3) the smallest new mechanism.

- **Stage write-back: cut considered, rejected.** Option: send decisions only as notes, never `setStage`. That removes every stage major, but R7.0 item 2 keeps stage write-back in Core + E, and the founder's goal names "actions flow back"; without it a recruiter moves every status in Zoho by hand, which is the manual sync the goal rules out. The fixes below reuse existing rows and need no new column, so rung 2 holds.
- **ATS-deletion erasure: rung 1 in part.** The weak signals (absence from a listing, `getApplication` not found) no longer erase anything; only Zoho's documented deletion list does.
- **Anonymisation fields: restore.** v6 text that v7 dropped by accident.

### R8.1 Evidence I re-checked for this round

Repo (FACT):
- `Jobs.updateStatuses` updates `screening_status` and `updated_at` only when the stage changes, but adds a result for every update (`JAVA/hiring/Jobs.java` lines 255-269); `HiringController.stageAudit` writes a `hiring.candidate_status_changed` row with `from`/`to` for every result, after the transaction (`JAVA/hiring/HiringController.java` lines 362-396). So no-op rows exist (BE-2), and an Undo re-posts through the same route (IA-1).
- v7 §5 "Incremental" refreshes `remote_status_seen` for every linked application on every pull, and v7 §7 step 3 compared the live status with it; so the "changed in the ATS" guard only saw changes made since the last pull (CR-1, UX-1). Confirmed by reading v7 alone.
- v7 §7 step 2 closed a row whose stage equals `pushed_stage` without touching `content_hash`, and discovery upserts only "when `content_hash` differs" (v7 lines 340, 343). Walking decline → Undo → hold expires → decline again: the second decline's hash equals the stored one, so nothing is sent (IA-1). Confirmed.
- v6 §5 and §11.1 item 10 cleared name, phone, email and resume text on anonymisation; v7 does not say so anywhere (`architecture-draft-v6.md` lines 196, 536; v7 §2.3, §5, §11.1 item 10, ADR rule 20) (SA-1). Confirmed. `candidates.full_name` is NOT NULL, `phone`, `email`, `resume_text` nullable (`MIG/0015_hiring_desk_foundation.sql` lines 16-19); the phone unique index is partial `WHERE phone IS NOT NULL` (`MIG/0018_job_scoped_candidates.sql` lines 119-121); the dial stores no phone on `voice_sessions` or `agent_sessions` (`JAVA/voice/VoiceSessions.java` lines 425-435).
- `reconcile(Actor, vsId)` is the only reconcile entry point; `reconcileSystem` does not exist (`VoiceSessions.java` line 468). `apply` runs the extractor between two UPDATEs (lines 505-534), and `PostCallExtractor.extract` catches every LLM failure and returns the provider's data (`JAVA/engine/PostCallExtractor.java` lines 69-78).
- `startOutbound` runs `guardEnabled`, `outboundConfigured`, the published-agent check and `BudgetGuard.assertCanCall`, then takes the version lock and calls `dialLocked`, which reads the job and the candidate row `for update` (`VoiceSessions.java` lines 367-424). Phone dials call `provisionLocked(actor, a, jobId, null, false)`, never the per-call path.
- `JobQueue.enqueue` always calls `wake()`, which schedules `runScope` on the 2 general workers; `poll()` runs `runDue()` inline on the scheduler thread; `runDue` visits active orgs one transaction each; account-scope jobs (org NULL) exist (`JAVA/jobs/JobQueue.java` lines 66-100). `background_jobs.organization_id` is `ON DELETE CASCADE` (`MIG/0030_background_jobs.sql` line 21).
- `ObjectStorage` has only `put` and `get` (`JAVA/knowledge/ObjectStorage.java` lines 81-99); documents are stored at `<org>/documents/<checksum>` (`JAVA/knowledge/Knowledge.java` line 175); `Knowledge.deleteDocument` marks the row deleted and drops chunks only (lines 186-195); `Organizations.remove` deletes rows only (`JAVA/team/Organizations.java` lines 100-107).
- Retrieved knowledge passages are appended to the role brief (`JAVA/engine/CallContextCompiler.java` line 161) and the brief passes only through `ContextPacker.sanitize`, which neutralises the `UNTRUSTED_DATA` markers, not `ROLE` (`JAVA/rag/ContextPacker.java` lines 14-23; `usecases/hiring.json` line 86) (AM-2). Confirmed: the hole exists today.
- `PUT /usage/limits` accepts any value including NULL (`JAVA/cost/UsageController.java` lines 174-186); NULL means no limit (`JAVA/cost/BudgetGuard.java` lines 45-56) (CR-3).
- Nest: `requireEmailVerification: false` (`apps/api/src/auth/better-auth.ts` line 106); outbound checks only that it is configured (`apps/api/src/providers/elevenlabs/voice-session.service.ts` lines 987-991); `TELEPHONY_OPEN_OUTBOUND` "Controls desk messaging — does not change dial mechanics" (`apps/api/src/config.ts` lines 190-195) (SA-6). The Java email-verification route exists (`JAVA/auth/BetterAuthController.java` line 421).
- `apps/web/lib/errors.ts` `plainServerText` drops vendor names (its list has no "Zoho"), config tokens, URLs, paths and code-like words, and otherwise shows the server's sentence (lines 69-100) (UX-3).
- The adapter can already allow per-call prompt, first-message and language overrides, behind `DESK_VOICE_PER_CALL_OVERRIDES` (default false); data collection is not overridable (`JAVA/voice/HostedVoiceAdapter.java` lines 76-99; `JAVA/platform/Env.java` line 137) (AM-1).

Vendor documentation (FACT):
- Zoho deleted records: `GET /recruit/v2/{module_api_name}/deleted`, application module supported, `If-Modified-Since`, `type` all / recycle / permanent, response `id` and `deleted_time` (https://www.zoho.com/recruit/developer-guide/apiv2/get-deleted-records.html).
- Zoho status codes: 204 No Content; 400 `INVALID_DATA` "The ID given is invalid."; 403 FORBIDDEN; 404 "Invalid request." No distinct "deleted" reply (https://www.zoho.com/recruit/developer-guide/apiv2/status-codes.html).
- Zoho organisation endpoint: sample shows `company_name`, `primary_userid`, `primary_email`, no org id field; scope `ZohoRecruit.org.all` (https://www.zoho.com/recruit/developer-guide/apiv2/get-org-data.html).
- Voice provider agent API: `platform_settings.privacy.retention_days` (default -1, no limit) and `apply_to_existing_conversations` (default false) (https://elevenlabs.io/docs/api-reference/agents/update). Same page: `bursting_enabled` default true; agent queueing `enabled` default false, "New agents are created with queueing enabled unless this field is set explicitly" (recorded in `later-bulk-calling.md` item 14).
- Twilio outbound call: optional `conversation_initiation_client_data` (https://elevenlabs.io/docs/api-reference/integrations/twilio/outbound-call). Exotel route: unverified.

### R8.2 Failed checks

| Check | Reviewer | Resolution |
|---|---|---|
| `results_flow_back` | IA | A decision made again after Undo (or A → B → A) was never sent. Fixed by one rule: every close of a stage row sets `content_hash = pushed_stage` (R8.3.1). Notes were already correct |
| `security_appropriate` | SA | Anonymisation kept the person's name, phone, email and resume text. Restored from v6 (R8.3.3) |

### R8.3 Majors

#### R8.3.1 Stage write-back (IA-1, UX-1, CR-1; folded in EIA-2, IA-2, BE-1, UX-2)

**Objections.** (a) IA-1: a row closed without a push keeps the dropped target as its hash, so the same decision made again is never discovered. (b) CR-1, UX-1: the "changed in the ATS" guard compares with `remote_status_seen`, which every pull refreshes, so a status someone set in Zoho hours earlier (or during `principal_lost`, before Take over) is overwritten, possibly emailing a rejection (decision 7). (c) CR-1, UX-1: a reconnect does not re-baseline, so decisions made while "Not connected" are written in bulk. (d) EIA-2: a closed application (hired, withdrawn) can be overwritten. (e) IA-2, UX-1: stage rows never expire. (f) BE-1: a decision in its hold is pushed after write-back is switched off. (g) UX-2: stage failures are invisible.

**Checked.** All confirmed against v7's text and the code (R8.1).

**Decision (rung 2: existing rows, no new column).**
1. **Overwrite allowlist** (CR-1's proposal b, with EIA-2's closed rule): `setStage` only when the live application is open and its status is the connection's trigger status or the mapped target of `pushed_stage` (the status we last wrote). Otherwise a note carrying the decision and the decider, and the status is left alone. `remote_status_seen` becomes display only. This replaces the broken comparison instead of patching it.
2. **One rule for every close** (IA-1): one transaction sets the link's `pushed_stage` and closes the row with `content_hash = pushed_stage`, as a compare-and-set on the hash read at the start. A permanently failed or expired row keeps its target hash, so it is not retried until the decision changes.
3. **Reconnect re-baselines** (CR-1 c, UX-1 a): the transaction that moves `connected_at` runs the same UPDATE as switching write-back on. `connected_at` now moves only when a `disconnected` connection is connected again; recovering from `needs_attention` does not, so decisions made while the footer promised a write are still sent (under rule 1 and the expiry).
4. **Expiry** (IA-2, UX-1 c): a stage row pending 7 days after `candidates.updated_at` becomes `failed`/`expired`; card line "N decisions couldn't be set in Zoho Recruit."
5. **Switch read at send time** (BE-1): step 0 of the handler closes the row (`skipped`) if write-back is off, the target is unmapped or `actions.integrations` is false.
6. **Visibility** (UX-2): one line under a linked person's decision, from the stage row; `last_error_code` on a sent row records `note_only` or `skipped`.

**Not adopted:** UX-1 (b)'s new column `remote_status_at_decision`. Rule 1 needs no column and is stricter. Ceiling recorded as `ponytail:` in v8 §7: if a customer's ATS moves new applications on by itself after import, decisions arrive as notes; the column is the V2 upgrade.

**Tests (v8 §11.1):** decide, Undo, wait, decide again → one `setStage`; ATS moved to Interview an hour before → note, zero `setStage`; closed as Hired → note; `principal_lost` + ATS change + Take over → note; disconnect, decide 10, reconnect → zero `setStage`; switch off within the hold → zero `setStage`; stage expiry.

**v8:** §2.3, §6.1 step 8, §7, §12.2, §18 rules 10 and 12, R20, R26.

#### R8.3.2 Erasure from an inferred ATS deletion (EIA-1)

**Objection.** A link missing from the nightly listing, then `getApplication` not found after 7 days, was anonymised: transcript, answers and the provider's conversation deleted, irreversibly. A reconnect or Take over into a different Zoho account (or a user who sees fewer records) makes every link missing; Zoho has no distinct "deleted" reply for a read by id (204, 400 `INVALID_DATA`, 404 "Invalid request").

**Checked.** Confirmed: v7 §5; Zoho status codes and the deleted-records list (R8.1).

**Decision.**
1. **Positive evidence only** (EIA's rule 1, adopted fully): the nightly job reads Zoho's deleted-records list for applications; a linked application on it becomes `deleted` with `remote_state_changed_at` = its `deleted_time`, and is anonymised once that is older than the grace period. Absence from a listing or any error reply makes the link `missing` (new `remote_state` value: not dialable, reversible, never erased). `getApplication` no longer decides deletions. An adapter without a deletion list never anonymises automatically.
2. **Same account on reconnect** (EIA's rule 2, adopted in a cheaper form): instead of storing a vendor org id (Zoho's org endpoint documents none in its sample and needs an extra scope), every later sign-in for an existing connection runs step 6's read-only check against the connection's open linked jobs; if it sees none, the connection is not activated (`integrations.different_account`). It reuses `job_links`; no column, no scope. With rule 1 in place a wrong account can at worst mark links `missing`, so this check is about clarity, not safety.

**Tests:** 204/`INVALID_DATA` for every link → nothing anonymised, nothing deleted at `FakeVoice`, links `missing` and back to `open` when seen; deleted-list entry past grace → anonymised; reconnect with a sign-in that sees no linked job → refused.

**v8:** §2.3, §3 (`deletedSince` returns `(id, deletedAt)`), §4, §5, §12.2, §16 decision 9 (recycle bin vs permanent), §17, §18 rule 20, R27.

#### R8.3.3 Anonymisation left the person's own details (SA-1)

**Objection.** v7 anonymised the link and call content but no longer said to clear the candidate row; "Remove this person", ATS-deletion anonymisation and the retention purge would leave name, mobile, email and full resume text.

**Checked.** Confirmed (R8.1): lost in the v6 → v7 trim.

**Decision.** Restore: anonymising sets `full_name` to "Removed in HRVoice" (HRVoice removal, retention purge) or "Removed in <system>" (ATS or `/v1` deletion), sets `phone`, `email`, `resume_text` to NULL, keeps ids, timings, outcomes and cost rows, in the same transaction as the link change. Assertions added to the erasure, "Removing a linked person" and "Deleted in the ATS" tests. ADR rule 20 says it. **v8:** §2.3, §4, §11.1 item 10, §18 rule 20.

### R8.4 Minor objections

| Id | Objection (short) | Handling | Reason and change |
|---|---|---|---|
| IA-2 | Stage rows have no expiry | **Applied** (R8.3.1 item 4) | Stops a silent, endless retry. v8 §6.1 step 8 |
| IA-3 | Core estimate optimistic | **Applied** | Core 3-4 weeks; Core + E 8-10 weeks until the build sheet re-estimates; quote only after that and decision 10b. v8 §13.1 |
| AM-1 | Slice E concentrates imported jobs on one hosted agent (R18); a per-call override path exists | **Applied, docs and one live check** | R18 now says E raises the likelihood; gate P adds "dial job A then job B on the same agent"; the existing override path named as the fix to try first (Twilio documents `conversation_initiation_client_data`; Exotel unverified; data collection is not overridable). Not designed further. v8 §13.1 P, R18, §17; later doc item 12 |
| AM-2 | The fence hole exists today through knowledge passages; fix belongs in slice 0 | **Applied** (moved) | Confirmed in code (R8.1). No new work, only earlier. v8 §2.2, §11.1 item 9, §13.1 |
| AM-3 | `reconcileSystem` is new; budget must include extraction | **Applied** (wording) | New method named; budget checked before each item and covering extraction; an extraction failure does not stop the run (FACT, it is already caught). v8 §6.1 |
| AM-4 | "What they said" presents model output as the candidate's words | **Applied** (copy) | "Answers noted from the call (automatic; check the recording)"; same label in CSV headers and `/v1` docs. Serves the product rule's honest framing. v8 §6.2, §6.7, §7 |
| EIA-2 | Write-back can overwrite an application closed in the ATS | **Applied** (R8.3.1 item 1) | Closed → note only |
| EIA-3 | `reconcileSystem` described as existing; must skip erased sessions | **Applied** with AM-3 | v8 §6.1 |
| EIA-4 | FK actions for the new tables; hard-delete test too narrow | **Applied** | Every new FK `ON DELETE CASCADE`; the test seeds connection, links and delivery rows. Stops a workspace deletion failing silently (data not erased). v8 §2.3, §11.1, §18 rule 5 |
| EIA-5 | Pending notes across disconnect/reconnect undefined | **Applied**, option (a) | Pending note rows are still sent after a reconnect (results of calls made while connected; a note changes nothing in the ATS); stage rows are re-baselined. In the "No backlog" test. v8 §6.1 |
| SA-2 | Provider retention fields are documented | **Applied** | `retention_days` = retention + 7 with `apply_to_existing_conversations: false` explicitly; one gate P check; DPA states our period, not the provider's default (the API page says -1, the guide 2 years). v8 §11.1 item 10, §13.1 P, §17 |
| SA-3 | The 7-day fallback orphans provider ids | **Applied, differently placed** | The workspace erasure record, written by the request before anything else, already lists every conversation and agent id; the fallback only logs the count left and the runbook re-runs deletes from the record. Writing at request time keeps S3 writes out of the 5-minute loop (round 6 BE-4). v8 §11.1 item 10 |
| SA-4 | Workspace deletion leaves `<org>/documents/*` | **Applied** (option a, with BE-5a and CR-4) | `ObjectStorage.delete`; the request deletes `<org>/documents/*` before the status change, never `<org>/erasures/*`; a failure fails the request. The pre-existing single-document gap is recorded for the founder, not built. v8 §11.1 items 10, 13, §13.2 |
| SA-5 | Decider name can name the wrong person when an audit write fails | **Applied** with BE-2 | Latest real stage change (`from` ≠ `to`), used only if its `to` is the stage being sent; otherwise "a team member". Stops a false statement in the customer's record. v8 §7 |
| SA-6 | Item G: Nest has no gate; checks belong in `startOutbound` | **Applied** | §17 item replaced with the facts; decision 15 recommends no later than gate P; placement named (workspace and email checks in `startOutbound`, allowlist and closed-row checks in `dialLocked`). v8 §13.1 G, §16, §17, §18 rule 17 |
| SA-7 | `reconcileSystem` described as existing | **Applied** with AM-3 | v8 §6.1, §10 |
| UX-2 | Stage failures invisible | **Applied** (R8.3.1 item 6) | Card line and one line under the decision; added to the founder screenshots. v8 §12, §12.2 |
| UX-3 | Closed-row dial refusal has no code or board state | **Applied** (copy and code) | `candidates.closed_externally`, "Closed in Zoho Recruit. Reopen them there to call.", Call disabled on such rows. No `errors.ts` change: `plainServerText` already shows that sentence (FACT, R8.1). v8 §5, §12.2 |
| UX-4 | Shared hosted agent exposure grows with imported jobs | **Applied** with AM-1 | Gate P live check; no mechanism |
| BE-1 | Stage push ignores a switch-off during the hold | **Applied** (R8.3.1 item 5) | v8 §7 step 0 |
| BE-2 | Decider name from a no-op audit row | **Applied** with SA-5 | v8 §7 |
| BE-3 | Lane must not reuse the inline poll or the general `wake()` | **Applied** | Lane poll only submits to the lane executor; integration enqueue does not call `wake()`; the general claim excludes `integration`; the isolation test covers an enqueue. v8 §6.8, §18 rule 18 |
| BE-4 | FK actions and hard-delete test | **Applied** with EIA-4 | |
| BE-5 | (a) documents left in storage; (b) replace the `deleting` state with an account-scope job | (a) **Applied** with SA-4. (b) **Declined** | (b): once the org row is gone, nothing re-enqueues a multi-run provider delete (a handler that throws for "more work" goes `dead` after its attempts, `JobQueue.java` lines 136-161), so it would need a new cross-tenant list or table. v7's `deleting` state is the existing place that holds that work; SA-3's change closes the orphaning gap BE also named |
| BE-6 | Erasure vs an in-flight note send | **Applied** (order only) | Markers listed first, then one short read that re-checks erasure and builds the body immediately before `addNote`; DPA and runbook say an in-progress send can finish within seconds. v8 §6.1 |
| CR-2 | R25 has no founder decision | **Applied** | Decision 10b. v8 §1, §13.1, §16 |
| CR-3 | Default usage limit does not stop abuse | **Applied** (one sentence) | Operator switch = abuse control; default limit = accidental spend only. v8 §13.1 G, §16 |
| CR-4 | Documents left after workspace deletion; erasure keys share the prefix | **Applied** with SA-4 | Cleanup deletes only `<org>/documents/*`; nothing deletes under `<org>/erasures/` (ADR rule 20) |
| CR-5 | Two in-memory registries and four timers | **Applied** (a removal) | Per-org scan as `runDue` does today; no cache to go stale. v8 §6.8 |
| CR-6 | Spreadsheet pilots: lost-webhook results need someone to open each candidate | **Declined for MVP**, V2 | Not data loss: the result is fetched when the candidate is opened, and the CSV cell says so ("Result unavailable: open it in HRVoice to try again"). Background reconcile stays limited to results that must leave without anyone in the app (R7.0 item 2). Doing it at export would need a job-scoped window and key, which is new machinery. v8 §6.7, §13.2 |

### R8.5 Where I departed from a reviewer or went beyond the requests

- **UX-1 (b) column not adopted**; CR-1's allowlist instead (R8.3.1).
- **EIA-1 rule 2 replaced** by the linked-jobs visibility check (R8.3.2).
- **SA-3 placed at request time**, not at the fallback (R8.4).
- **BE-5 (b) declined**, CR-6 declined (R8.4).
- **`connected_at` semantics narrowed** (not asked): it moves only on a reconnect from `disconnected`. Needed so the reconnect re-baseline does not drop decisions made during `needs_attention`, which the footer promised to send.
- **`missing` link state** (not asked by name): needed to keep "not visible" separate from "deleted" without a new column.
- **Stage write-back cut considered and rejected** (R8.0).

### R8.6 Things still open

1. **Founder:** decision 1 (branch); gate P and ADR-008; decision 9 (grace period, now counted from the ATS's deletion time; recycle bin or permanent only); **decision 10b (new)**; decision 15 (recommended no later than gate P); the single-document storage gap (outside integrations); screenshots of the Connected systems UI, the decision line and the disabled Call before they are built.
2. **Vendor, unverified:** when a phone call's configuration binds, and whether the Exotel route takes per-call client data (gate P check); that `apply_to_existing_conversations: false` leaves existing conversations (gate P check); what conversation delete removes; Zoho: the applications module's API name for the deleted list, recycle-bin restore behaviour, notes per application, merges; whether production has phone calling configured today.
3. **Database, unverified:** that the workspace hard delete passes the RESTRICT foreign keys on the voice tables (one Core test, now also covering the new tables).
4. **Legal:** DPDP processor role; keeping a keyed hash of an ATS application id as a suppression; backup retention of erased data.
5. **ADR-010 and the build sheets** are still unwritten; v8 §18 holds the ADR's contents. The Core + E sheet must re-estimate effort before any pilot date.
6. **Bulk calling** stays in `later-bulk-calling.md`, NOT APPROVED.
7. Effort (ASSUMPTION, for ordering only): P 3-5 days, 0 5-7 days (the fence fix moved in), A 1-2 days, G 1-2 days, Core 3-4 weeks, Core + E 8-10 weeks, Dev about 3 weeks.

## Round 9

Date: 2026-10-03. Input: `architecture-draft-v8.md` and the round-8 reviews of it: Integration Architect (IA) approve with changes, AI Agent / MCP Architect (AM) approve with changes, Enterprise Integration Architect (EIA) approve with changes, Security Architect (SA) approve with changes, Product / UX Architect (UX) **block**, Backend / Distributed Systems Architect (BE) approve with changes, Critical Reviewer (CR) **block**. 2 majors (UX-1, CR-1), 47 minors, 1 failed check (CR `not_overengineered`). Output: `architecture-draft-v9.md`. `later-bulk-calling.md` is unchanged. No code, config, migration or test was changed.

Majors by round: 17, 12, 9, 4, 1, 5, 5, 2. Neither major is about bulk calling, and every reviewer again said removing A2 leaves the goal intact (data in and results out automatically, one Call click per person, R25 and decision 10b). One major is the A2 pattern again (pre-existing platform work grown inside Core); the other is an irreversible erasure from a reversible vendor state.

### R9.0 How I decided

Lead decision R7.0 stays binding. For each major I checked the evidence, then took the first rung that holds: (1) cut the scope that causes it; (2) reuse an existing mechanism; (3) the smallest new one. **Both majors were settled on rung 1**, by removing scope rather than adding rules. For minors, I applied a change only when it stops data being lost, leaked, sent to the wrong person or tenant, or the product rule broken, or when it corrects a false statement (in the draft or in copy a customer reads); and only as a rule on a row, query or code path that already exists. Proposals that needed new state were declined or replaced by a cheaper rule (R9.5).

### R9.1 Evidence I re-checked for this round

Repo (FACT):
- `Organizations.remove` writes an audit row, deletes custom role grants in-org, then `delete from organizations`; nothing else (`JAVA/team/Organizations.java` lines 100-107). `deleteCandidate` exists today (`JAVA/hiring/HiringController.java` lines 485-491), so a restore resurrecting deleted people is a risk today, without integrations (CR-1).
- `JobQueue`: `CLAIM_SECONDS = 900` (line 39); the claim takes `(status = 'queued' and run_at <= now()) or (status = 'running' and locked_until < now())` (line 123); `poll()` runs only when `env.jobsEnabled` (`JOBS_ENABLED`, default true, `JAVA/platform/Env.java` line 113), so the existing switch can stop a lane built into `JobQueue` (basis for removing `AUTOMATION_PAUSED`).
- `CallContextCompiler` builds the context hash from prompt, first message, language, max duration, silence, voice id, data collection and tools only (lines 243-248); `VoiceSessions.provisionLocked` reuses a deployment whose stored hash equals the expected one and calls `voice.provision` only otherwise (lines 180-191); `platform_settings` is built in `HostedVoiceAdapter.agentBody` (lines 94-101). So retention fields added to `agentBody` alone never reach an existing hosted agent (AM-1 confirmed).
- `usecases/hiring.json` line 74 inserts `{{companyFacts}}` with no fence; line 86 puts `{{workUnitTitle}}` before the `<<<ROLE` fence; `ContextPacker.sanitize` neutralises only the `UNTRUSTED_DATA` markers (`JAVA/rag/ContextPacker.java` lines 21-23); `CallContextCompiler` passes company facts through `sanitize` only (line 185) (AM-2, SA-3 confirmed).
- `resume_text` is read and written only by `Candidates.java` and the add/edit routes in `HiringController.java` (lines 413-448, 472-476); `CallContextCompiler` never reads `candidates` (AM-3, EIA-7 confirmed).
- `apply` sets `ended_at = coalesce(ended_at, now())` and writes transcript and provider answers in its first UPDATE; the extractor runs after it; a second UPDATE fills `structured_answers = coalesce(structured_answers, ?)` (`VoiceSessions.java` lines 505-534). `ended_at` is set earlier by the lazy expiry (line 266) and `end` (line 602). `PostCallExtractor.extract` returns `answers = null` when it extracts nothing or fails (`JAVA/engine/PostCallExtractor.java` lines 40-95) (CR-2 confirmed, and the ceiling of its fix).
- `scheduleRetry` inserts `scheduled_calls` only when the use case enables retry; `hiring.json` has `"retry": {"enabled": false}` (lines 135-136); the only Java reference to `scheduled_calls` is that insert (`VoiceSessions.java` line 587) (IA's note confirmed).
- `Candidates.update` sets `updated_at = now()` (`Candidates.java` line 113); `Jobs.updateStatuses` sets it only when the stage changes (`Jobs.java` line 264) (IA-3 c, EIA-9, UX-7).
- `docker-compose.prod.yml` sets `STORAGE_BACKEND: s3` for the Nest services (lines 34, 48); Java defaults to `local` (`Env.java` line 98).

Vendor documentation (FACT, read this round):
- Zoho Create Notes: supported modules "candidate, jobopenings, Interview, client, contact, department, task, event, vendor custommodule"; `Parent_Id` and `se_module`; scope `ZohoRecruit.modules.notes.{operation_type}` (https://www.zoho.com/recruit/developer-guide/apiv2/create-notes.html). No application module (IA-1, EIA-2, CR-6).
- Zoho Change Status: modules "candidate, application, jobopening, and offer"; body `ids`, `jobids`, `Candidate_Status`, `comments` (https://www.zoho.com/recruit/developer-guide/apiv2/change-status.html). The same page's menu lists separate Hiring Pipeline APIs (Change Pipeline, Update Stage).
- Zoho deleted records: modules include `candidate` and `application`; header `If-Modified-Since` "To get the list of recently deleted records"; `type` All, Recycle ("deleted records from recycle bin"), Permanent ("permanently deleted records"); sample entries carry `id`, `display_name`, `deleted_by.name`, `created_by.name`, `deleted_time` and `"type": "recycle"` (https://www.zoho.com/recruit/developer-guide/apiv2/get-deleted-records.html) (UX-1, EIA-3, SA-1, IA-2, EIA-4, SA-7).
- Zoho access tokens: "Each access token is valid for only an hour"; "You can only generate a maximum of five refresh tokens in a minute" (https://www.zoho.com/recruit/developer-guide/apiv2/access-refresh.html) (BE-5).
- Zoho Applications module: "New Signups: The Applications module is available by default. Existing Users: ... enabling it will significantly change your interface"; available by default for activation only on Standard and Professional in India, Europe and USA, others via support; Hiring Pipeline stages "Hired, Rejected, archived, and offered"; unselected applications go to Archived (https://help.zoho.com/portal/en/kb/recruit/talent-management/applications/articles/enabling-the-applications-module) (UX-2, UX-3).
- Recycle-bin period: Zoho CRM and Zoho Desk keep 60 days (https://help.zoho.com/portal/en/kb/crm/manage-crm-data/recycle-bin/articles/recycle-bin); Zoho Recruit's period is unverified.

### R9.2 Failed checks

| Check | Reviewer | Resolution |
|---|---|---|
| `not_overengineered` | CR | Core designed two risks that exist today (workspace deletion leaving provider copies and documents; a restore resurrecting erased people). Moved out as item W (R9.3.1). Core loses the `deleting` state, the documents purge, `ObjectStorage.list`/`.delete`, `deleteAgent`, the workspace and per-person erasure records, `--desk.reapply-erasures`, the 7-day fallback and `AUTOMATION_PAUSED` |

### R9.3 Majors

#### R9.3.1 Pre-existing platform work inside Core (CR-1; also IA-6, EIA-8, UX-8, BE-7)

**Objection.** Lead decision item 3 says a risk that exists today is recorded as a launch gate and one small separate item, not designed in this plan. v8 did that for self-serve calling (G) but designed workspace deletion and restore re-apply in full inside Core, and that subsystem drew four objections in round 7 and more machinery each time.

**Checked.** Confirmed (R9.1): `Organizations.remove` and `deleteCandidate` already have both gaps for every customer. Five of seven reviewers raised it. CR's self-healing claim checked against v8 §5: the nightly deleted-records read starts from `integration_connections.cursor`, which a restore rolls back, so ATS deletions made after the backup are read and applied again; the retention purge runs by date; restored delivery rows and links agree, and note markers stop duplicate notes. The one integration-specific case left (a note for a person removed in HRVoice minutes after the backup and before the note was first sent) is the same class as today's `deleteCandidate` exposure.

**Decision (rung 1, cut).** New **item W, "Workspace deletion and restore"**, recorded like G: a launch gate and **founder decision 16**, recommended before the first paid customer or general availability, whichever is first; not designed in this plan. v8 §11.1 item 10 ("workspace deletion" bullet) and item 13 stay on disk as its starting design; its open objections are SA-2 (erasure-record retention) and what deleting an agent does to its conversations. Until W is built, the DPA states the gaps, and the provider retention backstop (kept in Core, fixed by AM-1) limits how long orphaned provider copies live. **Core keeps only what integrations add:** the person-level erasure path (content, `content_erased_at`, the `apply` guard, the person's own details, `deleteConversation` for erased calls), anonymisation with the suppression hash, the retention purge, "Remove this person", the vendor token revoke on workspace deletion, `ON DELETE CASCADE` on new tables and the hard-delete test. Also removed with W: `AUTOMATION_PAUSED` (its only other use, incidents, is covered by `JOBS_ENABLED`, which the lane honours). `AuthResolver.membership` user and workspace checks move to Dev (they were in Core for the `deleting` state; API keys are what need them now; the E sending-principal check is a query in the send job). Gate P keeps `STORAGE_BACKEND=s3`, re-justified: the Nest services already use it in production.

**Effort.** Core 2.5-3 weeks (CR's ASSUMPTION of 4-6 days less), Core + E 7-9 weeks until E's build sheet re-estimates it after the spike; W about 1-1.5 weeks, separate (ASSUMPTION).

**v9:** §1 item 3, §2.2, §2.3, §6.1, §10, §11.1 items 10 and 13, §13.1 (Core, W, launch gates, build sheets), §13.2, §15 R8, R19, R24, §16 decisions 9 and 16, §17, §18 rules 1, 4, 6, 19, 20.

#### R9.3.2 Erasure of a person deleted in Zoho and restored from its recycle bin (UX-1; also EIA-3, SA-1)

**Objection.** v8 read the deleted list with `type=all`, which includes recycle-bin entries. A `deleted` link never went back to live, and the anonymise step did not re-check. A recruiter who deletes an application by mistake and restores it within the grace period still loses the transcript, answers and provider recording, irreversibly.

**Checked.** Confirmed: the Zoho page documents Recycle and Permanent as separate types and its sample entries are `recycle` (R9.1); v8 §5 reverted only `missing` links.

**Decision (rung 1, removal).** UX's option 1: **only permanent deletions count** (`type=permanent`), and decision 9 no longer offers the recycle-bin choice. A recycle-bin entry is simply absent from listings, so the link is `missing` (not dialable, reversible) and comes back at the next complete listing after a restore. The anonymise transaction re-checks `remote_state = 'deleted'` (a predicate on the UPDATE that already exists, so a concurrent change wins). Not adopted: SA-1's `getApplication` veto before erasing (a permanent deletion cannot be restored, and v8 deliberately took `getApplication` out of deletion decisions), and a general revive rule for `deleted` links (not needed once only permanent deletions mark them). Consequence, stated in the DPA: a deletion in Zoho reaches HRVoice once it is permanent there plus the grace period; "Remove this person" erases at once. Unverified and in the spike: Zoho Recruit's recycle-bin period; whether `If-Modified-Since` on the permanent list returns a record whose first deletion predates the cursor (if not, the read reaches back over the recycle-bin period); a record never seen as permanent stays `missing` until the retention purge.

**Tests:** delete to the recycle bin, restore within grace: nothing anonymised, nothing deleted at `FakeVoice`; permanent entry past grace: anonymised; candidate on the candidate module's permanent list with the application not listed: anonymised; a link no longer `deleted` when the anonymise transaction runs: untouched.

**v9:** §2.3, §3, §4, §5, §11.1 tests, §15 R27, §16 decision 9, §17, §18 rule 20.

### R9.4 Minor objections

| Id | Objection (short) | Handling | Reason and change |
|---|---|---|---|
| IA-1 | Zoho notes cannot attach to an application; pipeline stage may not follow a status change | **Applied** (FACT, docs) | Notes and markers on the Candidate record via `external_parent_id`; notes scope added; the "does Change Status move the pipeline stage" check is in the E spike, with the fallback (pipeline API, or write-back limited to accounts without pipelines). v9 §3, §13.1 E, §17 |
| IA-2 | A deleted Candidate is not evidence | **Applied** | Nightly also reads the candidate module's permanent list (2 credits) and matches `external_parent_id`; no column. Stops a person the employer deleted staying in HRVoice. v9 §5 |
| IA-3 | (a) withdrawal then reversal turns into a false note; (b) `pushed_stage` vs a failed compare-and-set; (c) the pull moving `updated_at` | (a) **Applied differently**; (b), (c) **applied** | (a) Allowlist kept strict (R9.5); the note and decision line now claim nothing about who set the status, so they are true in every case. (b) One close rule: `pushed_stage` := the stage handled, unconditionally; only the row close is compare-and-set. (c) The pull never sets `candidates.updated_at`. v9 §5, §7, §12.2 |
| IA-4 | `missing` from a partial listing | **Applied** with EIA-5, UX-4, BE-4, CR-3 | Mark per job, only after that job's listing reached its last page without error in one run, and only among link ids read before the listing started (BE-4's race, without a seen-at column). v9 §5 |
| IA-5 | Lane jobs can outlive their lease | **Applied** with EIA-6, BE-2 | Each lane thread claims only the job it runs at once, orgs in round-robin order; the poll only wakes idle threads. v9 §6.8, rule 18 |
| IA-6 | Workspace deletion bundled into Core | **Applied** (R9.3.1) | Item W |
| AM-1 | Retention fields never reach existing hosted agents | **Applied** | A retention marker in the canonical hash; one provisioning-test assertion. Stops the backstop silently not applying. v9 §11.1 item 10, R19 |
| AM-2 | Title outside the fence; company facts unfenced; rule 11 overclaims | **Applied** (slice 0) | Title moves inside the role fence (replaces v8's title clean-up, a removal); company facts fenced; test extended; rule 11 matches. v9 §2.2, §11.1 item 9, §13.1 0, rule 11 |
| AM-3 | Resume text imported with no use | **Applied** (removal) | Import name, phone, email, status, ids only; V2 if a pilot asks. v9 §4, §12.2 step 1, §13.2 |
| AM-4 | No decision tied to a failed R18 check | **Applied** (one sentence) | If calls change mid-call: step 7 does not pre-select a shared agent and E is not quoted until the founder picks a fix (per-call override on Twilio, or per-job agents). v9 §13.1 P and E gate, R18, rule 1 |
| EIA-1 | Skipped note rows stay at the head of the due list | **Applied** (EIA's query join) with BE-1 | The due-row query takes only rows on live links and unerased calls; expiry moves to the tick so rows the sender no longer takes still expire. Restores "one item never blocks another". v9 §6.1, rule 12 |
| EIA-2 | Notes on applications | **Applied** with IA-1 | |
| EIA-3 | Recycle-bin restore still erased | **Applied** (R9.3.2) | Permanent only |
| EIA-4 | Candidate deletion as evidence | **Applied** with IA-2 | |
| EIA-5 | Only a complete listing may mark `missing` | **Applied** with IA-4 | |
| EIA-6 | Lane claims beyond free threads | **Applied** with IA-5 | |
| EIA-7 | Drop resume text | **Applied** with AM-3 | Vendor 10 MB cap kept, reason restated as page size (ASSUMPTION) |
| EIA-8 | Workspace deletion in Core | **Applied** (R9.3.1) | |
| EIA-9 | Pull may move `updated_at` | **Applied** with IA-3 c | |
| SA-1 | Restore within grace still erased | **Applied** (R9.3.2), veto **declined** | R9.5 |
| SA-2 | Erasure records kept forever | **Moved with W** | Recorded as W's open item and in decision 16: keep for the longest backup window plus a margin, stated in the DPA |
| SA-3 | Company facts unfenced | **Applied** with AM-2 | |
| SA-4 | Suppression key stability | **Applied** (sentence) | Never rotated, backed up with the other secrets; a version prefix only if rotation is ever needed (unprefixed = version 0, so nothing is built now). Stops removed people being re-imported. v9 §5, rule 20 |
| SA-5 | Refused reconnect token; empty linked-job set | **Applied** (two sentences) | Refused token used in memory, revoked, never sealed; no open linked jobs → all linked jobs; none → pass. v9 §5, test |
| SA-6 | Phone-match adoption across shared phones | **Applied** (one condition) | Adopt only when the name also matches (case, spaces, punctuation ignored); otherwise skip and count. Stops one person's answers going to another's ATS record. Also removed: adopting a row whose link is `deleted` (R9.5). v9 §5, test |
| SA-7 | Raw vendor bodies in logs | **Applied** (one line) | Adapter maps to cross-vendor records before anything is logged; covered by the existing `last_error` test. v9 §3 |
| UX-2 | Applications module may be off | **Applied** | E gate "with the Applications module on"; step 6 stops with a plain sentence; Free-plan availability in the spike. v9 §12.2, §13.1, R28 |
| UX-3 | What "closed" means | **Applied** | Hiring Pipeline stage Hired, Rejected or Archived; field name in the spike. v9 §4, §5 |
| UX-4 | (a) `missing` copy; (b) partial listing | **Applied** | (a) Own sentence under the same code ("We can't see them in Zoho Recruit. If they are still there, they come back here within a day."); UX's "press Sync now" not used, because an incremental pull does not return an unchanged record. (b) with IA-4. v9 §5, §12.2 |
| UX-5 | Footer promises a status write | **Applied** (copy) | "...in 2 minutes. If their status there has moved on, we add a note instead."; a note-only promise for closed rows; toast reworded. v9 §12.2 |
| UX-6 | Retry inconsistent | **Applied** (copy) | Retry only on `failed`; `expired` says "Set them there by hand"; the per-call line points to the card's Retry. v9 §6.1, §12.2 |
| UX-7 | `updated_at` as decision time | **Applied** with IA-3 c | |
| UX-8 | Pre-existing work in Core | **Applied** (R9.3.1) | |
| BE-1 | Skipped row never moves back | **Applied** with EIA-1 | EIA's join chosen over BE's "re-read first, then push 1 hour": it never selects such rows, so no marker read is spent on them |
| BE-2 | Lane claims ahead of running | **Applied** with IA-5 | BE's formulation (each thread loops: next org, claim one, run) |
| BE-3 | `pushed_stage` when the compare-and-set fails | **Applied** with IA-3 b | BE's test added |
| BE-4 | Nightly `missing` race and cut-short listing | **Applied** with IA-4 | Race closed by reading link ids before listing (no column) |
| BE-5 | Where the access token is kept | **Applied** (one sentence) | In `secrets_sealed`; refresh only within 5 minutes of expiry, under the existing try-lock; token-endpoint "too many requests" = `RateLimited`. Stops false `needs_attention`. v9 §5 |
| BE-6 | Stage rows left after a re-baseline | **Applied** (one clause) | The re-baseline UPDATE also closes pending and failed stage rows. Stops a card line and Retry for decisions the screen said would not be sent. v9 §7 |
| BE-7 | Workspace deletion in Core | **Applied** (R9.3.1) | |
| CR-2 | Note before the extractor finishes | **Applied** (one condition) | Settled needs `structured_answers` set when a user spoke, or the 90-minute deadline; ceiling stated (no answers at all → 90 minutes). Stops a false "not answered" note in the customer's ATS. v9 §6.1, rule 13 |
| CR-3 | Partial listing marks `missing` | **Applied** with IA-4 | |
| CR-4 | Step-0 skip rediscovered every tick | **Applied** by the one close rule | Every close sets `pushed_stage` and the hash to the stage handled, so a skipped row equals the current stage. Step 0 merged into step 2 |
| CR-5 | "Changed there" copy false after a trigger change | **Applied** (copy) | Neutral note and line, true in every case |
| CR-6 | Zoho notes/comments on applications unverified | **Applied** | Notes: FACT (Candidate record). Half-day spike on the Free India account opens E's build sheet and estimate |
| CR-7 | New Zoho jobs silently never flow | **Applied differently** | One sentence on the setup screen ("Job openings you add in Zoho Recruit later come in only after you link them here."). The card count from `listJobs` is V2: a useful count needs remembered dismissals, which is new state. v9 §12.2, §13.2 |
| CR-8 | Per-org scans scale with sign-ups | **Declined** (column), trigger recorded | `ponytail:` add the due-orgs table past about 1,000 orgs or before self-serve sign-up is opened widely, whichever is first. v9 §6.8 |
| IA note | Record that background fetch cannot start calls | **Applied** (FACT sentence) | Retry disabled in `hiring.json`; nothing reads `scheduled_calls`; switching retry on is a decision 10 matter. v9 §6.1 |

### R9.5 Where I departed from a reviewer or went beyond the requests

- **IA-3 (a): the wider allowlist (either mapped target) is not adopted.** Customers usually map "Moved forward" to a status their own team also sets by hand; allowing it would let a decline in HRVoice overwrite a move made in Zoho and email a rejection, which is the round-7 CR-1 harm. The cost (a withdrawn, then reversed decision arrives as a note) is shown truthfully by the neutral copy.
- **SA-1: no `getApplication` veto.** Permanent-only removes the restore case; adding vendor HTTP to the erasure path would re-introduce a signal v8 removed.
- **SA-4: no version prefix built now**; unprefixed hashes can be treated as version 0 later.
- **CR-7 and CR-8: copy and a recorded trigger instead of new state.**
- **BE-4: no seen-at column**; link ids read before the listing close the race.
- **Not asked:** adoption of a row whose link is `deleted` removed (its pending anonymisation could otherwise reach the adopting application's calls); `AUTOMATION_PAUSED` removed (`JOBS_ENABLED` covers incidents); `AuthResolver.membership` checks moved from Core to Dev; gate P's S3 item re-justified by the Nest production config.
- **Kept, narrower than CR's list:** the retention purge for call content stays in Core with the purge for pulled people. It is the same daily step on the same erasure path, and the provider retention backstop is set from that period.
- **Size:** v9 is about 154 KB against v8's 146 KB, although scope shrank. The growth is FACT citations for the Zoho specifics and the one-line rules and tests above. ADR-010 and the Core + E build sheet should now be lifted from it, so the rationale record stops growing (UX's hygiene note).

### R9.6 Things still open

1. **Founder:** decision 1 (branch); gate P and ADR-008; decision 9 (grace period; only permanent deletions now count); decision 10b; decision 15 (item G, recommended no later than gate P); **decision 16 (new, item W)**, recommended before the first paid customer or general availability; screenshots of the Connected systems UI, the decision line, the disabled Call and the Applications-module stop before they are built.
2. **Vendor, unverified (the E spike):** whether Change Status on an application moves the Hiring Pipeline stage, and that field's name; listing a Candidate's notes cheaply; the Applications module on the Free plan; module API names for the deleted list; `If-Modified-Since` on `type=permanent`; whether a candidate deletion lists its applications; Zoho Recruit's recycle-bin period. **Voice provider (gate P):** when a call's configuration binds (R18; a failure now blocks quoting E); that `apply_to_existing_conversations: false` leaves existing conversations; what conversation delete removes.
3. **Database, unverified:** that the workspace hard delete passes the RESTRICT foreign keys on the voice tables (one Core test).
4. **Legal:** DPDP processor role; keeping a keyed hash of an ATS application id as a suppression; backup retention of erased data and erasure-record retention (decision 16).
5. **ADR-010 and the build sheets** (P, 0, A, G, W, Core + E or Core + Dev) are still unwritten; v9 §18 holds the ADR's contents. E's sheet starts with the spike and re-estimates effort before any pilot date.
6. **Bulk calling** stays in `later-bulk-calling.md`, NOT APPROVED.
7. Effort (ASSUMPTION, for ordering only): P 3-5 days, 0 5-7 days, A 1-2 days, G 1-2 days, Core 2.5-3 weeks, Core + E 7-9 weeks, W about 1-1.5 weeks, Dev about 3 weeks.

## Round 10

Date: 2026-10-03. Input: `architecture-draft-v9.md` and the round-9 reviews of it: Integration Architect (IA) approve with changes, AI Agent / MCP Architect (AM) approve with changes, Enterprise Integration Architect (EIA) **block**, Security Architect (SA) **block**, Product / UX Architect (UX) approve with changes, Backend / Distributed Systems Architect (BE) approve with changes, Critical Reviewer (CR) approve with changes. 2 majors (EIA-1 and SA-1, the same finding), 37 minors, 2 failed checks (EIA `results_flow_back`, SA `security_appropriate`), both caused by that finding. Output: `architecture-draft-v10.md`. `later-bulk-calling.md` is unchanged (no reviewer raised anything for it). No code, config, migration or test was changed.

Majors by round: 17, 12, 9, 4, 1, 5, 5, 2, 2. This round's two majors are one finding raised twice. It is the second round running in which automatic ATS-deletion erasure produced a major (round 8: a recycle-bin restore; round 9: a merge of duplicate candidates). Every reviewer again said removing A2 leaves the goal intact (data in and results out automatically, one Call click per person, R25 and decision 10b).

### R10.0 How I decided

Lead decision R7.0 stays binding. For the major I checked the evidence, then took the first rung that holds: (1) cut the scope that causes it; (2) reuse an existing mechanism; (3) the smallest new one. **The major was settled on rung 1** (automatic ATS-deletion erasure leaves this plan for V2), with one rung-2 rule for the part that remains in scope (notes follow a merge through a column the pull already writes). For minors I applied a change only when it stops data being lost, leaked, sent to the wrong person or tenant, or the product rule broken, or corrects a false statement (in the draft or in copy a customer reads), and only as a rule on a row, query, column or code path that already exists. Several minors were settled by removing something (the credit budget, the use-case gate, the map-edit re-baseline, adoption of `missing`-linked rows, a predicate in the suppression check, the transcript scan in the settle rule).

### R10.1 Evidence I re-checked for this round

Repo (FACT):
- `apps/api-java/src/main/resources/usecases/` contains only `hiring.json`; its `actions.webhook` is `false` (line 128) and no Java code reads it (grep finds only the `"webhook"` value of `via` in `VoiceSessions.java` lines 521, 644) (IA-1).
- `PostCallExtractor.extract`: `needAnswers = !criteria.isEmpty()` (line 40); provider answers, when any, are kept and, with a provider summary, nothing is extracted (lines 41-45); extracted answers keep only text, store `""` for an unanswered key, cap at 500 characters, and become `null` when no key came back (lines 85-93); any exception returns the provider data (line 76). The extractor's criteria come from the snapshot (`VoiceSessions.java` line 529; the snapshot field is `evaluationCriteria`, `CallContextCompiler.java` line 258) (IA-2, CR-5, AM-1, BE-4, CR-6).
- `HostedVoiceAdapter` lines 151-162: for an object value the adapter stores `value`, `result`, `answer`, `rationale` or the object itself, with no length check; a null or empty non-object value is dropped (AM-3 confirmed).
- `VoiceSessions.startOutbound` lines 441-457: an accepted dial stores `dial.conversationId()` as returned, possibly null, and sets the session `active`; the webhook finds sessions only by `external_conversation_id` (line 637) (AM-2 confirmed).
- `HiringController` lines 483-491: `DELETE /candidates/{id}` calls `Candidates.delete`, which runs `delete from candidates` (`Candidates.java` line 129) (BE-5 confirmed).
- `MIG/0030_background_jobs.sql` line 35: the idempotency index is `(kind, idempotency_key)` while queued or running, across all organisations (EIA-3 confirmed).

Vendor and reference documentation (FACT, read this round):
- Zoho Recruit "Merge Duplicate Records": "All related records, including attachments, to-dos, and interviews, will be linked to the new merged record" and "The records merged to the master record will be deleted permanently and the action cannot be reverted" (https://help.zoho.com/portal/en/kb/recruit/essentials/duplicate-check/merge-duplicate-records/articles/merging-duplicate-records). The page does not name applications among the related records (unverified for applications) (EIA-1, SA-1).
- Zoho "Enabling Applications Module": enabling it "will significantly change your interface, including candidate hiring stages"; a test environment for up to 30 days, then "scheduling the migration at your preferred time"; by default only Standard and Professional plans in India, Europe and USA (https://help.zoho.com/portal/en/kb/recruit/talent-management/applications/articles/enabling-the-applications-module) (EIA-2).
- Zoho Get Records parameters: `fields`, `sort_order`, `sort_by`, `converted`, `approved`, `page`, `per_page`, `cvid`, `territory_id`, `include_child`, `$state`; no job-opening filter (https://www.zoho.com/recruit/developer-guide/apiv2/get-records.html) (IA-5).
- Zoho Get Related Records: `/recruit/v2/{module}/{record_id}/{related_module}`, Candidates among the modules and Notes among the related modules (https://www.zoho.com/recruit/developer-guide/apiv2/get-related-records.html). So a Candidate's notes can be listed per record (IA-5, settles half of the item). Get Associated Records lists the candidates associated with a job opening (https://www.zoho.com/recruit/developer-guide/apiv2/get-associated-records.html); listing a job's application ids is still a spike item.
- ElevenLabs outbound call via Exotel: response `conversation_id` "string or null"; request accepts `conversation_initiation_client_data` (https://elevenlabs.io/docs/api-reference/integrations/exotel/outbound-call) (AM-2; also settles v9 §17's open question whether the Exotel route accepts that field).
- ElevenLabs authentication: "Scope restriction: Set access restrictions by limiting which API endpoints the key can access" (https://elevenlabs.io/docs/api-reference/authentication) (SA-2).
- PostgreSQL READ COMMITTED: the second updater "will attempt to apply its operation to the updated version of the row. The search condition of the command (the WHERE clause) is re-evaluated"; and "it can see the effects of concurrent updating commands on the same rows it is trying to update, but it does not see effects of those commands on other rows in the database" (https://www.postgresql.org/docs/current/transaction-iso.html) (CR-2: why the fix is "write the link row first", not a join predicate on the candidate update).
- MCP 2026-07-28 changelog: requires `ttlMs` and `cacheScope` on the results of `tools/list`, `prompts/list`, `resources/list`, `resources/read` and `resources/templates/list` (https://modelcontextprotocol.io/specification/2026-07-28/changelog). AM's `resultType` point is not confirmed by my read (unverified).

### R10.2 Failed checks

| Check | Reviewer | Resolution |
|---|---|---|
| `results_flow_back` | EIA | Failed only because notes for a merged candidate went to a deleted `Parent_Id`. Every pull and nightly listing now rewrites `external_parent_id` from the application's current Candidate (R10.3); a note refused in the window before that refresh is `failed`, shown, and succeeds on Retry. |
| `security_appropriate` | SA | Failed only because a routine merge could make HRVoice erase a live candidate. No ATS signal erases anything any more (R10.3). |

### R10.3 Major: a Zoho merge of duplicate candidates could erase a live person (EIA-1, SA-1)

**Objection.** v9 counted a Candidate on Zoho's `type=permanent` deletion list as evidence that every link with that `external_parent_id` was deleted. Zoho's merge permanently deletes the merged-away Candidate and re-links its related records to the master. So a routine merge would mark a live application `deleted`; after the 7-day grace the nightly job would anonymise the person, erase their recording, transcript and answers and ask the provider to delete its copy, irreversibly. Separately, `external_parent_id` was never refreshed, so every later note for that person went to a deleted record and failed.

**Checked.** Confirmed against the Zoho merge page (R10.1) and v9 §5 ("a link whose `external_parent_id` is on the second → `remote_state = 'deleted'`"; the Incremental row refreshed only `remote_status_seen` and `remote_state`; only `missing` links reverted). Also confirmed the pattern: this mechanism drew UX-1's major in round 8 (recycle-bin restore) and this one in round 9, and it still rested on five unverified Zoho behaviours (`If-Modified-Since` on `type=permanent`, whether a candidate deletion lists its applications, the recycle-bin period, what a merge does to application ids, and whether a merged-away Candidate appears on the permanent list).

**Decision (rung 1, cut; rung 2 for what remains).**
- **Automatic erasure on ATS deletion leaves this plan** and becomes a V2 item with its own spike and review (v10 §13.2). Removed from v10: the two permanent deletion-list reads, `deletedSince` and `Deleted` in `AtsPort`, the ATS grace period, the anonymise step in the nightly job, the card line "2 people deleted in Zoho Recruit will be anonymised on 10 Oct", and four spike items (the deleted list's module names, `If-Modified-Since` on `type=permanent`, whether a candidate deletion lists its applications, the recycle-bin period). `deleted` is now only "anonymised" (or, for a `custom` link in Dev, a `/v1` deletion waiting for its grace period). In E nothing the ATS does erases a person: a person deleted, recycle-binned, merged away or moved off the job is absent from the next complete listing, so the link becomes `missing` (not callable, nothing sent, reversible), and content goes at the retention purge or with "Remove this person". The DPA and the `missing` card line ("If they were deleted there for good, remove them here too.") say so. Founder decision 9 now asks whether that is acceptable.
- **Notes follow a merge (rung 2):** the incremental pull and the nightly listing write the application's current Candidate id into `external_parent_id`, a column the upsert already writes. A note refused as `NotFound` in the window before that refresh is `failed` and shown, and succeeds on Retry (at most a day).
- **Spike:** a merge of two test candidates where the duplicate has an application on a linked job (id kept? Candidate moved? returned by the incremental pull? notes moved?).
- **Test:** `FakeAts` merges the candidate while the application stays listed: nothing anonymised, nothing deleted at `FakeVoice`, `external_parent_id` updated, the next note goes to the master record. The "Deleted in the ATS" test now checks that nothing is ever anonymised from an ATS signal.

**Why not the reviewers' three rules.** EIA and SA proposed keeping candidate-module evidence only for `missing` links, reviving a `deleted` link seen live, and the parent refresh. Those rules are sound, but they keep a mechanism that has failed review twice, add an ordering problem in the nightly run (evidence read before a link turns `missing` is skipped and the cursor moves past it, which BE-1 and CR-3's "deletion lists first" order would make common), and still depend on an unverified merge behaviour: if Zoho gives a merged application a new id, the old id disappears, the old link is `missing`, and candidate-module evidence would erase the person anyway. The integration goal holds without automatic erasure; CR-10 had already proposed making it cuttable. The three rules are recorded as the starting point of the V2 item.

**v10:** header table, §1 item 6, §2.2, §2.3, §3, §4, §5 (Incremental, Nightly, Deletions), §6.1 step 4, §11.1 items 10 and 13 and tests, §12.2, §13.1 E, §13.2, §14.2, §15 R27, R28, §16 decision 9, §17, §18 rules 12, 20.

### R10.4 Minor objections

| Id | Objection (short) | Handling | Reason and change |
|---|---|---|---|
| IA-1 | The renamed `actions.integrations` stays `false`, so nothing would be sent | **Applied by removal** | The gate is dropped instead of set to `true`: one use case exists, and discovery already needs a candidate with a live link, which only hiring creates; a second use case gets its own outbound design (D18). The Dev `call.ended` emission has no gate either. v10 §2.3, §6.1, §6.5, §7, rule 12 |
| IA-2 | Settle rule delays notes 90 minutes on jobs with no questions | **Applied** with CR-5 | Settled = failure reason, or transcript and (answers stored or no `evaluationCriteria` in the snapshot), or 90 minutes. Test: a no-question job's note leaves at about 3 minutes. v10 §6.1, rule 13 |
| IA-3 | Suppression checked only on one HRVoice job | **Applied (a predicate removed)** | Checked per connection; dialog copy "HRVoice won't bring them in again." Test extended. Stops a removed person being re-imported. v10 §5, §11.1 item 10 |
| IA-4 | Adopting a `missing`-linked row gives a candidate two links | **Applied** | Adopt only unlinked rows; `UNIQUE (connection_id, candidate_id)` on `candidate_links` (a constraint on a table this plan adds). Stops a stage write or note reaching the wrong application. v10 §2.3, §5, test |
| IA-5 | Spike misses per-job listing and per-record note listing | **Applied; half settled as FACT** | Get Related Records lists a Candidate's notes per record (FACT); Get Records has no job filter (FACT); per-job application listing and both credit costs are spike items; `listApplicationsForJob` added to the sketch. v10 §3, §13.1 E, §17 |
| IA-6 | §1 item 6 overclaims "every phone call" | **Applied (copy)** | Notes for people from the connected ATS (a live link); `call.ended` for every call in Dev; hand-added people stay in HRVoice. v10 §1 |
| AM-1 | After the deadline a note says "not answered" when answers were never stored | **Applied** with BE-4, CR-6 | Per question in `ExternalPayloads` and the CSV: stored text or number → the value; key stored empty → "not answered"; no key or another type → "not noted; check the recording". Answers block only for `completed`. Hash change → "Updated result". v10 §6.1, §6.2, rule 13, tests |
| AM-2 | Exotel may accept a call with a null conversation id | **Applied (gate P)** | FACT confirmed. Gate P live check (3), and the adapter fix-up stores such a dial as `failed` (`no_conversation_id`) so it shows in HRVoice. Pre-existing behaviour, fixed where gate P already fixes the adapter. v10 §13.1 P, §17, rule 1 |
| AM-3 | Wrong FACT: the adapter does not cap at 500 characters | **Applied (FACT corrected)** | Only the extractor caps; `ExternalPayloads` caps every answer and takes only text or numbers; forbidden-field test gains a 5,000-character and an object-valued answer. v10 §6.2 |
| AM-4 | Extraction may rate the candidate; answers now reach the ATS unread | **Applied (prompt text, slice 0); fixture test declined** | Both instructions gain "Report only what the candidate said. Never rate, score or judge the candidate yourself." The fixture is declined: a fixed fixture cannot test what a live model returns, and "8/10" can be the candidate's own words. v10 §2.2, §11.1 item 9, §13.1 0, R3, rule 11 |
| EIA-2 | Step 6 tells an admin to turn on the Applications module | **Applied (copy)** | "HRVoice works with Zoho Recruit accounts that use the Applications module. This account doesn't. Turning it on changes how Zoho Recruit works for your whole team, so talk to us first." FACT confirmed. v10 §12.2 |
| EIA-3 | Idempotency keys must carry a tenant id | **Applied (one clause); unit test declined** | Rule 18 states it; every key in the plan already contains a UUID, so the clause guards future keys and a test on four string templates adds nothing. v10 rule 18 |
| EIA-4 | Ship import and notes before stage write-back | **Applied (sequencing)** with UX-4 | E1 (import, notes, closed and missing rows, removal) is what the pilot gets; E2 (stage write-back) follows behind its switch once decision 7 is answered. Effort: Core + E1 about 5.5-6.5 weeks, E2 about 1-1.5 weeks (ASSUMPTION). v10 §7, §13.1, §16 |
| SA-2 | Provider delete abandons erasure on 401/403 | **Applied (classification) + gate P check** | 401 and 403 are retried like a 5xx and keep the conversation id; only 404 and a per-item refusal clear it; gate P check (4): the production key deletes a test conversation. No new alerting: a key that cannot delete is found at go-live. v10 §11.1 item 10, §13.1 P, test |
| SA-3 | Take over keeps using the departed person's Zoho grant | **Applied (reuse)** | Take over is the admin's own sign-in through the reconnect flow, with its account check; the old token is revoked after the new one is sealed. v10 §5, §10, test, rule 20 |
| SA-4 | Removal copy and DPA omit notes already in Zoho | **Applied (copy)** with UX-2, CR-8 | Dialog: "They stay in Zoho Recruit, and so do the notes HRVoice already added there; delete those in Zoho Recruit if needed."; DPA: notes in the customer's system follow that system's retention. v10 §11.1 item 10 |
| UX-1 | Skipped applicants are never retried; the card line can vanish | **Applied (semantics of an existing column, copy); names declined** | `last_sync_issues` keeps one entry per skipped application until it is imported or its job unlinked; copy names the fix that works (edit in Zoho → re-read by the next pull). Showing names is declined: it would put personal data into a connection-level column that holds ids only. v10 §2.3, §5, §12.2, test |
| UX-2 | Erasure copy: notes stay in the ATS | **Applied** with SA-4 | |
| UX-3 | (a) bulk toast true only with write-back on; (b) step 1 should say notes go on the candidate's record | **Applied (copy)** | (a) Toast only when write-back is on, counting only linked people, "Set in Zoho Recruit in 2 minutes, or added as a note, for N of these"; (b) "a note on the candidate's record after each call, naming the job". v10 §12.2 |
| UX-4 | Time to first value inside E | **Applied** with EIA-4 | |
| BE-1 | Nightly has no resume point or due marker; erasure could starve | **Applied** with CR-3 | Progress `nightly = {day, done, lastRunAt}` in the existing `cursor`, written with `jsonb_set`; enqueued when the day changes or, at most hourly, while a linked open job is not done; no job listed twice a day. The starvation half is moot: the nightly job no longer erases. v10 §2.3, §5, test |
| BE-2 | Token refresh can overwrite a disconnect, reconnect or Take over | **Applied (compare-and-set variant)** | The refresh's UPDATE adds `secrets_sealed = :sealedRead AND status <> 'disconnected'`; on no row, the new token is dropped. Chosen over taking the lock in every writer: one predicate on one statement. Test: disconnect during a refresh leaves `secrets_sealed` NULL. v10 §5, rule 20 |
| BE-3 | Stage-path notes have no marker | **Applied (reuse)** | `HRVoice ref s<candidate prefix>.<stage hash prefix>`, checked with `noteMarkers` first. Test. v10 §5, §7, R2, rule 10 |
| BE-4 | False "not answered" in the ATS and CSV | **Applied** with AM-1 | |
| BE-5 | The existing `DELETE /candidates/{id}` must be the erasure path | **Applied** | `Candidates.delete` runs the erasure path; no plain delete remains (FACT: today a plain delete would drop the suppression and orphan transcripts). Test goes through the existing route. v10 §2.2, §11.1 item 10, §13.1 Core, rule 20 |
| BE-6 | A status-map edit re-baselines and drops pending decisions | **Applied by removal** with CR-1 | Re-baseline only on switch-on and reconnect; under a new map, a status written under the old one falls back to a note. Test: rename, remap, exactly one `setStage` or note. v10 §2.3, §7, R11, rule 10 |
| BE-7 | Per-minute rehash and an unbatched purge on the scheduler thread | **Applied, and one step further** | The user-turn flag leaves the hash; the retention purge handles at most 500 people per org per run. Further: the settle rule no longer needs it either (criteria clause instead, IA-2), so the tick reads no transcript content. v10 §6.1 |
| CR-1 | Map-change re-baseline drops decisions | **Applied** with BE-6 | |
| CR-2 | A pull can write erased details back | **Applied (lock order, not a join predicate)** | The pull's write for a linked application starts with `UPDATE candidate_links ... WHERE connection_id = ? AND external_id = :ext RETURNING candidate_id`, and the candidate is updated only if a row came back; the erasure path also locks the link first. FACT why not CR's predicate on the candidate UPDATE: READ COMMITTED re-checks the updated row but not other rows (R10.1). Test: anonymise while a pull page waits; the row keeps the placeholder. v10 §5, §11.1 item 10, rule 20 |
| CR-3 | Nightly has no progress state; does it revive `missing`? | **Applied** with BE-1 | Yes: a complete listing puts seen links back to `open` or `closed`, with a fresh `external_parent_id`. v10 §5 |
| CR-4 | The credit budget has no state | **Applied by removal** | Load is bounded by design (15-minute pull, hourly-at-most nightly, one write per note); `RateLimited` → "Paused until"; `ponytail:` a counter in `cursor` if a pilot hits 429s. v10 §5, R6 |
| CR-5 | Settle delay on no-question jobs | **Applied** with IA-2 | |
| CR-6 | R18 check misses answers analysed under another job | **Applied** | Gate P check (1) also asserts call A's stored answer keys are job A's; failure is treated like a mid-call change. The rendering rule (AM-1) makes such answers "not noted", never "not answered". v10 §6.2, §13.1 P, R18, rule 1 |
| CR-7 | Gate P's rollback to Nest must end when Core ships | **Applied** | When Core ships, the Nest service and its Caddy upstream are removed; rollback is a Java image rollback only. v10 §13.1 P and Core, rule 2 |
| CR-8 | Removal copy and DPA omit notes in the ATS | **Applied** with SA-4 | Plus the DPA sentence on the customer system's retention |
| CR-9 | The reconnect account check guards only a self-reversing state | **Declined** | It is a wrong-tenant guard: notes carry answers and are addressed by record ids from the first account, and no Zoho document says another organisation can never hold a record with the same id (unverified, added to §17). Rule 4 of the lead decision keeps mechanisms that stop data reaching the wrong tenant. Take over (SA-3) now uses it too |
| CR-10 | Make ATS-deletion propagation cuttable by the spike | **Applied, more strongly** | Cut now, V2 (R10.3) |

### R10.5 Where I departed from a reviewer or went beyond the requests

- **EIA-1, SA-1: cut instead of the three proposed rules** (R10.3). The parent refresh, their third rule, is kept.
- **IA-1: the gate is removed, not set to `true`** (IA offered both).
- **AM-1, BE-4: per-question text instead of one summary line.** One rule covers every case (no answers at all, some answers, another job's keys) and stays truthful per question.
- **AM-4: prompt text applied, fixture test declined; EIA-3: clause applied, unit test declined; UX-1: names not shown; SA-2: no new alerting** (reasons in R10.4).
- **CR-2: a different fix from the one proposed** (link row first, with the PostgreSQL reason).
- **CR-9: declined** (wrong-tenant guard).
- **BE-7: went further** (no transcript content read by the tick at all).
- **Not asked:** the Exotel route's `conversation_initiation_client_data` is now FACT (R18 and §17 updated; whether it overrides on a live Exotel call stays unverified); a note refused as `NotFound` after a merge recovers on Retry once the listing refreshes the parent id (one sentence in §6.1 step 4, no mechanism); the MCP `ttlMs` and `cacheScope` requirement is noted for the MCP build sheet (§8).
- **Size.** v10 is about 176 KB against v9's 154 KB, although scope shrank: the growth is FACT citations and one-line rationale for each round-9 change, plus the header table. Four reviewers asked that ADR-010 and the build sheets be lifted now. v10 says it should be the last revision of the rationale record; further review should go to ADR-010 and the Core + E1 build sheet.

### R10.6 Things still open

1. **Founder:** decision 1 (branch); gate P and ADR-008; decision 9, which now also asks whether a deletion in the ATS may leave the person's HRVoice content until the retention period or a removal; decision 7 (needed for E2 only); decision 10b; decision 15 (item G, recommended no later than gate P); decision 16 (item W); screenshots of the Connected systems UI, the decision line, the disabled Call, the Applications-module stop and the skipped-applicant lines before they are built.
2. **Vendor, unverified (the E spike):** how to list one job opening's applications completely, and its credit cost; the credit cost of listing a Candidate's notes; whether Change Status moves the Hiring Pipeline stage, and its field name; the Applications module on the Free plan; what a merge does to an application's id, Candidate, modified time and notes. **Voice provider (gate P):** when a call's configuration binds and whether answers are analysed under another job's configuration (R18; a failure blocks quoting E); a conversation id on every accepted dial; that the production key can delete a conversation; that `apply_to_existing_conversations: false` leaves existing conversations; what conversation delete removes; whether the Exotel per-call override applies on a live call.
3. **Unverified, recorded:** whether Zoho record ids can repeat across Zoho organisations (CR-9); whether the workspace hard delete passes the RESTRICT foreign keys (one Core test); MCP `resultType` (AM).
4. **Legal:** DPDP processor role; whether leaving ATS-deleted people's call content until the retention period is acceptable under the DPA; keeping a keyed hash of an ATS application id as a suppression; backup retention of erased data (decision 16).
5. **V2, recorded with its starting design:** automatic erasure on ATS deletion (v9 §5 plus the round-9 fixes in R10.3), after its own spike and review.
6. **ADR-010 and the build sheets** (P, 0, A, G, W, Core + E1, E2, Core + Dev) are still unwritten; v10 §18 holds the ADR's contents. E's sheet starts with the spike and re-estimates effort before any pilot date.
7. **Bulk calling** stays in `later-bulk-calling.md`, NOT APPROVED.
8. Effort (ASSUMPTION, for ordering only): P 3-5 days, 0 5-7 days, A 1-2 days, G 1-2 days, Core 2.5-3 weeks, E1 about 3-3.5 weeks, E2 about 1-1.5 weeks, **Core + E1 about 5.5-6.5 weeks**, W about 1-1.5 weeks, Dev about 3 weeks.

## Round 11

Date: 2026-10-03. Input: `architecture-draft-v10.md` and the round-10 reviews of it: Integration Architect (IA) **block**, AI Agent / MCP Architect (AM) approve with changes, Enterprise Integration Architect (EIA) approve with changes, Security Architect (SA) approve with changes, Product / UX Architect (UX) approve with changes, Backend / Distributed Systems Architect (BE) approve with changes, Critical Reviewer (CR) **block**. 2 majors (IA-1, CR-1), 41 minors, 2 failed checks (IA `data_flows_automatically`, CR `not_overengineered`). Output: `architecture-draft-v11.md`. `later-bulk-calling.md` is unchanged (no reviewer raised anything for it). No code, config, migration or test was changed.

Majors by round: 17, 12, 9, 4, 1, 5, 5, 2, 2, 2. Neither major is about bulk calling, and all seven reviewers again said removing A2 leaves the goal intact (data in and results out automatically, one Call click per person, R25 and decision 10b). One major is the A2 pattern a third time (platform policy grown inside integration Core); the other is a real gap in "data flows in automatically" on the inbound side, which ten rounds had looked at less than outbound.

### R11.0 How I decided

Lead decision R7.0 stays binding. For each major I checked the evidence, then took the first rung that holds: (1) cut the scope that causes it; (2) reuse an existing mechanism; (3) the smallest new one. **CR-1 was settled on rung 1** (retention leaves this plan for item W, further than CR asked). **IA-1 was settled on rung 2** (one more read through the adapter method the pull already has, and the existing `getApplication`, upsert and `last_sync_issues`). For minors I applied a change only when it stops data being lost, leaked, sent to the wrong person or tenant, or the product rule broken, or corrects a false statement (in the draft or in copy a customer reads), and only on a row, column, query or code path that already exists. Several minors were settled by removing something (the token lock, the per-write marker read, a wording branch, the nightly listing when the spike fails). v11 adds no table, column, queue, service, job kind or environment variable.

### R11.1 Evidence I re-checked for this round

Repo (FACT):
- `grep -rni retention apps/api-java/src/main/java/desk` finds only `java.lang.annotation.Retention` imports (`platform/Ok.java`, `authz/Public.java`, `authz/RequireAnyPermission.java`, `authz/RequirePermission.java`): nothing is purged today (CR-1).
- `VoiceSessions.recording` streams audio from the provider by conversation id and has no stored copy (`JAVA/voice/VoiceSessions.java` lines 618-626): a provider `retention_days` would delete recordings for good (CR-1).
- `HealthController` already returns `jobsBacklog` (`JAVA/platform/HealthController.java`), which `JobQueue.runDue` computes as queued jobs of every kind more than 2 minutes late (`JAVA/jobs/JobQueue.java` lines 93-114); it never changes `status` (CR-8, BE's note).
- `Jobs.updateStatuses` locks the job row (`loadJob`), then updates candidate rows in request order (`JAVA/hiring/Jobs.java` lines 255-266) (BE-1).
- `DELETE /candidates/{id}` audits the existing action `candidates.deleted` (`JAVA/hiring/HiringController.java` line 488) (UX note).
- `architecture-draft-v1.md` line 176: the "two Get Records calls per poll" assumption was "one for changed applications and one for jobs". The round-10 remark that a Candidates read was already paid for is not right (IA-1, EIA-1).
- `JobQueue.enqueue` commits in its own transaction and always calls `wake()`; `poll` and `wake` both check `JOBS_ENABLED`, which also gates `email` and `document` jobs (`JAVA/jobs/JobQueue.java` lines 66-90) (BE-4, BE-6).

Vendor and reference documentation (FACT, read this round):
- Zoho application fields can be "Inherited" ("will take the same value as that of the field in Candidate/Job Openings module"; updating a candidate's Mobile in the Candidate module changes it in both of her applications) or not ("field value will be taken at the time of job association") (https://help.zoho.com/portal/en/kb/recruit/talent-management/applications/articles/customizing-applications-in-zoho-recruit). Whether an inherited change moves the application's modified time, and which fields the API returns on an Application record, are not documented (IA-1, EIA-1).
- Zoho Get Records: "The page and per_page parameter is used to fetch records according to their position in Recruit"; `sort_by` takes a field API name, `sort_order` `asc` or `desc`; `If-Modified-Since` "To get the list of recently modified records"; supported modules include `candidate`, `application`, `jobopening`; "Only admin users can fetch the records from the Notes module" (https://www.zoho.com/recruit/developer-guide/apiv2/get-records.html) (EIA-2, CR-3, CR-4).
- Zoho Search Records: supports "Candidates, Applications, Job Openings, ..."; `criteria` as `({api_name}:{starts_with|equals}:{value})`, up to 10 criteria; 200 records per call; scope `ZohoRecruit.search.READ` (https://www.zoho.com/recruit/developer-guide/apiv2/search-records.html) (IA-4, EIA-7, CR-5).
- Zoho Get Related Records: related modules "Notes, Attachments, Interviews, Invited_Events, Campaigns, Activities, Contacts, Activity History, Custom Related List, Offers, Reviews"; no Applications (https://www.zoho.com/recruit/developer-guide/apiv2/get-related-records.html). EIA-7's first option (a Job Opening's Applications related list) is therefore not documented.
- Zoho refresh tokens: "A 'User' in an organization can have a maximum of 20 refresh tokens"; "When the user creates the 21st refresh token, the system deletes the first created refresh token"; 30 active access tokens per refresh token; five refresh tokens a minute (https://www.zoho.com/recruit/developer-guide/apiv2/refresh.html) (EIA-6). Whether the 20 count per client or across all of a user's grants is not stated.
- Zoho Change Status scope: `ZohoRecruit.modules.all` or `ZohoRecruit.modules.{module_name}.{operation_type}`, modules candidate, application, jobopening, offer, operation types ALL and UPDATE (https://www.zoho.com/recruit/developer-guide/apiv2/change-status.html) (UX-1). The page's Hiring Pipeline menu entries did not come through my fetch; R9.1 recorded them, so they stay "per round 9's reading".
- MCP 2026-07-28 changelog: "All results now carry a required `resultType` field" (SEP-2322); "Require standard MCP request headers (`Mcp-Method`, `Mcp-Name`) on Streamable HTTP POST requests" (SEP-2243); `HeaderMismatch` renumbered to `-32020`; Dynamic Client Registration deprecated "in favor of Client ID Metadata Documents" (https://modelcontextprotocol.io/specification/2026-07-28/changelog) (IA-6, AM-1; settles R10.6 item 3's `resultType`).

### R11.2 Failed checks

| Check | Reviewer | Resolution |
|---|---|---|
| `data_flows_automatically` | IA | Failed only because contact corrections and fixes for skipped applicants made on the Zoho Candidate record might never reach HRVoice. Each pull now also reads Candidates modified in the window and re-reads the affected applications (R11.3.2); spike item (f) can remove that read if a Candidate edit moves the application's modified time. Paging skips (EIA-2, CR-3) and one bad record stopping a page (CR-2) are also fixed, so inbound completeness no longer depends on the nightly listing |
| `not_overengineered` | CR | Two causes. (1) A platform-wide retention policy inside Core: removed to item W (R11.3.1). (2) E1 carried a nightly complete listing that Zoho's documented Get Records cannot do: it is now built only if spike item (a) finds a complete listing, and otherwise E1 ships without it and without `missing`, with no substitute (IA-4, AM-4, UX-5, BE-5, CR-5). Also removed: the token refresh lock and the per-write marker read |

### R11.3 Majors

#### R11.3.1 Retention inside integration Core is a platform-wide deletion policy (CR-1; also IA-5, SA-2)

**Objection.** v10's Core ran a daily purge "for every active org" of "pulled-but-never-called candidates and call content" through the one erasure path, which deletes unlinked rows; and sent the provider `retention_days` (our period plus 7 days) to every hosted agent in every workspace, forced through a context-hash marker. No version defined what the purge selects or from which date. Hand-added candidates could vanish, and every customer's recordings, which exist only at the provider, would be deleted after the period, including in workspaces that never connect anything. Founder decision 9 did not say so.

**Checked.** Confirmed: v10 §6.1 "The 5-minute loop" ("for every `active` org: the daily retention purge"), §11.1 item 10 (the purge bullet; the erasure path deletes unlinked rows; "provider-side retention as a backstop" with the context-hash marker, "Every hosted agent then re-syncs once at its next dial"), §16 decision 9's wording. Confirmed in the repo (R11.1): no retention code exists, and recordings are streamed from the provider. IA-5 found the same ambiguity; SA-2 found the opposite gap (contact details of ATS-deleted people kept for good). All three are about one policy that is not integration work.

**Decision (rung 1, cut, further than CR proposed).** All retention leaves this plan and joins **item W**, renamed "Data retention, workspace deletion and restore", under **founder decision 16**, which now asks how long recordings, transcripts, answers and people (called or never called) are kept for every workspace, what a purge selects and from which date, whether it deletes or anonymises, what happens to a never-called person whose application is still open in an ATS, whether the provider's `retention_days` is used as a backstop, and that customers are told before the first run. v10's two bullets are W's starting design, with gate P's old retention check. CR's narrower keep (a Core purge of integration-sourced, never-called people) is **not** kept, for three reasons: CSV-uploaded never-called people are the same data class today, so a purge for imported people only is platform policy by another name; an automatic purge of a never-called person whose application is still open in the ATS would remove someone the recruiter still means to call, and the suppression hash would stop them ever coming back, which is a loss the mechanism itself causes; and the goal holds without it. Core keeps what integrations need: "Remove this person" as the existing route, the one erasure path, the suppression hash and provider deletes. The section 11.1 item 10 gate is renamed "Removal, erasure and DPDP". The DPA now says plainly that HRVoice keeps people, contact details and call content until someone removes them, and that there is no retention period until item W ships; decision 9 asks the founder whether that is acceptable (SA-2's alternative wording).

**Removed from v11:** the purge step in the 5-minute loop, its 500-per-run cap (kept only for Dev's `/v1` grace-period anonymisation), the provider retention fields in `agentBody`, the context-hash marker, the provisioning-test assertion, gate P check (2), the "Provider retention" merge-blocking test, the retention period in decision 9, and the purge's mentions in R8, R19, R24, R27, §17 and rules 3 and 20. **Effort:** Core about 2-2.5 weeks (was 2.5-3); W about 1.5-2 weeks (was 1-1.5) (ASSUMPTION).

**v11:** header, §1 item 3, §2.2, §2.3, §6.1, §11.1 items 10 and 13 and tests, §13.1 P, Core, W and launch gates, §13.2, §14.2, §15 R8, R19, R24, R27, §16 decisions 9 and 16, §17, §18 rules 3, 4, 20.

#### R11.3.2 Contact fields live on the Zoho Candidate, but the pull read only applications (IA-1; also EIA-1)

**Objection.** Name, mobile and email are Candidate fields in Zoho. The pull listed only applications. If a Candidate edit does not change its applications' modified time, a phone corrected in Zoho never reaches HRVoice while HRVoice refuses the local edit (`candidates.managed_externally`), so the person cannot be called with the right number from either side; and the card's "Fix the number in Zoho Recruit; they come in at the next check" may never come true for a skipped applicant.

**Checked.** Confirmed the gap in v10 §3 (only `listApplications` and `listApplicationsForJob`), §5 ("Editing the record in Zoho Recruit changes its modified time" without saying which record) and §13.1's spike list (no such item). Confirmed in Zoho's documentation that application fields may be inherited from the Candidate or copied at association, per account (R11.1); the modified-time behaviour is not documented. **Not confirmed:** the claim that the credit arithmetic already pays for a second read; it was jobs (R11.1), so the read is a third call.

**Decision (rung 2, reuse).**
- The 15-minute pull makes a third `If-Modified-Since` read, on Candidates (`listChangedParents`, the same Get Records call on another module). For each changed Candidate, the applications of this connection's non-anonymised links with that `external_parent_id`, and of `last_sync_issues` entries naming it, are re-read with the existing `getApplication` and written through the existing upsert (link row first). Re-reading the application rather than copying the Candidate's fields (IA's proposal) respects accounts whose application fields are not inherited.
- `last_sync_issues` entries also hold the parent id (an id, not personal data); no column is added.
- The adapter fills an application's contact fields from the application when the account's layout has them, otherwise from its parent Candidate.
- Spike item (f): which fields an Application record returns through the API, and whether a Candidate edit changes its applications' modified time. If it does, the Candidates read is dropped (a removal).
- The card copy stays "they come in at the next check", because the read makes it true; IA's interim "within a day" copy is not needed.
- Credit arithmetic corrected: three reads per poll, 96 × 3 × 3 = 864 credits a day, about 17% of the Free plan's 5,000, plus one `getApplication` per re-read.
- Tests: a mobile changed only on the Candidate reaches the linked row at the next pull; a skipped applicant fixed only on the Candidate comes in.

**v11:** §1 item 4, §2.1, §2.3, §3, §5 (Incremental, Validation, credit arithmetic), §11.1 tests, §13.1 E, §15 R6, R28, §17, §18 rule 11.

### R11.4 Minor objections

| Id | Objection (short) | Handling | Reason and change |
|---|---|---|---|
| IA-2 | Nightly flips anonymised links to `missing`; a "seen" update could re-tie an erased row | **Applied (predicates)** with SA-1 | Start read and both UPDATEs exclude `deleted`; the "seen" UPDATE matches `external_id = :ext AND remote_state <> 'deleted'`. Stops an erased person being re-linked to their Zoho record. Test extended. v11 §2.3, §5, test |
| IA-3 | Unlinking or relinking a job undefined | **Applied (one rule)** | One transaction deletes the job link, its candidate links except anonymised ones, the connection's delivery rows for those people and the job's issue entries; people stay as ordinary rows; relinking imports or adopts them; suppression holds. Stops a relinked job staying empty. Card copy and test. v11 §5, §12.2, test |
| IA-4 | Spike (a) needs a first try and a fallback | **Applied** with AM-4, UX-5, BE-5, CR-5, EIA-7 | Order: Search Records by job (FACT: supports Applications), `cvid` view, full listing filtered here, Bulk Read. If none is complete at an acceptable cost, E1 ships without nightly and `missing`, no substitute; DPA and copy say "they stay in HRVoice until someone removes them here". v11 §3, §5, §13.1 E, §13.2 |
| IA-5 | Retention purge scope for unlinked rows | **Applied** by R11.3.1 | No purge in this plan |
| IA-6 | MCP `resultType` FACT; `Mcp-Method` / `Mcp-Name` headers | **Applied (docs)** with AM-1 | FACT relabelled; headers, `-32020` and CIMD over DCR added to the MCP build-sheet notes. v11 §8 |
| AM-1 | MCP facts; DCR deprecated | **Applied** with IA-6 | |
| AM-2 | Gate P R18 check can pass falsely | **Applied (test design)** | Two jobs with no shared question labels and a checkable JD fact; run with B dialed while A rings and after A answers; assert from A's transcript and stored keys. v11 §13.1 P |
| AM-3 | "not answered" can read as evasion | **Applied, one step further** | One wording for every non-value case, "No answer noted; check the recording", in the note, CSV and `/v1` docs; one branch fewer. v11 §6.1, §6.2, §7 note sample, R18, rule 8, tests |
| AM-4 | Nightly should depend on the spike | **Applied** with IA-4 | |
| AM-5 | ADR-010 will not fit 2 pages | **Applied** | §18 is now ADR-010: 22 invariants, one sentence each, no mechanism (8.2 KB → 4.6 KB); mechanisms stay in §5-12 for the build sheets. v11 §13.1 "Build documents", §18 |
| EIA-1 | Which modules the pull reads | **Applied** by R11.3.2 | |
| EIA-2 | Position paging can skip an applicant for good | **Applied differently** with CR-3 | Not a nightly import backstop (the nightly listing may not exist): overlapping windows (each scan reads from the start of the scan before the last completed one), so every change is read by two completed scans; the first scan after the initial import reads everything again; a fixed `sort_by=Created_Time` order. No new state (two start times in `cursor`). v11 §5, test |
| EIA-3 | A merge needs a manual Retry | **Applied (one UPDATE)** | When a pull rewrites `external_parent_id`, the same transaction re-pends that person's `failed` (not `expired`) notes on the connection. Results flow back without an admin. v11 §2.3, §5, §6.1, test |
| EIA-4 | Merge with new application ids leaves a person stuck | **Recorded as a conditional rule, not built** | If spike (e) shows new ids, E's build sheet designs the case before E1 ships, starting from EIA's re-point rule; if ids are kept, nothing is built. v11 §13.1 E |
| EIA-5 | `principal_lost` stops silently | **Applied (one rule)** | Every move into `needs_attention` emails admins once through the existing notification path. v11 §5, §10, R13, test |
| EIA-6 | Drop the refresh try-lock; Zoho's 20-refresh-token cap | **Applied (removal + FACT)** with BE-3 | Lock removed; the compare-and-set loser re-reads the row; no transaction across vendor HTTP; pool check loses its +1. Cap recorded; one OAuth client per environment; the `consent_revoked` email and runbook mention it. v11 §5, §6.8, §11.1 item 4, §17, test |
| EIA-7 | Primary-doc candidates for spikes (a) and (c) | **Applied, one option dropped** | Search Records added first (scope noted); the Job Opening Applications related list dropped (FACT: not among Get Related Records' related modules); Hiring Pipeline endpoints named for (c). v11 §3, §13.1 E |
| EIA-8 | Notes for calls made before adoption contradict the Add dialog | **Applied (copy)** | "People you add here are not created in Zoho Recruit. If the same person later comes in from Zoho Recruit, their call results are added there too." No column. v11 §12.2 |
| SA-1 | Nightly overwrites anonymised links | **Applied** with IA-2 | |
| SA-2 | Contact details of ATS-deleted people kept for good | **Purge clause declined; disclosure applied** | No purge exists in this plan (R11.3.1). DPA: HRVoice keeps people, contact details and call content until removed; decision 9 asks whether that is acceptable; W records it as an input. v11 §11.1 item 10, §13.1 W, §16 |
| SA-3 | Removal copy overstates suppression | **Applied (copy); listing other rows declined** | "HRVoice won't bring this application in again. If they applied to other jobs linked here, remove them there too." Listing the other rows is a convenience; the cross-job lookup and do-not-call list stay with decision 9 and V2. v11 §5, §11.1 item 10, §16 |
| UX-1 | E1 ships E2's step and scope | **Applied** | E1: six steps, no status clause, read and notes scopes (plus search if chosen); E2 adds step 5, and switching it on runs the existing new-consent sign-in for the application update scope (FACT, Change Status scope). v11 §5, §11.1 item 4, §12.2, §13.1 E |
| UX-2 | Stale "deleted" copy | **Applied (copy)** | Sentences and board labels per state: "Can't see them in Zoho Recruit" (missing), "Removed in HRVoice" (deleted). v11 §5, §12.2 |
| UX-3 | Where anonymised rows appear | **Applied (a condition on existing queries)** | Only under "Closed or removed"; the retention placeholder is moot. Screenshot list extended. v11 §11.1 item 10, §12 |
| UX-4 | "in 2 minutes" is not exact | **Applied (E2 copy)** | "after a 2-minute wait, so you can change your mind"; toast "within a few minutes". v11 §12.2 |
| UX-5 | Nightly depends on an unverified API | **Applied** with IA-4 | |
| UX-6 | "Remove them here too" shown to people who cannot | **Applied (copy)** | Without `candidates.delete`: "... Ask a workspace admin to remove them here." v11 §5, §12.2 |
| UX note | Audit action name | **Applied** | The existing `candidates.deleted`, not a new `candidate.removed`. v11 §11.1 items 7, 10 |
| BE-1 | Lock cycles between the pull, bulk decisions, nightly and re-baseline | **(a) and (c) applied; (b) declined** | (a) with CR-2: one application per short transaction (the pull holds at most one link and one candidate lock), cursor after commit; (c) 40P01 is `Transient`. (b) ordered locking for nightly versus re-baseline declined: neither touches candidate rows, the case is rare (switch-on, reconnect), and a deadlock aborts and is retried, losing nothing. Test: bulk decision versus pull in opposite order. v11 §5, §6.8, test |
| BE-2 | Erasure versus discovery snapshot leaves a row | **Applied (one predicate)** | The tick's expiry step first deletes rows of erased calls or `deleted` links. Test reworded. v11 §6.1, test |
| BE-3 | Advisory lock redundant | **Applied** with EIA-6 | |
| BE-4 | Enqueue after the per-org commit | **Applied (one sentence)** | v11 §2.2, §6.1, rule 18 |
| BE-5 | Nightly fallback | **Applied** with IA-4 | |
| BE-6 | `JOBS_ENABLED` also stops emails | **Applied (docs)** | Runbook: for one customer, Disconnect. v11 §6.8, rule 19 |
| CR-2 | One bad linked record stops all inbound | **Applied** with BE-1 (a) | One short transaction per application; the candidate update under a savepoint, so a failed contact change keeps the old values and the state update; an issue entry with its fix. Test. v11 §5 |
| CR-3 | Paging by position skips records | **Applied differently** with EIA-2 | Overlapping windows; only a completed scan moves the window; fixed sort. CR's sort-descending or restart-with-high-water options not needed. v11 §5 |
| CR-4 | Marker read before every write: admin-only and credits | **Applied (CR's version)** | Markers listed only when the previous attempt ended with a timeout or 5xx after the request was sent (recorded in `last_error_code`); a refused read never blocks; spike (b) runs as a non-admin. Ceiling: a crash mid-write or a restore can give one duplicate note (`ponytail:`); a duplicate is not one of rule 4's harms. v11 §5, §6.1, §7, §11.1 item 13, R2, test |
| CR-5 | Nightly cuttable; Search and Bulk Read in the spike | **Applied** with IA-4 | |
| CR-6 | New Zoho jobs never flow in, silently | **Declined (as R9 CR-7)** | Each new job needs a person to link an agent before anyone can be called (FACT, `HiringController.java` line 352), so linking is not the extra step; the setup screen says it; the card line with Link and Ignore stays V2 (it needs remembered dismissals). v11 §13.2 |
| CR-7 | Wrong copy for Zoho duplicates | **Applied (issue code + copy)** | `duplicate_in_ats`: "Someone with this mobile already came in from Zoho Recruit for this job. If it is a duplicate, merge it in Zoho Recruit." v11 §5, §12.2, test |
| CR-8 | Lane loop liveness | **Applied; half already exists** | Each loop iteration catches, logs and continues. `/health` already reports `jobsBacklog` (FACT), so the gate P monitor alerts when it stays above 0 for 15 minutes: a monitor setting, no code (ASSUMPTION: the monitor supports a confirmation period). v11 §2.2, §6.8, §13.1 P, R13, test |
| CR-9 | Rule 20 depends on there being no job delete | **Applied (sentence + grep test)** | No other code deletes candidate or job rows; a grep test allows `delete from candidates` and `delete from jobs` only in the erasure code. v11 §11.1 item 10, §13.1 Core, rule 20 |

### R11.5 Where I departed from a reviewer or went beyond the requests

- **CR-1: further than proposed.** CR kept a Core purge of integration-sourced, never-called people; v11 removes all retention to item W (R11.3.1 gives the three reasons).
- **IA-1: re-read the application instead of copying Candidate fields**, which keeps accounts with non-inherited application fields correct; no interim card copy, because the read makes the existing copy true; the credit arithmetic is corrected rather than assumed paid.
- **EIA-2, CR-3: overlapping windows instead of a nightly import backstop or a sort-and-restart rule.** It does not depend on the nightly listing, which may not exist, and needs no new state.
- **AM-3: one wording instead of two.** "No answer noted; check the recording" for an empty key and a missing one alike.
- **CR-4: CR's simpler version** (no "sending" marker written before the call); the crash and restore duplicate is recorded as a ceiling.
- **Declined:** BE-1 (b) ordered locking; SA-2's purge clause; SA-3's listing of other rows; CR-6's card line (again); EIA-4 built now (recorded as conditional instead).
- **Not asked:** the `consent_revoked` email and runbook mention Zoho's 20-refresh-token cap; the restore paragraph now admits that a note sent after a backup can be sent once more; "Change jobs" gets its unlink confirmation copy; the spike grows from a half day to about a day (items (a) with four ordered tries, (b) as a non-admin, (f)).
- **Size.** v11 is about 193 KB against v10's 176 KB. The growth is §5 (the inbound fixes and the spike fallbacks) and §13.1 E; ADR-010 (§18) shrank from 8.2 KB of mechanism to 4.6 KB of invariants. v11 is the final revision of the rationale record: further review goes to ADR-010 and the build sheets (six of seven reviewers asked for this).

### R11.6 Things still open

1. **Founder:** decision 1 (branch); gate P and ADR-008; **decision 9, reworded**: is it acceptable that HRVoice keeps imported people, contact details and call content until someone removes them, and is per-application suppression enough; decision 7 (E2 only); decision 10b; decision 15 (item G); **decision 16, now including retention for every workspace**; screenshots of the Connected systems UI, the decision line, the disabled Call, the Applications-module stop, both phone sentences, the "Closed or removed" filter and the new call states before they are built.
2. **Vendor, unverified (the E spike, about a day):** (a) a complete per-job application listing and its cost (if none, no nightly listing in E1); (b) per-record note listing as a non-admin, and its cost; (c) Change Status versus the Hiring Pipeline stage, and the stage field name (E2); (d) the Applications module on the Free plan; (e) what a merge does to application ids (if new ids, E's sheet designs the re-point before E1 ships); (f) which contact fields an Application returns and whether a Candidate edit moves its modified time (if it does, the Candidates read goes); which fields `sort_by` accepts; whether the 20-refresh-token cap is per client. **Voice provider (gate P):** the R18 check as now designed (a failure blocks quoting E); a conversation id on every accepted dial; that the production key can delete a conversation; what conversation delete removes; whether the Exotel per-call override applies on a live call.
3. **Unverified, recorded:** whether Zoho record ids can repeat across Zoho organisations; whether the workspace hard delete passes the RESTRICT foreign keys (one Core test); whether the chosen uptime monitor supports a keyword check with a confirmation period.
4. **Legal:** DPDP processor role; keeping people and call content until removal, with no retention period, until item W (decision 9 and 16); keeping a keyed hash of an ATS application id as a suppression; backup retention of erased data.
5. **Item W** now also holds retention; its starting design is `architecture-draft-v10.md` §11.1 item 10 (purge and provider retention bullets) plus v8 §11.1 items 10 and 13.
6. **ADR-010** is v11 §18 as written. **Build sheets** (P, 0, A, G, W, Core + E1, E2, Core + Dev) are still unwritten; E's sheet starts with the spike and re-estimates effort before any pilot date.
7. **Bulk calling** stays in `later-bulk-calling.md`, NOT APPROVED.
8. Effort (ASSUMPTION, for ordering only): P 3-5 days, 0 5-7 days, A 1-2 days, G 1-2 days, Core about 2-2.5 weeks, E1 about 3-3.5 weeks (about 2-3 days less without the nightly listing), E2 about 1-1.5 weeks, **Core + E1 about 5-6 weeks**, W about 1.5-2 weeks, Dev about 3 weeks.

---

## Round 12

Date: 2026-10-03. Input: `architecture-draft-v11.md` and the round-11 reviews of it: Integration Architect (IA), AI Agent / MCP Architect (AM), Enterprise Integration Architect (EIA), Security Architect (SA), Backend / Distributed Systems Architect (BE) and Critical Reviewer (CR) approve with changes; Product / UX Architect (UX) **block**. 1 major (UX-1), 39 minors, 1 failed check (UX `data_flows_automatically`). Output: `architecture-draft-v12.md`. `later-bulk-calling.md` is unchanged (no reviewer raised anything for it; all seven again said removing A2 leaves the goal intact). No code, config, migration or test was changed.

Majors by round: 17, 12, 9, 4, 1, 5, 5, 2, 2, 2, 1. The one major is narrow: a promise in the setup copy ("Job openings you add later come in after you link them") that the windowed pull did not keep.

### R12.0 How I decided

Lead decision R7.0 stays binding. The major was settled on rung 2 (reuse the first-import code path; no column). For the 39 minors I applied a change only when it stops data being lost, leaked, sent twice or to the wrong place, the product rule broken, or corrects a false statement (in the draft or in copy a customer reads), and only as a condition, predicate, parameter or sentence on an existing row, query or code path. Five things were removed (the lane's scheduled wake-up, two count caps, the deletion of `sent` rows on unlink, `apply`'s early return for erased calls, pulls under a departed person's grant). Declined: a list of trigger statuses (IA-3), a skip rule for our own notes (IA-4), refusing removal during a live call (SA-2 part 1), a narrow org lookup now (CR-8), the question-editor key warning (AM-1 optional). v12 adds no table, column, queue, service, job kind or environment variable. v12 is frozen: the next documents are ADR-010 and the build sheets, and E's sheet is written only after the spike with every branch resolved (IA-5).

### R12.1 Evidence I re-checked for this round

Repo (FACT):
- `VoiceSessions.dialLocked` calls `provisionLocked(actor, a, jobId, null, false)` (line 382) before `select id, phone from candidates ... for update` (line 406); `startOutbound` holds the version advisory lock around both (lines 362-376) (IA-1, CR-7).
- `Coverage.key` lowercases, replaces `[^a-z0-9_]+` with `_`, trims, cuts at 64 and falls back to `answer` (`JAVA/engine/Coverage.java` lines 19-23); `CallContextCompiler` skips a key already present (lines 205-211); `PostCallExtractor` dedupes keys (lines 52-54) (AM-1).
- `PostCallExtractor.extract`: `haveAnswers = providerAnswers.isObject() && !isEmpty()`, and the extractor runs only when not `providerComplete` (lines 39-47); `HostedVoiceAdapter` copies `value`/`result`/`answer` even when that inner value is JSON null (lines 151-161); per-call overrides allow only prompt, first message and language (lines 76-99); `apply`'s second UPDATE uses `coalesce(structured_answers, ?)` (`VoiceSessions.java` lines 529-534) (AM-2).
- `JobQueue.execute` stores `e.getClass().getSimpleName() + ": " + e.getMessage()` in `last_error` (lines 147-153); `PlatformConfig.dataSource` sets only `ApplicationName` and `options` (lines 34-41); `Db.uniqueViolation` walks the cause chain for SQLSTATE `23505` (`JAVA/platform/Db.java` lines 137-141) (SA-1).
- `JobQueue.runDue` loops over orgs with no per-org try/catch (lines 93-109); `expireStale` returns at once when voice is off and loops the same way (`VoiceSessions.java` lines 677-687); `poll()` runs handlers inline on the scheduler thread (lines 87-90, 99-100, 129-131, 144) (BE-1, BE-7).
- `Jobs.callStatus` returns only `not_called`, `calling`, `completed`, `failed` (`JAVA/hiring/Jobs.java` lines 165-178); the web types `CallFilter` as those four (`apps/web/app/jobs/[id]/candidates/page.tsx` line 98), treats called = completed, failed or calling (line 246), filters on it (line 269), and `personState` maps only those values (`apps/web/components/candidates/person-state.tsx` lines 10-16) (UX-4).
- Session cookies are `SameSite=Lax` (`JAVA/auth/SessionStore.java` line 74) (SA-4).
- The CSV import's savepoint per row (`JAVA/hiring/Candidates.java` lines 160-161) (EIA-5).
- `MIG/0022_voice_webhook_lookup.sql` is the SELECT-only, migrator-owned lookup pattern CR-8 points to.
- OkHttp `Response.isSuccessful`: "true if the code is in [200..300)" (`okhttp3/Response.kt` lines 143-146 in `okhttp-4.12.0-sources.jar`, the version the build resolves); the URL EIA cited returned 404 to my fetch, so the draft cites the source jar instead (EIA-1).

Vendor and reference documentation (FACT, read this round):
- Zoho Recruit status codes: "204 No Content: There is no content available for the request"; "304 Not Modified: The requested resource has not been modified after the time mentioned in the 'If-Modified-Since' header in a GET API" (https://www.zoho.com/recruit/developer-guide/apiv2/status-codes.html) (EIA-1).
- Zoho Recruit Get Records: parameters `fields`, `sort_order`, `sort_by`, `converted`, `approved`, `page`, `per_page`, `cvid`, `territory_id`, `include_child`, `$state`; 200 records per call; no page-depth limit and no `page_token` documented (https://www.zoho.com/recruit/developer-guide/apiv2/get-records.html) (BE-4, SA-3).
- Zoho CRM v8: "To fetch more than 2000 records, you must include the "page_token" param in the request" (https://www.zoho.com/crm/developer/docs/api/v8/get-records.html); Zoho vertical solutions v6: "You can only get the first 2000 records without using page_token param" (https://www.zoho.com/developer/docs/vertical-solutions/api/v6/get-records.html). Whether Recruit has the same cap is unverified (BE-4).
- PgJDBC `logServerErrorDetail`, default `true`: "This may include sensitive details such as query parameters"; "Setting to `false` will only include minimal, not sensitive messages" (https://jdbc.postgresql.org/documentation/use/) (SA-1).
- MCP 2026-07-28 authorization: "Authorization is **OPTIONAL** for MCP implementations. When supported: Implementations using an HTTP-based transport **SHOULD** conform to this specification"; the page does not contain "non-standard authorization"; DCR "is deprecated and retained for backwards compatibility with authorization servers that do not support Client ID Metadata Documents" (https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) (AM-3).

### R12.2 Failed checks

| Check | Reviewer | Resolution |
|---|---|---|
| `data_flows_automatically` | UX | Failed only because a job linked after setup (Change jobs, relink) got only applicants modified since the last scans. Fixed by R12.3 on rung 2. Related inbound gaps closed in the same round: 304/204 replies no longer stop a scan (EIA-1), an in-flight pull cannot re-create links on an unlinked job (BE-3), one poison application no longer stops a page (BE-1), and spike item (g) checks a possible page-depth cap (BE-4) |

### R12.3 Major: jobs linked after setup never receive their existing applicants (UX-1)

**Objection.** Only the first import read every application. Later pulls use `If-Modified-Since` from the overlapping-window rule, and nothing reset it when a job link was created later. Applicants who applied before the job was linked and were not modified since never came in, with no card line, while step 7 ("Job openings you add in Zoho Recruit later come in only after you link them here"), §5 ("Linking the Zoho job again imports them afresh") and a test promised they would. On the Free plan (one active job) this is the normal path for every job after the first.

**Checked.** Confirmed in v11 §5 ("Initial import" runs "After connect"; "Incremental" window; "Unlinking a job" relink sentence), §12.2 step 7 and "Change jobs reopens step 3", §11.1 test "Unlinking a job". No sentence in §2.3, §5 or §13.1 moved the window when a `job_links` row was created. FACT: `If-Modified-Since` returns "recently modified records" (Get Records page, R12.1).

**Decision (rung 2, reuse).** The transaction that creates a `job_links` row after the first import also clears the pull's two scan start times in `cursor`. The next two pulls are full reads through the first-import code (account-wide, fixed order, kept only for linked jobs, idempotent upserts, the suppression check), so applications on the new job at the trigger status come in; applications already linked change nothing. A scan already running when the link is created shifts the scan start times from the row's current value when it completes, so the clear survives (one sentence on the existing UPDATE, §2.3). No column, no new job, no branch on spike (a): a per-job listing, if the spike finds one, is a credit optimisation E's sheet may take (`ponytail:`). Credit cost added to §5: 3 credits per 200 applications in the account, twice per link change. Copy: step 7 now names the trigger status and says linked-later jobs bring in their people at the next check; "Change jobs" says the same. Test: an application created before its job is linked, with an old modified time, is imported at the next pull after linking; a scan running at link time does not cancel the full read.

**v12:** §2.3 (`cursor`), §5 (Initial import, "Linking and unlinking a job", credit arithmetic), §11.1 tests, §12.2 steps 7 and Change jobs, §18 rule 12.

### R12.4 Minor objections

| Id | Objection (short) | Handling | Reason and change |
|---|---|---|---|
| IA-1 | Closed-row guard runs after the shared hosted agent is re-provisioned | **Applied** with CR-7, EIA-3, UX-3 | One unlocked read of the link and its connection at the top of `dialLocked`, before `provisionLocked` (FACT lines 382, 406). Test: a refused click does not call `FakeVoice.provision`. §5, §10, test, rule 17 |
| IA-2 | Pilot quote leaves out slice 0 and W | **Applied (text)** with CR-3 | Quote slice 0 + Core + E1, about 6-7.5 w after gate P (ASSUMPTION), plus W for a paying pilot; say whether G is done. §13.1 launch gates, E row |
| IA-3 | A single trigger status silently skips applicants moved past it between pulls | **List declined; copy applied** | A list would widen the statuses E2 may overwrite (the trigger status is one of its two allowed "from" statuses, §7), which round 8 kept narrow on purpose; IA's fallback applied: steps 4 and 7 say people already moved past the status are not brought in. A list is V2 if pilots miss applicants. §5, §12.2, §13.2 |
| IA-4 | Our own note may mark the Candidate modified, causing re-reads; per-application Candidate reads uncounted | **Spike check and credit count applied; skip rule not built** | Spike (f) measures it; §5 arithmetic counts the per-application Candidate reads on the initial import. The skip rule is added only if the count matters against the plan's credits (`ponytail:`): extra reads cost credits, they lose nothing. §5, §13.1 E, §17 |
| IA-5 | Record back at 193 KB with unresolved branches | **Applied (process)** | E's Core + E1 sheet is written only after the spike with every branch resolved; it leaves out E2, Dev and the nightly listing unless spike (a) succeeded; its tests are only the Core and E1 tests. v12 is frozen. §0 header, §13.1 Build documents. Size: see R12.5 |
| AM-1 | Questions sharing a `Coverage.key` (Devanagari labels all become `answer`) print one answer under another | **Applied (one rule in `ExternalPayloads`)**; editor warning declined | A later question whose key an earlier question already used prints "No answer noted; check the recording"; two Devanagari questions added to the merge-blocking test; R18 reworded. The root cause (non-Latin labels collapse to one key in the app too) is pre-existing and recorded in §17 for the founder's backlog, not designed here: unique keys change the provider schema and the context hash. §6.2, §13.1 0 and P, R18, §17 |
| AM-2 | Provider answers keyed to another job, or null, stop our extractor | **Applied (one condition, one predicate)** | Provider answers count only for the call's own keys whose value passes `Coverage.present`; when none does, the extractor runs on the transcript. Needed one more step AM did not name: `apply`'s second UPDATE used `coalesce(structured_answers, ?)`, so the extractor's answers would never have been stored over the provider's object; it becomes a compare-and-set on the value `apply` read (first writer still wins). Gate P and R18 say the answer side is fixed here, not by the per-call override. Test in the lost-webhook group. §2.2, §6.2, §13.1 P and 0, R18 |
| AM-3 | "non-standard authorization" is not the page's wording | **Applied (docs)** | Quote: authorization OPTIONAL; HTTP implementations SHOULD use the spec's OAuth; a static key departs from that SHOULD; its replacement, if ever needed, is OAuth with CIMD. §8 |
| EIA-1 | Zoho 304 and 204 not handled | **Applied (one rule)** | On a list read 304/204 = empty last page, read completed; on `getApplication` 204 = `NotFound`. Get Records defaults (approved only) noted. Spike (f) checks both. FakeAts test. §3, §13.1 E, tests, §17 |
| EIA-2 | Unlink then relink re-sends notes | **Applied (removes a deletion)** with UX-2, CR-1 | Unlink deletes only `pending` and `failed` delivery rows; `sent` rows stay (ids and hashes, cascade with the candidate). Test: send, unlink, relink: zero further `addNote`. §2.3, §5, R2, tests, rule 14 |
| EIA-3 | Closed and missing rows uncallable after Disconnect | **Applied (one condition)** with UX-3 | Closed/missing refusal and queue exclusion only while the connection is not `disconnected`, as `managed_externally`; anonymised rows always refused. Test. §5, §10, §12.2, test |
| EIA-4 | A replaced Zoho token is not always revoked | **Applied (one rule replaces three)** | Whenever a sign-in stores a new token for an existing connection, the previous one is revoked after commit, best effort. §2.2, §5, §10, test, rule 21 |
| EIA-5 | Transaction vs savepoint wording contradicts itself | **Applied (wording)** | One sentence in both rows: one short transaction per application; the contact change under a savepoint so the link update commits. §5 |
| SA-1 | PII in `last_error` and lane logs via PgJDBC server detail | **Applied (one line)** | `logServerErrorDetail=false` in the existing datasource bean; lane logs the exception class only; test with a forced `(job_id, phone)` violation. `Db.uniqueViolation` checks SQLSTATE through the cause chain (FACT), so it keeps working. §11.1 item 6, §6.8, test, rule 21 |
| SA-2 | Removal during a live call; provider delete of an in-progress conversation | **Part 2 applied with CR-2; part 1 declined** | `provider_delete` takes only erased sessions no longer `pending`/`active` and past the 3-minute settle. The "End the call first" refusal is not added: with CR-2's `apply` change the call's content is never stored and its facts and cost are, and the provider delete follows once the call ends, so nothing is lost or kept that the removal copy denies. §11.1 item 10, test |
| SA-3 | Account-wide reads pull whole records of unlinked people | **Applied (a parameter)** | `fields=` on read (3) (id and modified time) and read (2) (allowlisted fields plus job, status, stage, parent ids); rows on unlinked jobs dropped before mapping; FakeAts asserts `fields`. §3, §13.1 E, test |
| SA-4 | OAuth state and PKCE verifier on re-consent flows | **Applied, cookie option chosen** | State hash and expiry on the connection row whatever its status; verifier and initiating user id in a short-lived HttpOnly, Secure, SameSite=Lax cookie sealed with `Sealer`; the callback requires the initiator, still holding the permission. Chosen over a key inside `secrets_sealed` because writing the verifier there would race the refresh's compare-and-set: the refresh loser re-reads and uses the stored token, which after a verifier write would be the old one. No column. Test: an abandoned Take over leaves sending working. §2.3, §10, §11.1 item 4, test |
| SA-5 | A pilot that ends before item W ships | **Applied (runbook text)** | Run the erasure path for every person, wait until `provider_delete` has run, then delete the workspace; the pilot agreement says so. §13.1 W |
| SA-6 | "anonymised" in DPA text overstates | **Applied (copy)** | Customer text: "contact details and call content deleted, and a keyed one-way reference to the ATS application kept only to stop it being brought in again". Internal names stay. §11.1 item 10 |
| UX-2 | Unlink then relink re-sends notes | **Applied** with EIA-2 | |
| UX-3 | Closed/missing rows after Disconnect; copy cannot be acted on | **Applied** with EIA-3 | |
| UX-4 | Routing `callStatus` through the new outcome breaks four-value web code | **Applied (UX's first option)** | `callStatus` keeps four values: `no_conversation` and `content_erased` → `failed`, `result_unavailable` → `completed`; the outcome is a separate field for labels. No web consumer changes meaning. §2.2, §6.1, §13.1 0, test |
| UX-5 | Skipped-applicant lines cannot be acted on | **Applied (UI on stored ids; copy)** | Expanding a line lists its entries as "Open in Zoho Recruit" links built from the stored Candidate id (URL pattern checked in the spike; else the id); names never stored. Name-mismatch sentence adds "or correct the name here". Kept because an applicant the admin cannot find never comes in. §5, §13.1 E |
| UX-6 | Add-dialog copy; screenshot set; tooltip-only refusal | **Applied (copy, list, accessibility)** | (a) "results of their calls from the past 7 days, made since Zoho Recruit was connected"; (b) setup steps 1, 3, 4, 6, 7, the different-account refusal, Paused until, the unlink confirmation and an expanded skipped line added to the screenshot list; (c) the refusal sentence shown as visible row text. §5, §12, §12.2 |
| BE-1 | Unexpected exceptions not isolated per item | **Applied (try/catch per item)** | Per org in the tick and the 5-minute loop, per row in `send` (Transient, `internal`), per application in `pull`/`nightly` (`internal_error` issue entry), per session in the provider jobs. One test per loop. §1 item 8, §2.2, §5, §6.1, §6.8, tests, rules 12, 14, 18 |
| BE-2 | Poison item in `fetch_results` and `provider_delete` | **Applied (an ORDER BY; removes two caps)** | `ORDER BY random()`; the 5-session and 50-item caps go; budgets stay. Test. §6.1, §11.1 item 10, test, rule 18 |
| BE-3 | Unlink racing an in-flight pull re-creates links | **Applied (one read)** | Each application's transaction reads its `job_links` row `FOR SHARE` and skips if gone; the unlink's DELETE serialises with it; lock order job link, candidate link, candidate. Test. §5, test |
| BE-4 | Initial import may hit a 2,000-record page-depth cap | **Applied as spike item (g), conditional** | FACT for CRM and vertical solutions; unverified for Recruit. If a cap exists, every full read (initial, and after a link change) is bounded before E1 ships: `page_token` if Recruit has one, else `If-Modified-Since` from the oldest linked job opening's creation time. Conditional test. §5, §13.1 E, tests, §17, R28 |
| BE-5 | Disconnect does not stop a send in progress | **Applied (one join)** | Step 2's short read includes the connection; the run stops if disconnected or without token or principal. Test. §5, §6.1, test, rule 14 |
| BE-6 | Permanent-failure write not compare-and-set | **Applied (one predicate)** | Steps 4 and 6 carry `AND content_hash = :hashReadInStep2`. Test. §6.1, test |
| BE-7 | Lane wake-up depends on the scheduler thread | **Applied (removes the `@Scheduled` poll)** | Each lane thread waits up to 30 s on its own timer after an idle round. Test: a long inline document job does not delay an integration job beyond about 30 s. §2.2, §6.8, test, rule 18 |
| CR-1 | Unlink erases the dedupe memory for notes | **Applied** with EIA-2 | |
| CR-2 | Removal during a live or just-ended call | **Applied (a) and (b)** with SA-2 | (a) For an erased session, `apply` writes status, `ended_at`, duration, cost, `failure_reason` and the ledger row, and writes no content and runs no extractor (a `CASE` per content column, not an early return); background fetch's stuck-`active` clause includes erased sessions, its ended clauses exclude them. (b) provider deletes only after the call has ended and settled. Test. §6.1, §11.1 item 10, test |
| CR-3 | Pilot date leaves out slice 0 and W | **Applied** with IA-2 | |
| CR-4 | The Applications-module requirement may rule out most existing users | **Applied (question and risk text)** | Decision 1 asks whether the module is on; R1 and R28 say so; quoting requires it; classic accounts are a V2 line, with Get Associated Records as the starting point to check. Not claimed to solve spike (a): it lists candidates, not applications. §13.1 gates, §13.2, R1, R28, §16 |
| CR-5 | Reads continue under a departed person's grant | **Applied, narrowed** | `principal_lost` now stops every vendor call, pulls included (one precondition for every vendor job: a token and a live principal). Not applied to `status_unmapped`: CR's "every `needs_attention`" would stop notes when a status is renamed, which R11 deliberately keeps flowing. Card copy, decision 13 and a test. §5, §10, §12.2, §16, test, rule 21 |
| CR-6 | Background fetch never retries a failed extraction | **Applied (one OR clause)** | `fetch_results` also selects ended, non-erased calls with a transcript, no answers and criteria in the snapshot, 3-60 minutes after the end; reuses `reconcileSystem` and its budget. Test. §6.1, test |
| CR-7 | Dial guard can deadlock with pull and erasure | **Applied** with IA-1 | The guard's read takes no lock. Dial added to the lock-order test |
| CR-8 | Per-org loops for every signed-up workspace; the ponytail trigger has already fired | **Text applied; lookup declined** | The `ponytail:` now says sign-up is open, the cost (about three short transactions a minute per workspace) is accepted now, and the upgrade past about 1,000 active orgs is one SELECT-only migrator-owned lookup (the `MIG/0022` pattern). Not built now: a cost, not a loss, leak or wrong-tenant send. §6.8 |

### R12.5 Where I departed from a reviewer or went beyond the requests

- **UX-1:** always a full read through the first-import code, not "a per-job listing if spike (a) finds one" as a second branch; the per-job listing is left to E's sheet as a credit optimisation.
- **AM-2: one step further.** The extractor condition alone would not have stored anything, because `apply`'s second UPDATE kept the provider's object through `coalesce`; that UPDATE becomes a compare-and-set.
- **SA-4:** the cookie, not the sealed-blob option, because the blob would race the refresh compare-and-set (R12.4).
- **CR-5: narrowed** to the grant reasons; `status_unmapped` keeps notes flowing.
- **SA-2 part 1, IA-3's list, IA-4's skip rule, AM-1's editor warning and CR-8's lookup: declined**, each with its reason in R12.4.
- **Not asked:** `expireStale`'s early return when voice is off moves to wrap only the stale expiry (BE's note in round 11), stated in §6.1; the principal-lost card copy; R2 mentions the kept `sent` rows; the R18 gate-P test uses Latin-script labels so keys cannot collide.
- **Size.** v12 is about 220 KB against v11's 193 KB, despite removing v11's change table, the history paragraph after §2.3 and some duplicated wording. The growth is the 40 resolutions, most of them one sentence of rule plus its evidence. The answer to size is IA-5's: v12 is frozen, and the Core + E1 sheet carries only the resolved branch of each spike item and only its own tests.

### R12.6 Things still open

1. **Founder:** decision 1 (branch, and **whether pilots' Zoho Recruit accounts have the Applications module**); gate P and ADR-008; decision 7 (E2 only); decision 9; decision 10b; **decision 13 (sending and bringing people in both pause when the connecting person loses access)**; decision 15 (item G); decision 16 (item W); the screenshot set, now including the setup steps, the different-account refusal, Paused until, the unlink confirmation and an expanded skipped-applicant line.
2. **Vendor, unverified (the E spike, about a day):** (a)-(f) as R11.6, plus in (f): whether a note moves the Candidate's modified time, 304/204 and deleted-record replies, the Candidate record URL pattern; and (g) whether page-based Get Records stops at a fixed depth (2,000 in Zoho CRM). **Voice provider (gate P):** as R11.6; the answer side of R18 no longer depends on its result.
3. **Unverified, recorded:** whether Zoho record ids repeat across Zoho organisations; whether the hard delete passes the RESTRICT foreign keys; whether the uptime monitor supports a keyword check with a confirmation period; whether `Db.uniqueViolation` behaves the same with `logServerErrorDetail=false` (Core test).
4. **Pre-existing, outside this plan:** non-Latin must-ask question labels collapse to one answer key in the app as well as outbound (§17); a product fix for the founder's backlog. Items G and W unchanged.
5. **Legal:** as R11.6; the DPA describes removal as pseudonymisation in plain words, not "anonymised".
6. **Next documents:** ADR-010 from v12 §18; build sheets P, 0, A, G, W, then Core + E1 (after the spike, branches resolved), E2, or Core + Dev. No further revision of the rationale record.
7. **Bulk calling** stays in `later-bulk-calling.md`, NOT APPROVED.
8. **Effort (ASSUMPTION, for ordering only):** P 3-5 days, 0 5-7 days, A 1-2 days, G 1-2 days, Core about 2-2.5 weeks, E1 about 3-3.5 weeks, E2 about 1-1.5 weeks, W about 1.5-2 weeks, Dev about 3 weeks. **Quote to an E pilot after gate P: 0 + Core + E1, about 6-7.5 weeks, plus W for a paying pilot.**

---

## Round 13

Date: 2026-10-03. Input: `architecture-draft-v12.md` and the round-12 reviews of it: Integration Architect (IA), AI Agent / MCP Architect (AM), Enterprise Integration Architect (EIA), Security Architect (SA), Backend / Distributed Systems Architect (BE) and Critical Reviewer (CR) approve with changes; Product / UX Architect (UX) **block**. 1 major (UX-1), 29 minors, 1 failed check (UX `data_flows_automatically`). Output: `architecture-draft-v13.md`. `later-bulk-calling.md` is unchanged (no reviewer raised anything for it; all seven again said removing A2 leaves the goal intact). No code, config, migration or test was changed.

Majors by round: 17, 12, 9, 4, 1, 5, 5, 2, 2, 2, 1, 1. The one major is a stale phrase from v2 ("stop pulling that job"), fixed by deleting it.

### R13.0 How I decided

Lead decision R7.0 stays binding. Rule 4 decided most items: a change was applied only when it stops data being lost, leaked, sent to the wrong tenant or sent twice, or the product rule broken, or corrects a false statement in the draft or in customer copy; and then only as a condition, a predicate or a sentence on an existing row, query or code path. Where several reviewers proposed different fixes for one defect, I took the one that removes the most.

Two removals go beyond single objections:
- **The nightly listing and `missing` move to V2 unconditionally** (IA-3). The nightly listing prevents none of the four harms: it erases nothing; a note to a deleted Zoho record already fails as `NotFound` and shows on the card; and calling such a person still needs a person's click. With it go a link state, an `AtsPort` method, a cursor key, a scope (`ZohoRecruit.search.READ`), spike branch (a), card lines, copy and about six tests. Removing it also settles UX-1's point that the listing covered only open jobs.
- **One filter on the provider's answers replaces two round-12 mechanisms.** Five reviewers (IA-2, AM-1, EIA-2, BE-2, CR-1) found the same defect from different sides. The filter replaces the extractor's special condition and the compare-and-set on `apply`'s second UPDATE.

**On IA-5 ("do not write v13").** The orchestrator's task for this round requires a v13, so I wrote one. IA-5's underlying point is accepted in two ways. First, the table in R13.4 is the errata list for the build sheets. Second, from now on accepted findings go into an errata list here and straight into the sheets, never into a v14 (v13 §0 and §13.1 "Build documents"). v13 adds no table, column, queue, job kind or link state, and it removes one job and one state. It is still about 2% larger than v12 (about 225 KB against 220 KB): removing the nightly listing took out slightly less text than this round's one-sentence rules and their evidence added. I trimmed text that repeated other sections (risks R2, R6, R8, R13, R18, R27, R28; the §17 Zoho list), but I did not cut agreed content to hit a byte count.

### R13.1 Evidence I re-checked for this round

Repo (FACT):
- `VoiceSessions.apply`, first UPDATE: `structured_answers = coalesce(?::jsonb, structured_answers)`, written from the provider. Then `internal()` re-reads the row. `extractor.extract` runs outside any transaction. The second UPDATE, `summary = coalesce(summary, ?), structured_answers = coalesce(structured_answers, ?::jsonb)`, has no erasure predicate. `recordLedger` runs on every call. (All in `JAVA/voice/VoiceSessions.java`, `apply`, around lines 505-551.) Basis for IA-2, AM-1, EIA-2, BE-2, BE-3 and CR-1.
- The `reconcile` skip rule is `ended && has_transcript && has_summary && (hasAnswers || webhook_received_at != null)`. `has_answers` is `jsonb_typeof = 'object' and <> '{}'`, which is true for `{"k": null}` (same file, `reconcile` and `internal`). Basis for BE-1 and CR-1 a.
- `PostCallExtractor.extract`:
  - `haveAnswers` is true for any non-empty object.
  - It uses its own answers only when `answers == null`.
  - On an exception it returns the provider's data.
  (`JAVA/engine/PostCallExtractor.java` lines 39-47, 69-78, 81-93.)
- `HostedVoiceAdapter` copies `value`/`result`/`answer` even when that value is JSON null (lines 151-161). `Coverage.present` is false for null and blank values (`JAVA/engine/Coverage.java`).
- The results route reconciles only when the answers are null or empty (`JAVA/hiring/HiringController.java` lines 267-269).
- `AdviceGuard.scrub` replaces a fully matching text with the use case's replacement sentence (`JAVA/engine/AdviceGuard.java`). The hiring patterns include "hire", "reject", "select", "pass on" and "recommend", and the replacement is "Call notes are in the transcript and collected answers. Hire or reject decisions stay with you." (`usecases/hiring.json` lines 106-116). Basis for AM-3.
- `CostLedger.record` upserts `llm_input_tokens = excluded.llm_input_tokens`, `llm_cost = excluded.llm_cost` and `total_cost = excluded.total_cost` (`JAVA/cost/CostLedger.java` lines 80-104). `compute` adds provider usage and extraction usage together (`add(u.llmInputTokens(), e.extraInputTokens())`, same file). `BudgetGuard` sums `total_cost` (`JAVA/cost/BudgetGuard.java` line 34). In bundled mode (the hosted agent's provider-credit rate), extraction cost is not in `total_cost` at all (`CostLedger.compute`, `RateCard.bundled`). Basis for BE-6 and the correction in R13.5.
- `docker/Caddyfile` lines 29-30: `handle /backend/*` with `uri strip_prefix /backend`. `apps/web/next.config.mjs` line 22: `/backend/:path*` → `${api}/:path*`. The session cookie uses `Path=/` (`JAVA/auth/SessionStore.java` lines 71-74). `Env.webUrl` (`WEB_URL`) exists and is already used for the links in invitation and password-reset emails (`JAVA/platform/Env.java` line 86; `JAVA/team/Invitations.java` line 53). Basis for SA-3.
- `PlatformConfig.dataSource` sets `ApplicationName` and `options` (`statement_timeout`) (lines 34-41), so v12's "sets none" was wrong. This was IA's factual note; corrected in v13 §11.1 item 6.
- `DELETE /organization` with `organization.delete` calls `Organizations.remove`, which deletes rows only (`JAVA/team/TeamController.java` lines 139-142; `JAVA/team/Organizations.java` lines 100-107). Basis for SA-4.
- `HostedVoiceAdapter` uses Spring `RestClient` (line 23). The spring-web 6.2.9 jar's `DefaultRestClient$DefaultRequestBodyUriSpec` class contains the string "I/O error on" (checked in `~/.m2`; the app is on Spring Boot 3.4.5, `apps/api-java/pom.xml` line 9). This is consistent with SA-1's reading that the message repeats the URI.

Vendor and reference documentation (FACT, read this round):
- Zoho Recruit authorization request: "If you want to generate the refresh token, set this value as **offline**"; `prompt=consent`: "To generate refresh token." (https://www.zoho.com/recruit/developer-guide/apiv2/auth-request.html). Basis for CR-3.
- Zoho Recruit revoke: "Make a POST request with the following URL: {Accounts_URL}/oauth/v2/token/revoke?token={refresh_token}" (https://www.zoho.com/recruit/developer-guide/apiv2/revoke-tokens.html). Basis for SA-1.
- Zoho OAuth: "If a refresh token is revoked, all the access tokens that are generated using it also get revoked." (https://www.zoho.com/developer/oauth/revoke-oauth-token.html). Basis for EIA-1.
- Zoho Accounts help: "A client ID can have a maximum of 20 active refresh tokens. If you create the 21st token, the first token generated will be removed." (https://help.zoho.com/portal/en/kb/accounts/faqs-troubleshooting/faqs/oauth/articles/will-the-refresh-tokens-expire). This conflicts with the Recruit guide's "A 'User' in an organization can have a maximum of 20 refresh tokens" (https://www.zoho.com/recruit/developer-guide/apiv2/refresh.html), already cited in v12. Basis for EIA-4.
- PostgreSQL `GREATEST`/`LEAST`: NULL values in the argument list are ignored, and the result is NULL only if all arguments are NULL (https://www.postgresql.org/docs/current/functions-conditional.html). Used for BE-6.

### R13.2 Failed checks

| Check | Reviewer | Resolution |
|---|---|---|
| `data_flows_automatically` | UX | Failed only because of "stop pulling that job" (UX-1). Fixed by deleting that rule (R13.3). Related inbound gaps closed in the same round: adoption past the trigger status (IA-1), two full reads for a job linked during a scan (EIA-3, CR-2 b), and full reads bounded with a visible refusal past 2,000 records (IA-4) |

### R13.3 Major: jobs closed in the ATS stop all reads of their applications (UX-1)

**Objection.** v12 §5 row "Jobs closed in the ATS" said "stop pulling that job". This dates from v2's per-job pulls. Under v12's account-wide windowed reads, which keep rows "only for linked jobs", it meant that a closed job's applications were dropped from every scan. Three effects follow:
- People rejected, hired or archived in Zoho after the job closed never became `closed`, so they stayed callable and in "Not called yet". This is the R26 harm.
- Contact corrections and `external_parent_id` refreshes stopped.
- Changes made while the job was closed were lost for good after a reopen, because a reopen is not a link creation.

**Checked.** Confirmed in v12 line 192 (the phrase), line 187 (read (2) is account-wide and keeps only linked jobs), line 193 (only creating a `job_links` row clears the window) and line 168 (§4 promises "closed within one pull"). FACT: `If-Modified-Since` returns only "recently modified records" (https://www.zoho.com/recruit/developer-guide/apiv2/get-records.html), so a change skipped once by the filter is never read again.

**Decision (rung 1, delete a rule).** A closed job link is read exactly like an open one: state, contact fields and parent id. The read is account-wide already, so this costs no credits and only drops a filter. Reopening needs nothing. The job still shows "Closed in Zoho Recruit" and is never closed in HRVoice automatically. UX's optional "a closed job link stops importing new applications" is **declined**: it would be a new condition, and new applications at the trigger status on a closed job opening are unlikely. Spike item (a), which replaced the old per-job-listing question, now asks what closing a job opening does to its applications' Hiring Pipeline stage. Test: close the job in `FakeAts`, then reject one of its applications; the next pull marks that link `closed`, and a Call click is refused without calling `FakeVoice.provision`.

**v13:** §4, §5 (intro, Incremental (2), "Jobs closed in the ATS"), §11.1 test "Closed in the ATS", §12.2 day to day, §13.1 E (spike (a), E1 contents), §18 rule 12.

### R13.4 Minor objections (this table is the errata list for the build sheets)

| Id | Objection (short) | Handling | Reason and change (sheet) |
|---|---|---|---|
| IA-1 | Phone-match adoption is gated by the trigger status, so CSV-uploaded rows and relinked rows past it never link | **Applied (one rule, no state)** | The trigger status gates only creating new rows. Adoption runs for any application on a linked job, whatever its status, closed included (a closed one makes the row `closed`). An application past the trigger status that matches no row exactly is left alone, with no issue entry. Safe for E2: adoption sets `pushed_stage`, and the allowlist turns a later decision into a note. Tests: the CSV row whose application is at "Interview" is adopted and the next note reaches `FakeAts`; the relink test moves the application past the trigger. §5, §12.2 step 4, §18 rule 12 (E1 sheet) |
| IA-2 | Four definitions of "the call has answers" | **Applied** with AM-1, EIA-2, BE-2, CR-1 | See AM-1 |
| IA-3 | The nightly listing and `missing` fail rule 4 | **Applied: moved to V2 unconditionally** | They prevent none of the four harms (R13.0). Removed: `missing`, `listApplicationsForJob`, the `nightly` job and cursor key, the search scope, spike branch (a), the `missing` card line and copy, and about six tests. The DPA says a person deleted in Zoho stays until "Remove this person". The relink-time credit optimisation moves to V2 with it. §2-§5, §11.1, §12, §13.1, §13.2, §15, §16 decision 9 (E1 sheet) |
| IA-4 | Spike item (g) cannot be settled on a Free account | **Applied** | (g) is asked of Zoho developer support, with no seeding. Until it is answered, the sheet assumes the cap: every full read sends `If-Modified-Since` set to the oldest linked job opening's creation time, and a read refused past record 2,000 writes one `too_many_to_read` entry and card line. That entry is the only thing that makes the loss visible. §5, §12.2 card, §13.1 E (g), test (E1 sheet) |
| IA-5 | The record keeps growing | **Process applied; v13 still written** | See R13.0. This table is the errata list, and future findings go to errata and the sheets |
| AM-1 | `apply` re-runs extraction on every later delivery, and one extraction failure is never retried | **Applied (removes two round-12 mechanisms)** | Before the first UPDATE, `apply` keeps only the provider's answers under the call's own keys whose value passes `Coverage.present` (NULL if none). Both UPDATEs store answers only when none are stored (`coalesce(structured_answers, ?)`). The extractor's special condition and the compare-and-set are removed. As a result:<br>- `structured_answers` set means "own answers stored" in the settle rule, the fetch selection, `has_answers` and the results page.<br>- A late or replayed webhook cannot overwrite answers or trigger a reworded second extraction.<br>- A failed extraction leaves NULL, which is retried.<br>Tests: background fetch then a late all-null webhook gives one extraction and one note; a replay never changes stored answers; a webhook-path extraction failure followed by a fetch gives one note with answers. §2.2, §6.1, §6.2, §11.1, §13.1 0 (slice 0 sheet) |
| AM-2 | The R18 check misses the common timing; partly shared labels lose answers | **Third timing applied; partial overlap recorded as a ceiling** | Gate P dials B within seconds of A ending, before A's webhook. Partial overlap: the shared answers are kept and the others print "No answer noted; check the recording" (the recording holds them). Merging extractor answers into missing keys is **declined** as a new merge mechanism that prevents no loss. §6.2 `ponytail:`, §13.1 P, R18 (P and slice 0 sheets) |
| AM-3 | The scrub in `ExternalPayloads` can print an off-topic advice sentence | **Applied (one rule)** | When `AdviceGuard.scrub` would change an answer, the note prints "No answer noted; check the recording". A merge-test fixture with "reject" is added. §6.2 (slice 0 sheet) |
| EIA-1 | A token replacement can falsely put a working connection into `needs_attention` | **Applied (one predicate)** | The `AuthRevoked`/`invalid_grant` write is `... AND secrets_sealed = :sealedRead AND status <> 'disconnected'`; if no row changes, the job stops. It also stops a Disconnect race from making a disconnected row look live to discovery. Test: a send in flight during Take over that gets 401 after the revoke leaves the connection `active`. §5 Failures, §6.1 step 7 (E1 sheet) |
| EIA-2 | Settle and retry rules do not match the new extractor condition | **Applied** with AM-1 | |
| EIA-3 | A job linked during a scan gets one full read, not two | **Applied (one predicate)** with CR-2 b | A completing scan that finds the stored start times different from those it read at start leaves both NULL. The test is extended to cover a deletion during the first full read. §2.3, §5, §18 rule 13 (E1 sheet) |
| EIA-4 | Zoho's 20-refresh-token limit may be per client | **Applied (documentation, `ponytail:`)** | Both Zoho pages are cited. The ceiling is recorded as 20 connections per client until Zoho support settles it (spike item (h), before the 15th production connection). Upgrade path: more registered clients, or Zoho's multi-organisation or Marketplace model (unverified). §5, §13.1 E, R28, §17 (E1 sheet) |
| SA-1 | A revoke can put a refresh token into logs | **Applied (one rule)** | Every revoke catches every exception, logs only the class, never rethrows, and is best effort. Whether Zoho accepts a form body is a spike nice-to-have (i), not a dependency. Test: revoke timeouts on the Disconnect and refused-reconnect paths leave no token text in logs. §3, §11.1 item 6, §18 rule 21 (E1 sheet) |
| SA-2 | E2's upgrade sign-in must request the full scope set | **Applied (one sentence)** | Every sign-in asks for the connection's complete scope set. FakeAts asserts it. E2's sheet checks that the new token still reads and writes notes. ASSUMPTION, unverified: Zoho has no incremental consent. §11.1 item 4, §13.1 E2, §17 (E2 sheet) |
| SA-3 | The cookie path behind the `/backend` prefix | **Applied by removing the restriction** | The cookie uses `Path=/`, as the session cookie does, instead of a computed path. The redirect URI is built from the existing `WEB_URL` plus `/backend/...`. Test: a callback with the browser-path cookie completes. §11.1 item 4 (E1 sheet) |
| SA-4 | The self-serve workspace delete bypasses the pilot-end runbook, and the runbook names no actor | **Applied (text)** | The runbook names the actor: the customer's admin in the UI, or an operator following a written procedure through the same erasure path, never raw SQL. The DPA asks owners not to delete the workspace first. Item W's open list gains "record or delete conversation ids before the rows go". The timing of decision 16 stays as recommended, and SA's timing is given as the alternative with its cost (R13.5). §13.1 W, §16 decision 16 (W sheet) |
| UX-2 | The Applications-module stop comes after job picking | **Applied (order and copy)** | The check runs right after the sign-in (step 2), and nothing is created in HRVoice until step 7. §5 Failures, §12.2, test (E1 sheet) |
| UX-3 | Founder decisions lack a recommended pick | **Applied (text)** | Every decision now has "Recommended: …". The five that block a quote are named at the top of §16. Numbering is kept, because other sections refer to it. §16 |
| UX-4 | The Zoho note is not in the founder's screenshot set | **Applied** | Spike (b) takes a screenshot of the note in the Zoho web app, with a Hindi answer and a "No answer noted" line, and it is added to the set. §12, §13.1 E (b) |
| UX-5 | A note for every unanswered attempt | **Applied (decision text)** | Decision 4 now asks this, recommended yes. If the founder says no, it is one predicate on the discovery query. §16 |
| BE-1 | The background-fetch retry of a failed extraction cannot work under the shared skip rule | **Applied by removal** with CR-1 a | `reconcileSystem` has no skip rule; the fetch selection is the condition. Re-running `apply` on a complete call changes nothing (answers never replaced; ledger fix BE-6). The person's `reconcile` keeps today's rule. §6.1 (Core sheet) |
| BE-2 | Provider answers that hold none of the call's questions still count as "set" | **Applied** with AM-1 | |
| BE-3 | An erasure committed during extraction is undone by the second UPDATE | **Applied (one predicate)** | The second UPDATE gains `AND content_erased_at IS NULL`. Test: block `FakeLlm`, commit the removal, release; summary and answers stay NULL. Treated as part of the removal launch gate. §11.1 item 10, §13.1 Core (Core sheet) |
| BE-4 | `last_sync_issues` is an unbounded jsonb on a busy row | **Write rule applied; cap declined** | The jsonb is an object keyed by external id and is changed only by single SQL statements (`||`, `-`), so no entries are lost. The 500-entry cap is **declined** as a cost, not a loss (`ponytail:` cap it or move it to a table if a pilot has hundreds). §2.3 (E1 sheet) |
| BE-5 | A discovery and unlink race leaves a stray row that later shows as a false failure | **Applied (one OR in an existing delete)** | Expiry also deletes `pending`/`failed` rows whose person has no link on that connection. `sent` rows stay, as the unlink keeps them. Test. §6.1 step 8 (E1 sheet) |
| BE-6 | Repeated `apply` runs can erase earlier extraction cost from the ledger | **Applied, corrected** | BE's `coalesce(excluded, stored)` would not work: `llm_*` is provider usage plus extraction usage, so `excluded` is non-NULL whenever the provider reports usage. The upsert keeps `greatest(excluded.x, stored.x)` for the three LLM token columns, `llm_cost` and `total_cost`. Test. §13.1 Core, §11.1 (Core sheet) |
| CR-1 | The AM-2 and CR-6 fixes do not fit the existing "answers stored" checks | **Applied** with AM-1, BE-1 | Parts (a) to (c) are all covered. CR's narrowed shared skip rule is not used; `reconcileSystem` has no skip rule instead (R13.5) |
| CR-2 | Full read after linking: Candidates fan-out; only one full read when a scan is running | **Applied** | (a) A scan with no window skips read (3), and the credit arithmetic is corrected to count the pages and per-application reads that remain. (b) As EIA-3. Tests. §5, §15 R6 (E1 sheet) |
| CR-3 | A sign-in that returns no refresh token, combined with the revoke rule, leaves a dead connection | **Applied (one sentence)** | Every authorization request sends `access_type=offline` and `prompt=consent`. A response without a refresh token is a failed sign-in: nothing is stored and nothing is revoked. Test. §11.1 item 4, §18 rule 21 (E1 sheet) |

IA's factual note (`PlatformConfig.dataSource` "sets none") is corrected in §11.1 item 6.

### R13.5 Where I departed from a reviewer or went beyond the requests

- **IA-1: closed applications are adopted too**, not only open ones. Adoption then blocks a call to someone the ATS has already closed, which is the safe direction (R26), and it needs no status condition.
- **AM-1 group: the filter, plus "stored answers are never replaced".** AM, EIA, BE and CR kept today's provider-wins `coalesce` in the first UPDATE. That would still let a late webhook carrying real provider answers replace extracted answers, and so send a second "Updated result" note. I flipped the argument order so that the first writer wins. This is IA-2's semantics reached through the others' filter, and it adds no code.
- **BE-1 / CR-1 a: neither BE's own skip rule nor CR's narrowed shared rule.** `reconcileSystem` simply has none. This removes a dependency and leaves the person-facing results path unchanged, so it does not start a provider fetch on every page open.
- **BE-6: corrected to `greatest`**, because `coalesce` cannot see a missing extraction once provider usage is present.
- **BE-4: cap declined; SA-1: catch-all rather than waiting on a form body; SA-3: `Path=/` rather than a computed path; AM-2: no partial merge; UX-1: no "stop importing new applications on a closed job".** Each of these declined additions is a mechanism that would stop no loss or leak.
- **SA-4: decision 16's recommended timing kept** (before the first paid customer or GA). SA's timing (the first workspace holding real candidates' data) is given as the alternative, with its cost of about 1.5-2 weeks on every pilot date. For a free pilot, the runbook and the DPA's statement of gaps cover the window. The founder decides.
- **IA-5: v13 written** because the task requires it; see R13.0.
- **Not asked:** R1 now points at setup step 2. §17's Zoho list now points at the spike list instead of repeating it. Risk mitigations that repeated other sections are shortened to pointers.

### R13.6 Things still open

1. **Founder:** the five quote-blocking items (decision 1 with the Applications-module question, decision 10b, gate P/ADR-008, decision 15, decision 16 and its timing alternative); decision 4's new question on notes for unanswered calls; decision 7 (E2 only); the screenshot set, now including the Zoho note from spike (b). Each decision has a recommended pick in v13 §16.
2. **Vendor, unverified (the E spike, about a day, plus Zoho support):**
   - (a) what closing a job opening does to its applications;
   - (b) notes for a non-admin user, and the note screenshot;
   - (c) Change Status and the pipeline stage (E2);
   - (d) the Applications module on the Free plan;
   - (e) what a merge does to application ids;
   - (f) contact fields, `sort_by`, whether a note moves the Candidate's modified time, 304/204, the record URL;
   - (g) page depth (support);
   - (h) the 20-token limit per client (support, before the 15th production connection);
   - (i) revoke by form body.
   Also: whether Zoho has incremental consent (E2), and whether a single-record GET costs 1 or 3 credits.
   **Voice provider (gate P):** the binding time with three timings, a conversation id on every accepted dial, provider delete with the production key, and the webhook retry policy (with the filter, a replay no longer changes stored answers).
3. **Unverified, recorded:**
   - whether the hard delete passes the RESTRICT foreign keys;
   - whether Zoho record ids repeat across Zoho organisations;
   - the DPDP processor role;
   - whether the uptime monitor supports a keyword check with a confirmation period;
   - whether `Db.uniqueViolation` behaves the same with `logServerErrorDetail=false`;
   - whether `WEB_URL` in production is the browser-visible origin (ASSUMPTION: it is already used for email links).
4. **Pre-existing, outside this plan:** non-Latin question labels collapse to one answer key (§17); items G and W.
5. **Next documents:** ADR-010 from v13 §18; build sheets P, 0, A, G, W, then Core + E1 (after the spike, branches resolved, carrying the R13.4 errata), E2, or Core + Dev. **No v14:** later findings go into an errata list in this file and into the sheets.
6. **Bulk calling** stays in `later-bulk-calling.md`, NOT APPROVED.
7. **Effort (ASSUMPTION, for ordering only):**
   - P 3-5 days; 0 5-7 days; A 1-2 days; G 1-2 days;
   - Core about 2-2.5 weeks; E1 about 2.5-3 weeks (the nightly listing is gone); E2 about 1-1.5 weeks;
   - W about 1.5-2 weeks; Dev about 3 weeks.
   **Quote to an E pilot after gate P: 0 + Core + E1, about 5.5-7 weeks, plus W for a paying pilot.**

---
