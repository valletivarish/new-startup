-- ---------------------------------------------------------------------------
-- Tenant-context accessors used by every row-level security policy.
--
-- The application sets these GUCs with SET LOCAL inside an explicit
-- transaction (ADR-003). Both are derived exclusively from the authenticated
-- server-side session — never from a header, query parameter, or request body.
--
-- Both functions are deliberately fail-closed:
--
--   * `current_setting(..., true)` returns NULL when the GUC was never set,
--     rather than raising.
--   * NULLIF maps the empty string to NULL, so a blank GUC cannot become an
--     invalid uuid cast at policy-evaluation time.
--   * A NULL result makes every `column = current_org_id()` comparison
--     evaluate to NULL, which is not TRUE, so the row is filtered out.
--
-- Net effect: a query issued with no tenant context returns zero rows.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION current_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(current_setting('app.current_org_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION current_actor_id()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid;
$$;

-- Used only by the public invitation-acceptance route. The caller proves
-- authorization by presenting a token whose hash it can produce; the policy
-- then exposes exactly the one invitation row matching that hash.
CREATE OR REPLACE FUNCTION current_invitation_token_hash()
RETURNS text
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(current_setting('app.invitation_token_hash', true), '');
$$;

ALTER FUNCTION current_org_id() OWNER TO platform_migrator;
ALTER FUNCTION current_actor_id() OWNER TO platform_migrator;
ALTER FUNCTION current_invitation_token_hash() OWNER TO platform_migrator;

GRANT EXECUTE ON FUNCTION current_org_id() TO platform_app;
GRANT EXECUTE ON FUNCTION current_actor_id() TO platform_app;
GRANT EXECUTE ON FUNCTION current_invitation_token_hash() TO platform_app;
