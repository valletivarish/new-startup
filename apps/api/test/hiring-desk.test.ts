/**
 * P1 — Hiring desk: jobs CRUD and tenant isolation.
 *
 * Runs through the real HTTP surface against real PostgreSQL. Cross-org
 * access must return 404, never another tenant's data.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  acceptInvitation,
  createOrganization,
  inviteAndCaptureToken,
  registerUser,
  startApi,
  type ApiHarness,
  type TestActor,
} from './setup/api-harness.js';

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
