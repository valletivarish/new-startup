# Specification Changes — Applied Changelog

**Status:** APPLIED — 2026-08-16
**Driven by:** ADR-001 … ADR-007, all ACCEPTED
**Consolidated in:** `12_ARCHITECTURE_DECISIONS_FINAL.md`

Per `07_CODING_RULES_FOR_CLAUDE.md` §20, an explicit founder decision outranks the existing documents. The ADRs were approved on 2026-08-16 and became the latest decision, so the specification pack was updated to match.

**Every change listed below has been applied.** This document is the record of what changed and why, not a to-do list.

Legend — **[CORRECTION]** contradicted what was written · **[FILL]** completed something explicitly deferred · **[ADD]** new content

---

## `README.md` — APPLIED

- **[ADD]** Approval banner and a pointer to `12_ARCHITECTURE_DECISIONS_FINAL.md` as authoritative.
- **[ADD]** Reading order extended to 14 items covering `10_ADRs/`, `11_PERMISSION_MATRIX.md`, `12_…FINAL.md`, and this changelog.
- **[ADD]** ADR process recorded: never edit an accepted ADR; supersede it.
- **[ADD]** Note that no AI or telephony provider has been selected.
- **[CORRECTION]** First implementation task now includes memberships, invitations, RLS policies, and provider interface definitions, and points at the Phase 1 boundary.

## `00_PROJECT_CONTEXT.md` — APPLIED

- **[CORRECTION]** "Commercial boundary" — users belong to organizations through **memberships**, and may hold a different role in each.
- **[ADD]** "Bootstrap constraint" — infrastructure figure of ₹2,000–4,500/month for Phases 1–4.
- **[CORRECTION]** "Current development status" — changed from *planning/design stage* to **architecture approved**, with the two open experimental decisions named and Phase 1 unblocked.

## `01_PRODUCT_STRATEGY.md` — NO CHANGES

Product-level and unaffected by these decisions. Reviewed and confirmed consistent.

## `02_BRD.md` — APPLIED

- **[CORRECTION]** §4 — a user may belong to multiple organizations with a different role in each; membership carries the role. Agencies, MSPs, consultancies, and multi-entity founders named as the reason.
- **[FILL]** §5 — *"Exact permissions must be defined in the API/authorization specification"* replaced with a reference to `11_PERMISSION_MATRIX.md`, plus the per-membership rule.
- **[ADD]** §14 — enforcement detail: isolation at both application and database layers; personal data gated by distinct permissions with fields omitted rather than hidden; audit on sensitive reads and denials.

## `03_SYSTEM_ARCHITECTURE.md` — APPLIED (v0.1 → v0.2)

- **[FILL]** §2 — the approved stack table, and the process topology (API, job worker, Voice Gateway as entrypoints from one codebase).
- **[CORRECTION]** §4 — entity list amended: `User` marked global and not organization-owned; `OrganizationMembership`, `OrganizationInvitation`, `Session`, `RolePermission` added.
- **[FILL]** §5 — the full RLS mechanism replacing the previous prose, plus the connection-pooling invariant, the background-job rule, and the exhaustive list of RLS-exempt global tables.
- **[ADD]** §5a — new section: the identity and tenancy model diagram.
- **[CORRECTION]** §7 — **agent runtime rewritten as a stream-shaped `AgentSession`**, not a request/response handler (ADR-007). Authorization step now explicitly routes through the permission layer.
- **[ADD]** §9 — per-interface table of *defined in* / *implemented in* phase; explicit statement that no provider is embedded.
- **[ADD]** §12 — agent tool authorization resolves through the human authorization layer.
- **[ADD]** §17 — `pg-boss` named; per-organization, per-transaction tenant context for jobs.
- **[FILL]** §21 — concrete deployment target, the latency budget table, the outbound-calling explanation for rejecting serverless, portability constraints, and the open vendor question.

## `04_DATABASE_API_SPEC.md` — APPLIED (v0.1 → v0.2)

The most heavily changed file.

- **[CORRECTION]** §1 `User` — **`organization_id` removed.** Now a global identity with a globally unique, case-insensitive email. An inline note records the removal and its date.
- **[ADD]** §1 — new entities: `OrganizationMembership`, `OrganizationInvitation`, `Session`, `Permission`, `RolePermission`.
- **[CORRECTION]** §1 `Role` — `organization_id` clarified as nullable, `NULL` denoting a system role; the seven system roles named; custom roles marked deferred.
- **[FILL]** §2 — the three-layer isolation model, the RLS mechanism, the client-input prohibition, the pooling invariant, the background-job rule, and the exempt-table list.
- **[FILL]** §3 — *"Exact authentication mechanism is an open implementation decision"* **resolved**: self-hosted library, opaque server-side sessions, not JWT, with the authentication/authorization boundary table and the machine-to-machine rules.
- **[ADD]** §5 — new endpoints: registration, email verification, password reset, `GET /auth/organizations`, `POST /auth/switch-organization`, `POST /organizations`, full membership and invitation groups, `GET /roles`, `GET /permissions`, `GET /audit`.
- **[CORRECTION]** §5 — `POST /organization/users` replaced by `POST /organization/invitations`, with a note explaining why users are never created inside an organization.
- **[ADD]** §8 — route-level permission declaration, permission strings over role names, field omission for personal data, audit on denials, agent tool authorization.

## `05_UX_DASHBOARD_SPEC.md` — APPLIED

- **[ADD]** §2 — **organization switcher** added to primary navigation, with the rationale and the "UI gating is cosmetic" rule.
- **[ADD]** §3 — post-login routing for users with many, one, or zero memberships.
- **[CORRECTION]** §4 — onboarding split into Path A (create organization, become Owner) and Path B (accept invitation).
- **[ADD]** §10 — contact details, transcripts, and recordings render only for permission holders; the API omits the fields rather than the UI hiding them.
- **[CORRECTION]** §15 — the users screen now manages **memberships and invitations**; pending invitations shown with expiry; the four membership guardrails surfaced in the UI.
- **[ADD]** §18 — two new principles: server-side authorization, and unambiguous active organization.

## `06_PROVIDER_AND_COST_SPEC.md` — APPLIED

- **[ADD]** §11 — concrete infrastructure allocation figures.
- **[ADD]** §12 — enforcement points: pre-origination checks, server-side duration timer, per-organization and platform caps, kill switch.
- **[ADD]** §14 — the Indian-region requirement with its latency justification, and an explicit **provider selection status** section recording that nothing is selected.

## `07_CODING_RULES_FOR_CLAUDE.md` — APPLIED

- **[ADD]** §3 Must — RLS in the creating migration; permission declared on every route; permission strings not role names; keep the runtime stream-shaped.
- **[ADD]** §3 Must not — no infrastructure outside the approved inventory; no embedded provider; no delegating authorization to the auth library.
- **[ADD]** §4 — the engineering rule *"no cross-tenant data access, even accidentally"*; the client-input prohibition; the background-job rule; pooling mode; non-owner role. Test list extended with insert-attribution, fail-closed, and privilege-escalation cases.
- **[ADD]** §12 — agent tool authorization through the permission layer; Zod validation of structured output.
- **[ADD]** §14 — Testcontainers mandated for RLS testing, with the three structural tests that must not be removed.
- **[CORRECTION]** §20 — accepted ADRs inserted at priority 2 in the source-of-truth hierarchy.
- **[ADD]** §21 — the ADR process.
- **[ADD]** §22 — stack conventions, including the rule that interfaces may precede their phase but provider SDKs may not.

## `08_DEVELOPMENT_WORKFLOW.md` — APPLIED

- **[CORRECTION]** Phase 1 expanded: memberships, invitations, permission seeding, RLS policies, provider interface definitions.
- **[CORRECTION]** Phase 2 — `AgentSession` stream-shaped contract replaces "basic runtime contracts", with the anti-pattern called out.
- **[ADD]** Phase 5 — Voice Gateway, `VoicePipeline` implementation, Redis, and an entry check that voice can be added without modifying the runtime.
- **[ADD]** Review loop — a five-point architecture conformance check.

## `09_MVP_ACCEPTANCE_CRITERIA.md` — APPLIED

- **[ADD]** Organization — invitation flow, multi-organization membership with per-organization roles, clean organization switching, last-Owner protection.
- **[ADD]** Security — RLS enabled and forced verified by schema-drift test; fail-closed on unset tenant context; cross-tenant read/write/insert all rejected; route-coverage test; **Analyst cannot retrieve contact details, transcripts, or recordings through any API path**; audit on sensitive reads; immediate session invalidation.

---

## New files created by this phase

| File | Purpose |
|---|---|
| `10_ADRs/ADR-001-technology-stack.md` | Stack decision |
| `10_ADRs/ADR-002-authentication.md` | Auth mechanism and session strategy |
| `10_ADRs/ADR-003-tenant-isolation.md` | Application scoping + RLS |
| `10_ADRs/ADR-004-permission-model.md` | RBAC model and enforcement |
| `10_ADRs/ADR-005-user-organization-membership.md` | Membership model |
| `10_ADRs/ADR-006-hosting-deployment.md` | Hosting, voice latency, outbound calling |
| `10_ADRs/ADR-007-agent-runtime-shape-and-voicepipeline-interface.md` | Stream-shaped runtime; VoicePipeline in Phase 1 |
| `11_PERMISSION_MATRIX.md` | 51 permissions × 7 roles, invariants, required tests |
| `12_ARCHITECTURE_DECISIONS_FINAL.md` | **Authoritative consolidated architecture** |
| `13_SPEC_CHANGES_REQUIRED.md` | This changelog |

## Verification

| Check | Result |
|---|---|
| `User.organization_id` present anywhere in the pack | ✅ removed |
| Authentication described as an open decision anywhere | ✅ resolved |
| "Exact permissions must be defined…" left unfilled | ✅ filled |
| Tenant isolation mechanism unspecified anywhere | ✅ specified |
| Stack absent from the architecture document | ✅ named |
| Deployment target unspecified | ✅ specified |
| Runtime described as request → response anywhere | ✅ corrected |
| Any provider named as a permanent selection | ✅ none |
| Contradictory specification remaining | ✅ none found |
