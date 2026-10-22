/**
 * Team endpoints the web calls: invitation preview, accept-new, resend, and a
 * member password reset. Real app, real RLS, real Better Auth.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from '@platform/db';

import { superDatabase } from './setup/fixtures.js';
import {
  createOrganization,
  inviteAndCaptureToken,
  registerUser,
  startApi,
  type ApiHarness,
  type TestActor,
} from './setup/api-harness.js';

let api: ApiHarness;
let counter = 0;
const fresh = (label: string) => `${label}-${++counter}-${Math.floor(Math.random() * 1e9)}@example.test`;

beforeAll(async () => {
  api = await startApi();
}, 120_000);

afterAll(async () => {
  await api?.close();
});

async function ownerWithOrg(name: string): Promise<TestActor> {
  const owner = await registerUser(api, 'team-owner');
  await createOrganization(api, owner, name);
  return owner;
}

async function setInvitation(email: string, set: ReturnType<typeof sql>) {
  const su = superDatabase();
  try {
    await su.db.execute(sql`update organization_invitations set ${set} where email = ${email}`);
  } finally {
    await su.close();
  }
}

const get = (url: string) => api.request({ method: 'GET', url });
const acceptNew = (payload: Record<string, unknown>) =>
  api.request({ method: 'POST', url: '/invitations/accept-new', payload });

describe('GET /invitations/:token', () => {
  it('returns exactly what the accept page renders', async () => {
    const owner = await ownerWithOrg('Preview Freight');
    const email = fresh('pv');
    const token = await inviteAndCaptureToken(api, owner, email, 'recruiter');
    const res = await get(`/invitations/${token}`);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      organizationName: 'Preview Freight',
      inviterName: 'team-owner',
      roleName: expect.any(String),
      email,
      status: 'pending',
      accountExists: false,
    });
  });

  it('flags an existing account, and reports expired and revoked', async () => {
    const owner = await ownerWithOrg('Preview Two');
    const existing = await registerUser(api, 'pv-existing');
    const t1 = await inviteAndCaptureToken(api, owner, existing.email, 'viewer');
    expect(JSON.parse((await get(`/invitations/${t1}`)).body).accountExists).toBe(true);

    const email = fresh('pv-exp');
    const t2 = await inviteAndCaptureToken(api, owner, email, 'viewer');
    await setInvitation(email, sql`expires_at = now() - interval '1 hour'`);
    expect(JSON.parse((await get(`/invitations/${t2}`)).body).status).toBe('expired');

    const email3 = fresh('pv-rev');
    const t3 = await inviteAndCaptureToken(api, owner, email3, 'viewer');
    await setInvitation(email3, sql`status = 'revoked'`);
    expect(JSON.parse((await get(`/invitations/${t3}`)).body).status).toBe('revoked');
  });

  it('answers an unknown token with a 404 and no invitation data', async () => {
    const res = await get(`/invitations/${'x'.repeat(43)}`);
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('not_found');
    expect(res.body).not.toContain('organizationName');
  });

  it('is rate limited per IP', async () => {
    const limited = await startApi();
    try {
      const codes: number[] = [];
      for (let i = 0; i < 12; i++) {
        codes.push((await limited.request({ method: 'GET', url: `/invitations/${'y'.repeat(43)}` })).statusCode);
      }
      expect(codes.slice(0, 10).every((c) => c === 404)).toBe(true);
      expect(codes.slice(10)).toEqual([429, 429]);
    } finally {
      await limited.close();
    }
  });
});

describe('POST /invitations/accept-new', () => {
  it('creates the account, joins the workspace and signs the person in', async () => {
    const owner = await ownerWithOrg('Accept Freight');
    const email = fresh('new');
    const token = await inviteAndCaptureToken(api, owner, email, 'recruiter');
    const res = await acceptNew({ token, name: 'Nia New', password: 'a-good-password-1' });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { organizationId: string; userId: string };
    expect(body.organizationId).toEqual(expect.any(String));

    const cookie = (res.headers['set-cookie'] as string[])
      .map((c) => c.split(';')[0])
      .filter((c) => c?.includes('session_token'))
      .join('; ');
    const me = JSON.parse((await api.request({ method: 'GET', url: '/auth/me', cookie })).body);
    expect(me.user.email).toBe(email);
    expect(me.activeOrganization.id).toBe(body.organizationId);
    expect(me.activeOrganization.role).toBe('recruiter');

    const login = await api.request({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      payload: { email, password: 'a-good-password-1' },
    });
    expect(login.statusCode).toBe(200);

    // Single use.
    const again = await acceptNew({ token, name: 'Nia New', password: 'a-good-password-1' });
    expect(again.statusCode).toBe(410);
  });

  it('refuses expired and revoked tokens with 410 and creates no account', async () => {
    const owner = await ownerWithOrg('Accept Closed');
    for (const [label, set] of [
      ['exp', sql`expires_at = now() - interval '1 hour'`],
      ['rev', sql`status = 'revoked'`],
    ] as const) {
      const email = fresh(label);
      const token = await inviteAndCaptureToken(api, owner, email, 'viewer');
      await setInvitation(email, set);
      const res = await acceptNew({ token, name: 'Late', password: 'a-good-password-1' });
      expect(res.statusCode).toBe(410);
      const login = await api.request({
        method: 'POST',
        url: '/api/auth/sign-in/email',
        payload: { email, password: 'a-good-password-1' },
      });
      expect(login.statusCode).not.toBe(200);
    }
  });

  it('enforces the invited email', async () => {
    const owner = await ownerWithOrg('Accept Email');
    const token = await inviteAndCaptureToken(api, owner, fresh('inv'), 'viewer');
    const wrong = await acceptNew({ token, name: 'Mallory', password: 'a-good-password-1', email: fresh('other') });
    expect(wrong.statusCode).toBe(404);
    // An account that already exists for the invited email is a 409, never taken over.
    const existing = await registerUser(api, 'acc-existing');
    const t2 = await inviteAndCaptureToken(api, owner, existing.email, 'viewer');
    const dup = await acceptNew({ token: t2, name: 'Dup', password: 'a-good-password-1' });
    expect(dup.statusCode).toBe(409);
    // The failed attempts did not spend the invitation.
    expect(JSON.parse((await get(`/invitations/${token}`)).body).status).toBe('pending');
  });

  it('validates name and password, and rejects unknown tokens', async () => {
    const owner = await ownerWithOrg('Accept Validate');
    const token = await inviteAndCaptureToken(api, owner, fresh('val'), 'viewer');
    expect((await acceptNew({ token, name: 'Ok', password: 'short' })).statusCode).toBe(422);
    expect((await acceptNew({ token, name: ' ', password: 'a-good-password-1' })).statusCode).toBe(422);
    expect(
      (await acceptNew({ token: 'z'.repeat(43), name: 'Ok', password: 'a-good-password-1' })).statusCode,
    ).toBe(404);
  });
});

describe('POST /organization/invitations/:id/resend', () => {
  async function invitationId(owner: TestActor, email: string): Promise<string> {
    const list = await api.request({ method: 'GET', url: '/organization/invitations', cookie: owner.cookie });
    const rows = JSON.parse(list.body).invitations as { id: string; email: string }[];
    return rows.find((i) => i.email === email)!.id;
  }
  const resend = (actor: TestActor, id: string) =>
    api.request({ method: 'POST', url: `/organization/invitations/${id}/resend`, cookie: actor.cookie, payload: {} });

  it('rotates the link, extends expiry, re-sends the email and audits it', async () => {
    const owner = await ownerWithOrg('Resend Freight');
    const email = fresh('rs');
    const oldToken = await inviteAndCaptureToken(api, owner, email, 'viewer');
    await setInvitation(email, sql`expires_at = now() - interval '1 hour'`);
    const id = await invitationId(owner, email);

    const before = api.outbox.length;
    const res = await resend(owner, id);
    expect(res.statusCode).toBe(201);
    const { acceptUrl } = JSON.parse(res.body) as { acceptUrl: string };
    const newToken = /token=([\w-]+)/.exec(acceptUrl)![1]!;
    expect(newToken).not.toBe(oldToken);
    expect(api.outbox.slice(before).find((m) => m.to === email)?.text).toContain(newToken);

    expect((await get(`/invitations/${oldToken}`)).statusCode).toBe(404);
    expect(JSON.parse((await get(`/invitations/${newToken}`)).body).status).toBe('pending');

    const audit = await api.request({ method: 'GET', url: '/audit?eventType=invitation.resent', cookie: owner.cookie });
    expect(audit.body).toContain(id);
  });

  it('refuses accepted and revoked invitations with 409', async () => {
    const owner = await ownerWithOrg('Resend Closed');
    for (const status of ['revoked', 'accepted']) {
      const email = fresh(status);
      await inviteAndCaptureToken(api, owner, email, 'viewer');
      const id = await invitationId(owner, email);
      await setInvitation(email, sql`status = ${status}`);
      expect((await resend(owner, id)).statusCode).toBe(409);
    }
  });

  it('is tenant isolated and permission gated', async () => {
    const owner = await ownerWithOrg('Resend A');
    const other = await ownerWithOrg('Resend B');
    const email = fresh('iso');
    await inviteAndCaptureToken(api, owner, email, 'viewer');
    const id = await invitationId(owner, email);
    expect((await resend(other, id)).statusCode).toBe(404);

    const viewer = await registerUser(api, 'rs-viewer');
    const vToken = await inviteAndCaptureToken(api, owner, viewer.email, 'viewer');
    await api.request({ method: 'POST', url: '/invitations/accept', cookie: viewer.cookie, payload: { token: vToken } });
    expect((await resend(viewer, id)).statusCode).toBe(403);
    expect(
      (await api.request({ method: 'POST', url: `/organization/invitations/${id}/resend`, payload: {} })).statusCode,
    ).toBe(401);
  });
});

describe('POST /organization/members/:id/password-reset', () => {
  async function memberId(owner: TestActor, email: string): Promise<string> {
    const list = await api.request({ method: 'GET', url: '/organization/members', cookie: owner.cookie });
    const rows = JSON.parse(list.body).members as { membershipId: string; email: string }[];
    return rows.find((m) => m.email === email)!.membershipId;
  }
  const reset = (actor: TestActor, id: string) =>
    api.request({ method: 'POST', url: `/organization/members/${id}/password-reset`, cookie: actor.cookie, payload: {} });

  it('emails the member a Better Auth reset link, returns no link, and audits', async () => {
    const owner = await ownerWithOrg('Reset Freight');
    const member = await registerUser(api, 'rs-member');
    const token = await inviteAndCaptureToken(api, owner, member.email, 'recruiter');
    await api.request({ method: 'POST', url: '/invitations/accept', cookie: member.cookie, payload: { token } });
    const id = await memberId(owner, member.email);

    const before = api.outbox.length;
    const res = await reset(owner, id);
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body)).toEqual({ sent: true });
    expect(res.body).not.toMatch(/reset-password|http/);
    const mail = api.outbox.slice(before).find((m) => m.to === member.email && m.subject === 'Reset your password');
    expect(mail?.text).toMatch(/reset-password\//);

    const audit = await api.request({
      method: 'GET',
      url: '/audit?eventType=membership.password_reset_sent',
      cookie: owner.cookie,
    });
    expect(audit.body).toContain(id);
  });

  it('is tenant isolated and permission gated', async () => {
    const owner = await ownerWithOrg('Reset A');
    const other = await ownerWithOrg('Reset B');
    const ownerMember = await memberId(owner, owner.email);
    expect((await reset(other, ownerMember)).statusCode).toBe(404);

    const viewer = await registerUser(api, 'rs-viewer2');
    const token = await inviteAndCaptureToken(api, owner, viewer.email, 'viewer');
    await api.request({ method: 'POST', url: '/invitations/accept', cookie: viewer.cookie, payload: { token } });
    expect((await reset(viewer, ownerMember)).statusCode).toBe(403);
  });
});
