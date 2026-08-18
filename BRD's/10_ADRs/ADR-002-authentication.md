# ADR-002 — Authentication

**Status:** ACCEPTED — approved by founder, 2026-08-16
**Founder clarification on approval:** Better Auth answers *who are you / are you logged in / which session*. It must never become the brain of authorization. Organization, membership, role, and permission decisions belong exclusively to our own layer (ADR-004). Better Auth's own organization and role plugin features are **not** to be used as the authorization mechanism.
**Date:** 2026-08-16
**Resolves:** `04_DATABASE_API_SPEC.md` §5 — "Exact authentication mechanism is an open implementation decision"

---

## Context

Two separate questions are often conflated and must be decided independently:

1. **Who provides the authentication machinery** — password hashing, session issuance, email verification, MFA, password reset.
2. **What a session looks like on the wire** — stateful opaque token versus stateless JWT.

Both are constrained by ADR-005: a user has one global identity and belongs to *many* organizations with different roles in each. Any auth choice that assumes one user equals one tenant is disqualified immediately.

There are also two distinct authentication surfaces, and they should not share a mechanism:

- **Human dashboard sessions** — browser, long-lived, must be instantly revocable.
- **Machine-to-machine** — provider webhooks (telephony, calendar) and, later, customer API access.

---

## Options considered

### Option A — Fully self-built

Argon2id password hashing, own session table, own verification and reset flows.

**Advantages:** zero cost, zero lock-in, complete control over the membership model, all identity data stays in our database and therefore in India.

**Disadvantages:** we own timing-safe comparison, token entropy, reset-token expiry, enumeration resistance, lockout, and MFA. Every one of these is a well-known place to get breached. It is also weeks of work that produces no product differentiation.

### Option B — Managed provider (Clerk, Auth0, WorkOS, Stack Auth)

**Advantages:** fastest to a working login; MFA, magic links, and enterprise SSO available immediately; security maintained by a specialist team; good prebuilt UI.

**Disadvantages:**
- Cost scales with monthly active users and typically steps up exactly when the business starts working. Against a ₹10,000/month all-in budget this is a real line item.
- Their organization model becomes a constraint on ours. Several providers model memberships and roles opinionatedly, and we would be fitting our 7-role matrix (ADR-004) into their shape or maintaining both.
- **The login path acquires a third-party availability dependency.** Their outage is our total outage.
- Data residency: user identity data leaves India by default on most of these platforms, which is an awkward conversation with an Indian enterprise buyer later.
- Migrating *away* is the hardest migration in the system — password hashes are sometimes not exportable at all.

### Option C — Open-source auth library, self-hosted in our own database

Better Auth is the current best fit in TypeScript. Auth.js is OAuth-centric with a thin session model and no real organization support. Lucia is no longer maintained as a library and is disqualified.

**Advantages:**
- No vendor, no per-MAU cost, no external dependency in the login path.
- All identity data stays in our PostgreSQL instance, in our region.
- Provides the fiddly, security-critical mechanics — hashing, session rotation, verification, reset, MFA — without us writing them.
- Ships an organization/membership concept with invitations, which aligns with ADR-005 rather than fighting it.
- Enterprise SSO can be added later via plugins without changing the identity model.

**Disadvantages:**
- Younger project than the managed alternatives; smaller community; we carry upgrade risk.
- Its built-in role concept is simpler than our matrix, so we must use it for identity and membership plumbing only and keep authorization in our own layer. This boundary must be enforced by convention and code review.
- Self-hosting means we own patching when a CVE lands.

### Option D — Supabase Auth

**Advantages:** integrated with Postgres, RLS-aware via JWT claims, Mumbai region available.

**Disadvantages:** pulls the whole platform toward Supabase as an infrastructure dependency, which conflicts with the provider-independence principle applied at the infrastructure layer. Its RLS integration assumes JWT-based `auth.uid()`, which would couple our tenant-isolation design (ADR-003) to a specific vendor's auth. Rejected on those grounds.

---

## Evaluation

| Criterion | A: Self-built | B: Managed | C: Self-hosted OSS | D: Supabase |
|---|---|---|---|---|
| ₹10k/month budget | Best — free | Poor — scales with MAU | Best — free | Fair |
| Real-time voice | Neutral | Neutral | Neutral | Neutral |
| Multi-tenancy | Best — we design it | Fair — their model constrains ours | Good — membership-aware | Fair |
| Security | Poor — we own every mistake | Best | Good | Good |
| Maintainability | Poor — large surface we maintain | Best | Good | Good |
| Development speed | Poor — weeks | Best — days | Good — days | Good |
| Future scalability | Good | Good | Good | Good |
| Provider independence | Best | Poor — hardest migration in the system | Best | Poor |

---

## Decision

**Option C — Better Auth, self-hosted in our own PostgreSQL, with authorization kept entirely in our own layer.**

Session mechanics:

- **Dashboard sessions use opaque, random session tokens stored server-side**, delivered in `httpOnly; Secure; SameSite=Lax` cookies. **Not JWT.**
- The session record holds `user_id`, `active_organization_id`, expiry, and device/IP metadata for the audit trail.
- `active_organization_id` is **set server-side on login or explicit organization switch**, and re-validated against `organization_memberships` on every request. It is never accepted from a header, query parameter, or request body.
- Sessions are revoked immediately when a user is deactivated, a membership is removed, or a role changes.
- Machine-to-machine surfaces do **not** use user sessions: provider webhooks authenticate by HMAC signature verification per `03_SYSTEM_ARCHITECTURE.md` §18, and future customer API access uses hashed, scoped, revocable API keys tied to an organization.

### Why opaque sessions and not JWT

JWTs are attractive for horizontal scale and are the wrong default here:

1. **Revocation.** A JWT is valid until it expires. When you deactivate a recruiter who has access to candidate PII, or demote an Agent Manager who can deploy paid outbound calling, "valid for another 15 minutes" is the wrong security posture. `09_MVP_ACCEPTANCE_CRITERIA.md` requires server-side enforcement of role permissions; stale claims undermine it.
2. **Permissions change mid-session.** Our permissions are per-membership and mutable. Embedding them in a token means either very short expiry with refresh complexity, or serving stale permissions.
3. **No real benefit at our scale.** JWT's payoff is avoiding a session lookup across many stateless nodes. We run one database that every request already touches, and the lookup is an indexed primary-key read.

A session-table read per request is cheap. Cross-tenant exposure from a stale token is not.

---

## Rationale

The security-critical part of this system is **authorization**, not authentication. Getting "is this person who they say they are" right is a solved problem with well-tested libraries. Getting "may this person see Organization B's candidates" right is bespoke to us, and is where the real breach risk lives (ADR-003, ADR-004).

Option C puts the commodity problem on a maintained library and keeps all of our engineering attention on the bespoke problem, at zero marginal cost and with no third party in the login path.

The asymmetry of reversal is decisive: **self-hosted → managed is a straightforward migration** (export users, trigger a password reset cycle, cut over). **Managed → self-hosted may be impossible** if password hashes are not exportable. Starting self-hosted preserves both options; starting managed does not.

---

## Consequences

- We must operate transactional email (verification, reset, invitations) from day one. Recommend a provider-abstracted `NotificationProvider` per architecture §9, with Resend or Amazon SES behind it.
- We own dependency patching for the auth library; it belongs on the security-update watchlist.
- MFA is available but deferred past MVP; the schema must not preclude it.
- Enterprise SSO stays deferred per `02_BRD.md` §15, and this choice does not block it.

---

## Expensive to change later

| Item | Cost to reverse | Why |
|---|---|---|
| Managed provider adoption | **Very high** | Password hashes may be unexportable; identity is the stickiest data in the system |
| Opaque session ↔ JWT | Moderate | Touches every client and every authorization check |
| Password hashing algorithm | Low | Rehash transparently on next successful login |
| Email as the login identifier | **High** | See ADR-005 — global email uniqueness is an identity-model decision |
| Auth library choice | Moderate | Session and user tables are ours; the plumbing around them is replaceable |
