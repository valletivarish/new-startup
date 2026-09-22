/**
 * PO Q3 — one-shot migrator: baked agent must-ask / knowledge → Job screening.
 *
 * Seeds rows with superuser (bypass RLS), then runs the same backfill used by
 * 0021 / scripts/backfill-job-screening.mjs.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  backfillJobScreeningFromAgents,
  sql,
  type Database,
} from '@platform/db';

import {
  createOrgWithOwner,
  superDatabase,
  type TestOrg,
} from './setup/fixtures.js';

function bakedConfig(mustAsk: readonly string[], knowledgeSourceIds: readonly string[] = []) {
  return {
    agentType: 'hiring',
    identity: {
      displayName: 'Legacy Screener',
      persona: '',
      languages: ['en-IN'],
      primaryLanguage: 'en-IN',
    },
    purpose: 'Screen candidates',
    conversation: {},
    capabilities: {},
    knowledge: knowledgeSourceIds.map((id) => ({
      knowledgeSourceId: id,
      label: 'JD',
    })),
    rules: [],
    guardrails: {},
    tools: [],
    escalation: {},
    followUp: {},
    evaluation: {
      enabled: mustAsk.length > 0,
      criteria: mustAsk.map((label, i) => ({
        id: `q${i + 1}`,
        label,
        required: true,
      })),
    },
  };
}

describe('backfill job screening from agents (PO Q3)', () => {
  let su: Database;
  let org: TestOrg;

  beforeAll(async () => {
    su = superDatabase();
    org = await createOrgWithOwner(su, 'q3-backfill');
  }, 60_000);

  afterAll(async () => {
    await su?.close();
  });

  it('empty Job + agent with mustAsk → Job screening filled; re-run is a no-op', async () => {
    const agentRows = await su.db.execute<{ id: string }>(sql`
      insert into agents (organization_id, name, purpose, type, status)
      values (
        ${org.organizationId},
        ${`Q3 Agent Empty Job ${Date.now()}`},
        'Screen',
        'hiring',
        'published'
      )
      returning id
    `);
    const agentId = agentRows[0]!.id;

    const versionRows = await su.db.execute<{ id: string }>(sql`
      insert into agent_versions
        (organization_id, agent_id, version, configuration, status, published_at)
      values (
        ${org.organizationId},
        ${agentId},
        1,
        ${JSON.stringify(bakedConfig(['Years of backend experience?', 'Notice period?']))}::jsonb,
        'published',
        now()
      )
      returning id
    `);
    await su.db.execute(sql`
      update agents
      set current_version_id = ${versionRows[0]!.id}
      where id = ${agentId}
    `);

    const jobRows = await su.db.execute<{ id: string }>(sql`
      insert into jobs
        (organization_id, title, description, status, agent_id, screening_questions)
      values (
        ${org.organizationId},
        'Backend Eng',
        '',
        'open',
        ${agentId},
        '[]'::jsonb
      )
      returning id
    `);
    const jobId = jobRows[0]!.id;

    const first = await backfillJobScreeningFromAgents(su.db);
    expect(first.jobsQuestionsFilled).toBeGreaterThanOrEqual(1);

    const after = await su.db.execute<{
      screening_questions: { id: string; label: string }[];
      screening_language: string;
    }>(sql`
      select screening_questions, screening_language
      from jobs
      where id = ${jobId}
    `);
    expect(after[0]?.screening_language).toBe('en');
    expect(after[0]?.screening_questions).toEqual([
      { id: 'q1', label: 'Years of backend experience?' },
      { id: 'q2', label: 'Notice period?' },
    ]);

    const second = await backfillJobScreeningFromAgents(su.db);
    expect(second.jobsQuestionsFilled).toBe(0);

    const again = await su.db.execute<{
      screening_questions: { id: string; label: string }[];
    }>(sql`
      select screening_questions from jobs where id = ${jobId}
    `);
    expect(again[0]?.screening_questions).toEqual([
      { id: 'q1', label: 'Years of backend experience?' },
      { id: 'q2', label: 'Notice period?' },
    ]);
  });

  it('Job already has questions → unchanged', async () => {
    const agentRows = await su.db.execute<{ id: string }>(sql`
      insert into agents (organization_id, name, purpose, type, status)
      values (
        ${org.organizationId},
        ${`Q3 Agent Filled Job ${Date.now()}`},
        'Screen',
        'hiring',
        'published'
      )
      returning id
    `);
    const agentId = agentRows[0]!.id;

    const versionRows = await su.db.execute<{ id: string }>(sql`
      insert into agent_versions
        (organization_id, agent_id, version, configuration, status, published_at)
      values (
        ${org.organizationId},
        ${agentId},
        1,
        ${JSON.stringify(bakedConfig(['Agent-only question that must not win']))}::jsonb,
        'published',
        now()
      )
      returning id
    `);
    await su.db.execute(sql`
      update agents
      set current_version_id = ${versionRows[0]!.id}
      where id = ${agentId}
    `);

    const existing = [{ id: 'job-q1', label: 'Job-owned question stays' }];
    const jobRows = await su.db.execute<{ id: string }>(sql`
      insert into jobs
        (organization_id, title, description, status, agent_id, screening_questions)
      values (
        ${org.organizationId},
        'Frontend Eng',
        '',
        'open',
        ${agentId},
        ${JSON.stringify(existing)}::jsonb
      )
      returning id
    `);
    const jobId = jobRows[0]!.id;

    await backfillJobScreeningFromAgents(su.db);

    const after = await su.db.execute<{
      screening_questions: { id: string; label: string }[];
    }>(sql`
      select screening_questions from jobs where id = ${jobId}
    `);
    expect(after[0]?.screening_questions).toEqual(existing);
  });

  it('links agent knowledge into job_knowledge_sources when Job has none', async () => {
    const sourceRows = await su.db.execute<{ id: string }>(sql`
      insert into knowledge_sources (organization_id, name, status)
      values (${org.organizationId}, ${`Q3 JD ${Date.now()}`}, 'active')
      returning id
    `);
    const sourceId = sourceRows[0]!.id;

    const agentRows = await su.db.execute<{ id: string }>(sql`
      insert into agents (organization_id, name, purpose, type, status)
      values (
        ${org.organizationId},
        ${`Q3 Agent Knowledge ${Date.now()}`},
        'Screen',
        'hiring',
        'published'
      )
      returning id
    `);
    const agentId = agentRows[0]!.id;

    const versionRows = await su.db.execute<{ id: string }>(sql`
      insert into agent_versions
        (organization_id, agent_id, version, configuration, status, published_at)
      values (
        ${org.organizationId},
        ${agentId},
        1,
        ${JSON.stringify(bakedConfig(['Only must-ask'], [sourceId]))}::jsonb,
        'published',
        now()
      )
      returning id
    `);
    await su.db.execute(sql`
      update agents
      set current_version_id = ${versionRows[0]!.id}
      where id = ${agentId}
    `);
    await su.db.execute(sql`
      insert into agent_knowledge_sources (organization_id, agent_id, source_id)
      values (${org.organizationId}, ${agentId}, ${sourceId})
    `);

    const jobRows = await su.db.execute<{ id: string }>(sql`
      insert into jobs
        (organization_id, title, description, status, agent_id, screening_questions)
      values (
        ${org.organizationId},
        'Role with JD on agent',
        '',
        'open',
        ${agentId},
        '[]'::jsonb
      )
      returning id
    `);
    const jobId = jobRows[0]!.id;

    const result = await backfillJobScreeningFromAgents(su.db);
    expect(result.knowledgeLinksCreated).toBeGreaterThanOrEqual(1);

    const links = await su.db.execute<{ source_id: string }>(sql`
      select source_id from job_knowledge_sources where job_id = ${jobId}
    `);
    expect(links.map((r) => r.source_id)).toEqual([sourceId]);

    // Re-run must not duplicate links.
    const again = await backfillJobScreeningFromAgents(su.db);
    expect(again.knowledgeLinksCreated).toBe(0);
    const links2 = await su.db.execute<{ n: string }>(sql`
      select count(*)::text as n from job_knowledge_sources where job_id = ${jobId}
    `);
    expect(links2[0]?.n).toBe('1');
  });
});
