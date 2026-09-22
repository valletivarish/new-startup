/**
 * PO Q3 — one-shot migrator: copy baked agent must-ask / JD knowledge onto
 * Jobs that still lack Job-owned screening.
 *
 * Idempotent:
 *   - Never overwrites non-empty jobs.screening_questions
 *   - Only links agent knowledge into job_knowledge_sources when the job
 *     has zero links (no blob duplication — link table only)
 *
 * FORCE RLS is briefly dropped so the migrator (table owner, no BYPASSRLS)
 * can see every tenant — same pattern as seed migrations (0002 / 0008).
 */

import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

export type BackfillJobScreeningResult = {
  readonly jobsQuestionsFilled: number;
  readonly knowledgeLinksCreated: number;
};

const FORCE_TABLES = [
  'jobs',
  'job_knowledge_sources',
  'agents',
  'agent_versions',
  'agent_knowledge_sources',
  'knowledge_sources',
] as const;

async function setForceRls(
  db: PostgresJsDatabase<Record<string, never>>,
  force: boolean,
): Promise<void> {
  const verb = force ? 'FORCE' : 'NO FORCE';
  for (const table of FORCE_TABLES) {
    await db.execute(
      sql.raw(`ALTER TABLE "${table}" ${verb} ROW LEVEL SECURITY`),
    );
  }
}

/**
 * Core DML — safe to re-run. Caller must already have visibility across
 * tenants (FORCE temporarily off, or superuser).
 */
export async function runBackfillJobScreeningDml(
  db: PostgresJsDatabase<Record<string, never>>,
): Promise<BackfillJobScreeningResult> {
  const questionRows = await db.execute<{ id: string }>(sql`
    with agent_cfg as (
      select
        a.id as agent_id,
        a.organization_id,
        coalesce(cv.configuration, lv.configuration) as configuration
      from agents a
      left join agent_versions cv on cv.id = a.current_version_id
      left join lateral (
        select av.configuration
        from agent_versions av
        where av.agent_id = a.id
        order by av.version desc
        limit 1
      ) lv on true
    ),
    agent_questions as (
      select
        agent_id,
        organization_id,
        coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'id',
                coalesce(
                  nullif(trim(c->>'id'), ''),
                  'q' || (ordinality::text)
                ),
                'label',
                trim(c->>'label')
              )
              order by ordinality
            )
            from jsonb_array_elements(
              coalesce(configuration->'evaluation'->'criteria', '[]'::jsonb)
            ) with ordinality as t(c, ordinality)
            where nullif(trim(c->>'label'), '') is not null
          ),
          '[]'::jsonb
        ) as questions,
        case
          when lower(coalesce(configuration->'identity'->>'primaryLanguage', ''))
            like 'hi%'
          then 'hi'
          else 'en'
        end as screening_language
      from agent_cfg
      where configuration is not null
    )
    update jobs j
    set
      screening_questions = aq.questions,
      screening_language = aq.screening_language,
      updated_at = now()
    from agent_questions aq
    where j.agent_id = aq.agent_id
      and j.organization_id = aq.organization_id
      and jsonb_typeof(j.screening_questions) = 'array'
      and jsonb_array_length(j.screening_questions) = 0
      and jsonb_array_length(aq.questions) > 0
    returning j.id
  `);

  const knowledgeRows = await db.execute<{ id: string }>(sql`
    with agent_cfg as (
      select
        a.id as agent_id,
        a.organization_id,
        coalesce(cv.configuration, lv.configuration) as configuration
      from agents a
      left join agent_versions cv on cv.id = a.current_version_id
      left join lateral (
        select av.configuration
        from agent_versions av
        where av.agent_id = a.id
        order by av.version desc
        limit 1
      ) lv on true
    ),
    agent_sources as (
      select distinct agent_id, organization_id, source_id
      from (
        select
          aks.agent_id,
          aks.organization_id,
          aks.source_id
        from agent_knowledge_sources aks
        join knowledge_sources ks
          on ks.id = aks.source_id
         and ks.organization_id = aks.organization_id
        where ks.status <> 'archived'

        union

        select
          ac.agent_id,
          ac.organization_id,
          (k->>'knowledgeSourceId')::uuid as source_id
        from agent_cfg ac
        cross join lateral jsonb_array_elements(
          coalesce(ac.configuration->'knowledge', '[]'::jsonb)
        ) as k
        join knowledge_sources ks
          on ks.id = (k->>'knowledgeSourceId')::uuid
         and ks.organization_id = ac.organization_id
        where nullif(k->>'knowledgeSourceId', '') is not null
          and ks.status <> 'archived'
      ) s
    ),
    eligible_jobs as (
      select j.id as job_id, j.organization_id, j.agent_id
      from jobs j
      where j.agent_id is not null
        and not exists (
          select 1
          from job_knowledge_sources jks
          where jks.job_id = j.id
        )
    )
    insert into job_knowledge_sources (organization_id, job_id, source_id)
    select ej.organization_id, ej.job_id, asrc.source_id
    from eligible_jobs ej
    join agent_sources asrc
      on asrc.agent_id = ej.agent_id
     and asrc.organization_id = ej.organization_id
    on conflict do nothing
    returning id
  `);

  return {
    jobsQuestionsFilled: questionRows.length,
    knowledgeLinksCreated: knowledgeRows.length,
  };
}

/**
 * Full one-shot / re-runnable migrator for deploy scripts and tests.
 */
export async function backfillJobScreeningFromAgents(
  db: PostgresJsDatabase<Record<string, never>>,
): Promise<BackfillJobScreeningResult> {
  await setForceRls(db, false);
  try {
    return await runBackfillJobScreeningDml(db);
  } finally {
    await setForceRls(db, true);
  }
}
