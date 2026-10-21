-- ---------------------------------------------------------------------------
-- Recruiter-grade screening (docs/superpowers/specs/2026-10-21-recruiter-grade-screening-design.md).
--
-- jobs.requirements          what HR says the role needs (salary budget, notice,
--                            work mode, must-haves, night shift, reply days);
--                            validated in the API; null = none set (no fit).
-- voice_sessions.fit         per call: each requirement met | not_met | unclear
--                            with evidence, flags, and overall meets_all | check |
--                            doesnt_meet. Null = no requirements or not scored.
-- organizations.auto_advance_meets_all
--                            move Meets-all candidates forward automatically
--                            (off by default). organizations stays RLS-exempt (A6).
-- ---------------------------------------------------------------------------

ALTER TABLE "jobs" ADD COLUMN "requirements" jsonb;
--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD COLUMN "fit" jsonb;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "auto_advance_meets_all" boolean NOT NULL DEFAULT false;
