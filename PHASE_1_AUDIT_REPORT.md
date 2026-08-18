# Phase 1 Audit

**Date:** 2026-08-18
**Method:** Mechanical validation (tests, typecheck, lint, clean-database migration) run directly, plus an independent multi-agent audit — six adversarial read-only auditors, one per dimension, each finding then adversarially verified by a separate agent before being accepted. 54 agents total; 49 findings raised, 47 confirmed, 2 refuted.
**Honesty note:** the audited code and this report have the same author. The multi-agent pass exists to counter that bias, and it worked — it found real defects the original suite missed, including a false claim in the Phase 1 completion report.

## Overall Status

**PASS WITH FIXES**

All confirmed **security** defects were fixed during the audit and are pinned by new regression tests (126/126 passing). One confirmed **scope** gap and a set of hygiene items remain open and are listed under *Fix before Phase 2*.

## Architecture Compliance

| Requirement | Status |
|---|---|
| Modular monolith, approved stack only (ADR-001) | ✅ verified — no infrastructure beyond A4 except the missing worker (see Issues) |
| Better Auth = identity only; authorization ours (ADR-002) | ✅ verified — org/role plugins unused; guard/permission layer independent |
| Three-layer isolation, RLS forced (ADR-003) | ✅ verified, and hardened during audit (migration 0003) |
| RBAC, permission strings, 51×7 matrix (ADR-004) | ✅ verified — auditor diffed the matrix doc cell-for-cell against code: **zero mismatches** |
| User→Membership→Organization, role on membership (ADR-005) | ✅ verified, plus new positive multi-org switching tests |
| Stream-shaped AgentSession, VoicePipeline defined (ADR-007) | ✅ verified — auditor confirmed the contract "structurally cannot degrade to request/response" |
| No provider SDKs, capability tiers not vendor names | ✅ verified incl. lockfile transitives |

## Security Audit

Confirmed vulnerabilities, all **fixed and regression-tested** during the audit:

1. **Tenant deletion of system roles (HIGH).** The `roles` FOR ALL policy applied its permissive USING to DELETE; WITH CHECK governs only INSERT/UPDATE, so any tenant context could delete the seven shared system roles. → Migration 0003 splits into per-command policies; DELETE reaches only the tenant's own custom roles.
2. **Expired-invitation lockout (HIGH).** Accepting an expired invitation hit the invitations WITH CHECK, 500ed, never marked the row expired — and the pending-unique index then blocked re-inviting that email permanently. → Policy write-arm now accepts the presented token hash; step-2 claim additionally guards on expiry. Test proves: clean 410, then successful re-invite.
3. **Last-owner race (HIGH).** `FOR UPDATE OF m` locked only the target row; the owner-count took no locks, so two concurrent demotions of the last two owners could leave an organization ownerless. → The count now locks every owner row, serialising concurrent owner edits. A live two-session concurrency test proves ≥1 owner always survives.
4. **Password reset kept sessions alive (HIGH).** better-auth's `revokeSessionsOnPasswordReset` is default-off (verified in the installed dist), so a stolen session survived account recovery. → Enabled.
5. **Secure-cookie fail-open toward production (HIGH).** `COOKIE_SECURE` defaulted false with no production coupling, and the value *overrides* better-auth's own https inference. → Boot now refuses `NODE_ENV=production` without `COOKIE_SECURE=true` and rejects weak/placeholder `BETTER_AUTH_SECRET` in production.
6. **Spoofable rate-limit identity (HIGH).** `trustProxy: true` hardcoded meant any client could rotate rate-limit buckets via X-Forwarded-For. → Now env-gated `TRUST_PROXY`, default false, documented for the ADR-006 proxy topology.
7. **Tamperable audit trail (MEDIUM).** The app role held UPDATE/DELETE on `audit_events`; a tenant context could also forge platform-level NULL-org rows; and org deletion **cascaded away its own audit trail including the deletion record**. → UPDATE/DELETE revoked (append-only), INSERT split into per-context policies, FK changed to SET NULL so the trail survives as platform history. All three behaviours tested.
8. **Writable authorization catalogue (MEDIUM).** The runtime role could INSERT/UPDATE/DELETE `permissions` and `role_permissions`. → Revoked; catalogue is migration-managed only.
9. **Platform-suspension fail-open (LOW).** Missing `status` field defaulted to `'active'`. → Fails closed.
10. **429/400 envelope loss + duplicate set-cookie in the auth bridge (MEDIUM/LOW).** Rate-limit and parse errors flattened to 500 without the envelope; the bridge re-added the whole cookie list once per cookie. → Exception filter preserves 4xx with the envelope (behavioural 429 test); cookies set once as an array.

## Tenant Isolation Audit

- RLS enabled **and forced** on every organization-owned table; app role non-owner, `NOBYPASSRLS`, no DDL — all asserted at runtime by tests.
- `SET LOCAL`-scoped context via parameterised `set_config` in explicit transactions; `prepare: false`; proven not to leak across pooled transactions.
- Fail-closed everywhere: no context → zero rows (now including the test suite itself, whose verification queries had to move to a superuser connection because the policies blind even the observer).
- New attack-shape coverage from the audit: `UPDATE … SET organization_id = <other org>` (row migration) refused by WITH CHECK; system-role DELETE/UPDATE from tenant context provably inert; NULL-org audit forgery refused.
- The membership bootstrap policy's `OR user_id = current_actor_id()` arm was confirmed as read-only widening (WITH CHECK stays strict). Because that arm is also live in full tenant context, the members service no longer relies on RLS alone — every query carries an explicit `organization_id` filter, per the three-layer rule.

## Authentication & Authorization

- Opaque server-side sessions; revocation proven immediate on role change, removal, and (new test) suspension; membership re-validated on every request.
- Organization context provably unforgeable via header, query, or body; switching validated against live membership; foreign-org switch indistinguishable from nonexistent.
- Permission-matrix diff: **exact** — 51 permissions, seven bundles (51/48/25/22/10/9/6), DB seed identical to code, drift-tested.
- Guard fails closed on undeclared routes *before* touching the session; public surface is exactly `{health}` by test.
- Service-level denials (self-role-change, admin-touching-owner, owner-grant refusals) now write `authz.denied` audit events, closing the matrix-invariant-7 gap the audit found.

## Database & Migration Audit

- Four migrations apply cleanly from a destroyed volume; re-run is a no-op; Testcontainers applies the same chain for every test run.
- Post-0003 state verified on a clean database: 9 policies; audit UPDATE/DELETE revoked; catalogue read-only; audit FK `SET NULL`.
- Organization creation is now atomic (one transaction for org + Owner membership; slug race → clean 409), removing the crash window that could orphan an ownerless organization.
- The seed migration's `NO FORCE` window was examined and cleared: transactional, owner-only, never exposes the app role.

## Test Coverage

**126 tests, 7 suites, 0 skipped**, against real PostgreSQL via Testcontainers (no mocked database anywhere):

| Suite | Tests | Added by audit |
|---|---|---|
| tenant-isolation | 19 | — |
| api-security | 30 | — |
| multi-org-switching | 5 | ✅ positive ADR-005 acceptance criteria, previously untested |
| audit-fixes | 12 | ✅ regression pins for every fixed finding |
| schema-drift | 17 | — |
| phase-boundary | 9 | hardened: lockfile regex actually matches scoped pnpm v9 keys; missing lockfile now fails; all migrations scanned; apps/web included; blocklist extended |
| route-coverage | 34 | — |

## Provider Independence

- No AI/telephony SDK in any manifest or the lockfile (guard now genuinely capable of catching scoped packages — the audit proved the previous regex could never match one).
- `@platform/providers`: zero runtime dependencies, interfaces only, all ten required interfaces plus `AgentSession` present.
- No provider names in business logic; capability tiers only.

## Scope Compliance

- No Phase 2+ tables, endpoints, or services; no Redis/Kafka/K8s/microservices; verified by test across every migration.
- **One confirmed scope gap:** the Phase 1 boundary requires a pg-boss job worker (email as the only job type), OpenTelemetry initialisation, and app+worker services in Docker Compose. None exist, and the completion report incorrectly claimed pg-boss was configured. Emails currently send synchronously through the NotificationProvider interface. This was left unbuilt during the audit deliberately — it is scope completion, not a security correction, and the founder should decide whether it lands before or alongside Phase 2.

## Issues Found

**Fixed during audit (verified by regression test):** the ten security items above, plus: audit-failure logging now preserves the full entry; `as never` cast replaced with a guarded narrow; org-creation atomicity; `sql.raw` interval replaced with a parameterised `make_interval`; invitation revoke/step-2 queries carry explicit filters.

**Open — fix before Phase 2:**

| # | Severity | File | Problem | Why it matters | Recommended fix |
|---|---|---|---|---|---|
| 1 | HIGH | docker-compose.yml / apps/api | pg-boss worker, OTel init, app+worker compose services absent; completion report claimed otherwise | Phase 1 boundary explicitly requires them; invitation email currently blocks the request path | Small follow-up task: pg-boss email queue + worker entrypoint + OTel bootstrap + compose services |
| 2 | MEDIUM | apps/api/src/controllers.ts | No pagination/filtering/sorting conventions; /audit hard-caps at 200 with no cursor and no ordering tiebreaker | Phase 1 API conventions item; audit history beyond 200 events unreachable | Cursor pagination on list endpoints (id tiebreaker) |
| 3 | LOW | repo root | Not a git repository — "no secret committed" is vacuous; review workflow can't diff | 08_DEVELOPMENT_WORKFLOW assumes inspectable changes | `git init` + initial commit (founder's call on hosting) |
| 4 | LOW | apps/web/tsconfig.json | Doesn't extend tsconfig.base.json — loses noUncheckedIndexedAccess etc.; `strictPropertyInitialization` off workspace-wide | TS-strictness rule weakened at edges | Extend base in web; scope the property-init exception to api |
| 5 | LOW | eslint.config.mjs | Role-name-check rule matches only one AST shape (left-hand `roleKey` literal comparisons) | Guard is evadable by reversed operands/destructuring | Broaden selector set, or a small custom rule |
| 6 | LOW | packages/db/src/tenant-context.ts | Module contract says callers pre-validate membership; the two documented bootstrap exceptions (org create, invitation accept) are only documented at call sites | Contract drift risk | Fold the exception list into the module docstring |
| 7 | INFO | platform-level audit rows | NULL-org rows are readable by **no** RLS-subject role — maximally fail-closed, but platform support tooling will eventually need a separately-audited read path (A6's platform-administration role) | Deferred by design | Address when platform admin tooling is specified |

**Refuted findings (for completeness):** the sensitive-audit hook being "dead code" (it is reachable the moment Phase 6 declares a sensitive permission — that is by design), and the Better Auth bridge lacking error-envelope handling (Fastify's own handler serialises those errors safely).

## Tests Executed

```
pnpm test                 → 126 passed / 126 (7 files)  [real PostgreSQL, Testcontainers]
tsc --noEmit              → clean in all 5 packages
eslint .                  → clean
clean-DB migration        → volume destroyed; 4 migrations applied; re-run no-op;
                            post-0003 privileges and policies verified
multi-agent audit         → 6 dimensions, 54 agents, 47 confirmed / 2 refuted findings
```

## Final Recommendation

**FIX THESE ITEMS BEFORE PHASE 2** — specifically open item #1 (pg-boss worker + OTel + compose services), which is the only substantive one; items #2–#6 are small and could ride along with it as a single "Phase 1 closeout" task. Everything security-critical found by the audit is already fixed and regression-tested.

On your approval of that closeout task, the foundation is ready to carry Phase 2 — Agent Foundation.
