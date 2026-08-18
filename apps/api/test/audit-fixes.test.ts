/**
 * Regression tests for the confirmed findings of the Phase 1 independent
 * audit. Each describe block names the defect it pins; if any of these fail,
 * a fixed vulnerability has been reintroduced.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, withTenantContext, withoutTenantContext, type Database } from '@platform/db';

import {
  appDatabase,
  createOrgWithOwner,
  expectRlsDenied,
  superDatabase,
  type TestOrg,
} from './setup/fixtures.js';
import {
  acceptInvitation,
  createOrganization,
  inviteAndCaptureToken,
  registerUser,
  startApi,
  type ApiHarness,
} from './setup/api-harness.js';

let db: Database;
let orgA: TestOrg;
let api: ApiHarness;

beforeAll(async () => {
  db = appDatabase();
  orgA = await createOrgWithOwner(db, 'audit-org-a');
  api = await startApi();
}, 120_000);

afterAll(async () => {
  await api?.close();
  await db?.close();
});

// ---------------------------------------------------------------------------

describe('AUDIT FIX: tenant context cannot delete or alter system roles', () => {
  it('DELETE from tenant context does not touch system roles', async () => {
    const result = await withTenantContext(
      db.db,
      { organizationId: orgA.organizationId, userId: orgA.ownerUserId },
      async (tx) =>
        tx.execute(sql`delete from roles where organization_id is null`),
    );
    expect(result.count).toBe(0);

    const remaining = await withoutTenantContext(db.db, async (tx) =>
      tx.execute<{ n: string }>(
        sql`select count(*)::text as n from roles where organization_id is null`,
      ),
    );
    expect(remaining[0]?.n).toBe('7');
  });

  it('UPDATE from tenant context does not touch system roles', async () => {
    const result = await withTenantContext(
      db.db,
      { organizationId: orgA.organizationId, userId: orgA.ownerUserId },
      async (tx) =>
        tx.execute(
          sql`update roles set name = 'hijacked' where organization_id is null`,
        ),
    );
    expect(result.count).toBe(0);
  });
});

describe('AUDIT FIX: the audit trail is append-only and forge-proof', () => {
  it('the app role cannot UPDATE audit events', async () => {
    await expect(
      withTenantContext(
        db.db,
        { organizationId: orgA.organizationId, userId: orgA.ownerUserId },
        async (tx) =>
          tx.execute(sql`update audit_events set event_type = 'tampered'`),
      ),
    ).rejects.toThrow(); // permission denied: UPDATE revoked entirely
  });

  it('the app role cannot DELETE audit events', async () => {
    await expect(
      withTenantContext(
        db.db,
        { organizationId: orgA.organizationId, userId: orgA.ownerUserId },
        async (tx) => tx.execute(sql`delete from audit_events`),
      ),
    ).rejects.toThrow();
  });

  it('a tenant context cannot forge a platform-level (NULL-org) audit row', async () => {
    await expectRlsDenied(() =>
      withTenantContext(
        db.db,
        { organizationId: orgA.organizationId, userId: orgA.ownerUserId },
        async (tx) => {
          await tx.execute(sql`
            insert into audit_events (organization_id, event_type)
            values (null, 'forged.platform_event')
          `);
        },
      ),
    );
  });

  it('the authorization catalogue is read-only to the app role', async () => {
    await expect(
      withoutTenantContext(db.db, async (tx) =>
        tx.execute(
          sql`insert into permissions (key, resource, action) values ('evil.perm', 'evil', 'perm')`,
        ),
      ),
    ).rejects.toThrow();
    await expect(
      withoutTenantContext(db.db, async (tx) =>
        tx.execute(sql`delete from role_permissions`),
      ),
    ).rejects.toThrow();
  });
});

describe('AUDIT FIX: rows cannot migrate between tenants', () => {
  it('UPDATE ... SET organization_id to another org is refused by WITH CHECK', async () => {
    const orgB = await createOrgWithOwner(db, 'audit-org-b');
    await expectRlsDenied(() =>
      withTenantContext(
        db.db,
        { organizationId: orgA.organizationId, userId: orgA.ownerUserId },
        async (tx) => {
          await tx.execute(sql`
            update organization_memberships
            set organization_id = ${orgB.organizationId}
            where organization_id = ${orgA.organizationId}
          `);
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------

describe('AUDIT FIX: expired invitations return 410 and do not poison the email', () => {
  it('acceptance of an expired invitation is a clean 410, and the email can be re-invited', async () => {
    const owner = await registerUser(api, 'exp-owner');
    await createOrganization(api, owner, 'Expiry Test Org');
    const target = await registerUser(api, 'exp-target');
    const token = await inviteAndCaptureToken(api, owner, target.email, 'viewer');

    // Force the invitation past its expiry, as superuser: every application
    // role is subject to FORCE RLS and cannot touch the row without context —
    // which is itself evidence the policies hold.
    const su = superDatabase();
    try {
      const forced = await su.db.execute(sql`
        update organization_invitations
        set expires_at = now() - interval '1 hour'
        where email = ${target.email}
        returning id
      `);
      expect(forced.length).toBe(1);
    } finally {
      await su.close();
    }

    // Previously: 500 (RLS refused the expiry-marking UPDATE). Now: 410.
    const res = await acceptInvitation(api, target, token);
    expect(res.statusCode).toBe(410);

    // The row was marked expired, so the partial unique index no longer
    // blocks a fresh invitation for the same email. Previously: 409 forever.
    const secondToken = await inviteAndCaptureToken(
      api,
      owner,
      target.email,
      'viewer',
    );
    const accepted = await acceptInvitation(api, target, secondToken);
    expect(accepted.statusCode).toBe(201);
  });
});

// ---------------------------------------------------------------------------

describe('AUDIT FIX: last-owner protection holds under concurrency', () => {
  it('two concurrent demotions of the last two owners leave at least one owner', async () => {
    // An org with exactly two owners who try to demote each other at once.
    const owner1 = await registerUser(api, 'race-owner-1');
    await createOrganization(api, owner1, 'Race Test Org');
    const owner2 = await registerUser(api, 'race-owner-2');
    const token = await inviteAndCaptureToken(api, owner1, owner2.email, 'owner');
    expect((await acceptInvitation(api, owner2, token)).statusCode).toBe(201);

    const members = await api.request({
      method: 'GET',
      url: '/organization/members',
      cookie: owner1.cookie,
    });
    const list = (
      JSON.parse(members.body) as {
        members: { membershipId: string; email: string }[];
      }
    ).members;
    const m1 = list.find((m) => m.email === owner1.email);
    const m2 = list.find((m) => m.email === owner2.email);

    // owner2 must have an active organization context to act.
    await api.request({
      method: 'POST',
      url: '/auth/switch-organization',
      cookie: owner2.cookie,
      payload: {
        organizationId: (
          JSON.parse(
            (
              await api.request({
                method: 'GET',
                url: '/auth/organizations',
                cookie: owner2.cookie,
              })
            ).body,
          ) as { organizations: { id: string; name: string }[] }
        ).organizations.find((o) => o.name === 'Race Test Org')?.id,
      },
    });

    // Fire both demotions concurrently. With row locks on all owner rows,
    // one serialises behind the other and must see zero remaining owners.
    const [r1, r2] = await Promise.all([
      api.request({
        method: 'PATCH',
        url: `/organization/members/${m2?.membershipId}/role`,
        cookie: owner1.cookie,
        payload: { roleKey: 'viewer' },
      }),
      api.request({
        method: 'PATCH',
        url: `/organization/members/${m1?.membershipId}/role`,
        cookie: owner2.cookie,
        payload: { roleKey: 'viewer' },
      }),
    ]);

    const statuses = [r1.statusCode, r2.statusCode].sort();
    // At most one demotion may succeed; deadlock-abort (500) is an acceptable
    // second outcome, ownerlessness is not.
    expect(statuses.filter((s) => s === 200).length).toBeLessThanOrEqual(1);

    // The invariant that matters: at least one active owner remains.
    // Counted as superuser — an RLS-subject connection with no tenant
    // context sees zero membership rows by design.
    const su = superDatabase();
    try {
      const after = await su.db.execute<{ n: string }>(sql`
        select count(*)::text as n
        from organization_memberships m
        join roles r on r.id = m.role_id
        join organizations o on o.id = m.organization_id
        where o.name = 'Race Test Org'
          and r.key = 'owner' and m.status = 'active'
      `);
      expect(Number(after[0]?.n)).toBeGreaterThanOrEqual(1);
    } finally {
      await su.close();
    }
  });
});

// ---------------------------------------------------------------------------

describe('AUDIT FIX: suspension invalidates sessions (previously untested)', () => {
  it("suspending a member ends that member's sessions in the organization", async () => {
    const owner = await registerUser(api, 'susp-owner');
    await createOrganization(api, owner, 'Suspension Test');
    const member = await registerUser(api, 'susp-member');
    const token = await inviteAndCaptureToken(api, owner, member.email, 'viewer');
    expect((await acceptInvitation(api, member, token)).statusCode).toBe(201);

    expect(
      (
        await api.request({
          method: 'GET',
          url: '/organization',
          cookie: member.cookie,
        })
      ).statusCode,
    ).toBe(200);

    const members = await api.request({
      method: 'GET',
      url: '/organization/members',
      cookie: owner.cookie,
    });
    const row = (
      JSON.parse(members.body) as {
        members: { membershipId: string; email: string }[];
      }
    ).members.find((m) => m.email === member.email);

    expect(
      (
        await api.request({
          method: 'PATCH',
          url: `/organization/members/${row?.membershipId}/status`,
          cookie: owner.cookie,
          payload: { status: 'suspended' },
        })
      ).statusCode,
    ).toBe(200);

    // The suspended member's session is gone.
    expect(
      (
        await api.request({
          method: 'GET',
          url: '/organization',
          cookie: member.cookie,
        })
      ).statusCode,
    ).toBe(401);
  });
});

// ---------------------------------------------------------------------------

describe('AUDIT FIX: organization deletion preserves its audit trail', () => {
  it('audit rows survive org deletion as platform-level history', async () => {
    const owner = await registerUser(api, 'del-owner');
    const orgId = await createOrganization(api, owner, 'Doomed Org');

    expect(
      (
        await api.request({
          method: 'DELETE',
          url: '/organization',
          cookie: owner.cookie,
        })
      ).statusCode,
    ).toBe(200);

    // The deletion record survives with organization_id nulled — previously
    // the FK cascade erased the entire trail including this row. Verified as
    // superuser: platform-level NULL-org rows are deliberately invisible to
    // every RLS-subject role, including the one running this test suite.
    const su = superDatabase();
    try {
      const rows = await su.db.execute<{ n: string }>(sql`
        select count(*)::text as n from audit_events
        where event_type = 'organization.deleted'
          and resource_id = ${orgId}
          and organization_id is null
      `);
      expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(1);
    } finally {
      await su.close();
    }
  });
});

// ---------------------------------------------------------------------------

describe('AUDIT FIX: rate-limit responses use the standard envelope', () => {
  it('429 carries code/message/request_id like every other error', async () => {
    // A dedicated instance with a tiny limit so the shared harness is not
    // affected. This is a behavioural test — a real 429 from the real stack.
    const tiny = await startApi({ RATE_LIMIT_MAX: '3' });
    try {
      let last: Awaited<ReturnType<typeof tiny.request>> | undefined;
      for (let i = 0; i < 5; i += 1) {
        last = await tiny.request({ method: 'GET', url: '/health' });
      }
      expect(last?.statusCode).toBe(429);
      const body = JSON.parse(last?.body ?? '{}') as {
        code: string;
        message: string;
        request_id: string;
      };
      expect(body.code).toBe('rate_limited');
      expect(body.request_id).toBeTruthy();
      expect(body.message).toMatch(/try again/i);
    } finally {
      await tiny.close();
    }
  });
});
