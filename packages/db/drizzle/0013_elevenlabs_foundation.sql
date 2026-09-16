-- ---------------------------------------------------------------------------
-- MVP-01 ElevenLabs browser-voice foundation tables.
--
-- Two tables, both organization-scoped:
--
--   voice_provider_deployments   Maps a published AgentVersion to an
--                                externally-managed ElevenLabs agent + KB
--                                document. One row per (version, provider,
--                                environment). Re-provisioning is idempotent
--                                via upsert.
--
--   voice_sessions               Maps a local AgentSession to a provider
--                                conversation. Stores the WebRTC token
--                                (server-side only), conversation ID, and all
--                                result fields — transcript, summary,
--                                structured answers, duration, cost.
-- ---------------------------------------------------------------------------

CREATE TABLE "voice_provider_deployments" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id"     uuid NOT NULL,
  "agent_version_id"    uuid NOT NULL,
  "provider"            text NOT NULL DEFAULT 'elevenlabs',
  "environment"         text NOT NULL DEFAULT 'test',
  "external_agent_id"   text NOT NULL,
  "external_kb_doc_id"  text,
  "llm_model"           text,
  "llm_verified_at"     timestamp with time zone,
  "created_at"          timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"          timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voice_sessions" (
  "id"                       uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id"          uuid NOT NULL,
  "session_id"               uuid NOT NULL,
  "deployment_id"            uuid NOT NULL,
  "provider"                 text NOT NULL DEFAULT 'elevenlabs',
  "external_conversation_id" text,
  "status"                   text NOT NULL DEFAULT 'pending',
  "transcript"               jsonb,
  "summary"                  text,
  "structured_answers"       jsonb,
  "duration_seconds"         integer,
  "cost_credits"             numeric(12, 6),
  "started_at"               timestamp with time zone DEFAULT now() NOT NULL,
  "ended_at"                 timestamp with time zone,
  "webhook_received_at"      timestamp with time zone,
  "created_at"               timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "voice_provider_deployments"
  ADD CONSTRAINT "vpd_org_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "voice_provider_deployments"
  ADD CONSTRAINT "vpd_agent_version_fk"
  FOREIGN KEY ("agent_version_id") REFERENCES "public"."agent_versions"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "voice_sessions"
  ADD CONSTRAINT "vs_org_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "voice_sessions"
  ADD CONSTRAINT "vs_session_fk"
  FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "voice_sessions"
  ADD CONSTRAINT "vs_deployment_fk"
  FOREIGN KEY ("deployment_id") REFERENCES "public"."voice_provider_deployments"("id") ON DELETE RESTRICT;
--> statement-breakpoint
-- One deployment per (version, provider, environment).
CREATE UNIQUE INDEX "vpd_version_provider_env_unique"
  ON "voice_provider_deployments" ("agent_version_id", "provider", "environment");
--> statement-breakpoint
CREATE INDEX "vpd_org_agent_version_idx"
  ON "voice_provider_deployments" ("organization_id", "agent_version_id");
--> statement-breakpoint
-- One voice_session per agent_session (for now; one session = one voice test).
CREATE UNIQUE INDEX "vs_session_unique"
  ON "voice_sessions" ("session_id");
--> statement-breakpoint
CREATE INDEX "vs_org_status_idx"
  ON "voice_sessions" ("organization_id", "status");
--> statement-breakpoint
CREATE INDEX "vs_org_started_idx"
  ON "voice_sessions" ("organization_id", "started_at");
--> statement-breakpoint
CREATE INDEX "vs_external_conv_idx"
  ON "voice_sessions" ("external_conversation_id")
  WHERE "external_conversation_id" IS NOT NULL;
