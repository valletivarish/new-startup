-- ---------------------------------------------------------------------------
-- Database bootstrap: extensions and the two application roles.
--
-- Runs once, as superuser, on first initialisation of the data volume.
--
-- Security model (ADR-003 / 12_ARCHITECTURE_DECISIONS_FINAL.md A6):
--
--   platform_migrator  owns the tables and runs migrations.
--                      NOT a superuser. NOT BYPASSRLS.
--                      Because every table sets FORCE ROW LEVEL SECURITY,
--                      even the owner is subject to the tenant policies.
--
--   platform_app       the role the API connects as to serve requests.
--                      NOT the table owner. NOT BYPASSRLS.
--                      Has DML only — it cannot alter schema or drop policies.
--
-- Neither role may be granted BYPASSRLS. A test asserts this at runtime.
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- --------------------------------------------------------------------------
-- Roles
-- --------------------------------------------------------------------------
-- NOSUPERUSER / NOBYPASSRLS are stated explicitly rather than relied upon as
-- defaults, so that the intent is visible and greppable.

CREATE ROLE platform_migrator
  LOGIN
  PASSWORD 'migrator_local_dev'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOBYPASSRLS;

CREATE ROLE platform_app
  LOGIN
  PASSWORD 'app_local_dev'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOBYPASSRLS;

-- --------------------------------------------------------------------------
-- Schema ownership and privileges
-- --------------------------------------------------------------------------

ALTER SCHEMA public OWNER TO platform_migrator;

-- Nobody gets implicit table-creation rights.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

GRANT USAGE ON SCHEMA public TO platform_app;
GRANT CREATE, USAGE ON SCHEMA public TO platform_migrator;

-- The migrator needs CREATE on the database itself so that drizzle-kit can
-- create its own bookkeeping schema ("drizzle") for the migrations journal.
-- The application role is deliberately NOT granted this.
GRANT CREATE ON DATABASE platform TO platform_migrator;

-- The application role gets DML only — never DDL. It therefore cannot
-- disable row-level security or drop a policy on a table it can read.
ALTER DEFAULT PRIVILEGES FOR ROLE platform_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO platform_app;

ALTER DEFAULT PRIVILEGES FOR ROLE platform_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO platform_app;

-- The extensions were created by the superuser above; make sure the
-- migrator can reference their types when creating columns.
GRANT USAGE ON SCHEMA public TO platform_migrator;
