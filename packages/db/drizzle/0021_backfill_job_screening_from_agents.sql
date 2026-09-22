-- PO Q3: One-shot migrator — copy baked agent must-ask / JD knowledge onto
-- Jobs that still lack Job-owned screening so HR never needs agent-side JD.
--
-- Idempotent:
--   * Never overwrites non-empty jobs.screening_questions
--   * Only inserts job_knowledge_sources when the job has zero links
--     (link existing sources — do not duplicate document blobs)
--
-- FORCE RLS is briefly dropped so platform_migrator (owner, no BYPASSRLS)
-- can see every tenant — same pattern as 0002/0008 seed migrations.
-- Re-runnable via: node scripts/backfill-job-screening.mjs
-- (or pnpm --filter @platform/db backfill:job-screening)

ALTER TABLE "jobs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "job_knowledge_sources" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "agents" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "agent_versions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "agent_knowledge_sources" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_sources" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

WITH agent_cfg AS (
  SELECT
    a.id AS agent_id,
    a.organization_id,
    COALESCE(cv.configuration, lv.configuration) AS configuration
  FROM agents a
  LEFT JOIN agent_versions cv ON cv.id = a.current_version_id
  LEFT JOIN LATERAL (
    SELECT av.configuration
    FROM agent_versions av
    WHERE av.agent_id = a.id
    ORDER BY av.version DESC
    LIMIT 1
  ) lv ON true
),
agent_questions AS (
  SELECT
    agent_id,
    organization_id,
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id',
            COALESCE(
              NULLIF(TRIM(c->>'id'), ''),
              'q' || (ordinality::text)
            ),
            'label',
            TRIM(c->>'label')
          )
          ORDER BY ordinality
        )
        FROM jsonb_array_elements(
          COALESCE(configuration->'evaluation'->'criteria', '[]'::jsonb)
        ) WITH ORDINALITY AS t(c, ordinality)
        WHERE NULLIF(TRIM(c->>'label'), '') IS NOT NULL
      ),
      '[]'::jsonb
    ) AS questions,
    CASE
      WHEN lower(COALESCE(configuration->'identity'->>'primaryLanguage', ''))
        LIKE 'hi%'
      THEN 'hi'
      ELSE 'en'
    END AS screening_language
  FROM agent_cfg
  WHERE configuration IS NOT NULL
)
UPDATE jobs j
SET
  screening_questions = aq.questions,
  screening_language = aq.screening_language,
  updated_at = now()
FROM agent_questions aq
WHERE j.agent_id = aq.agent_id
  AND j.organization_id = aq.organization_id
  AND jsonb_typeof(j.screening_questions) = 'array'
  AND jsonb_array_length(j.screening_questions) = 0
  AND jsonb_array_length(aq.questions) > 0;
--> statement-breakpoint

WITH agent_cfg AS (
  SELECT
    a.id AS agent_id,
    a.organization_id,
    COALESCE(cv.configuration, lv.configuration) AS configuration
  FROM agents a
  LEFT JOIN agent_versions cv ON cv.id = a.current_version_id
  LEFT JOIN LATERAL (
    SELECT av.configuration
    FROM agent_versions av
    WHERE av.agent_id = a.id
    ORDER BY av.version DESC
    LIMIT 1
  ) lv ON true
),
agent_sources AS (
  SELECT DISTINCT agent_id, organization_id, source_id
  FROM (
    SELECT
      aks.agent_id,
      aks.organization_id,
      aks.source_id
    FROM agent_knowledge_sources aks
    JOIN knowledge_sources ks
      ON ks.id = aks.source_id
     AND ks.organization_id = aks.organization_id
    WHERE ks.status <> 'archived'

    UNION

    SELECT
      ac.agent_id,
      ac.organization_id,
      (k->>'knowledgeSourceId')::uuid AS source_id
    FROM agent_cfg ac
    CROSS JOIN LATERAL jsonb_array_elements(
      COALESCE(ac.configuration->'knowledge', '[]'::jsonb)
    ) AS k
    JOIN knowledge_sources ks
      ON ks.id = (k->>'knowledgeSourceId')::uuid
     AND ks.organization_id = ac.organization_id
    WHERE NULLIF(k->>'knowledgeSourceId', '') IS NOT NULL
      AND ks.status <> 'archived'
  ) s
),
eligible_jobs AS (
  SELECT j.id AS job_id, j.organization_id, j.agent_id
  FROM jobs j
  WHERE j.agent_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM job_knowledge_sources jks
      WHERE jks.job_id = j.id
    )
)
INSERT INTO job_knowledge_sources (organization_id, job_id, source_id)
SELECT ej.organization_id, ej.job_id, asrc.source_id
FROM eligible_jobs ej
JOIN agent_sources asrc
  ON asrc.agent_id = ej.agent_id
 AND asrc.organization_id = ej.organization_id
ON CONFLICT DO NOTHING;
--> statement-breakpoint

ALTER TABLE "jobs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "job_knowledge_sources" FORCE ROW LEVEL SECURITY;
ALTER TABLE "agents" FORCE ROW LEVEL SECURITY;
ALTER TABLE "agent_versions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "agent_knowledge_sources" FORCE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_sources" FORCE ROW LEVEL SECURITY;
