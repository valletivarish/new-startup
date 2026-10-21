-- ---------------------------------------------------------------------------
-- Google Chirp 3 HD becomes the voice of our own loop (docs/voice-selection.md).
--
-- jobs.voice_engine / voice_sessions.engine  gain own_loop_google_voice; it is
--                 the default for new jobs (existing rows keep their engine).
-- jobs.voice_persona  which Chirp 3 HD voice speaks: kore (female, default) or
--                 iapetus (male). Voice id = <lang>-IN-Chirp3-HD-<Persona>.
-- jobs.tts_model  gemini_flash (default while testing: Gemini 2.5 Flash TTS, same
--                 personas; bn/ur and any error fall back to Chirp) or chirp3_hd
--                 (fast, every language).
-- jobs.screening_language  the 11 India launch languages (was en | hi).
-- cost_services   google_tts and gemini_flash_tts priced; ElevenLabs rows off (subscription ended).
-- ---------------------------------------------------------------------------

ALTER TABLE "jobs" DROP CONSTRAINT "jobs_voice_engine_check";
--> statement-breakpoint
ALTER TABLE "jobs"
  ADD CONSTRAINT "jobs_voice_engine_check"
  CHECK ("voice_engine" IN ('elevenlabs_agent', 'own_loop_elevenlabs_voice', 'own_loop_sarvam_voice', 'own_loop_google_voice'));
--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "voice_engine" SET DEFAULT 'own_loop_google_voice';
--> statement-breakpoint
ALTER TABLE "voice_sessions" DROP CONSTRAINT "voice_sessions_engine_check";
--> statement-breakpoint
ALTER TABLE "voice_sessions"
  ADD CONSTRAINT "voice_sessions_engine_check"
  CHECK ("engine" IN ('elevenlabs_agent', 'own_loop_elevenlabs_voice', 'own_loop_sarvam_voice', 'own_loop_google_voice'));
--> statement-breakpoint
ALTER TABLE "jobs"
  ADD COLUMN "voice_persona" text NOT NULL DEFAULT 'kore'
    CONSTRAINT "jobs_voice_persona_check" CHECK ("voice_persona" IN ('kore', 'iapetus'));
--> statement-breakpoint
ALTER TABLE "jobs"
  -- Gemini quota is 10 req/min on the trial; raise it before launch or switch the default to chirp3_hd.
  ADD COLUMN "tts_model" text NOT NULL DEFAULT 'gemini_flash'
    CONSTRAINT "jobs_tts_model_check" CHECK ("tts_model" IN ('chirp3_hd', 'gemini_flash'));
--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_screening_language_check";
--> statement-breakpoint
ALTER TABLE "jobs"
  ADD CONSTRAINT "jobs_screening_language_check"
  CHECK ("screening_language" IN ('en', 'hi', 'bn', 'mr', 'te', 'ta', 'gu', 'ur', 'kn', 'ml', 'pa'));
--> statement-breakpoint

-- cost_services has FORCE RLS: write the price rows as platform admin, this transaction only.
SELECT set_config('app.platform_admin', 'on', true);
--> statement-breakpoint
-- Chirp 3 HD: USD 30 per 1M characters at INR 88/USD = INR 2.64 per 1k characters.
INSERT INTO "cost_services" ("key", "name", "vendor", "used_for", "billing", "rate_inr", "status", "notes") VALUES
  ('google_tts', 'Google Chirp 3 HD voice', 'Google', 'Speaking (own loop, Kore / Iapetus)', 'per_1k_chars', 2.64, 'in_use',
   'Cloud Text-to-Speech streaming, USD 30 per 1M characters at INR 88/USD'),
  ('gemini_flash_tts', 'Gemini 2.5 Flash TTS voice', 'Google', 'Speaking (own loop, Kore / Iapetus, expressive)', 'per_1k_chars', 1.30, 'testing',
   'Approximate: Gemini 2.5 Flash TTS is billed per audio token; INR 1.30 per 1k characters is an estimate until the first invoice')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
UPDATE "cost_services" SET "status" = 'off', "updated_at" = now()
WHERE "key" IN ('elevenlabs_tts', 'elevenlabs_agent', 'elevenlabs_plan');
--> statement-breakpoint
SELECT set_config('app.platform_admin', '', true);
