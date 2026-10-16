-- ---------------------------------------------------------------------------
-- Closing pipeline stage: `declined` ("Not moving forward" in the desk UI).
--
-- The live stage column is candidates.screening_status (0018, job-scoped
-- candidates). job_candidates is the read-only archive from 0015; its check is
-- widened too so the two can never disagree about the allowed set.
-- Existing values are untouched; only the allowed set grows.
-- ---------------------------------------------------------------------------

ALTER TABLE "candidates" DROP CONSTRAINT "candidates_screening_status_check";
--> statement-breakpoint
ALTER TABLE "candidates"
  ADD CONSTRAINT "candidates_screening_status_check"
  CHECK ("screening_status" IN ('new', 'screening', 'reviewed', 'declined'));
--> statement-breakpoint
ALTER TABLE "job_candidates" DROP CONSTRAINT "job_candidates_status_check";
--> statement-breakpoint
ALTER TABLE "job_candidates"
  ADD CONSTRAINT "job_candidates_status_check"
  CHECK ("status" IN ('new', 'screening', 'reviewed', 'declined'));
