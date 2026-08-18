# Phase 1 Completion Report — Platform Foundation

**Date:** 2026-08-17
**Status:** COMPLETE against the Phase 1 boundary in `BRD's/12_ARCHITECTURE_DECISIONS_FINAL.md`
**Verification:** 108 automated tests passing against real PostgreSQL; lint clean; typecheck clean in all five packages; migrations verified from a destroyed database; live boot smoke-tested end to end.

---

## Checklist

| Item | Status | Where |
|---|---|---|
| Project structure (pnpm monorepo) | ✅ | `apps/{api,web}`, `packages/{db,permissions,providers}` |
| TypeScript strict everywhere | ✅ | `tsconfig.base.json`, 5/5 packages clean |
| Next.js dashboard foundation | ✅ | login/register, dashboard shell, org switcher, members, invite, accept-invitation |
| NestJS + Fastify backend | ✅ | `apps/api/src` |
| PostgreSQL 16 + pgvector | ✅ | `docker-compose.yml`, pgvector 0.8.6 |
| Drizzle migrations | ✅ | 3 migrations, applied by dedicated migrator role |
| Better Auth | ✅ | identity only; org/role plugins deliberately unused |
| Opaque server-side sessions | ✅ | httpOnly cookie; revocation = row delete |
| Global users / organizations / memberships / invitations | ✅ | ADR-005 shape; role on membership |
| 7 system roles, 51 permissions, 171 grants | ✅ | seeded by generated migration; drift-tested |
| Organization switching + server-side active org | ✅ | `POST /auth/switch-organization`; re-validated every request |
| Application tenant scoping | ✅ | explicit filters in every service |
| PostgreSQL RLS + FORCE | ✅ | 4 tenant tables, USING + WITH CHECK |
| Non-owner DB role, no BYPASSRLS | ✅ | asserted at runtime by tests |
| SET LOCAL tenant context | ✅ | `withTenantContext` / `withActorContext` / `withInvitationContext` |
| Permission guards, string-checked | ✅ | `@RequirePermission`, global `AuthzGuard` |
| Route permission declarations, fail closed | ✅ | undeclared → 403 at runtime AND build-failing test |
| Audit events | ✅ | auth, org, membership, invitation, switching, denials, sensitive access |
| Session invalidation on role change / removal / suspension | ✅ | proven by API tests |
| Last-owner + escalation protection | ✅ | row-locked, race-safe; proven by API tests |
| Provider interfaces only, incl. VoicePipeline + AgentSession | ✅ | zero runtime deps; enforced by test |
| Tests (unit + integration + RLS via Testcontainers) | ✅ | 108 passing |
| Lint | ✅ | flat ESLint incl. custom no-role-name-checks rule |
| Migration verification from clean DB | ✅ | volume destroyed and rebuilt during this sprint |
| Local dev setup + docs | ✅ | `README.md`, `.env.example` |

## Tests — 108 passing, 0 failing, 0 skipped

| Suite | Tests | Covers |
|---|---|---|
| `tenant-isolation.test.ts` | 19 | cross-tenant read/update/delete/insert, fail-closed no-context, context non-leakage between pooled transactions, bootstrap policy read-not-write, pgvector isolation, app role cannot disable RLS/drop policies |
| `api-security.test.ts` | 30 | forged org id via header/query/body ignored, org switching to non-member org refused, IDOR on membership ids → identical 404, permission enforcement per role, denial auditing, admin-cannot-touch-owner, self-escalation refused, last-owner protected, session invalidation on role change + removal, invitation duplicate/expiry/revocation/replay/wrong-account/forged-token, error envelope hygiene, no secret material in responses |
| `schema-drift.test.ts` | 17 | every `organization_id` table has RLS enabled+forced, every RLS table has a policy, DB catalogue == TS catalogue (51 permissions, 7 roles, per-role exact sets), PII boundary (Analyst/Viewer hold no sensitive permission) |
| `route-coverage.test.ts` | 34 | every route carries exactly one authz marker; permission strings exist in catalogue; public routes are exactly `{health}` |
| `phase-boundary.test.ts` | 8 | no provider SDK in any package.json or the lockfile; providers package has zero runtime deps and exports no implementation; no later-phase tables |

Run: `pnpm test` (requires Docker; Testcontainers boots pgvector/pg16 and applies real migrations as the real migrator role).

## Typecheck / Lint

- `tsc --noEmit` clean: `packages/permissions`, `packages/providers`, `packages/db`, `apps/api`, `apps/web`.
- ESLint clean, including a custom rule forbidding role-name comparisons outside `@platform/permissions` — it caught one real violation during the sprint, which was fixed by routing through the shared invariant helper (`canAssignRole`).

## Migration verification

`docker compose down -v` → fresh volume → init scripts (roles, extensions, context functions) → `0000_initial_schema` → `0001_rls_policies` → `0002_seed_permission_matrix` → verified: 11 tables, RLS forced on 4, 51 permissions / 7 roles / 171 grants, `platform_app` non-owner without BYPASSRLS.

## Security verification highlights

- **Fail-closed everywhere:** no tenant context → zero rows; undeclared route → 403; unknown/forged/expired/revoked invitation → identical non-probeable responses.
- **Tenant context is unforgeable by clients:** header/query/body organization ids are demonstrably ignored; context derives only from the server-side session row, re-validated against a live membership per request.
- **Sessions:** opaque, server-side, deleted on role change/suspension/removal — proven live: the demoted user's next request is a 401.
- **Concurrency-safe owner protection:** role/status/removal paths lock the target row (`FOR UPDATE`) before the last-owner count, so two simultaneous demotions cannot race past the check.
- **Invitation tokens:** stored only as SHA-256; raw token exists only in the email; API responses tested to never contain it; acceptance is transactional (claim-then-insert) so replays lose the race.
- **DB privilege split:** app role has DML only; tests prove it cannot `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` or `DROP POLICY`.

## Provider-lock-in verification

- No AI/telephony SDK in any manifest **or the lockfile** (tested, including transitives).
- `@platform/providers` has zero runtime dependencies and exports interfaces only (tested — a class or function export fails the suite).
- `VoicePipeline`, `AgentSession` (stream-shaped, ADR-007), `LLMProvider`, `EmbeddingProvider`, `KnowledgeStore`, `TelephonyProvider`, `SpeechToTextProvider`, `TextToSpeechProvider`, `CalendarProvider`, `CRMProvider`, `NotificationProvider` all defined.
- The single provider implementation is the console `NotificationProvider` (Phase 1's own scope), injected through the interface.
- Customer-facing types expose capability tiers (`intelligenceTier`, `voiceTier`), never provider names.

## Architectural decisions made during implementation (flagged for review)

1. **Membership/invitation RLS bootstrap policies.** The approved architecture required both "memberships carry RLS scoped by org" and "login reads memberships before any org context exists" — genuinely contradictory. Resolved with dual-condition USING (`org = current_org_id() OR user_id = current_actor_id()`; invitations via token-hash GUC) while WITH CHECK stays strict, so read-bootstrap gains no write authority. Flagged before implementation; tests pin the exact behaviour.
2. **`audit_events.organization_id` is nullable** for platform-level events (register/login) — tenant reads cannot see NULL rows.
3. **System-role seeding drops FORCE RLS for the duration of one migration** (owner-only DDL, transactional). The application role could never do this.
4. **Invitation acceptance requires authentication** with a matching email (spec listed the route as public; a truly anonymous accept has no user to attach the membership to). The email link lands on a page that routes through sign-in first.
5. **`requireEmailVerification` is off** until a real email provider replaces the console transport; `emailVerified` is surfaced on `/auth/me`.

## Known issues / recommended follow-ups

- **`organizations` table has no RLS policy** — it is in the approved A6 exempt list, so protection is application-layer only. A `member-of` policy is drafted in a comment in `packages/db/src/schema/organizations.ts`. Recommend a small superseding ADR to add it.
- Better Auth peer-warns against drizzle-orm 0.45 (wants ≥0.45.2 — satisfied) — no action.
- Rate limiting is per-IP; per-organization limits belong to Phase 7 usage metering.
- The dashboard is a functional foundation, not the designed product UI (guided setup wizard, richer member management arrive with their phases).
- `GET /auth/me` reflects Better Auth's own response contract for register/login bodies (includes its session token in the JSON body by design); the platform surface never returns token material.

## Recommended next task

**Phase 2 — Agent foundation:** `agents` + `agent_versions` tables (org-owned, RLS in the creating migration), agent CRUD behind `agents.*` permissions, the `AgentSession` text-loop implementation proving the ADR-007 stream shape, and `agents.test` wiring in the dashboard. Grok/independent review of Phase 1 first, per `08_DEVELOPMENT_WORKFLOW`.
