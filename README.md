# AI Agent Platform

Multi-tenant, provider-independent AI agent platform for business workflows.
First commercial wedge: **India hiring voice screening** (landing → desk →
wizard with PDF/DOCX/PPTX → demo → jobs/candidates → Call phone → review).

**Architecture:** `BRD's/12_ARCHITECTURE_DECISIONS_FINAL.md` is authoritative.
Decisions are recorded as ADRs in `BRD's/10_ADRs/` and are never edited once
accepted — changing one requires a superseding ADR.

**Current focus:** `feat/p0-pack-hiring-wizard` hiring production loop.
Gate checks: `pnpm test:api` (565+), `pnpm hiring:smoke`, `pnpm telephony:check`, `pnpm ops:check`.
Open any-resume dialing waits on carrier KYC, then `TELEPHONY_OPEN_OUTBOUND=true`.

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
pnpm dev:worker   # background job worker (email + document indexing)
pnpm dev:web      # http://localhost:3000 — dashboard (proxies to the API)
```

The worker is a second entrypoint from the same codebase, not a separate
service. Without it running, invitation and verification emails queue but are
never delivered — set `JOBS_ENABLED=false` to send inline instead.

To run the whole stack in containers (one image, two entrypoints):

```bash
BETTER_AUTH_SECRET=$(openssl rand -base64 32) \
EMAIL_FROM=no-reply@yourdomain.com \
NOTIFICATION_TRANSPORT=smtp SMTP_URL='smtp://…' \
docker compose --profile app up --build
```

Public HTTPS (Indian VPS, ADR-006): point DNS at the host, then:

```bash
DOMAIN=hiring.example.com ACME_EMAIL=ops@example.com \
API_URL=https://hiring.example.com WEB_URL=https://hiring.example.com \
COOKIE_SECURE=true \
BETTER_AUTH_SECRET=… EMAIL_FROM=… NOTIFICATION_TRANSPORT=smtp SMTP_URL=… \
docker compose --profile app --profile tls up --build -d
```

Register the voice webhook at `https://{DOMAIN}/webhooks/elevenlabs`.

For live **Call phone** in containers, also export the voice vars from `.env.example`
(`ELEVENLABS_ENABLED=true`, API key, webhook secret, phone number id, outbound
provider). Set public `API_URL` / `WEB_URL` to the HTTPS origins the browser and
voice provider can reach (not `http://localhost:3001` behind NAT). Compose mounts
a shared `platform-storage` volume so API + worker both use `STORAGE_ROOT=/app/.storage`
for document uploads.

After carrier KYC unlocks any-resume dialing, set `TELEPHONY_OPEN_OUTBOUND=true`
and recreate the API (and worker) so the desk drops the verified-only banner:

```bash
# in .env: TELEPHONY_OPEN_OUTBOUND=true
docker compose --profile app up -d --force-recreate api worker
curl -sS "$API_URL/health"   # readiness.openOutbound should be true
```

Web liveness: `GET /api/health` → `{"status":"ok"}`. API: `GET /health`.
Post-deploy smoke (no dials): `pnpm hiring:smoke`.
Operator readiness: `pnpm ops:check` · telephony: `pnpm telephony:check`.

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

Two database roles, and the split is absolute: `platform_migrator` owns every
object and runs migrations; `platform_app` serves requests with DML only and
holds **no CREATE privilege anywhere** — not on the database, not on `public`,
not on `pgboss`. Every pg-boss object is installed by migration, so the job
library performs no DDL at runtime either. If something ever fails for want of
CREATE, the fix is a migration, never a grant.

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

Voice browser demo and outbound phone sit behind an adapter (`apps/api/src/providers/`).
Product UI never names vendors. Live **Call phone** dials the candidate phone from the
job/resume (no whitelist step in the product). It needs a linked India production DID id
in env (`ELEVENLABS_PHONE_NUMBER_ID`) plus `ELEVENLABS_OUTBOUND_PROVIDER=india`. Check with
`pnpm telephony:check`. Prefer a KYC’d India carrier number over a Twilio deposit.
Other AI capabilities remain behind `@platform/providers` interfaces and phase-boundary tests.

### India live phone (operator)

1. Carrier account: complete **business verification (KYC / PAN)** so outbound can reach any resume mobile — trial accounts only reach verified numbers.
2. Create an ExoML **Voicebot** flow (not Landing Flow / Sales). Point the Voicebot URL at the voice provider’s Exotel WebSocket endpoint, note the numeric App ID as `EXOTEL_APP_ID`.
3. Import the DID: `pnpm telephony:import` (or `node scripts/import-india-phone.mjs --import`) with `EXOTEL_*` set, paste `ELEVENLABS_PHONE_NUMBER_ID`, set `ELEVENLABS_OUTBOUND_PROVIDER=india`, restart the API.
4. Register the voice webhook in the voice console: URL = `{API_URL}/webhooks/elevenlabs` (public HTTPS). Paste the signing secret into `ELEVENLABS_WEBHOOK_SECRET`, restart the API. Without this, calls may connect but transcripts/summaries stay empty until reconcile.
5. Smoke: open job → candidate with `+91…` → **Call phone** → answer → confirm transcript on the job and Calls pages. Gate check: `pnpm hiring:smoke` then `pnpm telephony:check`.
6. After KYC unlocks any-resume dialing, set `TELEPHONY_OPEN_OUTBOUND=true` and restart the API so the desk drops the verified-only banner.

### Backups (ADR-006)

While Postgres is still on the same host:

```bash
./scripts/backup.sh                 # writes .backups/<utc>/platform.dump (+ storage.tgz)
./scripts/restore.sh .backups/<utc> # replaces DB; restore is only real if you test it
```

When `STORAGE_BACKEND=s3`, document objects live in the bucket — back up with your
provider's snapshot tooling; `storage.tgz` only covers local `.storage`.

Production on a VPS: use `docker-compose.yml` + `docker-compose.prod.yml` (no host DB/app ports; Caddy only). Set `POSTGRES_*_PASSWORD`, `SMTP_URL`, `DOMAIN`, and public `API_URL`/`WEB_URL` before first boot — role passwords are fixed at volume init. Prefer `STORAGE_BACKEND=s3` (R2/S3) before real candidate documents land.
