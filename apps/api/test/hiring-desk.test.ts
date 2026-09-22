/**
 * P1 — Hiring desk: jobs CRUD and tenant isolation.
 *
 * Runs through the real HTTP surface against real PostgreSQL. Cross-org
 * access must return 404, never another tenant's data.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sql } from '@platform/db';

import { createStubVoiceSessionAdapter } from '../src/providers/elevenlabs/adapter.js';
import {
  acceptInvitation,
  createOrganization,
  inviteAndCaptureToken,
  registerUser,
  startApi,
  type ApiHarness,
  type TestActor,
} from './setup/api-harness.js';
import { superDatabase } from './setup/fixtures.js';

let api: ApiHarness;
let orgAOwner: TestActor;
let orgBOwner: TestActor;


async function createJobScopedCandidate(
  harness: ApiHarness,
  cookie: string,
  jobId: string,
  input: { fullName: string; phone?: string; email?: string; resumeText?: string; countryCode?: string },
) {
  return harness.request({
    method: 'POST',
    url: '/candidates',
    cookie,
    payload: {
      jobId,
      countryCode: input.countryCode ?? '+91',
      ...input,
    },
  });
}


beforeAll(async () => {
  api = await startApi();
  orgAOwner = await registerUser(api, 'jobs-a');
  orgBOwner = await registerUser(api, 'jobs-b');
  await createOrganization(api, orgAOwner, 'Jobs Org A');
  await createOrganization(api, orgBOwner, 'Jobs Org B');
}, 120_000);

afterAll(async () => {
  await api?.close();
});

describe('jobs CRUD', () => {
  let jobId: string;

  it('creates a job', async () => {
    const res = await api.request({
      method: 'POST',
      url: '/jobs',
      cookie: orgAOwner.cookie,
      payload: { title: 'Senior Engineer', description: 'Build things' },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { id: string };
    expect(body.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    jobId = body.id;
  });

  it('lists jobs within the organization', async () => {
    const res = await api.request({
      method: 'GET',
      url: '/jobs',
      cookie: orgAOwner.cookie,
    });
    expect(res.statusCode).toBe(200);
    const { jobs } = JSON.parse(res.body) as {
      jobs: { id: string; title: string; status: string }[];
    };
    expect(jobs.some((j) => j.id === jobId)).toBe(true);
    const job = jobs.find((j) => j.id === jobId);
    expect(job?.title).toBe('Senior Engineer');
    expect(job?.status).toBe('draft');
  });

  it('retrieves a job by id', async () => {
    const res = await api.request({
      method: 'GET',
      url: `/jobs/${jobId}`,
      cookie: orgAOwner.cookie,
    });
    expect(res.statusCode).toBe(200);
    const job = JSON.parse(res.body) as {
      id: string;
      title: string;
      description: string;
      status: string;
      screeningQuestions: { id: string; label: string }[];
      screeningLanguage: string;
    };
    expect(job.id).toBe(jobId);
    expect(job.title).toBe('Senior Engineer');
    expect(job.description).toBe('Build things');
    expect(job.status).toBe('draft');
    expect(job.screeningQuestions).toEqual([]);
    expect(job.screeningLanguage).toBe('en');
  });

  it('persists must-ask questions and language on the job', async () => {
    const res = await api.request({
      method: 'PATCH',
      url: `/jobs/${jobId}`,
      cookie: orgAOwner.cookie,
      payload: {
        mustAskQuestions: [
          'How many years of relevant experience?',
          'What is your notice period?',
        ],
        screeningLanguage: 'hi',
      },
    });
    expect(res.statusCode).toBe(200);

    const get = await api.request({
      method: 'GET',
      url: `/jobs/${jobId}`,
      cookie: orgAOwner.cookie,
    });
    const job = JSON.parse(get.body) as {
      screeningQuestions: { id: string; label: string }[];
      screeningLanguage: string;
    };
    expect(job.screeningLanguage).toBe('hi');
    expect(job.screeningQuestions).toEqual([
      { id: 'q1', label: 'How many years of relevant experience?' },
      { id: 'q2', label: 'What is your notice period?' },
    ]);
  });

  it('updates a job', async () => {
    const res = await api.request({
      method: 'PATCH',
      url: `/jobs/${jobId}`,
      cookie: orgAOwner.cookie,
      payload: { title: 'Staff Engineer', status: 'open' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { updated: boolean };
    expect(body.updated).toBe(true);

    const get = await api.request({
      method: 'GET',
      url: `/jobs/${jobId}`,
      cookie: orgAOwner.cookie,
    });
    const job = JSON.parse(get.body) as { title: string; status: string };
    expect(job.title).toBe('Staff Engineer');
    expect(job.status).toBe('open');
  });
});

describe('jobs tenant isolation', () => {
  let jobId: string;

  beforeAll(async () => {
    const res = await api.request({
      method: 'POST',
      url: '/jobs',
      cookie: orgAOwner.cookie,
      payload: { title: 'Isolated Role' },
    });
    jobId = (JSON.parse(res.body) as { id: string }).id;
  });

  it("org B cannot read org A's job", async () => {
    const res = await api.request({
      method: 'GET',
      url: `/jobs/${jobId}`,
      cookie: orgBOwner.cookie,
    });
    expect(res.statusCode).toBe(404);
  });

  it("org B cannot update org A's job", async () => {
    const res = await api.request({
      method: 'PATCH',
      url: `/jobs/${jobId}`,
      cookie: orgBOwner.cookie,
      payload: { title: 'stolen' },
    });
    expect(res.statusCode).toBe(404);

    const check = await api.request({
      method: 'GET',
      url: `/jobs/${jobId}`,
      cookie: orgAOwner.cookie,
    });
    const job = JSON.parse(check.body) as { title: string };
    expect(job.title).toBe('Isolated Role');
  });
});

describe('candidates CRUD', () => {
  let jobId: string;
  let candidateId: string;

  beforeAll(async () => {
    const jobRes = await api.request({
      method: 'POST',
      url: '/jobs',
      cookie: orgAOwner.cookie,
      payload: { title: 'Candidates CRUD Job' },
    });
    jobId = (JSON.parse(jobRes.body) as { id: string }).id;
  });

  it('creates a candidate with phone extracted from resume text', async () => {
    const res = await createJobScopedCandidate(api, orgAOwner.cookie, jobId, {
      fullName: 'Priya Sharma',
      resumeText: 'Reach me at +91 98765 43210 for interview scheduling.',
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as {
      id: string;
      phone: string | null;
      phoneFromResume: boolean;
    };
    expect(body.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(body.phone).toBe('+919876543210');
    expect(body.phoneFromResume).toBe(true);
    candidateId = body.id;

    const get = await api.request({
      method: 'GET',
      url: `/candidates/${candidateId}`,
      cookie: orgAOwner.cookie,
    });
    expect(get.statusCode).toBe(200);
    const candidate = JSON.parse(get.body) as {
      fullName: string;
      phone: string;
      source: string;
      jobId: string;
      countryCode: string | null;
    };
    expect(candidate.fullName).toBe('Priya Sharma');
    expect(candidate.phone).toBe('+919876543210');
    expect(candidate.source).toBe('resume');
    expect(candidate.jobId).toBe(jobId);
    expect(candidate.countryCode).toBe('+91');
  });

  it('lists candidates for a job', async () => {
    const res = await api.request({
      method: 'GET',
      url: `/candidates?jobId=${jobId}`,
      cookie: orgAOwner.cookie,
    });
    expect(res.statusCode).toBe(200);
    const { candidates } = JSON.parse(res.body) as {
      candidates: { id: string; fullName: string; source: string; jobId: string }[];
    };
    expect(candidates.some((c) => c.id === candidateId)).toBe(true);
    expect(candidates.every((c) => c.jobId === jobId)).toBe(true);
  });

  it('requires jobId when listing candidates', async () => {
    const res = await api.request({
      method: 'GET',
      url: '/candidates',
      cookie: orgAOwner.cookie,
    });
    expect(res.statusCode).toBe(422);
  });

  it('rejects create without phone when resume has none', async () => {
    const res = await createJobScopedCandidate(api, orgAOwner.cookie, jobId, {
      fullName: 'No Phone Person',
      resumeText: 'Experienced engineer. Email only: none@example.test',
    });
    expect(res.statusCode).toBe(422);
  });

  it('updates a candidate', async () => {
    const res = await api.request({
      method: 'PATCH',
      url: `/candidates/${candidateId}`,
      cookie: orgAOwner.cookie,
      payload: { fullName: 'Priya S.', email: 'priya@example.test' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { updated: boolean };
    expect(body.updated).toBe(true);

    const get = await api.request({
      method: 'GET',
      url: `/candidates/${candidateId}`,
      cookie: orgAOwner.cookie,
    });
    const candidate = JSON.parse(get.body) as {
      fullName: string;
      email: string;
    };
    expect(candidate.fullName).toBe('Priya S.');
    expect(candidate.email).toBe('priya@example.test');
  });

  it('exports candidate PII with audit permission', async () => {
    const res = await api.request({
      method: 'GET',
      url: `/candidates/${candidateId}/export`,
      cookie: orgAOwner.cookie,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      exportedAt: string;
      candidate: { id: string; fullName: string; email: string | null };
    };
    expect(body.candidate.id).toBe(candidateId);
    expect(body.candidate.fullName).toBe('Priya S.');
    expect(body.exportedAt).toMatch(/^\d{4}-/);
  });

  it('deletes a candidate', async () => {
    const create = await createJobScopedCandidate(api, orgAOwner.cookie, jobId, {
      fullName: 'Temp Delete Me',
      phone: '9000011111',
    });
    const id = (JSON.parse(create.body) as { id: string }).id;

    const del = await api.request({
      method: 'DELETE',
      url: `/candidates/${id}`,
      cookie: orgAOwner.cookie,
    });
    expect(del.statusCode).toBe(200);

    const missing = await api.request({
      method: 'GET',
      url: `/candidates/${id}`,
      cookie: orgAOwner.cookie,
    });
    expect(missing.statusCode).toBe(404);
  });
});

describe('candidates PII gating', () => {
  let jobId: string;
  let candidateId: string;
  let manager: TestActor;

  beforeAll(async () => {
    const jobRes = await api.request({
      method: 'POST',
      url: '/jobs',
      cookie: orgAOwner.cookie,
      payload: { title: 'PII Gating Job' },
    });
    jobId = (JSON.parse(jobRes.body) as { id: string }).id;

    const res = await createJobScopedCandidate(api, orgAOwner.cookie, jobId, {
      fullName: 'Hidden Contact',
      phone: '9876543210',
      email: 'hidden@example.test',
    });
    candidateId = (JSON.parse(res.body) as { id: string }).id;

    manager = await registerUser(api, 'cand-manager');
    const token = await inviteAndCaptureToken(
      api,
      orgAOwner,
      manager.email,
      'agent_manager',
    );
    const accepted = await acceptInvitation(api, manager, token);
    expect([200, 201]).toContain(accepted.statusCode);
  });

  it('omits phone and email without candidates.read_pii', async () => {
    const res = await api.request({
      method: 'GET',
      url: `/candidates?jobId=${jobId}`,
      cookie: manager.cookie,
    });
    expect(res.statusCode).toBe(200);
    const { candidates } = JSON.parse(res.body) as {
      candidates: {
        id: string;
        fullName: string;
        phone?: string;
        email?: string;
        resumeText?: string;
      }[];
    };
    const row = candidates.find((c) => c.id === candidateId);
    expect(row).toBeDefined();
    expect(row!.fullName).toBe('Hidden Contact');
    expect(row).not.toHaveProperty('phone');
    expect(row).not.toHaveProperty('email');
    expect(row).not.toHaveProperty('resumeText');
  });

  it('includes phone and email with candidates.read_pii', async () => {
    const res = await api.request({
      method: 'GET',
      url: `/candidates/${candidateId}`,
      cookie: orgAOwner.cookie,
    });
    expect(res.statusCode).toBe(200);
    const candidate = JSON.parse(res.body) as {
      phone: string;
      email: string;
    };
    expect(candidate.phone).toBe('9876543210');
    expect(candidate.email).toBe('hidden@example.test');
  });
});

describe('job-scoped candidates', () => {
  let jobId: string;
  let candidateId: string;

  beforeAll(async () => {
    const jobRes = await api.request({
      method: 'POST',
      url: '/jobs',
      cookie: orgAOwner.cookie,
      payload: { title: 'Scoped Role' },
    });
    jobId = (JSON.parse(jobRes.body) as { id: string }).id;

    const candRes = await createJobScopedCandidate(api, orgAOwner.cookie, jobId, {
      fullName: 'Assignee One',
      phone: '9988776655',
    });
    candidateId = (JSON.parse(candRes.body) as { id: string }).id;
  });

  it('lists job candidates with candidate summary', async () => {
    const res = await api.request({
      method: 'GET',
      url: `/jobs/${jobId}/candidates`,
      cookie: orgAOwner.cookie,
    });
    expect(res.statusCode).toBe(200);
    const { candidates } = JSON.parse(res.body) as {
      candidates: {
        id: string;
        candidateId: string;
        status: string;
        candidate: { id: string; fullName: string; source: string };
      }[];
    };
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    const row = candidates.find((c) => c.candidateId === candidateId);
    expect(row).toBeDefined();
    expect(row!.status).toBe('new');
    expect(row!.candidate.fullName).toBe('Assignee One');
    expect(row!.candidate.source).toBe('manual');
    expect(
      (row!.candidate as { phone?: string | null }).phone,
    ).toBe('9988776655');
    expect(row!.candidate).not.toHaveProperty('email');
  });

  it('updates screening_status on the candidate', async () => {
    const res = await api.request({
      method: 'PATCH',
      url: `/jobs/${jobId}/candidates/${candidateId}`,
      cookie: orgAOwner.cookie,
      payload: { status: 'screening' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { updated: boolean };
    expect(body.updated).toBe(true);

    const list = await api.request({
      method: 'GET',
      url: `/jobs/${jobId}/candidates`,
      cookie: orgAOwner.cookie,
    });
    const { candidates } = JSON.parse(list.body) as {
      candidates: { candidateId: string; status: string }[];
    };
    const row = candidates.find((c) => c.candidateId === candidateId);
    expect(row?.status).toBe('screening');
  });

  it('rejects legacy assign endpoint (no job_candidates writes)', async () => {
    const res = await api.request({
      method: 'POST',
      url: `/jobs/${jobId}/candidates`,
      cookie: orgAOwner.cookie,
      payload: { candidateId },
    });
    expect(res.statusCode).toBe(422);
  });

  it('returns 409 when creating duplicate phone on the same job', async () => {
    const res = await createJobScopedCandidate(api, orgAOwner.cookie, jobId, {
      fullName: 'Duplicate Phone',
      phone: '9988776655',
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('job candidate list permission', () => {
  let jobId: string;
  let viewer: TestActor;

  beforeAll(async () => {
    const jobRes = await api.request({
      method: 'POST',
      url: '/jobs',
      cookie: orgAOwner.cookie,
      payload: { title: 'Permission List Role' },
    });
    jobId = (JSON.parse(jobRes.body) as { id: string }).id;

    const candRes = await createJobScopedCandidate(api, orgAOwner.cookie, jobId, {
      fullName: 'Permission List Candidate',
      phone: '9111222333',
    });
    expect(candRes.statusCode).toBe(201);

    viewer = await registerUser(api, 'jc-viewer');
    const token = await inviteAndCaptureToken(
      api,
      orgAOwner,
      viewer.email,
      'viewer',
    );
    const accepted = await acceptInvitation(api, viewer, token);
    expect([200, 201]).toContain(accepted.statusCode);
  });

  it('returns 403 without candidates.read on GET list', async () => {
    const res = await api.request({
      method: 'GET',
      url: `/jobs/${jobId}/candidates`,
      cookie: viewer.cookie,
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('job candidate assign preconditions', () => {
  let jobId: string;
  const bogusId = '00000000-0000-4000-8000-000000000001';

  beforeAll(async () => {
    const jobRes = await api.request({
      method: 'POST',
      url: '/jobs',
      cookie: orgAOwner.cookie,
      payload: { title: 'Assign Preconditions Role' },
    });
    jobId = (JSON.parse(jobRes.body) as { id: string }).id;
  });

  it('returns 404 when job does not exist on legacy assign', async () => {
    const res = await api.request({
      method: 'POST',
      url: `/jobs/${bogusId}/candidates`,
      cookie: orgAOwner.cookie,
      payload: { candidateId: bogusId },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 422 for legacy assign on an existing job', async () => {
    const res = await api.request({
      method: 'POST',
      url: `/jobs/${jobId}/candidates`,
      cookie: orgAOwner.cookie,
      payload: { candidateId: bogusId },
    });
    expect(res.statusCode).toBe(422);
  });

  it('returns 404 when creating under another org job', async () => {
    const jobB = await api.request({
      method: 'POST',
      url: '/jobs',
      cookie: orgBOwner.cookie,
      payload: { title: 'Org B Job' },
    });
    const orgBJobId = (JSON.parse(jobB.body) as { id: string }).id;

    const res = await createJobScopedCandidate(api, orgAOwner.cookie, orgBJobId, {
      fullName: 'Cross Org Attempt',
      phone: '9333444555',
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('job candidate isolation', () => {
  let jobId: string;
  let candidateId: string;

  beforeAll(async () => {
    const jobRes = await api.request({
      method: 'POST',
      url: '/jobs',
      cookie: orgAOwner.cookie,
      payload: { title: 'Isolated Assignment Role' },
    });
    jobId = (JSON.parse(jobRes.body) as { id: string }).id;

    const candRes = await createJobScopedCandidate(api, orgAOwner.cookie, jobId, {
      fullName: 'Isolated Assignee',
      phone: '9444555666',
    });
    candidateId = (JSON.parse(candRes.body) as { id: string }).id;
    expect(candRes.statusCode).toBe(201);
  });

  it("org B cannot list org A's job candidates", async () => {
    const res = await api.request({
      method: 'GET',
      url: `/jobs/${jobId}/candidates`,
      cookie: orgBOwner.cookie,
    });
    expect(res.statusCode).toBe(404);
  });

  it("org B cannot use legacy assign on org A's job", async () => {
    const res = await api.request({
      method: 'POST',
      url: `/jobs/${jobId}/candidates`,
      cookie: orgBOwner.cookie,
      payload: { candidateId },
    });
    expect(res.statusCode).toBe(404);
  });

  it("org B cannot update org A's screening status", async () => {
    const res = await api.request({
      method: 'PATCH',
      url: `/jobs/${jobId}/candidates/${candidateId}`,
      cookie: orgBOwner.cookie,
      payload: { status: 'reviewed' },
    });
    expect(res.statusCode).toBe(404);

    const check = await api.request({
      method: 'GET',
      url: `/jobs/${jobId}/candidates`,
      cookie: orgAOwner.cookie,
    });
    const { candidates } = JSON.parse(check.body) as {
      candidates: { candidateId: string; status: string }[];
    };
    const row = candidates.find((c) => c.candidateId === candidateId);
    expect(row?.status).toBe('new');
  });
});

describe('candidates tenant isolation', () => {
  let jobId: string;
  let candidateId: string;

  beforeAll(async () => {
    const jobRes = await api.request({
      method: 'POST',
      url: '/jobs',
      cookie: orgAOwner.cookie,
      payload: { title: 'Tenant Isolation Cand Job' },
    });
    jobId = (JSON.parse(jobRes.body) as { id: string }).id;

    const res = await createJobScopedCandidate(api, orgAOwner.cookie, jobId, {
      fullName: 'Isolated Candidate',
      phone: '9123456789',
    });
    candidateId = (JSON.parse(res.body) as { id: string }).id;
  });

  it("org B cannot read org A's candidate", async () => {
    const res = await api.request({
      method: 'GET',
      url: `/candidates/${candidateId}`,
      cookie: orgBOwner.cookie,
    });
    expect(res.statusCode).toBe(404);
  });

  it("org B cannot update org A's candidate", async () => {
    const res = await api.request({
      method: 'PATCH',
      url: `/candidates/${candidateId}`,
      cookie: orgBOwner.cookie,
      payload: { fullName: 'stolen' },
    });
    expect(res.statusCode).toBe(404);

    const check = await api.request({
      method: 'GET',
      url: `/candidates/${candidateId}`,
      cookie: orgAOwner.cookie,
    });
    const candidate = JSON.parse(check.body) as { fullName: string };
    expect(candidate.fullName).toBe('Isolated Candidate');
  });
});

const VOICE_ENV: Record<string, string> = {
  ELEVENLABS_ENABLED: 'true',
  ELEVENLABS_API_KEY: 'test-key',
  ELEVENLABS_WEBHOOK_SECRET: 'test-webhook-secret-32-chars-xxxxx',
  ELEVENLABS_MAX_TEST_MINUTES: '5',
  ELEVENLABS_DAILY_TEST_SESSIONS: '10',
  ELEVENLABS_DAILY_TEST_MINUTES: '60',
};

describe('candidate screening results', () => {
  let voiceApi: ApiHarness;
  let jobId: string;
  let candidateId: string;
  let agentId: string;
  let cookie: string;

  beforeAll(async () => {
    voiceApi = await startApi(VOICE_ENV, createStubVoiceSessionAdapter());

    cookie = orgAOwner.cookie;

    const jobRes = await voiceApi.request({
      method: 'POST',
      url: '/jobs',
      cookie,
      payload: { title: 'Screening Role' },
    });
    jobId = (JSON.parse(jobRes.body) as { id: string }).id;

    const candRes = await createJobScopedCandidate(voiceApi, cookie, jobId, {
      fullName: 'Screened Candidate',
      phone: '9555666777',
    });
    expect(candRes.statusCode).toBe(201);
    candidateId = (JSON.parse(candRes.body) as { id: string }).id;

    const agentRes = await voiceApi.request({
      method: 'POST',
      url: '/agents',
      cookie,
      payload: {
        name: 'Screening Bot',
        purpose: 'Screen candidates',
        description: 'P1 hiring desk test',
      },
    });
    expect(agentRes.statusCode).toBe(201);
    const parsed = JSON.parse(agentRes.body) as { id: string; versionId: string };
    agentId = parsed.id;
    const pub = await voiceApi.request({
      method: 'POST',
      url: `/agents/${agentId}/versions/${parsed.versionId}/publish`,
      cookie,
      payload: {},
    });
    expect([200, 201]).toContain(pub.statusCode);
  }, 120_000);

  afterAll(async () => {
    await voiceApi?.close();
  });

  it('returns null-safe fields when no voice session is linked', async () => {
    const res = await voiceApi.request({
      method: 'GET',
      url: `/jobs/${jobId}/candidates/${candidateId}/results`,
      cookie,
    });
    expect(res.statusCode).toBe(200);
    const { results, sessions } = JSON.parse(res.body) as {
      results: {
        voiceSessionId: string | null;
        transcript: unknown;
        summary: string | null;
        structuredAnswers: unknown;
        costCredits: number | null;
        fitPercent: number | null;
      };
      sessions: unknown[];
    };
    expect(results.voiceSessionId).toBeNull();
    expect(results.transcript).toBeNull();
    expect(results.summary).toBeNull();
    expect(results.structuredAnswers).toBeNull();
    expect(results.costCredits).toBeNull();
    expect(results.fitPercent).toBeNull();
    expect(sessions).toEqual([]);
  });

  it('returns latest linked voice session result fields', async () => {
    const start = await voiceApi.request({
      method: 'POST',
      url: `/agents/${agentId}/voice-sessions`,
      cookie,
      payload: { jobId, candidateId },
    });
    expect(start.statusCode).toBe(201);
    const voiceSessionId = (JSON.parse(start.body) as { voiceSessionId: string })
      .voiceSessionId;

    const db = superDatabase();
    try {
      await db.db.execute(sql`
        update voice_sessions set
          status = 'ended',
          transcript = ${JSON.stringify([
            { role: 'agent', message: 'Tell me about your experience.' },
            { role: 'user', message: 'Five years in backend engineering.' },
          ])}::jsonb,
          summary = 'Candidate discussed backend experience.',
          structured_answers = ${JSON.stringify({ yearsExperience: 5 })}::jsonb,
          cost_credits = 1.25
        where id = ${voiceSessionId}
      `);
    } finally {
      await db.close();
    }

    const res = await voiceApi.request({
      method: 'GET',
      url: `/jobs/${jobId}/candidates/${candidateId}/results`,
      cookie,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      results: {
        voiceSessionId: string;
        status: string;
        transcript: { role: string; message: string }[];
        summary: string;
        structuredAnswers: { yearsExperience: number };
        costCredits: number;
        fitPercent: number | null;
      };
      sessions: { voiceSessionId: string }[];
    };
    expect(body.results.voiceSessionId).toBe(voiceSessionId);
    expect(body.results.status).toBe('ended');
    expect(body.results.transcript).toHaveLength(2);
    expect(body.results.summary).toBe('Candidate discussed backend experience.');
    expect(body.results.structuredAnswers.yearsExperience).toBe(5);
    expect(body.results.costCredits).toBe(1.25);
    // No must-ask on this agent → no invented fit score.
    expect(body.results.fitPercent).toBeNull();
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0]?.voiceSessionId).toBe(voiceSessionId);
  });

  it('lists multiple screens newest-first and scores fit when must-ask exists', async () => {
    const agentRes = await voiceApi.request({
      method: 'POST',
      url: '/agents',
      cookie,
      payload: {
        name: 'Must Ask Bot',
        purpose: 'Screen with questions',
        description: 'Fit percent test',
        agentType: 'hiring',
      },
    });
    expect(agentRes.statusCode).toBe(201);
    const created = JSON.parse(agentRes.body) as { id: string; versionId: string };
    const pub = await voiceApi.request({
      method: 'POST',
      url: `/agents/${created.id}/versions/${created.versionId}/publish`,
      cookie,
      payload: {},
    });
    expect([200, 201]).toContain(pub.statusCode);

    const jobRes = await voiceApi.request({
      method: 'POST',
      url: '/jobs',
      cookie,
      payload: {
        title: 'Fit Job',
        agentId: created.id,
        mustAskQuestions: [
          'How many years of relevant experience?',
          'What is your notice period?',
        ],
      },
    });
    const fitJobId = (JSON.parse(jobRes.body) as { id: string }).id;

    const candRes = await createJobScopedCandidate(voiceApi, cookie, fitJobId, {
      fullName: 'Fit Candidate',
      phone: '9666777888',
    });
    expect(candRes.statusCode).toBe(201);
    const fitCandidateId = (JSON.parse(candRes.body) as { id: string }).id;

    const older = await voiceApi.request({
      method: 'POST',
      url: `/agents/${created.id}/voice-sessions`,
      cookie,
      payload: { jobId: fitJobId, candidateId: fitCandidateId },
    });
    const olderId = (JSON.parse(older.body) as { voiceSessionId: string }).voiceSessionId;
    await voiceApi.request({
      method: 'POST',
      url: `/agents/${created.id}/voice-sessions/${olderId}/end`,
      cookie,
      payload: {},
    });

    const newer = await voiceApi.request({
      method: 'POST',
      url: `/agents/${created.id}/voice-sessions`,
      cookie,
      payload: { jobId: fitJobId, candidateId: fitCandidateId },
    });
    const newerId = (JSON.parse(newer.body) as { voiceSessionId: string }).voiceSessionId;

    const db = superDatabase();
    try {
      await db.db.execute(sql`
        update voice_sessions set
          status = 'ended',
          started_at = now() - interval '2 hours',
          structured_answers = ${JSON.stringify({
            how_many_years_of_relevant_experience: '3',
            what_is_your_notice_period: '',
          })}::jsonb,
          summary = 'Older screen'
        where id = ${olderId}
      `);
      await db.db.execute(sql`
        update voice_sessions set
          status = 'ended',
          started_at = now(),
          structured_answers = ${JSON.stringify({
            how_many_years_of_relevant_experience: '5',
            what_is_your_notice_period: '30 days',
          })}::jsonb,
          summary = 'Newer screen'
        where id = ${newerId}
      `);
    } finally {
      await db.close();
    }

    const res = await voiceApi.request({
      method: 'GET',
      url: `/jobs/${fitJobId}/candidates/${fitCandidateId}/results`,
      cookie,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      results: { voiceSessionId: string; fitPercent: number | null; summary: string | null };
      sessions: { voiceSessionId: string; fitPercent: number | null; summary: string | null }[];
    };
    expect(body.sessions).toHaveLength(2);
    expect(body.sessions[0]?.voiceSessionId).toBe(newerId);
    expect(body.sessions[0]?.fitPercent).toBe(100);
    expect(body.sessions[1]?.voiceSessionId).toBe(olderId);
    expect(body.sessions[1]?.fitPercent).toBe(50);
    expect(body.results.voiceSessionId).toBe(newerId);
    expect(body.results.fitPercent).toBe(100);
  });

  it('one agent, two jobs: fit % prefers each job’s must-ask', async () => {
    const agentRes = await voiceApi.request({
      method: 'POST',
      url: '/agents',
      cookie,
      payload: {
        name: 'Reusable Screener',
        purpose: 'Screen any role',
        agentType: 'hiring',
        // Agent has no must-ask — jobs own questions.
      },
    });
    expect(agentRes.statusCode).toBe(201);
    const created = JSON.parse(agentRes.body) as { id: string; versionId: string };
    const pub = await voiceApi.request({
      method: 'POST',
      url: `/agents/${created.id}/versions/${created.versionId}/publish`,
      cookie,
      payload: {},
    });
    expect([200, 201]).toContain(pub.statusCode);

    const jobARes = await voiceApi.request({
      method: 'POST',
      url: '/jobs',
      cookie,
      payload: {
        title: 'Backend Role',
        agentId: created.id,
        mustAskQuestions: ['Years of backend experience?'],
      },
    });
    const jobBRes = await voiceApi.request({
      method: 'POST',
      url: '/jobs',
      cookie,
      payload: {
        title: 'Frontend Role',
        agentId: created.id,
        mustAskQuestions: [
          'Years of frontend experience?',
          'Preferred UI framework?',
        ],
      },
    });
    expect(jobARes.statusCode).toBe(201);
    expect(jobBRes.statusCode).toBe(201);
    const jobAId = (JSON.parse(jobARes.body) as { id: string }).id;
    const jobBId = (JSON.parse(jobBRes.body) as { id: string }).id;

    const getA = await voiceApi.request({
      method: 'GET',
      url: `/jobs/${jobAId}`,
      cookie,
    });
    const getB = await voiceApi.request({
      method: 'GET',
      url: `/jobs/${jobBId}`,
      cookie,
    });
    const a = JSON.parse(getA.body) as {
      screeningQuestions: { id: string; label: string }[];
    };
    const b = JSON.parse(getB.body) as {
      screeningQuestions: { id: string; label: string }[];
    };
    expect(a.screeningQuestions).toHaveLength(1);
    expect(b.screeningQuestions).toHaveLength(2);
    expect(a.screeningQuestions[0]?.label).toBe('Years of backend experience?');
    expect(b.screeningQuestions[1]?.label).toBe('Preferred UI framework?');

    const candA = await createJobScopedCandidate(voiceApi, cookie, jobAId, {
      fullName: 'Backend Cand',
      phone: '9111222333',
    });
    const candB = await createJobScopedCandidate(voiceApi, cookie, jobBId, {
      fullName: 'Frontend Cand',
      phone: '9111222444',
    });
    const candAId = (JSON.parse(candA.body) as { id: string }).id;
    const candBId = (JSON.parse(candB.body) as { id: string }).id;

    const sessA = await voiceApi.request({
      method: 'POST',
      url: `/agents/${created.id}/voice-sessions`,
      cookie,
      payload: { jobId: jobAId, candidateId: candAId },
    });
    expect(sessA.statusCode).toBe(201);
    const sessAId = (JSON.parse(sessA.body) as { voiceSessionId: string })
      .voiceSessionId;
    await voiceApi.request({
      method: 'POST',
      url: `/agents/${created.id}/voice-sessions/${sessAId}/end`,
      cookie,
      payload: {},
    });

    const sessB = await voiceApi.request({
      method: 'POST',
      url: `/agents/${created.id}/voice-sessions`,
      cookie,
      payload: { jobId: jobBId, candidateId: candBId },
    });
    expect(sessB.statusCode).toBe(201);
    const sessBId = (JSON.parse(sessB.body) as { voiceSessionId: string })
      .voiceSessionId;
    await voiceApi.request({
      method: 'POST',
      url: `/agents/${created.id}/voice-sessions/${sessBId}/end`,
      cookie,
      payload: {},
    });

    const db = superDatabase();
    try {
      await db.db.execute(sql`
        update voice_sessions set
          status = 'ended',
          structured_answers = ${JSON.stringify({
            years_of_backend_experience: '5',
          })}::jsonb
        where id = ${sessAId}
      `);
      // Only one of two frontend questions answered → 50%.
      await db.db.execute(sql`
        update voice_sessions set
          status = 'ended',
          structured_answers = ${JSON.stringify({
            years_of_frontend_experience: '4',
            preferred_ui_framework: '',
          })}::jsonb
        where id = ${sessBId}
      `);
    } finally {
      await db.close();
    }

    const resA = await voiceApi.request({
      method: 'GET',
      url: `/jobs/${jobAId}/candidates/${candAId}/results`,
      cookie,
    });
    const resB = await voiceApi.request({
      method: 'GET',
      url: `/jobs/${jobBId}/candidates/${candBId}/results`,
      cookie,
    });
    expect(resA.statusCode).toBe(200);
    expect(resB.statusCode).toBe(200);
    const bodyA = JSON.parse(resA.body) as {
      results: { fitPercent: number | null };
    };
    const bodyB = JSON.parse(resB.body) as {
      results: { fitPercent: number | null };
    };
    expect(bodyA.results.fitPercent).toBe(100);
    expect(bodyB.results.fitPercent).toBe(50);
  });

  it('freezes provision snapshot at call start; later Job edits do not change fit', async () => {
    const agentRes = await voiceApi.request({
      method: 'POST',
      url: '/agents',
      cookie,
      payload: {
        name: 'Snapshot Screener',
        purpose: 'Freeze config per call',
        agentType: 'hiring',
      },
    });
    expect(agentRes.statusCode).toBe(201);
    const created = JSON.parse(agentRes.body) as { id: string; versionId: string };
    const pub = await voiceApi.request({
      method: 'POST',
      url: `/agents/${created.id}/versions/${created.versionId}/publish`,
      cookie,
      payload: {},
    });
    expect([200, 201]).toContain(pub.statusCode);

    const jobRes = await voiceApi.request({
      method: 'POST',
      url: '/jobs',
      cookie,
      payload: {
        title: 'Snapshot Job',
        agentId: created.id,
        mustAskQuestions: [
          'How many years of relevant experience?',
          'What is your notice period?',
        ],
        screeningLanguage: 'en',
      },
    });
    expect(jobRes.statusCode).toBe(201);
    const snapJobId = (JSON.parse(jobRes.body) as { id: string }).id;

    const candRes = await createJobScopedCandidate(voiceApi, cookie, snapJobId, {
      fullName: 'Snapshot Candidate',
      phone: '9777888999',
    });
    expect(candRes.statusCode).toBe(201);
    const snapCandidateId = (JSON.parse(candRes.body) as { id: string }).id;

    const start = await voiceApi.request({
      method: 'POST',
      url: `/agents/${created.id}/voice-sessions`,
      cookie,
      payload: { jobId: snapJobId, candidateId: snapCandidateId },
    });
    expect(start.statusCode).toBe(201);
    const voiceSessionId = (JSON.parse(start.body) as { voiceSessionId: string })
      .voiceSessionId;

    const db = superDatabase();
    let frozenLabels: string[] = [];
    try {
      const rows = await db.db.execute<{
        provision_snapshot: {
          evaluationCriteria?: { id: string; label: string }[];
          usedJobScreening?: boolean;
          usedAgentFallback?: boolean;
          jobId?: string;
          agentId?: string;
          agentVersionId?: string;
          screeningLanguage?: string;
          agentPrompt?: string;
          firstMessage?: string;
        } | null;
      }>(sql`
        select provision_snapshot
        from voice_sessions
        where id = ${voiceSessionId}
      `);
      const snap = rows[0]?.provision_snapshot;
      expect(snap).toBeTruthy();
      expect(snap?.jobId).toBe(snapJobId);
      expect(snap?.agentId).toBe(created.id);
      expect(snap?.agentVersionId).toBe(created.versionId);
      expect(snap?.usedJobScreening).toBe(true);
      expect(snap?.usedAgentFallback).toBe(false);
      expect(snap?.screeningLanguage).toBe('en');
      expect(snap?.agentPrompt).toContain('How many years of relevant experience?');
      expect(snap?.firstMessage).toBeTruthy();
      frozenLabels = (snap?.evaluationCriteria ?? []).map((c) => c.label);
      expect(frozenLabels).toEqual([
        'How many years of relevant experience?',
        'What is your notice period?',
      ]);

      // Mutate live Job screening after the call started.
      const patch = await voiceApi.request({
        method: 'PATCH',
        url: `/jobs/${snapJobId}`,
        cookie,
        payload: {
          mustAskQuestions: ['Completely different question after the call?'],
        },
      });
      expect(patch.statusCode).toBe(200);

      // Confirm live job changed.
      const jobGet = await voiceApi.request({
        method: 'GET',
        url: `/jobs/${snapJobId}`,
        cookie,
      });
      const liveJob = JSON.parse(jobGet.body) as {
        screeningQuestions: { label: string }[];
      };
      expect(liveJob.screeningQuestions.map((q) => q.label)).toEqual([
        'Completely different question after the call?',
      ]);

      // Snapshot on the session must still hold the original criteria.
      const after = await db.db.execute<{
        provision_snapshot: {
          evaluationCriteria?: { label: string }[];
        } | null;
      }>(sql`
        select provision_snapshot
        from voice_sessions
        where id = ${voiceSessionId}
      `);
      expect(
        (after[0]?.provision_snapshot?.evaluationCriteria ?? []).map((c) => c.label),
      ).toEqual(frozenLabels);

      await db.db.execute(sql`
        update voice_sessions set
          status = 'ended',
          structured_answers = ${JSON.stringify({
            how_many_years_of_relevant_experience: '5',
            what_is_your_notice_period: '30 days',
          })}::jsonb
        where id = ${voiceSessionId}
      `);
    } finally {
      await db.close();
    }

    const res = await voiceApi.request({
      method: 'GET',
      url: `/jobs/${snapJobId}/candidates/${snapCandidateId}/results`,
      cookie,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      results: { fitPercent: number | null; voiceSessionId: string };
    };
    // Fit must use frozen 2-question snapshot (100%), not the mutated 1-question job.
    expect(body.results.voiceSessionId).toBe(voiceSessionId);
    expect(body.results.fitPercent).toBe(100);
  });

  it('auto-reconciles missing transcript when viewing results', async () => {
    const start = await voiceApi.request({
      method: 'POST',
      url: `/agents/${agentId}/voice-sessions`,
      cookie,
      payload: { jobId, candidateId },
    });
    expect(start.statusCode).toBe(201);
    const voiceSessionId = (JSON.parse(start.body) as { voiceSessionId: string })
      .voiceSessionId;

    const db = superDatabase();
    try {
      await db.db.execute(sql`
        update voice_sessions set
          status = 'ended',
          external_conversation_id = 'stub-conv-auto-reconcile',
          transcript = null,
          summary = null,
          structured_answers = null
        where id = ${voiceSessionId}
      `);
    } finally {
      await db.close();
    }

    const res = await voiceApi.request({
      method: 'GET',
      url: `/jobs/${jobId}/candidates/${candidateId}/results`,
      cookie,
    });
    expect(res.statusCode).toBe(200);
    const { results } = JSON.parse(res.body) as {
      results: {
        voiceSessionId: string;
        status: string;
        transcript: unknown[] | null;
        summary: string | null;
        structuredAnswers: Record<string, unknown> | null;
      };
    };
    expect(results.voiceSessionId).toBe(voiceSessionId);
    expect(results.status).toBe('ended');
    expect(results.transcript?.length).toBeGreaterThan(0);
    expect(results.summary).toBe('Stub conversation summary.');
    expect(results.structuredAnswers).toMatchObject({
      experience_years: '2',
    });
  });

  it('returns 404 when the candidate belongs to a different job', async () => {
    const otherJob = await voiceApi.request({
      method: 'POST',
      url: '/jobs',
      cookie,
      payload: { title: 'Other Job For Isolation' },
    });
    const otherJobId = (JSON.parse(otherJob.body) as { id: string }).id;
    const otherCand = await createJobScopedCandidate(voiceApi, cookie, otherJobId, {
      fullName: 'Other Job Candidate',
      phone: '9777888999',
    });
    const otherId = (JSON.parse(otherCand.body) as { id: string }).id;

    const res = await voiceApi.request({
      method: 'GET',
      url: `/jobs/${jobId}/candidates/${otherId}/results`,
      cookie,
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for cross-org access', async () => {
    const res = await voiceApi.request({
      method: 'GET',
      url: `/jobs/${jobId}/candidates/${candidateId}/results`,
      cookie: orgBOwner.cookie,
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 without candidates.read permission', async () => {
    const viewer = await registerUser(voiceApi, 'results-viewer');
    const token = await inviteAndCaptureToken(
      voiceApi,
      orgAOwner,
      viewer.email,
      'viewer',
    );
    const accepted = await acceptInvitation(voiceApi, viewer, token);
    expect([200, 201]).toContain(accepted.statusCode);

    const res = await voiceApi.request({
      method: 'GET',
      url: `/jobs/${jobId}/candidates/${candidateId}/results`,
      cookie: viewer.cookie,
    });
    expect(res.statusCode).toBe(403);
  });

  it('reports telephony status for Call phone UI', async () => {
    const res = await voiceApi.request({
      method: 'GET',
      url: '/telephony/status',
      cookie,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      outboundPhone: boolean;
      browserDemo: boolean;
      openOutbound: boolean;
      message: string;
    };
    expect(body.browserDemo).toBe(true);
    expect(body.outboundPhone).toBe(true);
    expect(body.openOutbound).toBe(false);
    expect(body.message).toMatch(/Phone calling is ready|open calling/i);
    expect(body.message.length).toBeGreaterThan(0);
  });

  it('rejects outbound when candidate has no phone', async () => {
    const link = await voiceApi.request({
      method: 'PATCH',
      url: `/jobs/${jobId}`,
      cookie,
      payload: { agentId },
    });
    expect([200, 201]).toContain(link.statusCode);

    // M2: NEW creates require phone; clear it to exercise the outbound guard
    // (legacy NULL phone remains allowed on update).
    const clear = await voiceApi.request({
      method: 'PATCH',
      url: `/candidates/${candidateId}`,
      cookie,
      payload: { phone: null },
    });
    expect(clear.statusCode).toBe(200);

    const call = await voiceApi.request({
      method: 'POST',
      url: `/jobs/${jobId}/candidates/${candidateId}/outbound-call`,
      cookie,
      payload: {},
    });
    expect(call.statusCode).toBe(422);
  });

  it('starts an outbound phone session when agent is linked and phone is set', async () => {
    const phoneCand = await createJobScopedCandidate(voiceApi, cookie, jobId, {
      fullName: 'Phone Candidate',
      phone: '+919876543210',
    });
    expect(phoneCand.statusCode).toBe(201);
    const phoneCandidateId = (JSON.parse(phoneCand.body) as { id: string }).id;

    const link = await voiceApi.request({
      method: 'PATCH',
      url: `/jobs/${jobId}`,
      cookie,
      payload: { agentId },
    });
    expect([200, 201]).toContain(link.statusCode);

    const call = await voiceApi.request({
      method: 'POST',
      url: `/jobs/${jobId}/candidates/${phoneCandidateId}/outbound-call`,
      cookie,
      payload: {},
    });
    expect(call.statusCode).toBe(201);
    const session = JSON.parse(call.body) as {
      voiceSessionId: string;
      voiceSession: { id: string; status: string; channel?: string };
    };
    expect(session.voiceSessionId).toBeTruthy();
    expect(session.voiceSession.status).toBe('active');
    expect(session.voiceSession.channel).toBe('phone');

    const again = await voiceApi.request({
      method: 'POST',
      url: `/jobs/${jobId}/candidates/${phoneCandidateId}/outbound-call`,
      cookie,
      payload: {},
    });
    expect(again.statusCode).toBe(409);
    expect(again.body).toMatch(/already in progress/i);
  });

  it('lets a recruiter check telephony and place outbound without agents.test', async () => {
    const recruiter = await registerUser(voiceApi, 'screen-recruiter');
    const token = await inviteAndCaptureToken(
      voiceApi,
      orgAOwner,
      recruiter.email,
      'recruiter',
    );
    const accepted = await acceptInvitation(voiceApi, recruiter, token);
    expect([200, 201]).toContain(accepted.statusCode);

    const tel = await voiceApi.request({
      method: 'GET',
      url: '/telephony/status',
      cookie: recruiter.cookie,
    });
    expect(tel.statusCode).toBe(200);

    const phoneCand = await createJobScopedCandidate(voiceApi, cookie, jobId, {
      fullName: 'Recruiter Dial Target',
      phone: '+919811122233',
    });
    expect(phoneCand.statusCode).toBe(201);
    const phoneCandidateId = (JSON.parse(phoneCand.body) as { id: string }).id;

    await voiceApi.request({
      method: 'PATCH',
      url: `/jobs/${jobId}`,
      cookie,
      payload: { agentId },
    });

    const listed = await voiceApi.request({
      method: 'GET',
      url: `/jobs/${jobId}/candidates`,
      cookie: recruiter.cookie,
    });
    expect(listed.statusCode).toBe(200);
    const listedBody = JSON.parse(listed.body) as {
      candidates: {
        candidateId: string;
        candidate: { phone?: string | null };
      }[];
    };
    const row = listedBody.candidates.find((c) => c.candidateId === phoneCandidateId);
    expect(row?.candidate.phone).toBe('+919811122233');

    // Org allows only one active screen — end leftover sessions from prior tests.
    const sessions = await voiceApi.request({
      method: 'GET',
      url: '/voice-sessions',
      cookie,
    });
    expect(sessions.statusCode).toBe(200);
    const { sessions: open } = JSON.parse(sessions.body) as {
      sessions: { id: string; agentId?: string | null; status: string }[];
    };
    for (const s of open.filter((x) => x.status === 'active' || x.status === 'pending')) {
      const end = await voiceApi.request({
        method: 'POST',
        url: `/agents/${s.agentId ?? agentId}/voice-sessions/${s.id}/end`,
        cookie,
        payload: {},
      });
      expect([200, 201]).toContain(end.statusCode);
    }

    const call = await voiceApi.request({
      method: 'POST',
      url: `/jobs/${jobId}/candidates/${phoneCandidateId}/outbound-call`,
      cookie: recruiter.cookie,
      payload: {},
    });
    expect(call.statusCode).toBe(201);
  });

  it('hides transcript content from analysts without calls.read_transcript', async () => {
    const analyst = await registerUser(voiceApi, 'results-analyst');
    const token = await inviteAndCaptureToken(
      voiceApi,
      orgAOwner,
      analyst.email,
      'analyst',
    );
    const accepted = await acceptInvitation(voiceApi, analyst, token);
    expect([200, 201]).toContain(accepted.statusCode);

    const res = await voiceApi.request({
      method: 'GET',
      url: `/jobs/${jobId}/candidates/${candidateId}/results`,
      cookie: analyst.cookie,
    });
    expect(res.statusCode).toBe(200);
    const { results } = JSON.parse(res.body) as {
      results: {
        voiceSessionId: string | null;
        status: string | null;
        transcript: unknown;
        summary: string | null;
        structuredAnswers: unknown;
        fitPercent: number | null;
        recordingAvailable: boolean;
      };
    };
    expect(results.voiceSessionId).toBeTruthy();
    expect(results.transcript).toBeNull();
    expect(results.summary).toBeNull();
    expect(results.structuredAnswers).toBeNull();
    expect(results.fitPercent).toBeNull();
    expect(results.recordingAvailable).toBe(false);
  });

  it('answers review-chat from stored call facts and refuses hire advice', async () => {
    const ask = await voiceApi.request({
      method: 'POST',
      url: `/jobs/${jobId}/candidates/${candidateId}/review-chat`,
      cookie: orgAOwner.cookie,
      payload: { message: 'What is the summary of this screen?' },
    });
    expect(ask.statusCode).toBe(200);
    const body = JSON.parse(ask.body) as { reply: string; voiceSessionId: string | null };
    expect(body.voiceSessionId).toBeTruthy();
    expect(body.reply.length).toBeGreaterThan(0);

    const hire = await voiceApi.request({
      method: 'POST',
      url: `/jobs/${jobId}/candidates/${candidateId}/review-chat`,
      cookie: orgAOwner.cookie,
      payload: { message: 'Should we hire this candidate?' },
    });
    expect(hire.statusCode).toBe(200);
    const hireBody = JSON.parse(hire.body) as { reply: string };
    expect(hireBody.reply).toMatch(/do not recommend hire or reject/i);
  });

  it('forbids review-chat without calls.read_transcript', async () => {
    const analyst = await registerUser(voiceApi, 'review-chat-analyst');
    const token = await inviteAndCaptureToken(
      voiceApi,
      orgAOwner,
      analyst.email,
      'analyst',
    );
    const accepted = await acceptInvitation(voiceApi, analyst, token);
    expect([200, 201]).toContain(accepted.statusCode);

    const res = await voiceApi.request({
      method: 'POST',
      url: `/jobs/${jobId}/candidates/${candidateId}/review-chat`,
      cookie: analyst.cookie,
      payload: { message: 'What did they say?' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('job candidate CSV import', () => {
  let jobId: string;

  beforeAll(async () => {
    const job = await api.request({
      method: 'POST',
      url: '/jobs',
      cookie: orgAOwner.cookie,
      payload: { title: 'Import Desk Role' },
    });
    expect(job.statusCode).toBe(201);
    jobId = (JSON.parse(job.body) as { id: string }).id;

    const existing = await createJobScopedCandidate(api, orgAOwner.cookie, jobId, {
      fullName: 'Already There',
      phone: '9111111111',
      countryCode: '+91',
    });
    expect(existing.statusCode).toBe(201);
  });

  it('previews flexible headers and flags missing / duplicate phones', async () => {
    const csv = [
      'Name,Mobile,Dial code,Email',
      'Asha Patel,9876543210,91,asha@example.com',
      'No Phone,,+91,',
      'Dup Existing,9111111111,+91,',
      'Batch Dup,9876543210,+91,',
    ].join('\n');

    const res = await api.request({
      method: 'POST',
      url: `/jobs/${jobId}/candidates/import/preview`,
      cookie: orgAOwner.cookie,
      payload: { csvText: csv },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      summary: { total: number; valid: number; invalid: number };
      rows: {
        fullName: string | null;
        phone: string | null;
        valid: boolean;
        issues: string[];
      }[];
    };
    expect(body.summary.total).toBe(4);
    expect(body.summary.valid).toBe(1);
    expect(body.rows[0]?.valid).toBe(true);
    expect(body.rows[1]?.issues).toContain('missing_phone');
    expect(body.rows[2]?.issues).toContain('duplicate_on_job');
    expect(body.rows[3]?.issues).toContain('duplicate_in_batch');
  });

  it('confirm imports valid rows and skips job duplicates', async () => {
    const res = await api.request({
      method: 'POST',
      url: `/jobs/${jobId}/candidates/import/confirm`,
      cookie: orgAOwner.cookie,
      payload: {
        rows: [
          {
            fullName: 'Imported One',
            countryCode: '+91',
            phone: '9000000001',
            email: 'one@import.test',
          },
          {
            fullName: 'Imported Two',
            countryCode: '+91',
            phone: '9000000002',
          },
          {
            fullName: 'Dup Existing',
            countryCode: '+91',
            phone: '9111111111',
          },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as {
      created: { id: string; fullName: string; phone: string }[];
      skipped: number;
      rejected: { phone: string; issues: string[] }[];
    };
    expect(body.created).toHaveLength(2);
    expect(body.created.map((c) => c.fullName).sort()).toEqual([
      'Imported One',
      'Imported Two',
    ]);
    expect(body.skipped).toBe(1);
    expect(body.rejected[0]?.issues).toContain('duplicate_on_job');

    const list = await api.request({
      method: 'GET',
      url: `/jobs/${jobId}/candidates`,
      cookie: orgAOwner.cookie,
    });
    expect(list.statusCode).toBe(200);
    const { candidates } = JSON.parse(list.body) as {
      candidates: { candidate: { fullName: string } }[];
    };
    const names = candidates.map((c) => c.candidate.fullName);
    expect(names).toEqual(
      expect.arrayContaining(['Imported One', 'Imported Two', 'Already There']),
    );
  });
});

describe('job JD text + assist', () => {
  let jobId: string;

  beforeAll(async () => {
    const res = await api.request({
      method: 'POST',
      url: '/jobs',
      cookie: orgAOwner.cookie,
      payload: { title: 'JD Assist Role' },
    });
    expect(res.statusCode).toBe(201);
    jobId = (JSON.parse(res.body) as { id: string }).id;
  });

  it('saves typed JD text and attaches knowledge to the job', async () => {
    const text =
      'We need a backend engineer to own APIs, mentor juniors, and ship reliable services for India hiring screens.';
    const res = await api.request({
      method: 'POST',
      url: `/jobs/${jobId}/jd/text`,
      cookie: orgAOwner.cookie,
      payload: { text },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as {
      sourceId: string;
      documentId: string;
    };
    expect(body.sourceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(body.documentId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    const knowledge = await api.request({
      method: 'GET',
      url: `/jobs/${jobId}/knowledge`,
      cookie: orgAOwner.cookie,
    });
    expect(knowledge.statusCode).toBe(200);
    const { sources } = JSON.parse(knowledge.body) as {
      sources: { id: string; name: string }[];
    };
    expect(sources.some((s) => s.id === body.sourceId)).toBe(true);
    expect(sources.some((s) => /description/i.test(s.name))).toBe(true);

    // Reopen path: GET job must return the saved text (list + textarea hydrate).
    const got = await api.request({
      method: 'GET',
      url: `/jobs/${jobId}`,
      cookie: orgAOwner.cookie,
    });
    expect(got.statusCode).toBe(200);
    const job = JSON.parse(got.body) as {
      description: string;
      hasJdDocs: boolean;
    };
    expect(job.description).toBe(text);
    expect(job.hasJdDocs).toBe(true);

    // Re-save must not 409 on the knowledge source name.
    const again = await api.request({
      method: 'POST',
      url: `/jobs/${jobId}/jd/text`,
      cookie: orgAOwner.cookie,
      payload: { text: `${text} Updated notice period under 60 days.` },
    });
    expect(again.statusCode).toBe(201);
    const got2 = await api.request({
      method: 'GET',
      url: `/jobs/${jobId}`,
      cookie: orgAOwner.cookie,
    });
    expect(got2.statusCode).toBe(200);
    expect(
      (JSON.parse(got2.body) as { description: string }).description,
    ).toContain('Updated notice period');
  });

  it('forbids JD assist without jobs.update', async () => {
    const viewer = await registerUser(api, 'jd-assist-viewer');
    const token = await inviteAndCaptureToken(
      api,
      orgAOwner,
      viewer.email,
      'viewer',
    );
    expect((await acceptInvitation(api, viewer, token)).statusCode).toBe(201);

    const res = await api.request({
      method: 'POST',
      url: `/jobs/${jobId}/jd/assist`,
      cookie: viewer.cookie,
      payload: {
        mode: 'generate',
        notes:
          'Own APIs and mentor juniors for our India hiring product team.',
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns a clear conflict when Gemini key is empty (not 500)', async () => {
    // Shared harness has no GEMINI_API_KEY — assist must conflict, not crash.
    const res = await api.request({
      method: 'POST',
      url: `/jobs/${jobId}/jd/assist`,
      cookie: orgAOwner.cookie,
      payload: {
        mode: 'format',
        notes:
          'Paste of a messy JD about backend ownership, mentorship, and APIs.',
      },
    });
    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body) as { code?: string; message?: string };
    expect(body.code).toBe('conflict');
    expect(body.message ?? '').toMatch(/GEMINI_API_KEY|type or paste|admin/i);
    expect(res.statusCode).not.toBe(500);
  });
});
