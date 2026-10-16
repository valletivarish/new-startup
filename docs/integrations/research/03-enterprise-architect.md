# 03. Enterprise integration architect: custom, legacy and firewalled systems

Date: 2026-10-03. Research and writing only: no code, config, migration or test was changed.

Scope: customers whose system has **no public API** or sits **behind a firewall**. That covers private APIs, on-premise apps, internal databases, file drops and message queues. The report also gives a position on every integration topic that touches this area. It builds on the two current-system maps:

* `docs/integrations/00-current-system-backend.md` (cited below as **BACKEND §n**)
* `docs/integrations/00-current-system-product.md` (cited below as **PRODUCT §n**)

Labels:

* **FACT** has a source: a URL or a repo path.
* **RECOMMENDATION** is my design advice.
* **ASSUMPTION** is a belief I have not checked.
* **unverified** means I looked and could not confirm.

Repo paths are relative to `/Users/valletivarish/Documents/new startup/`.

---

## 1. Summary

Our product needs very little data in each direction:

* **In:** a job reference plus a list of people (name, phone, optional email and resume text).
* **Out:** a small set of facts after each call (status, failure reason, summary, answers) and the stage a person chose.

That is low volume, append-mostly, and can tolerate minutes of delay. It does not justify the machinery that data-pipeline companies build to reach into private networks.

Look at how the real products reach systems behind a firewall: Microsoft's on-premises data gateway, Workato's on-prem agent, Fivetran's Hybrid Deployment and Proxy Agent, and Cloudflare Tunnel. They all share one idea. **The customer's side opens the connection, outbound over HTTPS port 443, and no inbound port is opened.** We can get the same property without shipping an agent. We publish two small HTTPS surfaces on our side, and the customer's own script, iPaaS or cloud event bus calls them outbound:

* **Push in:** an idempotent "upsert candidates by external id" endpoint, authenticated by an org-bound API key.
* **Pull out:** a cursor-based events feed (`GET /v1/events?after=…`), backed by a transactional outbox. Signed outbound webhooks are added on top for customers who can receive them.

A firewalled customer then needs only outbound HTTPS, which every corporate network already allows. They need no VPN, no tunnel, no database credentials held by us, and no agent of ours on their machines.

The codebase already holds most of the parts:

* the RLS-scoped `Db.inOrg`;
* the `background_jobs` queue with idempotency keys and dead-lettering;
* the `DomainEvents` boundary;
* the CSV validation and issue codes;
* the HMAC-over-raw-bytes webhook pattern with a narrow SELECT-only RLS lookup;
* the seeded `integrations.*` permissions;
* the documented decision to use "hashed, scoped, revocable API keys bound to an organization".

The missing pieces are small and specific:

* a machine principal (API key);
* external-id columns;
* an outbox table;
* one new queue kind for webhook delivery;
* a connection screen.

Direct database access, CDC, consuming customer Kafka or RabbitMQ, site-to-site VPN, a customer-side agent we build, and hosting our own SFTP server should all be **avoided or deferred** for an Indian-SMB-first startup with two or three engineers. Each one brings credential custody, network work per customer, schema drift and on-call load, for a segment we are not yet selling to. If an enterprise insists on one of these, the order of preference is:

1. their own script or iPaaS pushing to us;
2. their cloud event bus pushing HTTPS to us;
3. a file through the existing CSV path;
4. a narrow HTTPS endpoint they expose through their own tunnel or gateway;
5. a read-only view of their database, as a paid, contracted exception.

---

## 2. Findings

### 2.1 How real products reach systems behind a firewall

| # | Label | Finding | Source |
|---|---|---|---|
| E1 | FACT | **Microsoft on-premises data gateway.** The cloud service queues a query plus encrypted credentials. The gateway, running inside the customer network, **polls** Azure Relay, gets the request, decrypts the credentials, runs the query locally and sends the results back. "Both the gateway and Power BI service are implemented to only accept Transport Layer Security (TLS) 1.2 traffic." Large results are spooled on the gateway machine's disk. | https://learn.microsoft.com/en-us/data-integration/gateway/service-gateway-onprem-indepth |
| E2 | FACT | **Workato On-Prem Agent.** "The OPA only makes outbound connections to Workato. It doesn't require you to open any inbound ports in your firewall." It connects "over TCP port 443" with a TLS WebSocket tunnel using mutual TLS. Each agent presents a client certificate issued at activation. | https://docs.workato.com/on-prem.html |
| E3 | FACT | **Fivetran database connection options.** Six methods: direct connection ("safelisting our IP addresses"), SSH tunnel, reverse SSH tunnel, private networking (AWS PrivateLink, Azure Private Link, GCP Private Service Connect), VPN tunnel, and Proxy Agent. "Only Reverse SSH Tunnel and Proxy Agent require your environment to initiate connections." | https://fivetran.com/docs/connectors/databases/connection-options |
| E4 | FACT | **Fivetran Hybrid Deployment.** "Fivetran never initiates inbound connections to your local environment. Instead, the Hybrid Deployment Agent establishes a secure outbound connection to the Fivetran cloud endpoint using mutual TLS (mTLS)." "Only metadata … and logs are sent to Fivetran." | https://fivetran.com/docs/core-concepts/architecture/hybrid-deployment |
| E5 | FACT | **Airbyte Enterprise Flex.** A managed cloud control plane with data planes that run in the customer's infrastructure. In sensitive deployments "only metadata ever reaches the control plane". It supports external secrets managers. | https://docs.airbyte.com/platform/enterprise-flex/ |
| E6 | FACT | **Cloudflare Tunnel.** "cloudflared initiates an outbound connection through your firewall from the origin to the Cloudflare global network." No public IP and no inbound port are needed. | https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/ |
| E7 | FACT | **Tailscale.** WireGuard-based mesh. Connections work "across firewalls and Network Address Translation (NAT) without requiring port forwarding". The relay fallback (DERP) was not described on the page I read, so it is unverified here. | https://tailscale.com/kb/1151/what-is-tailscale |
| E8 | RECOMMENDATION | **The common pattern is "the customer side dials out".** Every vendor that ships an agent also runs a large product line to support it: certificates per agent, upgrades, spooling, a status UI, support for Windows and Linux hosts. That is a company-sized investment. **Our data flows are small enough that the customer side can dial out with a plain HTTPS client (script, iPaaS, cloud bus) to our API, and poll us for results.** That gives us E1–E6's security property with no agent. |  |

### 2.2 Event and queue systems: can customers push events to us?

| # | Label | Finding | Source |
|---|---|---|---|
| Q1 | FACT | **AWS EventBridge API destinations** call any public HTTPS endpoint. Connections support **Basic, API Key and OAuth (client credentials)**; EventBridge "populates the required authorization headers for you". | https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-target-connection-auth.html |
| Q2 | FACT | EventBridge has a **5-second timeout** per request. It **retries 401, 407, 409, 429 and 5xx** (by default up to 24 hours and 185 times) and does not retry other 4xx. It honours `Retry-After`. **No mTLS.** Input transformers can reshape the event to the target's schema. | https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-api-destinations.html |
| Q3 | FACT | **Amazon SNS** HTTPS subscriptions need a subscription-confirmation handshake. The body is a JSON envelope with a signature and `SigningCertURL`. Basic auth in the URL is supported. It retries only 5xx and 429. "Amazon SNS does not currently support private HTTP(S) endpoints." | https://docs.aws.amazon.com/sns/latest/dg/sns-http-https-endpoint-as-subscriber.html |
| Q4 | FACT | **Google Pub/Sub push** sends an HTTPS POST. `message.data` is base64 inside a JSON envelope. Optional authentication is an OIDC JWT in `Authorization`. The message is acknowledged by status 102/200/201/202/204, and any other code leads to redelivery with backoff (at least once). | https://docs.cloud.google.com/pubsub/docs/push |
| Q5 | FACT | **Kafka Connect HTTP Sink** consumes topics and POSTs batches to an HTTP API, with Basic, OAuth2 client-credentials or custom-header auth and configurable retries. It is a self-managed connector that needs a commercial licence after a 30-day trial. | https://docs.confluent.io/kafka-connectors/http/current/overview.html |
| Q6 | RECOMMENDATION | **The simplest receiving shape for any queue is one HTTPS endpoint.** It should: <br>1. Accept JSON in our canonical shape. <br>2. Authenticate with a static header (`Authorization: Bearer <api key>`). <br>3. Write the payload durably and return **202 within about 1 s**. <br>4. Treat a duplicate as success (**200, not 409**, because EventBridge retries 409). <br>Then process it through `background_jobs`. EventBridge works with this on day one (API-key connection plus an input transformer). Kafka and RabbitMQ customers point their own HTTP sink or shovel at it. SNS envelope unwrapping with the confirmation handshake, and Pub/Sub OIDC verification, are small add-ons to build **only when a customer asks**. **We should never run consumers against a customer's broker.** That would need network reach into their VPC, broker credentials, a client library per broker, and consumer-group operations per customer. |  |

### 2.3 Direct database integration

| # | Label | Finding | Source |
|---|---|---|---|
| D1 | FACT | Postgres logical replication needs a role with the `REPLICATION` attribute (or superuser). Also: "There are currently no privileges on publications. Any subscription (that is able to connect) can access any publication." | https://www.postgresql.org/docs/current/logical-replication-security.html |
| D2 | FACT | Debezium's Postgres connector needs logical decoding and a replication slot. An inactive slot stops Postgres from removing WAL segments, which causes "continuous disk space consumption" on the **customer's** database server. | https://debezium.io/documentation/reference/stable/connectors/postgresql.html |
| D3 | FACT | `default_transaction_read_only` only sets the default. A session can change it with `SET TRANSACTION`, so **it is not a security boundary**. `statement_timeout` can also be overridden per session. | https://www.postgresql.org/docs/current/runtime-config-client.html |
| D4 | FACT | SQL Server Change Tracking records only that a row changed (primary key plus operation). The reader must join back to the live table. It must be enabled per database and per table, and its metadata is purged after a retention period. | https://learn.microsoft.com/en-us/sql/relational-databases/track-changes/about-change-tracking-sql-server |
| D5 | FACT | Fivetran's direct database option requires the customer to safelist Fivetran's IPs (E3). So reaching a customer database from SaaS means the database is reachable from the internet, or a tunnel, VPN or private link exists. | E3 |
| D6 | RECOMMENDATION | **Direct database access is the costliest and riskiest option.** The risks: <br>• **Credential custody:** we would hold a password to the customer's database of record. Today we have no per-tenant secret store (BACKEND §12). <br>• **Network:** the customer opens a port to the internet or builds a tunnel. <br>• **Schema drift:** their columns change without notice, and our sync breaks silently. <br>• **Performance:** our queries load their OLTP database. <br>• **Over-exposure:** a mis-scoped grant shows us far more PII than we need, which adds to our duty to safeguard it. <br>• **Writes:** one wrong UPDATE corrupts their system of record. <br>If it is ever done: <br>• **read-only**, enforced by `GRANT SELECT` on a customer-created **view** that holds only the columns we need, and not by session settings (D3); <br>• TLS required; <br>• our static egress IP allowlisted; <br>• the poll is incremental on an `updated_at` or rowversion column they choose; <br>• `statement_timeout` set by us on our own session; <br>• credentials encrypted with a dedicated key. <br>**Never write to a customer database.** **Never use CDC** (D1, D2): it needs a highly privileged role, and a stalled slot can fill their disk. |  |

### 2.4 Files and SFTP

| # | Label | Finding | Source |
|---|---|---|---|
| F1 | FACT | CSV intake already exists. It is a two-step preview and confirm with header aliases, delimiter detection, India-first phone normalisation and seven issue codes. Rows are limited to 1–2000 per confirm. | `apps/api-java/src/main/java/desk/hiring/CandidateImport.java`; BACKEND §8.1 |
| F2 | FACT | Managed SFTP exists as a cloud service (for example AWS Transfer Family: SFTP v3, FTPS, FTP and AS2 into S3 or EFS, with "no upfront costs"). Our hosting plan is a single Indian VPS on Docker Compose, with no managed cloud in Phase 1 because of cost. | https://docs.aws.amazon.com/transfer/latest/userguide/what-is-aws-transfer-family.html; `BRD's/10_ADRs/ADR-006-hosting-deployment.md` lines 143, 191 |
| F3 | ASSUMPTION | Indian SMB hiring teams keep candidates in Excel or Google Sheets, a job-board inbox (Naukri) or a light ATS. They rarely run an SFTP server. SFTP is an enterprise and HRMS habit. (PRODUCT U9 notes that the repo holds no customer data on this.) |  |
| F4 | RECOMMENDATION | Files are the universal fallback, and most of the work is already done. In order: <br>1. Keep the UI CSV upload (exists). <br>2. Accept `text/csv` on the same push-in API, so a customer's nightly script can post a file with no browser. This reuses the `CandidateImport` validation unchanged. <br>3. Add a results CSV export (PRODUCT §5 already recommends this). <br>**Pulling** from a customer's SFTP server (we connect out, with per-connection credentials and our static egress IP) is V2, built only for a paying customer. **Hosting** our own SFTP server on the VPS that also runs Postgres opens a new internet-facing daemon next to candidate PII. Avoid it until someone pays for it, and then use a managed service. |  |

### 2.5 Indian HR systems are often pull-only

| # | Label | Finding | Source |
|---|---|---|---|
| P1 | FACT | Darwinbox (a large Indian HRMS) says its APIs are "accessible only to privileged users and access is provided on a request-only basis". Recruitment endpoints include bulk candidate fetch with `updated_from` and `updated_to` filters, reject candidate, and add tags. | https://api-docs.darwinbox.com/ (as reported by search; the page itself was not fetched, so details are unverified) |
| P2 | unverified | One secondary source (Knit) says Darwinbox does not send webhooks and recommends polling. Darwinbox Studio can **receive** webhooks. I found no primary documentation either way. | https://developers.getknit.dev/docs/darwinbox-ats-usecases ; https://support.greenhouse.io/hc/en-us/articles/26524633774875-Darwinbox-integration |
| P3 | FACT | Pabbly Connect, an India-priced iPaaS (prices in INR), supports receiving webhooks and calling arbitrary HTTP APIs. | https://www.pabbly.com/connect/ |
| P4 | RECOMMENDATION | Two consequences follow. <br>• Even "API" customers in India may be **pull-only**, so a per-connection scheduled poller will be needed eventually (V2). It cannot be the first thing we build. <br>• SMBs without developers can wire us up through an iPaaS they already pay for (Pabbly, Zapier, Make, n8n), **if our API is a plain HTTPS + API-key surface with webhooks**. That makes the generic push API plus webhooks the highest-leverage first integration. |  |

### 2.6 Outbound delivery (webhooks and feed)

| # | Label | Finding | Source |
|---|---|---|---|
| W1 | FACT | Standard Webhooks: <br>• headers `webhook-id`, `webhook-timestamp` and `webhook-signature`; <br>• HMAC-SHA256 over `id.timestamp.body`, prefixed `v1,`; <br>• secrets `whsec_`-prefixed, 24–64 random bytes; <br>• "Signing keys should be unique per endpoint"; <br>• receivers check a timestamp tolerance and dedupe on `webhook-id`; <br>• retries span days; <br>• thin payloads are "more future proof". | https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md |
| W2 | FACT | Stripe's events API lists events "going back up to 30 days" with cursor pagination (`starting_after`), filterable by type. This is the established "poll for changes" pattern, alongside webhooks. | https://docs.stripe.com/api/events/list |
| W3 | FACT | OWASP SSRF guidance for user-supplied URLs: block `169.254.169.254`, `127.0.0.0/8` and the RFC 1918 ranges; check **every resolved A/AAAA address**; disable redirects; defend against DNS rebinding. | https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html |
| W4 | FACT | Our API, Postgres and the web app run as one Docker Compose stack on one VPS (planned). A customer-supplied webhook URL that resolves to an internal address could therefore reach internal services. | `BRD's/10_ADRs/ADR-006-hosting-deployment.md` line 143 |
| W5 | FACT | Domain events `call.started`, `call.ended` and `result.ready` are published in-process. They are not persisted and are re-published every time `apply` runs. Stage changes publish no event. The stage update and its audit insert run in separate transactions. | BACKEND §9, §15, §16; `apps/api-java/src/main/java/desk/engine/DomainEvents.java` |
| W6 | FACT | The `background_jobs.kind` check constraint allows only `'email','document'`. `JobQueue.enqueue` reads `POLICY.get(kind)[0]`, so a new kind needs a migration **and** a `POLICY` entry. Without the entry it fails with a NullPointerException. | `packages/db/drizzle/0030_background_jobs.sql` line 22; `apps/api-java/src/main/java/desk/jobs/JobQueue.java` lines 38, 67 |
| W7 | RECOMMENDATION | **One outbox table feeds two consumers.** <br>• Write an `integration_events` row **in the same transaction** as the result write in `VoiceSessions.apply` and the stage update in `HiringController`. Use a unique key `(organization_id, type, subject_id, dedupe_key)`, so the repeated `apply` calls produce one event (closes W5). <br>• Consumer 1 is `GET /v1/events?after=<cursor>`, a keyset read using the existing `platform/Cursor`. Firewalled customers poll it outbound. Keep 30 days of events (W2). <br>• Consumer 2 is a new `background_jobs` kind `webhook_delivery`, signed per Standard Webhooks, with SSRF checks (W3). <br>• The feed is the MVP. Webhooks come next, or at the same time if the effort is the same. Both read the same rows. |  |

### 2.7 Grounding in this codebase (what to reuse, what is missing)

| # | Label | Finding | Source |
|---|---|---|---|
| C1 | FACT | The only caller identity is a browser session. `Actor` needs a user and a membership. Background work runs as `inOrg(org, Db.NIL)`. | BACKEND §4, §3.1; `apps/api-java/src/main/java/desk/platform/Db.java` |
| C2 | FACT | The spec already decides: "future customer API access uses hashed, scoped, revocable API keys bound to an organization". | `BRD's/04_DATABASE_API_SPEC.md` line 410 |
| C3 | FACT | Invitation tokens are stored as SHA-256 hashes, and there is a narrow RLS lookup function for them (`Db.withInvitationToken`). The voice webhook resolves its org through a SELECT-only policy after HMAC verification (`0022`). | BACKEND §3.1, §11; `packages/db/drizzle/0022_voice_webhook_lookup.sql` |
| C4 | FACT | Custom roles exist per org, with grants capped at the editor's own permissions. `integrations.read/create/update/delete` are seeded but no route uses them. | BACKEND §5, §17; `packages/db/drizzle/0024_custom_role_permissions.sql` |
| C5 | FACT | No external-id column exists on jobs or candidates. `candidates.source` has a CHECK of `IN ('manual','resume')`. Dedupe is `(job_id, phone)` on raw text. | BACKEND §6.2, §6.5 |
| C6 | FACT | `PhoneNumbers.toE164` reads only `candidates.phone` and ignores `country_code`. CSV import stores national digits apart from the dial code, so non-Indian imports may dial wrongly. This comes from a code read and has not been tested. | BACKEND §9 |
| C7 | FACT | Every phone screen starts from a human click (`calls.initiate`). There is no auto-dial, and auto-retry is off and has no dispatcher. | BACKEND §18 item 9; `apps/api-java/MIGRATION_STATUS.md` line 373 |
| C8 | FACT | The only encrypt-at-rest helper (`Notifications.seal`) is keyed off `BETTER_AUTH_SECRET` and is specific to email. | BACKEND §12 |
| C9 | FACT | The rate limit is in-process and per IP. | `apps/api-java/src/main/java/desk/platform/EdgeFilter.java` lines 69–83 |
| C10 | FACT | The product never recommends, scores or ranks. `fitPercent` must not leave the system as a score. | PRODUCT §8.3; `apps/api-java/src/main/resources/usecases/hiring.json` `result.adviceGuard` |
| C11 | FACT | Use-case `actions.webhook` is `false`, and no code reads it. | `apps/api-java/src/main/resources/usecases/hiring.json` line 128 |
| C12 | RECOMMENDATION | **Machine principal = an API key bound to an org and to an existing role.** The key row holds `organization_id`, `role_key` (a system or custom role), `prefix`, `sha256(secret)`, `created_by`, `last_used_at` and `revoked_at`. `AuthResolver` resolves `Authorization: Bearer` to an `Actor` with that role's permissions and a nil or "integration" user id. This reuses: <br>• the permission catalogue and the `@RequirePermission` gate; <br>• per-field PII redaction (`candidates.read_pii`, `calls.read_transcript`); <br>• the audit of sensitive reads; <br>• custom roles as scopes, so **no new scope system is needed**. <br>Admins create keys under `integrations.create`, and cannot grant a key more than they hold (the same rule as `0024`). The audit `actor_user_id` is NULL today for system work, so add an `api_key_id` in audit metadata. |  |
| C13 | RECOMMENDATION | **Provenance first.** Add `external_source` and `external_id` (nullable) to `jobs` and `candidates`, unique per `(organization_id, external_source, external_id)` (for candidates: per job). Extend the `candidates.source` CHECK with `'api'` (and `'import'` while there, since CSV rows currently show "Added by hand", PRODUCT §4.3). Require **E.164** on the API and store it canonically. Fix C6 before automated intake. |  |
| C14 | RECOMMENDATION | **Connection settings live in a new RLS table** (`integration_connections`: org, kind, display name, status, webhook URL, encrypted signing secret, key version, last success/error). It is not stored on `organizations`, which has no settings column (BACKEND §6.4). Secrets that must be readable later (outbound signing secrets, future SFTP or database passwords) use AES-GCM with a **dedicated** key env var plus a key version, never `BETTER_AUTH_SECRET` (C8). The `seal` code can be lifted and generalised, not rewritten. |  |

---

## 3. Recommended hierarchy for customers with no public API

Ordered by preference. Stop at the first rung the customer can do.

| Rung | Shape | Who it fits | What the customer does | What we build | Phase |
|---|---|---|---|---|---|
| 1 | **They push to our API; they poll our events feed** (or receive our webhook) | Any custom or on-prem app with one developer, or any team with an iPaaS (Pabbly, Zapier, Make, n8n, or Workato with its own on-prem agent) | A cron script or iPaaS flow: read new applicants from their system, `POST /v1/candidates/batch`; read `GET /v1/events`, then update their system | API key, upsert endpoint, outbox, feed, a reference script in the docs | **MVP** |
| 2 | **Their cloud event bus pushes HTTPS to us** | Teams on AWS, GCP or Kafka | EventBridge API destination with an API-key connection and an input transformer (day one). Kafka HTTP Sink, SNS or Pub/Sub push (SNS and Pub/Sub need our small envelope adapters) | The rung-1 endpoint is already enough for EventBridge and Kafka sinks. SNS and Pub/Sub adapters only on request | MVP (EventBridge/Kafka), **V2** (SNS, Pub/Sub) |
| 3 | **File** | Teams whose system can only export | UI CSV upload (exists) or a scripted `text/csv` POST; later, a scheduled pull from **their** SFTP | `text/csv` on the push endpoint (MVP-cheap); results CSV export (MVP); SFTP pull (V2, paid); hosting our own SFTP (Avoid) | MVP / V2 / Avoid |
| 4 | **They expose a narrow HTTPS endpoint we call** (through their API gateway or their own outbound tunnel, such as Cloudflare Tunnel) | Enterprises that want us to write into their system, or a future in-call lookup | They publish one endpoint, allowlist our egress IP and give us a per-connection secret | An outbound HTTP adapter per connection with SSRF guard (the same code as webhooks) | **Later** |
| 5 | **Read-only database view** | Enterprises with only a database and no developer time | Create a view with only the needed columns, `GRANT SELECT` to a dedicated role, TLS, allowlist our IP | Incremental poller per connection, encrypted credentials, schema-drift alarms | **Later**, paid exception with a signed DPA |
| 6 | **Customer-side agent we ship** | Large regulated enterprises | Install and run our binary | Agent, mTLS PKI, upgrades, status, support (E1–E4 scale) | **Avoid** until an enterprise segment is proven. Then consider buying or partnering, for example a customer's own iPaaS agent calling rung 1 |
| 7 | **Never** | | | Read-write database access, CDC or replication slots on their database, consuming their Kafka/RabbitMQ/SQS directly, site-to-site VPN | **Avoid** |

**RECOMMENDATION.** Rung 1 is also the "customer-side connector" for the on-prem case. The customer's own script, running inside their network and dialling out, plays the role Workato's or Microsoft's agent plays, with nothing for us to ship or patch. We should publish a short reference script (curl plus one small Python file) in the docs, not an SDK.

---

## 4. Positions by topic

| Topic | Position | Phase | Rationale | Concerns |
|---|---|---|---|---|
| REST API | A small versioned public surface `/v1`: `POST /v1/candidates/batch` (upsert by external id, JSON or `text/csv`, up to 500 rows, reusing `CandidateImport` validation and issue codes), `GET /v1/candidates/{id}/results`, `GET /v1/events`, `GET /v1/jobs`. Hand-write an OpenAPI file for these few routes. | MVP | It is the base for rungs 1–3, iPaaS and later MCP. Most of the logic exists. | Freeze the contract carefully, since external callers cannot be refactored. Add per-key rate limits, because the in-process per-IP limit (C9) will throttle shared iPaaS egress IPs. |
| OAuth | We do not act as an OAuth provider in MVP. As an OAuth client to SaaS ATSs, OAuth belongs to the named-ATS work. | V2 (as client), Later (as provider, needed for MCP) | Firewalled and custom systems use keys, not OAuth. MCP's HTTP auth requires OAuth 2.1 with protected resource metadata (RFC 9728) and resource indicators (RFC 8707), which is real work. | Do not store tokens in the Better Auth `accounts` table (BACKEND §4). |
| API keys | An org-bound, hashed (SHA-256), revocable key bound to a system or custom role (C12). Shown once, with a prefix for identification, `last_used_at`, created under `integrations.create`. | MVP | Already decided in the spec (C2). Reuses permissions, PII redaction and audit. | Keys must not default to PII. Suggest a default "Integration" role without `candidates.read_pii` unless the admin chooses otherwise. Rotation means two active keys at once. |
| Service accounts | No separate concept. An API key **is** the service account: an org-level principal holding a role. | MVP (as API keys) | One concept instead of two. `Actor` gets a non-user variant. | The audit needs `api_key_id`, because `actor_user_id` is NULL for system work today. |
| Webhooks (outbound) | Standard Webhooks signing, one endpoint per org at first, thin payloads (event type plus ids), at-least-once delivery, a `webhook_delivery` queue kind, SSRF guard, delivery log, "send test event". | MVP alongside the feed, or immediately after | iPaaS and custom apps expect it. The feed covers firewalled receivers. | SSRF on a single-VPS stack (W3, W4). Thin payloads keep PII behind key permissions. The receiver dedupes on `webhook-id`. Respect C10: no `fitPercent`. |
| Webhooks (inbound) | No per-vendor inbound webhook in MVP. The push API **is** the inbound webhook (API-key header, 202 fast, 200 on duplicate). Per-connection HMAC secrets for vendor webhooks come with named ATS adapters. | MVP (generic), V2 (vendor) | EventBridge, Kafka sinks and iPaaS can all send a static header (Q1, Q5, P3). | The 5-second EventBridge timeout means process asynchronously (Q2). The voice webhook's single global secret does not generalise (BACKEND §11). |
| SDK / embedded | No SDKs. A reference script and OpenAPI file only. | Avoid (SDK), MVP (reference script) | SDKs per language are upkeep we cannot staff. OpenAPI lets customers generate one. | None for now. |
| MCP | A facade over `/v1` once API keys and the events feed are stable. It does not solve the firewalled case. | Later | Matches the existing spec ("a façade later", PRODUCT F1). Remote MCP auth is OAuth 2.1 plus RFC 9728/8707 (https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization). | Checked against the 2025-06-18 revision. A newer revision may exist, so check before building (unverified). |
| Direct DB | Read-only view, our IP allowlisted, TLS, incremental poll, dedicated key encryption, never write, never CDC. | Later (paid exception); Avoid for read-write and CDC | Credential custody, network exposure, schema drift and load on their database (D1–D6). | DPDP: holding database credentials widens our safeguarding duty (see Security). |
| Event / queue | Accept HTTPS push from the customer's bus into the rung-1 endpoint. Never consume their broker. | MVP (EventBridge, Kafka HTTP sink), V2 (SNS confirm, Pub/Sub OIDC) | The simplest receiving shape (Q6). | Return 200 on a duplicate, never 409 (EventBridge retries 409). Respond within 1 s. |
| Customer-side connector | Their own script or iPaaS dialling out to us is the connector. Do not build an agent. | MVP (reference script); Avoid (our agent) | E1–E4 show what an agent costs. Our flows do not need on-demand reach into their network. | If in-call lookups against on-prem data become a need, revisit rung 4 first. |
| File / SFTP fallback | Keep the UI CSV; add `text/csv` on the API and a results CSV export; SFTP pull from their server for a paying customer; no hosted SFTP. | MVP (CSV in and out), V2 (SFTP pull), Avoid (hosted SFTP) | CSV logic exists (F1). SMBs live in spreadsheets (F3, assumption). | Results export is a bulk PII export: gate it on `candidates.export` and audit it (PRODUCT D9). |
| Canonical model | Use the existing nouns: work item (job), contact (candidate), call result, human stage decision. Add `external_source` and `external_id`. Outbound events: `contact.created`, `call.ended`, `result.ready`, `contact.stage_changed`. | MVP | The nouns are already decided (PRODUCT D11) and pack-agnostic. | Stage mapping to customer pipelines stays on the customer side in MVP (their script maps our four stages). Store a mapping in our app only with named ATS adapters. |
| Sync engine | None in MVP: push in, outbox out. A per-connection scheduled poller (for pull-only systems such as Darwinbox, P1/P2) in V2, on `background_jobs` with a recurring `run_at`. | V2 | Avoids building a generic engine before any connector needs it. | The queue has no recurring per-org schedule today (BACKEND §10). A due-connections index will be needed as connections grow. |
| Two-way actions | We emit facts and human decisions. The customer's side applies them to their system. We do not write into customer systems in MVP. In-call actions such as checking interview slots are Later. | MVP (events out), Later (we write) | Writing into someone else's system of record is the riskiest operation. The no-advice rule limits what we may write anyway (C10). | Every stage event must carry the deciding person (stage history already records the actor). |
| Multi-tenancy | Resolve the org from the API key server-side. Never read it from the payload. All work runs under `Db.inOrg`. New tables get FORCE RLS. Key lookup uses a narrow hash-matching policy in the style of `0022`. | MVP | Matches the existing design. No RLS bypass is needed (BACKEND §3). | Add a per-org quota on the API, separate from call budgets. |
| Security | Hashed API keys; a dedicated encryption key with versioning for readable secrets; SSRF guard; Standard Webhooks signing; TLS only; a documented **static egress IP** (the single VPS gives one naturally, so keep it when scaling); audit every key use, export and delivery; India hosting as the residency answer. Under the DPDP Rules 2025 (notified November 2025, phased over 18 months) we are most likely a data **processor** for the employer. | MVP | Pulls existing patterns forward (C3, C8). | The DPDP role split and contract terms need a lawyer (ASSUMPTION). Secondary sources say breach reports are due to the Board within 72 hours: https://www.pib.gov.in/PressReleasePage.aspx?PRID=2190014 (official notice); for details, see the Rules PDF at https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf (not read in full, so unverified). |
| Onboarding UX | Settings tab "Connected systems" (gated by `integrations.*`): create key (shown once), choose its access level, copy endpoint, set webhook URL, "send test event", last success or error in plain words, events log, revoke. | MVP | PRODUCT §6 recommends this tab. It keeps setup to about 10 minutes for a developer or an iPaaS user. | `apps/web/lib/errors.ts` hides messages containing "webhook", "api key" or "token" (PRODUCT §11), so the copy must be written for that. Rename the agent page's "Integrations" group (PRODUCT §7.2). |
| Build vs buy (unified API) | Not for this segment. Unified ATS APIs cover cloud SaaS ATSs, not custom or on-prem systems. Revisit for named-ATS breadth. | Later | A generic push API covers custom systems at near-zero marginal cost. | Coverage of Indian ATSs varies (Merge lists Darwinbox, https://www.merge.dev/integrations/darwinbox, not verified in depth). Per-linked-account pricing for SMB revenue is unverified. |
| First integration | **The generic push API plus events feed and webhooks**, and a results CSV export. The first named ATS is then picked from pilot demand. | MVP | Serves every custom or on-prem system, every iPaaS user and every cloud bus at once. It is also the base that named adapters and MCP sit on. | It needs a developer or iPaaS on the customer side. Non-technical SMBs still need CSV and, later, a named connector. |
| Other: automatic dialing on intake | Data flowing in does not achieve the founder's goal unless calls start without a click. Today every call needs a human click (C7). Add a per-job switch, "call new people automatically", **only after** a founder decision on consent notice, calling hours and DND. | V2 (decision first) | Without it, API intake only fills the "Not called yet" queue. | Consent and telecom rules (TRAI/DND) were not researched here (unverified). The `BudgetGuard` and concurrency caps already exist and must stay in the path. |
| Other: phone canonicalisation | Require E.164 on the API and fix `toE164` to use `country_code` before automated intake. | MVP | Automated feeds remove the human who would catch a bad number (C6). | Not tested; found by a code read. |

---

## 5. What not to build (and when to revisit)

| Do not build | Why | Revisit when |
|---|---|---|
| A customer-side agent or gateway of our own | A product line by itself (PKI, upgrades, spooling, OS support; E1–E4). Rung 1 gets the same "outbound-only" property for free. | Several signed enterprise deals need on-demand reads into private networks that rung 4 cannot serve |
| Direct read-write database access, or CDC (Debezium, logical replication, SQL Server CDC) | Write risk, replication privileges, WAL growth on the customer's server, schema drift (D1–D4) | Never for writes. Read-only view as a paid exception only |
| Consumers for customer Kafka, RabbitMQ, SQS or Service Bus | Network reach, credentials and operations for each broker. HTTP push covers it (Q1–Q6) | A customer cannot run any HTTP sink (unlikely) |
| Site-to-site VPN or PrivateLink per customer | Network engineering per customer. Our VPS-based hosting has none of these primitives (ADR-006) | Move to a hyperscaler plus an enterprise contract |
| Hosted SFTP server | A new internet-facing daemon on the same box as candidate PII | A paying customer requires it; then use a managed service |
| A generic sync or workflow engine, field-mapping UI or stage-mapping UI | No connector needs it yet. Customer-side scripts map fields in MVP (PRODUCT F8 already says "until proven need") | The first named ATS adapter |
| Language SDKs | Upkeep. OpenAPI plus a reference script is enough | Paying developers ask |
| MCP server | A facade over a surface that does not exist yet (PRODUCT F1) | `/v1` and API keys are stable |
| Auto-dial on intake | Needs consent and DND decisions (C7) | Founder decision recorded |
| Writing `fitPercent`, ranks or "qualified" anywhere outside | Product rule (C10) | Never |

---

## 6. Open questions (for the founder, or not verifiable here)

1. Which systems do the first 5–10 pilot customers actually keep candidates in (Excel/Sheets, Naukri RMS, Zoho Recruit, Keka, Darwinbox, custom)? Does any of them have a developer or an iPaaS subscription? (The repo has no data on this; PRODUCT U9.)
2. Should candidates arriving through the API be **called automatically**? If so, what consent notice, calling hours and DND handling apply? (Not researched here; unverified.)
3. Is any early customer an enterprise that requires on-prem data to stay inside its network, or an SFTP or database-only integration? If none, rungs 4–6 stay parked.
4. Default access level for an API key: should integration keys see PII (phone, email, transcript) by default, or only when an admin chooses? I recommend "only when chosen".
5. Are we comfortable being named a DPDP **data processor** in customer contracts, with the safeguards and breach notice that implies? This needs a lawyer. My reading of Rule 6/7 details comes from secondary sources (unverified).
6. Does the hosting plan keep a **stable egress IP** as we scale (single VPS today)? Enterprise allowlists depend on it.
7. Can a customer's third-party ATS brand name appear on the connection screen? The "no vendor names" rule targets our infrastructure vendors (PRODUCT §11).
8. Unverified facts in this report:
   * whether Darwinbox sends webhooks (P2);
   * the Tailscale relay behaviour (E7);
   * whether a newer MCP spec revision changes authorization;
   * unified-API pricing and India coverage;
   * the exact DPDP Rule 6/7 wording.

---

## 7. Sources

Vendor and standards documentation:

* Microsoft on-premises data gateway: https://learn.microsoft.com/en-us/data-integration/gateway/service-gateway-onprem-indepth
* Workato On-Prem Agent: https://docs.workato.com/on-prem.html
* Fivetran connection options: https://fivetran.com/docs/connectors/databases/connection-options
* Fivetran Hybrid Deployment: https://fivetran.com/docs/core-concepts/architecture/hybrid-deployment
* Airbyte Enterprise Flex: https://docs.airbyte.com/platform/enterprise-flex/
* Cloudflare Tunnel: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/
* Tailscale: https://tailscale.com/kb/1151/what-is-tailscale
* AWS EventBridge API destinations: https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-api-destinations.html
* AWS EventBridge connection auth: https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-target-connection-auth.html
* Amazon SNS HTTPS subscribers: https://docs.aws.amazon.com/sns/latest/dg/sns-http-https-endpoint-as-subscriber.html
* Google Pub/Sub push: https://docs.cloud.google.com/pubsub/docs/push
* Kafka Connect HTTP Sink: https://docs.confluent.io/kafka-connectors/http/current/overview.html
* Postgres logical replication security: https://www.postgresql.org/docs/current/logical-replication-security.html
* Postgres client settings: https://www.postgresql.org/docs/current/runtime-config-client.html
* Debezium Postgres connector: https://debezium.io/documentation/reference/stable/connectors/postgresql.html
* SQL Server Change Tracking: https://learn.microsoft.com/en-us/sql/relational-databases/track-changes/about-change-tracking-sql-server
* AWS Transfer Family: https://docs.aws.amazon.com/transfer/latest/userguide/what-is-aws-transfer-family.html
* Standard Webhooks: https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md
* Stripe events API: https://docs.stripe.com/api/events/list
* OWASP SSRF Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
* MCP authorization (2025-06-18): https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization

Indian systems and regulation:

* Darwinbox API docs (via search): https://api-docs.darwinbox.com/
* Pabbly Connect: https://www.pabbly.com/connect/
* DPDP Rules 2025 (PIB): https://www.pib.gov.in/PressReleasePage.aspx?PRID=2190014

Repo:

* `docs/integrations/00-current-system-backend.md`
* `docs/integrations/00-current-system-product.md`
* `BRD's/04_DATABASE_API_SPEC.md` (lines 303–316, 410)
* `BRD's/10_ADRs/ADR-006-hosting-deployment.md`
* `packages/db/drizzle/0030_background_jobs.sql`
* `apps/api-java/src/main/java/desk/jobs/JobQueue.java`
* `apps/api-java/src/main/resources/usecases/hiring.json`
* `docs/superpowers/specs/2026-09-16-hiring-production-launch-design.md` (lines 12, 72)
