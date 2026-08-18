/**
 * The positive multi-organization acceptance criteria
 * (`09_MVP_ACCEPTANCE_CRITERIA` — Organization):
 *
 *   "A user can belong to multiple organizations and hold a different role
 *    in each."
 *   "Switching organizations changes visible data and effective permissions,
 *    with no leakage between them."
 *
 * The security suite proves switching to a FOREIGN org is refused; this file
 * proves the legitimate path works — the ADR-005 model doing its actual job.
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

// The travelling user: Owner of their own org, Analyst in someone else's.
let traveller: TestActor;
let ownOrg: string;
let otherOwner: TestActor;
let otherOrg: string;

beforeAll(async () => {
  api = await startApi();

  traveller = await registerUser(api, 'traveller');
  ownOrg = await createOrganization(api, traveller, 'Travellers Own Co');

  otherOwner = await registerUser(api, 'host-owner');
  otherOrg = await createOrganization(api, otherOwner, 'Host Analytics Ltd');

  const token = await inviteAndCaptureToken(
    api,
    otherOwner,
    traveller.email,
    'analyst',
  );
  expect((await acceptInvitation(api, traveller, token)).statusCode).toBe(201);
}, 120_000);

afterAll(async () => {
  await api?.close();
});

async function switchTo(organizationId: string): Promise<void> {
  const res = await api.request({
    method: 'POST',
    url: '/auth/switch-organization',
    cookie: traveller.cookie,
    payload: { organizationId },
  });
  expect(res.statusCode).toBe(201);
}

async function meNow(): Promise<{
  activeOrganization: { id: string; role: string; permissions: string[] } | null;
}> {
  const res = await api.request({
    method: 'GET',
    url: '/auth/me',
    cookie: traveller.cookie,
  });
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.body);
}

describe('one user, two organizations, two roles (ADR-005)', () => {
  it('lists both memberships with the correct role in each', async () => {
    const res = await api.request({
      method: 'GET',
      url: '/auth/organizations',
      cookie: traveller.cookie,
    });
    const orgs = (
      JSON.parse(res.body) as {
        organizations: { id: string; roleKey: string }[];
      }
    ).organizations;

    expect(orgs).toHaveLength(2);
    expect(orgs.find((o) => o.id === ownOrg)?.roleKey).toBe('owner');
    expect(orgs.find((o) => o.id === otherOrg)?.roleKey).toBe('analyst');
  });

  it('switching changes effective role and permission set', async () => {
    await switchTo(ownOrg);
    let me = await meNow();
    expect(me.activeOrganization?.id).toBe(ownOrg);
    expect(me.activeOrganization?.role).toBe('owner');
    expect(me.activeOrganization?.permissions).toContain('billing.manage');

    await switchTo(otherOrg);
    me = await meNow();
    expect(me.activeOrganization?.id).toBe(otherOrg);
    expect(me.activeOrganization?.role).toBe('analyst');
    // Analyst holds neither billing nor any personal-data permission.
    expect(me.activeOrganization?.permissions).not.toContain('billing.manage');
    expect(me.activeOrganization?.permissions).not.toContain('candidates.read_pii');
    expect(me.activeOrganization?.permissions).toContain('analytics.read');
  });

  it('switching changes visible data with no leakage', async () => {
    await switchTo(ownOrg);
    const own = await api.request({
      method: 'GET',
      url: '/organization',
      cookie: traveller.cookie,
    });
    expect((JSON.parse(own.body) as { name: string }).name).toBe(
      'Travellers Own Co',
    );

    await switchTo(otherOrg);
    const other = await api.request({
      method: 'GET',
      url: '/organization',
      cookie: traveller.cookie,
    });
    expect((JSON.parse(other.body) as { name: string }).name).toBe(
      'Host Analytics Ltd',
    );
  });

  it('permissions are enforced per active organization, not per user', async () => {
    // As Owner of their own org, the traveller can read the audit log.
    await switchTo(ownOrg);
    expect(
      (
        await api.request({
          method: 'GET',
          url: '/audit',
          cookie: traveller.cookie,
        })
      ).statusCode,
    ).toBe(200);

    // As Analyst in the host org, the SAME user with the SAME session is
    // refused the SAME endpoint.
    await switchTo(otherOrg);
    expect(
      (
        await api.request({
          method: 'GET',
          url: '/audit',
          cookie: traveller.cookie,
        })
      ).statusCode,
    ).toBe(403);
  });

  it('members visible in one organization do not leak into the other', async () => {
    // Analyst holds users.read, so the members list is readable in BOTH orgs
    // — but must show different people.
    await switchTo(ownOrg);
    const ownMembers = JSON.parse(
      (
        await api.request({
          method: 'GET',
          url: '/organization/members',
          cookie: traveller.cookie,
        })
      ).body,
    ) as { members: { email: string }[] };

    await switchTo(otherOrg);
    const otherMembers = JSON.parse(
      (
        await api.request({
          method: 'GET',
          url: '/organization/members',
          cookie: traveller.cookie,
        })
      ).body,
    ) as { members: { email: string }[] };

    expect(ownMembers.members.map((m) => m.email)).not.toContain(
      otherOwner.email,
    );
    expect(otherMembers.members.map((m) => m.email)).toContain(
      otherOwner.email,
    );
    expect(otherMembers.members.map((m) => m.email)).toContain(traveller.email);
  });
});
