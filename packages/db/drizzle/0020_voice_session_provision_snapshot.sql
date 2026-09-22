-- PO Q2=B: Freeze full provision snapshot onto each VoiceSession at call start.
-- Historical fit/review/ask-AI must use this immutable job-specific config,
-- not live Job/Agent edits. Still one provider deployment per agent version
-- (not per Job).

ALTER TABLE "voice_sessions"
  ADD COLUMN "provision_snapshot" jsonb;
