# 01. Comparison of the seven expert reports

Date: 2026-10-03. Author role: lead architect (synthesis). Research and writing only: no code, config, migration or test was changed.

Inputs:
- Current-system maps: `docs/integrations/00-current-system-backend.md`, `docs/integrations/00-current-system-product.md`.
- Expert reports in `docs/integrations/research/`:

| Code | Report | Role |
|---|---|---|
| IA | `01-integration-architect.md` | Integration architect (APIs, auth, webhooks, vendors) |
| AM | `02-agent-mcp-architect.md` | AI agent and MCP architect |
| EA | `03-enterprise-architect.md` | Enterprise integration (custom, legacy, firewalled) |
| SA | `04-security-architect.md` | Security architect |
| UX | `05-product-ux-architect.md` | Product and UX architect |
| BE | `06-backend-distributed-architect.md` | Backend and distributed systems architect |
| CR | `07-critical-reviewer.md` | Critical reviewer (pre-mortem) |

Labels: **FACT** (source: URL or repo path), **RECOMMENDATION**, **ASSUMPTION**, **unverified**. Phase tags: **[MVP] [V2] [Later] [Avoid]**. "Proposed" is my position as lead architect, weighed on evidence rather than on how many experts said it. The design behind each proposed position is in `docs/integrations/architecture-draft-v1.md`.

Repo paths are relative to `/Users/valletivarish/Documents/new startup/`. `JAVA/` = `apps/api-java/src/main/java/desk/`.

---

## 1. Topic table

Cells are short paraphrases. Read the report for the full argument.

| Topic | IA | AM | EA | SA | UX | BE | CR | Concerns raised | Proposed |
|---|---|---|---|---|---|---|---|---|---|
| **REST API** | [MVP] 6-route `/v1`: upsert jobs and candidates by external id, batch, results (no `fitPercent`, no reconcile side effect), events feed | [MVP] small `/v1`: bulk upsert by external id, results and stage feeds with `updated_since` | [MVP] `/v1` batch upsert (JSON or `text/csv`), results, events, jobs; hand-written OpenAPI | [V2] expose existing routes to API keys, same interceptor and redaction | [V2] no public API; connection screens use session routes | [MVP] upsert by `externalId`, results, changes since a cursor | [MVP] bulk upsert via the CSV-import validation path, results, changes-since, stage read | Every route is a long-term promise; per-IP limit throttles shared iPaaS IPs; results reads are PII exports; `voice_sessions` has no `updated_at`; no OpenAPI exists | **[MVP]** six routes, hand-written OpenAPI, per-key limit, keyset cursor over our own event table |
| **OAuth** | Client [V2] with first connector (code + PKCE + state, sealed tokens, locked refresh); server [Later] | Client [V2]; server [Later] with MCP | Client [V2]; provider [Later] (MCP) | Client [MVP] (PKCE, one-time state, exact redirect, minimal scopes); server [Later] | Client [MVP] for Zoho; provider [Avoid] | Client [MVP] for first connector; server [Later] | Client [V2]; server [Later]; separate client ids per environment | Zoho tokens last 1 h and a client holds at most 20 refresh tokens per user; `invalid_grant` must become "needs reconnect"; refresh races; Greenhouse and Lever need partner programmes | **Client: with the first named connector (slice E, gated on a pilot).** Server: [Later], only for remote MCP or a marketplace |
| **API keys** | [MVP] hashed, prefixed, subset of creator's permissions, shown once, audited | [MVP] machine principal through `AuthInterceptor`; add a principal kind | [MVP] key bound to a system or custom role; no PII by default | [V2] subset capped at creator; never `users.*`, `roles.*`, `integrations.*`, `organization.*`, `billing.*`; no PII by default | [V2] paste vendor keys (Keka); our own keys only with a public API | [MVP] scoped by permission keys, prefix, `last_used_at` | [MVP] explicit permission set; per-key rate limit | Leaked key with `candidates.read_pii` exposes bulk PII; `Actor` assumes a member; rotation needs two live keys; audit needs `api_key_id` | **[MVP]** explicit permission subset chosen from presets; no PII and no admin permissions by default |
| **Service accounts** | [MVP] as API keys, `userId = Db.NIL`, key id in audit; advise customers to authorise ATS with a service user | [MVP] the API key is the service principal | [MVP] same | [MVP] here means the customer's pasted service credential (e.g. Greenhouse ISU): sealed, never returned | [MVP] attribution only: "via Zoho Recruit (connected by Priya)" | [MVP] connection or key is the principal; fails closed when creator leaves | [MVP] part of API keys | Audit `actor_user_id` is NULL for machines; creator offboarding; vendor service users are often admin-wide | **[MVP]** no new entity. API key or connection is the principal, scopes capped at creator and re-checked on each use |
| **Webhooks** | Outbound [MVP] (Standard Webhooks, outbox, delivery log, test, auto-disable); inbound [V2] as a sync trigger | Outbound [MVP] `result.ready`, `call.ended`, `candidate.stage_changed`; inbound [V2] | Outbound [MVP] thin payloads; inbound = the push API itself; vendor HMAC later | Inbound [MVP] per connection (±5 min, dedupe, fetch on notify); outbound [V2] behind an SSRF guard | Both [V2]; poll instead (Zoho webhooks need an admin rule and a paid plan) | Outbound [MVP]; inbound [MVP] as per-connection hints | Outbound [MVP] with permanent dedupe and SSRF guard; inbound only with first connector plus reconciliation | Queue idempotency stops protecting after success; SSRF on a single-VPS stack; PII in bodies; per-IP limit vs vendor IPs; 3600 s backoff cap gives about 13-14 h of retries | **Outbound [MVP]** with SSRF guard and permanent dedupe. **Inbound vendor webhooks [V2]** as hints only; polling is the correctness path |
| **SDK / embedded** | [Avoid] OpenAPI plus verify snippets | [Later] OpenAPI first | [Avoid] SDK; reference script [MVP] | [Later] would need CORS and publishable keys | [Avoid] | [Avoid] | [Avoid] | An ATS marketplace may later require an embedded panel | **[Avoid]** OpenAPI file plus a curl and Python reference script |
| **MCP** | Remote [Later] (needs our OAuth server); local STDIO wrapper optional [V2] | In-call [Avoid]; MCP-client sync [Avoid]; own server [V2], read-first | [Later] facade | Own server [Later]; calling customer MCP [Avoid] until an egress guard exists | [Later] | [Later] read-only facade | [Later] read-mostly facade | Remote MCP needs an OAuth 2.1 authorization server (RFC 9728, RFC 8707); spec churn; a customer's own LLM may rank candidates from our transcripts; prompt injection | **In-call MCP and MCP-based sync [Avoid]. Own MCP server [Later]**, triggered by a paying customer asking |
| **Direct DB** | [Avoid] | [Avoid] | [Later] paid exception: read-only view, `GRANT SELECT`, never write, never CDC | [Avoid] | [Avoid] | [Avoid] | [Avoid] | Credential custody, schema drift, CDC slots can fill the customer's disk, `default_transaction_read_only` is not a boundary | **[Avoid]** for MVP and V2. EA's read-only-view rules are recorded for an enterprise deal |
| **Event / queue** | [MVP] outbox written in the business transaction, delivered via `background_jobs`; no broker | [MVP] outbox plus new kinds | [MVP] accept HTTPS pushes from customer buses; never consume their broker | [MVP] reuse `background_jobs` plus a small outbox; ids-only payloads | [MVP] internal outbox; UI shows delivery state | [MVP] one new kind; level-triggered sweep; **no outbox** | [MVP] outbox, new kinds, permanent dedupe | `enqueue` runs in its own transaction; succeeded rows are deleted; a new kind needs a migration and a `POLICY` entry or `enqueue` throws; no delayed enqueue; no dead-row view; tenant fairness | **[MVP]** persistent event table with unique keys + delivery table + `background_jobs`. Hybrid of outbox and sweep (disagreement 2) |
| **Customer-side connector** | [Avoid] (Later for enterprise) | [Later] on-prem only | [Avoid] our agent; the customer's script or iPaaS is the connector | [Later]/[Avoid] | [Avoid] | [Avoid] | [Avoid] | Agents are a product line (PKI, upgrades, support) | **[Avoid]** |
| **File / SFTP fallback** | Results CSV [MVP]; SFTP [Avoid] | CSV [MVP]; SFTP [Later] | CSV in and out [MVP] plus `text/csv` on the API; pull from their SFTP [V2]; host our own [Avoid] | CSV [MVP]; SFTP [V2] on demand | Results CSV [MVP]; no SFTP | CSV [MVP]; SFTP [Later] | Results CSV [MVP]; SFTP [Avoid]; escape CSV formula cells | Bulk PII export; formula injection | **[MVP]** results CSV export (gated by `candidates.export`, audited, formula-escaped). SFTP pull [Later] on paid demand; never host one |
| **Canonical model** | Existing nouns; no separate schema | Existing nouns plus external refs | Existing nouns; `contact.*` events | Model = a field allowlist (minimisation) | Nouns plus provenance only | Four Java records; ATS application = our job-scoped candidate | Four nouns; mapping inside each adapter | Zoho hides custom stages from its API; CRM shape later; vendor models carry score fields | **[MVP]** existing tables are the model; field allowlist; application maps to one candidate row |
| **Sync engine** | [V2] scheduled poll with cursor, webhook as trigger, one owner per field | [V2] minimal poller | None in MVP; [V2] poller for pull-only systems | [MVP] minimal, re-checks connection status, fails closed | [MVP] 10-min poll; ATS-owned fields read-only here | [MVP] 15-min chained pages, overlap window, nightly reconcile, tombstones | Generic [Avoid]; [V2] one-way hourly plus "Sync now" | Vendor quotas; no per-org recurring scheduler; clock skew | **With the first connector (slice E):** BE's design, 15-min default inside a per-connection credit budget |
| **Two-way actions** | [V2] notes and human-chosen, customer-mapped stages | [V2] post-call only | [Later] we emit; customer side applies | [V2] never model-triggered | [MVP] note always; status write opt-in, off by default; Undo reverts | [MVP] factual note with retry marker plus mapped human stage | [V2] with compare-and-set against the ATS stage | Recruiter edits in the ATS; custom stages unreachable; undo across systems; duplicate notes | **With the first connector (slice E):** note on each result; stage only on a human decision, opt-in, compare-and-set |
| **Multi-tenancy** | [MVP] forced RLS, narrow lookup policies, `Db.inOrg` | [MVP] same; credentials never in the voice vendor workspace | [MVP] same; per-org API quota | [MVP] same; `StructuralTest` coverage | [MVP] one connection per system per workspace | [MVP] same | [MVP] same; never tenant from payload | None beyond implementation | **[MVP]** as all seven say |
| **Security** | Hashed keys, sealed credentials with a dedicated versioned key, Standard Webhooks, SSRF filter, 5-min tolerance | Treat speech and ATS text as untrusted; no model-driven writes; SSRF | Plus static egress IP, India hosting, DPDP processor role | MVP package (~1 week): connection table, Sealer with AAD, PKCE, dedupe, fixed hosts, fail-closed disconnect, retention job, DPA, breach runbook | Narrow scopes, link instead of copy, audit every send | Sealed credentials, hashed keys and tokens, raw-byte checks, SSRF, audit | Separate key, SSRF, export permission on subscription create, DPDP-aware deletion; `Jobs.results` summary is unscrubbed | Key rotation; logs must not hold PII; DPDP role needs a lawyer | **[MVP]** SA's package plus the SSRF guard plus one outbound serializer |
| **Onboarding UX** | Settings tab: API keys, webhook with test and log; later Connected systems | Connected systems tab: keys, webhook URL, status; no MCP field | Same; about 10 minutes for a developer | Plain-word access list before redirect; write-only credentials; test step; disconnect confirm | 7-step Zoho flow, 2 required choices, calling-number-style status card | Connect, pick jobs, map stages, test, status and activity | Keys, endpoints with "Send test", health line, CSV export on the board | Error filter hides "webhook", "token", "api key"; agent page already says "Integrations"; ATS brand names in UI undecided | **[MVP]** one "Connected systems" tab; messages mapped from stable codes |
| **Build vs buy (unified API)** | [Later]: no Keka or Darwinbox ATS coverage, $650/month, data residency | Neutral; if bought, use REST not MCP | [Later]; does not help custom systems | [V2] evaluate; vendor becomes a sub-processor | [Later] at 3+ systems | Build behind `AtsPort`; Kombo free POC or Merge adapter later | [Later] at 3+ ATSs | Per-account cost vs SMB revenue; Merge Launch syncs daily; candidate PII outside India | **Build first behind `AtsPort`.** Re-evaluate at 3+ ATSs requested by paying customers |
| **First integration** | Generic API + webhooks + CSV [MVP]; Zoho Recruit [V2] | Generic; then one vendor via REST; not MCP | Generic push API + feed + webhooks + CSV | A vendor with OAuth or scoped service user and signed webhooks | Zoho Recruit by OAuth [MVP]; no public API | Generic plus one native connector (prior: Zoho) both [MVP] | CSV export, then keys + webhooks; native ATS by paying-pilot demand | No repo data on which ATS customers use | **Generic slices first; Zoho Recruit as slice E only after a pilot confirms it** (disagreement 1) |
| *Other: phone canonical form* | [MVP] E.164 before automated intake | (not covered) | [MVP] require E.164 on the API | (not covered) | Reuse CSV validation and `+91` default | [MVP] prerequisite | [MVP] prerequisite | `PhoneNumbers.toE164` ignores `country_code`; raw-text uniqueness creates duplicates | **[MVP] prerequisite** (slice 0) |
| *Other: auto-dial on intake* | [V2] after consent/DND decision | (not covered) | [V2] decision first | (not covered) | [V2] after legal advice (TRAI TCCCPR) | [V2] founder decision | [Later] founder decision | Consent, DND, budget | **Not before a written founder decision**; earliest V2 |
| *Other: in-call tools and dial-time data* | No in-call ATS tools | Pass an allow-list of candidate fields as dial-time `dynamic_variables` [MVP once intake exists]; in-call webhook tool [Later] | [Later] via customer-exposed endpoint | No in-call tools | (not covered) | In-call tools [Later] | [Avoid] for hiring | Latency, injection, PII to the voice vendor | In-call tools **[Avoid] for hiring**; dial-time variables **[V2]** product decision |

---

## 2. Disagreements

Each item: the topic, who holds which side, the evidence for each side, my proposed resolution, and the exact question that settles it.

### D1. What ships first: generic surfaces or one named ATS connector

- **Side A (generic first):** IA, AM, EA, CR. BE wants both in MVP but orders generic first.
- **Side B (named connector first):** UX (Zoho Recruit by OAuth; no public API or API keys in MVP). SA also scopes MVP to "one ATS" and puts API keys and outbound webhooks in V2.
- **Evidence for A:**
  - One build serves every custom app, iPaaS (Zapier, Make, n8n, Pabbly) and cloud bus. FACT: EventBridge API destinations accept API-key auth (https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-target-connection-auth.html); Pabbly calls arbitrary HTTP APIs (https://www.pabbly.com/connect/).
  - It is the base that a connector, a Zapier app and MCP all reuse.
  - No repo data says which ATS customers use (FACT, product map U9).
- **Evidence for B:**
  - The customers are SMB recruiters, not developers. A generic API needs a developer or an iPaaS on their side (EA concedes this).
  - FACT: "Webhooks by Zapier" is premium and not on the Free plan (https://help.zapier.com/hc/en-us/articles/8496326446989-Send-webhooks-in-Zaps), so even no-code wiring may cost the customer money.
  - Only a named connector is "connect once" for a non-technical team.
- **Proposed:** Build the generic slices first (they are smaller and every later piece reuses their tables). Build the Zoho Recruit connector (slice E) next, but only once at least one pilot confirms Zoho Recruit. If pilots use something else, slice E targets that system instead.
- **Question to settle:** "For each of the first five pilot customers: where do candidates live today (which ATS, spreadsheet, job-board inbox), and does the customer have a developer or a paid iPaaS account?"

### D2. How outbound events are made durable: transactional outbox or level-triggered sweep

- **Side A (outbox in the business transaction):** IA, AM, EA, SA, UX, CR.
- **Side B (no outbox; sweep compares current state with what was last pushed, events only wake it):** BE.
- **Evidence for A:** Stripe and Standard Webhooks practice (event id per delivery, consumers dedupe on it, https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md). A feed (`GET /v1/events`) and webhooks need discrete, numbered events anyway.
- **Evidence for B:**
  - FACT: `JobQueue.enqueue` opens its own transaction (`JAVA/jobs/JobQueue.java` line 66; BE B1), so "enqueue in the same transaction" needs new code.
  - FACT: succeeded job rows are deleted (`JobQueue.java` line 145), so the queue cannot dedupe after success.
  - FACT: stage changes emit no event and are audited in a separate call (`JAVA/hiring/HiringController.java` lines 362-396).
- **Evidence I added by reading the code:** FACT: a result is not written in one transaction. `VoiceSessions.apply` writes provider facts in one transaction, then runs the LLM extractor outside any transaction, then may write the filled summary in a second transaction, then publishes events (`JAVA/voice/VoiceSessions.java` lines 505-554). So "write the `result.ready` row in the same transaction as the result" is not available without restructuring `apply`. That weakens side A for results and supports BE.
- **Proposed (hybrid):**
  - One persistent `integration_events` table with a permanent unique `dedupe_key` (everyone agrees a permanent key is required; CR F10).
  - Stage-change events are written in the same transaction as the stage update (a true outbox: it is one transaction today).
  - Result events are written by an idempotent `emit` called at the end of `apply`, plus a sweep that emits for any ended session with content and no event row. The key includes a content hash, so repeated `apply` runs create nothing new and a later, richer result creates exactly one new event.
  - ATS write-back (slice E) is level-triggered as BE proposes: the adapter compares desired state with what it last pushed. Events only wake it.
- **Question to settle:** "Do receivers need every intermediate change (an event stream), or only the latest state of each candidate?" My assumption: custom apps want events (webhooks and feed); ATS write-back wants latest state (so Undo within a minute writes nothing).

### D3. Where external ids live: columns on `jobs`/`candidates` or a link table

- **Side A (columns):** IA, EA, CR ("connection_id, external_id, last_synced_at on jobs and candidates").
- **Side B (separate link table with sync state):** BE.
- **Evidence for A:** simplest upsert path; no join on reads; IA notes a candidate row already equals an ATS application.
- **Evidence for B:** a connector needs per-link sync state (remote state, last pushed stage, hashes) that would otherwise spread over core tables; supports more than one connection per workspace; keeps the stable nouns clean (product map D11). Both sides agree on the identity rule (ATS application id maps to our job-scoped candidate row).
- **Proposed:** two small link tables, `job_links` and `candidate_links`, each with a real foreign key and `ON DELETE CASCADE` (avoids BE's polymorphic `local_id`), used from the MVP API onward. A cheap `candidates.source` value (`api`, `integration`) keeps the board label join-free.
- **Question to settle:** "Can one candidate row ever be linked to two outside systems at once (for example their ATS and their own app)?" If the answer is a firm never, columns are enough and simpler.

### D4. When our public API and API keys arrive

- **MVP:** IA, AM, EA, BE, CR. **V2:** SA, UX.
- **Evidence for MVP:** already decided in the spec ("hashed, scoped, revocable API keys bound to an organization", `BRD's/04_DATABASE_API_SPEC.md` line 410); serves every system with a developer or iPaaS.
- **Evidence for V2:** SA: outbound webhooks bring customer-supplied URLs (SSRF) and keys bring bulk-PII leak risk; UX: no customer has asked.
- **Proposed:** MVP, with the SSRF egress guard and "no PII by default" keys in the same slice, which removes SA's objection.
- **Question to settle:** "Will at least one pilot connect through its own developer or an iPaaS in the first month?" If none will, the public API can wait behind slice E.

### D5. Inbound vendor webhooks in the first connector

- **MVP:** SA (verified, deduped, fetch on notify), BE (hints). **Poll only:** UX. **V2:** IA, AM, CR.
- **Evidence:**
  - FACT (checked against Zoho's own plan page during this synthesis): Zoho Recruit webhooks exist only on Professional (10,000 calls/day) and Enterprise (20,000 calls/day); Free and Standard have none (https://www.zoho.com/recruit/plan-comparison.html). UX's report said "Standard or higher" from a help-page summary; the plan page contradicts it. IA's report was right.
  - FACT: Greenhouse says webhooks do not guarantee delivery (https://docs.greenhouse.io/webhooks.html, via CR).
- **Proposed:** first connector release polls only. Vendor webhooks are V2, as re-fetch hints, never as the data.
- **Question to settle:** "Is pickup within about 15 minutes acceptable to recruiters, or do pilots need it within a minute?"

### D6. Polling interval for the first connector

- **10 minutes:** UX. **15 minutes:** IA, BE. **Hourly plus "Sync now":** CR.
- **Evidence (FACT, Zoho limits page, checked): https://www.zoho.com/recruit/developer-guide/apiv2/limits.html**
  - A Get Records call costs 3 credits.
  - Daily credits: Free 5,000; Standard 5,000 + 250 per user (maximum 100,000).
  - Get Records accepts an `If-Modified-Since` header (https://www.zoho.com/recruit/developer-guide/apiv2/get-records.html), so one changed-records call can cover all linked jobs.
- **Arithmetic (RECOMMENDATION, with an ASSUMPTION of two Get Records calls per tick):** 15 minutes is 96 ticks × 2 calls × 3 credits = 576 credits a day, about 12% of the Free quota. Ten minutes is about 17%. If the adapter instead needs one call per linked job (unverified), ten jobs every 10 minutes is about 4,750 credits a day, which would starve a 10-user Standard account (7,500 credits) of credits for its other integrations.
- **Proposed:** 15 minutes by default, capped by a per-connection budget (at most about 20% of the plan's daily credits, slowing down automatically), plus a "Sync now" button.
- **Question to settle:** the same pickup-delay question as D5, plus "How many open jobs does a typical pilot keep linked?"

### D7. What an API key's permissions are tied to

- **Explicit permission subset on the key:** IA, SA, BE, CR. **Bound to an existing system or custom role:** EA.
- **Evidence:** EA: custom roles already exist and act as scopes with no new system. Others: an explicit list cannot change silently when someone edits a role; SA adds a deny-list of admin permissions.
- **Proposed:** explicit subset stored on the key, picked from three presets in the UI ("Send candidates in", "Read results without contact details", "Read results with contact details"), capped at the creator's own permissions, admin permissions never allowed.
- **Question to settle:** "Should any integration key be able to read phone, email or transcript, or must that always need an admin's explicit choice?"

### D8. How much data an outbound webhook carries

- **Thin (event type and ids only):** EA, SA. **Facts plus opt-in summary/answers gated by the creator's permissions:** IA, BE. **Facts, scrubbed:** CR, AM.
- **Evidence:** Standard Webhooks calls thin payloads "more future proof" (spec, link above). iPaaS users find a self-contained payload easier (no authenticated second call).
- **Proposed:** default payload = ids, external ids, call status, failure reason, timestamps, duration, stage and who decided. Summary and answers only when the endpoint opts in and its creator holds `calls.read_transcript`. Contact PII (phone, email, resume) never in a webhook body; fetch it through the API.
- **Question to settle:** "May the advice-scrubbed summary and the answers leave HRVoice in a webhook body when an admin opts in?"

### D9. What goes into the note written to the ATS

- **Summary + answers + link:** UX, BE, IA. **Also a coverage count ("6 of 7 questions answered"):** IA, flagged as needing approval. **Link only, as an option:** raised as a question by IA, UX, BE, CR.
- **Evidence:** the product bans "score" and "fit" (`docs/superpowers/specs/2026-10-02-app-consistency.md` section 8); the coverage figure is the same number as `fitPercent` (`JAVA/engine/Coverage.java`). A note with answers lets the reader count for themselves.
- **Proposed:** outcome, each must-ask question with its answer ("not answered" when missing), the scrubbed summary, a sign-in link for transcript and recording. No coverage count, no transcript, no recording file.
- **Question to settle:** "Is a coverage count acceptable in the ATS note, and may the summary and answers be copied into the customer's ATS at all?"

### D10. Who owns contact fields on ATS-linked candidates

- **Read-only in HRVoice:** UX, BE. **Refreshed from the ATS until a person edits locally:** CR. **Overwritten on the next sync:** IA.
- **Evidence:** read-only needs no conflict rules and matches BE's one-owner-per-field rule; CR's rule keeps local fixes but needs per-field "edited here" tracking.
- **Proposed:** read-only, with the hint "Edit this in Zoho Recruit; it updates here within 15 minutes".
- **Question to settle:** "Is it acceptable that a recruiter cannot fix an ATS-linked candidate's phone number inside HRVoice?"

### D11. Whether a stage change made in the ATS changes our stage

- **One-way out only:** IA, BE (a closed or deleted remote state only blocks dialing). **Allow, attributed to the ATS user:** offered by AM (Q3) as an option.
- **Evidence:** our stage is "a person on the customer's team decided in HRVoice" (product map 8.1); an inbound stage from an ATS has no reliable named person.
- **Proposed:** ATS stage changes never change our stage. A rejected, hired, withdrawn or deleted application in the ATS marks the link closed, blocks dialing and shows "Closed in Zoho Recruit".
- **Question to settle:** AM Q3: "May a stage change arrive from another system rather than from a named person in HRVoice?"

### D12. Safeguards on stage write-back

- **Compare-and-set against the ATS's current stage:** CR. **Undo also reverts the ATS status:** UX. **Plain mapped write:** IA, BE. All agree: off by default (UX), customer-mapped, only on a human decision.
- **Proposed:** all three: opt-in; only `reviewed` and `declined` are ever sent; re-read the ATS stage before writing and skip (with a note) if someone moved it; Undo attempts a revert and says so if it fails.
- **Question to settle:** BE Q3: "May 'Not moving forward' set a reject status in the ATS, which in many ATSs emails the candidate (ASSUMPTION), or should it only add a note?"

### D13. MCP timing and shape

- **Own server V2, remote, read-first, no stdio package:** AM. **Local STDIO wrapper V2, remote Later:** IA. **Later:** EA, SA, UX, BE, CR.
- **Evidence:** FACT: the current MCP revision is 2026-07-28 (https://modelcontextprotocol.io/specification/latest redirects there, checked). Remote MCP over HTTP requires OAuth 2.1 resource-server behaviour, RFC 9728 metadata and audience checks (AM M8). FACT: the launch spec says MCP is "a façade later" (`docs/superpowers/specs/2026-09-16-hiring-production-launch-design.md` line 72). No customer demand is recorded (AM Q2).
- **Proposed:** Later, triggered by a paying customer asking. The first step then is read-only.
- **Question to settle:** AM Q2: "Has any customer asked to use HRVoice from Claude, ChatGPT or Copilot?"

### D14. Passing candidate data into the call at dial time

- **MVP once ATS intake exists:** AM only (others silent).
- **Evidence:** FACT: `dial()` sends no per-candidate data (`JAVA/voice/HostedVoiceAdapter.java` lines 252-256, AM A5); the provider accepts `dynamic_variables` on the Twilio outbound path (AM E6). Exotel path support is unverified (AM E8). Each field sent is PII sent to the voice vendor.
- **Proposed:** V2, as a product decision, not part of the integration loop.
- **Question to settle:** "Should the agent greet the candidate by name and mention the role, using data we already hold?"

### D15. Enterprise fallbacks: direct DB view, SFTP pull, customer tunnel

- **Allowed as paid exceptions (Later/V2):** EA (and SA for SFTP on demand). **Avoid:** IA, AM, UX, BE, CR.
- **Evidence:** EA's ladder (customer pushes, bus pushes, file, their exposed endpoint, read-only view) and its hazards (CDC slots fill disks, read-only session settings are not a boundary; https://debezium.io/documentation/reference/stable/connectors/postgresql.html, https://www.postgresql.org/docs/current/runtime-config-client.html).
- **Proposed:** Avoid for MVP and V2; keep EA's ladder as the written answer for an enterprise deal.
- **Question to settle:** EA Q3: "Is any early customer an enterprise that can only offer on-prem access, SFTP or a database?"

### D16. When to harden the existing voice-provider webhook

- **MVP (5-minute window, drop the no-timestamp legacy form, dedupe):** SA. **When convenient:** IA.
- **Evidence:** FACT: the code accepts ±30 minutes and a legacy form with no timestamp (`JAVA/voice/HostedVoiceAdapter.java` lines 198-230). The vendor's tolerance and retry timestamps are not documented on the page checked (backend map §21, unverified). Once results drive customer pushes, a replay matters (SA G3).
- **Proposed:** the permanent event keys (D2) make replays harmless for customers in MVP. Narrow the window only after confirming how the vendor timestamps retries, so real retries are not rejected.
- **Question to settle (technical):** "Does the voice provider re-sign retried webhooks with a fresh timestamp, and is the legacy header still sent?"

### D17. Retention job and processor contract as a launch gate

- **Gate for the first integration:** SA. **Mentioned but not gated:** others.
- **Evidence:** FACT: no retention code exists; the docs promise 90 days (SA E16). Integrations multiply stored PII (people pulled in but never called). DPDP Rules commencement dates and wording come from secondary sources (unverified).
- **Proposed:** gate any automated intake (API batch or connector) on a decided retention period and a working purge job; DPA and breach runbook before the first paying connector customer.
- **Question to settle:** "What retention period applies to candidates who were pulled in but never called, and to transcripts?" (product map C8), plus legal confirmation that we act as a processor.

### D18. Event names: hiring words or use-case-neutral words

- **`candidate.stage_changed`:** IA, AM, CR. **`contact.created`, `contact.stage_changed`:** EA.
- **Evidence:** FACT: today's domain events are already neutral (`call.started`, `call.ended`, `result.ready`, with `workUnitId` and `contactId`; `JAVA/engine/DomainEvents.java`). The product wants support and sales use cases on the same platform.
- **Proposed:** neutral event types (`call.ended`, `result.ready`, `contact.stage_changed`) with `useCase` in the payload; REST paths stay `/v1/jobs` and `/v1/candidates` because those are the actual tables.
- **Question to settle:** "Will support and sales use cases reuse the `jobs`/`candidates` tables, or get their own?"

### D19. Whether to try a unified API now

- **Run Kombo's free proof of concept if pilots span several ATSs:** BE. **Evaluate in V2:** SA. **Later:** IA, EA, UX, CR.
- **Evidence:** FACT: Merge Launch is $650/month for up to 10 accounts, then $65 each, with daily sync on that plan (BE E8, CR F39). Kombo lists Zoho Recruit but not Keka or Darwinbox (BE E9). ADR-006 requires India-region compute; where these vendors store data is unverified.
- **Proposed:** build first behind `AtsPort`; revisit at three or more ATSs requested by paying customers.
- **Question to settle:** "What does one SMB customer pay per month, and is 'data stays in India' part of the sales promise?"

---

## 3. Factual conflicts I checked against primary sources

| Conflict | Reports | Result | Source |
|---|---|---|---|
| Which Zoho Recruit plans have webhooks | IA: Professional and up. UX: Standard and up | **IA is right.** Free and Standard: none. Professional: 10,000 calls/day. Enterprise: 20,000 | https://www.zoho.com/recruit/plan-comparison.html |
| Zoho Recruit Free plan limits relevant to testing | not stated | Free: **1 active job**, 5,000 API credits/day, no webhooks | same page |
| Cost of a Zoho Get Records call | CR: 3 credits (search summary) | **3 credits** confirmed; IDs of deleted records 2 credits; most others 1 | https://www.zoho.com/recruit/developer-guide/apiv2/limits.html |
| Cheap incremental polling on Zoho Recruit | UX: unverified | Get Records accepts `If-Modified-Since`; `per_page` default 200 | https://www.zoho.com/recruit/developer-guide/apiv2/get-records.html |
| Where a Zoho Recruit note can attach | UX: candidates, not applications; IA (via Kombo): "note to application" | Create Notes lists candidate, jobopenings, Interview and others; **applications are not listed** | https://www.zoho.com/recruit/developer-guide/apiv2/create-notes.html |
| Current MCP specification revision | IA, AM: 2026-07-28. EA: checked 2025-06-18. SA: 2025-11-25 | **2026-07-28** (the `latest` URL redirects there) | https://modelcontextprotocol.io/specification/latest |
| Is the summary scrubbed for every reader | CR: only in the controller | Confirmed: `Jobs.results` copies the stored summary as is (`JAVA/hiring/Jobs.java` line 340); the scrub is in `JAVA/hiring/HiringController.java` line 250 | repo |
