/**
 * Closing pipeline stage (`declined`, migration 0026) and the single
 * job-candidate fetch used by desk deep links.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createOrganization,
  registerUser,
  startApi,
  type ApiHarness,
  type TestActor,
} from './setup/api-harness.js';

let api: ApiHarness;
let owner: TestActor;
let other: TestActor;
let jobId: string;
let candidateId: string;

beforeAll(async () => {
  api = await startApi();
  owner = await registerUser(api, 'stages-a');
  other = await registerUser(api, 'stages-b');
  await createOrganization(api, owner, 'Stages Org A');
  await createOrganization(api, other, 'Stages Org B');

  const job = await api.request({
    method: 'POST',
    url: '/jobs',
    cookie: owner.cookie,
    payload: { title: 'Field sales' },
  });
  expect(job.statusCode).toBe(201);
  jobId = (JSON.parse(job.body) as { id: string }).id;

  const candidate = await api.request({
    method: 'POST',
    url: '/candidates',
    cookie: owner.cookie,
    payload: { jobId, fullName: 'Asha Rao', phone: '9876543210', countryCode: '+91' },
  });
  expect(candidate.statusCode).toBe(201);
  candidateId = (JSON.parse(candidate.body) as { id: string }).id;
}, 120_000);

afterAll(async () => {
  await api?.close();
});

describe('declined stage', () => {
  it('single PATCH accepts declined and stage history records it', async () => {
    const res = await api.request({
      method: 'PATCH',
      url: `/jobs/${jobId}/candidates/${candidateId}`,
      cookie: owner.cookie,
      payload: { status: 'declined', reason: 'Notice period too long' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ previous: 'new', status: 'declined' });

    const history = await api.request({
      method: 'GET',
      url: `/jobs/${jobId}/candidates/${candidateId}/stage-history`,
      cookie: owner.cookie,
    });
    const events = (JSON.parse(history.body) as { events: { status: string }[] }).events;
    expect(events[0]?.status).toBe('declined');
  });

  it('bulk-status accepts declined; list filters and totals count it', async () => {
    const bulk = await api.request({
      method: 'POST',
      url: `/jobs/${jobId}/candidates/bulk-status`,
      cookie: owner.cookie,
      payload: { updates: [{ candidateId, status: 'declined' }] },
    });
    expect(bulk.statusCode).toBe(201);

    const list = await api.request({
      method: 'GET',
      url: `/jobs/${jobId}/candidates?status=declined`,
      cookie: owner.cookie,
    });
    const body = JSON.parse(list.body) as {
      candidates: { candidateId: string; status: string }[];
      totals: Record<string, number>;
    };
    expect(body.candidates.map((c) => c.candidateId)).toEqual([candidateId]);
    expect(body.totals.declined).toBe(1);
  });

  it('an unknown stage is still refused', async () => {
    const res = await api.request({
      method: 'PATCH',
      url: `/jobs/${jobId}/candidates/${candidateId}`,
      cookie: owner.cookie,
      payload: { status: 'hired' },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('single job-candidate fetch', () => {
  it('returns the same row shape as one list element', async () => {
    const one = await api.request({
      method: 'GET',
      url: `/jobs/${jobId}/candidates/${candidateId}`,
      cookie: owner.cookie,
    });
    expect(one.statusCode).toBe(200);
    const list = await api.request({
      method: 'GET',
      url: `/jobs/${jobId}/candidates`,
      cookie: owner.cookie,
    });
    const row = (JSON.parse(list.body) as { candidates: unknown[] }).candidates[0];
    expect(JSON.parse(one.body)).toEqual(row);
  });

  it('is 404 for another organization and for a candidate not on the job', async () => {
    const foreign = await api.request({
      method: 'GET',
      url: `/jobs/${jobId}/candidates/${candidateId}`,
      cookie: other.cookie,
    });
    expect(foreign.statusCode).toBe(404);

    const job2 = await api.request({
      method: 'POST',
      url: '/jobs',
      cookie: owner.cookie,
      payload: { title: 'Another role' },
    });
    const otherJobId = (JSON.parse(job2.body) as { id: string }).id;
    const wrongJob = await api.request({
      method: 'GET',
      url: `/jobs/${otherJobId}/candidates/${candidateId}`,
      cookie: owner.cookie,
    });
    expect(wrongJob.statusCode).toBe(404);
  });
});
