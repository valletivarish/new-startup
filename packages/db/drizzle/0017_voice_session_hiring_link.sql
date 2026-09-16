ALTER TABLE "voice_sessions"
  ADD COLUMN "job_id" uuid,
  ADD COLUMN "candidate_id" uuid;
--> statement-breakpoint
ALTER TABLE "voice_sessions"
  ADD CONSTRAINT "vs_job_fk"
  FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "voice_sessions"
  ADD CONSTRAINT "vs_candidate_fk"
  FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX "vs_org_job_candidate_idx"
  ON "voice_sessions" ("organization_id", "job_id", "candidate_id")
  WHERE "job_id" IS NOT NULL AND "candidate_id" IS NOT NULL;
