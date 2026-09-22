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
--
-- Passwords below are local/test defaults. For production first boot, replace
-- them before creating the volume (or use managed Postgres with your own roles)
-- and set POSTGRES_APP_PASSWORD / POSTGRES_MIGRATOR_PASSWORD in compose to match.
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

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

ALTER SCHEMA public OWNER TO platform_migrator;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;

GRANT USAGE ON SCHEMA public TO platform_app;
GRANT CREATE, USAGE ON SCHEMA public TO platform_migrator;

GRANT CREATE ON DATABASE platform TO platform_migrator;

ALTER DEFAULT PRIVILEGES FOR ROLE platform_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO platform_app;

ALTER DEFAULT PRIVILEGES FOR ROLE platform_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO platform_app;

GRANT USAGE ON SCHEMA public TO platform_migrator;
