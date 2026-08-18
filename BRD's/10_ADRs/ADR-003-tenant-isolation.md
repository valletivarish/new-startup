# ADR-003 — Tenant Isolation

**Status:** ACCEPTED — strong approval by founder, 2026-08-16
**Elevated to engineering rule by founder:** *"No cross-tenant data access, even accidentally."*
**Date:** 2026-08-16
**Resolves:** `03_SYSTEM_ARCHITECTURE.md` §5 and `04_DATABASE_API_SPEC.md` §2, which mandate organization scoping but never specify the enforcement mechanism.

> This is the **most expensive decision in the entire set to reverse**, and the one with the highest breach cost if deferred. It must be settled before the first migration is written.

---

## Context

The spec pack states that every organization-owned query must be organization-scoped and that tenant isolation is a critical security requirement. It does not say *how* that is enforced. The three candidate mechanisms have very different failure modes.

The system will hold candidate PII, call recordings, and transcripts across many small organizations on shared infrastructure. The realistic failure mode is not a sophisticated attack — it is **one missing `WHERE organization_id = ?` in one query, in one background job, eighteen months from now**.

---

## Options considered

### Option A — Application-layer authorization only

Every query is scoped by `organization_id` in a repository or service layer; correctness rests on developer discipline plus code review.

**Advantages**
- Simplest to build and to reason about; no PostgreSQL feature dependency.
- Works identically in tests, local development, and production with no special setup.
- No policy-evaluation overhead; query plans are exactly what you wrote.
- No interaction with connection pooling.

**Disadvantages**
- **Fails open.** A forgotten filter silently returns another tenant's data; nothing detects it but a customer or a researcher.
- The guarantee degrades as the codebase grows, and degrades fastest in exactly the places least reviewed: background jobs, analytics aggregation, admin tooling, one-off data scripts, and raw SQL written for `pgvector` similarity search.
- Provides no defense in depth. A SQL-injection flaw or an ORM misuse becomes a full cross-tenant breach rather than a contained one.

### Option B — PostgreSQL Row-Level Security

Every organization-owned table carries `organization_id` and an RLS policy; the application sets a per-transaction session variable derived from the authenticated session.

**Advantages**
- **Fails closed.** A forgotten `WHERE` clause returns zero rows instead of another tenant's rows. The bug becomes a visible functional failure in development rather than an invisible leak in production.
- One mechanism covers every access path uniformly — ORM queries, hand-written SQL, background jobs, analytics, and `pgvector` retrieval. Architecture §8 requires organization-scoped retrieval, and RLS is the only option here that covers raw vector queries automatically.
- Materially stronger audit and compliance story for later enterprise buyers.
- Directly satisfies `03_SYSTEM_ARCHITECTURE.md` §14: guardrails enforced below the application layer, not only inside it.

**Disadvantages**
- Requires `SET LOCAL app.current_org_id` inside an explicit transaction on every request. This must be wired into the data-access layer once and never bypassed.
- **Connection pooling is the classic footgun.** A pooled connection carrying a stale session variable will serve the wrong tenant. Session-level `SET` is unsafe with transaction-mode poolers; `SET LOCAL` inside an explicit transaction is safe. This is a documented invariant, not a preference.
- The table owner and superusers bypass RLS unless `FORCE ROW LEVEL SECURITY` is set. The application must connect as a **non-owner role**.
- Every new table must remember to enable RLS. This needs a migration checklist and an automated test that fails when an organization-owned table has no policy.
- Small per-query planning overhead; usually negligible, occasionally noticeable on complex joins.

### Option C — Schema-per-tenant

Each organization receives its own PostgreSQL schema.

**Advantages**
- Strongest logical separation; the most intuitive story to tell an enterprise buyer.
- Per-tenant backup, restore, and export are trivial.
- Contains some noisy-neighbour effects.

**Disadvantages**
- **Migrations must run across every schema.** At a few hundred organizations this is slow, and partial failure leaves schemas at inconsistent versions — an operational hazard that grows with success.
- **`pgvector` indexes are duplicated per schema.** HNSW indexes are memory-resident; hundreds of tenants means hundreds of index structures competing for RAM on a single modest server. This directly conflicts with the ₹10,000/month constraint.
- Cross-tenant platform analytics require UNION across schemas and become progressively unworkable.
- Connection and prepared-statement churn from constant `search_path` switching.
- Weak tooling support for dynamic schemas in both Drizzle and Prisma.
- A poor fit for a self-serve product with many small organizations, which is precisely the ICP in `02_BRD.md` §3.

---

## Evaluation

| Criterion | A: App layer | B: RLS | C: Schema-per-tenant |
|---|---|---|---|
| ₹10k/month budget | Best | Best — one database | Poor — RAM cost of duplicated vector indexes |
| Real-time voice | Best — no overhead | Good — negligible overhead | Fair — connection churn in the audio path |
| Multi-tenancy | Fair — discipline-based | Best — enforced by the engine | Good, until migration count bites |
| Security | Poor — fails open | Best — fails closed | Good |
| Maintainability | Good early, worse over time | Good — one invariant, well documented | Poor — migration fan-out |
| Development speed | Best | Good — one-time setup cost | Poor |
| Future scalability | Fair | Good | Poor for many small tenants |
| Provider independence | Neutral | Ties us to PostgreSQL (already assumed) | Ties us to PostgreSQL |

---

## Decision

**Option B and Option A together — RLS as the enforced backstop, application-layer scoping as the primary path. Not either/or.**

This mirrors the pattern the architecture document already mandates for agent guardrails in §14: enforce at two levels, and never let the higher level be the only thing standing between a mistake and a breach.

### Concrete design

1. Every organization-owned table carries `organization_id UUID NOT NULL` with a foreign key to `organizations`.
2. Every such table sets both `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` in the **same migration that creates the table**.
3. Standard policy shape:
   `USING (organization_id = current_setting('app.current_org_id', true)::uuid)`
   with a matching `WITH CHECK` clause so that writes cannot create rows belonging to another tenant.
4. The application connects as a **non-owner role** with no `BYPASSRLS` attribute. Migrations run as a separate privileged role.
5. A request-scoped transaction wrapper issues `SET LOCAL app.current_org_id = $1` at the start of every transaction. The value is derived **exclusively from the server-side session's `active_organization_id`**, re-validated against `organization_memberships`. It is never read from a header, query parameter, or request body.
6. The application layer **also** filters by `organization_id` explicitly. This keeps query plans index-friendly, makes intent legible in code review, and means the RLS policy is a backstop rather than the sole mechanism.
7. Platform-administration access (support, cross-tenant operations) uses a distinct, separately audited role and code path. It is not the default connection.
8. Tables that are genuinely global (`users`, `organizations`, system `roles`) are explicitly enumerated and exempt, with a documented justification for each.

### Required tests

Per `07_CODING_RULES_FOR_CLAUDE.md` §4, against real PostgreSQL via Testcontainers:

- Organization A cannot read Organization B's rows in any organization-owned table.
- Organization A cannot update or delete Organization B's rows.
- Insert attempts carrying a foreign `organization_id` are rejected by `WITH CHECK`.
- A query with the session variable unset returns zero rows — proving fail-closed behaviour.
- A **schema-drift test** that enumerates all tables with an `organization_id` column and asserts each has RLS enabled and forced. This is what prevents the invariant from decaying over time.
- `pgvector` similarity search returns only same-organization chunks.

---

## Rationale

The distinction that decides this is **fail-open versus fail-closed**.

Under Option A, the cost of a single forgotten filter is a silent cross-tenant data leak involving candidate PII — discovered, if at all, by a customer. Under Option B, the same mistake returns an empty result set and is caught by a failing test or a developer within minutes.

Option A is not rejected — it is retained as the first layer, because explicit scoping produces better query plans and clearer code. What is rejected is relying on it *alone*.

Option C is rejected on cost and operational grounds specific to this product: duplicated HNSW vector indexes across hundreds of small tenants is the wrong shape for a ₹10,000/month single-server deployment, and migration fan-out becomes a liability precisely as the business succeeds.

---

## Consequences

- The transaction wrapper becomes a critical, heavily-tested piece of infrastructure. Every data access path goes through it.
- Background jobs must establish tenant context explicitly. A job that processes work for many organizations must set the variable per organization and per transaction — never once for a batch.
- Connection pooling configuration becomes security-relevant and must be documented as such: transaction-mode pooling with `SET LOCAL` inside explicit transactions.
- Local development requires real PostgreSQL. No SQLite fallback, no mocked database.
- New-table migrations acquire a mandatory checklist item, backed by the automated drift test above.

---

## Expensive to change later

| Item | Cost to reverse | Why |
|---|---|---|
| **Adding RLS after the fact** | **Very high** | Requires auditing every table, query, background job, and the pooling layer — and the system is exposed the entire time. Days now; weeks later, with breach risk in between. |
| Schema-per-tenant ↔ shared schema | **Very high** | A full data migration with downtime |
| Choosing PostgreSQL | **Very high** | The entire isolation model assumes it |
| Policy shape and `organization_id` placement | Moderate | Changing which column tenancy hangs on touches every policy and index |
| Connection pooling mode | Low–moderate | Configuration, but with security consequences if changed carelessly |
