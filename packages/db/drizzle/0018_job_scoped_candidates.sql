-- PO Task 1 / Architecture rule 18:
-- Candidates become Job-scoped (job_id required). Uniqueness (job_id, phone).
-- Migrate from job_candidates; duplicate candidate rows for multi-job links;
-- rempoint voice_sessions.candidate_id for those job links.
-- Orphans (no job_candidates row) are deleted — assumed safe for V1/dev data.
-- job_candidates is NOT dropped; left as a read-only archive (no new writes).
--
-- FORCE RLS is briefly dropped so platform_migrator (owner, no BYPASSRLS)
-- can see and rewrite all tenant rows during this one-shot backfill.

ALTER TABLE "candidates" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "job_candidates" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "voice_sessions" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "candidates"
  ADD COLUMN "job_id" uuid,
  ADD COLUMN "country_code" text,
  ADD COLUMN "screening_status" text DEFAULT 'new' NOT NULL;
--> statement-breakpoint
ALTER TABLE "candidates"
  ADD CONSTRAINT "candidates_screening_status_check"
  CHECK ("screening_status" IN ('new', 'screening', 'reviewed'));
--> statement-breakpoint
ALTER TABLE "candidates"
  ADD CONSTRAINT "candidates_job_fk"
  FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE CASCADE;
--> statement-breakpoint
DO $$
DECLARE
  r RECORD;
  new_id uuid;
  orphan_count integer;
BEGIN
  -- Walk every job_candidates link ordered per candidate.
  -- rn=1 keeps the original candidate row; rn>1 inserts a Job-scoped duplicate
  -- and rempoints voice_sessions for that (job_id, old candidate_id) pair.
  FOR r IN
    SELECT
      c.id AS candidate_id,
      c.organization_id,
      c.full_name,
      c.phone,
      c.email,
      c.resume_text,
      c.source,
      c.created_at,
      c.updated_at,
      jc.job_id,
      jc.status AS jc_status,
      ROW_NUMBER() OVER (PARTITION BY c.id ORDER BY jc.id) AS rn
    FROM candidates c
    INNER JOIN job_candidates jc ON jc.candidate_id = c.id
  LOOP
    IF r.rn = 1 THEN
      UPDATE candidates
      SET
        job_id = r.job_id,
        screening_status = r.jc_status,
        country_code = COALESCE(country_code, '+91')
      WHERE id = r.candidate_id;
    ELSE
      INSERT INTO candidates (
        organization_id,
        full_name,
        phone,
        email,
        resume_text,
        source,
        created_at,
        updated_at,
        job_id,
        country_code,
        screening_status
      )
      VALUES (
        r.organization_id,
        r.full_name,
        r.phone,
        r.email,
        r.resume_text,
        r.source,
        r.created_at,
        r.updated_at,
        r.job_id,
        '+91',
        r.jc_status
      )
      RETURNING id INTO new_id;

      UPDATE voice_sessions
      SET candidate_id = new_id
      WHERE candidate_id = r.candidate_id
        AND job_id = r.job_id;
    END IF;
  END LOOP;

  -- Architecture rule 18: delete orphan candidates with no job link.
  -- These are unassigned directory rows from the pre-Job-scoped model (dev data).
  SELECT COUNT(*)::integer INTO orphan_count
  FROM candidates
  WHERE job_id IS NULL;

  IF orphan_count > 0 THEN
    RAISE NOTICE
      '0018_job_scoped_candidates: deleting % orphan candidate(s) with no job_candidates link',
      orphan_count;
    DELETE FROM candidates WHERE job_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM candidates WHERE job_id IS NULL) THEN
    RAISE EXCEPTION
      '0018_job_scoped_candidates: candidates.job_id still NULL after migrate — refusing NOT NULL';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "candidates" ALTER COLUMN "job_id" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "candidates_job_phone_unique"
  ON "candidates" ("job_id", "phone")
  WHERE "phone" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "candidates_org_job_idx"
  ON "candidates" ("organization_id", "job_id");
--> statement-breakpoint
CREATE INDEX "candidates_org_job_created_idx"
  ON "candidates" ("organization_id", "job_id", "created_at");
--> statement-breakpoint
ALTER TABLE "candidates" FORCE ROW LEVEL SECURITY;
ALTER TABLE "job_candidates" FORCE ROW LEVEL SECURITY;
ALTER TABLE "voice_sessions" FORCE ROW LEVEL SECURITY;
