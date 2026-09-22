-- PO Task 2: Job owns screening questions, language, and role knowledge.
-- Agent stays reusable; call/provision resolves Job → JD + must-ask + linked agent.

ALTER TABLE "jobs"
  ADD COLUMN "screening_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN "screening_language" text DEFAULT 'en' NOT NULL;
--> statement-breakpoint
ALTER TABLE "jobs"
  ADD CONSTRAINT "jobs_screening_language_check"
  CHECK ("screening_language" IN ('en', 'hi'));
--> statement-breakpoint

CREATE TABLE "job_knowledge_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "job_id" uuid NOT NULL,
  "source_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_knowledge_sources"
  ADD CONSTRAINT "job_knowledge_sources_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "job_knowledge_sources"
  ADD CONSTRAINT "job_knowledge_sources_job_id_jobs_id_fk"
  FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "job_knowledge_sources"
  ADD CONSTRAINT "job_knowledge_sources_source_id_knowledge_sources_id_fk"
  FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_sources"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "job_knowledge_sources_unique"
  ON "job_knowledge_sources" USING btree ("job_id", "source_id");
--> statement-breakpoint
CREATE INDEX "job_knowledge_sources_org_idx"
  ON "job_knowledge_sources" USING btree ("organization_id");
--> statement-breakpoint

ALTER TABLE "job_knowledge_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_knowledge_sources" FORCE ROW LEVEL SECURITY;
CREATE POLICY "job_knowledge_sources_tenant_isolation" ON "job_knowledge_sources"
  FOR ALL
  USING ("organization_id" = current_org_id())
  WITH CHECK ("organization_id" = current_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "job_knowledge_sources" TO platform_app;
