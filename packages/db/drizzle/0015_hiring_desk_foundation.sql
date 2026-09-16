CREATE TABLE "jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "title" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL CHECK ("status" IN ('draft', 'open', 'closed')),
  "agent_id" uuid,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "full_name" text NOT NULL,
  "phone" text,
  "email" text,
  "resume_text" text,
  "source" text DEFAULT 'manual' NOT NULL CHECK ("source" IN ('manual', 'resume')),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_candidates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "job_id" uuid NOT NULL,
  "candidate_id" uuid NOT NULL,
  "status" text DEFAULT 'new' NOT NULL CHECK ("status" IN ('new', 'screening', 'reviewed'))
);
--> statement-breakpoint
ALTER TABLE "jobs"
  ADD CONSTRAINT "jobs_org_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "jobs"
  ADD CONSTRAINT "jobs_agent_fk"
  FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "jobs"
  ADD CONSTRAINT "jobs_created_by_fk"
  FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "candidates"
  ADD CONSTRAINT "candidates_org_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "job_candidates"
  ADD CONSTRAINT "job_candidates_org_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "job_candidates"
  ADD CONSTRAINT "job_candidates_job_fk"
  FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "job_candidates"
  ADD CONSTRAINT "job_candidates_candidate_fk"
  FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX "jobs_org_status_idx" ON "jobs" ("organization_id", "status");
--> statement-breakpoint
CREATE INDEX "jobs_org_created_idx" ON "jobs" ("organization_id", "created_at");
--> statement-breakpoint
CREATE INDEX "candidates_org_created_idx" ON "candidates" ("organization_id", "created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "job_candidates_job_candidate_unique" ON "job_candidates" ("job_id", "candidate_id");
--> statement-breakpoint
CREATE INDEX "job_candidates_org_job_idx" ON "job_candidates" ("organization_id", "job_id");
--> statement-breakpoint
CREATE INDEX "job_candidates_org_status_idx" ON "job_candidates" ("organization_id", "status");
