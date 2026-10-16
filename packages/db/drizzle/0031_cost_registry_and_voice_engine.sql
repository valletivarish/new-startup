-- ---------------------------------------------------------------------------
-- Cost registry, voice engine arms, and platform-admin cost reporting.
--
-- cost_services   platform-level price list (no organization): which outside
--                 services we use, for what, and what they cost. Readable by
--                 the app (call pricing); writable only in platform-admin
--                 context (app.platform_admin = 'on', set by the API after it
--                 checks PLATFORM_ADMIN_EMAILS).
-- call_cost_ledger  gains the engine arm, response-time metrics and the
--                 tester's quality rating, plus a SELECT-only policy for
--                 platform admins (cross-company cost dashboard).
-- jobs / voice_sessions  gain voice_engine / engine: which arm runs the call.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT coalesce(current_setting('app.platform_admin', true), '') = 'on';
$$;
--> statement-breakpoint
ALTER FUNCTION is_platform_admin() OWNER TO platform_migrator;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION is_platform_admin() TO platform_app;
--> statement-breakpoint

CREATE TABLE "cost_services" (
  "key" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "vendor" text NOT NULL,
  "used_for" text NOT NULL,
  "billing" text NOT NULL
    CHECK ("billing" IN ('per_minute', 'per_1k_chars', 'per_1m_tokens_in',
                         'per_1m_tokens_out', 'per_credit', 'monthly_fixed')),
  "rate_inr" numeric(14, 6) NOT NULL DEFAULT 0 CHECK ("rate_inr" >= 0),
  "status" text NOT NULL DEFAULT 'in_use'
    CHECK ("status" IN ('in_use', 'testing', 'off')),
  "notes" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Starting rates (INR, ex-GST). Estimates until replaced from real invoices
-- in the admin dashboard.
INSERT INTO "cost_services" ("key", "name", "vendor", "used_for", "billing", "rate_inr", "status", "notes") VALUES
  ('exotel_minute',        'Exotel calls',              'Exotel',     'Phone line for every call',                      'per_minute',        0.75,     'in_use',  'Measured from Exotel trial calls; replaced by Exotel''s billed price per call'),
  ('deepgram_stt',         'Deepgram Nova-3',           'Deepgram',   'Listening (own loop)',                           'per_minute',        0.68,     'testing', 'Streaming STT, billed per audio minute'),
  ('gemini_input',         'Gemini 2.5 Flash-Lite in',  'Google',     'Thinking, answers, JD assist (input tokens)',    'per_1m_tokens_in',  8.80,     'in_use',  'Vertex AI'),
  ('gemini_output',        'Gemini 2.5 Flash-Lite out', 'Google',     'Thinking, answers, JD assist (output tokens)',   'per_1m_tokens_out', 35.20,    'in_use',  'Vertex AI'),
  ('elevenlabs_tts',       'ElevenLabs Flash voice',    'ElevenLabs', 'Speaking (own loop, arm 2)',                     'per_1k_chars',      4.40,     'testing', 'Characters synthesised'),
  ('sarvam_tts',           'Sarvam Bulbul v3 voice',    'Sarvam',     'Speaking (own loop, arm 3)',                     'per_1k_chars',      1.50,     'testing', 'Characters synthesised'),
  ('elevenlabs_agent',     'ElevenLabs agent',          'ElevenLabs', 'Whole conversation (baseline arm)',              'per_credit',        0.0185,   'in_use',  'Creator plan ~INR 1,850 / 100k credits'),
  ('gcp_vm',               'GCP VM e2-medium',          'Google',     'API, worker, voice loop, database',              'monthly_fixed',     2600,     'in_use',  'Paid from free-trial credit until Nov 2026'),
  ('vercel',               'Vercel',                    'Vercel',     'Website and HR app hosting',                     'monthly_fixed',     0,        'in_use',  'Hobby plan'),
  ('elevenlabs_plan',      'ElevenLabs Creator plan',   'ElevenLabs', 'Subscription behind agent + voice credits',      'monthly_fixed',     1850,     'in_use',  'Cancels 2026-10-15 unless renewed'),
  ('exotel_plan',          'Exotel plan',               'Exotel',     'India number and account rental',                'monthly_fixed',     0,        'in_use',  'Set from the Exotel invoice');
--> statement-breakpoint

ALTER TABLE "cost_services" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "cost_services" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Rates are not tenant data: any request may read them to price a call.
CREATE POLICY "cost_services_read" ON "cost_services" FOR SELECT USING (true);
--> statement-breakpoint
CREATE POLICY "cost_services_admin_write" ON "cost_services" FOR UPDATE
  USING (is_platform_admin()) WITH CHECK (is_platform_admin());
--> statement-breakpoint
CREATE POLICY "cost_services_admin_insert" ON "cost_services" FOR INSERT
  WITH CHECK (is_platform_admin());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "cost_services" TO platform_app;
--> statement-breakpoint

ALTER TABLE "call_cost_ledger"
  ADD COLUMN "engine" text,
  ADD COLUMN "response_p50_ms" integer,
  ADD COLUMN "response_p90_ms" integer,
  ADD COLUMN "interruptions" integer,
  ADD COLUMN "quality_rating" smallint CHECK ("quality_rating" BETWEEN 1 AND 5),
  ADD COLUMN "quality_note" text,
  ADD COLUMN "telephony_billed" boolean NOT NULL DEFAULT false,
  ADD COLUMN "agent_cost" numeric(14, 4);
--> statement-breakpoint
CREATE POLICY "ccl_platform_admin_read" ON "call_cost_ledger" FOR SELECT
  USING (is_platform_admin());
--> statement-breakpoint
-- Platform admins record the tester's quality rating on any call.
CREATE POLICY "ccl_platform_admin_rate" ON "call_cost_ledger" FOR UPDATE
  USING (is_platform_admin()) WITH CHECK (is_platform_admin());
--> statement-breakpoint

ALTER TABLE "jobs"
  ADD COLUMN "voice_engine" text NOT NULL DEFAULT 'elevenlabs_agent'
    CHECK ("voice_engine" IN ('elevenlabs_agent', 'own_loop_elevenlabs_voice', 'own_loop_sarvam_voice'));
--> statement-breakpoint
ALTER TABLE "voice_sessions"
  ADD COLUMN "engine" text NOT NULL DEFAULT 'elevenlabs_agent'
    CHECK ("engine" IN ('elevenlabs_agent', 'own_loop_elevenlabs_voice', 'own_loop_sarvam_voice'));
--> statement-breakpoint
-- Own-loop calls have no ElevenLabs deployment.
ALTER TABLE "voice_sessions" ALTER COLUMN "deployment_id" DROP NOT NULL;
--> statement-breakpoint
-- Own loop: a provider error mid-call is its own failure reason.
ALTER TABLE "voice_sessions" DROP CONSTRAINT "voice_sessions_failure_reason_check";
--> statement-breakpoint
ALTER TABLE "voice_sessions"
  ADD CONSTRAINT "voice_sessions_failure_reason_check"
  CHECK ("failure_reason" IS NULL OR "failure_reason" IN (
    'no_answer', 'busy', 'voicemail', 'line_not_connected',
    'invalid_number', 'carrier_blocked', 'network', 'unknown', 'engine_error'
  ));
