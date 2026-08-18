# ADR-005 — User ↔ Organization Membership Model

**Status:** ACCEPTED — strong approval by founder, 2026-08-16
**Date:** 2026-08-16
**Direction set by founder, 2026-08-16:** `User.organization_id` is rejected as the long-term relationship. A membership model is mandated, and a user must be able to belong to multiple organizations with potentially different roles in each.
**Corrects:** `04_DATABASE_API_SPEC.md` §1, which defines `User` with an `organization_id` field.

---

## Context

The current specification models a user as owning a single `organization_id`. This makes an email address belong to exactly one organization forever, which breaks several requirements already in the spec pack:

- `02_BRD.md` §3 lists **agencies and MSPs** as target customers. A recruiting agency operating on behalf of several client organizations cannot function under one-user-one-org.
- Real-world consultants, fractional operators, and founders with multiple entities hit this immediately.
- Our own support and onboarding staff would need duplicate accounts per customer.
- A person who leaves one organization and joins another would be unable to reuse their email address.

The founder has directed that the relationship be modelled as `User → OrganizationMembership → Organization`. The options below therefore concern *how* to implement membership, not whether to.

---

## Options considered

### Option A — `User.organization_id` (the current spec) — REJECTED

Retained here only for the decision record.

**Advantages:** simplest possible schema; one join fewer on every query; tenant context trivially derived from the user row.

**Disadvantages:** cannot represent agencies or MSPs; email cannot be reused across organizations; every future fix is a data migration touching the identity table and every session. **Rejected by founder direction, 2026-08-16.**

### Option B — Membership join table, one active organization per session

Global `users` table; `organization_memberships` carries the role; the session holds an `active_organization_id`; the dashboard offers an organization switcher.

**Advantages**
- Cleanly expresses multiple organizations with different roles in each.
- One unambiguous tenant context per request, which is exactly what the RLS session variable in ADR-003 needs.
- Straightforward mental model for users: an organization switcher, the pattern people already know from Slack, GitHub, and Linear.
- Invitation flows work naturally — invite by email, whether or not that person already has an account.

**Disadvantages**
- Requires an explicit switching action and UI.
- Session state now carries organization context that must be validated on every request and invalidated when membership changes.

### Option C — Membership join table, organization inferred per request

No active organization in the session; tenant context derived from a subdomain, a path segment, or the requested resource.

**Advantages:** supports working across organizations in parallel browser tabs; no switching action.

**Disadvantages**
- Deriving tenancy from the requested *resource* is dangerous — it invites an insecure-direct-object-reference pattern where the client effectively names its own tenant, and ADR-003 explicitly forbids taking organization context from client input.
- Subdomain routing complicates cookie scope, TLS, and local development, and pushes toward custom domains, which `02_BRD.md` §15 explicitly defers.

### Option D — Membership plus per-organization identities

A separate identity record per organization, linked to a person. The enterprise pattern for per-org SSO and per-org data residency.

**Advantages:** each organization can own its own identity source; cleanest per-tenant data deletion.

**Disadvantages:** substantially more complex; duplicated profile data; the account-linking user experience is genuinely confusing. Unnecessary until enterprise SSO exists, which is deferred.

---

## Evaluation

| Criterion | A: `organization_id` | B: Membership + active org | C: Inferred per request | D: Per-org identities |
|---|---|---|---|---|
| ₹10k/month budget | Neutral | Neutral | Neutral | Neutral |
| Real-time voice | Neutral | Neutral | Neutral | Neutral |
| Multi-tenancy | **Fails the requirement** | Best | Good | Best |
| Security | Fair | Good — server-set context | Poor — invites client-controlled tenancy | Good |
| Maintainability | Best (but wrong) | Good | Fair | Poor |
| Development speed | Best (but wrong) | Good | Fair | Poor |
| Future scalability | Poor | Good | Good | Best |
| Provider independence | Neutral | Neutral | Neutral | Neutral |

---

## Decision

**Option B — membership join table with a server-set active organization per session.**

### Schema shape

**`users`** — global identity, not organization-owned
`id`, `email` (**globally unique, citext**), `name`, `email_verified_at`, `status`, `created_at`, `updated_at`

**`organization_memberships`** — the tenancy and role relationship
`id`, `user_id`, `organization_id`, `role_id`, `status` (`active` | `suspended`), `invited_by_user_id`, `joined_at`, `created_at`, `updated_at`
`UNIQUE (user_id, organization_id)`

**`organization_invitations`** — invite by email before an account exists
`id`, `organization_id`, `email`, `role_id`, `token_hash`, `invited_by_user_id`, `expires_at`, `accepted_at`, `status`
`UNIQUE (organization_id, email) WHERE status = 'pending'`

**`sessions`** — from ADR-002
`id`, `user_id`, `active_organization_id`, `expires_at`, `ip`, `user_agent`, `created_at`

### Rules

1. `users` and `organizations` are **global tables**, exempt from RLS, and explicitly enumerated in the ADR-003 exemption list. `organization_memberships` **is** organization-owned and carries RLS.
2. The role lives on the **membership**, never on the user. Different organizations, different roles — this is the point of the model.
3. `active_organization_id` is set server-side at login and on explicit switch, and **re-validated against an active membership on every request**. Never read from client input.
4. Switching organizations re-derives the RLS session variable and invalidates cached permission sets.
5. Removing or suspending a membership immediately invalidates any session whose active organization is that organization.
6. A user with no active memberships can authenticate but sees only an empty state — create an organization, or accept a pending invitation.
7. Deleting a user does not delete organization data. Audit events retain the actor's identifier for the retention period even after membership ends.
8. `04_DATABASE_API_SPEC.md` §1 must have `organization_id` removed from the `User` entity — see `12_SPEC_CHANGES_REQUIRED.md`.

### API additions required

- `GET /auth/organizations` — organizations the caller belongs to, with their role in each
- `POST /auth/switch-organization` — set active organization, re-validate membership, rotate context
- `GET|POST /organization/invitations`, `POST /invitations/{token}/accept`, `DELETE /organization/invitations/{id}`
- `POST /organizations` — create a new organization; the creator becomes Owner

---

## Rationale

The founder direction is correct and the reasoning is worth recording: the cost of this model is one join and an organization switcher; the cost of *not* having it is that agencies and MSPs — an explicitly named segment in the BRD — cannot use the product at all, and the fix arrives as an identity-table migration after real customer accounts exist.

Option C is rejected on security grounds specifically: deriving tenant context from the requested resource is precisely the pattern ADR-003 forbids, and subdomain routing pulls in custom-domain work that the BRD defers.

### The globally-unique-email decision

This deserves separate attention because it is the sharpest edge in the model. Making `users.email` globally unique means one person, one account, many organizations — the Slack/GitHub/Linear model. The alternative, email unique *per organization*, produces separate accounts per organization and is the harder model to leave later.

Global uniqueness is recommended, with one consequence stated plainly: **a person cannot hold two separate accounts with the same email in two organizations.** That is the intended behaviour, and it is the behaviour that makes the organization switcher coherent. It is also the decision in this ADR most expensive to reverse.

---

## Consequences

- Every organization-scoped query joins or filters through membership; index `organization_memberships` on `(user_id, organization_id)` and `(organization_id, role_id)`.
- The dashboard needs an organization switcher in the primary navigation — a change to `05_UX_DASHBOARD_SPEC.md` §2.
- Onboarding branches: a new user creating a new organization, versus an invited user joining an existing one. Both flows are Phase 1.
- Analytics and usage reporting must never aggregate across a user's organizations.
- Rate limiting should key on organization as well as user, since one person may drive load in several tenants.

---

## Expensive to change later

| Item | Cost to reverse | Why |
|---|---|---|
| **`organization_id` on user vs membership table** | **Very high** | The reason this ADR exists. Cheap now, an identity migration with live sessions later. |
| Global vs per-organization email uniqueness | **Very high** | Splitting or merging identities after accounts exist is painful and user-visible |
| Role on membership vs on user | **Very high** | Per-user roles cannot express per-organization roles at all |
| Active-org-in-session vs inferred | Moderate | Touches session handling and every client call |
| Adding per-org identities (Option D) later | Moderate | Possible from B; would not be possible from A |
