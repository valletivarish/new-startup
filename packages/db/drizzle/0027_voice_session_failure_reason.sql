-- ---------------------------------------------------------------------------
-- Machine-readable reason for an unsuccessful call.
--
-- The desk maps these to plain sentences; provider or carrier text never
-- reaches the client. NULL means the call did not fail (or predates this
-- column). Additive; the Nest API neither reads nor writes it.
-- ---------------------------------------------------------------------------

ALTER TABLE "voice_sessions" ADD COLUMN "failure_reason" text;
--> statement-breakpoint
ALTER TABLE "voice_sessions"
  ADD CONSTRAINT "voice_sessions_failure_reason_check"
  CHECK ("failure_reason" IS NULL OR "failure_reason" IN (
    'no_answer', 'busy', 'voicemail', 'line_not_connected',
    'invalid_number', 'carrier_blocked', 'network', 'unknown'
  ));
