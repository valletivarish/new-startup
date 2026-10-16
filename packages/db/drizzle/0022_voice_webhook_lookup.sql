-- ---------------------------------------------------------------------------
-- Webhook organization lookup without bypassing row-level security.
--
-- A provider webhook arrives with no session and no organization: only a
-- provider conversation id, authenticated by an HMAC over the raw body. The
-- previous lookup ran with no tenant context, so under the real application
-- role and FORCE RLS it matched zero rows and never recorded results.
--
-- Same pattern as the invitation-token policy (0001/0003): after the HMAC is
-- verified, the application sets app.webhook_conversation_id inside a
-- transaction, and this SELECT-only policy exposes exactly the one session
-- carrying that conversation id. It grants no write authority: updates still
-- run in a second transaction under that session's organization context.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION current_webhook_conversation_id()
RETURNS text
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(current_setting('app.webhook_conversation_id', true), '');
$$;
--> statement-breakpoint
ALTER FUNCTION current_webhook_conversation_id() OWNER TO platform_migrator;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION current_webhook_conversation_id() TO platform_app;
--> statement-breakpoint
CREATE POLICY "vs_webhook_lookup" ON "voice_sessions"
  FOR SELECT
  USING ("external_conversation_id" = current_webhook_conversation_id());
