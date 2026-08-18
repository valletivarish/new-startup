-- ---------------------------------------------------------------------------
-- Background job infrastructure (pg-boss).
--
-- Phase 1 A4 inventory: "One job worker process (pg-boss)" — Postgres-backed,
-- so no new infrastructure is introduced (`07_CODING_RULES` §3).
--
-- pg-boss manages its own tables. It is confined to a dedicated `pgboss`
-- schema so the privilege split survives: platform_app is granted CREATE on
-- THIS schema only, never on `public`, so it still cannot create a table
-- alongside tenant data, disable row-level security, or drop a policy.
--
-- Job payloads carry organization_id; the worker establishes tenant context
-- per organization, per transaction (ADR-003) exactly as the API does.
-- ---------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS "pgboss" AUTHORIZATION platform_migrator;

GRANT USAGE, CREATE ON SCHEMA "pgboss" TO platform_app;

-- No default-privilege grant is needed: platform_app creates pg-boss's tables
-- itself and therefore owns them. They live in `pgboss`, never `public`, so
-- they sit alongside no tenant data.
--
-- NOTE ON PAYLOADS: queued email bodies contain invitation links, and an
-- invitation link contains the raw token (the database otherwise stores only
-- its SHA-256). Those rows are not RLS-protected — pg-boss owns its schema.
-- The exposure is bounded deliberately in `queue.ts` by short job retention,
-- so a completed invitation email does not linger in the queue tables.
