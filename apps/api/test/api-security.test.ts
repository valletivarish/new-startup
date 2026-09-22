/**
 * End-to-end security tests through the real HTTP surface: real Better Auth,
 * real guards, real RLS, real non-owner database role.
 *
 * Covers the founder's hardening list: forged tenant context, organization
 * switching, membership removal/suspension/role change, owner protection,
 * self-escalation, permission bypass, sensitive-field exposure, session
 * invalidation, invitation abuse, and IDOR probes.
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

// Organization A: owner + a recruiter joined by invitation.
let ownerA: TestActor;
let recruiterA: TestActor;
let orgA: string;
// Organization B: entirely separate.
let ownerB: TestActor;
let orgB: string;

beforeAll(async () => {
  api = await startApi();

  ownerA = await registerUser(api, 'owner-a');
  orgA = await createOrganization(api, ownerA, 'Acme Hiring');

  ownerB = await registerUser(api, 'owner-b');
  orgB = await createOrganization(api, ownerB, 'Beta Corp');

  recruiterA = await registerUser(api, 'recruiter-a');
  const token = await inviteAndCaptureToken(api, ownerA, recruiterA.email, 'recruiter');
  const accepted = await acceptInvitation(api, recruiterA, token);
  expect(accepted.statusCode).toBe(201);
}, 120_000);

afterAll(async () => {
  await api?.close();
});

// ---------------------------------------------------------------------------

describe('authentication basics', () => {
  it('anonymous requests to protected routes are refused', async () => {
    for (const url of ['/auth/me', '/organization', '/organization/members', '/audit']) {
      const res = await api.request({ method: 'GET', url });
      expect(res.statusCode, url).toBe(401);
    }
  });

  it('health is public', async () => {
    const res = await api.request({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('a garbage session cookie is just an anonymous request', async () => {
    const res = await api.request({
      method: 'GET',
      url: '/auth/me',
      cookie: 'better-auth.session_token=forged-token-value',
    });
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------

describe('tenant context cannot be forged by client input', () => {
  it('ignores an X-Organization-Id header', async () => {
    const res = await api.request({
      method: 'GET',
      url: '/organization',
      cookie: ownerA.cookie,
      headers: { 'x-organization-id': orgB },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { id: string };
    expect(body.id).toBe(orgA); // the session's org, not the header's
  });

  it('ignores an organizationId query parameter', async () => {
    const res = await api.request({
      method: 'GET',
      url: `/organization?organizationId=${orgB}`,
      cookie: ownerA.cookie,
    });
    expect(res.statusCode).toBe(200);
    expect((JSON.parse(res.body) as { id: string }).id).toBe(orgA);
  });

  it('ignores an organizationId smuggled into a request body', async () => {
    const res = await api.request({
      method: 'PATCH',
      url: '/organization',
      cookie: ownerA.cookie,
      payload: { name: 'Acme Renamed', organizationId: orgB },
    });
    expect(res.statusCode).toBe(200);

    // B is untouched.
    const b = await api.request({
      method: 'GET',
      url: '/organization',
      cookie: ownerB.cookie,
    });
    expect((JSON.parse(b.body) as { name: string }).name).toBe('Beta Corp');
  });

  it('switch-organization refuses an organization the user is not in', async () => {
    const res = await api.request({
      method: 'POST',
      url: '/auth/switch-organization',
      cookie: ownerA.cookie,
      payload: { organizationId: orgB },
    });
    expect(res.statusCode).toBe(404); // indistinguishable from nonexistent
  });
});

// ---------------------------------------------------------------------------

describe('cross-tenant access through the API', () => {
  it("A's members list never contains B's people", async () => {
    const res = await api.request({
      method: 'GET',
      url: '/organization/members',
      cookie: ownerA.cookie,
    });
    const body = JSON.parse(res.body) as { members: { email: string }[] };
    expect(body.members.some((m) => m.email === ownerB.email)).toBe(false);
  });

  it("A cannot modify a B membership by id (IDOR)", async () => {
    const bMembers = await api.request({
      method: 'GET',
      url: '/organization/members',
      cookie: ownerB.cookie,
    });
    const bMembershipId = (
      JSON.parse(bMembers.body) as { members: { membershipId: string }[] }
    ).members[0]?.membershipId;
    expect(bMembershipId).toBeDefined();

    const attempts = [
      api.request({
        method: 'PATCH',
        url: `/organization/members/${bMembershipId}/role`,
        cookie: ownerA.cookie,
        payload: { roleKey: 'viewer' },
      }),
      api.request({
        method: 'PATCH',
        url: `/organization/members/${bMembershipId}/status`,
        cookie: ownerA.cookie,
        payload: { status: 'suspended' },
      }),
      api.request({
        method: 'DELETE',
        url: `/organization/members/${bMembershipId}`,
        cookie: ownerA.cookie,
      }),
    ];
    for (const attempt of await Promise.all(attempts)) {
      expect(attempt.statusCode).toBe(404); // not 403 — existence not leaked
    }

    // B's membership is genuinely untouched.
    const after = await api.request({
      method: 'GET',
      url: '/organization/members',
      cookie: ownerB.cookie,
    });
    const rows = JSON.parse(after.body) as {
      members: { status: string; roleKey: string }[];
    };
    expect(rows.members[0]?.status).toBe('active');
    expect(rows.members[0]?.roleKey).toBe('owner');
  });

  it("A cannot read B's audit trail", async () => {
    const res = await api.request({
      method: 'GET',
      url: '/audit',
      cookie: ownerA.cookie,
    });
    const events = (JSON.parse(res.body) as { events: { event_type: string }[] })
      .events;
    // Every visible event belongs to A's org; B's org-create audit is invisible.
    expect(events.length).toBeGreaterThan(0);
    const res2 = await api.request({
      method: 'GET',
      url: '/audit',
      cookie: ownerB.cookie,
    });
    const eventsB = (JSON.parse(res2.body) as { events: { id: string }[] }).events;
    const idsA = new Set(events.map((e) => (e as { id?: string }).id));
    for (const e of eventsB) expect(idsA.has(e.id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('permission enforcement (strings, not role names)', () => {
  it('a recruiter cannot invite users', async () => {
    const res = await api.request({
      method: 'POST',
      url: '/organization/invitations',
      cookie: recruiterA.cookie,
      payload: { email: 'x@example.test', roleKey: 'viewer' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('a recruiter cannot change roles', async () => {
    const members = await api.request({
      method: 'GET',
      url: '/organization/members',
      cookie: ownerA.cookie,
    });
    const anyId = (JSON.parse(members.body) as { members: { membershipId: string }[] })
      .members[0]?.membershipId;
    const res = await api.request({
      method: 'PATCH',
      url: `/organization/members/${anyId}/role`,
      cookie: recruiterA.cookie,
      payload: { roleKey: 'viewer' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('a recruiter cannot read the audit log', async () => {
    const res = await api.request({
      method: 'GET',
      url: '/audit',
      cookie: recruiterA.cookie,
    });
    expect(res.statusCode).toBe(403);
  });

  it('permission denials are audited', async () => {
    const res = await api.request({
      method: 'GET',
      url: '/audit',
      cookie: ownerA.cookie,
    });
    const events = (JSON.parse(res.body) as { events: { event_type: string }[] })
      .events;
    expect(events.some((e) => e.event_type === 'authz.denied')).toBe(true);
  });

  it('a session with no active organization gets 403 with guidance, not data', async () => {
    const drifter = await registerUser(api, 'drifter');
    const res = await api.request({
      method: 'GET',
      url: '/organization',
      cookie: drifter.cookie,
    });
    expect(res.statusCode).toBe(403);
    expect(res.body).toContain('Create or open your company first');
  });
});

// ---------------------------------------------------------------------------

describe('owner protection and escalation', () => {
  it('the last owner cannot demote themselves — self-role-change is refused outright', async () => {
    const members = await api.request({
      method: 'GET',
      url: '/organization/members',
      cookie: ownerA.cookie,
    });
    const own = (
      JSON.parse(members.body) as {
        members: { membershipId: string; email: string }[];
      }
    ).members.find((m) => m.email === ownerA.email);

    const res = await api.request({
      method: 'PATCH',
      url: `/organization/members/${own?.membershipId}/role`,
      cookie: ownerA.cookie,
      payload: { roleKey: 'viewer' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('a recruiter cannot escalate themselves to owner', async () => {
    const members = await api.request({
      method: 'GET',
      url: '/organization/members',
      cookie: ownerA.cookie,
    });
    const rec = (
      JSON.parse(members.body) as {
        members: { membershipId: string; email: string }[];
      }
    ).members.find((m) => m.email === recruiterA.email);

    const res = await api.request({
      method: 'PATCH',
      url: `/organization/members/${rec?.membershipId}/role`,
      cookie: recruiterA.cookie,
      payload: { roleKey: 'owner' },
    });
    expect(res.statusCode).toBe(403); // lacks roles.assign entirely
  });

  it('an administrator cannot touch an owner, and cannot mint owners', async () => {
    // Promote a fresh user to administrator in org A.
    const admin = await registerUser(api, 'admin-a');
    const token = await inviteAndCaptureToken(api, ownerA, admin.email, 'administrator');
    expect((await acceptInvitation(api, admin, token)).statusCode).toBe(201);

    const members = await api.request({
      method: 'GET',
      url: '/organization/members',
      cookie: ownerA.cookie,
    });
    const list = (
      JSON.parse(members.body) as {
        members: { membershipId: string; email: string }[];
      }
    ).members;
    const ownerRow = list.find((m) => m.email === ownerA.email);
    const recruiterRow = list.find((m) => m.email === recruiterA.email);

    // Cannot demote the owner.
    const demote = await api.request({
      method: 'PATCH',
      url: `/organization/members/${ownerRow?.membershipId}/role`,
      cookie: admin.cookie,
      payload: { roleKey: 'viewer' },
    });
    expect(demote.statusCode).toBe(403);

    // Cannot suspend the owner.
    const suspend = await api.request({
      method: 'PATCH',
      url: `/organization/members/${ownerRow?.membershipId}/status`,
      cookie: admin.cookie,
      payload: { status: 'suspended' },
    });
    expect(suspend.statusCode).toBe(403);

    // Cannot promote anyone TO owner.
    const promote = await api.request({
      method: 'PATCH',
      url: `/organization/members/${recruiterRow?.membershipId}/role`,
      cookie: admin.cookie,
      payload: { roleKey: 'owner' },
    });
    expect(promote.statusCode).toBe(403);

    // Cannot invite an owner either.
    const invite = await api.request({
      method: 'POST',
      url: '/organization/invitations',
      cookie: admin.cookie,
      payload: { email: 'new-owner@example.test', roleKey: 'owner' },
    });
    expect(invite.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------

describe('session invalidation', () => {
  it('a role change ends the affected user’s sessions in that organization', async () => {
    // Fresh org with owner + one agent manager.
    const owner = await registerUser(api, 'inv-owner');
    await createOrganization(api, owner, 'Invalidation Test');
    const manager = await registerUser(api, 'inv-manager');
    const token = await inviteAndCaptureToken(api, owner, manager.email, 'agent_manager');
    expect((await acceptInvitation(api, manager, token)).statusCode).toBe(201);

    // Manager can see the org.
    const before = await api.request({
      method: 'GET',
      url: '/organization',
      cookie: manager.cookie,
    });
    expect(before.statusCode).toBe(200);

    // Owner demotes them to viewer.
    const members = await api.request({
      method: 'GET',
      url: '/organization/members',
      cookie: owner.cookie,
    });
    const row = (
      JSON.parse(members.body) as {
        members: { membershipId: string; email: string }[];
      }
    ).members.find((m) => m.email === manager.email);
    const change = await api.request({
      method: 'PATCH',
      url: `/organization/members/${row?.membershipId}/role`,
      cookie: owner.cookie,
      payload: { roleKey: 'viewer' },
    });
    expect(change.statusCode).toBe(200);

    // The manager's old session is gone — next request is unauthenticated.
    const after = await api.request({
      method: 'GET',
      url: '/organization',
      cookie: manager.cookie,
    });
    expect(after.statusCode).toBe(401);
  });

  it('membership removal ends sessions the same way', async () => {
    const owner = await registerUser(api, 'rm-owner');
    await createOrganization(api, owner, 'Removal Test');
    const viewer = await registerUser(api, 'rm-viewer');
    const token = await inviteAndCaptureToken(api, owner, viewer.email, 'viewer');
    expect((await acceptInvitation(api, viewer, token)).statusCode).toBe(201);

    const members = await api.request({
      method: 'GET',
      url: '/organization/members',
      cookie: owner.cookie,
    });
    const row = (
      JSON.parse(members.body) as {
        members: { membershipId: string; email: string }[];
      }
    ).members.find((m) => m.email === viewer.email);

    expect(
      (
        await api.request({
          method: 'DELETE',
          url: `/organization/members/${row?.membershipId}`,
          cookie: owner.cookie,
        })
      ).statusCode,
    ).toBe(200);

    const after = await api.request({
      method: 'GET',
      url: '/organization',
      cookie: viewer.cookie,
    });
    expect(after.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------

describe('invitation abuse', () => {
  it('duplicate pending invitations are refused', async () => {
    const target = `dup-${Math.random()}@example.test`;
    await inviteAndCaptureToken(api, ownerA, target, 'viewer');
    const second = await api.request({
      method: 'POST',
      url: '/organization/invitations',
      cookie: ownerA.cookie,
      payload: { email: target, roleKey: 'viewer' },
    });
    expect(second.statusCode).toBe(409);
  });

  it('inviting an existing member is refused', async () => {
    const res = await api.request({
      method: 'POST',
      url: '/organization/invitations',
      cookie: ownerA.cookie,
      payload: { email: recruiterA.email, roleKey: 'viewer' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('a token cannot be accepted by the wrong account', async () => {
    const target = `intended-${Math.random()}@example.test`;
    const token = await inviteAndCaptureToken(api, ownerA, target, 'viewer');

    const interloper = await registerUser(api, 'interloper');
    const res = await acceptInvitation(api, interloper, token);
    expect(res.statusCode).toBe(404); // same as nonexistent — not probeable
  });

  it('a token cannot be replayed after acceptance', async () => {
    const joiner = await registerUser(api, 'joiner');
    const token = await inviteAndCaptureToken(api, ownerA, joiner.email, 'viewer');
    expect((await acceptInvitation(api, joiner, token)).statusCode).toBe(201);

    const replay = await acceptInvitation(api, joiner, token);
    expect([409, 410]).toContain(replay.statusCode);
  });

  it('a revoked invitation cannot be accepted', async () => {
    const target = await registerUser(api, 'revoked-target');
    const token = await inviteAndCaptureToken(api, ownerA, target.email, 'viewer');

    const list = await api.request({
      method: 'GET',
      url: '/organization/invitations',
      cookie: ownerA.cookie,
    });
    const pending = (
      JSON.parse(list.body) as {
        invitations: { id: string; email: string; status: string }[];
      }
    ).invitations.find((i) => i.email === target.email && i.status === 'pending');

    expect(
      (
        await api.request({
          method: 'DELETE',
          url: `/organization/invitations/${pending?.id}`,
          cookie: ownerA.cookie,
        })
      ).statusCode,
    ).toBe(200);

    const res = await acceptInvitation(api, target, token);
    expect(res.statusCode).toBe(410);
  });

  it('a forged token is indistinguishable from a missing one', async () => {
    const someone = await registerUser(api, 'forger');
    const res = await acceptInvitation(api, someone, 'A'.repeat(43));
    expect(res.statusCode).toBe(404);
  });

  it('create returns a one-time acceptUrl; list never repeats the raw token', async () => {
    const target = `no-leak-${Math.random()}@example.test`;
    const created = await api.request({
      method: 'POST',
      url: '/organization/invitations',
      cookie: ownerA.cookie,
      payload: { email: target, roleKey: 'viewer' },
    });
    expect(created.statusCode).toBe(201);
    const body = JSON.parse(created.body) as { id: string; acceptUrl: string };
    expect(body.acceptUrl).toMatch(/\/invitations\/accept\?token=[A-Za-z0-9_-]+/);

    const listed = await api.request({
      method: 'GET',
      url: '/organization/invitations',
      cookie: ownerA.cookie,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.body).not.toMatch(/token=/);
    expect(listed.body).not.toContain(body.acceptUrl);
  });
});

// ---------------------------------------------------------------------------

describe('response hygiene', () => {
  it('errors carry the standard envelope with a request id', async () => {
    const res = await api.request({ method: 'GET', url: '/organization' });
    const body = JSON.parse(res.body) as {
      code: string;
      message: string;
      request_id: string;
    };
    expect(body.code).toBe('unauthorized');
    expect(body.request_id).toBeTruthy();
    expect(res.body).not.toContain('at '); // no stack frames
  });

  it('validation failures name the field, not the stack', async () => {
    const res = await api.request({
      method: 'POST',
      url: '/organizations',
      cookie: ownerA.cookie,
      payload: { name: 'x' },
    });
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body) as { errors: { field: string }[] };
    expect(body.errors.some((e) => e.field === 'name')).toBe(true);
  });

  it('members responses expose no password or token material', async () => {
    const res = await api.request({
      method: 'GET',
      url: '/organization/members',
      cookie: ownerA.cookie,
    });
    expect(res.body).not.toMatch(/password|token_hash|session/i);
  });
});
