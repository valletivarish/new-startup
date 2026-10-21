-- ---------------------------------------------------------------------------
-- Google Speech-to-Text listens on own-loop calls in languages Deepgram Nova-3
-- has no model for (Malayalam today; see apps/voice STT routing).
--
-- cost_services     google_stt priced per audio minute.
-- call_cost_ledger  stt_provider: which STT the call used (deepgram | google;
--                   null for the provider-hosted baseline and older rows).
-- ---------------------------------------------------------------------------

ALTER TABLE "call_cost_ledger"
  ADD COLUMN "stt_provider" text
    CONSTRAINT "call_cost_ledger_stt_provider_check" CHECK ("stt_provider" IN ('deepgram', 'google'));
--> statement-breakpoint

-- cost_services has FORCE RLS: write the price row as platform admin, this transaction only.
SELECT set_config('app.platform_admin', 'on', true);
--> statement-breakpoint
-- Chirp 2 streaming: USD 0.016 per minute at INR 88/USD = INR 1.41 per minute.
INSERT INTO "cost_services" ("key", "name", "vendor", "used_for", "billing", "rate_inr", "status", "notes") VALUES
  ('google_stt', 'Google Speech-to-Text (Chirp 2)', 'Google', 'Listening (own loop, Malayalam)', 'per_minute', 1.41, 'testing',
   'Approximate: Cloud Speech-to-Text v2 streaming, USD 0.016 per minute at INR 88/USD, before volume tiers')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
SELECT set_config('app.platform_admin', '', true);
