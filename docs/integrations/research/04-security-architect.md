# 04. Security architect: integrations on this codebase

Date: 2026-10-03. Research only. No code, config, migration or test was changed.

Labels: **FACT** (with a repo path or URL), **RECOMMENDATION**, **ASSUMPTION**, **unverified**.
Path shorthands: `JAVA/` = `apps/api-java/src/main/java/desk/`, `MIG/` = `packages/db/drizzle/`.

---

## 1. Summary

The current system has a stronger security base than most products at this stage. Every tenant table has forced RLS. The org always comes from server state. There is no RLS bypass. Permissions are re-read from the database on every request. Sensitive reads are audited. The one webhook in the system is verified with HMAC before any tenant lookup. Integrations should reuse all of this. They should not invent a parallel security model.

There are four real gaps for integrations:

1. **There is nowhere to keep a customer's credentials safely.** The only encryption helper is the email seal. Its key is derived from `BETTER_AUTH_SECRET`, it uses no associated data (AAD), and it has no key rotation.
2. **There is no machine identity.** Every `Actor` is a signed-in member.
3. **Webhook verification uses one global secret.** It allows a ±30-minute replay window and stores no delivery ids.
4. **Retention is not implemented.** A 90-day auto-expiry was promised in the docs, but no code exists for it.

The MVP security work fits in about one week for one engineer:

* an RLS-protected `integration_connections` table;
* a small sealing component with a dedicated, versioned key and per-row AAD;
* a per-connection inbound webhook that is verified and de-duplicated;
* OAuth (authorization code with PKCE) or a pasted service-account credential, for one ATS only;
* fixed vendor hosts only, so customers supply no URLs;
* fail-closed disconnect;
* audit events for each step.

Public API keys, outbound customer webhooks, MCP and custom REST connectors belong in V2 and later. Customer-supplied URLs (custom REST connectors, outbound webhooks, customer MCP servers) bring SSRF risk. Do not accept any of them until there is an egress guard.

---

## 2. Findings

### 2.1 What exists today that integrations must reuse

| # | Label | Statement | Source |
|---|---|---|---|
| E1 | FACT | Tenant context is set only by `Db` using `set_config(..., true)` inside a `REQUIRES_NEW` transaction. "There is deliberately no method that disables row-level security." | `JAVA/platform/Db.java` lines 22–34, 52–120 |
| E2 | FACT | Neither `platform_app` nor `platform_migrator` has BYPASSRLS. The API refuses to boot as the migrator role. | `MIG/0001_rls_policies.sql`; `JAVA/platform/Env.java` `validate()` |
| E3 | FACT | A narrow, SELECT-only RLS policy finds the org for the voice webhook. `Db.withWebhookConversation` is "called ONLY after the webhook HMAC was verified". | `MIG/0022_voice_webhook_lookup.sql`; `JAVA/platform/Db.java` (javadoc on `withWebhookConversation`) |
| E4 | FACT | `AuthResolver` re-checks the membership and reloads permissions from the database on every request, with no cache. A removed member loses access immediately. | `JAVA/authz/AuthResolver.java` lines 12–22, 56–82 |
| E5 | FACT | `AuthInterceptor` fails closed: a route with no annotation returns 403. A denial writes `authz.denied`. A sensitive permission (`candidates.read_pii`, `candidates.export`, `calls.read_transcript`, `calls.read_recording`, `agents.sessions.read`) writes `authz.sensitive_access`. | `JAVA/authz/AuthInterceptor.java`; `JAVA/authz/Permissions.java` line 81 |
| E6 | FACT | `integrations.read` is held by Owner, Administrator, Agent Manager and Recruiter. `integrations.create/update/delete` are held by Owner and Administrator only. `candidates.export` is held by Owner, Administrator and Recruiter, and is withheld from Analysts because "a CSV export is the easiest path to bulk PII leaving the system". | `BRD's/11_PERMISSION_MATRIX.md` lines 77, 90–93, 133 |
| E7 | FACT | The email seal works like this: AES-256-GCM; a 12-byte random IV; key = `SHA-256("desk.jobs.email.v1:" + BETTER_AUTH_SECRET)`; output `"v1." + base64(iv‖ct)`; no AAD. `open()` is package-private and email-specific. If the secret is rotated, pending sealed mail cannot be opened. | `JAVA/notify/Notifications.java` lines 48, 75–97; `apps/api-java/MIGRATION_STATUS.md` line 358 |
| E8 | FACT | `background_jobs` has these properties: RLS per org; payloads deleted on success; a `(kind, idempotency_key)` uniqueness check while a job is queued or running; `kind` restricted to `'email','document'` by a CHECK constraint. Handlers run as `inOrg(org, NIL)`. | `MIG/0030_background_jobs.sql`; `JAVA/jobs/JobQueue.java` lines 35–38, 66–76, 163–165 |
| E9 | FACT | `JobQueue` writes `ExceptionClass: message` into `last_error` (cut to 500 chars). If a vendor's error body is put in an exception message, it ends up in that column. | `JAVA/jobs/JobQueue.java` (failure branch, about lines 149–153) |
| E10 | FACT | Voice webhook verification works like this: HMAC-SHA256 over `"<t>." + rawBody`; `MessageDigest.isEqual`; **±30 min** timestamp window. A legacy header form is also accepted. That form signs the body with **no timestamp**, so it has no replay window. The secret is one global env var. | `JAVA/voice/HostedVoiceAdapter.java` lines 198–230; `JAVA/platform/Env.java` line 126 |
| E11 | FACT | Outbound HTTP goes only to fixed hosts. For example, the voice adapter uses `BASE = "https://api.elevenlabs.io"`. Nothing calls a URL that a customer supplied. | `JAVA/voice/HostedVoiceAdapter.java` lines 37, 48 |
| E12 | FACT | The audit service "never logs credentials, tokens, session values or personal data beyond acting identifiers". A failed audit write is logged and swallowed. System actors are stored as `actor_user_id = NULL`. | `JAVA/audit/AuditService.java` lines 9–14, 38–59 |
| E13 | FACT | Rate limiting is an in-process fixed window per IP. The class is marked "ponytail: … move to Postgres/Redis when there are several API replicas". | `JAVA/platform/EdgeFilter.java` lines 55–83 |
| E14 | FACT | The `accounts` table stores `access_token`, `refresh_token` and `id_token` in plaintext columns. They exist for Better Auth social sign-in, which is unused. | `MIG/0000_initial_schema.sql` lines 1–15 |
| E15 | FACT | The spec already says: "future customer API access uses hashed, scoped, revocable API keys bound to an organization". The `Integration` entity has a `credential_reference`, and the spec says "Do not store provider secrets as ordinary plaintext database values." | `BRD's/04_DATABASE_API_SPEC.md` lines 303–316, 410 |
| E16 | FACT | No retention or purge code exists in the Java API (grep for `retention|purge` finds only Java annotations). The V1 freeze promised "Admin delete + auto-expiry" with a 90-day default. The final architecture doc lists retention as open "before first customer". | `docs/superpowers/specs/2026-09-17-hiring-po-research-pack.md` line 113; `BRD's/12_ARCHITECTURE_DECISIONS_FINAL.md` line 322 |
| E17 | FACT | Hosting is planned for an Indian region: a VPS now, then managed Postgres in India "before the first real customer's data lands". AWS `ap-south-1` is "the right long-term home". | `BRD's/10_ADRs/ADR-006-hosting-deployment.md` lines 55, 143, 165, 191 |
| E18 | FACT | Agent tools run only after five checks (the tool exists, an implementation exists, it is enabled, it is granted to the agent, and the acting member holds `required_permission`). Live voice calls get no customer tools. | `JAVA/runtime/Tools.java` lines 19–26, 245–253; `JAVA/engine/CallContextCompiler.java` lines 220–237 |

### 2.2 External references (primary or near-primary)

| # | Label | Statement | Source |
|---|---|---|---|
| R1 | FACT | Stripe signs webhooks in the `Stripe-Signature` header. Its default tolerance is **5 minutes**. When a secret is rolled, the old one can stay valid for up to 24 hours. Stripe recommends logging processed event ids and skipping duplicates. | https://docs.stripe.com/webhooks |
| R2 | FACT | Slack signs `v0:timestamp:body` and sends `X-Slack-Signature` and `X-Slack-Request-Timestamp`. It recommends rejecting requests whose timestamp is more than **5 minutes** off local time. | https://docs.slack.dev/authentication/verifying-requests-from-slack |
| R3 | FACT | GitHub uses `X-Hub-Signature-256` (HMAC-SHA256). It requires a constant-time comparison. The signature carries no timestamp. | https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries |
| R4 | FACT | Greenhouse webhooks send `Signature: sha256 <hex>` over the whole body. The secret is per webhook. There is **no timestamp**. A `Greenhouse-Event-ID` header comes with each delivery. Retries are made up to 7 times over 15 hours. | https://docs.greenhouse.io/webhooks.html |
| R5 | FACT | Standard Webhooks headers are `webhook-id`, `webhook-timestamp` and `webhook-signature`. It signs `id.timestamp.payload`. The schemes are `v1` (HMAC-SHA256) and `v1a` (ed25519). Secrets are `whsec_` plus 24–64 bytes. Several signatures can be sent at once, so secrets can be rotated without downtime. `webhook-id` acts as an idempotency key. The spec advises sending through an egress proxy (e.g. Smokescreen) to prevent SSRF. | https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md |
| R6 | FACT | RFC 9700 (OAuth Security BCP) says: PKCE is RECOMMENDED for confidential clients (§2.1.1); exact redirect URI matching (§2.1); clients MUST prevent CSRF, through PKCE or a one-time `state` (§2.1); access tokens SHOULD be audience-restricted (§2.3); public-client refresh tokens MUST be sender-constrained or rotated (§2.2.2). | https://www.rfc-editor.org/rfc/rfc9700.html |
| R7 | FACT | MCP security best practices (spec 2025-11-25): servers "MUST NOT accept any tokens that were not explicitly issued for the MCP server" (no token passthrough). Servers "MUST NOT use sessions for authentication". Proxy servers MUST collect consent per client. `state` must be single-use and short-lived (around 10 minutes). For SSRF, clients SHOULD block private and link-local ranges including 169.254.169.254, validate redirect hops, consider egress proxies and pin DNS. Scopes should be minimal and raised step by step. | https://modelcontextprotocol.io/specification/2025-06-18/basic/security_best_practices (served as the 2025-11-25 version) |
| R8 | FACT | The OWASP SSRF cheat sheet, for user-supplied URLs, advises: allow only http/https; resolve the hostname and check every IP it returns; block loopback, private, link-local and metadata addresses; pin the resolved IP; turn off redirect following; segregate the network. | https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html |
| R9 | FACT | Zoho access tokens last 1 hour. Zoho limits an app to "up to ten access tokens in a span of ten minutes". The accounts server URL depends on the data center. | https://www.zoho.com/accounts/protocol/oauth/web-apps/access-token-expiry.html |
| R10 | FACT | Greenhouse Harvest v3 uses OAuth 2.0 client credentials and has replaced API keys. v1/v2 stopped working after 2026-08-31. Greenhouse recommends creating credentials under an Integration System User (ISU), not a personal account, because credentials break when that person is deactivated. Rotating the secret invalidates the old one immediately. | https://support.greenhouse.io/hc/en-us/articles/115000521723 , https://support.greenhouse.io/hc/en-us/articles/41437121183899 (search summary; the token endpoint details are **unverified**) |
| R11 | FACT (secondary source) | DPDP Act 2023 §8 says: a fiduciary may use a processor only "under a valid contract" (8(2)); it must keep "reasonable security safeguards" (8(5)); it must tell the Board **and each affected Data Principal** about a breach (8(6)); it must erase data when consent is withdrawn or the purpose is no longer served, and the processor must erase on instruction (8(7)). | https://www.dpdpa.com/dpdpa2023/chapter-2/section8.html (mirror; I could not fetch the official MeitY PDF, HTTP 403) |
| R12 | FACT (secondary source) | DPDP Rules 2025 were notified on 13 Nov 2025, and most obligations apply from about May 2027. Rule 6 safeguards are encryption/masking/tokenisation, access control, logs with monitoring, backups, **keeping logs for one year**, and processor contract clauses. Rule 7 requires a detailed report to the Board within 72 hours. | https://www.dpdpa.com/dpdparules/rule6.html ; https://ourtake.bakerbotts.com/post/102lund/india-notifies-final-rules-for-digital-data-protection-act . The exact dates and the 72-hour wording are **unverified against the Gazette** |
| R13 | unverified | CERT-In's 6-hour incident reporting direction applies alongside DPDP. This is mentioned in secondary sources only. | search summary above |

### 2.3 Gaps and risks specific to integrations

| # | Label | Statement |
|---|---|---|
| G1 | FACT | No table and no encryption key exist for third-party credentials. The only sealing key is tied to the auth secret (E7). Rotating `BETTER_AUTH_SECRET` after a suspected session-secret leak would also make every stored ATS credential unreadable. |
| G2 | FACT | The email seal uses no AAD. A ciphertext copied from one row to another, including into another org's row, would still decrypt. For credentials, the ciphertext should be bound to its row. |
| G3 | FACT | The voice webhook allows a ±30-minute window and accepts a legacy form with no timestamp. It has no delivery-id dedupe, and every replay re-publishes `call.ended` / `result.ready` (backend map §9). This does not matter while the events only feed a log. It **will** matter once those events drive pushes to a customer's ATS: a replayed webhook would produce duplicate ATS notes. |
| G4 | FACT | There is no machine principal. Background work runs as `NIL`. A sync or push job therefore has no "who allowed this" link unless the connection row records it. |
| G5 | FACT | No retention is implemented (E16). Integrations will multiply the PII held (pulled candidates who are never called) unless pulls are minimised and expire. |
| G6 | ASSUMPTION | For candidate data, we are a **Data Processor** acting for the employer, who is the **Data Fiduciary**. Under DPDP this means we need a customer contract (DPA), we must tell the customer about a breach in time for them to report it, and we must erase data when the customer instructs. A lawyer must confirm this. |
| G7 | RECOMMENDATION | Treat text pulled from an ATS (job descriptions, resume text, notes) as untrusted input to the prompt. Today the employer types it. With an integration, it can come from any applicant (resume text). This does not change the MVP design, but keep `AdviceGuard` on every output, and never let model output choose an external write. |

---

## 3. Recommendations

### 3.1 MVP (one ATS, a two-to-three person team)

**M1. A connection table under the same RLS as everything else.** RECOMMENDATION.
* Name it `integration_connections`, with these columns:
  * `id`, `organization_id`, `provider` (an enum in code), `status` (`active | needs_reconnect | revoked`);
  * `scopes text[]` (what we asked for), `credential_sealed text`, `credential_key_version int`;
  * `webhook_secret_sealed text` (nullable), `created_by_user_id`;
  * `last_success_at`, `last_error_code` (a code, never a vendor body);
  * `created_at`, `updated_at`, `revoked_at`.
* Apply `ENABLE` + `FORCE ROW LEVEL SECURITY` with `organization_id = current_org_id()`, the same as `MIG/0016` and `MIG/0030`.
* Add the table to the drift checks in `StructuralTest`.
* Add one SELECT-only policy that resolves a connection by id inside a dedicated context setting, copying the `MIG/0022` pattern. Inbound webhooks use it, and only after the signature is verified.
* Credentials are **write-only** in the API: no route ever returns them. A GET shows provider, status, scopes, last success and who connected it.
* Never reuse `accounts.access_token` and the related columns (E14).

**M2. Seal credentials with a dedicated, versioned key and per-row AAD.** RECOMMENDATION.
* Turn the existing `Notifications.seal/open` code into one small `Sealer` component in `platform/`. Do not write a second crypto implementation.
* Key: a new env var `INTEGRATIONS_KEYS`, formatted as `1:<base64 32 bytes>[,2:<…>]`. It is **not derived from `BETTER_AUTH_SECRET`**. The highest version encrypts, and any listed version decrypts.
* Output: `"k<version>." + base64(iv‖ct)`.
* AAD = `organization_id + ":" + connection_id + ":" + field`, so a sealed value cannot be moved to another row or tenant (G2).
* Random 96-bit IVs are fine at our volume. The NIST SP 800-38D limit for random IVs is 2³² encryptions per key (I recalled this figure and did not re-fetch it, so it is unverified this session).
* To rotate: add key 2, run a one-off re-seal job over `integration_connections`, then remove key 1.
* `ponytail:` this is a single application key, not envelope encryption with a KMS. When we move to AWS `ap-south-1` (E17), or when an enterprise buyer asks for customer-managed keys, switch to KMS envelope encryption (a data key per row or per org, wrapped by KMS). The table shape stays the same.
* The email seal can move onto the same component later. That is not required for integrations.

**M3. How we authenticate to the customer's system (we are the client).**
* **OAuth authorization code** (RECOMMENDATION), for vendors that offer it (Zoho-style):
  * use PKCE even though we are a confidential client (R6 §2.1.1);
  * use a one-time `state`, stored server-side, bound to the session, the org and the connection, expiring after about 10 minutes (R6, R7);
  * use one exact registered redirect URI;
  * request the smallest scope set: read jobs and candidates, plus write notes or stage only if the customer turns on write-back;
  * keep the data-center host (`.in`, `.com`, `.eu`) in a fixed allowlist, never a free-text URL.
* **Client credentials or API key pasted by an admin** (RECOMMENDATION), for vendors such as Greenhouse Harvest v3 (R10):
  * the UI tells the admin to create the credential under an integration or service user, not a personal account;
  * the value is sealed the moment it arrives and is never shown again.
* **Token refresh** (RECOMMENDATION):
  * run one refresh at a time per connection, using `Db.underAdvisoryLock("conn:" + id)`, which already exists;
  * Zoho caps tokens at 10 per 10 minutes (R9), and providers that rotate refresh tokens punish concurrent refreshes;
  * write the new token in the same transaction;
  * on `invalid_grant` or 401, set `needs_reconnect`, stop all jobs for that connection, and show the admin a plain message. Do not retry in a loop.
* **Logging** (RECOMMENDATION):
  * never put tokens, vendor response bodies or candidate data in exceptions;
  * `background_jobs.last_error` stores the exception message (E9), so adapters throw an error **code** with a plain sentence.

**M4. Inbound webhooks from the ATS.** RECOMMENDATION.
* Use one route per vendor, with the connection id in the path: `POST /webhooks/integrations/{provider}/{connectionId}`, marked `@Public`.
* The steps, in order:
  1. Read the raw bytes, as `VoiceController` already does.
  2. Load the sealed webhook secret through the narrow connection policy.
  3. Verify with the vendor's own scheme inside the adapter, using `MessageDigest.isEqual`.
  4. Reject if the timestamp is outside **5 minutes**, when the vendor sends one (R1, R2).
  5. De-duplicate on the vendor's delivery id (R4, R5).
  6. Only after all of that, enqueue a `background_jobs` job whose payload holds ids only.
* For dedupe, add `integration_inbound_events(connection_id, delivery_id, received_at)` with a unique key and a purge after 7 days. Where a vendor sends no timestamp (Greenhouse, GitHub), this table is the only replay defence.
* **Fetch on notify** (RECOMMENDATION): treat the webhook as a hint only. The job re-reads the record from the vendor API using our stored credential and then writes. A forged or replayed payload can then never write data on its own.
* Return 2xx quickly. The current per-IP rate limit (E13) can throttle a vendor's shared sender IPs. Watch for this, and exempt webhook paths only after signature verification exists.
* **Fix the voice webhook at the same time**, because events will soon drive customer pushes (G3):
  * narrow the window from 30 minutes to 5 minutes, unless ElevenLabs documents otherwise (unverified; see backend map §21);
  * drop the legacy no-timestamp form once confirmed unused;
  * de-duplicate pushes on `(voice_session_id, event_type)`.

**M5. Who may connect, and what a connection may do.** RECOMMENDATION.
* Connect, edit mapping and disconnect: `integrations.create/update/delete`, which already exist and belong to Owner and Administrator (E6). Viewing status: `integrations.read`.
* A connection that **sends** transcript, summary or answer data out of the workspace is an export. At connect time, the connecting member must also hold `candidates.export` and `calls.read_transcript`. Record this with an `authz.sensitive_access`-style audit row.
* The connection belongs to the **org**, not the person. Greenhouse's experience shows that tying it to a user breaks it when that user leaves (R10). Keep `created_by_user_id` for accountability only.
* Write-back content follows the product rule:
  * allowed: call status and outcome, timestamps, the summary and answers (after `AdviceGuard`), a transcript link, and the stage **a person** chose;
  * never: `fitPercent`, a rank, a score, or "qualified".
* External writes are triggered by code, after a human stage decision or a `result.ready` event. **Never by a model tool call** (E18; G7).

**M6. Disconnect, revocation and rotation (fail closed).** RECOMMENDATION.
* On disconnect, in one transaction:
  * `status = 'revoked'`, `revoked_at = now()`;
  * set the sealed columns to NULL.
* After the commit, as a best effort:
  * call the vendor's revoke endpoint where one exists (the RFC 7009 pattern);
  * tell the admin to delete the service user or credential on their side when no endpoint exists.
* Every job loads the connection row **when it runs** and stops if it is not `active`. The job payload must never carry a credential. This makes revocation take effect immediately, with no queue to drain.
* Data already pulled stays with the org under normal retention (M8). Offer "also delete candidates that came from this connection" as an explicit, confirmed, audited action.
* Rotation of a webhook secret: accept old and new secrets for 24 hours, as Stripe does (R1), then drop the old one.

**M7. Audit.** RECOMMENDATION. Reuse `AuditService` and add these events:
* `integration.connected`, `integration.updated` (scopes or mapping), `integration.disconnected`;
* `integration.reconnect_needed`, `integration.webhook_rejected` (signature or timestamp; at most one row per minute per connection, so an attacker cannot flood the audit table);
* `integration.sync_completed` with **counts only**;
* `integration.pushed` with resource ids, never content.

Metadata holds ids and codes only (E12). Make sure `audit_events` and the application logs are kept for at least one year (DPDP Rule 6(e), R12).

**M8. PII and DPDP basics.** RECOMMENDATION.
* **Minimise intake.** Pull only what the call needs: name, phone, email, resume text, the job link and the external ids. Do not pull DOB, gender, salary, address or notes. Store `external_id` and `source` (a migration is needed; backend map §6.5) so that a later erasure request can be traced.
* **Expiry.** Candidates pulled from an ATS who are never called should expire with the org's retention window. Ship the long-promised retention job (E16) together with intake, because integrations are what make retention urgent.
* **Contracts and process** (no code):
  * a Data Processing Agreement with each customer (§8(2), R11);
  * a written breach runbook: we tell the customer quickly enough for them to send the Board their detailed report within 72 hours (R12), and CERT-In may apply too (R13, unverified);
  * a sub-processor list (voice provider, LLM, hosting).
* **At rest.** Rely on managed Postgres disk and backup encryption in India (E17), plus RLS. No field-level encryption of candidate PII in the MVP (see §5).

**M9. No customer-supplied URLs in the MVP.** RECOMMENDATION.
* Each adapter hard-codes its vendor base URL, as `HostedVoiceAdapter` already does (E11). Data-center variants come from a fixed list.
* This removes SSRF from the MVP entirely.

**M10. Tests that block merge (one each, smallest possible).** RECOMMENDATION.
* RLS drift: the new tables appear in `StructuralTest`.
* Sealer: a round trip works; the wrong AAD fails; the wrong key version fails.
* Webhook verify: a bad signature, a stale timestamp and a duplicate delivery id are each rejected.
* A job against a revoked connection does nothing.

### 3.2 V2 (when a customer or second integration needs it)

* **Public API with API keys** (RECOMMENDATION):
  * Key format: `hv_live_` plus 32 random bytes (base62).
  * Storage: store the SHA-256 hash, the same pattern as invitation tokens (`Db.withInvitationToken` needs a 64-hex hash). Fast hashing is fine for high-entropy keys. Keep the first 8 characters to show in the UI. Show the key once.
  * Ownership: one org per key, with an optional expiry, `last_used_at` and revocation.
  * Scopes: an explicit permission subset, capped at the creator's own permissions (the same rule as custom roles, `MIG/0024`). Keys can never hold `users.*`, `roles.*`, `integrations.*`, `organization.*` or `billing.*`.
  * Plumbing: plug the key into `AuthResolver` as a second way to build `AuthContext.Org` (`Authorization: Bearer`, never a cookie). The interceptor, the PII redaction and the sensitive-access audit then apply unchanged.
  * Audit: `actor_user_id = NULL` with `metadata.apiKeyId`.
  * Rate limit: per key, not per IP.
* **Outbound customer webhooks** (RECOMMENDATION):
  * Use Standard Webhooks (R5), a per-endpoint `whsec_` secret, and a transactional outbox that feeds `background_jobs`.
  * Send **thin events** (event type + ids). The receiver fetches PII through the API key, so PII does not travel in webhook bodies.
  * Endpoint URLs are customer-supplied, so they need the SSRF guard below.
* **SSRF egress guard** (RECOMMENDATION), needed before any customer URL:
  * https only;
  * resolve the hostname and reject loopback, RFC1918, link-local/169.254.0.0/16 (cloud metadata), 100.64.0.0/10, 0.0.0.0/8, multicast, `fc00::/7`, `fe80::/10` and IPv4-mapped IPv6;
  * connect to the **pinned** IP, with redirects off, a 5-second timeout and a size cap on the response.
  * Better still, route through an egress proxy such as Smokescreen (R5, R7, R8).
  * Do not hand-roll IP parsing (the MCP spec warning in R7). Use `InetAddress` range checks on the resolved addresses.
* **Envelope encryption with KMS** once on AWS India (M2 upgrade path).
* **SSO/SAML, IP allowlists on API keys, customer-managed keys:** only when an enterprise deal requires them.

### 3.3 Later or avoid
* Covered in §4 and §5.

---

## 4. Positions by topic

| Topic | Phase | Position | Rationale | Concerns |
|---|---|---|---|---|
| REST API (public) | V2 | Expose the existing org-scoped routes to machine principals through API keys. Same interceptor, same redaction. | It reuses `AuthInterceptor` and the PII split (E4, E5). It is not needed to pull from an ATS in the MVP. | Needs OpenAPI, versioning and a per-key rate limit (E13). Cookie routes must never accept bearer keys from a browser context, and the reverse. |
| OAuth (we as client to the ATS/CRM) | MVP | Authorization code + PKCE + one-time state + exact redirect; minimal scopes; sealed refresh token; one refresh at a time per connection. | RFC 9700 (R6); Zoho-style vendors require it. | Refresh races (R9); `invalid_grant` must go to `needs_reconnect`, not to a retry loop. |
| OAuth (we as provider) | Later | Do not run an authorization server until MCP or third-party apps need one. | Large surface (RFC 9700 + MCP auth spec); no current need. | If MCP comes first, consider a hosted IdP over building one. |
| API keys (ours, issued to customers) | V2 | Hashed, prefixed, scoped subset, org-bound, revocable, shown once. | Already decided in the spec (E15); the hashing pattern exists. | A leaked key that holds `candidates.read_pii` exposes bulk PII, so default keys to no PII permissions. |
| Service accounts (customer's credential for our use) | MVP | Accept pasted client-credentials or API keys for vendors that use them (Greenhouse v3 ISU). Seal them, never return them, and tell admins to use a non-personal integration user. | R10. It is the lowest-friction connection for many ATSs. | These credentials are often broad (admin-wide). Show the customer the permissions to grant the service user. |
| Webhooks inbound (from the ATS) | MVP | Per-connection secret, vendor scheme in the adapter, ±5-minute timestamp where provided, delivery-id dedupe, fetch on notify. | Reuses the voice pattern (E3, E10), done more strictly. | Vendors without timestamps (R4) depend on the dedupe table. Per-IP rate limits may hit vendor IPs. |
| Webhooks outbound (to the customer) | V2 | Standard Webhooks, thin events, outbox → `background_jobs`, SSRF guard. | R5; avoids pushing PII in bodies. | Customer-supplied URL means SSRF. Needs a delivery log and a dead-letter view (backend map §10). |
| SDK / embedded | Later | No browser SDK or embed. | It would need CORS, publishable keys and frame protections. There is no CORS config today (backend map §2). | — |
| MCP (our server) | Later | A facade over the V2 API. Tokens issued for our MCP server only; no token passthrough; minimal scopes; no session-as-auth. | R7; the launch spec says "not day-one" (F1 in the product map). | Prompt-injection through tool results. Any write tool must keep the human-decision rule. |
| MCP (connecting to customer MCP servers) | Avoid (until the SSRF guard exists) | Do not call customer-hosted MCP servers. | Customer URL + OAuth discovery = SSRF vectors (R7). Untrusted tool descriptions reach the model. | Revisit after the egress guard and a tool-allowlist design. |
| Direct DB | Avoid | Never accept customer database credentials or connect to customer DBs. | Highest-value secret, network exposure, SSRF-like reach, no scoping, and it bypasses the customer's own audit. | — |
| Event / queue | MVP | Reuse `background_jobs` (new kinds + POLICY entries) plus a small transactional outbox. Payloads hold ids only; no Kafka or broker. | E8: RLS, idempotency and backoff already exist. | `kind` CHECK and POLICY must be extended together (backend map §10). `last_error` must not hold PII (E9). |
| Customer-side connector (agent in the customer's network) | Later / Avoid | Do not ship software that customers install. | It adds a supply-chain and update burden. Target customers are SMBs on SaaS ATSs (ASSUMPTION). | Only for on-prem enterprise deals. |
| File / SFTP fallback | MVP (CSV, already built) / V2 (SFTP) | Keep CSV import. Add a results CSV export gated by `candidates.export` and audited. SFTP only if a customer requires it, with host-key pinning and sealed credentials. | CSV needs no stored credential. The export permission and audit already exist (E6). | An export CSV is bulk PII. Watermark it with the exporter's name and time in the audit row. |
| Canonical model | MVP | Define it as a **field allowlist** (minimisation). Never store unmapped vendor fields. | DPDP minimisation and erasure (R11); less PII held. | External ids are needed for erasure tracing. |
| Sync engine | MVP (minimal) | Polling or webhook-hinted pulls with a cursor per connection. Each run re-checks connection status and fails closed. | It reuses the queue. Revocation takes effect immediately (M6). | No per-org cron today (backend map §18). Keep the schedule coarse. |
| Two-way actions | V2 | Stage and notes write-back only after a human decision, through a customer-configured stage mapping. Never model-triggered. Facts only, never `fitPercent`. | The product rule; D4 and D5 in the product map; E18. | Duplicate writes on webhook replay (G3), so the outbox dedupe key is required. |
| Multi-tenancy | MVP | Every new table gets forced RLS. The webhook connection lookup uses a SELECT-only policy (0022 pattern). StructuralTest covers both. No bypass. | E1–E3. | Background loops already iterate orgs under `noContext` and then `inOrg`. Keep it that way. |
| Security (overall) | MVP | M1–M10 above: about one week for one engineer. | Reuse, not rebuild. | The retention job and DPA are the non-code blockers. |
| Onboarding UX | MVP | Show requested access in plain words before the redirect. Credentials are write-only fields. A "Test connection" step. Clear `needs_reconnect` state. One-click disconnect with a confirm. | Honest status (D14 in the product map); errors in plain words (`apps/web/lib/errors.ts:77` filters words such as "token" and "api key"). | Do not show tokens or vendor error bodies to users. |
| Build vs buy (unified API) | V2 (evaluate) | Reasonable to evaluate. It removes our token storage for N vendors. | It moves the credential risk to a vendor. | The vendor becomes a sub-processor holding candidate PII and customer tokens: check its DPA, data location (India or abroad) and breach terms. It can also become a single point of compromise. |
| First integration | MVP | From a security view, prefer a vendor with OAuth or a scoped service user **and** signed webhooks. Avoid any vendor that needs a person's password or a non-revocable admin key. | Lower blast radius; clean revocation. | Vendor choice belongs to the founder and the product research. |
| Other: data retention / DPDP | MVP | Ship the retention job, the processor DPA and a breach runbook with the first integration. Keep logs for one year. | E16, R11, R12. | Our status as fiduciary or processor needs legal confirmation (G6). |

---

## 5. What not to build (now)

* No KMS or Vault in the MVP. A versioned dedicated key with AAD (M2) is enough until AWS India or an enterprise asks.
* No field-level encryption of candidate PII columns. It breaks `(job_id, phone)` dedupe and search, and RLS plus disk encryption cover the realistic threats at this stage.
* No customer-supplied URLs (custom REST connector, outbound webhooks, customer MCP servers) until the egress guard exists.
* No OAuth authorization server of our own. No SSO/SAML. No IP allowlists. No customer-managed keys.
* No secret-scanning partnership or key-prefix registry. A `hv_live_` prefix is enough to make keys greppable.
* No separate audit store, SIEM export or tamper-evident chain. `audit_events` plus one-year log retention is enough for now.
* No direct DB connectors and no installable on-prem agent.
* No in-call tools that reach customer systems (backend map §13). Data goes in before the call and results go out after it.
* No per-vendor generic "webhook scheme" DSL. Each adapter hard-codes its vendor's verification in a few lines.

---

## 6. Open questions

1. Which ATS or CRM comes first, and does it support OAuth, scoped service users and signed webhooks? This decides M3 and M4.
2. For candidate data, are we a Data Processor (the employer is the fiduciary)? Will every customer sign a DPA? This needs legal confirmation (G6).
3. What retention period should apply to pulled-but-never-called candidates, to transcripts and to recordings? The docs say 90 days; nothing is implemented (E16).
4. Will customers accept that pulled data stays in our system after disconnect until retention removes it, or must disconnect purge it?
5. Hosting: when does the move to managed Postgres in India happen? Will it be AWS (KMS available) or DigitalOcean (no KMS)? This decides the M2 upgrade path.
6. Does ElevenLabs document a timestamp tolerance? Is the legacy `xi-signature-256` form still sent? (unverified; affects the M4 voice fix)
7. Is a unified-API vendor acceptable as a sub-processor holding candidate PII and customer tokens, and where does it store data?
8. Exact DPDP Rules commencement dates and the Rule 7 wording: verify against the official Gazette (G.S.R. 846(E)), which I could not fetch.
