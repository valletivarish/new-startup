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
    };
    expect(job.id).toBe(jobId);
    expect(job.title).toBe('Senior Engineer');
    expect(job.description).toBe('Build things');
    expect(job.status).toBe('draft');
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
  let candidateId: string;

  it('creates a candidate with phone extracted from resume text', async () => {
    const res = await api.request({
      method: 'POST',
      url: '/candidates',
      cookie: orgAOwner.cookie,
      payload: {
        fullName: 'Priya Sharma',
        resumeText: 'Reach me at +91 98765 43210 for interview scheduling.',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { id: string };
    expect(body.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
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
    };
    expect(candidate.fullName).toBe('Priya Sharma');
    expect(candidate.phone).toBe('+919876543210');
    expect(candidate.source).toBe('resume');
  });

  it('lists candidates within the organization', async () => {
    const res = await api.request({
      method: 'GET',
      url: '/candidates',
      cookie: orgAOwner.cookie,
    });
    expect(res.statusCode).toBe(200);
    const { candidates } = JSON.parse(res.body) as {
      candidates: { id: string; fullName: string; source: string }[];
    };
    expect(candidates.some((c) => c.id === candidateId)).toBe(true);
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
});

describe('candidates PII gating', () => {
  let candidateId: string;
  let manager: TestActor;

  beforeAll(async () => {
    const res = await api.request({
      method: 'POST',
      url: '/candidates',
      cookie: orgAOwner.cookie,
      payload: {
        fullName: 'Hidden Contact',
        phone: '9876543210',
        email: 'hidden@example.test',
      },
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
      url: '/candidates',
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

describe('job candidate assignments', () => {
  let jobId: string;
  let candidateId: string;

  beforeAll(async () => {
    const jobRes = await api.request({
      method: 'POST',
      url: '/jobs',
      cookie: orgAOwner.cookie,
      payload: { title: 'Assignment Role' },
    });
    jobId = (JSON.parse(jobRes.body) as { id: string }).id;

    const candRes = await api.request({
      method: 'POST',
      url: '/candidates',
      cookie: orgAOwner.cookie,
      payload: { fullName: 'Assignee One', phone: '9988776655' },
    });
    candidateId = (JSON.parse(candRes.body) as { id: string }).id;
  });

  it('assigns a candidate to a job', async () => {
    const res = await api.request({
      method: 'POST',
      url: `/jobs/${jobId}/candidates`,
      cookie: orgAOwner.cookie,
      payload: { candidateId },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { id: string };
    expect(body.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
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
    expect(row!.candidate).not.toHaveProperty('phone');
    expect(row!.candidate).not.toHaveProperty('email');
  });

  it('updates assignment status', async () => {
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

  it('returns 409 when assigning the same candidate twice', async () => {
    const res = await api.request({
      method: 'POST',
      url: `/jobs/${jobId}/candidates`,
      cookie: orgAOwner.cookie,
      payload: { candidateId },
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

    const candRes = await api.request({
      method: 'POST',
      url: '/candidates',
      cookie: orgAOwner.cookie,
      payload: { fullName: 'Permission List Candidate' },
    });
    const candidateId = (JSON.parse(candRes.body) as { id: string }).id;

    const assign = await api.request({
      method: 'POST',
      url: `/jobs/${jobId}/candidates`,
      cookie: orgAOwner.cookie,
      payload: { candidateId },
    });
    expect(assign.statusCode).toBe(201);

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

  it('returns 404 when job does not exist', async () => {
    const res = await api.request({
      method: 'POST',
      url: `/jobs/${bogusId}/candidates`,
      cookie: orgAOwner.cookie,
      payload: { candidateId: bogusId },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when candidate does not exist', async () => {
    const res = await api.request({
      method: 'POST',
      url: `/jobs/${jobId}/candidates`,
      cookie: orgAOwner.cookie,
      payload: { candidateId: bogusId },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when candidate belongs to another org', async () => {
    const candRes = await api.request({
      method: 'POST',
      url: '/candidates',
      cookie: orgBOwner.cookie,
      payload: { fullName: 'Org B Only' },
    });
    const orgBCandidateId = (JSON.parse(candRes.body) as { id: string }).id;

    const res = await api.request({
      method: 'POST',
      url: `/jobs/${jobId}/candidates`,
      cookie: orgAOwner.cookie,
      payload: { candidateId: orgBCandidateId },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('job candidate assignment isolation', () => {
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

    const candRes = await api.request({
      method: 'POST',
      url: '/candidates',
      cookie: orgAOwner.cookie,
      payload: { fullName: 'Isolated Assignee' },
    });
    candidateId = (JSON.parse(candRes.body) as { id: string }).id;

    const assign = await api.request({
      method: 'POST',
      url: `/jobs/${jobId}/candidates`,
      cookie: orgAOwner.cookie,
      payload: { candidateId },
    });
    expect(assign.statusCode).toBe(201);
  });

  it("org B cannot list org A's job candidates", async () => {
    const res = await api.request({
      method: 'GET',
      url: `/jobs/${jobId}/candidates`,
      cookie: orgBOwner.cookie,
    });
    expect(res.statusCode).toBe(404);
  });

  it("org B cannot assign to org A's job", async () => {
    const res = await api.request({
      method: 'POST',
      url: `/jobs/${jobId}/candidates`,
      cookie: orgBOwner.cookie,
      payload: { candidateId },
    });
    expect(res.statusCode).toBe(404);
  });

  it("org B cannot update org A's assignment status", async () => {
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
  let candidateId: string;

  beforeAll(async () => {
    const res = await api.request({
      method: 'POST',
      url: '/candidates',
      cookie: orgAOwner.cookie,
      payload: { fullName: 'Isolated Candidate', phone: '9123456789' },
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

    const candRes = await voiceApi.request({
      method: 'POST',
      url: '/candidates',
      cookie,
      payload: { fullName: 'Screened Candidate' },
    });
    candidateId = (JSON.parse(candRes.body) as { id: string }).id;

    const assign = await voiceApi.request({
      method: 'POST',
      url: `/jobs/${jobId}/candidates`,
      cookie,
      payload: { candidateId },
    });
    expect(assign.statusCode).toBe(201);

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
    const { results } = JSON.parse(res.body) as {
      results: {
        voiceSessionId: string | null;
        transcript: unknown;
        summary: string | null;
        structuredAnswers: unknown;
        costCredits: number | null;
        fitPercent?: unknown;
      };
    };
    expect(results.voiceSessionId).toBeNull();
    expect(results.transcript).toBeNull();
    expect(results.summary).toBeNull();
    expect(results.structuredAnswers).toBeNull();
    expect(results.costCredits).toBeNull();
    expect(results).not.toHaveProperty('fitPercent');
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
    const { results } = JSON.parse(res.body) as {
      results: {
        voiceSessionId: string;
        status: string;
        transcript: { role: string; message: string }[];
        summary: string;
        structuredAnswers: { yearsExperience: number };
        costCredits: number;
        fitPercent?: unknown;
      };
    };
    expect(results.voiceSessionId).toBe(voiceSessionId);
    expect(results.status).toBe('ended');
    expect(results.transcript).toHaveLength(2);
    expect(results.summary).toBe('Candidate discussed backend experience.');
    expect(results.structuredAnswers.yearsExperience).toBe(5);
    expect(results.costCredits).toBe(1.25);
    expect(results).not.toHaveProperty('fitPercent');
  });

  it('returns 404 when the candidate is not assigned to the job', async () => {
    const unassigned = await voiceApi.request({
      method: 'POST',
      url: '/candidates',
      cookie,
      payload: { fullName: 'Unassigned Candidate' },
    });
    const unassignedId = (JSON.parse(unassigned.body) as { id: string }).id;

    const res = await voiceApi.request({
      method: 'GET',
      url: `/jobs/${jobId}/candidates/${unassignedId}/results`,
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
});
