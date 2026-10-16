# ADR-010 — Integration layer: connect a customer's system once, data in, results out

**Status:** PROPOSED — founder to accept
**Date:** 2026-10-03
**Relates to:** ADR-002 (sessions), ADR-003 (tenant isolation), ADR-004 (permissions), ADR-006 (hosting), ADR-007 (agent runtime and VoicePipeline), ADR-008 (Java backend, PROPOSED; this ADR depends on Java serving production)
**Design record:** `docs/integrations/architecture-draft-v13.md` (the agreed plan; this ADR is its section 18), `docs/integrations/ARCHITECTURE.md` (the write-up), `docs/integrations/02-resolutions.md` (every decision and why)
**Out of scope:** bulk calling, `docs/integrations/later-bulk-calling.md` (NOT APPROVED)

Labels: **FACT** (with source), **RECOMMENDATION**, **ASSUMPTION**, **unverified**. `JAVA/` = `apps/api-java/src/main/java/desk/`.

---

## Context

- **The goal.** "Connect your system once, data flows in, our agent works, results flow back." For an Indian SMB hiring team that means: applicants arrive from the hiring system (ATS) they already use, the agent phones them, and each call's result goes back to that system without anyone copying it.
- **Today there is nothing to build on outside the app.** FACT: no integrations, no API keys, no outbound webhooks, no MCP server; candidates enter by hand or CSV; results are read only in the app (`docs/integrations/00-current-system-product.md` §1). The only identity is a browser session (`docs/integrations/00-current-system-backend.md` §1).
- **What exists and can be reused.** FACT: forced row-level security on every tenant table through `JAVA/platform/Db.java`; a durable Postgres job queue (`MIG/0030_background_jobs.sql`, `JAVA/jobs/JobQueue.java`); `AuthInterceptor` with per-field PII redaction; `AuditService`; `AdviceGuard`; the CSV-import validation; seeded but unused `integrations.*` permissions.
- **It is a sync problem, not an AI problem.** It needs a machine identity, external ids, a durable record of what is still to be sent, a way to send it, and one adapter per named system. FACT: MCP does not provide delivery or retries ("a broken response stream loses the in-flight request", https://modelcontextprotocol.io/specification/2026-07-28/changelog).
- **The product rule.** FACT: HRVoice never recommends hire or reject and never scores or ranks; a person decides (`apps/web/PRODUCT.md` line 56). Anything we write into a customer's system must keep that rule with no person reading it first.
- **Production runs only Nest.** FACT: `Dockerfile` line 61 starts `apps/api/dist/main.js`, and `docker/Caddyfile` routes to it. So nothing here reaches customers until Java serves production.
- **Which system to connect first is unknown.** FACT: no repo data says which ATS customers use (product map U9). The evidence that Indian SMBs use Zoho Recruit is vendor-written (https://www.thehirehub.ai/blog/best-applicant-tracking-system-india-2026).

## Decision

**Scope and order.** Gate P (Java in production) → slice 0 (prerequisites) → slice A (results CSV export) → then, only when a pilot confirms its path, Core plus **either** the Zoho Recruit connector (E1, then E2 for stage write-back) **or** the developer surface (Dev: API keys, seven `/v1` routes, an events feed). Outbound webhooks only if a Dev pilot needs push. Everything lives inside `apps/api-java` on the same Postgres: no new service, broker, Redis, Kafka or workflow engine. Two risks that exist today, item G (self-serve calling on the shared number) and item W (retention, workspace deletion, restore), are recorded as launch gates with founder decisions 15 and 16 and are not designed here.

The rules, one invariant each. The mechanism that keeps each rule, and its test, are in the named section of `architecture-draft-v13.md` and go into the slice's build sheet, not into this ADR.

**Gates**
1. No slice reaches customers before Java serves production (gate P), which includes the hosted-adapter fix-up, an external uptime monitor and three supervised live checks (R18, a conversation id on every accepted dial, provider delete with the production key); a failed R18 check blocks quoting E until the founder picks a fix (§13.1).
2. Core is built only with E or Dev and goes live only once Nest is no longer routed in production; from then, rollback is a Java image rollback (§13.1).
3. Removal, the one erasure path, provider deletes and the DPA go live before the first external connection (§11.1 item 10).
4. Self-serve calling (item G, decision 15) and retention, workspace deletion and restore (item W, decision 16) are risks that exist today; this plan records them and does not design them (§13.1).

**Tenancy and identity**
5. Every new table has forced row-level security on `organization_id`, is in `StructuralTest`, and cascades every foreign key; the tenant comes only from server state (§2.3, §10).
6. An API key acts only as a bearer header on `/v1` handlers on `API_PUBLIC_HOST`, with the key's permissions intersected with its creator's live ones, and `/v1` code never re-reads `role_permissions` (Dev; §6.6, §10).
7. Workers act as `inOrg(org, Db.NIL)` with a NULL audit actor, and every integration idempotency key contains an organisation or connection UUID (§6.8, §10).

**Product rule**
8. Only `ExternalPayloads` builds what leaves HRVoice, and it never carries a summary, score, coverage, rank or recommendation; answers come only from the job's own questions, as capped plain text or "No answer noted; check the recording" (§6.2).
9. Only a named person's decision moves an ATS status, and only where that status is still where HRVoice found it or last put it; otherwise a note that claims nothing about who set the status (E2; §7).
10. Machine-sourced text is fenced before it reaches a prompt, extraction never rates the candidate, and agent linking stays human (§11.1 item 9).

**Sync and delivery (Core + E1; stage rows from E2)**
11. Each field flows one way: contact fields in (owned by the ATS on linked rows, and corrected from it), job text copied once, results and decisions out (§4, §5).
12. One inbound record never stops another, an unexpected error included, and a record HRVoice could not take is listed with its fix and taken when it changes; a job linked at any time brings in its people at the trigger status, not only those changed since the last scan, and links people already in HRVoice whatever their ATS status; a job closed in the ATS is still read (§5).
13. Every change in the ATS is read by two completed scans, including the old records of a job linked during a scan, and a scan cut short never moves the window (§5).
14. Outbound to an ATS is one row per call or per candidate stage, each with its own backoff and no order; a row that throws backs off like any other; nothing is sent for a person whose link is not live, whose call is erased, or whose connection was disconnected mid-run; a note already sent is never sent again because a job was unlinked and relinked; anything unsent after 7 days is shown (§5, §6.1, §7).
15. Nothing the ATS does erases a person in HRVoice, and no read from the ATS ever writes to an anonymised link (§5).

**Events (Dev only)**
16. In an org with a feed, the events lock is the first statement of every emitting transaction; `seq` per org never goes down, `410` is defined against the oldest retained `seq`, and an undone stage event is marked `superseded` (§6.5).

**Background work**
17. Every dial is one person's click through `startOutbound` and `dialLocked`; this plan adds no bulk or automatic dialing, and a dial it refuses never re-provisions a hosted agent (§5, §10).
18. The tick and the 5-minute loop do database work only, enqueue after commit and catch errors per org; all vendor and provider HTTP runs on the integration lane, within a per-run budget, stopping at the first timeout or 5xx, taking items in an order no single failing item can monopolise; a lane thread claims only what it runs, survives any error, and depends on no Spring scheduler thread (§6.8).
19. `JOBS_ENABLED=false` stops all background work, emails included; a problem with one customer's ATS is handled by that connection's Disconnect (§6.8).

**Data protection**
20. One erasure path, through `DELETE /candidates/{id}` and (Dev) a `/v1` deletion; no other code deletes a candidate or job row; an anonymised ATS link keeps only a keyed suppression hash, checked per connection, whose key never rotates (§11.1 item 10).
21. Secrets live only in `secrets_sealed` and are never overwritten by an older token; a replaced token is revoked at the vendor, and a sign-in that returns no refresh token replaces nothing; no vendor call runs under the grant of a person who lost access; raw vendor bodies, token-bearing URLs and database error details never reach logs or `last_error`; audit rows store route templates and are kept (§5, §10, §11.1).
22. Until Nest is no longer routed in production, migrations only add things Nest ignores (R10).

**Open inside this decision.** How slice E pages a full read of Zoho Recruit is not settled (see "Review status"). It is decided in E's opening spike, before any E code, without changing rules 12 and 13.

## Consequences

**What we get**
- Results reach the customer's system even if nobody opens HRVoice: a background fetch covers lost provider webhooks, and "result unavailable" replaces silence.
- One serializer and one merge-blocking test hold the product rule for every outbound body: ATS notes, CSV rows, `/v1` results, the feed, and any later MCP or webhook.
- No new infrastructure: the integration lane, tick and delivery rows reuse `background_jobs`, `Db.inOrg`, RLS, the interceptor and audit.
- Failures are visible: a status with a reason, one admin email on any "needs attention", delivery and issue lines, expiry after 7 days, an uptime monitor.

**What it costs or leaves out**
- Every imported person still needs one Call click (R25). Founder decision 10b asks whether that is acceptable for the first pilots; bulk calling is a separate, unapproved design.
- Pilots who keep candidates in Excel or Google Sheets get CSV in and out only; "connect once" is not met for them until a Google Sheet connection (V2).
- Pickup is within about 15 minutes, not real time (Zoho webhooks need a paid plan).
- A person deleted in the ATS stays in HRVoice, callable by a click, until someone removes them here (decision 9). Detection and automatic erasure are V2.
- Zoho Recruit accounts must have the Applications module on; existing accounts do not by default (FACT, https://help.zoho.com/portal/en/kb/recruit/talent-management/applications/articles/enabling-the-applications-module).
- Known ceilings, accepted: a crash during a note write can leave one duplicate note; possibly 20 Zoho connections per OAuth client until Zoho support answers (unverified); one short transaction per org per tick until about 1,000 active orgs.
- Nest is removed from production when Core ships; rollback after that is a Java image rollback.
- ASSUMPTION, for ordering only: quote a Zoho pilot slice 0 + Core + E1, about 5.5-7 weeks of one engineer after gate P, plus item W (about 1.5-2 weeks) for a paying pilot, and only after gate P's live calls, E's spike and the founder's decisions 1 and 10b.
- Obligations before the first external connection: "Remove this person", one erasure path, provider deletes, a DPA naming sub-processors and stating today's gaps, a breach runbook. ASSUMPTION: HRVoice is the employer's DPDP data processor; needs a lawyer.

## Alternatives rejected

1. **MCP-first** (sync through MCP, or our MCP server before anything else). MCP stores and retries nothing; a broken stream loses the in-flight request (FACT, changelog above). Vendors' MCP servers are layers over their REST APIs for a user's AI assistant, scoped to that user (FACT, https://docs.ashbyhq.com/ashby-mcp-server-beta, https://www.zoho.com/recruit/mcp.html). A remote server needs OAuth 2.1 resource-server behaviour, and no customer has asked (`docs/integrations/01-comparison.md` D13). **Kept as Later:** our own read-only MCP server at `/v1/mcp`, when a paying customer asks.
2. **MCP inside live calls.** On an outbound screening call the only human is the candidate, who cannot approve tool calls, while the spec says a human SHOULD be able to deny them (FACT, https://modelcontextprotocol.io/specification/2026-07-28/server/tools) and the provider recommends "Always Ask" (FACT, https://elevenlabs.io/docs/agents-platform/customization/tools/mcp). The candidate can inject instructions; write tools would let the model act on the ATS with no person deciding; multi-second tool latency is audible; a failure cannot be retried after the call; customer credentials would sit in our one shared provider workspace; MCP is unavailable under Zero Retention Mode (same source). **Avoid.**
3. **A unified-API vendor now** (Merge, Kombo). Merge Launch is $650 a month for up to 10 accounts with daily sync (FACT, https://www.merge.dev/pricing); Kombo lists no Keka, Darwinbox or Naukri RMS ATS connector (FACT, https://www.kombo.dev/integrations); where they store candidate data is unverified against ADR-006's India-region requirement; it adds a sub-processor at our smallest-customer stage. **Later:** one more `AtsPort` adapter once three or more ATSs are requested by paying customers.
4. **Direct database access.** We would hold credentials to the customer's system of record; they would open a port or a tunnel; schema drift breaks sync silently; `default_transaction_read_only` is not a security boundary (FACT, https://www.postgresql.org/docs/current/runtime-config-client.html); a stalled replication slot fills the customer's disk (FACT, https://debezium.io/documentation/reference/stable/connectors/postgresql.html). **Avoid.** A read-only view is kept only as a Later paid exception under a DPA; read-write, CDC and replication never.
5. **An ordered event log in Core.** ATS notes do not need order (each note is about one call), and stage write-back is level-triggered from the last stage it handled. In rounds 1-6 the ordered log in Core needed a drain, a poison-head probe, `fanout_seq` and `missed_until` (`02-resolutions.md` R7.2 row 16), and the round-6 Critical Reviewer major was that Core built the ordered log for E, which does not need it (R7.4 CR-1; R7.0 item 2). **Replaced** by one delivery row per item with its own backoff. The ordered log ships only with Dev, for the feed.
6. **Bulk calling inside this ADR** ("Call selected (N)"). Four of the five round-6 majors were about it: a dispatcher, capacity control across tenants, hosted-agent lifecycle, and an unverified TRAI auto-dialer question (FACT, https://trai.gov.in/sites/default/files/2025-02/Regulation_12022025.pdf). It is a calling-engine feature, not integration. **Moved** to `docs/integrations/later-bulk-calling.md`, NOT APPROVED, to be designed and reviewed on its own.
7. **A cross-vendor canonical schema** (or a field-mapping editor). Our tables already are the model: a job, a job-scoped candidate (one ATS application), a call result, a person's decision. Vendor shapes are mapped inside each adapter onto four small records (`ExternalJob`, `ExternalApplication`, `ExternalStage`, `Page`), and vendor field names never leave it (FACT pattern, `JAVA/voice/VoicePorts.java` lines 7-10). Vendor models also carry score fields we must never copy. **Avoid.**

## Review status

13 drafts. Rounds 1-6 on the full plan did not converge (majors 17, 12, 9, 4, 1, 5). The orchestrator then made a lead decision (`02-resolutions.md` "Round 7 (lead decision)"): bulk calling moved to `later-bulk-calling.md` (NOT approved), the ordered event log moved out of Core into the developer slice, and "remove, don't add". Rounds 7-13 on the simplified plan: majors 5, 2, 2, 2, 1, 1, 1. On v13, six of seven experts approve with changes; the Critical Reviewer blocks on ONE item inside the Zoho connector slice (E): full reads paged by offset under Zoho's assumed 2,000-record cap would skip the newest applications. Its proposed fix (page by `Modified_Time` with `If-Modified-Since`, no offsets; fallback: `Created_Time` descending, and a refused full read counts as completed) removes mechanisms. Since round 7 no reviewer disputes the overall architecture; each remaining objection has been a specific defect in slice E's sync rules with an agreed fix. The orchestrator stopped the rounds there. That item is OPEN and must be settled in E's opening spike before any E code; E is itself gated on a pilot using Zoho Recruit.
