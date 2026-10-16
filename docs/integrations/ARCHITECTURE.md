# HRVoice integration architecture

Date: 2026-10-03. Status: **the agreed plan, written up for the team.** The decision record is `BRD's/10_ADRs/ADR-010-integration-layer.md`, PROPOSED until the founder accepts it. One item inside the Zoho connector is still **OPEN** (last section). Documents only: no code, config, migration or test was changed to write this.

**What this file is.** A faithful write-up of `docs/integrations/architecture-draft-v13.md` ("v13"), the agreed plan and frozen rationale record. It adds no scope and changes no decision. Where this file and v13 differ, v13 wins. Mechanism detail (compare-and-set rules, lock order, cursor keys, copy) stays in v13 sections 5-12 and goes into each slice's build sheet.

Sources and short names:
- `architecture-draft-v13.md` (v13): the plan. Section numbers below ("v13 §5") point into it.
- `02-resolutions.md`: every decision and why, round by round (R1.x to R13.x). "Round 7 (lead decision)" (R7.0) is the binding scope cut. R13.4 is the errata list for the build sheets.
- `later-bulk-calling.md`: bulk calling. **NOT APPROVED, out of scope.**
- `01-comparison.md`: the seven expert reports compared (disagreements D1-D19).
- `research/01..07-*.md`: the expert reports. Codes: IA Integration Architect, AM AI Agent / MCP Architect, EA Enterprise Architect (called EIA in review rounds), SA Security Architect, UX Product / UX Architect, BE Backend / Distributed Systems Architect, CR Critical Reviewer.
- `00-current-system-backend.md` ("backend map"), `00-current-system-product.md` ("product map"): the current system.

Labels: **FACT** (with its source: URL or repo path), **RECOMMENDATION**, **ASSUMPTION**, **unverified**. A design statement without a label is a RECOMMENDATION of v13. Paths are relative to `/Users/valletivarish/Documents/new startup/`. `JAVA/` = `apps/api-java/src/main/java/desk/`, `RES/` = `apps/api-java/src/main/resources/`, `MIG/` = `packages/db/drizzle/`.

**Review status.** 13 drafts. Rounds 1-6 on the full plan did not converge (majors 17, 12, 9, 4, 1, 5). The orchestrator then made a lead decision (`02-resolutions.md`, "Round 7 (lead decision)"): bulk calling moved to `later-bulk-calling.md` (NOT approved), the ordered event log moved out of Core into the developer slice, and "remove, don't add". Rounds 7-13 on the simplified plan: majors 5, 2, 2, 2, 1, 1, 1. On v13, six of seven experts approve with changes; the Critical Reviewer blocks on ONE item inside the Zoho connector slice (E): full reads paged by offset under Zoho's assumed 2,000-record cap would skip the newest applications. Its proposed fix (page by `Modified_Time` with `If-Modified-Since`, no offsets; fallback: `Created_Time` descending, and a refused full read counts as completed) removes mechanisms. Since round 7 no reviewer disputes the overall architecture; each remaining objection has been a specific defect in slice E's sync rules with an agreed fix. The orchestrator stopped the rounds there. That item is **OPEN** and must be settled in E's opening spike before any E code; E is itself gated on a pilot using Zoho Recruit.

---

## A. Current project understanding

### A.1 The product

- **FACT.** HRVoice is a phone-screening product for "recruiters and hiring owners at Indian SMBs who need to phone-screen many applicants". The recruiter loop: create a job, add the description, set must-ask questions, add candidates, call by phone, review, move the candidate forward (`apps/web/PRODUCT.md` lines 11, 34). Hiring is the only live use case (`apps/web/PRODUCT.md` lines 40-41).
- **FACT, the product rule.** HRVoice never recommends hire or reject and never scores or ranks people; a person on the customer's team decides (`apps/web/PRODUCT.md` line 56; `RES/usecases/hiring.json` `result.summaryInstruction`, `result.adviceGuard`).
- **FACT.** There are no integrations of any kind today: no Integrations screen, no customer webhooks, no customer API keys, no MCP server. The Tools page says "Your own systems: Later"; the website FAQ says ATS integration is "Not yet" (`apps/web/app/tools/page.tsx` lines 106-119; `apps/web/components/site/faq.tsx` lines 53-55).
- **FACT.** Candidates enter by hand only, always inside one job: a one-person form, a CSV file or pasted rows with a preview step, or a resume (product map §4.3). Results are read only inside the app: no export, no push (product map §1 item 3; backend map §1 item 5).
- **FACT.** Every phone call starts from one person's click. Automatic retry is off (`RES/usecases/hiring.json` line 136, `"enabled": false` under `retry`) and nothing dispatches it: the only reference to `scheduled_calls` in Java is an insert, so no code reads it (`JAVA/voice/VoiceSessions.java` line 587; v13 §6.1).

### A.2 The code

- **FACT.** Monorepo: `apps/web` (Next.js), `apps/api-java` (Spring Boot 3.4.5 on Java 17 with Spring AI 1.1.8, `apps/api-java/pom.xml`), `apps/api` (the older NestJS API), `packages/db` (Drizzle SQL migrations `0000` to `0030`). One Postgres database (backend map §2, §3.3).
- **FACT.** Production still builds and routes only the Nest API (`Dockerfile` line 61 `CMD ["node", "apps/api/dist/main.js"]`; `docker/Caddyfile` sends `/backend/*`, `/webhooks/*`, `/health`, `/api/auth/*` to `api:3001`). ADR-008 (the Java backend) is PROPOSED (`BRD's/10_ADRs/ADR-008-java-spring-ai-backend.md`). So nothing in this plan reaches customers until Java serves production ("gate P").
- **FACT.** Every tenant table has forced row-level security keyed on `current_org_id()`, set only by `JAVA/platform/Db.java`; no code path bypasses it (backend map §3).
- **FACT.** The only caller identity is a browser session. There are no API keys, OAuth clients or service accounts. System work runs as `Db.NIL` with a NULL audit actor (backend map §1 item 3, §3.1).
- **FACT.** A durable Postgres job queue exists (`background_jobs`, kinds `email` and `document`, idempotency keys, backoff, dead rows; `MIG/0030_background_jobs.sql`, `JAVA/jobs/JobQueue.java`).
- **FACT.** There is one inbound webhook, the voice provider's, verified by HMAC (backend map §1 item 8). In-process events `call.started`, `call.ended`, `result.ready` exist and are only logged (`JAVA/engine/DomainEvents.java`).
- **FACT.** Each agent version has one hosted ElevenLabs agent, compiled once at provisioning. The live agent gets only `end_call`, `voicemail_detection` and `transfer_to_number`; no customer tool reaches a live call (`JAVA/engine/CallContextCompiler.java` lines 26-37, 220-237). One provider account and one calling number serve every workspace (`JAVA/voice/HostedVoiceAdapter.java` lines 47-49, 253-256).
- **FACT.** `integrations.read/create/update/delete` permissions are seeded and unused (backend map §1 item 10). The spec already says machine access uses "hashed, scoped, revocable API keys bound to an organization" (`BRD's/04_DATABASE_API_SPEC.md` line 410), and MCP is "a façade later" (`docs/superpowers/specs/2026-09-16-hiring-production-launch-design.md` lines 71-72).

### A.3 Gaps that shape the plan

- **FACT.** No external id or source-system field on jobs or candidates; `candidates.source` allows only `manual` and `resume` (`MIG/0015_hiring_desk_foundation.sql` line 20).
- **FACT.** `PhoneNumbers.toE164` reads only `candidates.phone` and ignores `country_code`; uniqueness is `(job_id, phone)` on raw text (research/03 C5, C6; `MIG/0018`).
- **FACT.** A result is not written atomically: `VoiceSessions.apply` writes provider data, runs the LLM extractor outside any transaction, then may write a second time (`JAVA/voice/VoiceSessions.java` lines 505-551).
- **FACT.** Results are fetched only when the provider's webhook arrives or a person opens the results page; `expireStale` fetches nothing (`JAVA/voice/VoiceSessions.java` lines 678-687; `JAVA/hiring/HiringController.java` line 271).
- **FACT.** The hosted voice adapter's fetch path has never run live (`apps/api-java/MIGRATION_STATUS.md` lines 89, 353).
- **FACT, pre-existing risks not caused by integrations.** Anyone can self-register a workspace and place calls on the shared number (item G; `JAVA/auth/BetterAuthController.java` lines 85-113). Nothing is ever purged, deleting a workspace leaves provider copies, and a restore brings back erased people (item W; `JAVA/team/Organizations.java` lines 100-107).

### A.4 The goal, restated

"Connect your system once, data flows in, the agent works, results flow back" is **a sync problem, not an AI problem**. It needs a machine identity, provenance (external ids), a durable record of what is still to be sent, a way to send it, and one adapter per named system. MCP provides none of the delivery, retry or sync parts (FACT: "a broken response stream loses the in-flight request", https://modelcontextprotocol.io/specification/2026-07-28/changelog; v13 §1 item 1).

---

## B. Research findings (facts with sources)

### B.1 Zoho Recruit (the default first connector)

| Finding (FACT unless marked) | Source |
|---|---|
| OAuth 2.0 authorization code grant; separate data centres including India; the authorization response carries `location` and `accounts-server`, which later calls must use | https://www.zoho.com/recruit/developer-guide/apiv2/multi-dc.html |
| "Each access token is valid for only an hour" | https://www.zoho.com/recruit/developer-guide/apiv2/access-refresh.html |
| A refresh token needs `access_type=offline` and `prompt=consent` | https://www.zoho.com/recruit/developer-guide/apiv2/auth-request.html |
| "A 'User' in an organization can have a maximum of 20 refresh tokens"; the 21st deletes the first; at most five created a minute | https://www.zoho.com/recruit/developer-guide/apiv2/refresh.html |
| Zoho Accounts help: "A client ID can have a maximum of 20 active refresh tokens." This conflicts with the line above; which one applies is **unverified** | https://help.zoho.com/portal/en/kb/accounts/faqs-troubleshooting/faqs/oauth/articles/will-the-refresh-tokens-expire |
| Revoke is a POST to `{Accounts_URL}/oauth/v2/token/revoke?token={refresh_token}` (token in the query string) | https://www.zoho.com/recruit/developer-guide/apiv2/revoke-tokens.html |
| Get Records costs 3 credits; Free plan 5,000 credits a day; concurrency 5-20 | https://www.zoho.com/recruit/developer-guide/apiv2/limits.html |
| Free plan: 1 active job, 5,000 credits a day, no webhooks. Webhooks only on Professional (10,000 calls a day) and Enterprise (20,000) | https://www.zoho.com/recruit/plan-comparison.html |
| Get Records accepts `If-Modified-Since` ("To get the list of recently modified records") and `fields`; "The page and per_page parameter is used to fetch records according to their position"; `per_page` default 200; `approved` defaults to true | https://www.zoho.com/recruit/developer-guide/apiv2/get-records.html |
| Zoho CRM and Zoho's vertical-solutions APIs need a `page_token` beyond 2,000 records. The Recruit page documents only `page` and `per_page` and no depth limit, so a cap is **unverified** for Recruit | https://www.zoho.com/crm/developer/docs/api/v8/get-records.html, https://www.zoho.com/developer/docs/vertical-solutions/api/v6/get-records.html |
| "304 Not Modified" and "204 No Content" are documented replies, not errors | https://www.zoho.com/recruit/developer-guide/apiv2/status-codes.html |
| Create Notes supports candidate, jobopenings and other modules, **not applications**, linked by `Parent_Id` | https://www.zoho.com/recruit/developer-guide/apiv2/create-notes.html |
| A Candidate's notes can be listed per record (Get Related Records). "Only admin users can fetch the records from the Notes module" through Get Records; whether that also limits the per-record list is **unverified** | https://www.zoho.com/recruit/developer-guide/apiv2/get-related-records.html, https://www.zoho.com/recruit/developer-guide/apiv2/get-records.html |
| Change Status supports candidate, application, jobopening and offer, with `ids`, `jobids`, `Candidate_Status`, `comments`; it needs `ZohoRecruit.modules.all` or the application update scope | https://www.zoho.com/recruit/developer-guide/apiv2/change-status.html |
| The Applications module is on by default for new sign-ups; existing accounts must activate it ("will significantly change your interface"), through a test environment and a scheduled migration; by default only Standard and Professional in India, Europe and USA, others through Zoho support. Its Hiring Pipeline adds the stages Hired, Rejected, archived and offered | https://help.zoho.com/portal/en/kb/recruit/talent-management/applications/articles/enabling-the-applications-module |
| Application fields can be "Inherited" from the Candidate (a Mobile changed on the Candidate changes it in her applications) or copied at job association | https://help.zoho.com/portal/en/kb/recruit/talent-management/applications/articles/customizing-applications-in-zoho-recruit |
| Merging duplicates links related records to the master; merged records "will be deleted permanently" | https://help.zoho.com/portal/en/kb/recruit/essentials/duplicate-check/merge-duplicate-records/articles/merging-duplicate-records |
| The organisation endpoint shows no documented org id and needs the extra scope `ZohoRecruit.org.all` | https://www.zoho.com/recruit/developer-guide/apiv2/get-org-data.html |
| Kombo's Zoho Recruit connector: custom application stages on paid plans "are not available through the public API" | https://docs.kombo.dev/ats/connectors/zohorecruit |
| Evidence that Indian SMBs use Zoho Recruit is vendor-written ("the default standalone ATS for Indian SMEs"), so pilots must confirm it | https://www.thehirehub.ai/blog/best-applicant-tracking-system-india-2026, https://babblebots.ai/blog/ats-integration-darwinbox-keka-zoho-recruit |

### B.2 Other hiring systems

| Finding | Source |
|---|---|
| Greenhouse Harvest v1/v2 "deprecated and unavailable after August 31, 2026"; v3 is OAuth; third-party products need "a signed Greenhouse partnership agreement" | https://support.greenhouse.io/hc/en-us/articles/360029266032-Harvest-API-overview, https://harvestdocs.greenhouse.io/docs/harvest-partner-oauth.md |
| Greenhouse webhooks do not guarantee delivery | https://docs.greenhouse.io/webhooks.html |
| Lever: "OAuth is part of our partner integration program"; 10 requests a second per key | https://hire.lever.co/developer/documentation, https://hire.lever.co/developer/oauth |
| Keka Hire: the API is a paid add-on; only the Global admin creates keys; 50 requests a minute | https://help.keka.com/hc/en-us/articles/39946790747665-Getting-Started-with-Keka-API, https://developers.keka.com/reference/rate-limit.md |
| Darwinbox API access is "request-only" (page reported by search, details **unverified**) | https://api-docs.darwinbox.com/ |
| Naukri RMS: no public developer documentation found | research/01 §2.2 |
| Freshworks is ending Freshteam and stopped renewals from 7 March 2026 | https://www.peoplematters.in/news/business/freshworks-to-end-freshteam-hr-product-stop-renewals-from-march-2026-47939 |
| Workable webhook subscriptions are created by API | https://workable.readme.io/reference/webhook-subscriptions-candidates-employees.md |
| Competitors write verdicts back ("AI interview score … recommended disposition (Proceed / Hold / Reject)"; "automatically moves candidates to appropriate next stages"). HRVoice does the opposite | https://babblebots.ai/blog/ats-integration-darwinbox-keka-zoho-recruit, https://www.kombo.dev/case-study/how-classet-built-their-real-time-phone-screening-with-kombo |

### B.3 Unified APIs (buy instead of build)

| Finding | Source |
|---|---|
| Merge: 3 production linked accounts free; Launch $650 a month for up to 10, then $65 each; daily sync on Launch; Zoho Recruit listed as Beta | https://www.merge.dev/pricing, https://www.merge.dev/integrations/zoho-recruit |
| Kombo: no public price, free proof of concept; lists Zoho Recruit, Greenhouse, Lever, Workable; not Keka, Darwinbox, Freshteam or Naukri RMS | https://www.kombo.dev/pricing, https://www.kombo.dev/integrations |
| Where these vendors store candidate data is **unverified**; ADR-006 requires India-region compute | `BRD's/10_ADRs/ADR-006-hosting-deployment.md` |

### B.4 MCP and the voice provider

| Finding | Source |
|---|---|
| The current MCP revision is 2026-07-28; it is stateless; "A broken response stream loses the in-flight request; clients MUST re-issue it" | https://modelcontextprotocol.io/specification/2026-07-28/changelog |
| "Authorization is OPTIONAL for MCP implementations"; HTTP implementations SHOULD conform (OAuth 2.1, RFC 9728); Dynamic Client Registration is deprecated in favour of Client ID Metadata Documents | https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization |
| A human SHOULD be able to deny tool calls; servers MUST "Sanitize tool outputs" | https://modelcontextprotocol.io/specification/2026-07-28/server/tools |
| ElevenLabs agents can call MCP servers; the approval mode "Always Ask (Recommended)"; MCP is not available under Zero Retention Mode | https://elevenlabs.io/docs/agents-platform/customization/tools/mcp |
| Vendor MCP servers (Ashby, Zoho Recruit, Greenhouse beta) are scoped to a user's own permissions and serve that user's AI assistant | https://docs.ashbyhq.com/ashby-mcp-server-beta, https://www.zoho.com/recruit/mcp.html |
| The Twilio and Exotel outbound-call routes accept `conversation_initiation_client_data`; whether the override applies on a live Exotel call is **unverified** | https://elevenlabs.io/docs/api-reference/integrations/twilio/outbound-call, https://elevenlabs.io/docs/api-reference/integrations/exotel/outbound-call |
| A conversation delete endpoint exists; whether it removes audio, transcript and backups is **unverified** | https://elevenlabs.io/docs/api-reference/conversations/delete |

### B.5 Webhooks, OAuth, files and iPaaS

| Finding | Source |
|---|---|
| Standard Webhooks: headers `webhook-id`, `webhook-timestamp`, `webhook-signature: v1,<base64 HMAC-SHA256>`; receivers dedupe on `webhook-id`; thin payloads are "more future proof" | https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md |
| Stripe lists events "going back up to 30 days" with cursor paging: the "poll for changes" pattern | https://docs.stripe.com/api/events/list |
| RFC 9700: PKCE, exact redirect URIs, one-time `state`, bind the flow to the user agent | https://datatracker.ietf.org/doc/html/rfc9700 |
| Token requests are sent as a form body | https://datatracker.ietf.org/doc/html/rfc6749#section-4.1.3 |
| SSRF: check every resolved address, no redirects | https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html |
| CSV cells starting with `=`, `+`, `-`, `@` can execute as formulas | https://owasp.org/www-community/attacks/CSV_Injection |
| "Webhooks by Zapier" is premium, not on the Free plan | https://help.zapier.com/hc/en-us/articles/8496326446989-Send-webhooks-in-Zaps |
| AWS EventBridge API destinations authenticate with an API key, time out at 5 s and retry 409 | https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-api-destinations.html |
| n8n can be self-hosted for free | https://docs.n8n.io/deploy/host-n8n |

### B.6 Firewalled systems and databases

| Finding | Source |
|---|---|
| Products that reach firewalled systems make the customer side dial out (Workato's agent "only makes outbound connections"; Microsoft's gateway polls) | https://docs.workato.com/on-prem.html, https://learn.microsoft.com/en-us/data-integration/gateway/service-gateway-onprem-indepth |
| An inactive logical replication slot keeps WAL and fills the customer's disk | https://debezium.io/documentation/reference/stable/connectors/postgresql.html |
| `default_transaction_read_only` can be changed per session, so it is not a security boundary | https://www.postgresql.org/docs/current/runtime-config-client.html |

### B.7 Law and regulation

| Finding | Source |
|---|---|
| TRAI TCCCPR Second Amendment (12 Feb 2025): advance written notice before using auto-dialers or robo-calls. Whether a screening call to an applicant falls under it is **unverified** (needs legal advice) | https://trai.gov.in/sites/default/files/2025-02/Regulation_12022025.pdf |
| ASSUMPTION: HRVoice is the employer's data processor under India's DPDP Act. Needs a lawyer | v13 §5, §11.1 item 10 |

### B.8 Database behaviour the design relies on

| Finding | Source |
|---|---|
| A unique index treats NULLs as distinct by default | https://www.postgresql.org/docs/current/indexes-unique.html |
| Under READ COMMITTED a waiting UPDATE re-checks its WHERE clause against the updated row, but "does not see effects of those commands on other rows" | https://www.postgresql.org/docs/current/transaction-iso.html#XACT-READ-COMMITTED |
| `GREATEST` ignores NULLs | https://www.postgresql.org/docs/current/functions-conditional.html |
| PgJDBC's `logServerErrorDetail` default "may include sensitive details such as query parameters" | https://jdbc.postgresql.org/documentation/use/ |

---

## C. Integration approaches considered

| Approach | Verdict | Why |
|---|---|---|
| **REST APIs** | **MVP, gated on a pilot.** As a client of a vendor's REST API: the Zoho connector (slice E). Our own public API `/v1` (seven routes): the developer slice (Dev), built only when a pilot will connect through its own developer or an iPaaS | Vendor REST is the only documented way to read applicants and write notes. Our API serves any custom system, script or iPaaS with one build. Every route is a long-term promise, so it stays at seven routes with a versioned path (v13 §6.6; D1, D4) |
| **OAuth** | **MVP as a client** (with slice E: code + PKCE, one-time `state`, exact redirect URI, fixed narrow scopes). **Later as a server** (only if remote MCP or a marketplace needs it) | Zoho Recruit is self-serve OAuth with an India data centre (B.1). Running our own authorization server costs more than the MVP and nothing needs it yet; the MCP server, if built, uses a static key (v13 §8, §11.1 item 4) |
| **API keys** | **MVP in the Dev slice** | The spec already decided hashed, scoped, revocable, org-bound keys. A key acts as its creator, re-checked on every request, with permissions = key ∩ creator's live permissions; presets, no admin permissions, shown once, one-year expiry (v13 §10, §11.1 item 2) |
| **Service accounts** | **No new entity (MVP)** | The API key, or the ATS connection's sending principal (`created_by_user_id`), is the principal. If that person leaves, the connection pauses (`principal_lost`) until an admin takes it over with their own sign-in, so the customer's Zoho audit trail names someone who still works there (v13 §10) |
| **Webhooks** | **Outbound: V2, conditional** (built only if a Dev pilot says polling the feed is not enough). **Inbound vendor webhooks: V2**, as re-fetch hints only | Polling is the correctness path. Zoho webhooks exist only on paid plans; Greenhouse says its webhooks do not guarantee delivery (B.1, B.2). Outbound webhooks bring customer-supplied URLs, hence SSRF; when built: Standard Webhooks signing and `SafeHttp` (v13 §6.3, §6.4) |
| **SDK / embedded** | **Avoid** | An OpenAPI file plus a curl and Python reference script cover it. No SDK, no widget (v13 §13.4; D-table) |
| **MCP** | **Avoid inside live calls. Avoid as the sync channel. Later: our own read-only MCP server** at `/v1/mcp`, when a paying customer asks | MCP does not store, retry or sync. In a live call there is no human to approve a tool call, the candidate can inject instructions, latency is audible, and tenant credentials would sit in the shared provider workspace (research/02 §3.3; v13 §8) |
| **Direct database** | **Avoid.** Only a read-only view as a Later paid exception under a signed DPA. Read-write, CDC and replication: never | Credential custody, network exposure, schema drift, load on their database; read-only session settings are not a boundary and replication slots can fill their disk (B.6; v13 §9) |
| **Event / queue** | **MVP internally: reuse `background_jobs`** with a separate integration lane; no broker, no Redis, no Kafka. **Customer buses push to `/v1`** (Dev). **Consuming a customer's broker: Avoid** | One Spring process and one Postgres. The ordered event log ships only with the Dev feed; ATS delivery is level-triggered, one row per item with its own backoff (R7.0 item 2; v13 §6.1, §6.8) |
| **Customer-side connector** | **Avoid** (our own agent) | Agents are a product line (certificates, upgrades, support). The customer's own script or iPaaS, dialling out to `/v1` and polling the feed, plays that role with nothing for us to ship (research/03 §3; v13 §9) |
| **File / SFTP** | **MVP: CSV in (exists) and results CSV out (slice A).** `text/csv` on the batch route (Dev). **SFTP pull: Later**, paid. **Hosting our own SFTP: Avoid** | Files are the universal fallback and most of the work exists. Our own SFTP server would be an internet-facing daemon next to candidate data on one VPS (research/03 F2, F4; v13 §6.7, §9) |

---

## D. Multi-agent recommendations

Agent recommendations are the seven research reports as compared in `01-comparison.md`. The final position is v13.

| Topic | Agent recommendation | Concerns | Final position |
|---|---|---|---|
| REST API | IA, AM, EA, BE, CR: MVP, small `/v1`. SA: V2. UX: no public API in MVP | Every route is a promise; per-IP limit throttles shared iPaaS IPs; results reads are bulk PII exports | Seven `/v1` routes in the Dev slice, gated on a pilot with a developer or iPaaS; per-key rate window and daily row cap; `/v1` only on `API_PUBLIC_HOST` (v13 §6.6) |
| OAuth | Client: SA, UX, BE MVP; IA, AM, EA, CR V2. Server: Later (all) | Zoho tokens last 1 hour; 20-refresh-token limit; refresh races; partner programmes for Greenhouse and Lever | Client with slice E only; refresh by compare-and-set, no lock; every sign-in asks the full scope set and must return a refresh token; replaced tokens revoked. Server: Later (v13 §5, §11.1 item 4) |
| API keys | MVP (IA, AM, EA, BE, CR); V2 (SA, UX) | Leaked key with PII permission; `Actor` assumes a member; rotation | Dev slice: key ∩ creator's live permissions, presets, no PII or admin permissions by default, "May create jobs" and "May remove people" as explicit checkboxes (v13 §11.1 item 2) |
| Service accounts | All: no new entity beyond keys or connection | NULL audit actor; creator leaving; vendor service users are admin-wide | No new entity; `principal_lost` stops every vendor call; Take over by the admin's own sign-in (v13 §10) |
| Webhooks | Outbound MVP (IA, AM, EA, BE, CR); inbound V2 or hints | SSRF on a single VPS; PII in bodies; dedupe after success | Outbound later, only if a Dev pilot needs push; inbound vendor webhooks V2 as hints; polling is correctness (v13 §6.3, §5 "Real time") |
| SDK / embedded | Avoid (most); AM Later | An ATS marketplace may want an embedded panel | Avoid; OpenAPI plus reference script |
| MCP | In-call Avoid; MCP sync Avoid; own server V2 (AM) or Later (others) | Needs an OAuth 2.1 resource server; spec churn; a customer's LLM may rank from our data; prompt injection | In-call and sync: Avoid. Own read-only server: Later on paying demand, static key, `structuredContent`, no call content in its key preset (v13 §8) |
| Direct DB | Avoid (six); EA: Later paid exception, read-only view | Credential custody, schema drift, CDC disk risk | Avoid; EA's read-only view rules kept as the enterprise answer (rung 5, Later) |
| Customer connector | Avoid (all) | A product line of its own | Avoid; the customer's script or iPaaS dialling out is rung 1 |
| Event / queue | Outbox in the business transaction (IA, AM, EA, SA, UX, CR); level-triggered sweep, no outbox (BE) | `enqueue` opens its own transaction; succeeded rows are deleted; a result is written in two transactions | Core: no ordered log; one `integration_deliveries` row per (connection, call) or (connection, candidate stage), level-triggered. Ordered `integration_events` log only in Dev, for the feed (R7.0 item 2) |
| Canonical model | Existing nouns, no separate schema (all); SA: model = field allowlist | Custom stages hidden from APIs; vendor models carry score fields | No canonical schema. Our tables are the model; `ExternalJob`, `ExternalApplication`, `ExternalStage`, `Page` live inside adapters; field allowlist (v13 §3, §4) |
| Sync engine | BE: 15-min pages with overlap; UX: 10-min poll; CR: hourly; IA, AM: V2 | Vendor credits; no per-org scheduler; clock skew | With slice E: 15-minute account-wide pulls with `If-Modified-Since`, every change read by two completed scans, one application per transaction, no credit budget (load bounded by design) (v13 §5) |
| Two-way actions | Note always (UX, BE); stage only on a human decision, opt-in, compare-and-set (CR) | Recruiter edits in the ATS; undo across systems; duplicate notes; rejection emails | Note per call (E1). Stage write-back (E2) opt-in, only `reviewed`/`declined`, from a baseline, after a 2-minute hold, only if the ATS status is where we found or left it, else a note (v13 §7) |
| Multi-tenancy | Forced RLS, never tenant from payload (all) | None beyond implementation | Every new table forced RLS, in `StructuralTest`, every foreign key cascades; tenant only from server state (v13 §2.3, §10) |
| Security | SA's MVP package plus SSRF guard and one serializer | Key rotation; PII in logs; DPDP role | Sealed secrets with a dedicated key; one serializer; removal and erasure before the first external connection; retention moved to item W (v13 §11) |
| Onboarding | One "Connected systems" tab (all); UX's 7-step Zoho flow | Error filter hides "webhook", "token", "api key"; brand names in UI | One tab; stable codes mapped to sentences; Zoho flow with the Applications-module check right after sign-in (v13 §12) |
| Build vs buy | Build behind `AtsPort`; buy at 3+ ATSs (most); BE: Kombo free POC | Per-account cost; data location | Build; a Kombo or Merge adapter later as one more `AtsPort` once three or more ATSs are requested by paying customers (v13 §3, §13.3) |
| First integration | Generic first (IA, AM, EA, CR); Zoho first (UX) | No data on which ATS customers use | Results CSV for everyone; then Zoho Recruit (E) or the developer surface (Dev), whichever a pilot confirms (v13 §1 item 3, §14.1) |
| Phone canonical form | MVP prerequisite (IA, EA, BE, CR) | `toE164` ignores the country code | Slice 0: store E.164 after a collision pre-check |
| Auto-dial on intake | V2 or Later after a founder decision (all) | Consent, DND, TRAI | Not in this plan; every call is one person's click; bulk calling is a separate, unapproved design (v13 §1 item 7) |

---

## E. Disagreements

### E.1 Where the experts started apart

`01-comparison.md` §2 lists 19 disagreements. The main ones:
- **D1, what ships first.** IA, AM, EA, CR: generic API, webhooks and CSV first. UX (and SA in scope): one named ATS connector first, no public API.
- **D2, durable outbound.** Six experts: a transactional outbox. BE: no outbox, a level-triggered sweep.
- **D3, where external ids live.** IA, EA, CR: columns on `jobs`/`candidates`. BE: link tables with sync state.
- **D4, when the public API arrives.** Five: MVP. SA, UX: V2.
- **D5-D6, real time and polling.** SA, BE: inbound vendor webhooks in MVP; others V2. Polling every 10 minutes (UX), 15 (IA, BE) or hourly (CR).
- **D9, what goes into the ATS note.** Summary, answers and link (UX, BE, IA); a coverage count (IA, flagged).
- **D10-D12, ownership and write-back.** Read-only contact fields (UX, BE) against "refresh until edited" (CR) or "overwrite" (IA); stage write-back with compare-and-set (CR), Undo reverting the ATS (UX), or a plain mapped write (IA, BE).
- **D13, MCP timing.** AM: own server V2. IA: local wrapper V2. Others: Later.
- **D15, enterprise fallbacks.** EA: database view and SFTP as paid exceptions. Others: Avoid.
- **D17, retention as a launch gate.** SA: gate the first integration on it. Others: mention only.
- **D19, unified API now.** BE: Kombo's free proof of concept. Others: Later.

### E.2 The review rounds did not converge, so the lead stepped in

Stated plainly: the first six review rounds on the full plan did not converge. Majors went 17, 12, 9, 4, 1, then back up to 5. Four of the five round-6 majors were about slice A2, "Call selected (N)", a calling-engine feature (a dispatcher, capacity control across tenants, hosted-agent lifecycle) that had grown inside the integration plan. Each fix added machinery that the next round found new holes in (`02-resolutions.md` "Round 7 (lead decision)", intro; `later-bulk-calling.md` header).

The orchestrator therefore made a binding lead decision (R7.0):
1. **Scope cut.** A2 and everything that served only A2 left the architecture for `later-bulk-calling.md`, marked NOT APPROVED. A call starts as today: a person clicks Call for one candidate.
2. **Simpler core.** No ordered event log in Core + E. ATS notes and stage write-back are level-triggered, one delivery row per item, each backing off on its own. The ordered log, per-org `seq` and the feed ship only with Dev.
3. **Pre-existing platform risk is recorded, not designed here** (self-serve calling on the shared number became item G).
4. **Remove, don't add.** Delete every mechanism that served something out of scope. Add one only to stop data being lost, leaked or sent to the wrong tenant, or the product rule being broken. Prefer existing tables, queues and code paths.

R7.2 lists 25 mechanisms removed by that decision. Rounds 7-13 on the simplified plan: majors 5, 2, 2, 2, 1, 1, 1. In the round-12 reviews all seven again said that removing A2 leaves the goal intact (R13 header). Since round 7 no reviewer disputes the overall architecture; each remaining objection has been a specific defect in slice E's sync rules, with an agreed fix.

### E.3 Where the lead declined or went beyond a reviewer (recorded, not hidden)

- **Round 6 IA-4:** auto-linking the single published agent to API-created jobs was not adopted; it conflicts with SA-4's human gate on what the agent says (R7.4).
- **Round 9 CR-9:** dropping the reconnect account check was declined; it is a wrong-tenant guard because nothing documented says Zoho record ids never repeat across Zoho organisations (v13 §5 "Same account on reconnect").
- **Round 12 IA-5 ("do not write v13"):** v13 was written because the task required it; the point was accepted as a process rule: no v14, later findings go into the errata list and the build sheets (R13.0).
- **Round 12 SA-4:** decision 16's recommended timing (before the first paid customer or general availability) was kept; SA's timing (the first workspace holding real candidates' data) is offered to the founder as the alternative, with its cost of about 1.5-2 weeks on every pilot date (R13.5).
- **Round 12 declined additions,** each a mechanism that would stop no loss or leak: a cap on `last_sync_issues` (BE-4), waiting for a form-body revoke (SA-1), a computed cookie path (SA-3), merging partial provider answers (AM-2), "stop importing new applications on a closed job" (UX-1) (R13.5).
- **Round 12 BE-6:** corrected from `coalesce` to `greatest`, because `coalesce` cannot see a missing extraction once provider usage is present (R13.5).

### E.4 What is still disputed

One item. The Critical Reviewer blocks v13 on the full-read paging rule inside slice E. Six of seven experts approve v13 with changes. The item is OPEN; see the last section.

---

## F. Resolutions

### F.1 How the original disagreements ended

| Id | Resolution in v13 | Where |
|---|---|---|
| D1 | Results CSV (A) helps everyone first. Then **either** Zoho Recruit (E) **or** the developer surface (Dev), only when a pilot confirms which path it uses. Spreadsheet pilots get CSV in and out; "connect once" is not met for them until a Google Sheet connection (V2) | v13 §1 item 3 |
| D2 | Neither pure side. Core uses BE's level-triggered delivery rows (`integration_deliveries`); the ordered event log exists only in Dev for the feed. Strict order is not needed for notes (each note is about one call) | R7.0 item 2; R3.5; v13 §6.1, §6.5 |
| D3 | Link tables `job_links` and `candidate_links` with real foreign keys and `ON DELETE CASCADE`; plus `candidates.source` values `api` and `integration` | v13 §2.3 |
| D4 | Public API and keys in the Dev slice, gated on a pilot with a developer or iPaaS | v13 §13.1 Dev |
| D5 | No real-time push in the first release; vendor webhooks V2 as hints | v13 §5 "Real time" |
| D6 | 15 minutes. The per-connection credit budget was removed (round 9 CR-4): load is bounded by design, about 17% of the Free plan's credits for windowed pulls (ASSUMPTION: three Get Records calls per poll) | v13 §5 credit arithmetic |
| D7 | Explicit permission subset from presets, capped at the creator's live permissions | v13 §11.1 item 2 |
| D8 | Feed items carry ids and state only; bodies are built at read time by `ExternalPayloads` for the calling key under the export rule; phone and email never travel in the feed or webhooks | v13 §6.2, §6.5 |
| D9 | Outcome, answers and a sign-in link. **No summary**: the stored summary is the voice provider's, not ours. No coverage count | v13 §1 item 5, §6.2 |
| D10 | Read-only in HRVoice while the ATS still feeds that person; `candidates.managed_externally` | v13 §4 |
| D11 | ATS stage changes never change our stage; Hired, Rejected or Archived marks the row closed and blocks dialing | v13 §5 "Status changes" |
| D12 | E2: opt-in, from a baseline, 2-minute hold (so in-app Undo writes nothing), write only if the live ATS status is the trigger status or the one we last wrote, otherwise a note | v13 §7 |
| D13 | MCP Later, on a paying customer's request, read-only | v13 §8 |
| D14 | Not part of this plan (dial-time candidate data was proposed as V2 product work in `01-comparison.md`) | 01-comparison D14 |
| D15 | Avoid for MVP and V2; EA's ladder kept as the enterprise answer | v13 §9 |
| D16 | Narrowing the voice webhook's time window waits until the vendor's retry timestamps are known; since slice 0's answers filter, a replay cannot change stored answers | v6 §11.1 item 11 (kept by v13); v13 §17 |
| D17 | Retention is **not** an integration gate (round 10 CR-1): it would change what every workspace keeps, connected or not. It is item W, founder decision 16. The integration gate is removal, one erasure path, provider deletes and the DPA | v13 §11.1 item 10, §13.1 W |
| D18 | Neutral event names `call.ended` and `contact.stage_changed` with `useCase` in the body | v13 §4 |
| D19 | Build behind `AtsPort`; revisit at three or more ATSs requested by paying customers | v13 §3, §13.3 |

### F.2 Later rounds that changed the plan (highlights)

- **Notes go on the Zoho Candidate record, not the application** (round 8): Create Notes does not support applications (B.1).
- **No ATS signal erases anything** (round 9 EIA-1, SA-1 majors): a merge or a recycle-bin deletion later undone must never erase a live person. Erasure only by "Remove this person" (or a `/v1` deletion in Dev).
- **Stage write-back split into E2** (round 9 EIA-4, UX-4): it is the most rule-dense part and results flow back without it.
- **Contact fields re-read from the parent Candidate** (round 10 IA-1, EIA-1).
- **Every change read by two completed scans; a scan cut short never moves the window** (round 10 EIA-2, CR-3).
- **Retention moved out of Core into item W** (round 10 CR-1 major).
- **A job linked after setup is read in full** (round 11 UX-1), **twice even when linked during a scan** (round 12 EIA-3, CR-2 b).
- **The Applications-module check moved to right after sign-in** (round 12 UX-2).
- **Jobs closed in the ATS are still read** (round 12 UX-1, the last major).
- **The nightly complete listing and the `missing` state moved to V2** (round 12 IA-3): they prevent none of the four harms.
- **One filter on provider answers** replaced two mechanisms (round 12 AM-1, EIA-2, BE-2, CR-1, IA-2): `apply` keeps only answers under the call's own question keys with a present value, and never replaces stored answers.

### F.3 Still OPEN

The full-read paging rule in slice E (Critical Reviewer). See "Open before Zoho work".

---

## G. Final consensus architecture

### G.1 Principles (v13 §1)

1. A sync problem, not an AI problem.
2. Everything inside `apps/api-java`, on the same Postgres. No new service, broker, Redis, Kafka or workflow engine. Reuse `Db.inOrg` and forced RLS, `background_jobs`, `AuthInterceptor`, `AuditService`, `AdviceGuard` and the CSV-import validation.
3. Order of work: gate P, then slice 0, then slice A, then, only when a pilot confirms its path, Core plus either the Zoho connector (E) or the developer surface (Dev). Nothing reaches customers before gate P.
4. Data flows one way per field: jobs and contact details in; call results and human decisions out.
5. Only facts and decisions a named person made leave HRVoice: never `fitPercent`, coverage, a score, a rank, "qualified", a system-chosen stage, or the provider-written summary. One serializer builds every outbound body.
6. Results flow back even if nobody opens HRVoice: a background job fetches results whose provider webhook was lost. If no result can be fetched, the customer gets "result unavailable", not silence.
7. Calls start from a person, as today: one Call click per candidate.
8. Outbound problems never stop inbound data, and one failing item never stops the others.
9. MCP: never inside a live call, never as the sync channel; our own read-only server later.

### G.2 Picture (v13 §2.1)

```
 CUSTOMER SIDE                               HRVOICE (apps/api-java: one Spring process, one Postgres, forced RLS)

 Own app / script / iPaaS  [Dev, gated]      EdgeFilter (per-key window on /v1) ─► AuthResolver: key hash ─► creator's live
   PUT/DELETE /v1/candidates/by-external ──►   membership ∩ key permissions ─► AuthInterceptor (same PII rules, same audit)
   POST /v1/candidates:batch                   CSV-import validation ─► Db.inOrg ─► jobs / candidates + job_links / candidate_links
   GET  /v1/events?after= ◄── integration_events (Dev only: ids + state, per-org seq, 30 days)                │
                                                                                                             ▼
 SaaS ATS  [E, gated]                        a person clicks Call for one candidate (existing route) ─► dialLocked ─► voice provider
   poll If-Modified-Since ◄── pull:<conn> (applications, candidates, jobs)                                   │
   one note per call ◄──────────┐            provider webhook, or fetch_results:<org> (lane) ─► apply() ─► voice_sessions
   stage: opt-in, a person's    │                                                                            │
   decision, 2-minute hold ◄────┤            60 s tick, database only, orgs with a live connection:          ▼
                                │              upsert integration_deliveries rows (per call; per candidate stage)
                                │              Dev: emit call.ended into the event log
                                │              after commit: enqueue send:<conn>, pull:<conn>, fetch_results:<org>
                                └─────────── send:<conn> on the integration lane (own 2 threads): due items, each with its own backoff
```

### G.3 Components (new code in `JAVA/integrations/` unless named; v13 §2.2)

| Component | Responsibility | Slice |
|---|---|---|
| `CallOutcomes.outcome` | One outcome word per call (`completed`, `no_conversation`, `result_unavailable`, a failure reason, `content_erased`) for the board, results, CSV and every outbound body; `Jobs.callStatus` keeps its four values | 0 |
| `ExternalPayloads` | The single builder of every outbound body, checked against the receiving principal's current permissions: no summary, answers only to the job's own questions, public decision values, plain text, fail-closed sensitive-read audit | 0 |
| Extractor and adapter fixes | Answers only from the provider's `value`/`result`/`answer`; `apply` stores only the call's own answers and never replaces stored ones; `deleteConversation` for erased calls (Core) | 0, Core |
| Prompt fence fix | Role block with the job title inside it, and company facts, fenced; extraction never rates the candidate | 0 |
| `Sealer` (`JAVA/platform/`) | AES-256-GCM, versioned key, per-row AAD, re-seal command (generalises `Notifications.seal/open`) | E or Webhooks, whichever first |
| `JobQueue` changes | Kind `integration` claimed only by a separate 2-thread lane; round-robin over orgs; each thread claims only the job it runs; honours `JOBS_ENABLED`; survives any error | Core |
| `Connections` | Connected systems: status, sealed secrets, Take over, the reconnect account check, one revoke rule for replaced tokens | Core |
| `IntegrationScheduler` | 60-second tick, database only, one transaction and one try/catch per org: delivery rows (E), events (Dev), then enqueue due lane jobs after commit | Core |
| `IntegrationWorker` | Lane handlers with per-run budgets: `pull`, `send`, `fetch_results`, `provider_delete` | Core, E |
| Erasure | One path through `DELETE /candidates/{id}` ("Remove this person") and `/v1` deletions; `voice_sessions.content_erased_at`; provider copy deleted | Core (launch gate) |
| `AtsPort`, `ZohoRecruitAts`, `FakeAts` | The connector seam, on the `VoicePorts` / `HostedVoiceAdapter` / `FakeVoice` pattern | E |
| `ApiKeys`, `AuthResolver` branch, `PublicApiController`, `Events` | Keys, seven `/v1` routes, the ordered event log and feed | Dev |
| `SafeHttp`, webhook signing | Outbound HTTP to customer URLs with the SSRF guard | Webhooks (later) |

### G.4 Data model (one additive migration per slice; v13 §2.3)

Every new table: `ENABLE` + `FORCE ROW LEVEL SECURITY`, policy `organization_id = current_org_id()`, listed in `StructuralTest`, every foreign key `ON DELETE CASCADE` (FACT why: the workspace hard delete is one `delete from organizations`, `JAVA/team/Organizations.java` lines 101-107).

| Table / change | Purpose | Slice |
|---|---|---|
| `integration_connections` | One row per (workspace, provider): status (`connecting`, `active`, `needs_attention`, `disconnected`) with a reason, sealed secrets, config, pull cursor, rate-limit and failure columns, `last_sync_issues` (ids only), OAuth state. Never deleted while the workspace exists | Core |
| `job_links` | HRVoice job ↔ ATS job opening; remote state | Core |
| `candidate_links` | HRVoice candidate row ↔ ATS application; parent Candidate id; remote state; `pushed_stage`; anonymised links keep a keyed suppression hash | Core |
| `voice_sessions.content_erased_at` | Erasure marker | Core |
| `candidates.source` CHECK, `background_jobs.kind` CHECK + `JobQueue.POLICY` | Add `api`, `integration`; add kind `integration` (both changes together, or `enqueue` throws) | Core |
| `integration_deliveries` | One row per (connection, call) for notes and per (connection, candidate) for stage; content hash, status, attempts, next attempt | E |
| `api_keys`, `integration_events`, `voice_sessions.result_emitted_hash` / `result_version` | Keys; the ordered feed log; per-call dedupe of `call.ended` | Dev |
| Phone canonical form | Store E.164 (data backfill, after a collision pre-check) | 0 |

### G.5 Connector seam and canonical model

- **FACT pattern reused:** adapters registered in a map by key, as `JobQueue` handlers register by kind (`JAVA/notify/Notifications.java` line 49). No plugin loader, no DSL.
- `AtsPort` methods: `listJobs`, `listApplications(modifiedSince)`, `listChangedParents`, `getApplication`, `listStages`, `noteMarkers`, `addNote`, `setStage`. Typed errors: `RateLimited`, `AuthRevoked`, `NotFound`, `Rejected`, `Transient`. Vendor field names and raw bodies never leave the adapter or reach logs.
- **No canonical schema.** Our tables are the model: a job (create-only copy of title and description; must-ask questions never imported), a job-scoped candidate (= one ATS application), a call result (out as a note or `call.ended`), a decision (out as a public value; only `reviewed` and `declined` ever written to an ATS).
- **Field allowlist inbound:** name, phone (E.164), email, job link, external ids, remote updated time, remote state, remote status label. Never resume text, date of birth, gender, salary, address, ATS notes, ratings or scores.

---

## H. MVP scope

### H.1 What is built first, in order (v13 §13.1)

Effort is for one engineer and is an ASSUMPTION, for ordering only.

1. **P. Java in production** (3-5 days). Java image and service; Caddy routes to Java; S3 storage as Nest uses; the hosted voice adapter fixed; an external uptime monitor; supervised live checks: one phone and one browser screen, the R18 check at three timings (does a dial for job B change call A?), a conversation id on every accepted dial, the production key deleting a test conversation. Gate: the founder accepts ADR-008, or decides to run Java while it stays PROPOSED.
2. **0. Prerequisites** (5-7 days, after P). E.164 phones; `CallOutcomes.outcome`; `ExternalPayloads` and its merge-blocking test; answers only from the provider's value fields; `criteriaSource`; the prompt fence fix; "No decision yet" label; route templates in audit rows; the question-wording hint; "never rate, score or judge" in extraction; `callStatus` kept at four values; the repeated-key and scrub rules; `apply`'s answers filter.
3. **A. Results CSV export** (1-2 days, after P). A button on the job's board; rows built by `ExternalPayloads`; answers and contact columns by permission; re-importable; formula cells escaped.
4. **G and W, pre-existing launch gates, not designed here.** G: who may place real calls from self-registered workspaces (decision 15; recommended no later than gate P; 1-2 days). W: retention, workspace deletion and restore (decision 16; recommended before the first paid customer or general availability; about 1.5-2 weeks).
5. **Core** (about 2-2.5 weeks), built only **together with** the first of E or Dev, never alone; goes live only once Nest is no longer routed in production. Migration; the integration lane; the 60-second tick; `fetch_results` with `reconcileSystem`; the erasure path as "Remove this person"; `provider_delete`; vendor token revoke on workspace deletion and the hard-delete test; `apply`'s second write skips erased calls; the ledger keeps the larger LLM figures; removing the Nest service.
6. **E1, first named connector: Zoho Recruit** (about 2.5-3 weeks), only for a pilot on Zoho Recruit **with the Applications module on**, and after the R18 check passed or the founder picked a fix. Starts with a spike of about a day; E's build sheet is written after it, every branch resolved, the OPEN item included. Contents: OAuth and sealed tokens; pulls; unlinking; reconnect check and Take over; closed rows not dialable; notes on the Candidate record; read-only linked fields; the Connected systems tab; one admin email on any `needs_attention`; per-call delivery line.
   **Or Dev, developer surface** (about 3 weeks), only for a pilot with its own developer or an iPaaS: keys, seven `/v1` routes, the event log and feed, OpenAPI file, reference script, "Your own system" screen.
7. **E2, stage write-back** (about 1-1.5 weeks), after E1, once founder decision 7 is answered.
8. **Webhooks** (about 1 week), only if the Dev pilot says polling the feed is not enough.

**Quote to a Zoho pilot after gate P:** slice 0 + Core + E1, about 5.5-7 weeks (ASSUMPTION), plus item W for a paying pilot; say whether item G is done. Quote only after gate P's live calls (with R18) worked, E's spike and sheet re-estimated it, the pilot confirmed the Applications module is on, and the founder answered decision 10b.

**Launch gates:** P before any slice reaches production; G before self-registered workspaces can place calls; W before the first paid customer or general availability (recommended); removal, erasure, provider deletes and the DPA before the first external connection; Nest no longer routed before Core.

### H.2 Explicitly not in the MVP

- Calling many people with one click ("Call selected (N)"): `later-bulk-calling.md`, NOT APPROVED.
- Automatic calling of imported candidates (founder decision 10, legal advice).
- Any summary leaving HRVoice; any score, coverage, rank or verdict leaving HRVoice.
- Real-time vendor webhooks (Zoho's are on paid plans only).
- Detecting deletions in the ATS, the nightly complete listing, the `missing` state, and automatic erasure when the ATS deletes a person.
- A second connector; Zoho accounts without the Applications module; a Google Sheet connection.
- MCP of any kind; in-call tools; SDKs; a rules builder; a field-mapping editor.
- Importing resume text; more than one trigger status; per-call "Send again".
- Retention purges, workspace-level provider cleanup and the restore re-apply (item W, outside this plan).

---

## I. V2 scope

From v13 §13.2. Each only on pilot evidence, and each with its own design and review where noted.
- A second connector chosen by pilot data (Keka Hire, Workable).
- A Google Sheet connection for spreadsheet pilots, as its own slice.
- Bulk calling, only after its own design and review (`later-bulk-calling.md`, NOT APPROVED).
- Automatic erasure when the ATS deletes a person, after its own spike and review.
- The nightly complete listing and `missing` (noticing people deleted or merged away), after its own spike and review.
- Per-job "Call new people automatically", only after bulk calling exists and a written founder decision with legal advice.
- A workspace do-not-call list and an admin lookup of one person across jobs (decision 9).
- Inbound vendor webhooks as re-fetch hints.
- Our own call summary, if a pilot wants summaries in the ATS or feed.
- Sending decisions made before write-back was switched on, as an explicit choice.
- Storing the ATS status the decider saw, so an ATS automation's status can still be overwritten.
- Fetching missing results when a CSV is exported without a connection.
- Leaving ATS-decided rows out of "Ready for review".
- A card line for unlinked new job openings.
- Importing resume text.
- More than one trigger status (needs E2's overwrite rule restated first).
- Zoho Recruit accounts without the Applications module.
- Our own Zapier app; SNS and Pub/Sub envelopes; per-key limits in Postgres once there is more than one replica; per-call "Send again"; "Cancel removal" for `/v1` removals; "Also remove the people from this connection" on disconnect; a checksum suffix on keys; `apiKeyId` in service-level audit rows.

---

## J. Long-term architecture

### J.1 Later (v13 §13.3, §11.2)

- Our own read-only MCP server at `/v1/mcp`, on the same services, interceptor and `ExternalPayloads`, with an "AI assistant (read-only)" key preset (no call content, no contact details, 90-day expiry at most), the `Origin` check, results as `structuredContent`. If OAuth ever replaces the static key: Client ID Metadata Documents, not Dynamic Client Registration.
- A Kombo or Merge `AtsPort` once three or more ATSs are requested by paying customers.
- Greenhouse and Lever through their partner programmes; Darwinbox.
- Enterprise rungs: a narrow HTTPS endpoint of the customer's that we call (rung 4, `SafeHttp`), a read-only database view under a DPA (rung 5).
- In-call tools (for example booking an interview slot), designed then.
- Enterprise security: KMS envelope encryption once hosting moves to AWS `ap-south-1`; customer-managed keys; SSO/SAML; IP allowlists on keys; a static egress IP; an egress proxy in front of `SafeHttp`.
- A CRM contact/deal shape when SalesVoice or SupportVoice need it.

### J.2 Known ceilings and their upgrade paths (`ponytail:` notes in v13)

| Ceiling | Upgrade when it bites |
|---|---|
| The tick and lane open one short transaction per org (about three a minute per signed-up workspace) | Past about 1,000 active orgs: a SELECT-only lookup of orgs with a live connection or a queued integration job (the `MIG/0022` pattern) |
| 20 Zoho connections per OAuth client, if the limit is per client (unverified) | Before the 15th production connection: Zoho support's answer; then more registered clients or Zoho's multi-organisation or Marketplace model (unverified) |
| No Zoho credit counter | Add one in `cursor` if a pilot hits 429s |
| A process crash during `addNote` can leave one duplicate note | Accepted: a duplicate is not a loss, leak or wrong-tenant send |
| `last_sync_issues` is uncapped jsonb | Cap it or move it to a table if a pilot has hundreds |
| Discovery rehashes up to 7 days of linked calls each minute | A dirty flag set by `apply` |
| One Spring scheduler thread | Set `spring.task.scheduling.pool.size` if lag is seen |
| An ATS automation that moves new applications turns decisions into notes | Store the status the decider saw (V2) |

### J.3 Avoid (v13 §13.4)

In-call MCP; MCP-based sync; direct DB access beyond the paid read-only exception; CDC; consuming customer brokers; our own on-prem agent; hosted SFTP; SDKs and widgets; a rules builder; a cross-vendor canonical schema or field-mapping editor; two-way editing of the same field; auto-rejecting people who did not answer; writing any score, coverage, rank, "qualified", vendor-written summary or system-chosen stage outside; Freshteam and Naukri RMS connectors.

### J.4 Risk register (v13 §15, condensed)

Lifted from v13 §15; mitigations shortened. Where this table and v13 §15 differ, v13 wins.

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R1 | Pilots do not use Zoho Recruit (or any ATS), or use it without the Applications module; a connector is built for nobody | Medium / High | E and Dev each gated on a pilot; decision 1 asks about the Applications module (FACT: existing accounts do not have it by default; v13 §12.2 step 2); 0 and A serve everyone |
| R2 | Duplicate notes in a customer's system | Medium / High | One delivery row per (connection, call) with compare-and-set on its hash; markers checked after an uncertain attempt; `sent` rows kept on unlink. Ceiling: a crash during a write, or a restore, can give one duplicate |
| R3 | Advice or a score leaks into an ATS, or into a live call | Medium / High | No summary leaves; answers only from the job's own questions (`criteriaSource`), never `rationale`; scrub as backstop; evaluative-corpus test; prompt fence fix; human agent linking. Residual: an evaluative question ("Rate their English 1-10") yields a judgement as the "answer"; wording hint and "never rate, score or judge" reduce it |
| R4 | Duplicate candidates and misdialed numbers from automated intake | High / High | E.164 with the collision pre-check (slice 0) |
| R5 | A connection silently stops | Medium / High | `needs_attention` with a reason, one email, "last checked", Take over, failed and expired lines, per-call delivery line |
| R6 | We exhaust a small customer's Zoho daily credits (shared with their other Zoho integrations) | Medium / Medium | Load bounded by design: about 17% of the Free plan for windowed pulls (ASSUMPTION, v13 §5), bounded full reads, one write per note; 429 → "Paused until". `ponytail:` a credit counter if a pilot hits 429s |
| R7 | SSRF from a customer-supplied URL | Low until webhooks / High | Webhooks deferred; `SafeHttp` when built |
| R8 | Personal-data sprawl and DPDP exposure | High / High | Field allowlist; ids-only rows; bodies built at send time; one erasure path that reaches the provider; no raw vendor bodies or token URLs in logs; removal gate before any external connection; DPA and runbook (v13 §11.1 item 10). Retention, workspace cleanup, restore: item W |
| R9 | Pressure to auto-call imported candidates before consent and DND are settled | High / High | Every call is one person's click; bulk calling is a separate, unapproved design; auto-call is V2 behind decision 10 |
| R10 | Nest and Java run side by side | Medium / Medium | Slices 0 and A need no schema migration; Core goes live only once Nest is no longer routed |
| R11 | Stage drift: a customer renames a status | Medium / Medium | Status list read live; unmapped → `status_unmapped`, stage pushes stop, notes continue; a remap does not re-baseline |
| R12 | The public API becomes a promise we cannot change | Medium / Medium | Seven routes, versioned path, public decision values, documented feed semantics |
| R13 | Failures are invisible | High / Medium | Status with a reason, one admin email, delivery and issue lines, uptime monitor with the `jobsBacklog` alert, lane loops that survive errors. `ponytail:` no heartbeat for a hung tick until one is seen |
| R14 | Vendor API churn | Certain over time / Medium | One connector until it has paying use; vendor code inside one adapter |
| R15 | A customer's own LLM ranks candidates, or is steered by text, from data we export | Medium / Medium | Factual bodies without summaries; content only under the export rule; MCP preset carries no content; "treat as data" line in reference docs; MCP results as `structuredContent` |
| R16 | The hosted adapter's fetch path has never run live, and background fetch depends on it (FACT, `apps/api-java/MIGRATION_STATUS.md` lines 89, 353) | Medium / High | Gate P live checks with the adapter fix-up in scope; `FakeVoice` tests; `result_unavailable` after 90 minutes |
| R17 | One tenant's slow vendor delays others | Medium / Medium | Round-robin lane, per-run budgets, per-item backoff, HTTP timeouts |
| R18 | Pre-existing, made more likely by E: a call runs with another job's script when jobs share one hosted agent (FACT, `JAVA/voice/VoiceSessions.java` `provisionLocked`, lines 154-219; late binding unverified) | Medium / Medium | Slice 0 stores only answers under the call's own keys; gate P's three-timing check; if calls change mid-call, step 7 does not pre-select a shared agent and E is not quoted until the founder picks a fix |
| R19 | Erasure at the voice provider is incomplete (backups, retention) | Unknown / High | Documented conversation delete for every erased call, retried; removal copy says "we ask"; DPA. Provider retention backstop and workspace-level deletes: item W |
| R20 | A workflow acts on an undone decision, or a decision made again is lost | Medium / High | Write-back reads current state after a 2-minute hold; every close sets the hash to `pushed_stage`; the feed's hold plus `superseded` |
| R21 | One note the vendor always refuses with a transient error | Low / Medium | Per-item backoff; `expired` and shown after 7 days |
| R22 | Pre-existing: self-registered workspaces place real calls on the shared provider account and number; abuse could get the number blocked and run up spend | Medium / High | Item G and decision 15 |
| R23 | Production still runs only Nest, so none of this reaches customers | Certain until gate P / High | Gate P |
| R24 | Pre-existing (item W): nothing is purged; deleting a workspace leaves provider copies and stored documents; a restore brings back erased people | Low to Medium / High | Item W and decision 16; until then the DPA states the gaps; integration parts recover after a restore by themselves; `EVENTS_EPOCH` (Dev) |
| R25 | "Connect once" still leaves one Call click per imported candidate | Certain / Medium | Imported people appear ready to call; decision 10b before any quote; bulk calling designed and reviewed separately |
| R26 | A stage write-back overwrites a decision made in the ATS, or emails a rejection to someone already hired | Medium / High | `setStage` only on an open application whose live status is the trigger status or the one we last wrote, otherwise a note; reconnect re-baselines; 7-day expiry. Ceiling: an ATS automation turns decisions into notes |
| R27 | An ATS signal (a merge, a recycle-bin deletion later undone, an ambiguous reply, a wrong-account reconnect) erases a live person's call content | Low / High | No ATS signal erases anything; erasure only by "Remove this person" or a `/v1` deletion; no ATS read touches an anonymised link. Cost: a person deleted in Zoho stays, callable by a click, until removed (decision 9) |
| R28 | Zoho differs from its documentation (contact fields, notes for a non-admin, pipeline stage vs status, merges, Applications module, 304/204, page-depth cap, 20-token limit) | Medium / Medium | The spike before E's sheet, a fallback per item (v13 §13.1 E (a)-(i)); token ceiling settled before the 15th connection; decision 1 asks about the Applications module first. The page-depth item is also the OPEN item (last section) |

---

## K. Data flow

### K.1 Inbound from Zoho Recruit (E1; v13 §5)

1. **Connect.** An admin signs in to Zoho (code + PKCE); the account's Applications module is checked first; jobs are picked (none pre-ticked) and linked; one trigger status is chosen. Nothing is created in HRVoice until step 7.
2. **Initial import.** One lane job per connection, `pull:<connectionId>`. It reads the account's applications page by page (up to 200 each) in a fixed order, keeps those on linked jobs, for up to 120 s per run; the next tick resumes it. **Each application is written in its own short transaction**; the page position advances only after that page committed. (The paging rule for full reads is the OPEN item.)
3. **Every 15 minutes, three reads** with `If-Modified-Since` = the start of the scan before the last completed one, minus 2 minutes, so every change is read by two completed scans: (1) job openings; (2) applications, account-wide, kept for linked jobs whether the job is open or closed in Zoho; (3) Candidates modified in the window, whose linked applications are re-read so contact fixes made on the Candidate arrive. A scan with no window skips read (3).
4. **Per application:** read the job link `FOR SHARE` (skip if unlinked meanwhile); update the link row first, then the candidate only if the link came back; contact changes under a savepoint, so a refused change keeps the old values and records an issue with its fix; a changed parent Candidate re-pends failed notes.
5. **New rows** only for applications at the trigger status. **Adoption** of an existing unlinked row with the same phone and matching name happens whatever the status. A removed person's application is skipped by its keyed suppression hash.
6. **Closed in Zoho** (Hiring Pipeline stage Hired, Rejected or Archived) → `closed`: out of every queue, Call refused. ATS status changes never change our stage. Nothing the ATS does erases a person.
7. **Linking a job later** clears the scan start times, so the next two scans are full reads and its existing applicants come in.

### K.2 Inbound from a customer's own system (Dev; v13 §6.6, §9)

`PUT /v1/candidates/by-external/{id}`, `POST /v1/candidates:batch` (JSON or `text/csv`), `PUT /v1/jobs/by-external/{id}` (with "May create jobs"), `DELETE ...` (with "May remove people"; erasure after a grace period). The same CSV-import validation; per-row results; `409 job_not_found` for an unknown job (EventBridge retries 409). `/v1` never adopts an unlinked row. A job created by a key cannot be called until a person links an agent.

### K.3 The agent (the call)

- A person clicks Call for one candidate, through `startOutbound` and `dialLocked` with their existing guards. New guard (E1), at the top of `dialLocked` before provisioning: a closed or anonymised link refuses with `candidates.closed_externally` (closed only while the connection is not disconnected).
- The agent receives only the compiled job, its questions and knowledge, fenced as reference data. It has no ATS access and calls no action. A job copied from Zoho or created by a key says "The agent speaks from this description" and needs a person to link an agent.

### K.4 Result capture

- The provider's webhook, or (in orgs with a live connection) `fetch_results:<org>` on the lane every 5 minutes for calls that ended 3-60 minutes ago without a result or without answers, or are stuck active. Random order, 40-second budget, stops at the first provider timeout or 5xx; about 12 tries over the hour.
- `apply` stores only the provider's answers under the call's own question keys with a present value, never replacing stored answers; otherwise the extractor runs on the transcript.
- A call is **settled** 3 minutes after it ends with a failure reason, or a transcript plus answers (or no questions on the job); or 90 minutes after it ends, whatever is stored. After 90 minutes with nothing fetched: `result_unavailable`.

### K.5 Outbound write-back

- **Notes (E1).** The 60-second tick upserts one `integration_deliveries` row per (connection, settled call) for people with a live link, calls ending after `connected_at` and within 7 days, content not erased. It hashes only what can leave, so a summary filled later sends nothing new. After commit it enqueues `send:<connectionId>`. The sender takes up to 20 due rows (only live links, only unerased calls), re-reads row, call, link and connection right before each write, builds the note with `ExternalPayloads`, and writes it to the parent Candidate record. Success is a compare-and-set on the hash; a changed result sends one "Updated result" note. Unanswered and failed calls the provider accepted get a note with their outcome (decision 4 asks whether to keep that).
- **Stage (E2).** A person's `reviewed` or `declined`, after a 2-minute hold, read at send time: `setStage` with "Moved forward by Priya Sharma in HRVoice" only if the application is open and its live status is the trigger status or the status HRVoice last wrote; otherwise a note that claims nothing about who set the status.
- **Feed (Dev).** `call.ended` and `contact.stage_changed` with per-org `seq`, at least 2 minutes old, at-least-once, ordered, 30-day window, `superseded` on undone stage events, `410` when a cursor fell below the oldest retained event.
- **Results CSV (A).** On demand, built by `ExternalPayloads` for the exporting person.

The note (v13 §7):

```
HRVoice screening call · Sales executive · 3 Oct 2026, 11:02 · 6 min
Outcome: Call completed            (or: No answer / Reached voicemail / Picked up, didn't speak / Number not valid / Result unavailable)

Answers noted from the call (automatic; check the recording)
- Notice period: 30 days
- Current location: Pune
- Expected salary: No answer noted; check the recording

Recording, transcript and summary: <sign-in link to the candidate in HRVoice>
A person on your team decides who moves forward. HRVoice does not score or recommend.
HRVoice ref 3f2a9c1e.a41b
```

### K.6 Failure paths

| Failure | What the system does | What a person sees |
|---|---|---|
| Provider webhook lost | `fetch_results` reconciles it; after 90 minutes with nothing, `result_unavailable` | "Result unavailable"; note says so |
| Extraction failed | No answers stored; the call stays selected and is retried; after the deadline each question prints "No answer noted; check the recording" | Same text in the note |
| Dial refused or no conversation id | Stays in HRVoice; never written to an ATS | Failed dial in the app |
| `AuthRevoked` / `invalid_grant` | `needs_attention` (`consent_revoked`), written only if the token is unchanged; nothing needing the token is enqueued | "Needs attention", one email to admins |
| The connecting person left or lost access | `principal_lost`; every vendor call stops, pulls included | "Paused: Priya no longer has access…", Take over |
| Mapped status renamed (E2) | `status_unmapped`; stage writes stop, notes continue | Card, email |
| 429 | `rate_limited_until`; nothing enqueued until then | "Paused until 4:10 pm" |
| Timeout, 408, 5xx, deadlock | The row backs off (1 minute × 2^attempts, at most 1 hour); the run stops; the third failure emails admins | "Couldn't send since 10:40" with Retry |
| 422, `NotFound`, other 4xx | The row becomes `failed` (compare-and-set on its hash); the run continues | "1 call result couldn't be sent…" |
| Merge in Zoho moved the person | The pull rewrites the parent id and re-pends failed notes; no Retry needed | Nothing, once delivered |
| Unsent after 7 days | `failed` with `expired` | "N call results from before 3 Nov couldn't be sent" |
| One bad inbound record | Its own transaction; an issue entry with its fix; the page goes on | "3 people couldn't come in: number not valid…" |
| Unexpected exception | Caught per org, row, application or session; logged by class only | `internal` / `internal_error` entry |
| Erasure between discovery and send | The pre-write re-read skips it; expiry deletes the row | Nothing sent |
| Disconnect mid-run | The sender re-checks before each write | Stops within one row |
| Lane thread error | Caught, logged, the loop goes on; the uptime monitor alerts when `jobsBacklog` stays above 0 for 15 minutes | Operator alert |
| Incident | `JOBS_ENABLED=false` stops all background work, emails included; for one customer's ATS use that connection's Disconnect | Runbook |
| Wrong Zoho account on reconnect | Refused; the token is used in memory, revoked, never stored | "This Zoho Recruit sign-in can't see any of the jobs linked before…" |
| No Applications module | Setup stops right after sign-in | Sentence at step 2 |
| More than 2,000 applications to read (assumed cap) | One `too_many_to_read` entry. **OPEN item** | "More than 2,000 applications to read. Contact us." |

---

## L. Security model

### L.1 MVP (v13 §10, §11.1)

| Control | Detail | Slice |
|---|---|---|
| Tenant isolation | Forced RLS on every new table, in `StructuralTest`, no BYPASSRLS; tenant only from server state (key hash, the signed-in member, the OAuth `state` on that member's org's row), never from a payload | Core |
| Sealed secrets | `Sealer`: AES-256-GCM, `INTEGRATIONS_KEYS` / `INTEGRATIONS_KEY_CURRENT`, never derived from `BETTER_AUTH_SECRET`, AAD per row, re-seal command; secrets only in `secrets_sealed` | E or Webhooks |
| API keys | `hv_live_` + 32 random bytes, SHA-256 stored, shown once, header only, `/v1` only on `API_PUBLIC_HOST`; key ∩ creator's live permissions; never `users.*`, `roles.*`, `integrations.*`, `organization.*`, `billing.*`; `isOwner()` false | Dev |
| Who connects | `integrations.create/update/delete` (Owner, Administrator); Recruiters see status | Core, E |
| OAuth client | Code + PKCE S256, one-time `state` on the row, exact redirect URI from `WEB_URL`, verifier in a short-lived sealed cookie, initiator must complete the callback, callback host allowlist, full scope set on every sign-in, `access_type=offline` + `prompt=consent`, no refresh token = failed sign-in, replaced tokens revoked | E |
| Product rule | Only `ExternalPayloads` builds outbound bodies; export rule (answers need `calls.read_transcript` + `candidates.export`; phone and email also `candidates.read_pii`, never in feed or webhooks); plain text; merge-blocking test | 0 |
| Logs | No secrets or PII in logs or `last_error`; `logServerErrorDetail=false`; raw vendor bodies and token URLs never logged; revoke logs exception class only | Core, E |
| Audit | Ids and counts only; route templates, never query strings; fail-closed `authz.sensitive_access` for request-built bodies with content | 0, Core, Dev |
| Untrusted text | Prompt fence fix; JD create-only; human-only agent linking; extraction never rates | 0 |
| Removal and erasure (before the first external connection) | "Remove this person and their calls"; one erasure path; provider deletes retried on 401/403/429/5xx; workspace deletion revokes vendor tokens; hard-delete test; DPA naming sub-processors and stating today's gaps; breach runbook | Core |
| Ingress | Caddy overwrites `X-Forwarded-For`; Java only behind Caddy; `/backend/v1/*` answers 404 | P, Dev |
| Customer URLs (later) | `SafeHttp`: 3 s / 10 s / 64 KB, public addresses only, HTTPS 443, no redirects, no proxy | Webhooks |

ASSUMPTION: HRVoice acts as a DPDP data processor; needs a lawyer.

### L.2 Enterprise (Later, only when a deal requires it)

KMS envelope encryption on AWS `ap-south-1`; customer-managed keys; SSO/SAML; IP allowlists on keys; a static egress IP; an egress proxy in front of `SafeHttp`; rungs 4-5 under a signed DPA.

---

## M. Customer onboarding flow

One new Settings tab, **"Connected systems"**, shown with `integrations.read`; buttons need `integrations.create/update/delete`. Status uses the "Calling number" card pattern (FACT, `apps/web/components/settings/sections.tsx` lines 238-318). The server returns stable codes and the web maps them to sentences, because `apps/web/lib/errors.ts` (line 77) discards messages containing "webhook", "token", "api key" or "payload".

### M.1 Zoho Recruit (non-technical admin; v13 §12.2)

| Step | What the person sees |
|---|---|
| 0 | "Bring candidates in from the hiring system you already use, and send each call's results back to it." Only systems that really work are listed |
| 1 | "We'll read" (the job openings you pick and their candidates: name, mobile, email, status) / "We'll write" (a note on the candidate's record after each call, naming the job, with the answers). "We never send a score or a recommendation." |
| 2 | Sign in to Zoho and approve. Then a check for the Applications module; without it, setup stops: "HRVoice works with Zoho Recruit accounts that use the Applications module…" |
| 3 | Pick jobs (none pre-ticked); link each to an HRVoice job or create one with the title and full description. "People from <Zoho job> will be called with <HRVoice job>'s questions." |
| 4 | "Bring people in when their status is …", read live. "People who have already moved past this status in Zoho Recruit are not brought in. People already on the linked HRVoice job with the same mobile and name are linked whatever their status." |
| 5 (E2 only) | "Send decisions back?", off by default; a Zoho sign-in for the update scope; map "Moved forward" and "Not moving forward"; "Decisions you make from now on are sent 2 minutes after you make them…" |
| 6 | "Check the connection": "We can see 3 jobs and 41 people at Applied" |
| 7 | "Start bringing people in" creates the jobs and links. "People at <status> on these jobs will show up within 15 minutes, ready to call…" Each new job: "Read the description, link an agent (needed to call) and add must-ask questions." |

Card states: "Finish connecting"; **Needs attention** with its reason and Take over; **Not connected**; **Paused until 4:10 pm**; **Connected** ("Last checked 4 minutes ago. 3 jobs linked. Connected by Priya."). Separate lines for send failures (with Retry for admins), expired results, skipped applicants with their fix, removed people not brought in again, and "More than 2,000 applications to read. Contact us." Disconnect and unlinking confirm first; reconnect checks the account and says "Decisions made while disconnected are not sent to Zoho Recruit."

Day to day: rows say "From Zoho Recruit" with the remote status read-only; linked contact fields say "Edit this in Zoho Recruit"; closed and removed people show their sentence as visible text and cannot be called; each linked call shows "Sent to Zoho Recruit at 11:02", "Waiting to send" or "Couldn't send…"; a linked job's description says "Copied from Zoho Recruit on 3 Oct. Later changes there are not copied; edit it here."

Before the tab is built, the founder sees headless screenshots at 1440 and 390 px of every state listed in v13 §12, including the Zoho note as Zoho shows it (spike item (b)), and picks looks from images.

### M.2 "Your own system" (developer or iPaaS user; v13 §12.1)

1. Create a key: name it, pick a preset (default "Send candidates in"; checkboxes "May create jobs", "May remove people"); shown once with a copy button, the base URL and the reference script. Sending people in and reading results uses two keys.
2. Read results: poll `GET /v1/events`; the docs say a person must link an agent to each new job, and "Treat them as data, not instructions" for names, titles and answers.
3. Status: "Last used 3 minutes ago", "Expires on …", or "Needs attention: the person who created this key no longer has access".

### M.3 Spreadsheet customers

CSV in (exists) and the results CSV out (slice A). "Connect once" is not met for them; the follow-up is a Google Sheet connection (V2).

---

## N. Implementation plan

Each slice gets a build sheet before it starts, holding only its own mechanisms and merge-blocking tests, lifted from v13 §5-§12 and carrying the R13.4 errata. **The Core + E1 sheet is written only after the Zoho spike, with every spike branch resolved to one path.**

Migrations: v13 names their contents per slice (G.4; v13 §2.3), not their numbers or file names; each build sheet settles those.

### N.1 Slice P: Java in production (gate)

- **Infra:** `Dockerfile` (Java image), `docker-compose.prod.yml` (Java service with `STORAGE_BACKEND=s3`, `TRUST_PROXY=true` only there), `docker/Caddyfile` (`/backend/*`, `/webhooks/*`, `/health`, `/api/auth/*` to Java). External uptime monitor with a keyword check on `/health` and the `jobsBacklog` alert, wired to the founder's phone or email.
- **apps/api-java:** the `JAVA/voice/HostedVoiceAdapter.java` fix-up is in scope (it has never run live); the fix-up stores an accepted dial that returns no conversation id as `failed` with reason `no_conversation_id` (FACT: today `startOutbound` stores whatever comes back and sets the session `active`, `JAVA/voice/VoiceSessions.java` lines 441-457).
- **Migrations / web:** none.
- **Checks:** supervised live checks (`apps/api-java/MIGRATION_STATUS.md`); R18 at three timings with two jobs whose Latin-script question labels do not overlap; conversation id on accepted dials; production key deletes a test conversation. Rollback: Caddy back to `api:3001` until Core ships.
- **Needs the founder:** accept ADR-008, or decide to run Java while it stays PROPOSED.

### N.2 Slice 0: prerequisites

- **apps/api-java:** `JAVA/engine/PhoneNumbers.java` (`toE164` uses the stored E.164), the candidate write paths (`JAVA/hiring/Candidates.java`, `JAVA/hiring/CandidateImport.java`); `JAVA/engine/CallOutcomes.java` (`outcome`); `JAVA/hiring/Jobs.java` (`queue`, `callStatus` four values plus a separate outcome field); `JAVA/hiring/HiringController.java` (results route uses `outcome`; audit route template); `JAVA/authz/AuthInterceptor.java` (route template, one shared helper); new `JAVA/integrations/ExternalPayloads.java`; `JAVA/voice/HostedVoiceAdapter.java` (answers only from `value`/`result`/`answer`); `JAVA/engine/CallContextCompiler.java` (`criteriaSource`; fenced role block with the title, fenced company facts); `JAVA/rag/ContextPacker.java` (fence); `JAVA/voice/VoiceSessions.java` (`apply` answers filter, stored answers never replaced); `JAVA/engine/PostCallExtractor.java` and `RES/usecases/hiring.json` ("Report only what the candidate said. Never rate, score or judge the candidate yourself."; `new` label "No decision yet").
- **Migration:** none (schema). The phone change is a data backfill (v13 §2.3: "data, not schema"), run after the read-only collision query and after an operator has merged or removed every collision; it refuses to run while any exist (v13 §13.1 slice 0). How it is packaged is for slice 0's build sheet.
- **apps/web:** `apps/web/components/candidates/add-candidates.tsx` and `CandidateDetailSheet.tsx` (show and accept the stored form); `apps/web/app/jobs/[id]/page.tsx` (question wording hint); `apps/web/components/candidates/person-state.tsx` and `apps/web/app/jobs/[id]/candidates/page.tsx` (labels for `no_conversation`, `result_unavailable`, `content_erased` from the outcome field).
- **Tests:** the `ExternalPayloads` merge-blocking test (forbidden fields, export rule, evaluative corpus, `<img src=x onerror=alert(1)>`, stage reason, emails without `read_pii`, agent criteria, 5,000-character and object answers, Devanagari repeated keys, an answer containing "reject"); the prompt-fence test; one outcome vocabulary; answers filter (another job's keys and all-null answers not stored; replay never changes stored answers); backfill refuses with collisions; `person-state.test.ts` for the new labels.

### N.3 Slice A: results CSV export

- **apps/api-java:** a results CSV route for a job's candidates in `JAVA/hiring/HiringController.java`, rows from `ExternalPayloads`, `candidates.export`, audited sensitive read, UTF-8 BOM, every cell quoted, formula cells escaped.
- **apps/web:** a button on `apps/web/app/jobs/[id]/candidates/page.tsx`; call in `apps/web/lib/api.ts`.
- **Tests:** without `candidates.read_pii`, name and job title only; with it, a file that re-imports with no issues; formula escaping. Manual: open in Excel (Windows) and Google Sheets with a Hindi answer.

### N.4 Items G and W (pre-existing, not designed here)

Their own sheets and founder decisions 15 and 16. G touches `startOutbound` and `dialLocked` (`JAVA/voice/VoiceSessions.java`), sign-up (`JAVA/auth/BetterAuthController.java`) and default usage limits (`JAVA/cost/`); its one test: a new, unverified, not-enabled workspace gets `calls.not_enabled` and nothing reaches `FakeVoice.dial`. W starts from `architecture-draft-v10.md` §11.1 item 10 and `architecture-draft-v8.md` §11.1 items 10 and 13. Until W ships, the pilot-end runbook applies (v13 §13.1 W).

### N.5 Core (built with E1 or Dev)

- **apps/api-java:** `JAVA/jobs/JobQueue.java` (integration lane, general claim excludes `integration`, no general `wake()` for it, POLICY `{5, 30}`, clear error for unknown kinds, `JOBS_ENABLED`); new `JAVA/integrations/Connections.java`, `IntegrationScheduler.java`, `IntegrationWorker.java` (`fetch_results`, `provider_delete`); `JAVA/voice/VoiceSessions.java` (`reconcileSystem`; `apply` records facts but no content for erased calls, second write skips erased calls; `expireStale` database steps with a try/catch per org); `JAVA/voice/VoicePorts.java`, `HostedVoiceAdapter.java`, `FakeVoice.java` (`deleteConversation`); `JAVA/hiring/Candidates.java` (`delete` runs the erasure path); `JAVA/hiring/Jobs.java` (anonymised rows out of queues; "Closed or removed" filter); `JAVA/team/Organizations.java` (disconnect and revoke before the hard delete); `JAVA/cost/CostLedger.java` (`greatest` on LLM tokens and cost); `JAVA/platform/PlatformConfig.java` (`logServerErrorDetail=false`).
- **Infra:** remove the Nest service and its Caddy upstream (`docker/Caddyfile`, `docker-compose.prod.yml`); rollback becomes a Java image rollback.
- **Migration:** Core's one additive migration: `integration_connections`, `job_links`, `candidate_links`, `voice_sessions.content_erased_at`, the `source` values and the `integration` kind (G.4; v13 §2.3).
- **apps/web:** "Remove this person and their calls" in `apps/web/components/candidates/CandidateDetailSheet.tsx` with the `ConfirmDialog` copy; the "Closed or removed" filter on the board and lists.
- **Tests:** RLS drift for new tables (`StructuralTest`); hard delete of an org with sessions, ledger, connection, links and delivery rows; lost provider webhook; fetch budget and poison item; erasure (removal during extraction; during a live call); lane liveness; isolation (a slow ATS does not delay email jobs or the tick); grep tests (no other `delete from candidates` or `delete from jobs`; no `getQueryString` in audit code); ledger keeps the larger figures; a forced phone unique violation leaves no digit in `last_error`; connection-pool check.

### N.6 Slice E1: Zoho Recruit (first real integration)

- **Opening spike** (about a day, Zoho Recruit Free in the India data centre, plus questions to Zoho developer support): items (a)-(i) and the OPEN paging item (last section). Results go into E's sheet and estimate before any E code.
- **apps/api-java:** new `JAVA/platform/Sealer.java` (from `JAVA/notify/Notifications.java` seal/open); `JAVA/platform/Env.java` (`INTEGRATIONS_KEYS`, `INTEGRATIONS_KEY_CURRENT`, `INTEGRATIONS_HASH_KEY` at least 32 bytes and different from every key, per-environment OAuth client ids, redirect built from `WEB_URL`); new `AtsPort`, `ConnectorSpec`, `ZohoRecruitAts`, `FakeAts`; the OAuth connect, callback, status, change jobs, unlink, disconnect, Take over, Retry and Sync now routes in `JAVA/integrations/`; pull, discovery and send in `IntegrationScheduler` / `IntegrationWorker`; `JAVA/voice/VoiceSessions.java` (closed-row guard at the top of `dialLocked`); `JAVA/hiring/Candidates.java` (`candidates.managed_externally`); `JAVA/hiring/Jobs.java` (closed rows out of queues); attention emails through the existing notification path.
- **Migration:** E's one additive migration: `integration_deliveries` (G.4; v13 §2.3).
- **apps/web:** the Connected systems tab (`apps/web/app/settings/page.tsx`, a new component beside `apps/web/components/settings/sections.tsx`); unhide the Integrations permission group (`apps/web/components/settings/access.ts` line 109); rename the agent page's test-tool "Integrations" group (`apps/web/app/agents/[id]/page.tsx` lines 700-735); code-to-sentence mapping (`apps/web/lib/errors.ts`); board rows, disabled Call with visible sentence, delivery line, read-only linked fields, dialog copy (`apps/web/app/jobs/[id]/candidates/page.tsx`, `person-state.tsx`, `CandidateDetailSheet.tsx`, `add-candidates.tsx`); job page copy "Copied from Zoho Recruit"; the FAQ and Tools page copy (`apps/web/components/site/faq.tsx` lines 53-55, `apps/web/app/tools/page.tsx` lines 106-119) say exactly what works.
- **Tests:** the E1 list of v13 §11.1, all against `FakeAts` and `FakeVoice` (section O).

### N.7 Slice E2: stage write-back

- **apps/api-java:** the update-scope sign-in in `Connections` (full scope set); stage discovery in `IntegrationScheduler`; the stage handler inside `send`; the decider's name from the latest real `hiring.candidate_status_changed` audit row.
- **Migration:** none.
- **apps/web:** step 5; the decision footer; the decision line under a linked person's decision; the bulk-decision toast count.
- **Tests:** baseline, Undo, changed in the ATS, switch read at send time, re-baseline, map edit, stage-note retry, stage expiry, our own write, decider name.
- **Needs the founder:** decision 7.

### N.8 Dev: developer surface (alternative or second branch)

- **apps/api-java:** `JAVA/authz/AuthResolver.java` (bearer branch chosen by the matched handler; user and workspace status checks in `membership`); `JAVA/authz/AuthInterceptor.java`; new `ApiKeys`, `PublicApiController`, `Events`; `JAVA/hiring/Jobs.java` (`updateStatuses` takes the events lock first and emits `contact.stage_changed` in orgs with a feed); `JAVA/platform/EdgeFilter.java` (per-key window); `JAVA/platform/Env.java` (`API_PUBLIC_HOST`, `EVENTS_EPOCH`, `API_KEY_RATE_PER_MINUTE`, `API_ROWS_PER_DAY`); `docker/Caddyfile` (`api.<domain>/v1/*`; `/backend/v1/*` 404). A hand-written OpenAPI file; a curl and Python reference script.
- **Migration:** Dev's one additive migration: `api_keys`, `integration_events`, `voice_sessions.result_emitted_hash` and `result_version` (G.4; v13 §2.3).
- **apps/web:** "Your own system" in the Connected systems tab (keys, presets, shown once, status); "via API key" in Settings > Activity.
- **Tests:** Dev ordering and purge; keys survive delivery failure; API-key audit and `401` cases; `/v1` origin checks; restore and `EVENTS_EPOCH`; an erasure between sweep and update emits nothing; decide, Undo, decide gives one actionable event.

### N.9 Webhooks (only if a Dev pilot needs push)

`Sealer` (unless E shipped it), `SafeHttp` on the OkHttp 4.12.0 already on the classpath, Standard Webhooks signing and rotation, one delivery row per (endpoint, event), test event, delivery list, sealed URL, the stage-event hold. Not designed beyond v13 §6.3; its migration takes the next free number.

### N.10 The first real integration and how it is tested end to end without buying anything

**Choice:** Zoho Recruit, if a pilot uses it with the Applications module on: self-serve OAuth, an India data centre, a documented REST API with incremental polling, a free plan with API access. The developer surface goes first only if a pilot has a developer or an iPaaS (v13 §14.1).

**Testing without the founder buying anything (v13 §14.2):**
- **Automated:** the JUnit 5 + Testcontainers suite with `FakeVoice` (lost webhook, stuck `active`, silent call, unreachable provider, delete conversation) and `FakeAts` (baseline, Undo, rename, rate limit, delete, merge, closed job, always-failing note, 422, large page, a mobile fixed only on the Candidate, a page shift mid-scan, a colliding linked phone).
- **Zoho by hand:** a Zoho Recruit Free account in the India data centre (FACT: 1 active job, 5,000 API credits a day, no webhooks); one Web-Based OAuth client per environment (https://www.zoho.com/recruit/developer-guide/apiv2/register-client.html); 5-10 test candidates using team members' own numbers, with their consent. End to end: connect, see the Applications-module check, link the one job, pick a status, see people arrive within 15 minutes, click Call, see one note on the Candidate record in the Zoho web app, reject the application in Zoho, see the row close and Call refused. Whether the Free plan has the Applications module is **unverified** (spike item (d)); FACT: other plans get it "through Zoho support".
- **Developer path:** `curl` and the reference Python script against a local Java API; self-hosted n8n (free) polling the feed.
- **Voice provider:** on the test account during gate P (the R18 binding check).
- **Spreadsheets:** the results CSV in Excel (Windows) and Google Sheets, with a Hindi answer and phone numbers.
- **Not testable for free:** Zoho webhooks; custom-status behaviour on paid plans; Keka, Greenhouse, Lever, Darwinbox.

### N.11 What needs the founder

Every founder decision in v13 §16, with its recommended pick (RECOMMENDATION, v13 §16; evidence in `01-comparison.md`). **[Blocks a quote]** marks the five that block quoting any pilot a date (v13 §16 intro).

| # | Decision | Recommended pick |
|---|---|---|
| 1 **[Blocks a quote]** | Where do the first five pilots keep candidates (an ATS, their own system with a developer or iPaaS, or spreadsheets)? For Zoho Recruit users: is the Applications module on? | Ask all five before any spike; E only for a pilot on Zoho Recruit with the module on, Dev only for a pilot with a developer or iPaaS, otherwise ship 0 and A and wait (R1) |
| 2 | Is pickup within about 15 minutes acceptable, and how many jobs does a pilot keep open? | Yes to 15 minutes; ask the job count (Zoho Free allows one active job) |
| 3 | May API keys carry answers, only by explicit admin choice under the export rule? | Yes, only by explicit choice (Dev); if no, `/v1` and the feed return outcomes without answers |
| 4 | What goes into the ATS note, and do calls that did not connect also get a note? | Outcome, answers and a sign-in link, no summary; yes, one short note per unconnected call |
| 5 | Are ATS-linked contact fields read-only in HRVoice? | Yes; otherwise the next pull overwrites edits made here |
| 6 | May a stage change ever come from another system rather than a named person in HRVoice? | No |
| 7 | May "Not moving forward" set a reject status in the ATS, which may email the candidate? (E2 only) | Not for the first pilot; build E2 when a pilot asks, notes only until then |
| 8 | May the customer's system name ("Zoho Recruit") appear in the UI? | Yes |
| 9 | Is it acceptable that HRVoice keeps imported people and their call content until someone removes them here, and that a person deleted in the ATS stays, callable by a click, until then? Is per-application suppression enough? | Yes, with per-application suppression for pilots and an operator search by phone or email for erasure requests; a do-not-call list, admin lookup and deletion detection in V2 if pilots ask |
| 10 | Automatic calling of imported candidates, and under what consent, hours and DND rules? (needs legal advice) | No for the MVP |
| 10b **[Blocks a quote]** | Is one Call click per imported candidate acceptable at the pilots' daily volume? | Yes for a few dozen a day (ASSUMPTION about what a recruiter accepts); a pilot needing more waits for bulk calling (`later-bulk-calling.md`, NOT APPROVED) |
| 11 | Price per SMB customer; is "data stays in India" a sales promise? | No data-location promise yet: call audio and text go to the voice and LLM providers, whose data location for our account is unverified |
| 12 | Will support and sales use cases reuse `jobs`/`candidates` or get their own tables? | Decide when the second use case is designed; nothing here depends on it |
| 13 | Is it acceptable that a key stops when its creator leaves, and that ATS sending and import stop until an admin takes the connection over? | Yes; admins get one email |
| 14 | (outside integration scope) Should HRVoice generate its own call summary instead of the provider's? | Not now; revisit with decision 4 if a pilot wants summaries in the ATS |
| 15 **[Blocks a quote]** | Item G: (a) operator turns calling on per workspace; (b) verified email for the acting person; (c) default monthly usage limit; (d) does any pilot call outside India? | (a) yes, (b) yes, (c) a small default, (d) ask; no later than gate P, unless the founder accepts the risk in writing |
| 16 **[Blocks a quote]** | Item W: how long recordings, transcripts, answers and people are kept; what a purge selects; the provider's `retention_days` as backstop; workspace deletion, restore re-apply, backup and erasure-record retention | Before the first paid customer or general availability, whichever is first; until then the DPA states the gaps and the pilot-end runbook applies. Alternative (round 12 SA-4): time it by the first workspace holding real candidates' data, which adds about 1.5-2 weeks to every pilot date |
| Gate P **[Blocks a quote]** | Accept ADR-008, or run Java in production while it stays PROPOSED | v13 states no pick; no slice reaches customers until Java serves production (v13 §13.1 launch gates; §18 rule 1) |
| ADR-010 | Accept the integration decision record (`BRD's/10_ADRs/ADR-010-integration-layer.md`, written from v13 §18) | v13 states no pick; Core is gated on ADR-010 being written (v13 §13.1 Core). PROPOSED until the founder accepts it |

Also needed from the founder (not numbered in v13 §16): pick looks from the screenshot set (including the Zoho note from spike (b)) before the Connected systems tab is built; legal input on the DPDP processor role, the DPA, and TRAI for any automatic calling; consent from the team members whose numbers are used for test calls.

---

## O. Testing strategy

Every test below is a merge-blocking test in v13 §11.1 unless marked. Automated tests use `FakeAts`, `FakeVoice` and Testcontainers; nothing needs a paid account.

| Area | What is tested |
|---|---|
| **Auth** | Forged `accounts-server` refused, nothing sent to it; a callback completed by someone other than the initiator refused; a callback with the browser-path cookie completes; a token response without a refresh token stores and revokes nothing; every sign-in requests the full scope set. Keys: a removed or suspended creator, or a non-active workspace, gets `401`; `isOwner()` false; the default key cannot create jobs; `/backend/v1/events`, `/%62ackend/v1/events` and `/v1/../jobs` never return `200`; a cookie on a `/v1` handler and a bearer key on a cookie handler are ignored |
| **Connection** | A reconnect that sees none of the linked jobs is refused with `integrations.different_account` and its token revoked, never stored; Take over revokes the previous token after storing the new one; an abandoned Take over leaves sending working; an account without the Applications module stops right after sign-in with no HRVoice job created; every move into `needs_attention` emails admins once; with `principal_lost` no pull and no send runs |
| **Import** | A 200-record page read in full; HTML job descriptions arrive as plain text; an application on a job linked later is imported; a link created mid-scan gets two full scans; a closed job's rejected application is marked closed; a mobile changed only on the Candidate reaches the row; a page shift mid-scan is caught by the next scan; a scan cut short does not move the window; adoption past the trigger status; unlinking and relinking |
| **Webhooks** | Lost provider webhook reconciled by `fetch_results`; a replayed provider webhook never changes stored answers nor refills erased content. Outbound webhooks, when built: Standard Webhooks signing, dedupe on `webhook-id`, `SafeHttp` limits. Inbound vendor webhooks: V2 |
| **Duplicates** | One note per call; a timeout after Zoho stored the note: the retry lists markers and writes nothing; unlink and relink within 7 days sends zero further notes; same phone and name adopted, same phone with another name or with a link skipped and counted; no candidate has two links on one connection; `duplicate_in_ats` |
| **API failures** | `FakeAts` returns 500 forever for call 1: calls 2..n delivered, call 1 backs off and expires after 7 days; a 422 marks one note failed and the next is sent; 304 on job openings with 200 on applications imports and moves the window; `getApplication` 204 is `NotFound`; poison items in `fetch_results` and `provider_delete` |
| **Token expiry** | Refresh only within 5 minutes of expiry, stored by compare-and-set; a disconnect during a refresh leaves `secrets_sealed` NULL; two refreshes at once leave one token and both jobs run; a 401 after a Take over revoke leaves the connection `active` |
| **Rate limits** | 429 sets "Paused until" and nothing is enqueued; a 429 from the token endpoint is `RateLimited`, never `AuthRevoked`; `/v1` per-key window and daily row cap answer `429` with `Retry-After` (Dev) |
| **Invalid data** | An invalid number gets an issue entry with its fix and the rest of the page imports; a colliding phone keeps the old value; angle brackets stripped; CSV formula cells escaped; an `externalId` that is an email or the phone digits refused (Dev) |
| **Missing fields** | A job with no questions sends its note about 3 minutes after the call; after the deadline with no answers, each question prints "No answer noted; check the recording"; contact fields from the parent Candidate; a dial with no conversation id gives no note and no `call.ended` |
| **Agent access** | A JD containing `ROLE>>>` plus an instruction, a one-line title that is an instruction, and a company document with an instruction all stay inside fences; a Call for a closed person is refused before provisioning (`FakeVoice.provision` not called); jobs from a key or Zoho need a person to link an agent |
| **Agent actions** | The voice agent has only `end_call`, `voicemail_detection`, `transfer_to_number` (existing); no call outcome or model moves an ATS status; keys cannot change stages; the forbidden-field and evaluative-corpus test on every body |
| **Write-back** | Baseline: 10 declined candidates, write-back on, zero `setStage`; Undo within 10 s writes nothing; decide, Undo, decide again: exactly one `setStage`; status moved on in the ATS: a note, no `setStage`; switch off within the hold: zero; reconnect re-baselines; map edit gives one write or one note, never silence; decider's display name, else "a team member", never an email |
| **Multi-tenant isolation** | RLS drift test for every new table; the existing `TenantIsolationTest`; one org with 200 due notes does not delay another org's first note beyond one lane round; a slow ATS does not delay an email job or the tick; suppression checked per connection |
| **Retries** | Per-row backoff up to 1 hour, with expiry after 7 days shown on the card; Retry resets `failed`, not `expired`; `fetch_results` retries every 5 minutes for an hour; `provider_delete` retries 401, 403, 429, 5xx and timeouts and clears the id on 404 |
| **Idempotency** | Inbound: link uniqueness plus `inbound_hash`; delivery rows with a compare-and-set on the content hash (a hash changed during a send leaves the row `pending`, next run sends once); the queue key is the single-flight lease; a summary filled later sends nothing; Dev: two concurrent emits seen in order, two identical concurrent stage changes emit one event |
| **End to end** | Automated: the lost-webhook loop gives exactly one note with answers; removal during extraction and during a live call; hard delete; no backlog on first connect; reconnect behaviour. Manual: the Zoho Free walk-through (N.10), n8n against the feed, gate P live calls, the spreadsheet check |

---

## Open before Zoho work

E is gated on a pilot confirming Zoho Recruit with the Applications module on. Before any E code, the opening spike must settle the item below and items (a)-(i), and E's build sheet must resolve every branch to one path.

### The Critical Reviewer's item (OPEN)

**Problem.** v13 pages full reads (the initial import, the scan after it, and the two scans after any job link) by offset: `page` and `per_page`, in `sort_by=Created_Time` **ascending** order (v13 §5, "Initial import"). v13 also assumes Zoho stops page-based reads at 2,000 records, as Zoho CRM does. Under that cap, an ascending read stops before the **newest** applications, which are the people a pilot most wants to call. v13 then records one `too_many_to_read` entry ("More than 2,000 applications to read. Contact us."), but those applicants still do not come in.

**Evidence.**
- FACT: "The page and per_page parameter is used to fetch records according to their position in Recruit"; `per_page` defaults to 200 (https://www.zoho.com/recruit/developer-guide/apiv2/get-records.html).
- FACT: Zoho CRM and Zoho's vertical-solutions APIs need a `page_token` beyond 2,000 records (https://www.zoho.com/crm/developer/docs/api/v8/get-records.html, https://www.zoho.com/developer/docs/vertical-solutions/api/v6/get-records.html). The Recruit page documents no depth limit, so the cap is **unverified** for Recruit (v13 spike item (g)).
- v13 §5: the full read sends `If-Modified-Since` set to the oldest linked job opening's creation time, and "a read refused past record 2,000 records one `last_sync_issues` entry". v13 §5 also says "only a completed scan records its start time". It does not say whether a refused full read counts as completed (observation from the text; if it does not, the window would not move and the full read would repeat).

**Proposed fix (the reviewer's).** Page full reads by `Modified_Time` with `If-Modified-Since`, with no offsets. As we read it: sort by `Modified_Time` ascending and move `If-Modified-Since` forward to the last record read, so no request goes deep enough to meet a position cap. By the reviewer's account this removes mechanisms rather than adding any; E's sheet lists exactly which.

**Fallback (the reviewer's).** If `Modified_Time` paging does not work: read in `Created_Time` **descending** order, so a cap cuts off the oldest applications, not the newest, and **a refused full read counts as completed**, so the scan window moves on.

**What the spike must confirm.**
1. Whether Recruit's page-based Get Records stops at a fixed depth (item (g); ask Zoho developer support; do not seed 2,000 records on a Free account).
2. Whether `sort_by` accepts `Modified_Time` ascending on applications, and `Created_Time` descending for the fallback (item (f) already asks which fields `sort_by` accepts).
3. Exactly how `If-Modified-Since` compares (inclusive or exclusive, and to what precision), and whether more than one page of applications can share one `Modified_Time` (for example after a bulk update in Zoho). ASSUMPTION to test: if many records share a timestamp, paging by time alone could repeat or skip, and E's sheet needs a rule for it.
4. That the chosen rule keeps v13's guarantees: every change read by two completed scans, a job linked during a scan read in full twice, and the `too_many_to_read` line shown if anything is still left unread.

### Other unverified items from v13

Zoho spike items (v13 §13.1 E; about a day plus Zoho support):
- (a) What closing a job opening does to its applications' Hiring Pipeline stage.
- (b) A note on a Candidate listed back through Get Related Records; its credit cost; whether a non-admin Zoho user may read it (else markers stay best effort); a screenshot of the note in Zoho with a Hindi answer and a "No answer noted" line.
- (c) Change Status with a comment on an application, and whether the Hiring Pipeline stage moves with it; the stage's field name (E2).
- (d) Whether the Free plan has the Applications module.
- (e) A merge where the duplicate has an application on a linked job: does the application keep its id, does its Candidate become the master, does the pull return it, do notes move. If ids change, E's sheet designs that case before E1 ships.
- (f) Which fields an Application record returns (name, mobile, email); whether a Candidate edit changes its applications' modified time (if yes, read (3) is dropped); which fields `sort_by` accepts; whether creating a note moves the Candidate's modified time; what reads return when nothing changed (304 or 204); whether a single-record GET of a deleted application returns 204 or 404; that unapproved applications are left out by default; the URL pattern of a Candidate record for "Open in Zoho Recruit" links.
- (g) Page depth (support), as above.
- (h) Whether the 20-refresh-token limit is per OAuth client (support, or 21 sign-ins by different test users on a dev client), settled before the 15th production connection.
- (i) Whether the revoke endpoint accepts the token as a form body.

Also from v13 §17 and R13.6:
- Whether Zoho grants exactly the requested scopes with no incremental consent (E2); whether a sign-in with narrower record visibility sees fewer applications; whether Zoho record ids can repeat across Zoho organisations; whether a single-record GET costs 1 or 3 credits; data-centre token hosts for Indian accounts; Change Status with `jobids` for custom statuses.
- Whether the workspace hard delete passes the RESTRICT foreign keys (one Core test; ASSUMPTION from the PostgreSQL source that it passes).
- Whether the provider's conversation delete removes audio, transcript and backups.
- When the voice provider binds a call's configuration, and whether call A's answers can be analysed under job B's (R18; gate P). Whether the Exotel override applies on a live call. Whether an accepted dial can return no conversation id.
- How long after a call the provider's webhook usually arrives (the 3-minute settle and 90-minute deadline are guesses until measured); whether it re-signs retried webhooks with a fresh timestamp, and how often it retries.
- How Excel and Google Sheets show the CSV phone format.
- Which MCP hosts accept a static bearer header; whether iPaaS hook URLs act as bearer secrets.
- Whether production has phone calling configured today (item G).
- Whether the uptime monitor supports a keyword check with a confirmation period; whether `Db.uniqueViolation` behaves the same with `logServerErrorDetail=false`; whether `WEB_URL` in production is the browser-visible origin.
- Keka Hire write endpoints; Merge and Kombo data location; DPDP Rules wording against the Gazette; the DPDP processor role (needs a lawyer).
- Pre-existing, outside this plan: question labels written in a non-Latin script all map to one answer key (`answer`), so only the first is collected (v13 §17).
