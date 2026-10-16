# Client Integrations Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A company's own system can run the whole screening flow through HRVoice: create jobs, add candidates (with consent), start calls (within limits and calling hours) and receive results by signed webhook, using API keys. All of it is proven end to end by a local test company app ("Acme Hiring") with one command.

**Architecture:**
- **API keys:** they resolve to the key creator's live membership, with permissions intersected with the key's scopes, inside the existing `AuthContextService`. Every existing RLS and permission rule applies unchanged.
- **Public API:** a versioned `/v1` controller set reuses the existing jobs, candidates and voice services through a public mapper that never emits scores.
- **Calls through a queue:** every API-started call becomes a `call_requests` row. A pg-boss queue in the API process places it after the checks (limits, calling hours, DND, test mode).
- **Call events:** call ends emit events; the worker delivers them as signed webhooks with retries.

**Tech Stack:** NestJS 11 + Fastify, Postgres RLS + Drizzle (raw SQL), pg-boss 12, Zod 4 (`z.toJSONSchema` for OpenAPI), vitest, Python voice service (apps/voice, Pipecat 1.11).

**Spec:** `docs/superpowers/specs/2026-10-16-client-integrations-design.md`. This plan covers build-order steps 1–2: the core plus Acme and `pnpm test:clients`. Later steps (SDKs, MCP, support, docs, Zapier, Zoho, no-developer options) get their own plans.

## Global Constraints

- Results sent anywhere outside the dashboard never contain `fitPercent`, any score, or hire/reject advice. Summaries pass through the existing `scrubHireAdvice`.
- **Consent:** every candidate created through `/v1` must carry `consent: true`; otherwise the response is `422` with code `consent_required`. The one exception is the "ask the candidate" link, where the candidate gives consent themselves.
- **Calling hours:** calls started through `/v1` are placed only between 09:00 and 20:00 Asia/Kolkata. Outside those hours they get status `scheduled` and are placed at the next 09:00. Dashboard Call buttons are not held.
- Numbers flagged DND are skipped with reason `dnd`.
- **Limits:** they count calls placed. Defaults: `calls_per_day` 50, `max_concurrent` 3, `monthly_cap` null. Over a limit: `429` with code `call_limit_reached` and a `resetsAt` ISO time. Limits apply to dashboard calls too, through the shared call path.
- Billing counts completed screens with the existing `callOutcome` rule (candidate spoke and duration ≥ 20 s). `price_per_screen_inr` is set per organization by the platform admin.
- **Test keys** (`hrv_test_`) mark everything they create `is_test = true`, always use the own loop on the fake line, are free and are excluded from usage.
- **Key format:** `hrv_live_` / `hrv_test_` + 32 random base62 characters. Only the SHA-256 hex digest is stored, plus `prefix` (the first 12 characters) for display. The key is shown once.
- **Webhook signature:** header `HRVoice-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`. Endpoint secrets are `whsec_` + 32 base62 characters.
- Every new table has `organization_id`, RLS enabled + FORCE, policies on `app.current_org_id`, and access only through the `withTenantContext` family. Vendor names stay in their declared folders (`production-boundary.test.ts`).
- `/v1` writes honour the `Idempotency-Key` header (max 255 chars). The same key with the same method and path within 24 h replays the stored status and body.

## Review Focus

1. **A key whose creator was removed from the company:** it must stop working at once, because membership is revalidated on every request. Test in Task 2.
2. **The same candidate sent twice by a retrying client** (same `externalId`, no idempotency key) must update, not duplicate. Test in Task 3.
3. **The client's endpoint is down for hours:** delivery keeps retrying for 24 h, then marks `failed`, and "resend" works later. Test in Task 5.
4. **A call requested at 19:59:30 IST** is placed now; one at 20:00:00 is scheduled for 09:00 the next day, including across midnight and month end. Test in Task 4.
5. **A test key reading a live candidate, or a live key reading a test candidate:** both allowed (same company), but test calls are never billed and never dial Exotel. Test in Task 8.

---

### Task 1: Schema for keys, call requests, limits, webhooks, links and consent

**Files:**
- Create: `packages/db/drizzle/0032_client_integrations.sql`, `packages/db/src/schema/integrations.ts`
- Modify: `packages/db/drizzle/meta/_journal.json` (idx 32), `packages/db/src/schema/index.ts` (export), `packages/db/src/schema/hiring.ts` (new candidate/job columns)
- Test: `apps/api/test/integrations-schema.test.ts`

**Interfaces:**
- Produces these tables, all org-scoped with RLS FORCE and policies `organization_id = current_setting('app.current_org_id')::uuid`:
  - `api_keys(id uuid pk, organization_id, created_by_user_id uuid not null references users, name text, prefix text, key_hash text unique, mode text check in ('live','test'), scopes text[] not null, last_used_at, revoked_at, created_at)`
  - `idempotency_keys(organization_id, key text, method text, path text, status int, body jsonb, created_at, primary key(organization_id,key,method,path))`
  - `call_requests(id uuid pk, organization_id, job_id, candidate_id, source text check in ('api','dashboard','link'), status text check in ('queued','scheduled','placing','placed','skipped','failed'), reason text null, not_before timestamptz, voice_session_id uuid null, is_test bool default false, created_by_key_id uuid null, created_at, updated_at)`
  - `org_call_limits(organization_id pk, calls_per_day int default 50, max_concurrent int default 3, monthly_cap int null, price_per_screen_inr numeric(10,2) null, updated_at)`
  - `webhook_endpoints(id, organization_id, url text, secret text, events text[], disabled_at, created_at)`
  - `webhook_deliveries(id, organization_id, endpoint_id, event text, payload jsonb, status text check in ('pending','delivered','failed'), attempts int default 0, last_status_code int null, last_error text null, next_attempt_at, created_at, delivered_at)`
  - `candidate_links(id, organization_id, job_id, candidate_id null, token_hash text unique, expires_at, used_at, created_at)`
- `candidates` gains `external_id text null` (unique per `(organization_id, job_id, external_id)`), `consent_at timestamptz null`, `consent_source text null check in ('customer','candidate')`, `is_test bool default false`. `jobs` gains `is_test bool default false`. `voice_sessions` gains `is_test bool default false`.
- Security-definer functions owned by the migrator:
  - `resolve_api_key(p_hash text) returns table(id uuid, organization_id uuid, created_by_user_id uuid, mode text, scopes text[], revoked_at timestamptz)`.
  - `resolve_candidate_link(p_hash text) returns table(id, organization_id, job_id, candidate_id, expires_at, used_at)`.

  They exist because the lookup happens before any tenant context is known. Execute is granted to `platform_app` only.

- [ ] **Step 1: Write the failing test.** `integrations-schema.test.ts`:
  - Use `superDatabase()` to create two orgs, each with one row in every new table.
  - Under `withTenantContext` for org A, assert each table returns only A's rows.
  - Assert `resolve_api_key(<A's hash>)` returns A's row through the `platform_app` connection with no context.
  - Assert inserting a candidate with a duplicate `(org, job, external_id)` throws a unique violation.
- [ ] **Step 2: Run it.** `pnpm --filter @platform/api test integrations-schema` → FAIL (relation does not exist).
- [ ] **Step 3: Write `0032_client_integrations.sql`** and the Drizzle schema, mirroring the style of `0031` (CHECKs, `alter table … force row level security`, grants to `platform_app`). Apply it locally with `pnpm db:migrate`.
- [ ] **Step 4: Run tests.** `pnpm --filter @platform/api test integrations-schema schema-drift` → PASS.
- [ ] **Step 5: Commit** `feat(db): client integration tables, consent and test flags`.

### Task 2: API keys and the Bearer path in the auth context

**Files:**
- Create: `apps/api/src/integrations/api-keys.service.ts`, `apps/api/src/integrations/api-keys.controller.ts`, `apps/api/src/integrations/scopes.ts`
- Modify: `apps/api/src/authz/auth-context.ts`, `apps/api/src/app.module.ts`, `apps/api/src/tokens.more.ts` (`API_KEYS_SERVICE`)
- Test: `apps/api/test/api-keys.test.ts`

**Interfaces:**
- `scopes.ts`: `export const API_SCOPES = ['jobs','candidates','calls','results','webhooks','usage'] as const; export type ApiScope = …; export const SCOPE_PERMISSIONS: Record<ApiScope, readonly Permission[]>`:
  - jobs → `jobs.read, jobs.create, jobs.update`
  - candidates → `candidates.read, candidates.read_pii, candidates.create, candidates.update`
  - calls → `calls.read, calls.initiate`
  - results → `calls.read_transcript, calls.read_recording`
  - webhooks → `integrations.read, integrations.create, integrations.update, integrations.delete`
  - usage → `usage.read`
- `ApiKeysService`:
  - `create(actor, {name, mode, scopes}): Promise<{id, key, prefix}>`
  - `list(actor): Promise<ApiKeyRow[]>` (no hash)
  - `revoke(actor, id): Promise<void>`
  - `hashKey(key: string): string`
- `AuthContext` gains `readonly apiKey: { id: string; name: string; mode: 'live'|'test' } | null` (null for cookie sessions; existing call sites unaffected). `sessionToken` is `''` for keys.
- **Dashboard routes**, at `organization/api-keys` (`@Controller('organization/api-keys')`):
  - `GET` with `integrations.read`;
  - `POST` with `integrations.create` (body `{name, mode, scopes}`, `201 {id, key, prefix}`);
  - `DELETE :id` with `integrations.delete`.

  API keys themselves may not call these routes: `403` when `ctx.apiKey` is set.

- [ ] **Step 1: Write the failing tests** in `api-keys.test.ts`, using `startApi`, `registerUser` and `createOrganization`:
  - `creates a key shown once and lists it by prefix only`.
  - `Bearer key reaches GET /v1/ping with the key's org`: add a tiny `@Controller('v1') @Get('ping') @RequirePermission('jobs.read')` returning `{organizationId, apiKey: {id, mode}}` in `apps/api/src/integrations/v1-ping.controller.ts`. It stays as a health check for clients.
  - `scopes limit permissions`: a key with only `usage` gets `403` on `/v1/ping`.
  - `revoked key → 401`.
  - `creator removed from org → 401 immediately`.
  - `unknown or malformed hrv_ token → 401`, with the same error body as a missing session.
  - `a key cannot create keys → 403`.
  - `last_used_at is set`.
  - `more than 600 requests a minute from one key → 429 rate_limited` (call the limiter's check directly, with its window injected, rather than sending 600 requests).
- [ ] **Step 2: Run them.** `pnpm --filter @platform/api test api-keys` → FAIL.
- [ ] **Step 3: Implement.**
  - In `resolve()`, if `authorization` matches `^Bearer (hrv_(live|test)_[A-Za-z0-9]{32})$`: call `resolve_api_key(sha256)`; reject if absent or revoked.
  - Load the creator's user status and active membership in the key's org with the same queries as the session path.
  - Set permissions to role permissions ∩ the union of the key's `SCOPE_PERMISSIONS`.
  - Update `last_used_at` at most once a minute.
  - Otherwise fall through to `auth.api.getSession`.
  - Generate keys with `crypto.randomBytes` mapped to base62.
  - Per-key request limit: 600 per minute, keyed by `apiKey.id`, using the same limiter and 429 envelope the API already uses for auth routes.
- [ ] **Step 4: Run tests.** `pnpm --filter @platform/api test api-keys route-coverage authz-permission-check` → PASS.
- [ ] **Step 5: Commit** `feat(api): company API keys with scoped Bearer auth`.

### Task 3: /v1 jobs and candidates, with consent, externalId and idempotency

**Files:**
- Create: `apps/api/src/integrations/v1-jobs.controller.ts`, `apps/api/src/integrations/idempotency.ts`, `apps/api/src/integrations/public-mappers.ts`, `apps/api/src/integrations/v1-schemas.ts`
- Modify: `apps/api/src/hiring/candidates.service.ts` (add `upsertByExternalId`, consent/test fields on create), `apps/api/src/app.module.ts`
- Test: `apps/api/test/v1-jobs.test.ts`

**Interfaces:**
- `v1-schemas.ts` exports Zod schemas reused by OpenAPI (Task 9):
  - `V1JobCreate {title, description?, mustAskQuestions?: string[], language?: 'en'|'hi'}`
  - `V1JobPatch`
  - `V1CandidateCreate {fullName, phone?, countryCode='+91', email?, resumeText?, externalId?, consent: literal(true)}`
  - `V1CandidateBatch {candidates: V1CandidateCreate[] (1..100)}`
  - response shapes `V1Job` and `V1Candidate`
- `public-mappers.ts`:
  - `toV1Job(row: JobRow): V1Job`
  - `toV1Candidate(row: CandidateRow): V1Candidate`
  - `toV1Result(r: ScreeningResults, allowTranscript, allowRecording): V1Result`

  They copy only whitelisted fields and never read `fitPercent`. `V1Result = {status, startedAt, endedAt, durationSeconds, answers: {questionId, question, answer}[], summary, transcript?, recordingUrl?, failureReason?}`.
- `idempotency.ts`: `withIdempotency(db, ctx, req, handler: () => Promise<{status:number, body:unknown}>)` stores or replays rows in `idempotency_keys`. Rows older than 24 h are ignored and overwritten.
- `CandidatesService.upsertByExternalId(actor, input & {externalId, consentSource, isTest})` returns `{id, created: boolean}`.
- Routes (`@Controller('v1/jobs')`):
  - `GET /` (`jobs.read`), `POST /` (`jobs.create`), `GET /:id` (`jobs.read`), `PATCH /:id` (`jobs.update`);
  - `POST /:jobId/candidates` (`candidates.create`; one candidate or a batch body);
  - `GET /:jobId/candidates?cursor` (`candidates.read`);
  - `GET /:jobId/candidates/:id` (`candidates.read`).

  A job created by a test key gets `is_test=true`, and an agent is auto-linked: the org's published hiring agent if exactly one exists, otherwise `409 agent_required`.

- [ ] **Step 1: Write the failing tests.**
  - `create job → list → get` round trip.
  - `candidate without consent → 422 consent_required`.
  - `same externalId twice → one candidate, second returns created:false with updated name`.
  - `batch of 3 → 3 created`.
  - `same Idempotency-Key replays first response and does not create twice`.
  - `org B key cannot GET org A job → 404`.
  - `no response body anywhere contains "fitPercent" or "fit_percent"`: JSON-stringify every response in the file and assert.
- [ ] **Step 2: Run them.** `pnpm --filter @platform/api test v1-jobs` → FAIL.
- [ ] **Step 3: Implement** the controller and mappers, reusing `JobsService` and `CandidatesService`. Set consent to `consent_at=now(), consent_source='customer'`.
- [ ] **Step 4: Run tests.** `pnpm --filter @platform/api test v1-jobs hiring-desk` → PASS. Hiring-desk must stay at its current pass/fail set.
- [ ] **Step 5: Commit** `feat(api): /v1 jobs and candidates with consent and idempotency`.

### Task 4: Call requests (limits, calling hours, DND, queue)

**Files:**
- Create: `apps/api/src/integrations/call-requests.service.ts`, `apps/api/src/integrations/calling-hours.ts`, `apps/api/src/integrations/dnd.ts`, `apps/api/src/integrations/call-limits.ts`, `apps/api/src/integrations/v1-calls.controller.ts`
- Modify:
  - `apps/api/src/jobs/queue.ts`: add `CALL_QUEUE = 'calls.place'` and `enqueueCall(id, startAfter?: Date)`.
  - `apps/api/src/providers/elevenlabs/voice-session.service.ts`: call `assertWithinLimits` at the top of `startOutboundPhoneCall`.
  - `apps/api/src/app.module.ts`: the API process runs `boss.work(CALL_QUEUE)`.
- Test: `apps/api/test/call-requests.test.ts`, `apps/api/test/calling-hours.test.ts`

**Interfaces:**
- `calling-hours.ts`: `nextCallingTime(now: Date): Date | null`. It returns `null` when `now` is inside [09:00, 20:00) Asia/Kolkata, otherwise the next 09:00 IST. Use `Intl.DateTimeFormat` with `timeZone: 'Asia/Kolkata'`; IST has no DST.
- `dnd.ts`: `interface DndChecker { check(e164: string): Promise<'dnd'|'ok'|'unknown'> }` and `createNoopDndChecker()`, which always returns `'unknown'`.

  ```ts
  // ponytail: no live NCPR lookup yet; swap in the telephony vendor's DND API when the account has it.
  ```
- `call-limits.ts`: `assertWithinLimits(db, organizationId, now): Promise<void>`. It throws `ApiError` 429 `call_limit_reached` with `details.resetsAt` and counts:
  - non-test `voice_sessions` started today in IST against `calls_per_day`;
  - non-test sessions with status pending/active against `max_concurrent`;
  - this month against `monthly_cap`.
- `CallRequestsService`:
  - `request(actor & {apiKeyId, isTest}, {jobId, candidateId, source}): Promise<V1CallRequest>`
  - `place(id): Promise<void>` (worker side)
  - `get(actor, id): Promise<V1CallRequest>`

  `V1CallRequest = {id, status, reason, notBefore, candidateId, jobId, result: V1Result | null}`.
- `place()` order:
  1. Load the row.
  2. Check the candidate still exists and has consent; otherwise `skipped` with reason `no_consent`.
  3. DND check; `'dnd'` → `skipped` with reason `dnd`.
  4. Calling hours check for source `api`; outside hours → `scheduled` and re-enqueue with `startAfter`.
  5. `assertWithinLimits`; over a limit → `failed` with reason `call_limit_reached`.
  6. Test mode → Task 8's test placement.
  7. Otherwise `voice.startOutboundPhoneCall(actorOfCreator, …)`, then `placed` with `voice_session_id`.

  Any throw → `failed` with reason taken from the error code.
- Routes:
  - `POST /v1/jobs/:jobId/candidates/:id/calls` (`calls.initiate`, idempotent): `202 V1CallRequest`. The limit check also runs synchronously here, so a client gets `429` immediately.
  - `GET /v1/calls/:id` (`calls.read`).

- [ ] **Step 1: Write the failing tests.**
  - `calling-hours.test.ts` (pure):
    - 10:00 IST → null;
    - 19:59:30 → null;
    - 20:00:00 → next day 09:00 IST;
    - 03:00 → same day 09:00;
    - 31 Oct 21:00 → 1 Nov 09:00.
  - `call-requests.test.ts`, with an injected clock and a stub voice adapter:
    - in-hours request becomes `placed`;
    - out-of-hours becomes `scheduled` with `notBefore`;
    - a candidate without consent becomes `skipped`/`no_consent`;
    - a DND stub becomes `skipped`/`dnd`;
    - `calls_per_day=1` makes the second request `429 call_limit_reached` with `resetsAt` at next IST midnight;
    - the dashboard outbound-call route is limited too.
- [ ] **Step 2: Run them.** `pnpm --filter @platform/api test calling-hours call-requests` → FAIL.
- [ ] **Step 3: Implement** as specified. The clock is injected as `now: () => Date` in the service factory. Its default is `() => new Date()`. Only when `NODE_ENV !== 'production'` and env `CALLING_HOURS_NOW` (ISO) is set does the clock return that time; Task 10 relies on this.
- [ ] **Step 4: Run tests.** `pnpm --filter @platform/api test calling-hours call-requests own-loop elevenlabs-voice` → PASS.
- [ ] **Step 5: Commit** `feat(api): queued API calls with limits, calling hours and DND skip`.

### Task 5: Call events and signed webhooks

**Files:**
- Create: `apps/api/src/integrations/events.ts`, `apps/api/src/integrations/webhooks.service.ts`, `apps/api/src/integrations/v1-webhooks.controller.ts`, `apps/api/src/integrations/deliver.ts`
- Modify:
  - `apps/api/src/providers/own-loop/own-loop.service.ts`: emit after `saveCallResult` records the cost.
  - `apps/api/src/providers/elevenlabs/voice-session.service.ts`: emit at the two places that call `recordCost`.
  - `apps/api/src/jobs/queue.ts`: add `WEBHOOK_QUEUE = 'webhooks.deliver'`.
  - `apps/api/src/jobs/worker.ts`: `boss.work(WEBHOOK_QUEUE, …)`.
- Test: `apps/api/test/webhooks.test.ts`

**Interfaces:**
- `events.ts`: `emitCallEvent(db, queue, organizationId, voiceSessionId): Promise<void>`.
  - It loads the session and candidate result.
  - The event is `call.completed` when `callOutcome` is completed, else `call.failed`.
  - It builds the payload `{id, type, createdAt, data: {callId, jobId, candidateId, externalId, isTest, result: V1Result}}` with `toV1Result(…, true, true)`.
  - It inserts one `webhook_deliveries` row per enabled endpoint subscribed to the event, enqueues each, and updates the matching `call_requests` row.
  - It never throws to its caller: errors are logged.
- `deliver.ts`: `deliverOnce(row, fetchFn, now): Promise<{ok: boolean, statusCode?: number, error?: string}>`.
  - POST with JSON body, header `HRVoice-Signature` as in Global Constraints, `HRVoice-Event`, `HRVoice-Delivery: <id>`, 10 s timeout.
  - 2xx counts as delivered.
  - Queue retry: `retryLimit: 12, retryDelay: 30, retryBackoff: true`. A row older than 24 h becomes `failed`.
- `signPayload(secret, t, body): string` is exported for the SDK later.
- Routes, all scoped to `webhooks`:
  - `POST /v1/webhook-endpoints {url (https, or http://localhost / 127.0.0.1 only when NODE_ENV≠production), events}` → `201 {id, secret}` (secret shown once);
  - `GET /v1/webhook-endpoints`;
  - `DELETE /v1/webhook-endpoints/:id`;
  - `GET /v1/webhook-deliveries?status`;
  - `POST /v1/webhook-deliveries/:id/resend`.

- [ ] **Step 1: Write the failing tests** in `webhooks.test.ts`, with a local `node:http` server as the endpoint:
  - `call.completed arrives with a valid signature and no fitPercent` (verify with `signPayload`);
  - `500 from endpoint → retried, then delivered when it recovers`;
  - `older than 24h → failed`;
  - `resend re-queues a failed delivery`;
  - `org A endpoint never receives org B events`;
  - `non-https url rejected in production mode`.
- [ ] **Step 2: Run them.** `pnpm --filter @platform/api test webhooks` → FAIL.
- [ ] **Step 3: Implement** as specified. In tests, the worker handler is called directly (`handleWebhookJob`), with no polling.
- [ ] **Step 4: Run tests.** `pnpm --filter @platform/api test webhooks own-loop elevenlabs-voice` → PASS.
- [ ] **Step 5: Commit** `feat(api): call.completed / call.failed signed webhooks with retries`.

### Task 6: Results, usage and admin limits

**Files:**
- Create: `apps/api/src/integrations/usage.service.ts`, `apps/api/src/integrations/v1-usage.controller.ts`
- Modify: `apps/api/src/integrations/v1-jobs.controller.ts` (results route), `apps/api/src/costs/costs.controller.ts` (limits + price + CSV)
- Test: `apps/api/test/v1-usage.test.ts`

**Interfaces:**
- `GET /v1/jobs/:jobId/candidates/:id/results` (`calls.read`). Transcript only with `calls.read_transcript`, recording only with `calls.read_recording`. It returns `V1Result` and uses the same reconcile-if-missing behaviour as the dashboard route.
- `UsageService.month(organizationId, 'YYYY-MM'): Promise<{month, callsPlaced, completedScreens, pricePerScreenInr: number|null, amountInr: number|null}>`. Test sessions are excluded.
- `GET /v1/usage?month=YYYY-MM` (`usage.read`).
- Platform admin only, 404 for others like the existing admin costs routes:
  - `GET /admin/costs/orgs/:orgId/limits`
  - `PUT /admin/costs/orgs/:orgId/limits {callsPerDay, maxConcurrent, monthlyCap|null, pricePerScreenInr|null}`
  - `GET /admin/costs/invoice.csv?month=` with columns `organization,month,completed_screens,price_per_screen_inr,amount_inr`

- [ ] **Step 1: Write the failing tests.**
  - `usage counts completed screens, ignores test and short calls`: seed ledger and session rows.
  - `results omit transcript without results scope`.
  - `admin sets limits and price; non-admin gets 404`.
  - `invoice.csv has one row per org with amount = screens × price`.
- [ ] **Step 2: Run them.** `pnpm --filter @platform/api test v1-usage` → FAIL.
- [ ] **Step 3: Implement**, reusing `callOutcome` from `costs.service.ts`. Export it if it isn't exported already.
- [ ] **Step 4: Run tests.** `pnpm --filter @platform/api test v1-usage admin-costs` → PASS.
- [ ] **Step 5: Commit** `feat(api): /v1 results and usage; admin limits, price and invoice CSV`.

### Task 7: "Ask the candidate" link

**Files:**
- Create: `apps/api/src/integrations/candidate-links.service.ts`, `apps/api/src/integrations/candidate-links.controller.ts`, `apps/web/app/c/[token]/page.tsx`
- Modify: `apps/web/lib/api.ts` (public link calls)
- Test: `apps/api/test/candidate-links.test.ts`

**Interfaces:**
- `POST /v1/jobs/:jobId/candidate-links {candidateId?, fullName?, email?}` (`candidates.create`) → `201 {url: WEB_URL + '/c/' + token, expiresAt}`. Tokens are 32 base62 characters, hashed at rest, valid 7 days and usable once.
- Public routes (`@Public()`):
  - `GET /public/candidate-links/:token` → `{companyName, jobTitle, expiresAt}`, or 404 when invalid, used or expired.
  - `POST /public/candidate-links/:token {fullName, phone, countryCode, consent: true, when: 'now'|ISO time}` creates or updates the candidate with `consent_source='candidate'` and creates a `call_requests` row with source `link`. `when: now` gets calling hours like `api`; a chosen time becomes `not_before`.
  - Rate limited to 10 requests per minute per IP with the existing limiter.
- Web page `/c/[token]`:
  - shows the company and job, and the fields name and phone;
  - a consent checkbox labelled "I agree to receive a screening call from <company> about this job";
  - a "Call me now / Pick a time" choice, then a confirmation.

  Plain, accessible, mobile first.

- [ ] **Step 1: Write the failing tests.**
  - `link create → public GET shows job → POST creates candidate with candidate consent and a call request`.
  - `second POST → 404 (used)`.
  - `expired → 404`.
  - `consent missing → 422`.
- [ ] **Step 2: Run them.** `pnpm --filter @platform/api test candidate-links` → FAIL.
- [ ] **Step 3: Implement** the API part. Lookup goes through `resolve_candidate_link`, then `withTenantContext` as the link creator's org with `SYSTEM_ACTOR_ID`. Build the page and run `npx tsc --noEmit -p apps/web`.
- [ ] **Step 4: Run tests.** `pnpm --filter @platform/api test candidate-links` → PASS; web typecheck clean.
- [ ] **Step 5: Commit** `feat: ask-the-candidate link with candidate consent`.

### Task 8: Test mode on the fake line

**Files:**
- Create: `apps/voice/test_call.py` (in-process fake caller), `apps/voice/test_clips/` (WAV files)
- Modify:
  - `apps/voice/server.py`: `POST /internal/test-call`, guarded by the `x-voice-token` header.
  - `apps/voice/fake_exotel.py`: let `run()` accept pre-made clips.
  - `apps/api/src/providers/own-loop/own-loop.service.ts`: `placeTestCall`.
  - `apps/api/src/integrations/call-requests.service.ts`
- Test: `apps/api/test/test-mode.test.ts`, `apps/voice/test_clips_present.py`

**Interfaces:**
- `OwnLoopService.placeTestCall(actor, {jobId, candidateId}): Promise<{voiceSessionId}>`.
  - It creates the own-loop session exactly like `startOutboundPhoneCall`'s own-loop branch, with `is_test=true`, `external_conversation_id='test-'+uuid` and engine `own_loop_sarvam_voice`.
  - It does not dial Exotel. Instead it POSTs `VOICE_SERVICE_URL + '/internal/test-call' {callId, language}`. New env `VOICE_SERVICE_URL`, default `http://voice:8765`.
- `POST /internal/test-call` starts `fake_exotel.run` as a background task against its own `/voice/exotel`, using the clips `test_clips/{en,hi}/answer_{1..4}.wav`. It returns `202`.
- The clips are made once with `python fake_exotel.py --save-clips` (Sarvam) and committed (16-bit 8 kHz mono).
- `call_requests.is_test` → `placeTestCall`. Usage and limits ignore test sessions; the ledger row is written with `total_cost` 0 when `is_test`.

- [ ] **Step 1: Write the failing tests.**
  - `test-mode.test.ts`, with the voice HTTP call stubbed:
    - a test key's call request becomes `placed` without calling the Exotel client (spy asserts zero calls);
    - the voice session `is_test`;
    - after a posted result, the ledger cost is 0 and usage counts 0.
  - `test_clips_present.py` asserts all 8 WAV files exist and are 8 kHz mono.
- [ ] **Step 2: Run them.** `pnpm --filter @platform/api test test-mode`; `docker run --rm -v $PWD/apps/voice:/app platform-voice:dev python test_clips_present.py` → FAIL.
- [ ] **Step 3: Implement**, then generate and commit the clips.
- [ ] **Step 4: Run tests.** Both commands → PASS.
- [ ] **Step 5: Commit** `feat: test-mode calls on the fake line, free and unbilled`.

### Task 9: OpenAPI document

**Files:**
- Create: `apps/api/src/integrations/openapi.ts`, `apps/api/src/integrations/openapi.controller.ts`
- Test: `apps/api/test/openapi.test.ts`

**Interfaces:**
- `buildOpenApi(): object`, an OpenAPI 3.1 document assembled by hand.
  - `paths` covers every `/v1` route above, plus the public link routes.
  - `components.schemas` comes from `z.toJSONSchema` on the `v1-schemas.ts` exports.
  - Bearer security scheme; `Idempotency-Key` header parameter on writes; webhook payloads under `webhooks`.
- `GET /v1/openapi.json` (`@Public()`).

- [ ] **Step 1: Write the failing test.**
  - Every `/v1` route registered on the Fastify instance (read from `app.getHttpAdapter().getInstance().printRoutes`, or the route-coverage helper) has a matching path and method in the document.
  - No schema in it contains a `fitPercent` property.
- [ ] **Step 2: Run it.** `pnpm --filter @platform/api test openapi` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it.** → PASS.
- [ ] **Step 5: Commit** `feat(api): OpenAPI 3.1 for /v1`.

### Task 10: Acme Hiring and `pnpm test:clients`

**Files:**
- Create:
  - `apps/acme/package.json` (name `@platform/acme`; deps none beyond node; devDeps vitest)
  - `apps/acme/src/server.ts`: `node:http`; in-memory jobs and applicants; pages `/`, `/jobs/:id`, `/applicants/:id`; `POST /hrvoice/webhook`, which verifies the signature and stores the result on the applicant.
  - `apps/acme/src/hrvoice.ts`: a thin `fetch` client over `/v1`, replaced by the SDK in the next plan.
  - `apps/acme/test/clients.e2e.test.ts`
  - `scripts/test-clients.mjs`
- Modify: root `package.json` (`"test:clients": "node scripts/test-clients.mjs"`), `pnpm-workspace.yaml` if needed

**Interfaces:**
- `scripts/test-clients.mjs`:
  - `docker compose up -d postgres`, then migrate.
  - Start the API and worker as child processes with `VOICE_OWN_LOOP_ENABLED=true`, a generated `VOICE_INTERNAL_TOKEN`, `VOICE_SERVICE_URL=http://localhost:8765`.
  - Run the voice container with `NEST_INTERNAL_URL=http://host.docker.internal:3001` and the `.env` provider keys.
  - Start Acme on 4100.
  - Run `vitest run apps/acme/test`.
  - Tear everything down, and exit with vitest's code.
- The e2e uses a test key throughout, except where stated:
  1. Register an org admin through the API and create a published hiring agent and a `test` key with all scopes.
  2. Acme creates a job via `/v1`, registers its webhook endpoint, and adds 2 applicants (consent) with `externalId`.
  3. Acme requests calls. The run uses an injected clock env `CALLING_HOURS_NOW` to stay in hours. Wait up to 180 s for `call.completed` on Acme's webhook: signature valid, answers present, no `fitPercent` anywhere in what Acme stored.
  4. `/v1/usage` shows 0 completed (test).
  5. The same `Idempotency-Key` → no duplicate call request.
  6. Revoke the key → the next request is 401.
  7. A live key with `calls_per_day=0` (set via admin route) → 429 `call_limit_reached`, and no dial happens (the Exotel client is not configured locally; assert the request was refused before dialling).
  8. Stop Acme's webhook listener for 10 s during a call → the delivery is retried and arrives after restart.
  9. A second org's key → 404 on the first org's job and call.
  10. "Ask the candidate" link: POST the public form → a call request with source `link` → `call.completed` arrives.

- [ ] **Step 1: Write `clients.e2e.test.ts`** with the ten checks above as separate `it` blocks sharing setup.
- [ ] **Step 2: Run `pnpm test:clients`** → FAIL (Acme not built).
- [ ] **Step 3: Implement the Acme server, client and runner script.**
- [ ] **Step 4: Run `pnpm test:clients`** → all ten PASS. Then run `pnpm test:api` and confirm no new failures beyond the 8 known ones on this branch.
- [ ] **Step 5: Commit** `feat: Acme Hiring test client and pnpm test:clients`.
