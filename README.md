# AI Agent Platform

Multi-tenant, provider-independent AI agent platform for business workflows.
First commercial wedge: recruitment screening and interview scheduling, India.

**Architecture:** `BRD's/12_ARCHITECTURE_DECISIONS_FINAL.md` is authoritative.
Decisions are recorded as ADRs in `BRD's/10_ADRs/` and are never edited once
accepted — changing one requires a superseding ADR.

**Current phase:** Phase 1 — Platform Foundation. **Complete and audited** —
see `PHASE_1_COMPLETION_REPORT.md` and `PHASE_1_AUDIT_REPORT.md`.
136 tests passing against real PostgreSQL.

---

## Prerequisites

- Node 20+ (developed on 25.9)
- pnpm 10+
- Docker (for PostgreSQL and for the test suite)

## Local setup

```bash
pnpm install
cp .env.example .env
pnpm db:up          # PostgreSQL 16 + pgvector on localhost:5434
pnpm db:migrate     # schema, RLS policies, permission matrix
```

Verify the foundation:

```bash
pnpm test
```

This boots a throwaway PostgreSQL container via Testcontainers, applies the
real migrations as the real migrator role, and runs the tenant-isolation
suite against it. Row-level security cannot be verified against a mock
(`07_CODING_RULES` §14), so a real database is required — Docker must be
running.

## Commands

| Command | What it does |
|---|---|
| `pnpm db:up` | Start PostgreSQL + pgvector |
| `pnpm db:down` | Stop it |
| `pnpm db:reset` | Destroy the volume and start clean |
| `pnpm db:generate` | Generate a migration from schema changes |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm test` | Full test suite against real PostgreSQL |
| `pnpm typecheck` | Typecheck every package |
| `pnpm lint` | ESLint, including the no-role-name-checks rule |

After changing the permission catalogue, regenerate the seed migration:

```bash
pnpm --filter @platform/db exec tsx src/scripts/generate-seed-migration.ts
```

## Layout

Run the stack locally:

```bash
pnpm dev:api      # http://localhost:3001 — API (health at /health)
pnpm dev:worker   # background job worker (email delivery)
pnpm dev:web      # http://localhost:3000 — dashboard (proxies to the API)
```

The worker is a second entrypoint from the same codebase, not a separate
service. Without it running, invitation and verification emails queue but are
never delivered — set `JOBS_ENABLED=false` to send inline instead.

To run the whole stack in containers (one image, two entrypoints):

```bash
BETTER_AUTH_SECRET=$(openssl rand -base64 32) docker compose --profile app up --build
```

```
apps/
  api/                 NestJS + Fastify backend
  web/                 Next.js dashboard foundation
packages/
  db/                  Drizzle schema, migrations, RLS, tenant context
  permissions/         51 permissions, 7 system roles
  providers/           Provider interfaces — definitions only, no SDKs
docker/postgres/init/  Roles, extensions, tenant-context functions
BRD's/                 Specification pack and ADRs
```

---

## The two rules that shape everything

### 1. No cross-tenant data access, even accidentally

Isolation is enforced at three layers, all required:

```
1. Authorization      — does this membership hold the permission?
2. Explicit filtering — WHERE organization_id = $1
3. PostgreSQL RLS     — the database refuses anything else
```

Every organization-scoped query goes through a tenant-context wrapper that
issues `SET LOCAL app.current_org_id` inside an explicit transaction, from the
authenticated server-side session only:

```ts
await withTenantContext(db, { organizationId, userId }, async (tx) => {
  // RLS restricts this transaction to organizationId.
  // Still filter explicitly — RLS is the backstop, not the primary mechanism.
});
```

**Never** take tenant context from a header, query parameter, or request body.

The application connects as `platform_app`: not the table owner, no DDL, no
`BYPASSRLS`. It cannot disable RLS or drop a policy — there are tests proving
both. A forgotten `WHERE organization_id` returns **zero rows**, not another
tenant's data.

When you add an organization-owned table, enable **and force** RLS in the same
migration. `schema-drift.test.ts` fails if you forget.

### 2. Check permissions, never role names

```ts
@RequirePermission('agents.deploy')   // ✅
if (role === 'administrator')         // ❌
```

The catalogue lives in `@platform/permissions` and is the single source of
truth; the seed migration is generated from it. Personal data is gated
separately — `candidates.read_pii`, `calls.read_transcript`,
`calls.read_recording`, `candidates.export` — and every such read writes an
audit event.

---

## Providers

No AI or telephony provider is selected or installed. Interfaces are defined in
`@platform/providers`; implementations arrive at their phase, chosen on
benchmark evidence. `phase-boundary.test.ts` fails if a provider SDK is added.
