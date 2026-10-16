# 01. Integration architect: APIs, auth, webhooks, sync

Date: 2026-10-03. Author role: Integration Architect (independent pass, written before reading the other experts).
Scope: how customers connect their ATS, CRM or own app once, so that candidates flow in, HRVoice does the calls, and results flow back. This is research only. No code, config, migration or test was changed.

Labels used throughout:
- **FACT**: verified in a vendor's or standards body's documentation (URL given) or in this repo (path given). Repo paths are relative to `/Users/valletivarish/Documents/new startup/`. `JAVA/` = `apps/api-java/src/main/java/desk/`, `MIG/` = `packages/db/drizzle/`.
- **FACT (secondary)**: the vendor's own docs were login-walled or silent, so the source is a third party (integration vendor, unified-API vendor). Treat it as weaker.
- **RECOMMENDATION**: my proposal.
- **ASSUMPTION**: a belief I did not verify.
- **unverified**: I looked and could not confirm.

---

## 1. Summary

1. The founder's goal ("connect once, data in, agent works, results out") needs four things we do not have: a way for a machine to call us (API keys), a durable record of what happened (an event outbox), a way to push those events out (signed webhooks), and a way to link our rows to the customer's rows (external ids). Everything else (tenancy, permissions, PII redaction, audit, a durable retrying queue, HMAC helpers, an AES-GCM seal) already exists in `apps/api-java` and should be reused, not rebuilt.
2. **MVP recommendation (generic first, vendor second):** (a) a results CSV export, (b) org-scoped, hashed, permission-scoped API keys, (c) a small versioned public API (`/v1`) to upsert jobs and candidates by the customer's own id and to read results and an events feed, (d) outbound webhooks signed with the Standard Webhooks scheme for `result.ready`, `call.ended` and `candidate.stage_changed`, delivered through the existing `background_jobs` queue from a transactional outbox. This lets any customer with a developer, or a no-code tool such as Zapier, Make, n8n or Pabbly, connect any system on day one.
3. **First named connector (V2), pending the founder's customer list:** Zoho Recruit. It has a documented REST API v2 with self-serve OAuth, an India data centre (`recruit.zoho.in`), a free plan with 5,000 API credits per day for testing, and webhooks on paid plans. The Indian alternatives are weak first targets: Keka sells API access as a paid add-on with a 50 requests/minute limit; Darwinbox gives API access on request only; Naukri RMS has no public API documentation; Freshteam is being shut down; greytHR's public API has no recruiting endpoints. Greenhouse and Lever are well documented but need a signed partner agreement for multi-customer OAuth apps, and Greenhouse switched to OAuth-only Harvest v3 on 31 August 2026.
4. **Write-back rule:** only facts and human decisions go back to an ATS: call status, failure reason, timestamps, the advice-scrubbed summary, answers keyed to the customer's own questions, and a stage that a named person chose, mapped through a mapping the customer configured. Never a score. This matters concretely: Greenhouse's Assessment Partner API has a `partner_score` field and Keka exposes scorecards; we must leave those empty.
5. **What not to build now:** our own OAuth authorization server, a remote MCP server, SDKs, an embeddable widget, direct database access in either direction, an on-premise connector agent, SFTP, a generic canonical data model, a generic workflow engine, Kafka or any new queue, and a unified-API contract. Each is argued below.
6. **Build vs buy:** do not buy a unified API (Merge, Kombo) yet. Merge's paid tier starts at $650/month for 10 linked accounts; neither vendor lists Keka or Darwinbox as an ATS; both would hold Indian candidates' PII outside India while our own compute is India-only by ADR-006. Revisit when several paying customers ask for partner-gated Western ATSs (Greenhouse, Lever, Workday), because there the unified-API vendor's existing partnerships are worth the money.

---

## 2. Findings

### 2.1 What the codebase already gives an integration (reuse map)

| # | Label | What exists | Source | How integrations reuse it |
|---|---|---|---|---|
| R1 | FACT | Every tenant table has forced RLS keyed on `current_org_id()`, set only by `Db.inOrg`; there is no RLS bypass. System work runs as `inOrg(org, Db.NIL)`. | `JAVA/platform/Db.java`; `MIG/0001_rls_policies.sql` | All sync, delivery and inbound-webhook writes run under `inOrg`. Nothing needs a bypass. |
| R2 | FACT | The voice webhook resolves its org through a narrow SELECT-only RLS policy after HMAC verification. | `MIG/0022_voice_webhook_lookup.sql`; `JAVA/voice/VoiceController.java` 131-156 | Same pattern for inbound ATS webhooks: verify signature, look up one connection row through a narrow policy, then `inOrg`. |
| R3 | FACT | `background_jobs`: per-org RLS, idempotency key unique while queued/running, exponential backoff `base × 2^(attempt-1)` capped at 3600 s, `max_attempts` 1-20, dead-lettering, `FOR UPDATE SKIP LOCKED`, row deleted on success. `kind` is limited to `email`/`document` by a check constraint and by the `POLICY` map. | `MIG/0030_background_jobs.sql`; `JAVA/jobs/JobQueue.java` 35-38, 66-76, 136-161 | Delivery and sync workers. Needs new kinds (migration + `POLICY` entry). |
| R4 | FACT | Domain events `call.started`, `call.ended`, `result.ready` are published in-process; the only listener logs. Comment: "customer webhooks / MCP subscribe here later". They are re-published every time `apply` runs on an ended session (webhook, reconcile, opening the results page). Stage changes publish nothing. | `JAVA/engine/DomainEvents.java`; `JAVA/voice/VoiceSessions.java` 500-554; `JAVA/hiring/HiringController.java` 362-396 | Keep the publish call sites, but make the event durable (outbox) and deduplicated. |
| R5 | FACT | The `background_jobs` idempotency key protects only while a job is queued or running; the row is deleted after success. | `JAVA/jobs/JobQueue.java` line 145; partial unique index in `MIG/0030_background_jobs.sql` | Therefore it cannot dedupe the repeated `result.ready` publishes from R4 after the first delivery succeeds. A persistent unique key is needed (see 3.4). |
| R6 | FACT | Permission catalogue already has `integrations.read/create/update/delete`, `workflows.*`, `candidates.export`; PII and transcript fields are omitted per field for callers without `candidates.read_pii` / `calls.read_transcript`. | `JAVA/authz/Permissions.java` 21-131; `JAVA/hiring/Candidates.java` 29-35; `HiringController.java` 246-255 | An API key carries an explicit permission set, so the same interceptor and the same redaction apply to machines. |
| R7 | FACT | `AuthInterceptor` fails closed (no annotation = 403) and audits denials and sensitive reads. Caller identity is only a browser session cookie today. | `JAVA/authz/AuthInterceptor.java` 13-64; `JAVA/authz/AuthResolver.java` | Add one more resolver branch for `Authorization: Bearer <api key>`. |
| R8 | FACT | Helpers: `BetterAuthCrypto.hmacBase64`, `sha256Hex`, `randomId`; `Notifications.seal/open` (AES-256-GCM, key derived from `BETTER_AUTH_SECRET`, `v1.` prefix, `open` is package-private). | `JAVA/auth/BetterAuthCrypto.java` 36-71; `JAVA/notify/Notifications.java` 48, 75-97 | HMAC for webhook signing; seal pattern for credentials, but with its own key (see 3.7). |
| R9 | FACT | Keyset pagination (`Cursor`), strict input validation (`Input`), error shape `{code, message, request_id, errors?}`. | `JAVA/platform/Cursor.java`, `Input.java`, `ApiError.java` | The public API uses the same three. |
| R10 | FACT | CSV import already normalises phones India-first, maps ISO country codes, and returns per-row issue codes; confirm inserts with a savepoint per row. | `JAVA/hiring/CandidateImport.java`; `JAVA/hiring/Candidates.java` 147-180 | API upsert and ATS sync call the same validation path, so there is one set of rules for every intake. |
| R11 | FACT | `candidates.source` allows only `manual`/`resume`; no external id on jobs or candidates; candidate rows are job-scoped (one row per person per job). | `MIG/0015_hiring_desk_foundation.sql` line 20; `MIG/0018_job_scoped_candidates.sql` | Our job-scoped candidate row is the same shape as an ATS "application" (person × job). That makes the mapping simple: ATS application id ↔ our candidate id. |
| R12 | FACT | `PhoneNumbers.toE164` reads only `candidates.phone`, ignoring `country_code`; CSV import stores national digits in `phone`. | `JAVA/engine/PhoneNumbers.java` 8-20; backend map §9 | ATS feeds usually carry E.164 numbers. Pick one stored form before automated intake, or imported non-Indian numbers will dial wrongly (found by reading, not tested). |
| R13 | FACT | `usecases/hiring.json` has `"actions": {"webhook": false, "followUp": false}`. | `apps/api-java/src/main/resources/usecases/hiring.json` lines 122-129 | The use-case flag that turns customer webhooks on, so integrations stay use-case-agnostic (support, sales later). |
| R14 | FACT | The spec already fixes the direction: "future customer API access uses hashed, scoped, revocable API keys bound to an organization", and an `Integration` entity with `credential_reference` and the note "Do not store provider secrets as ordinary plaintext". | `BRD's/04_DATABASE_API_SPEC.md` lines 303-316, 410, 529-533 | Follow it; it matches the research below. |
| R15 | FACT | Compute must be in an Indian region. | `BRD's/10_ADRs/ADR-006-hosting-deployment.md` line 55 | Relevant to buying a unified API that would copy candidate PII to its own (non-Indian) infrastructure. |

### 2.2 ATS and HR systems: what their developer docs actually say

#### Greenhouse (Harvest, webhooks, Ingestion, Assessment)

- **FACT.** Harvest v1/v2 were "deprecated and unavailable after August 31, 2026"; v3 uses "OAuth 2.0 client credentials (client ID and client secret)", and "Site Admins must create API credentials, assign endpoint permissions" in the Dev Center. Source: https://support.greenhouse.io/hc/en-us/articles/360029266032-Harvest-API-overview
- **FACT.** Third-party products integrate through a partner OAuth authorization-code flow: "you must have a signed Greenhouse partnership agreement"; authorize at `https://auth.greenhouse.io/authorize`, token at `https://auth.greenhouse.io/token`; authorization code lives 1 minute, access token 1 hour, refresh token 14 days; scopes look like `harvest:candidates:list`. PKCE is not mentioned. Source: https://harvestdocs.greenhouse.io/docs/harvest-partner-oauth.md
- **FACT.** v3 rate limiting is a fixed 30-second window, reported in `X-RateLimit-Limit/Remaining/Reset`, with HTTP 429 and `Retry-After`; no guaranteed number is published. v3 uses cursor pagination. Sources: https://harvestdocs.greenhouse.io/docs/api-rate-limiting.md, https://harvestdocs.greenhouse.io/
- **FACT (secondary).** v3 drops the `On-Behalf-Of` user impersonation of v1/v2; actions are attributed to the user who authorised the connection, and vendors advise authorising with a service account so the link survives staff leaving. Source: https://100hires.com/greenhouse-api.html and vendor migration notes found by search (Findem, HackerRank, Prismatic). unverified in Greenhouse's own docs.
- **FACT.** Webhooks are configured per account by an admin (name, HTTPS URL, secret key). Signature header `Signature: sha256 <hexdigest>`, HMAC-SHA256 over the body (no timestamp). Retries: 7 attempts over about 15 hours. Each delivery carries a `Greenhouse-Event-ID`. Payloads contain full nested objects. Source: https://docs.greenhouse.io/webhooks.html
- **FACT.** The Candidate Ingestion API is for "sourcing partners"; it can submit candidates and read their status and stage. Source: https://docs.greenhouse.io/candidate-ingestion.html
- **FACT.** The Assessment Partner API is the reverse direction: Greenhouse calls the partner's `list_tests`, `send_test`, `test_status` endpoints; results include `partner_status`, an optional numeric `partner_score`, and a `partner_profile_url`. Source: https://docs.greenhouse.io/assessment.html
- **RECOMMENDATION.** The Assessment Partner model is the most natural fit for HRVoice inside Greenhouse ("send this candidate a phone screen" from the ATS, results link back), but only if `partner_score` is always left empty and the profile URL opens our evidence page. It needs a partnership agreement, so it is **Later**.
- **ASSUMPTION.** Greenhouse is rare among Indian SMB hiring teams; it matters for funded startups and Indian offices of foreign companies. No data in the repo.

#### Lever

- **FACT.** API key (Basic auth) is for customers' internal workflows; "OAuth is part of our partner integration program, and apps must be registered". Access tokens expire after 1 hour; refresh tokens "after one year or after 90 days of inactivity"; the authorize URL needs an `audience` parameter. Rate limit "10 requests/second per API key", bursts to 20. Offset-style pagination with `next`/`hasNext`, max 100. Webhook events include `applicationCreated`, `candidateStageChange`, `candidateHired`; signature is HMAC-SHA256 over `token + triggeredAt` with the signing token; Lever retries five times with growing delays. Super Admins can revoke an app. Sources: https://hire.lever.co/developer/documentation, https://hire.lever.co/developer/oauth
- **FACT (secondary).** Partner credentials are issued by Lever staff after a partnership form; a Lever sandbox is required first; up to 20 scopes; notes go to `POST /opportunities/:id/notes` with optional `perform_as`. Source: https://www.getknit.dev/blog/lever-api-directory, https://truto.one/blog/how-to-integrate-with-the-lever-api-2026-engineering-guide

#### Workday

- **FACT (secondary).** Workday exposes SOAP (Workday Web Services), REST and RaaS (report-as-a-service, read-only). Integrations run as an Integration System User (ISU) in an integration security group with domain permissions; OAuth uses a "Register API Client for Integrations" client with a non-expiring refresh token generated for the ISU; RaaS does not paginate. Workday's own documentation is behind a customer login. Sources: https://docs.workato.com/en/data-orchestration/data-pipeline-recipe/configure-workday-raas, https://bindbee.dev/blog/workday-api-architecture-soap-vs-rest-vs-raas-isu-setup-and-domain-security
- **RECOMMENDATION.** Avoid for the first customers. Every Workday connection needs the customer's Workday admin to create an ISU, a security group and an API client. That is an enterprise project, not an SMB self-serve flow.

#### Zoho Recruit (Indian SMB favourite; Zoho is an Indian company)

- **FACT.** API v2 uses OAuth 2.0 authorization code grant, JSON only, with separate domains per data centre including India `https://recruit.zoho.in/`; the authorization response includes a `location` parameter that tells you which domain to call. `GET` responses carry `info.more_records` with `page`/`per_page` (default 200). Credits are counted over a rolling 24 hours, with per-user-per-app concurrency limits. Source: https://www.zoho.com/recruit/developer-guide/apiv2/whats-new.html
- **FACT.** Plan comparison: Free 5,000 API credits/day and no webhooks; Standard up to 100,000 credits/day, no webhooks; Professional up to 500,000 credits/day and webhooks 10,000 calls/day; Enterprise up to 1,000,000 credits/day and webhooks 20,000 calls/day. Source: https://www.zoho.com/recruit/plan-comparison.html
- **FACT (secondary).** Webhooks are set up by the customer's admin as a Workflow Rule action (Setup → Automation → Webhooks); I found no documented push-subscription ("watch") API for Recruit like Zoho CRM's. Sources: https://leadsbridge.com/documentation/zoho-recruit/webhook/; search of zoho.com found `actions/watch` only for CRM (https://www.zoho.com/crm/developer/docs/api/v8/notifications/enable.html). unverified for Recruit.
- **FACT.** Kombo's Zoho Recruit connector supports OAuth, delta syncs, creating candidates and applications, "Move application to stage", "Add note to application", attachments; limitation: custom application stages on paid plans "are not available through the public API". Source: https://docs.kombo.dev/ats/connectors/zohorecruit
- **RECOMMENDATION.** Best first named connector if the founder's pilots use it: self-serve OAuth, India DC, free test account, documented REST, and a known limitation list. Plan for polling (webhooks need Professional+ and admin setup).

#### Keka (Keka Hire)

- **FACT.** Public docs list Hire endpoints: get jobs, get job candidates (with a `lastModified` filter, page size up to 200), post a job candidate, update a candidate, add candidate notes, get interviews, get scorecards, get/upload resume. Token endpoint `https://login.keka.com/connect/token` (sandbox `login.kekademo.com`) with `client_id`, `client_secret`, `api_key`, scope `kekaapi`. Rate limit "50 requests/minute". Sources: https://developers.keka.com/llms.txt, https://developers.keka.com/reference/authentication.md, https://developers.keka.com/reference/rate-limit.md
- **FACT (secondary).** API access is a paid add-on enabled by Keka's account manager ("API & Webhooks Add-On"); only a Global admin can create API keys; a sandbox needs Keka's partner programme (MSA + NDA) or a paid app-portal account. Webhooks in Keka are admin-configured "event trigger" actions; I could not confirm any Hire (candidate/stage) trigger. Sources: https://help.keka.com/hc/en-us/articles/39946790747665-Getting-Started-with-Keka-API, https://developers.apideck.com/apis/hris/keka/overview, https://help.keka.com/admin/knowledge/configuring-webhooks
- **RECOMMENDATION.** V2 or later, polling only, and only for a paying customer who already has the add-on. 50 requests/minute is enough for one SMB's daily candidates, but our worker must throttle per connection. Never write to scorecards.

#### Darwinbox

- **FACT (secondary).** Official docs at https://api-docs.darwinbox.com/; "API access is provided on a request-only basis"; credentials (username, password, API key) come through Darwinbox Studio or the client's Darwinbox account manager. Recruitment endpoints include Fetch Job List V3 and Bulk Candidates Data V3 with `updated_from`/`updated_to` filters, Reject Candidate V3, Add Tags. Webhooks are built per customer in Darwinbox Studio API Builder. Sources: https://getknit.dev/blog/a-to-z-of-integrating-with-darwinbox-api/, https://www.getknit.dev/blog/get-job-application-data-from-darwinbox-ats-api-using-python
- **RECOMMENDATION.** Later. Mid-market and enterprise; every connection is a services engagement.

#### Naukri RMS

- **FACT (absence).** I found no public developer documentation for Naukri RMS; directories only say the "Custom" plan includes API integration. Sources: https://www.capterra.com/p/169303/Naukri-RMS/, https://www.softwaresuggest.com/naukri-rms
- **RECOMMENDATION.** Do not plan a connector. If a customer uses Naukri RMS, use the generic API/webhooks with their RMS team, or CSV.

#### Freshteam

- **FACT (secondary, consistent across several news sources).** Freshworks announced on 7 January 2026 that it is ending Freshteam and stopping renewals from 7 March 2026; access lasts until each subscription ends. Source: https://www.peoplematters.in/news/business/freshworks-to-end-freshteam-hr-product-stop-renewals-from-march-2026-47939
- **RECOMMENDATION.** Avoid. Customers on Freshteam are migrating away; build nothing.

#### greytHR

- **FACT.** greytHR's API v2 is documented for employee, leave, attendance and salary data; I found no recruiting endpoints. Sources: https://api-docs.greythr.com/, https://greythr-api-docs.readthedocs.io/
- **RECOMMENDATION.** N/A for intake. Possibly relevant much later as an HRIS destination for hired people, which is outside HRVoice.

#### Workable

- **FACT.** Account tokens are generated in the UI with scopes and shown once; rate limits per 10 seconds: account tokens 10, OAuth tokens 50, partner tokens 50, with `X-Rate-Limit-*` headers and 429. Webhook subscriptions are created by API (`POST /subscriptions`); events include Candidate Created, Candidate Moved; signature is HMAC-SHA256 of the payload in `X-Workable-Signature`, keyed by the account token or OAuth app secret; the payload reflects current state, not the state at event time. Sources: https://workable.readme.io/reference/generate-an-access-token, https://workable.readme.io/reference/rate-limits, https://workable.readme.io/reference/webhook-subscriptions-candidates-employees.md
- **RECOMMENDATION.** A good candidate for a second connector if any customer uses it: subscriptions can be created by API, so "connect once" needs no admin clicking in Workable.

#### Recruitee

- **FACT.** Personal API tokens (Bearer) carry the generating user's permissions; base URL `https://api.recruitee.com/c/{company_id}/`. Webhooks are configured in Settings by users with "Manage webhooks"; `X-Recruitee-Signature` is hex HMAC-SHA256 of the body; non-200 counts as failure; up to nine retries from 1 minute to 48 hours; 10-second timeout; delivery logs kept 30 days; stage moves arrive as `event_type: candidate_moved`, `event_subtype: stage_changed` with `from_stage`/`to_stage`. Sources: https://docs.recruitee.com/reference/getting-started, https://docs.recruitee.com/docs/webhooks

#### Summary table

| System | Auth for a third party like us | Self-serve for us? | Read new applicants | Push to us | Write back | Free/trial test access |
|---|---|---|---|---|---|---|
| Zoho Recruit | OAuth code grant, per DC | Yes (Zoho API console) | Polling, `page/per_page` | Workflow webhook (Professional+) | Notes, stage (standard stages only per Kombo) | Free plan, 5,000 credits/day |
| Keka Hire | Client creds + customer API key | No (paid add-on) | `lastModified` poll | unverified for Hire | Notes, candidate update | Sandbox via partner MSA |
| Darwinbox | User + password + API key | No (on request) | `updated_from` poll | Studio webhooks, per customer | Tags, reject | None found |
| Naukri RMS | unverified | No | unverified | unverified | unverified | None found |
| Freshteam | n/a (sunset) | n/a | n/a | n/a | n/a | n/a |
| greytHR | API user client token | Yes | No recruiting API | No | No | unverified |
| Greenhouse | Partner OAuth (v3) | No (partnership) | Cursor poll | Admin webhooks, 7 retries | Notes, stage, attachments | Partner sandbox |
| Lever | Partner OAuth | No (partnership) | Offset poll | API-created webhooks | Notes, stage | Sandbox needed |
| Workable | Token or OAuth/partner | Token yes | Poll | API-created subscriptions | Yes | Trial (unverified) |
| Recruitee | Personal token | Yes | Poll | Admin webhooks, 9 retries | Yes | Trial (5 req/min limit for trial companies) |
| Workday | ISU + API client | No (customer admin project) | RaaS / REST | No standard push | SOAP/REST | None |

### 2.3 Patterns from the best-documented platforms (Stripe, Slack, HubSpot, Salesforce)

- **FACT (Stripe).** `Stripe-Signature: t=<ts>,v1=<hmac>`; signed payload is `timestamp + "." + raw body`; libraries default to a 5-minute tolerance; ignore schemes other than `v1`; constant-time compare; on secret roll both secrets sign for up to 24 hours; live-mode retries for up to three days with exponential backoff; order is not guaranteed and duplicates happen, so dedupe by event id; return 2xx before doing work; process asynchronously from a queue. Source: https://docs.stripe.com/webhooks
- **FACT (Stripe).** `Idempotency-Key` on POST; the first result (even a 500) is replayed for the same key; keys can be pruned after 24 hours; reusing a key with different parameters is an error. Source: https://docs.stripe.com/api/idempotent_requests
- **FACT (Slack).** Respond within three seconds or Slack retries (three retries: immediately, after 1 minute, after 5 minutes) with `x-slack-retry-num`; subscriptions are disabled if more than 95% of deliveries fail within 60 minutes (apps under 1,000 events/hour are exempt). Source: https://docs.slack.dev/apis/events-api/
- **FACT (Slack).** With token rotation, access tokens expire after 12 hours and each refresh token is single-use. Source: https://docs.slack.dev/authentication/using-token-rotation/
- **FACT (HubSpot).** Public OAuth apps: 110 requests per 10 seconds per installed account; access tokens last 30 minutes; webhook signature v3 is HMAC-SHA256 over `method + uri + body + timestamp`, base64, reject if older than 5 minutes. Sources: https://developers.hubspot.com/docs/api/usage-details, https://developers.hubspot.com/docs/api/oauth-quickstart-guide, https://developers.hubspot.com/docs/api/webhooks/validating-requests
- **FACT (Salesforce).** Platform events and Change Data Capture events are retained for 72 hours, and subscribers resume from a stored opaque replay id. Source: https://developer.salesforce.com/docs/platform/pub-sub-api/guide/event-message-durability.html
- **FACT (Salesforce, secondary summary of Salesforce help).** From Spring '26, customers cannot create new connected apps by default; new integrations must use External Client Apps. Source: https://help.salesforce.com/s/articleView?id=005228017&language=en_US&type=1
- **FACT (Standard Webhooks).** Headers `webhook-id`, `webhook-timestamp`, `webhook-signature`; signed content `msg_id.timestamp.payload`; signature `v1,<base64 HMAC-SHA256>`; secrets 24-64 bytes with `whsec_` prefix; consumers dedupe on `webhook-id`; retry schedule spans several days; payloads ideally under 20 KB; send through an SSRF-filtering proxy; notify and disable endpoints that keep failing. Source: https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md
- **RECOMMENDATION.** Our outbound webhooks should copy Standard Webhooks exactly rather than invent a scheme. It is Stripe's scheme with a message id added, it has receiver libraries in many languages, and our existing `BetterAuthCrypto.hmacBase64` already computes the HMAC part.
- **RECOMMENDATION.** Copy the Salesforce/Stripe "events you can re-read" idea: keep our outbox rows for a fixed window (for example 30 days) and expose `GET /v1/events?after=<cursor>`. Customers who miss webhooks, or who cannot receive them (no public URL), poll the same feed. One table serves both push and pull.

### 2.4 OAuth 2.0 and token management (when we are the client of an ATS)

- **FACT.** RFC 9700 (OAuth 2.0 Security Best Current Practice, January 2025): public clients MUST use PKCE and it is RECOMMENDED for confidential clients; authorization servers MUST support PKCE; exact redirect URI matching; one-time CSRF protection via `state`; refresh tokens for public clients MUST be sender-constrained or rotated; the password grant MUST NOT be used; access tokens SHOULD be audience- and privilege-restricted. Source: https://datatracker.ietf.org/doc/html/rfc9700
- **FACT.** RFC 7009: a revocation endpoint; revoking a refresh token SHOULD also invalidate access tokens from the same grant. Source: https://datatracker.ietf.org/doc/html/rfc7009
- **FACT.** Vendors differ: Greenhouse refresh tokens last 14 days; Lever refresh tokens expire after one year or 90 days idle; Slack rotating refresh tokens are single-use; Zoho uses per-data-centre accounts servers. Sources above.
- **RECOMMENDATION (multi-tenant token handling).**
  1. Authorization code + PKCE (S256) + `state` even though we are a confidential client (RFC 9700 recommends it; costs nothing). Store `state` and `code_verifier` server-side, keyed to the signed-in member and org, single-use, 10-minute expiry.
  2. One row per connection holds the sealed refresh token, access token, expiry, granted scopes, the external account id and (Zoho) the data-centre domain.
  3. Refresh under `Db.underAdvisoryLock(connectionId)` so two workers never redeem the same rotating refresh token at once (Slack and Lever rotate; a race would log the customer out).
  4. On `invalid_grant`, mark the connection `needs_reconnect`, stop its jobs, show it in Settings and email the admins through the existing `Notifications` email job. Do not retry an invalid grant.
  5. Refresh proactively in the sync job when the token is within 5 minutes of expiry, and before Greenhouse's 14-day refresh window closes (a daily light sync is enough to keep it alive).
  6. On disconnect, call the vendor's revocation endpoint where one exists, then delete the sealed tokens.
  7. Record who connected (member id) and with what scopes in audit, because several vendors attribute API actions to the authorising user (Greenhouse v3, Recruitee tokens).

### 2.5 MCP (Model Context Protocol)

- **FACT.** The latest specification revision is `2026-07-28`. Authorization is optional; for HTTP transports it is OAuth 2.1-based: MCP servers MUST publish OAuth 2.0 Protected Resource Metadata (RFC 9728); clients MUST use PKCE with S256 and the RFC 8707 `resource` parameter; servers MUST validate that tokens were issued for them and MUST NOT pass tokens through; Dynamic Client Registration is now deprecated in favour of Client ID Metadata Documents; STDIO servers "SHOULD NOT" use this flow and should read credentials from the environment. Sources: https://modelcontextprotocol.io/specification/latest, https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization
- **FACT.** The repo's launch spec already says MCP is "not day-one" and a "façade later" over stable org-scoped APIs. Source: `docs/superpowers/specs/2026-09-16-hiring-production-launch-design.md` lines 12, 71-72.
- **RECOMMENDATION.** A remote MCP server means running our own OAuth authorization server (metadata, PKCE, client metadata documents, token audience checks). That is more work than the whole MVP below. Order: public API with API keys first; an optional local (STDIO) MCP wrapper that reads an API key from the environment is cheap and can come in V2 for customers who use AI assistants; a remote, OAuth-protected MCP server is Later. MCP does not help with the founder's core loop (ATS → calls → ATS), which is server-to-server.

### 2.6 Unified APIs (build vs buy)

- **FACT.** Merge: 3 production linked accounts free; Launch $650/month for up to 10, $65 per extra; higher tiers by quote. Source: https://www.merge.dev/pricing
- **FACT (secondary).** Merge lists Zoho Recruit as an ATS; Keka and Darwinbox appear only as HRIS (Darwinbox as a beta needing enablement). Kombo supports Zoho Recruit with write-back; I found no Keka or Darwinbox ATS connector at Kombo. Sources: https://www.merge.dev/integrations/zoho-recruit, https://docs.merge.dev/merge-unified/hris/integrations/keka, https://docs.kombo.dev/ats/connectors/zohorecruit, https://docs.kombo.dev/ats/connectors
- **ASSUMPTION / unverified.** Where Merge and Kombo store synced candidate data, and whether they offer an India region. ADR-006 makes India-region compute a hard requirement for us; a unified API copies candidate PII to the vendor's infrastructure, which needs checking against customer contracts and India's data-protection law before any purchase.
- **RECOMMENDATION.** Do not buy now: it does not cover the Indian systems we need most, it adds a per-customer cost at our smallest-customer stage, and it adds a data-residency question. Our adapter port (3.8) keeps the door open: a unified API can later be "one more adapter".

---

## 3. Proposed architecture (all RECOMMENDATION unless labelled)

### 3.1 Shape

```
Customer system (ATS / CRM / own app / Zapier, Make, n8n)
   |  API key: POST /v1/jobs, /v1/candidates (upsert by externalId)      <- MVP
   |  ATS adapter pulls on a schedule / on vendor webhook                  <- V2
   v
HRVoice API (apps/api-java) -- same AuthInterceptor, same Db.inOrg, same validation as CSV import
   |  human clicks Call (today) / per-job auto-call (V2, after consent decision)
   v
Voice call -> VoiceSessions.apply -> outbox row (same transaction) -> background_jobs kind 'webhook'
   |                                                                    |
   |  GET /v1/events?after=, GET /v1/candidates/{id}/results  (pull)   |  signed POST (push)  <- MVP
   v                                                                    v
Customer system / ATS adapter writes a note + a human-mapped stage   <- V2
```

### 3.2 Data model additions (smallest set)

| Table / change | Purpose | Phase |
|---|---|---|
| `jobs.external_source text, jobs.external_id text`, unique `(organization_id, external_source, external_id)` where not null | Upsert jobs by the customer's id | MVP |
| `candidates.external_source, candidates.external_id`, unique `(organization_id, external_source, external_id)` where not null; widen `source` check to add `'api'` and `'integration'` | Upsert candidates by the customer's application id; show where a person came from | MVP |
| `api_keys (id, organization_id, name, prefix, secret_hash, permissions text[], created_by_user_id, last_used_at, expires_at, revoked_at, created_at)` under RLS, plus a narrow lookup policy by `prefix` | Machine callers | MVP |
| `integration_events (id, organization_id, seq bigserial, type, subject_type, subject_id, dedupe_key, payload jsonb, created_at)` unique `(organization_id, dedupe_key)` | Transactional outbox, dedupe, events feed | MVP |
| `webhook_endpoints (id, organization_id, url, event_types text[], include text[], secret_sealed, status, created_by_user_id, failing_since, created_at)` | Where to push | MVP |
| `webhook_deliveries (id, organization_id, event_id, endpoint_id, attempts, last_status, last_error, delivered_at)` unique `(event_id, endpoint_id)` | Delivery log shown in Settings | MVP |
| `background_jobs.kind` check widened to add `'webhook'` (MVP) and `'sync'` (V2); `JobQueue.POLICY` entries | Reuse the queue | MVP / V2 |
| `integration_connections (id, organization_id, provider, status, account_ref, data_centre, credentials_sealed, key_version, scopes, settings jsonb (field + stage mapping, job filter), cursor jsonb, last_synced_at, last_error, created_by_user_id)` plus a narrow lookup policy for its inbound webhook | Vendor connectors | V2 |

Why columns and not a generic link table: our candidate row is already job-scoped, which is exactly an ATS "application", so one `(external_source, external_id)` pair per row covers it; a link table would add a join to every read for no gain. `external_source` is `'api'` for API-key callers and the provider name for connectors.

### 3.3 Machine authentication: API keys as service principals (MVP)

- Format `hv_live_<prefix>_<secret>`; store `sha256(secret)` (as invitation tokens already are, `Db.withInvitationToken`); show the full key once.
- The key's `permissions` are a subset of the creating member's permissions at creation time (the same rule custom roles already enforce, `MIG/0024_custom_role_permissions.sql`). Creating a key needs `integrations.create`; it is audited.
- `AuthResolver` gains a second branch: `Authorization: Bearer hv_...` → look up by prefix through a narrow policy → constant-time hash compare → an `Actor` with `orgId`, `userId = Db.NIL`, `apiKeyId`, and the key's permission set. `AuthInterceptor` then runs unchanged, so `@RequirePermission`, PII omission and `authz.sensitive_access` audit all apply. Audit rows carry `api_key_id` in metadata.
- **ASSUMPTION.** `Actor` and `Tools` assume a member exists (backend map §13); the key path must not reach tool execution until a system principal is modelled. The public routes below never call tools.
- OAuth client-credentials for customers (machine tokens from us) is **Later**; API keys are simpler and are what the spec already chose (`BRD's/04_DATABASE_API_SPEC.md` line 410).

### 3.4 Public REST API v1 (MVP, deliberately small)

| Route | Permission | Notes |
|---|---|---|
| `GET /v1/jobs`, `PUT /v1/jobs/by-external/{source}/{externalId}` | jobs.read / jobs.create+update | Upsert title, description, status, questions. `PUT` on the natural key is idempotent by design, so no idempotency-key store is needed. |
| `PUT /v1/jobs/{jobId}/candidates/by-external/{externalId}` | candidates.create+update | Body like `/import/confirm` rows plus optional `resumeText`. Runs the same validation as CSV import (R10). Returns the row and any issues. |
| `POST /v1/jobs/{jobId}/candidates:batch` | candidates.create | Up to 200 rows, per-row results, savepoint per row (reuse `Candidates` confirm logic). |
| `GET /v1/candidates/{id}/results` | candidates.read (+ calls.read_transcript for content) | Same body as the web's results route but **without** the provider reconcile side effect and **without** `fitPercent`. |
| `GET /v1/events?after=<cursor>&types=` | per event type | Reads `integration_events`; keyset on `seq`; 30-day window. |
| `POST /v1/candidates/{id}/calls` | calls.initiate | **V2**, after the consent/DND decision (see 4.13). |

Conventions: keyset pagination with `limit` 1-200 and an opaque `cursor` (reuse `Cursor`); errors in the existing `ApiError` shape with stable `code` values; dates in ISO-8601 UTC; `429` with `Retry-After` from a per-key limit next to the existing per-IP limit in `EdgeFilter`; a hand-written OpenAPI file for these six routes (add `springdoc` only when the API grows past roughly 15 routes). Version in the path (`/v1`) and never change a field's meaning inside a version.

### 3.5 Outbox and outbound webhooks (MVP)

1. In the same `inOrg` transaction as the business write, insert into `integration_events` with `on conflict (organization_id, dedupe_key) do nothing`:
   - `result.ready` and `call.ended` in `VoiceSessions.apply`, dedupe key `"<type>:<voiceSessionId>"`. This fixes R4/R5: repeated `apply` runs cannot create a second event.
   - `candidate.stage_changed` in the stage-change handlers, dedupe key `"stage:<candidateId>:<auditEventId or change timestamp>"`. Moving the stage update and its event into one transaction also fixes the backend map's note that the stage update and its audit row are separate transactions today.
2. In that same transaction, insert one `background_jobs` row (`kind='webhook'`) per subscribed endpoint, with idempotency key `"<eventId>:<endpointId>"`. This needs a `JobQueue` variant that takes the caller's open `Db.Sql` instead of opening its own scope; that is the whole "transactional outbox": no relay process, no new queue.
3. The handler loads the endpoint and event, builds the payload, signs it with Standard Webhooks headers, POSTs with a 10-second timeout, and records the result in `webhook_deliveries`. 2xx = done; 408/429/5xx/network = throw (queue retries); other 4xx = record and stop. With `max_attempts = 20` and the existing 3600 s cap, retries span roughly 14 hours; the events feed covers anything longer.
4. After the final attempt fails, mark the endpoint `failing`; after 3 consecutive dead deliveries, disable it and email the admins (Standard Webhooks and Slack both disable failing endpoints).
5. Payload: `{id, type, createdAt, data}` where `data` carries our ids **and the customer's `externalId`s**, the call status, `failureReason`, timestamps, duration, and, only if the endpoint's `include` list has them and the creator held the permission when saving it, `summary` and `answers` (`calls.read_transcript`) and `contact` fields (`candidates.read_pii`). Transcript and recording are links back to our app, never inline. Never `fitPercent`.
6. Security: HTTPS only; resolve the host and refuse private, loopback and link-local addresses at send time (SSRF, per Standard Webhooks); rotate secrets with an overlap window like Stripe (sign with old and new for 24 hours); a "Send test event" button.
7. Turn on `actions.webhook` in `usecases/hiring.json` (R13) and read it before enqueueing, so the same code serves later use cases.

### 3.6 Inbound webhooks from ATS vendors (V2, with the first connector)

- Route `POST /webhooks/integrations/{connectionId}`, `@Public`, raw `byte[]` body (as the voice webhook does). The adapter verifies the vendor's scheme (Greenhouse `Signature: sha256 <hex>` over the body; Lever HMAC over `token + triggeredAt`; Workable `X-Workable-Signature`; Recruitee `X-Recruitee-Signature`; Zoho workflow webhooks support custom parameters, so put a per-connection secret token in the URL or a header; exact Zoho signing options unverified).
- Treat the webhook as a **trigger, not the data**: insert a `sync` job for that connection and return 200 within milliseconds (Slack's 3 s and Recruitee's 10 s timeouts). The sync job then reads the current state through the API. This survives missed, duplicated and out-of-order webhooks (Stripe, Workable and Greenhouse all warn about these) and makes webhook support optional per vendor.
- Dedupe by the vendor's event id where one exists (`Greenhouse-Event-ID`); otherwise the sync job's own idempotency key is enough.
- Greenhouse's body-only HMAC has no timestamp, so there is no replay window; the trigger-only design makes a replay harmless.

### 3.7 Credential storage

- Generalise `Notifications.seal/open` into one small `Secrets` helper: AES-256-GCM, 12-byte IV, output `v<keyVersion>.<base64>`, key from a **new** env var (`INTEGRATIONS_ENCRYPTION_KEY`, with `..._V2` added on rotation), never derived from `BETTER_AUTH_SECRET` (rotating the auth secret already risks losing sealed mail, `apps/api-java/MIGRATION_STATUS.md` line 358).
- Used for ATS refresh/access tokens, vendor API keys, and our outbound webhook signing secrets (these must be recoverable to sign, so they are sealed, not hashed). Our own API keys are hashed, not sealed.
- Do not reuse the Better Auth `accounts.access_token/refresh_token` columns; they are plaintext (`MIG/0000_initial_schema.sql` lines 1-15).
- A KMS is Later; one env key with a version prefix is enough for a single-region, two-to-three-person team.

### 3.8 ATS adapter port (V2)

- One Java interface, modelled on the existing `VoicePorts` rule that business code depends on ports and the adapter is the only place a vendor API is called (`JAVA/voice/VoicePorts.java` lines 7-10), and on the unbuilt TypeScript `CRMProvider` (`packages/providers/src/interfaces.ts` 229-253), extended to read:
  - `listJobs(conn, cursor)` → jobs with external ids
  - `listApplications(conn, jobRef, cursor)` → name, phone, email, optional resume text, external application id, updated time, next cursor
  - `addNote(conn, applicationRef, text, idempotencyKey)`
  - `moveStage(conn, applicationRef, externalStageId, idempotencyKey)`
- One adapter per vendor, behind the port. No vendor names outside adapters, user-facing errors in plain words (`apps/web/lib/errors.ts` line 77 filters words like "webhook" and "token").
- Error handling: honour `Retry-After` and `X-RateLimit-*` (Greenhouse, Workable) and a per-connection request budget for vendors that only publish a number (Keka 50/minute, Lever 10/s); 401 → refresh once, then `needs_reconnect`; 404 on a mapped record → unlink and log; 5xx → retry through the queue.

### 3.9 Sync engine (V2, minimal)

- No generic engine. One `@Scheduled` loop (like `JobQueue.poll`) selects connections whose `last_synced_at` is older than their interval (default 15 minutes) and enqueues `sync` jobs with idempotency key `"sync:<connectionId>"`. Vendor webhooks enqueue the same job early.
- Direction rules, to avoid sync loops: **jobs and candidate contact details flow in only** (the ATS is the system of record); **results and human stage decisions flow out only** (HRVoice is the system of record for calls). Nothing is synced in both directions, so there are no merge conflicts to resolve. A local edit to an imported candidate's phone is overwritten on the next sync unless the ATS changed nothing; show the source on the candidate sheet so people know where to edit.
- Which jobs to import: only jobs the customer ticks in the connection settings (or a stage filter such as "Applied"), never the whole ATS.
- Deletions: if the ATS deletes or anonymises an application (Greenhouse sends anonymize events), delete or anonymise our row.

### 3.10 Write-back content (V2)

- A note/activity on the ATS application per ended call: outcome in words ("Call completed, 6 of 7 questions answered" is a coverage count, not a score; ASSUMPTION that the product owner accepts this wording, otherwise list answers only), the advice-scrubbed summary, each must-ask question with its answer, and a link to the recording/transcript in HRVoice.
- A stage move only when a person changes the stage in HRVoice, through the customer's own mapping (our `reviewed` → their "Phone screen passed"), with that person's name in the note. Never move a stage on call completion alone.
- Never write to score, rating, scorecard, assessment-score or "recommendation" fields (Greenhouse `partner_score`, Keka scorecards).

### 3.11 Settings UX (MVP surface)

- A new Settings tab gated by `integrations.read` (create/update/delete by the existing `integrations.*` permissions); unhide the Integrations group in `apps/web/components/settings/access.ts` line 109.
- Sections: "API keys" (create, copy once, revoke, last used), "Send results to your system" (endpoint URL, events, what to include, test event, last 50 deliveries with status), later "Connected systems" (Connect Zoho Recruit → OAuth → pick jobs → map stages → status line "Last synced 5 minutes ago").
- Rename the agent page's existing "Integrations" label for test tools first (`apps/web/app/agents/[id]/page.tsx` 700-735), as the product map recommends.

---

## 4. Positions by topic

| Topic | Phase | Position | Rationale | Concerns |
|---|---|---|---|---|
| REST API | MVP | Six-route `/v1` API: upsert jobs and candidates by external id, batch candidates, results, events feed. Same interceptor, validation, pagination and error shape as today. | It is the universal connector: any ATS with webhooks/automation, any custom app, Zapier/Make/n8n can use it. Reuses R6, R7, R9, R10. | Must not expose `fitPercent` or the provider-reconcile side effect. Keep the surface small; every route is a promise. |
| OAuth | V2 (as client) / Later (as server) | Implement the OAuth client side (code + PKCE + state, sealed rotating tokens, advisory-locked refresh, revoke on disconnect) with the first connector. Do not run our own authorization server until a remote MCP server or a marketplace listing needs it. | Every useful ATS needs us as an OAuth client (Zoho, Greenhouse v3, Lever). Being a server is a large security surface (RFC 9700, MCP auth). | Per-DC Zoho domains; Greenhouse 14-day refresh expiry; rotating refresh tokens race without a lock. |
| API keys | MVP | Org-scoped, hashed, prefix-identified, permission-subset keys; shown once; revocable; last-used tracking; audited. | Already the documented decision (spec line 410); smallest machine auth that fits `AuthInterceptor`. | Keys leak into scripts; add expiry option and show last use. `Actor`/tools assume a human member. |
| Service accounts | MVP (as API keys) | Model the machine principal as "API key with permissions", `userId = Db.NIL`, not as a fake user row. | Avoids fake members in team lists and licence counts; reuses the NIL system actor already used by queue workers. | Audit `actor_user_id` is null for these; put `api_key_id` in metadata so actions stay traceable. On the vendor side, advise customers to authorise ATS connections with an ATS service user (Greenhouse v3 attribution). |
| Webhooks | MVP (outbound) / V2 (inbound) | Outbound: Standard Webhooks signing, transactional outbox, `background_jobs` delivery, delivery log, test button, auto-disable. Inbound: per-connection URL and secret, verify, enqueue a sync, return 200; webhook is a trigger, not the data. | Push is the founder's "results flow back automatically". Industry practice (Stripe, Slack, Standard Webhooks) is consistent. | SSRF on customer URLs; PII in payloads (gate by permissions at endpoint creation); 3600 s backoff cap limits the retry window to ~14 h. |
| SDK / embedded | Avoid (now) / Later | No SDKs, no embeddable widget. Publish an OpenAPI file and copy-paste signature-verification snippets; Standard Webhooks already has libraries. | Two to three people cannot maintain SDKs in several languages. Candidates never see the product, so there is nothing to embed for them. | Revisit if an ATS marketplace requires an embedded panel (Greenhouse/Lever partner apps). |
| MCP | Later (remote) / V2 (local STDIO wrapper, optional) | Facade over `/v1` only after it is stable. Local STDIO server with an API key from the environment is cheap; remote needs OAuth 2.1, RFC 9728 metadata, PKCE, audience checks. | Matches the repo's own spec ("façade later"); spec 2026-07-28 makes remote MCP an OAuth-server project. | Tools exposed to AI assistants must respect the no-advice rule; never expose a "rank candidates" tool. |
| Direct DB | Avoid | No customer access to our Postgres, no connections from us into customer databases. | RLS is our tenancy boundary; a DB link bypasses permissions, PII redaction and audit; customer DB schemas are unstable. | Some enterprises will ask; answer with the API or a file export. |
| Event / queue | MVP | Reuse `background_jobs` plus an `integration_events` outbox table written in the business transaction. No Kafka, Redis, SQS or pg-boss. | The queue already has RLS, retries, idempotency and dead-lettering (R3). Outbox fixes lost and duplicated in-memory events (R4, R5). | Events table growth: prune after 30 days. A due-orgs index will be needed past ~1k orgs (existing ponytail note). |
| Customer-side connector | Avoid (SMB) / Later (enterprise) | No on-premise agent. | Our customers are SMBs on SaaS ATSs or spreadsheets. An agent is a separate product to ship, update and support. | Enterprise on-prem HRMS customers will need it; price that as a services deal later. |
| File / SFTP fallback | MVP (CSV out) / Avoid (SFTP) | Keep CSV import; add a results CSV export (gated by `candidates.export`, audited). No SFTP. | The export removes today's retyping and fixes the field list for write-back; SFTP is enterprise plumbing. | An export is bulk PII leaving the system; keep it permission-gated and audited (product map D9). |
| Canonical model | MVP (use existing nouns) | The canonical model is the one we have: WorkUnit (job), Contact (candidate, job-scoped = ATS application), Call result, Stage. Adapters map vendor fields directly into these tables. No separate canonical schema. | A universal ATS schema is what unified-API companies sell; we need only the few fields we use. | Custom fields: keep them out of MVP; if needed, store raw vendor fields in a `jsonb` for display only. |
| Sync engine | V2 | Scheduled per-connection polling with a cursor, webhook as an early trigger, one-direction rules per field. | Polling is the only method every Indian ATS supports; one-way ownership removes conflict resolution. | Rate budgets per vendor; resume text vs file; phone format (R12). |
| Two-way actions | V2 | Write back notes and human-chosen, customer-mapped stages only. Auto-calling imported candidates is a per-job switch after a founder decision on consent and DND. | Satisfies "results flow back" without breaking the no-scoring rule. | Never write scores (Greenhouse `partner_score`, Keka scorecards). Automatic dialling raises consent/DND questions (MIGRATION_STATUS line 373). |
| Multi-tenancy | MVP | Every new table under forced RLS with `organization_id = current_org_id()`; key and inbound-webhook lookups through narrow SELECT-only policies; all writes in `Db.inOrg`. | This is how the codebase already works (R1, R2); nothing needs a bypass. | Do not resolve tenancy from payload fields; connection id in the URL only selects the row whose secret must then verify. |
| Security | MVP | Hashed API keys; sealed vendor credentials with a dedicated, versioned key; Standard Webhooks signing; SSRF filtering; constant-time compares; 5-minute timestamp tolerance on anything we verify that has a timestamp; audit of key/endpoint/connection changes; least-privilege scopes requested from vendors. | Matches RFC 9700 and vendor guidance; reuses existing helpers (R8). | The existing voice webhook accepts a ±30-minute window and a legacy no-timestamp signature; tighten when convenient. Data residency if a unified API is ever bought. |
| Onboarding UX | MVP | Settings tab: API keys, outbound webhook with test event and delivery log, honest status per connection; plain words, no vendor names except the customer's own ATS brand. | "Connect once" must be visible and checkable by a non-developer. | Decide explicitly whether a customer's ATS brand name may appear (product map §11 open point). |
| Build vs buy (unified API) | Later (re-evaluate) | Build the generic API, webhooks and one direct connector; re-evaluate Merge/Kombo when several customers need partner-gated ATSs. | Weak India coverage (no Keka/Darwinbox ATS), $650/month for 10 accounts at Merge, PII residency. | Building each Western ATS ourselves needs partnership agreements (Greenhouse, Lever); that is the point at which buying wins. |
| First integration | MVP (generic) / V2 (Zoho Recruit) | Ship the generic API + webhooks + results CSV first; first named connector Zoho Recruit unless the founder's pilot customers use something else. | Generic covers every system immediately; Zoho Recruit is self-serve, India-hosted, free to test. | No verified data on which ATS the first customers use (product map U9). |
| Other: phone normalisation | MVP (before any automated intake) | Store E.164 in one place and make `toE164` use it. | Automated intake multiplies the R12 bug. | Data migration for existing rows. |
| Other: no-code platforms | MVP (documentation) / Later (listings) | Document how to connect through Zapier, Make, n8n or Pabbly using our API key and webhooks; do not build or list a marketplace app yet. | Cheapest way to reach hundreds of systems. | Listing apps on those platforms is maintenance; wait for demand. |

---

## 5. What not to build (and when to reconsider)

1. **Our own OAuth authorization server.** Reconsider for a remote MCP server or an ATS marketplace app that must call us with OAuth.
2. **A remote MCP server.** Reconsider after `/v1` has stable paying users.
3. **SDKs, client libraries, an embeddable widget.** Reconsider if a partner marketplace requires one.
4. **A generic workflow or automation engine** (trigger → condition → action builder). Two fixed flows (in, out) cover the goal. The repo already deferred it "until proven need".
5. **A universal canonical data model** or field-mapping UI for arbitrary fields. Map the handful of fields we use, in code, per adapter.
6. **A Stripe-style idempotency-key store.** `PUT` by external id and unique `dedupe_key`s give idempotency for free.
7. **New infrastructure**: Kafka, Redis, a message broker, a separate integration service, an API gateway product. One Spring process plus Postgres is enough at this size; put a reverse proxy rate limit in front later if needed.
8. **Direct database links, SFTP, an on-premise agent.**
9. **Two-way sync of the same field.** Pick one owner per field.
10. **Connectors for Freshteam (sunset), greytHR (no recruiting API), Naukri RMS (no public API), Workday and Darwinbox (enterprise projects)** in the next two phases.
11. **Any write of a score, rank, fit percentage, verdict or automatic stage change** to an external system. This is permanent, not a phase decision.
12. **In-call live tool calls to an ATS** (for example checking interview slots mid-call). The voice agent receives only provider system tools today (`JAVA/engine/CallContextCompiler.java` 220-237); in and out before and after the call is enough for HRVoice.

---

## 6. Rough effort (ASSUMPTION, for sequencing only)

| Slice | Contents | Size for one engineer |
|---|---|---|
| A | Results CSV export | 1-2 days |
| B | External id columns, `source` values, phone normalisation decision | 2-3 days |
| C | API keys (table, resolver branch, Settings UI) | 3-5 days |
| D | `/v1` routes + OpenAPI file | 4-6 days |
| E | Outbox, `webhook` job kind, signing, delivery log, Settings UI, SSRF guard | 5-8 days |
| F (V2) | OAuth client + Zoho Recruit adapter + sync loop + note/stage write-back + stage mapping UI | 3-4 weeks |

---

## 7. Open questions (founder or unverified)

1. Which ATS, HRMS or spreadsheet do the first five to ten customers actually use for applicants? The connector choice depends on this and nothing in the repo records it.
2. When an applicant arrives from an ATS, may HRVoice call them automatically, or must a person click Call? This needs a decision on consent, calling hours and DND rules for Indian numbers (unverified what applies to recruitment calls).
3. What exactly may go back into the customer's ATS: summary and answers only, or also a coverage count ("6 of 7 questions answered")? The product forbids scores; confirm the coverage wording is acceptable or drop it.
4. May the customer's own ATS brand name appear in our UI ("Connect Zoho Recruit")? Current rules ban vendor names, aimed at our own infrastructure vendors.
5. Is copying candidate PII to a US/EU unified-API vendor acceptable to customers and under India's data-protection rules? (unverified where Merge/Kombo host data.)
6. How long should the events feed and delivery log be kept (I proposed 30 days)? This interacts with the open retention decision (product map C8).
7. Should outbound webhooks include transcript text, or only links back into HRVoice? Links keep PII inside the product; text is easier for customers.
8. unverified: Zoho Recruit webhook signing options and any Recruit "watch" API; Keka Hire webhook triggers; Greenhouse v3's published request limit; Workable trial API access; Naukri RMS API existence and terms.
9. unverified: whether Greenhouse or Lever partner programmes accept a small Indian vendor and on what terms (fees, security review).
