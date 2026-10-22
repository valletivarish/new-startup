/**
 * Support tickets: RLS isolation (company vs company, unassigned vs everyone
 * but the platform admin), the dashboard, /v1, admin, public chat and inbound
 * email doors, and the side effects of a staff reply (email + ticket.updated).
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  sql,
  withPlatformAdminContext,
  withSupportLookupContext,
  withTenantContext,
  withoutTenantContext,
  type Database,
} from '@platform/db';

import { appDatabase, expectRlsDenied, superDatabase } from './setup/fixtures.js';
import {
  createOrganization,
  registerUser,
  sessionCookie,
  startApi,
  type ApiHarness,
  type TestActor,
} from './setup/api-harness.js';
import { handleWebhookJob, signPayload } from '../src/integrations/deliver.js';
import { ticketRefIn, visibleReply, verifyInboundSignature } from '../src/support/inbound-email.js';
import { statusAfterCustomer, subjectFrom, type SupportService } from '../src/support/support.service.js';
import { combine } from '../src/support/status.controller.js';
import { SUPPORT_SERVICE } from '../src/tokens.more.js';

const ADMIN_EMAIL = `support-admin-${Math.floor(Math.random() * 1e9)}@example.test`;
const SECRET = 'inbound-test-secret';

let api: ApiHarness;
let app: Database;
let su: Database;
let adminCookie: string;
let ipSeq = 10;
const nextIp = () => `10.9.0.${++ipSeq}`;

let server: Server;
let hookUrl: string;
const hits: { headers: Record<string, unknown>; body: string }[] = [];

interface Co {
  owner: TestActor;
  orgId: string;
}

async function company(label: string): Promise<Co> {
  const owner = await registerUser(api, label);
  const orgId = await createOrganization(api, owner, `${label} Co`);
  return { owner, orgId };
}

async function mintKey(co: Co, scopes: string[]): Promise<string> {
  const res = await api.request({
    method: 'POST',
    url: '/organization/api-keys',
    cookie: co.owner.cookie,
    payload: { name: 'k', mode: 'live', scopes },
  });
  expect(res.statusCode, res.body).toBe(201);
  return (JSON.parse(res.body) as { key: string }).key;
}

const json = <T = Record<string, unknown>>(res: { body: string }) => JSON.parse(res.body) as T;

function signed(body: object, secret = SECRET, t = Math.floor(Date.now() / 1000)) {
  const raw = JSON.stringify(body);
  return {
    method: 'POST' as const,
    url: '/webhooks/inbound-email',
    payload: raw,
    headers: { 'content-type': 'application/json', 'hrvoice-signature': `t=${t},v1=${signPayload(secret, t, raw)}` },
  };
}

const service = () => api.built.app.get<symbol, SupportService>(SUPPORT_SERVICE);

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      hits.push({ headers: req.headers, body });
      res.writeHead(200).end('ok');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  hookUrl = `http://localhost:${(server.address() as AddressInfo).port}/hook`;

  api = await startApi({ PLATFORM_ADMIN_EMAILS: ADMIN_EMAIL, INBOUND_EMAIL_SECRET: SECRET, SUPPORT_EMAIL: 'support@example.test' });
  app = appDatabase();
  su = superDatabase();
  const res = await api.request({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    payload: { email: ADMIN_EMAIL, password: 'correct-horse-battery-staple', name: 'Founder' },
  });
  adminCookie = sessionCookie(res);
});

afterAll(async () => {
  await api?.close();
  await app?.close();
  await su?.close();
  server?.close();
});

describe('pure helpers', () => {
  it('finds the ticket ref in the address, the subject or In-Reply-To', () => {
    expect(ticketRefIn({ to: 'Support <support+abcdef012345@x.com>', subject: 'hi' })).toBe('abcdef012345');
    expect(ticketRefIn({ to: ['a@b.c'], subject: 'Re: help [#ABCDEF012345]' })).toBe('abcdef012345');
    expect(ticketRefIn({ to: 'support@x.com', subject: 'hi', inReplyTo: '<support+abcdef012345@x.com>' })).toBe('abcdef012345');
    expect(ticketRefIn({ to: 'support@x.com', subject: 'no ref here' })).toBeNull();
  });

  it('keeps only the new part of an emailed reply', () => {
    expect(visibleReply('Thanks, fixed.\n\nOn Tue, 20 Oct 2026 Support wrote:\n> old')).toBe('Thanks, fixed.');
    expect(visibleReply('Yes\r\n> quoted')).toBe('Yes');
    expect(visibleReply('Line 1\nLine 2')).toBe('Line 1\nLine 2');
  });

  it('checks the inbound signature and its age', () => {
    const t = 1_800_000_000;
    const good = `t=${t},v1=${signPayload('s', t, 'body')}`;
    expect(verifyInboundSignature('s', good, 'body', t)).toBe(true);
    expect(verifyInboundSignature('s', good, 'body!', t)).toBe(false);
    expect(verifyInboundSignature('other', good, 'body', t)).toBe(false);
    expect(verifyInboundSignature('s', good, 'body', t + 301)).toBe(false);
    expect(verifyInboundSignature('', good, 'body', t)).toBe(false);
  });

  it('subjects, statuses and status colours', () => {
    expect(subjectFrom('\n  Calls fail at 9am\nmore')).toBe('Calls fail at 9am');
    expect(subjectFrom('x'.repeat(100))).toHaveLength(80);
    expect(statusAfterCustomer('open')).toBe('open');
    expect(statusAfterCustomer('waiting_on_customer')).toBe('waiting_on_us');
    expect(statusAfterCustomer('solved')).toBe('waiting_on_us');
    expect(combine([true, true])).toBe('operational');
    expect(combine([true, false])).toBe('degraded');
    expect(combine([false])).toBe('down');
    expect(combine([])).toBe('down');
  });
});

describe('row-level security on support tables', () => {
  it('companies see only their own tickets; unassigned tickets only the platform admin sees', async () => {
    const a = await company('rls-a');
    const b = await company('rls-b');
    const insert = (org: string | null, ref: string) =>
      su.db.execute<{ id: string }>(sql`
        insert into support_tickets (organization_id, ref, subject, channel, requester_email)
        values (${org}, ${ref}, 'x', 'dashboard', 'r@example.test') returning id`);
    const refA = Math.random().toString(16).slice(2, 14).padEnd(12, '0');
    const refU = Math.random().toString(16).slice(2, 14).padEnd(12, '1');
    const [ta] = await insert(a.orgId, refA);
    const [tu] = await insert(null, refU);
    await su.db.execute(sql`insert into support_messages (ticket_id, author_kind, body) values (${ta!.id}, 'customer', 'secret A')`);
    await su.db.execute(sql`insert into support_messages (ticket_id, author_kind, body) values (${tu!.id}, 'customer', 'lead')`);

    const seen = (org: Co) =>
      withTenantContext(app.db, { organizationId: org.orgId, userId: org.owner.userId }, async (tx) => ({
        tickets: (await tx.execute<{ id: string }>(sql`select id from support_tickets`)).map((r) => r.id),
        messages: (await tx.execute<{ body: string }>(sql`select body from support_messages`)).map((r) => r.body),
      }));
    const asA = await seen(a);
    expect(asA.tickets).toContain(ta!.id);
    expect(asA.tickets).not.toContain(tu!.id);
    expect(asA.messages).toContain('secret A');
    expect(asA.messages).not.toContain('lead');
    const asB = await seen(b);
    expect(asB.tickets).not.toContain(ta!.id);
    expect(asB.tickets).not.toContain(tu!.id);
    expect(asB.messages).toEqual([]);

    // No context at all: nothing.
    const none = await withoutTenantContext(app.db, (tx) => tx.execute(sql`select id from support_tickets`));
    expect(none.length).toBe(0);

    // The platform admin sees both.
    const asAdmin = await withPlatformAdminContext(app.db, a.owner.userId, (tx) =>
      tx.execute<{ id: string }>(sql`select id from support_tickets where id in (${ta!.id}, ${tu!.id})`),
    );
    expect(asAdmin.length).toBe(2);

    // A company cannot file an unassigned ticket, or move its ticket away.
    await expectRlsDenied(() =>
      withTenantContext(app.db, { organizationId: a.orgId, userId: a.owner.userId }, (tx) =>
        tx.execute(sql`insert into support_tickets (organization_id, ref, subject, channel, requester_email)
                       values (null, 'aaaaaaaaaaaa', 'x', 'chat', 'x@y.z')`),
      ),
    );
    await expectRlsDenied(() =>
      withTenantContext(app.db, { organizationId: a.orgId, userId: a.owner.userId }, (tx) =>
        tx.execute(sql`update support_tickets set organization_id = ${b.orgId} where id = ${ta!.id}`),
      ),
    );

    // A lookup by ref sees that ticket only, and cannot write on a company's ticket.
    const looked = await withSupportLookupContext(app.db, { ref: refU }, (tx) =>
      tx.execute<{ id: string }>(sql`select id from support_tickets`),
    );
    expect(looked.map((r) => r.id)).toEqual([tu!.id]);
    const changed = await withSupportLookupContext(app.db, { ref: refA }, (tx) =>
      tx.execute(sql`update support_tickets set status = 'solved' where id = ${ta!.id} returning id`),
    );
    expect(changed.length).toBe(0);
    await expectRlsDenied(() =>
      withSupportLookupContext(app.db, { ref: refU }, (tx) =>
        tx.execute(sql`update support_tickets set organization_id = ${a.orgId} where id = ${tu!.id}`),
      ),
    );
    // Messages are append-only for the app role.
    await expect(
      withPlatformAdminContext(app.db, a.owner.userId, (tx) => tx.execute(sql`delete from support_messages where ticket_id = ${tu!.id}`)),
    ).rejects.toThrow();
  });
});

describe('dashboard tickets', () => {
  it('create, list mine, get, reply, close; another company gets 404', async () => {
    const a = await company('dash-a');
    const b = await company('dash-b');
    const job = await api.request({ method: 'POST', url: '/jobs', cookie: a.owner.cookie, payload: { title: 'Picker' } });
    const jobId = json<{ id?: string; job?: { id: string } }>(job).id ?? json<{ job: { id: string } }>(job).job.id;

    const before = api.outbox.length;
    const created = await api.request({
      method: 'POST',
      url: '/support/tickets',
      cookie: a.owner.cookie,
      payload: { body: 'Calls to this job fail\nsince this morning', jobId },
    });
    expect(created.statusCode, created.body).toBe(201);
    const t = json<{ id: string; ref: string; subject: string; status: string; jobId: string; messages: unknown[] }>(created);
    expect(t).toMatchObject({ subject: 'Calls to this job fail', status: 'open', jobId });
    expect(t.messages).toHaveLength(1);
    // The founder hears about every new customer message.
    expect(api.outbox.slice(before).some((m) => m.to === ADMIN_EMAIL && m.subject.includes(`[#${t.ref}]`))).toBe(true);

    // Another company's job id is "not found", like any cross-company id.
    const foreignJob = await api.request({ method: 'POST', url: '/support/tickets', cookie: b.owner.cookie, payload: { body: 'x', jobId } });
    expect(foreignJob.statusCode).toBe(404);

    const list = await api.request({ method: 'GET', url: '/support/tickets', cookie: a.owner.cookie });
    expect(json<{ tickets: { id: string }[] }>(list).tickets.map((x) => x.id)).toContain(t.id);
    expect(json<{ tickets: { id: string }[] }>(await api.request({ method: 'GET', url: '/support/tickets', cookie: b.owner.cookie })).tickets).toEqual([]);

    expect((await api.request({ method: 'GET', url: `/support/tickets/${t.id}`, cookie: b.owner.cookie })).statusCode).toBe(404);
    expect((await api.request({ method: 'POST', url: `/support/tickets/${t.id}/messages`, cookie: b.owner.cookie, payload: { body: 'x' } })).statusCode).toBe(404);

    const reply = await api.request({ method: 'POST', url: `/support/tickets/${t.id}/messages`, cookie: a.owner.cookie, payload: { body: 'Still failing' } });
    expect(reply.statusCode, reply.body).toBe(201);
    const closed = await api.request({ method: 'POST', url: `/support/tickets/${t.id}/close`, cookie: a.owner.cookie });
    expect(json<{ status: string; messages: unknown[] }>(closed)).toMatchObject({ status: 'solved' });
    expect(json<{ messages: unknown[] }>(closed).messages).toHaveLength(2);
  });

  it('attaches the company\'s recent integration errors as context', async () => {
    const a = await company('ctx');
    const [ep] = await su.db.execute<{ id: string }>(sql`
      insert into webhook_endpoints (organization_id, url, secret, events)
      values (${a.orgId}, 'https://example.test/h', 's', array['call.completed']) returning id`);
    await su.db.execute(sql`
      insert into webhook_deliveries (organization_id, endpoint_id, event, payload, status, attempts, last_status_code, last_error)
      values (${a.orgId}, ${ep!.id}, 'call.completed', '{}'::jsonb, 'failed', 13, 500, 'HTTP 500')`);
    const created = await api.request({ method: 'POST', url: '/support/tickets', cookie: a.owner.cookie, payload: { body: 'Webhooks?' } });
    const id = json<{ id: string }>(created).id;
    const got = await api.request({ method: 'GET', url: `/admin/support/tickets/${id}`, cookie: adminCookie });
    expect(got.statusCode, got.body).toBe(200);
    const ctx = json<{ context: { recentErrors: { kind: string; detail: string }[] }; organizationId: string }>(got);
    expect(ctx.organizationId).toBe(a.orgId);
    expect(ctx.context.recentErrors).toEqual([expect.objectContaining({ kind: 'webhook', detail: 'HTTP 500' })]);
    // Customers never get the context block back.
    const mine = await api.request({ method: 'GET', url: `/support/tickets/${id}`, cookie: a.owner.cookie });
    expect(mine.body).not.toContain('recentErrors');
  });
});

describe('/v1/tickets', () => {
  it('works with the support scope, refuses without it, and keys stay confined to /v1', async () => {
    const a = await company('v1-a');
    const b = await company('v1-b');
    const key = await mintKey(a, ['support']);
    const noSupport = await mintKey(a, ['jobs']);
    const keyB = await mintKey(b, ['support']);
    const bearer = (k: string) => ({ authorization: `Bearer ${k}` });

    const created = await api.request({
      method: 'POST',
      url: '/v1/tickets',
      headers: { ...bearer(key), 'idempotency-key': 'once' },
      payload: { body: 'From our ATS', channel: 'mcp' },
    });
    expect(created.statusCode, created.body).toBe(201);
    const t = json<{ id: string; channel: string }>(created);
    expect(t.channel).toBe('mcp');
    const again = await api.request({
      method: 'POST',
      url: '/v1/tickets',
      headers: { ...bearer(key), 'idempotency-key': 'once' },
      payload: { body: 'From our ATS', channel: 'mcp' },
    });
    expect(json<{ id: string }>(again).id).toBe(t.id);

    const list = await api.request({ method: 'GET', url: '/v1/tickets?limit=1', headers: bearer(key) });
    expect(list.statusCode).toBe(200);
    expect(json<{ tickets: { id: string }[] }>(list).tickets[0]!.id).toBe(t.id);
    const msg = await api.request({ method: 'POST', url: `/v1/tickets/${t.id}/messages`, headers: bearer(key), payload: { body: 'More detail' } });
    expect(msg.statusCode, msg.body).toBe(201);
    const got = await api.request({ method: 'GET', url: `/v1/tickets/${t.id}`, headers: bearer(key) });
    expect(json<{ messages: unknown[] }>(got).messages).toHaveLength(2);

    expect((await api.request({ method: 'GET', url: '/v1/tickets', headers: bearer(noSupport) })).statusCode).toBe(403);
    expect((await api.request({ method: 'GET', url: `/v1/tickets/${t.id}`, headers: bearer(keyB) })).statusCode).toBe(404);
    // Keys never reach the dashboard or admin doors.
    expect((await api.request({ method: 'GET', url: '/support/tickets', headers: bearer(key) })).statusCode).toBe(403);
    expect((await api.request({ method: 'GET', url: '/admin/support/tickets', headers: bearer(key) })).statusCode).toBe(403);
  });
});

describe('public chat', () => {
  it('needs an email, makes an unassigned ticket, and the token reads only that chat', async () => {
    const ip = nextIp();
    const noEmail = await api.request({ method: 'POST', url: '/public/support/chats', payload: { body: 'Hi' }, remoteAddress: ip });
    expect(noEmail.statusCode).toBe(422);
    const created = await api.request({
      method: 'POST',
      url: '/public/support/chats',
      payload: { email: 'Visitor@Example.test', name: 'Asha', body: 'Do you support Hindi calls?' },
      remoteAddress: ip,
    });
    expect(created.statusCode, created.body).toBe(201);
    const { token, ticket } = json<{ token: string; ticket: { id: string; channel: string } }>(created);
    expect(token).toMatch(/^[0-9A-Za-z]{32}$/);
    expect(ticket.channel).toBe('chat');

    const rows = await su.db.execute<{ organization_id: string | null; requester_email: string; visitor_token_hash: string }>(
      sql`select organization_id, requester_email, visitor_token_hash from support_tickets where id = ${ticket.id}`,
    );
    expect(rows[0]).toMatchObject({ organization_id: null, requester_email: 'visitor@example.test' });
    expect(rows[0]!.visitor_token_hash).not.toBe(token);

    const reply = await api.request({ method: 'POST', url: `/public/support/chats/${token}/messages`, payload: { body: 'Also Tamil?' }, remoteAddress: ip });
    expect(reply.statusCode, reply.body).toBe(201);
    const poll = await api.request({ method: 'GET', url: `/public/support/chats/${token}`, remoteAddress: ip });
    expect(json<{ messages: { body: string }[] }>(poll).messages.map((m) => m.body)).toEqual(['Do you support Hindi calls?', 'Also Tamil?']);
    expect((await api.request({ method: 'GET', url: `/public/support/chats/${'x'.repeat(32)}`, remoteAddress: ip })).statusCode).toBe(404);

    // Visible in the founder's inbox as unassigned, never in a company's list.
    const inbox = await api.request({ method: 'GET', url: '/admin/support/tickets?unassigned=1', cookie: adminCookie });
    expect(json<{ tickets: { id: string; organizationId: string | null }[] }>(inbox).tickets.find((x) => x.id === ticket.id)).toMatchObject({
      organizationId: null,
    });
  });

  it('is rate limited per IP', async () => {
    const ip = nextIp();
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await api.request({ method: 'POST', url: '/public/support/chats', payload: { email: 'a@b.test', body: `spam ${i}` }, remoteAddress: ip });
      codes.push(res.statusCode);
    }
    expect(codes.slice(0, 5)).toEqual([201, 201, 201, 201, 201]);
    expect(codes[5]).toBe(429);
    // Another visitor is unaffected.
    const other = await api.request({ method: 'POST', url: '/public/support/chats', payload: { email: 'c@d.test', body: 'hi' }, remoteAddress: nextIp() });
    expect(other.statusCode).toBe(201);
  });

  it('an unanswered chat emails the customer once, after the wait', async () => {
    const created = await api.request({
      method: 'POST',
      url: '/public/support/chats',
      payload: { email: 'waiting@example.test', body: 'Hello?' },
      remoteAddress: nextIp(),
    });
    const { token, ticket } = json<{ token: string; ticket: { ref: string; messages: { id: string }[] } }>(created);
    const before = api.outbox.length;
    expect(await service().checkUnanswered({ ref: ticket.ref, messageId: ticket.messages[0]!.id })).toBe(true);
    expect(api.outbox.slice(before).filter((m) => m.to === 'waiting@example.test')).toHaveLength(1);
    // Its own notice now follows the message, so a second run stays quiet.
    expect(await service().checkUnanswered({ ref: ticket.ref, messageId: ticket.messages[0]!.id })).toBe(false);
    const poll = await api.request({ method: 'GET', url: `/public/support/chats/${token}`, remoteAddress: nextIp() });
    expect(json<{ messages: { authorKind: string }[] }>(poll).messages.map((m) => m.authorKind)).toEqual(['customer', 'system']);
  });
});

describe('founder inbox', () => {
  it('is 404 for anyone but a platform admin', async () => {
    const a = await company('not-admin');
    expect((await api.request({ method: 'GET', url: '/admin/support/tickets', cookie: a.owner.cookie })).statusCode).toBe(404);
    expect((await api.request({ method: 'GET', url: '/admin/support/tickets' })).statusCode).toBe(401);
  });

  it('staff reply: customer email + ticket.updated webhook; status change and linking', async () => {
    const a = await company('staff');
    const key = await mintKey(a, ['webhooks']);
    const ep = await api.request({
      method: 'POST',
      url: '/v1/webhook-endpoints',
      headers: { authorization: `Bearer ${key}` },
      payload: { url: hookUrl, events: ['ticket.updated'] },
    });
    expect(ep.statusCode, ep.body).toBe(201);
    const secret = json<{ secret: string }>(ep).secret;

    const t = json<{ id: string; ref: string }>(
      await api.request({ method: 'POST', url: '/support/tickets', cookie: a.owner.cookie, payload: { body: 'Help please' } }),
    );
    const before = api.outbox.length;
    const reply = await api.request({ method: 'POST', url: `/admin/support/tickets/${t.id}/messages`, cookie: adminCookie, payload: { body: 'Fixed on our side.' } });
    expect(reply.statusCode, reply.body).toBe(201);
    const mail = api.outbox.slice(before).find((m) => m.to === a.owner.email);
    expect(mail?.subject).toContain(`[#${t.ref}]`);
    expect(mail?.text).toContain('Fixed on our side.');

    const deliveries = await su.db.execute<{ id: string; payload: { type: string; data: { status: string; message: { body: string } } } }>(sql`
      select id, payload from webhook_deliveries where organization_id = ${a.orgId} and event = 'ticket.updated'`);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.payload.data).toMatchObject({ status: 'waiting_on_customer', message: { body: 'Fixed on our side.' } });
    await handleWebhookJob(api.built.database, { organizationId: a.orgId, deliveryId: deliveries[0]!.id });
    const hit = hits.find((h) => h.body.includes(t.id))!;
    const [, ts, v1] = /t=(\d+),v1=([0-9a-f]+)/.exec(String(hit.headers['hrvoice-signature']))!;
    expect(v1).toBe(signPayload(secret, Number(ts), hit.body));

    const solved = await api.request({ method: 'PATCH', url: `/admin/support/tickets/${t.id}`, cookie: adminCookie, payload: { status: 'solved' } });
    expect(json<{ status: string }>(solved).status).toBe('solved');
    const mine = json<{ messages: { authorKind: string }[]; status: string }>(
      await api.request({ method: 'GET', url: `/support/tickets/${t.id}`, cookie: a.owner.cookie }),
    );
    expect(mine.status).toBe('solved');
    expect(mine.messages.map((m) => m.authorKind)).toEqual(['customer', 'staff']);

    // Link an unassigned chat to this company: it then shows in their list.
    const chat = json<{ ticket: { id: string } }>(
      await api.request({ method: 'POST', url: '/public/support/chats', payload: { email: a.owner.email, body: 'It is me' }, remoteAddress: nextIp() }),
    );
    const linked = await api.request({ method: 'POST', url: `/admin/support/tickets/${chat.ticket.id}/link`, cookie: adminCookie, payload: { organizationId: a.orgId } });
    expect(linked.statusCode, linked.body).toBe(201);
    expect(json<{ organizationId: string }>(linked).organizationId).toBe(a.orgId);
    expect((await api.request({ method: 'POST', url: `/admin/support/tickets/${chat.ticket.id}/link`, cookie: adminCookie, payload: { organizationId: a.orgId } })).statusCode).toBe(409);
    expect((await api.request({ method: 'GET', url: `/support/tickets/${chat.ticket.id}`, cookie: a.owner.cookie })).statusCode).toBe(200);
  });
});

describe('inbound email', () => {
  it('refuses a missing or wrong signature', async () => {
    const body = { from: 'x@y.test', to: 'support@example.test', subject: 'hi', text: 'hello' };
    expect((await api.request({ method: 'POST', url: '/webhooks/inbound-email', payload: body })).statusCode).toBe(401);
    expect((await api.request(signed(body, 'wrong'))).statusCode).toBe(401);
    expect((await api.request(signed(body, SECRET, Math.floor(Date.now() / 1000) - 3600))).statusCode).toBe(401);
  });

  it('opens a ticket, threads replies by ref, and ignores strangers', async () => {
    const res = await api.request(signed({ from: 'Lead <lead@prospect.test>', to: 'support@example.test', subject: 'Pricing?', text: 'How much per screen?' }));
    expect(res.statusCode, res.body).toBe(201);
    const { ref, created } = json<{ ref: string; created: boolean }>(res);
    expect(created).toBe(true);
    const [row] = await su.db.execute<{ id: string; organization_id: string | null; channel: string }>(sql`select id, organization_id, channel from support_tickets where ref = ${ref}`);
    expect(row).toMatchObject({ organization_id: null, channel: 'email' });

    const replied = await api.request(
      signed({ from: 'lead@prospect.test', to: `support+${ref}@example.test`, subject: 'Re: Pricing?', text: 'And for 500 a month?\n\nOn Mon, Support wrote:\n> old' }),
    );
    expect(json<{ created: boolean }>(replied).created).toBe(false);
    const stranger = await api.request(signed({ from: 'evil@x.test', to: 'support@example.test', subject: `Re: [#${ref}]`, text: 'inject' }));
    expect(json<{ ignored?: string }>(stranger).ignored).toBe('sender_mismatch');
    const founder = await api.request(signed({ from: ADMIN_EMAIL, to: `support+${ref}@example.test`, subject: 'Re', text: 'Rs 30.' }));
    expect(founder.statusCode).toBe(201);

    const msgs = await su.db.execute<{ author_kind: string; body: string }>(sql`
      select author_kind, body from support_messages where ticket_id = ${row!.id} order by created_at`);
    expect(msgs.map((m) => [m.author_kind, m.body])).toEqual([
      ['customer', 'How much per screen?'],
      ['customer', 'And for 500 a month?'],
      ['staff', 'Rs 30.'],
    ]);
  });

  it('files mail from a known user into their company', async () => {
    const a = await company('mailer');
    const res = await api.request(signed({ from: a.owner.email, to: 'support@example.test', subject: 'Calls stuck', text: 'Since 10am' }));
    const { ref } = json<{ ref: string }>(res);
    const [row] = await su.db.execute<{ organization_id: string }>(sql`select organization_id from support_tickets where ref = ${ref}`);
    expect(row!.organization_id).toBe(a.orgId);
  });
});

describe('/status', () => {
  it('is not public: anonymous is refused, a signed-in member gets the same body', async () => {
    expect((await api.request({ method: 'GET', url: '/status' })).statusCode).toBe(401);
    const a = await company('statusreader');
    const res = await api.request({ method: 'GET', url: '/status', cookie: a.owner.cookie });
    expect(res.statusCode).toBe(200);
    const body = json<{ components: { id: string; state: string }[] }>(res);
    expect(body.components.map((c) => c.id)).toEqual(['api', 'calls', 'webhooks']);
    expect(body.components[0]!.state).toBe('operational');
    for (const c of body.components) expect(['operational', 'degraded', 'down']).toContain(c.state);
  });
});
