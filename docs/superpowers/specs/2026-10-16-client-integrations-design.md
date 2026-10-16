# Client integrations, usage limits and support: design

Date: 16 October 2026. Status: draft for founder review.

## Why

A hiring team won't move its work onto a new website. HRVoice has to work from inside the tools a company already uses, so the whole flow runs from there: job in, candidates in, calls placed, results back. Nobody has to log in to HRVoice, upload a spreadsheet or copy anything by hand. Once HRVoice is built into a customer's process, they are also unlikely to leave.

## Goals

- A company can run the whole screening flow from its own system: create or sync a job, send candidates, start calls (automatically or on a button), and receive answers, transcript, recording link and summary.
- Every kind of company has a way in:
  - its own developers;
  - no-code tools;
  - AI assistants;
  - a ready-made hiring tool;
  - nothing at all (our dashboard, as today).
- Billing is per completed screen, counted automatically, with per-company limits.
- Support: tickets can be raised from the dashboard, live chat, email, API/SDK or MCP, all into one inbox for the founder.
- Nothing reaches a client before it has passed one local end-to-end check against a fake client company.

## Non-goals (this round)

- Building every hiring-tool connector up front. Zoho Recruit is first; the others follow the order above as clients ask, and the unified-API route covers the long tail.
- **Browser extension** ("Screen with HRVoice" on any web page). Parked by the founder on 16 Oct: too much for this round, to be built later on the same `/v1` core.
- Online card payments. Usage counts plus an invoice export are enough for now.
- Bulk calling campaigns. Calls still go one by one, with limits.
- Status changes written back into the client's tool automatically (Zoho "move stage"). Later, only if a pilot asks.

## Anti-goals (a failure even if it works)

- Anything sends a hire/reject recommendation or a score to a client system. Results are facts: answers, transcript, recording link, neutral summary. A person on the client's team decides. This rule (`scrubHireAdvice`) already exists and stays.
- One company can see or touch another company's data through any door. API keys, MCP and tickets all go through the same tenant isolation rules (RLS) as the dashboard.
- A runaway client script places hundreds of calls or runs up a bill.
- A client loses a "call finished" result because their server was down for an hour.
- Integration paths that pass their own tests but break each other. Everything is tested together.

## Shape: one core, several ways in

```
            Client's system / Zapier / AI assistant / Zoho Recruit / our dashboard
                 │ SDK      │ Zapier app   │ MCP server  │ Zoho connector │ (existing UI)
                 └──────────┴──────┬───────┴─────────────┴────────────────┘
                          Public API  /v1  (API keys, scoped)
                                   │
        existing services: jobs, candidates, calls (own loop / ElevenLabs), results, costs
                                   │
         outbound events ("call.completed" …) → signed webhooks with retries (pg-boss)
```

Every way in is a thin layer over the public API. No way in gets its own business logic.

### 1. The core (inside `apps/api`)

- **API keys.**
  - Created by a company admin in Settings → Developers.
  - Format `hrv_live_<random>` (or `hrv_test_` for test mode). Only a SHA-256 hash is stored; the key is shown once.
  - Each key has a name, scopes (`jobs`, `candidates`, `calls`, `results`, `tickets`), last-used time, and can be revoked at once.
  - New table `api_keys` with RLS like every org table.
  - The existing auth guard learns one more way in: `Authorization: Bearer hrv_…` resolves to the key's organization and a non-human "API key" actor. Its permissions are the key's scopes mapped onto the existing permission list. Audit events record the key, not a person.
- **Public API `/v1`.**
  - A separate set of controllers with a stable, versioned contract. It reuses the existing services (jobs, candidates, outbound call, results) and never duplicates logic. The internal dashboard routes stay free to change.
  - Resources:
    - jobs (create/update/list, must-ask questions, language);
    - candidates (create one or many; upsert by the client's own `externalId`);
    - calls (start, get status);
    - results (answers, transcript, recording URL, summary);
    - webhook endpoints;
    - tickets;
    - usage.
  - Every write accepts an `Idempotency-Key` header, so a client retry never creates two candidates or places two calls.
  - Errors use the existing error envelope. The API is described by an OpenAPI file generated from the Zod schemas, and the docs and SDKs come from that file.
- **Outbound events (webhooks).**
  - A company registers one or more endpoint URLs and picks events:
    - `call.completed`
    - `call.failed` (no answer, voicemail, engine error)
    - `candidate.updated`
    - `ticket.updated`
  - Each delivery is a pg-boss job. The body is signed with HMAC-SHA256 (`HRVoice-Signature` header with a timestamp), and failures are retried with backoff for up to 24 hours.
  - Every delivery attempt is logged and can be re-sent from Settings. Payloads carry ids plus the result facts, never hire advice.
- **Usage and limits.**
  - A completed screen uses the existing rule in the cost service: the candidate spoke and the call lasted at least 20 s.
  - Per company, set by the platform admin:
    - calls per day;
    - calls at the same time;
    - monthly cap (optional).
  - Over a limit: a clear `429` with when it resets, and no call placed.
  - A monthly usage view for the company and for the founder's Costs page, plus a CSV invoice export.
  - API requests are also rate-limited per key.
- **Test mode.** `hrv_test_` keys behave exactly like live keys, but calls go to the fake phone line (simulated candidate through the real voice loop), are free and are marked as test. This lets client developers and our own checks run without real calls.

### 2. The ways in (new folders)

| Way in | What it is | Lives in |
|---|---|---|
| **SDK** | TypeScript (npm) and Python (pip) clients generated from the OpenAPI file, plus small hand-written helpers: `verifyWebhook()`, typed events, idempotency | `packages/sdk-js`, `packages/sdk-python` |
| **MCP server** | Tools over the public API:<br>• `create_job`<br>• `add_candidates`<br>• `start_call`<br>• `get_results`<br>• `list_candidates`<br>• `raise_ticket`<br>• `ticket_status`<br>Runs locally with an API key (stdio), and later hosted at `mcp.nexstopp.com` | `apps/mcp` |
| **Zapier app** | Triggers: call completed, call failed. Actions: add candidate, start call, raise ticket. Built on the same API and webhooks | `integrations/zapier` |
| **Zoho Recruit connector** | Admin signs in to Zoho once (OAuth). Pick jobs to sync; new applicants on those jobs arrive within about 15 minutes; after each call a note goes onto the Zoho candidate. Rejected or hired people are never called. Runs as worker jobs inside `apps/api` | `apps/api/src/connectors/zoho` |
| **Dashboard** | Unchanged, plus Settings → Developers (keys, webhooks, delivery log, usage) | `apps/web` |
| **Docs** | Public developer docs page on nexstopp.com: quick start, API reference from OpenAPI, webhook guide, MCP setup | `apps/web/app/developers` |

### 2b. No-developer ways in (the easiest; founder: "broad options that work the way normal tools do")

Most hiring teams have no developer. These options need only a copy-paste, a sign-in or an email, and each one is a thin layer over the same `/v1` core and events:

| Option | What the customer does | How it works |
|---|---|---|
| **Embed snippet** | Pastes one `<script>` line into their careers page or HR tool | Adds an "Apply with a quick call" form, or a "Call this candidate" button. Uses a publishable key that is restricted to one job (it can only add a candidate and request a call), with origin checks |
| **Email in** | Forwards an applicant email or CV to `java-dev-x7k2@in.nexstopp.com` (a unique address per job) | The inbound email (Resend) creates the candidate; the existing resume phone/name extraction fills the details; the call follows the job's setting |
| **Google Sheets** | Connects a sheet once (Google sign-in) | New rows become candidates; results are written into new columns of the same sheet |
| **Notifications** | Picks where results go | Slack, Microsoft Teams, WhatsApp (via the existing telephony vendor's WhatsApp API) or email: "Priya finished her screen: answers + link" |
| **Make, n8n, Power Automate** | Uses a ready template | Same API and webhooks as Zapier, published as templates and connectors |
| **Sign in with Google / Microsoft** | Logs in without a new password | Better Auth social providers on the existing auth |
| **Excel Online / OneDrive** | Connects a workbook once (Microsoft sign-in) | Same as Google Sheets, for Microsoft companies |
| **Microsoft Teams / Slack app** | Types `/hrvoice screen +91… for Java dev` or uses a button on a message | Starts calls and shows results inside chat, through `/v1` |

**Hiring-tool connectors, broadly.** Building one connector per tool doesn't scale. So:
- **Direct connectors** for the tools common in India: Zoho Recruit first, then Keka, Darwinbox and Naukri RMS, added in the order real clients ask.
- **Everything else** (Greenhouse, Lever, Workday, SmartRecruiters and about 40 others): through a unified hiring-tool API service (Merge or Kombo). We build that connection once instead of 40 times. It's a paid service, so we switch it on only when a client using one of those tools signs up; this is the founder's cost decision.

These come after the core and the SDK. Each one is added to the `pnpm test:clients` check (Acme's careers page uses the embed snippet; the email-in and Sheets flows run against local fakes).

### 3. Support and tickets

- **One ticket model** (`support_tickets`, `support_messages`, with RLS). Status: open → waiting on HRVoice → waiting on customer → solved.
- **Ways to raise a ticket:**
  - **Dashboard:** "Get help" form, or live chat.
  - **Live chat:** a chat button in the dashboard and on the docs page. Every chat is a ticket.
  - **Email:** support@nexstopp.com.
    - An email opens a ticket or replies to one, matched by a reply token in the address or subject.
    - Replies go back by email.
    - A chat nobody answers within 5 minutes also sends the customer an email, so it's never silently missed.
  - **API/SDK and MCP:** create, list, read and reply to tickets.
- **Automatic context:** each ticket automatically gets the company, the related job or call if given, and the company's last 20 integration errors (failed API calls, failed deliveries).
- **Founder inbox:** an admin inbox page, platform admin only, holding chats and emails together, with the context beside each conversation. The founder gets an email and a browser notification for every new customer message.
- **Self-service first:**
  - the delivery log with "send again", and plain-language error messages;
  - a public status page (`/status`) showing whether calling works right now, fed by the existing health checks.
- **Built in-house** (founder's request for live chat and email; the in-house build is our call): conversations stay in our database under the same privacy rules, and context is attached automatically. Chat refreshes every few seconds; no constant live connection is needed.
- **Email:** we need a real sending and receiving service, because today all mail is caught by Mailpit. Our call: Resend (free tier covers expected volume; inbound email webhook for replies). Password-reset and invitation emails start working for real at the same time.

### 4. The test company: "Acme Hiring" (`apps/acme`)

A small local app that plays a client company and uses HRVoice every way a real client can:

- **Own-developer path:** Acme has its own job and applicant screens. It uses the TS SDK to push a job and candidates, start calls, receive `call.completed` on its own webhook endpoint (signature checked), and show results on its own applicant page. It raises and replies to a ticket.
- **AI path:** a script drives the MCP server: "add these 3 applicants to the Java job, call them, summarise the results, raise a ticket about the one that failed".
- **No-code path:** the Zapier app's triggers and actions run against Acme through Zapier's local test runner.
- **Ready-tool path:** a fake Zoho Recruit (same API shape, local) is synced by the real connector. One manual check against a real Zoho trial account comes before the first client.

**One command, `pnpm test:clients`**, starts a local HRVoice (API, worker, voice service with the fake phone line), Acme and the fake Zoho. It then checks:

- a job created → candidates arrive → calls happen → results reach Acme → usage counted (all three voice engines);
- a revoked key is refused, the daily limit stops a call, and the same idempotency key doesn't create twice;
- Acme's endpoint down for a while → the result arrives after it comes back;
- one company's key can't see another company's job, call or ticket;
- no payload anywhere contains a hire recommendation or score;
- tickets raised from API, MCP and email land in the same inbox, and replies come back.

It runs before every deploy. A red run blocks the deploy.

## Constraints

- The stack stays as it is: NestJS + Fastify, Postgres with RLS, Drizzle, pg-boss, Next.js, Python voice service. No new database or queue.
- Every new table is RLS-protected like the existing ones, with FORCE on, and accessed through the tenant-context helpers.
- Vendor names stay in their declared folders (the production-boundary test).
- GCP free-trial credits until about 11 Nov 2026; the founder targets launch by the end of November.
- Secrets never logged, never returned after creation.

## Founder decisions (16 Oct)

- **Fit % is a score.** It stays inside our dashboard only. It is never sent out through `/v1`, webhooks, SDK, MCP, Zapier, connectors, Sheets, notifications or tickets. `pnpm test:clients` asserts that no outbound payload contains `fitPercent` or any score or recommendation field.
- **Consent and calling hours:**
  - Every candidate created through any channel except the "ask the candidate" link must carry `consent: true`, which the customer confirms. Without it the request is refused with a clear error.
  - Calls started automatically (by sync, email-in, Sheets, Zapier and so on) are placed only between 9:00 and 20:00 India time. Anything later waits in a queue until 9:00.
  - A recruiter pressing Call in the dashboard is a manual call and isn't held.
  - Numbers on the national do-not-call registry (TRAI NCPR/DND) are skipped, using a lookup through the telephony vendor where available. Skipped calls show the reason.
- **"Ask the candidate" link is a standard option.**
  - For any candidate with no number, from any channel, HRVoice issues a short personal link that the recruiter can send by email, LinkedIn message, WhatsApp or SMS.
  - The candidate enters their number, ticks consent and picks "call me now" or a time slot.
  - Their consent is stored with a timestamp.
  - It's available in the dashboard, `/v1`, SDK, MCP and Zapier, and is part of `pnpm test:clients`.

## Decisions settled during review (builder's calls, founder may override)

- **Test keys share the company's data with a flag.** Jobs, candidates and calls created by a `hrv_test_` key carry `is_test = true`. The dashboard hides them by default, behind a "Show test data" switch, and usage/billing ignores them. This is simpler than a separate sandbox.
- **Test mode always uses our own loop on the fake line**, whatever engine the job is set to. The ElevenLabs agent engine is checked by hand, not in the automated run. The fake candidate's voice clips are synthesised once and saved as test files, so the check costs nothing to re-run. API clients cannot choose the engine; only the platform admin can, as today.
- **Limits count calls placed** (that's what costs us money); billing counts completed screens. The price per completed screen is set per company by the platform admin, in INR, and the invoice export uses it.
- **Chats and emails from people with no account** become platform-level tickets with no company yet. The founder links each one to a company, or answers it as a sales lead. They live in a platform-only table that no company can read.
- **`pnpm test:clients` runs on the founder's machine** and in the deploy script, using the local `.env` keys (Deepgram, Gemini and Sarvam for the voice loop). A CI pipeline comes later.

## Build order

1. **Core:**
   - API keys + auth guard
   - consent field, calling-hours queue, DND skip, "ask the candidate" link
   - `/v1` jobs/candidates/calls/results with idempotency
   - OpenAPI
   - webhooks + delivery log
   - usage + limits
   - test mode
2. **Acme app + `pnpm test:clients`** covering the core (this is the safety net for everything after).
3. **TS SDK, then Python SDK** (Acme switches to the SDK).
4. **MCP server** (added to the check).
5. **Support:**
   - tickets + founder inbox
   - live chat
   - Resend email in and out
   - status page
6. **Developer docs page** and Settings → Developers.
7. **Zapier app.**
8. **Zoho Recruit connector** with the fake Zoho, then one real-trial check.
9. **No-developer options:**
   - embed snippet, email in, notifications (Slack/Teams/WhatsApp/email), Google sign-in;
   - then Google Sheets / Excel;
   - then Make/n8n/Power Automate templates and Teams/Slack apps.
10. **More hiring-tool connectors** (Keka, Darwinbox, Naukri RMS) and the unified-API route, as clients ask.

Rough size for one engineer:

| Steps | Estimate |
|---|---|
| 1–2 | about 1.5 weeks |
| 3–4 | about 1 week |
| 5–6 | about 1.5 weeks |
| 7 | about 3 days |
| 8 | about 1.5 weeks |
| 9 | about 3 weeks |
| 10 | about 1 week per direct connector; a few days for the unified route |

## Left to the builder

- Exact endpoint paths, field names and pagination (follow the existing `pagination.ts` and error envelope).
- Retry schedule details, rate-limit numbers and their defaults.
- How the SDK is generated (any maintained OpenAPI generator), as long as the hand-written helpers stay small.
- Acme's look: plain, just enough screens to show the data.
