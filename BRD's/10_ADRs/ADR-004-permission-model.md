# ADR-004 — Permission Model and Authorization

**Status:** ACCEPTED — approved by founder, 2026-08-16
**Date:** 2026-08-16
**Resolves:** `02_BRD.md` §5 — "Exact permissions must be defined in the API/authorization specification", which `04_DATABASE_API_SPEC.md` never did.
**Companion document:** `11_PERMISSION_MATRIX.md` contains the complete matrix.

---

## Context

`02_BRD.md` §5 names seven roles — Owner, Administrator, Agent Manager, Knowledge Manager, Recruiter/Operator, Analyst, Viewer — and defers their permissions. `03_SYSTEM_ARCHITECTURE.md` §4 lists a `Permission` entity with no fields and no mapping to roles. Phase 1 of the development workflow requires roles and permissions, so this gap blocks the first implementation task.

Under ADR-005, permissions are evaluated per **membership**, not per user. The same person may be an Owner in one organization and a Viewer in another.

Two requirements from `02_BRD.md` §14 shape the design beyond simple CRUD:

- "Controlled access to candidate information"
- "Controlled access to recordings/transcripts"

Both mean personally identifiable information needs finer granularity than a single `candidates.read`.

---

## Options considered

### Option A — Role enum with hard-coded checks

A `role` column on the membership; authorization is `if (role === 'owner' || role === 'admin')` at each call site.

**Advantages:** trivially simple; zero schema overhead; fastest to write in week one.

**Disadvantages:** permission logic scatters across the codebase with no single place to audit; adding a role means editing every conditional; custom roles become impossible without a rewrite; there is no way to answer "what can this role actually do?" without grepping.

### Option B — Role → Permission mapping, checked as permission strings (RBAC)

Roles are named bundles of `resource.action` permission strings. Code checks the permission, never the role.

**Advantages:** one authoritative table defines the model; call sites express intent (`requires('candidates.read_pii')`) rather than identity; adding a role is data, not code; custom roles are a later feature rather than a rewrite; the matrix is directly auditable and testable.

**Disadvantages:** more moving parts than Option A; permissions must be loaded and cached per request; needs discipline to avoid permission-string sprawl.

### Option C — Attribute/policy-based access control (ABAC, e.g. Cedar, OpenFGA, Oso)

Rules evaluated over subject, resource, and context attributes — "a Recruiter may read candidates *for jobs they own*".

**Advantages:** most expressive; handles record-level rules and relationship-based access; scales to complex enterprise requirements.

**Disadvantages:** significant conceptual and operational overhead; typically an external policy engine or service, adding infrastructure and a dependency in the request path; authorization becomes hard to reason about and debug; substantially over-engineered for seven roles and one tenancy dimension. Directly conflicts with coding rules §16 on unnecessary dependencies.

### Option D — RBAC now, with a documented extension point for record-level rules

Option B, plus a defined place where per-record scoping (for example, "only candidates for jobs assigned to me") can later be layered on without redesign.

---

## Evaluation

| Criterion | A: Role enum | B: RBAC | C: ABAC engine | D: RBAC + extension point |
|---|---|---|---|---|
| ₹10k/month budget | Best | Best | Poor — extra service | Best |
| Real-time voice | Neutral | Neutral | Fair — added latency | Neutral |
| Multi-tenancy | Fair | Good — per-membership | Best | Good |
| Security | Poor — unauditable | Good — single source of truth | Best | Good |
| Maintainability | Poor — scattered logic | Good | Fair — policy language to learn | Good |
| Development speed | Best short-term | Good | Poor | Good |
| Future scalability | Poor | Good | Best | Good |
| Provider independence | Neutral | Neutral | Poor — engine dependency | Neutral |

---

## Decision

**Option D — role-based access control with permission strings, plus a defined extension point for record-level scoping.**

### Model

```
User ──< OrganizationMembership >── Organization
                  │
                  └──> Role ──< RolePermission >── Permission
```

- `permissions` — the fixed catalogue of `resource.action` strings, seeded by migration.
- `roles` — `organization_id` nullable. `NULL` marks a **system role** available to every organization; a non-null value marks a future organization-defined custom role.
- `role_permissions` — the join table that defines the matrix.
- `organization_memberships.role_id` — the role this user holds **in this organization**.

### Enforcement rules

1. **Code checks permissions, never roles.** `requires('agents.deploy')`, never `if (role === 'agent_manager')`. Enforced in review; a lint rule is preferred.
2. **Every protected endpoint declares its required permission** as a NestJS guard on the route. An endpoint with no declared permission fails closed and is caught by an automated test that enumerates routes.
3. **Authorization is server-side.** UI permission gating is cosmetic only — `05_UX_DASHBOARD_SPEC.md` §2 requires navigation to respect permissions, and that is a usability feature, not a security control.
4. **Permissions resolve against the session's active organization membership.** Never globally, never from client-supplied context.
5. **This layer is independent of, and additional to, the RLS backstop in ADR-003.** RLS answers "which tenant's rows"; this layer answers "may this member perform this action". Both must pass.
6. **Tool and action permissions for AI agents are enforced here too**, satisfying `07_CODING_RULES_FOR_CLAUDE.md` §12: the agent runtime resolves tool authorization through the same permission layer, so a prompt injection cannot grant capability the membership lacks.

### Invariants

- Every organization must have at least one active Owner at all times. The last Owner cannot be demoted or removed.
- Only an Owner may grant or revoke the Owner role.
- An Administrator cannot modify an Owner's membership.
- No member may escalate their own role, including an Owner acting on themselves in a way that leaves zero Owners.
- Role changes and membership removal immediately invalidate affected sessions (ADR-002).
- Every permission-denied event and every sensitive read (candidate PII, recordings, transcripts) writes an `AuditEvent`.

### Extension point for record-level scoping

Permission checks resolve through a single authorization service. Record-level predicates — "assigned recruiter only", "own jobs only" — attach at that service as an optional scope function per permission. Nothing else in the codebase changes when they are introduced. Record-level rules are **out of scope for MVP** and are not implemented now.

---

## Rationale

Seven roles across fifteen resource groups is comfortably inside RBAC's competence and well below the complexity where a policy engine earns its cost. The decisive advantage over a role enum is auditability: with a permission table, the answer to "who can listen to call recordings?" is a query, not an archaeology exercise across the codebase.

The PII split — `candidates.read` separate from `candidates.read_pii`, and `calls.read` separate from `calls.read_transcript` and `calls.read_recording` — is deliberate and comes straight from `02_BRD.md` §14. It is what lets an Analyst work on screening funnel metrics without ever seeing a candidate's phone number, and it is far cheaper to design in now than to retrofit once code assumes candidate reads are all-or-nothing.

---

## Consequences

- The permission catalogue is seeded by migration and versioned; adding a permission is a migration, which is correct — it should be a deliberate, reviewable act.
- Permission sets are cached per request after a single indexed lookup; the cache must be invalidated on role change.
- Custom roles are deliberately deferred past MVP, but the schema supports them with no redesign.
- An endpoint-coverage test must assert that every non-public route declares a required permission.

---

## Expensive to change later

| Item | Cost to reverse | Why |
|---|---|---|
| Role enum instead of a permission table | **High** | Every scattered role check must be found and rewritten |
| Permission granularity for PII | **High** | Once code assumes candidate access is all-or-nothing, splitting it means auditing every read path |
| Permissions on membership vs on user | **Very high** | This is the ADR-005 decision; per-user roles cannot express per-org roles |
| Adding record-level scoping later | Low — by design | The extension point exists specifically to make this cheap |
| Renaming permission strings | Low | Data migration on one table |
