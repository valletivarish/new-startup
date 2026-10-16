# 07. Critical reviewer: pre-mortem for the integration layer

Date: 2026-10-03. Round 1, written before reading any other proposal. Research only: no code, config, migration or test was changed.

Labels: **FACT** (source given: URL or repo path), **RECOMMENDATION** (my view), **ASSUMPTION** (believed, not checked), **unverified** (looked, could not confirm).
Path shorthands follow `docs/integrations/00-current-system-backend.md`: `JAVA/` = `apps/api-java/src/main/java/desk/`, `MIG/` = `packages/db/drizzle/`.

---

## 1. Summary

Imagine it is twelve months from now and the integration layer has failed. The most likely story is not one dramatic bug. It is a slow pile-up:

- We built a generic "connect anything" platform: a canonical model, a sync engine, a connector framework and an MCP server.
- Meanwhile the first two pilot customers used Zoho Recruit and Naukri RMS. Naukri RMS has no public API docs. Zoho hides custom stages from its API.
- Results reached the customer's ATS twice, or not at all, because our call events are in memory and are re-published every time someone opens a results page.
- A stage we wrote back overwrote a move the recruiter had made in the ATS.
- A connection broke silently when its refresh token was pushed out by Zoho's 20-token limit, and nobody noticed for a week.

The good news: the repo already holds most of the right parts.

- Org-scoped RLS through `Db.inOrg`.
- A durable per-tenant queue (`background_jobs`).
- A narrow-policy webhook pattern (0022).
- Seeded `integrations.*` permissions.
- A domain event seam.
- A no-advice guard.
- A spec decision for hashed, org-bound API keys.

The integration MVP is mostly about wiring these together safely, not inventing new infrastructure.

My minimum bar for any proposal is in section 3. In short:

- a durable outbox with a persistent delivery dedupe key;
- external ids and one canonical phone format before any automated intake;
- one machine principal that goes through the existing `AuthInterceptor`, permission checks and PII redaction;
- per-connection encrypted secrets that are not derived from `BETTER_AUTH_SECRET`;
- SSRF-safe outbound HTTP;
- a reconciliation pull behind every inbound webhook;
- a visible health status per connection;
- write-back limited to facts and human decisions.

My positions:

- **MVP:** a results CSV export, org API keys, a small versioned REST surface (bulk candidate upsert by external id, results read, changes-since), and signed outbound webhooks for `result.ready` and `candidate.stage_changed`. Together these let a customer's own app, or a no-code tool, connect without us writing a connector.
- **V2:** one native ATS connector, chosen only after two or more paying customers name the same system.
- **Later or Avoid:** unified-API vendors, MCP, SDK/embed, direct DB, customer-side agents, a generic sync engine and in-call ATS tools.

---

## 2. Findings: how this typically fails

### 2.1 Failure mode: overengineering before the first connector works

- **F1. FACT.** The repo has already deferred customer webhooks and MCP. It also lists "Shipping fake webhook/MCP UI" as an anti-pattern. Sources: `docs/superpowers/specs/2026-09-16-hiring-production-launch-design.md` lines 12, 72 and 88.
- **F2. FACT.** Unified-API vendors themselves say coverage is partial. Kombo's Zoho Recruit page says custom application stages and statuses "are not available through the public API" (https://docs.kombo.dev/ats/connectors/zohorecruit, via search summary). A canonical model built before we have seen real customer data cannot cover what the vendor API does not expose.
- **F3. RECOMMENDATION.** Do not design a cross-ATS canonical schema. The canonical model already exists: job, candidate (contact), call result, and the human stage. These are the stable nouns in the launch spec, section 6b. Map each vendor onto those four nouns inside its adapter.
- **F4. RECOMMENDATION.** Do not add new services. That means no separate integration microservice, no Kafka, no Redis queue and no workflow engine. `background_jobs` already gives per-tenant durability, `FOR UPDATE SKIP LOCKED`, backoff and dead-lettering (`MIG/0030_background_jobs.sql`, `JAVA/jobs/JobQueue.java`). The launch spec says to skip a generic workflow engine "until proven need" (`docs/superpowers/specs/2026-09-16-voice-agent-platform-design.md` lines 116–122).

### 2.2 Failure mode: lost results (webhook and event loss)

- **F5. FACT.** Domain events are published in-process through Spring `ApplicationEventPublisher`, and the only listener logs them (`JAVA/engine/DomainEvents.java`). If the process dies between the DB write and the publish, the event is gone.
- **F6. FACT.** Vendors do not guarantee delivery to us:
  - Greenhouse says webhooks "don't guarantee delivery". It retries 7 times over about 15 hours (https://docs.greenhouse.io/webhooks.html).
  - Lever retries 5 times with increasing waits (https://hire.lever.co/developer/documentation, via search summary).
  - Stripe retries for up to 3 days and says it "doesn't guarantee the delivery of events in the order that they're generated" (https://docs.stripe.com/webhooks).
- **F7. RECOMMENDATION.** Every inbound webhook must be backed by a periodic reconciliation pull ("give me everything updated since T"). Webhooks are a latency optimisation, not the source of truth.
- **F8. RECOMMENDATION.** Every outbound delivery must come from a transactional outbox row, written in the same transaction as the result or stage update. It is then delivered by a `background_jobs` worker.

### 2.3 Failure mode: duplicate deliveries and duplicate side effects

- **F9. FACT.** `VoiceSessions.apply` re-publishes `call.ended` and `result.ready` every time it runs for an ended session. It runs from the webhook, from reconcile, and when someone opens the results page (`00-current-system-backend.md` §9; `JAVA/voice/VoiceSessions.java` lines 500–554; `JAVA/hiring/HiringController.java` lines 268–276).
- **F10. FACT, and a trap the backend map does not spell out.** The `background_jobs` idempotency index only covers rows in `queued` or `running` status:

  ```sql
  WHERE "idempotency_key" IS NOT NULL AND "status" IN ('queued', 'running')
  ```

  A succeeded job row is deleted (`MIG/0030_background_jobs.sql` lines 16 and 36; `JAVA/jobs/JobQueue.java` line 145). So an idempotency key **does not stop a second delivery after the first one succeeded**. If someone opens the results page an hour after delivery, the event is re-enqueued and sent again.
- **F11. RECOMMENDATION.** Add a persistent delivery record with `UNIQUE (subscription_id, event_key)`. Use the event key `voice_session_id:event_type` for result events, and the audit row id for stage changes. Send this key to the customer as the `webhook-id`, so their side can dedupe as well. Standard Webhooks says to use `webhook-id` as the idempotency key (https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md).
- **F12. FACT.** `JobQueue.enqueue` reads `POLICY.get(kind)[0]` with no null check, so a new kind throws a NullPointerException. The `kind` column also has `CHECK IN ('email','document')` (`JAVA/jobs/JobQueue.java` lines 38 and 66–67; `MIG/0030…`). A new kind therefore needs both a migration and a POLICY entry. Reviewers should check that a proposal accounts for both.

### 2.4 Failure mode: duplicate candidates and sync drift

- **F13. FACT.** Candidate uniqueness is `UNIQUE (job_id, phone)` on the raw text. CSV import stores national digits plus a separate `country_code`. Manual entry stores the phone exactly as typed (`MIG/0018_job_scoped_candidates.sql`; `JAVA/hiring/Candidates.java` lines 63–96). An ATS that sends `+919876543210` and a CSV row that sent `9876543210` + `+91` therefore become **two candidates on the same job**.
- **F14. FACT.** `PhoneNumbers.toE164` reads only `candidates.phone` and ignores `country_code` (`JAVA/engine/PhoneNumbers.java` lines 8–20). Automated intake of non-Indian numbers would be misdialed. This comes from a code read and is untested.
- **F15. FACT.** Candidates are scoped to one job: the same person on two jobs is two rows (`MIG/0018…`). ATSs model this as candidate plus application (Greenhouse, Lever, Zoho; see their API docs).
- **F16. RECOMMENDATION.** Key imported rows on the vendor's **application** id (or the candidate id plus the job id), not on the candidate id alone. Add `UNIQUE (organization_id, connection_id, external_id)`. Fix the phone storage format to E.164 before any automated intake. Otherwise re-sync either duplicates people or overwrites edits.
- **F17. FACT.** `voice_sessions` has no `updated_at`, and `/voice-sessions` is capped at 50 with no cursor (`00-current-system-backend.md` §6.3, §18 item 10). Any "changes since" feed needs a real cursor column. Never use a timestamp guess.
- **F18. RECOMMENDATION.** Define the edit-conflict rule up front:
  - Fields the ATS owns (name, email, phone, job) are refreshed from the ATS until a human edits them in our app.
  - Fields we own (call results) never flow inward.
  - The rule must be written down per field, not left to "last write wins".

### 2.5 Failure mode: write-back conflicts and rule violations

- **F19. FACT.** The product never recommends hire or reject and never scores candidates (`apps/web/PRODUCT.md:56`; `apps/api-java/src/main/resources/usecases/hiring.json` keys `result.summaryInstruction` and `result.adviceGuard`).
- **F20. FACT.** The API still returns `fitPercent`, and the web does not render it (`00-current-system-product.md` C2).
- **F21. FACT.** The summary is advice-scrubbed **on read in the controller** (`JAVA/hiring/HiringController.java` line 250). `Jobs.results` returns the stored summary as it is (`JAVA/hiring/Jobs.java` lines 308 and 340). An outbound worker that calls `Jobs.results` directly, rather than the controller, would push unscrubbed provider text into a customer's ATS.
- **F22. RECOMMENDATION.** One serializer builds every external payload: webhook, API response and ATS write. It applies `AdviceGuard.scrub` and excludes `fitPercent` by construction. Add a test that fails if `fitPercent`, "score", "rating" or "recommend" appear in an outbound payload schema.
- **F23. RECOMMENDATION.** Only write a stage change back to the ATS when a named person changed the stage in our app. Use a mapping the customer configures. Before moving the stage, compare-and-set: re-read the ATS stage first. If it changed since import, do not overwrite it. Add a note or tag instead and show "Your ATS was updated by someone else".
- **F24. FACT.** Zoho Recruit custom stages are not visible through its public API (Kombo connector doc above). For some customers, a stage write-back may only be possible as a note or tag.

### 2.6 Failure mode: token expiry and quota exhaustion

- **F25. FACT.** Zoho access tokens last one hour (https://www.zoho.com/recruit/developer-guide/apiv2/oauth-overview.html). A client may hold at most 20 active refresh tokens per user. When that is exceeded, "the oldest token will be invalidated" (https://www.zoho.com/accounts/protocol/oauth/token-limits.html).
  - **RECOMMENDATION:** never share one OAuth client id between dev, staging and production. A developer reconnecting 20 times in staging can silently kill a production customer's token. Treat `invalid_grant` as "needs reconnect" and show that to the customer. Do not retry it forever.
- **F26. FACT.** Google OAuth apps in "Testing" status get refresh tokens that expire in 7 days. Unverified production apps are capped at 100 users (https://developers.google.com/identity/protocols/oauth2, via search summary). This matters if a Google Sheets connector is ever proposed.
- **F27. FACT.** Greenhouse Harvest is limited per 10 seconds by `X-RateLimit-Limit` (the example shows 50). It uses Basic auth with an API token. "The Harvest v1/v2 API is deprecated and will be removed on August 31, 2026", which is already past as of this writing (https://docs.greenhouse.io/harvest.html). Vendor API churn is a recurring cost per connector.
- **F28. FACT.** Zoho Recruit API credits work like this (https://www.zoho.com/recruit/developer-guide/apiv2/limits.html, via search summary):
  - Standard edition: 5,000 + 250 per user per rolling 24 hours, so 7,500 for 10 users.
  - A "Get Records" call costs 3 credits.
  - A bulk write costs 500 credits.

  Polling every 15 minutes across every open job can use up a small customer's whole daily quota, which also breaks their other integrations.
  - **RECOMMENDATION:** give each connection its own rate budget, and make the default polling interval conservative (hourly), with a manual "Sync now".
- **F29. FACT.** Our only rate limit is in-process per IP (`JAVA/platform/EdgeFilter.java` lines 55–83).
  - **ASSUMPTION:** an ATS vendor sends webhooks for all its customers from a shared set of egress IPs.
  - If so, one busy customer's burst could rate-limit another customer's webhooks from the same vendor. Inbound integration routes need a per-connection limit, not per-IP.

### 2.7 Failure mode: security holes

- **F30. SSRF (FACT).** OWASP says to resolve every A and AAAA record, reject private ranges, and disable redirects in the HTTP client (https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html). Standard Webhooks says to proxy webhook traffic through a filter that blocks internal IPs (spec link above). The MCP security guidance lists DNS rebinding and redirect chains, and warns "Avoid implementing IP validation manually" (https://modelcontextprotocol.io/specification/2025-06-18/basic/security_best_practices).
  - **RECOMMENDATION:** a customer-supplied webhook URL must be HTTPS only, with no redirects. Resolve the host, check the IPs, and connect to the checked IP (pin it). Block 169.254.0.0/16, RFC 1918 ranges, loopback and IPv6 ULA and link-local. Truncate response bodies and keep them out of logs.
- **F31. Cross-tenant leak (FACT).** Today the tenant is resolved only from server-side state (`Db.java`; `MIG/0022_voice_webhook_lookup.sql`).
  - **RECOMMENDATION:** an inbound ATS webhook URL carries a random connection id. Steps, in order:
    1. Verify that connection's own secret.
    2. Resolve the org through a SELECT-only policy on the connection row.
    3. Do all writes under `inOrg`.
  - Never take `organization_id` or `job_id` from the payload without checking it against the connection.
- **F32. Secrets (FACT).** The only encrypt-at-rest helper derives its key from `BETTER_AUTH_SECRET`, and rotating that secret kills pending sealed mail (`JAVA/notify/Notifications.java` lines 75–97; `MIGRATION_STATUS.md` line 358). The `accounts` table stores OAuth tokens in plaintext (`MIG/0000_initial_schema.sql`).
  - **RECOMMENDATION:** use a separate integration key that carries a version tag, AES-GCM, with the org id and connection id as associated data. Do not reuse `accounts`. Never log request headers or bodies on integration routes.
- **F33. Machine identity (FACT).** `Actor` always needs a user and a membership. Tool execution runs as a signed-in member (`JAVA/runtime/Tools.java`). The spec mandates "hashed, scoped, revocable API keys bound to an organization" (`BRD's/04_DATABASE_API_SPEC.md` line 410).
  - **RECOMMENDATION:** an API key resolves to `(org, key_id, explicit permission set)`. It passes through `AuthInterceptor`, so field-level PII redaction applies unchanged. Store only a SHA-256 hash, following the invitation-token pattern. Show the key once. Write an audit row on every use of a sensitive permission.
- **F34. PII export (FACT).** `candidates.export` is withheld from Analysts because "a CSV export is the easiest path to bulk PII leaving the system" (`BRD's/11_PERMISSION_MATRIX.md`).
  - **RECOMMENDATION:** an outbound subscription that carries transcript, phone or email is an export. Creating one requires the creator to hold `candidates.export` and `calls.read_transcript`. The subscription stores which fields it may send, and the payload drops anything else.
- **F35. Law (FACT).** India's DPDP Rules 2025 were notified on 13–14 November 2025. The core fiduciary and processor obligations (security safeguards, breach reporting, retention, erasure) start on 13 May 2027. Rule 6 requires processor contracts to include safeguards and logs to be kept for one year (law-firm summaries; primary text is Gazette G.S.R. 846(E), https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf). I did not read the Gazette directly.
  - **RECOMMENDATION:** any integration that copies candidate PII into, or out of, a third-party system must log the flow per connection and respect deletion. Deleting a candidate in our app should not silently leave copies in delivery logs.
- **F36. MCP (FACT).** The MCP spec forbids token passthrough: servers "MUST NOT accept any tokens that were not explicitly issued for the MCP server". It also requires per-client consent for proxy servers, to prevent confused-deputy attacks (security best practices page above). A remote MCP server therefore means running an OAuth authorization surface. That is a large security commitment for a 2–3 person team.

### 2.8 Failure mode: automatic intake that triggers automatic calls

- **F37. FACT.** Every phone screen today starts from a human click (`calls.initiate`). Auto-retry is coded but switched off. The migration notes say turning it on "means calling people again without a click, inside 10:00–19:00 IST. Confirm consent and DND policy first" (`apps/api-java/MIGRATION_STATUS.md` line 373).
- **F38. RECOMMENDATION.** The founder's goal says "AI agents use it, perform the workflow". The risky reading is "a new ATS applicant gets phoned automatically". Keep that as a separate, explicit, per-job opt-in, decided by the founder after a consent and DND review. Imported candidates should land in "Not called yet", and a person still clicks Call (or "Call all ready"). This also keeps `BudgetGuard` and the cost exposure under human control.

### 2.9 Failure mode: vendor lock-in and cost (unified APIs)

- **F39. FACT.** Merge charges per linked account:
  - Launch plan: 3 free production accounts, then $650/month for up to 10, plus $65 per extra account.
  - Launch ATS data syncs daily; faster syncs need a paid contract.
  - Writes happen in real time.

  Sources: https://www.merge.dev/pricing/unified and https://help.merge.dev/en/articles/5388387-merge-sync-frequencies, via search summary. Exact current numbers are unverified on the primary page.
- **F40. FACT.** No unified API appears to cover Naukri RMS (search found none). Naukri RMS has no public developer docs; access goes through a paid integration module and an account manager (https://help.workable.com/hc/en-us/articles/26298085189271-Integrating-with-Naukri). Darwinbox API access is requested by email. Keka publishes self-serve docs with Hire endpoints (https://developers.keka.com/reference/get_v1-hire-jobs-jobid-candidates).
- **F41. ASSUMPTION.** With a unified API, the customer's OAuth grant is held in the vendor's tenant. Leaving the vendor means every customer reconnects. I did not check whether Merge or Kombo export tokens.
- **F42. RECOMMENDATION.** A unified API makes sense only when three or more different ATSs are demanded by paying customers and at least one is covered well. At an expected ₹ price point per SMB customer (ASSUMPTION), $65 per linked account per month may be a large share of revenue. The founder must check this against pricing.

### 2.10 Failure mode: onboarding friction and support burden

- **F43. FACT.** Lever webhooks can only be configured by a Super Admin, and each event has its own signing token (Lever docs, via search summary). Zoho workflow webhooks are configured per workflow rule (https://help.zoho.com/portal/en/kb/recruit/automation/workflow/webhooks/articles/zoho-recruit-webhooks). The person setting up HRVoice (a recruiter) is often not the ATS admin.
- **F44. RECOMMENDATION.** Budget for a guided setup, with a "send test event" button and a health line per connection: "Last received 3 min ago", "Needs reconnect", "12 results waiting to send". With no operator view of `dead` jobs today (`00-current-system-backend.md` §10), failures are invisible until a customer complains.
- **F45. FACT.** The web error filter replaces any message containing "webhook", "api key", "token" or "payload" with a generic sentence (`apps/web/lib/errors.ts` line 77). The agent page already uses the word "Integrations" for test tools (`apps/web/app/agents/[id]/page.tsx:700-735`). Integration error copy and naming must be planned around both, or the connection screen will show useless messages.

### 2.11 Failure mode: in-call tools and MCP hype

- **F46. FACT.** ElevenLabs agents support server (webhook) tools with custom headers, Bearer, Basic and OAuth2 client credentials (https://elevenlabs.io/docs/agents-platform/customization/tools/server-tools). Our live calls receive only system tools (`JAVA/engine/CallContextCompiler.java` lines 220–237).
- **F47. RECOMMENDATION.** HRVoice needs data before the call (job, candidate) and after the call (results). It does not need data during the call. In-call ATS lookups would add latency, a new public endpoint, a call-scoped principal and a new failure path on a live phone call. Avoid them for hiring. Reconsider for the appointment module, where checking calendar slots is in-call by nature.

---

## 3. Minimum bar any proposal must meet

Each item is a RECOMMENDATION and should be testable.

1. **Uses what exists:** `Db.inOrg` for every write, `background_jobs` for every async step, `AuthInterceptor` with `@RequirePermission` for every route, `AuditService`, `AdviceGuard`, `integrations.*` permissions, and the 0022 narrow-policy pattern. No new service, broker or ORM.
2. **Durable outbox:** the event row is written in the same transaction as the business change, covering `result.ready` and a new `candidate.stage_changed`. Delivery dedupe uses a persistent unique key, not the queue's queued-only index (F10).
3. **Provenance before intake:** `connection_id`, `external_id` and `last_synced_at` on jobs and candidates, a new `source` value, `UNIQUE (org, connection, external_id)`, and one stored phone format (E.164) that the dialer uses (F13–F16).
4. **One machine principal:** a hashed, org-bound API key with an explicit permission set, going through the same interceptor and PII redaction. Revocable. Audited.
5. **Per-connection secrets:** encrypted with a key that is not `BETTER_AUTH_SECRET`, with a key version, and never logged. OAuth refresh failures move the connection to "needs reconnect".
6. **SSRF-safe outbound client:** HTTPS only, no redirects, resolved-IP checks with the IP pinned, timeouts, response size cap.
7. **Inbound webhooks:** a secret per connection, raw-body verification, a timestamp check where the vendor provides one, dedupe by delivery id, quick 2xx and then enqueue. A reconciliation pull is always present.
8. **Write-back rule:** facts plus the human-chosen stage only, through one serializer. No `fitPercent`, no AI verdict, no stage the system decided itself. Compare-and-set against the ATS's current stage.
9. **Visible health:** each connection shows its last success, last error in plain words, and its backlog. Dead jobs are visible to an admin.
10. **Scope:** one connector shipped end to end, with one pilot customer, before a second one is started. The generic surfaces (API, webhooks, CSV) come first, because they serve the long tail without connector code.
11. **No auto-dial** without a founder decision on consent and DND (F37–F38).
12. **Stays additive:** Nest still runs on the same DB, so migrations stay additive and do not break its writes (`MIGRATION_STATUS.md`).

## 4. Specific traps to watch for in the drafts

| Trap | What to look for in a proposal |
|---|---|
| Canonical-model astronautics | A "universal candidate/job/application schema" with dozens of fields before one real customer payload has been seen |
| Sync engine | Two-way field-level sync, conflict resolution frameworks, CDC. Our data flow is one-way in (people, jobs) and one-way out (results, decisions) |
| Connector count | A roadmap listing 10–20 ATSs. Ask: which paying customer asked for each? |
| Unified API as day one | Merge, Kombo or Knit before we know the customers' ATSs. Check India coverage (Naukri: none found) and per-account cost |
| MCP first | An MCP server before API keys and a stable API exist. The spec forbids token passthrough and requires OAuth; the launch spec says "façade later" |
| "Webhooks are reliable" | No reconciliation pull. No dedupe. Relying on in-memory `DomainEvents` |
| Queue idempotency misread | Assuming `background_jobs.idempotency_key` dedupes forever (it does not, F10) |
| Secrets shortcut | Reusing `Notifications.seal`, the `accounts` table, or env vars per customer |
| RLS bypass | Any "system" role with BYPASSRLS, or tenant taken from a payload |
| Score leakage | `fitPercent` or "coverage %" written to an ATS "rating" field. Unscrubbed summary via `Jobs.results` |
| Hidden auto-dial | "Data flows in, agent calls" with no consent or DND gate |
| Customer-side agent | An on-prem connector, SFTP drop or direct DB link for SMB customers who have none of those |
| Per-customer custom code | "We'll write a small adapter for each customer". The support burden grows without bound |
| UI honesty | A connections screen or Tools card that shows "Connected" before data actually flows (anti-pattern D14) |

---

## 5. Positions by topic

| Topic | Phase | Position | Rationale | Concerns |
|---|---|---|---|---|
| REST API | MVP | A small, versioned (`/v1/`) org API: bulk candidate upsert by external id (reusing the CSV import validation path), results read, changes-since cursor, stage read | Serves custom apps and no-code tools without per-vendor code. Reuses `CandidateImport` and the existing controllers | Needs a real cursor (no `updated_at` on `voice_sessions`) and an idempotency key on create. Keep it small; no OpenAPI tooling yet beyond a hand-written doc |
| API keys | MVP | Hashed (SHA-256), org-bound, explicit permission set, show once, revocable, last-used time, audited | Already mandated (`BRD's/04` line 410, ADR-002). Smallest machine identity | Must go through `AuthInterceptor` and PII redaction; no bypass. Per-key rate limit |
| Service accounts | MVP (as part of API keys) / Avoid as a separate concept | An API key **is** the service principal: `actor = key`, permissions = the key's set | No need for a second identity model | Audit `actor_user_id` is NULL for system actors; add `api_key_id` to audit metadata |
| OAuth | V2 (as a client to one ATS) / Later (as a provider) | Implement an OAuth client only with the first native connector that needs it. Do not become an OAuth authorization server until MCP or a marketplace is real | Zoho tokens last 1 h, with a 20-refresh-token limit; Google's Testing mode gives 7-day tokens | Separate client ids per environment. `invalid_grant` means needs reconnect |
| Webhooks | MVP outbound / V2 inbound | Outbound: signed (Standard Webhooks format), `result.ready` plus `candidate.stage_changed`, outbox, persistent dedupe, delivery log, SSRF guard. Inbound: only with the first connector, with a secret per connection plus reconciliation | Outbound turns on the founder's "results flow back" for any system the customer can point at a URL. Turns on `actions.webhook` | F10 duplicate trap; F30 SSRF; payload must be scrubbed (F21) |
| Event / queue | MVP | Reuse `background_jobs`. Add an outbox table and new kinds (`webhook_delivery`, later `sync_pull`) with POLICY entries | Durable, per-tenant, replica-safe already | Needs a recurring per-org schedule (only `run_at` exists today) and a dead-row view |
| Canonical model | MVP (minimal) | The model is our four nouns: job, candidate, call result, human stage. A per-vendor mapping lives inside the adapter | A cross-ATS schema fits no one (Zoho hides custom stages) | Stage mapping is configured per customer |
| Sync engine | Avoid (generic) / V2 (one-way pull for one connector) | A cursor-based "pull new applications for mapped jobs", hourly plus "Sync now". No two-way field sync | Data flow is one-way in each direction | Quota budgets (Zoho credits); drift rules per field (F18) |
| Two-way actions | V2 (limited) | Write-back: a result note or attachment plus the human-chosen stage via a customer mapping, compare-and-set. No automatic stage moves | Product rule: a person decides | Conflicts with recruiter edits in the ATS; custom stages not in the API |
| Multi-tenancy | MVP | Reuse forced RLS. Connection rows under RLS. Inbound lookup through a narrow SELECT policy like 0022 | No bypass exists; keep it so | Never take the tenant from a payload |
| Security | MVP | Separate integration encryption key, SSRF-safe client, per-connection secrets, PII export permission check on subscription create, audit, DPDP-aware deletion | See F30–F36 | Key rotation design; log redaction |
| Onboarding UX | MVP | Settings tab "Connected systems": API keys, webhook endpoints with "Send test", health line. The CSV results export in the candidates board | The recruiter is often not the ATS admin; failures must be visible | Error filter words (F45); rename the agent page's "Integrations" |
| File / SFTP fallback | MVP (CSV export) / Avoid (SFTP) | Ship a results CSV export (gated by `candidates.export`, audited). It is the cheapest removal of retyping and fixes the outbound field list. No SFTP for SMBs | Import CSV already exists; export is missing | Excel formula injection in CSV cells (escape leading `= + - @`) |
| First integration | MVP generic, V2 native | First: results CSV export, then API keys plus outbound webhooks (which work with Zapier, Make, n8n or custom apps). The first native ATS is picked by pilot demand. Likely candidates are Zoho Recruit (documented API, Kombo coverage) or Keka (self-serve docs). Naukri RMS only via account manager | Do not guess; the repo has no customer data on which ATS (`00-current-system-product.md` U9, G1) | Choosing an ATS nobody pays for |
| Build vs buy (unified API) | Later | Re-evaluate when 3+ distinct ATSs are demanded and coverage is confirmed for them | Cost per linked account; daily sync on the entry plan; India gaps; token custody lock-in | Pricing verified only through search summaries |
| MCP | Later | A thin façade over the v1 API after API keys exist, read-mostly tools, OAuth per the MCP spec | Spec forbids token passthrough and requires consent handling; launch spec says "façade later" | Security surface; no customer demand recorded |
| SDK / embedded | Avoid (Later at earliest) | No client SDK or embeddable widget | Customers are SMB recruiters, not developers | Maintenance per language |
| Direct DB | Avoid | No customer access to our DB and no connecting to a customer's DB | RLS and PII; credential custody; SMBs rarely have one | n/a |
| Customer-side connector | Avoid | No on-prem agent | Target customers are cloud SaaS users | Support burden |
| Other: auto-dial on intake | Later (founder decision) | Default off. A per-job explicit opt-in after a consent and DND review | `MIGRATION_STATUS.md` line 373 | Cost, consent, TRAI DND exposure (unverified specifics) |
| Other: in-call ATS tools | Avoid for hiring | No server tools on live calls | Not needed before or after the call; adds latency and risk | Revisit for appointments |

---

## 6. What not to build (now)

1. A generic sync engine, CDC pipeline or bidirectional field sync.
2. A cross-vendor canonical ATS schema beyond our four nouns.
3. An integration microservice, Kafka, Redis or any second queue.
4. An MCP server, an OAuth authorization server, an SDK or an embeddable widget.
5. More than one native connector before the first has run for a month with a real customer.
6. Per-customer custom connector code.
7. Unified-API contracts before demand is proven.
8. SFTP drops, customer DB links or on-prem agents.
9. A workflow or rules builder ("if stage X then Y").
10. Automatic dialing of imported candidates without a founder consent decision.
11. In-call tools against customer systems.
12. Any write of `fitPercent`, coverage %, "qualified", or a system-chosen stage into an external system.
13. A "Connected" UI state or a Tools-page card that turns on before real data flows.

## 7. Open questions (for the founder)

1. Which systems do the first 5–10 customers actually use? Spreadsheet, Naukri RMS, Zoho Recruit, Keka, Darwinbox, or none? Nothing in the repo records this.
2. Do customers mostly want candidates pulled in, or results pushed out? Today intake is CSV-only, and results leave by copy-paste.
3. Should imported candidates ever be called automatically? If so, what consent and DND evidence do you have from the employer?
4. Is a customer's own ATS brand name allowed on the connection screen? The no-vendor-names rule targets our infrastructure vendors.
5. Is it acceptable to send the transcript and the recording link outside the workspace? Or should write-back carry only the summary and answers?
6. What does one SMB customer pay per month? This decides whether $65 per linked account per month for a unified API is viable.
7. Which hosting topology (replicas, egress proxy available?) is planned? It affects the SSRF egress design and the per-IP rate limit (ADR-006 not read).
8. Should Greenhouse or Lever be on the list at all for Indian SMBs, or only Indian systems? (unverified market fact)
