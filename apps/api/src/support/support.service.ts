/**
 * Support tickets: one model for every way in (dashboard, live chat, email,
 * /v1 API, MCP) and one inbox for the founder.
 *
 * Contexts (migration 0036):
 *   - a company's own tickets: withTenantContext (RLS: organization_id = org);
 *   - the founder's inbox: withPlatformAdminContext (sees every ticket,
 *     including unassigned ones with no company);
 *   - a logged-out visitor (token), inbound email and the 5-minute check
 *     (ticket ref): withSupportLookupContext, which exposes only the ticket
 *     named. A company ticket found that way is then written under the
 *     company's tenant context.
 *
 * Tickets never carry scores or hire advice; the context attached is
 * integration errors only (failed deliveries, failed/skipped calls, refused
 * API requests).
 */

import { createHash, randomBytes } from 'node:crypto';
import {
  sql,
  withActorContext,
  withPlatformAdminContext,
  withSupportLookupContext,
  withTenantContext,
  withoutTenantContext,
  type Database,
  type TenantTransaction,
} from '@platform/db';
import type { NotificationProvider } from '@platform/providers';

import { ApiError } from '../errors.js';
import type { JobQueue } from '../jobs/queue.js';
import { randomBase62 } from '../integrations/api-keys.service.js';
import { emitTicketEvent } from '../integrations/events.js';
import { ticketRefIn, visibleReply } from './inbound-email.js';

export const TICKET_STATUSES = ['open', 'waiting_on_us', 'waiting_on_customer', 'solved'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const TICKET_CHANNELS = ['dashboard', 'chat', 'email', 'api', 'mcp'] as const;
export type TicketChannel = (typeof TICKET_CHANNELS)[number];

const SYSTEM_USER = '00000000-0000-0000-0000-000000000000';
/** An unanswered chat message emails the customer after this long. */
export const UNANSWERED_AFTER_MS = 5 * 60_000;

export interface SupportActor {
  readonly organizationId: string;
  readonly userId: string;
  readonly email: string;
  readonly name: string;
}

export interface MessageView {
  id: string;
  authorKind: 'customer' | 'staff' | 'system';
  body: string;
  createdAt: string;
}

export interface TicketView {
  id: string;
  ref: string;
  subject: string;
  status: TicketStatus;
  channel: TicketChannel;
  jobId: string | null;
  candidateId: string | null;
  callId: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  messages?: MessageView[];
}

export interface IntegrationError {
  kind: 'webhook' | 'call' | 'api';
  at: string;
  summary: string;
  detail: string | null;
}

export interface AdminTicketView extends TicketView {
  organizationId: string | null;
  organizationName: string | null;
  requesterEmail: string;
  requesterName: string | null;
  lastMessage: MessageView | null;
  /** Customer messages after the last staff reply. */
  unanswered: number;
  context?: {
    jobTitle: string | null;
    candidateName: string | null;
    recentErrors: IntegrationError[];
    snapshotAt: string | null;
  };
}

export interface CreateInput {
  subject?: string | undefined;
  body: string;
  channel: TicketChannel;
  jobId?: string | undefined;
  candidateId?: string | undefined;
  callId?: string | undefined;
}

export interface InboundEmail {
  from: string;
  to: string | string[];
  subject: string;
  text: string;
  inReplyTo?: string | undefined;
}

export interface SupportService {
  create(a: SupportActor, input: CreateInput): Promise<TicketView>;
  list(a: SupportActor, opts: { mine: boolean; limit: number; cursor?: { createdAt: string; id: string } | undefined }): Promise<(TicketView & { created_at: string })[]>;
  get(a: SupportActor, id: string): Promise<TicketView>;
  reply(a: SupportActor, id: string, body: string): Promise<MessageView>;
  close(a: SupportActor, id: string): Promise<TicketView>;

  publicCreate(input: { email: string; name?: string | undefined; body: string }): Promise<{ token: string; ticket: TicketView }>;
  publicGet(token: string): Promise<TicketView>;
  publicReply(token: string, body: string): Promise<MessageView>;

  inboundEmail(mail: InboundEmail): Promise<{ ref: string | null; created: boolean; ignored?: string }>;
  checkUnanswered(job: { ref: string; messageId: string }): Promise<boolean>;

  adminList(adminUserId: string, filter: { status?: TicketStatus | undefined; unassigned?: boolean | undefined }): Promise<AdminTicketView[]>;
  adminGet(adminUserId: string, id: string): Promise<AdminTicketView>;
  adminReply(admin: { userId: string; email: string }, id: string, body: string): Promise<MessageView>;
  adminSetStatus(adminUserId: string, id: string, status: TicketStatus): Promise<AdminTicketView>;
  adminLink(adminUserId: string, id: string, organizationId: string): Promise<AdminTicketView>;
  adminOrganizations(adminUserId: string): Promise<{ id: string; name: string }[]>;
}

export interface SupportDeps {
  database: Database;
  notifications: NotificationProvider;
  queue: Pick<JobQueue, 'enqueueWebhook' | 'enqueueSupportCheck'> | null;
  webUrl: string;
  supportEmail: string;
  adminEmails: readonly string[];
  isPlatformAdmin(email: string): boolean;
  logger: { error(obj: object, msg: string): void };
  now?: () => Date;
}

type TicketRow = {
  id: string;
  organization_id: string | null;
  ref: string;
  subject: string;
  status: TicketStatus;
  channel: TicketChannel;
  job_id: string | null;
  candidate_id: string | null;
  call_id: string | null;
  requester_email: string;
  requester_name: string | null;
  context: { recentErrors?: IntegrationError[]; snapshotAt?: string };
  created_at: string;
  updated_at: string;
  last_message_at: string;
};

type MessageRow = { id: string; author_kind: MessageView['authorKind']; body: string; created_at: string };

const TICKET_COLUMNS = sql`id, organization_id, ref, subject, status, channel, job_id, candidate_id,
  call_id, requester_email, requester_name, context, created_at::text, updated_at::text,
  last_message_at::text`;

const iso = (v: string) => new Date(v).toISOString();
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
/** 12 lowercase hex characters: safe in an email local part and a subject tag. */
export const newRef = () => randomBytes(6).toString('hex');

/** First line of the message, trimmed to a subject. */
export function subjectFrom(body: string, fallback = 'Help request'): string {
  const line = body.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  if (!line) return fallback;
  return line.length > 80 ? `${line.slice(0, 77).replace(/\s+$/, "")}...` : line;
}

/** Where a customer message moves the ticket: a fresh ticket stays open, anything else waits on us. */
export function statusAfterCustomer(current: TicketStatus): TicketStatus {
  return current === 'open' ? 'open' : 'waiting_on_us';
}

function toMessage(r: MessageRow): MessageView {
  return { id: r.id, authorKind: r.author_kind, body: r.body, createdAt: iso(r.created_at) };
}

function toTicket(r: TicketRow, messages?: MessageRow[]): TicketView {
  return {
    id: r.id,
    ref: r.ref,
    subject: r.subject,
    status: r.status,
    channel: r.channel,
    jobId: r.job_id,
    candidateId: r.candidate_id,
    callId: r.call_id,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    lastMessageAt: iso(r.last_message_at),
    ...(messages ? { messages: messages.map(toMessage) } : {}),
  };
}

/** Bare address from "Name <a@b.c>", lower-cased. */
export function emailAddress(raw: string): string {
  const m = /<([^>]+)>/.exec(raw);
  return (m ? m[1]! : raw).trim().toLowerCase();
}

/** The company's last 20 integration problems, newest first. Runs under the company's context. */
async function recentErrors(tx: TenantTransaction, organizationId: string): Promise<IntegrationError[]> {
  const rows = await tx.execute<{ kind: IntegrationError['kind']; at: string; summary: string; detail: string | null }>(sql`
    (select 'webhook' as kind, d.created_at::text as at,
            'Webhook ' || d.event || ' ' || d.status as summary,
            coalesce(d.last_error, 'HTTP ' || d.last_status_code::text) as detail
     from webhook_deliveries d
     where d.organization_id = ${organizationId}
       and (d.status = 'failed' or d.last_error is not null)
     order by d.created_at desc limit 20)
    union all
    (select 'call', cr.updated_at::text, 'Call ' || cr.status, cr.reason
     from call_requests cr
     where cr.organization_id = ${organizationId} and cr.status in ('failed', 'skipped')
     order by cr.updated_at desc limit 20)
    union all
    (select 'api', a.created_at::text,
            'API ' || coalesce(a.metadata->>'method', '') || ' ' || split_part(coalesce(a.metadata->>'url', ''), '?', 1),
            'Refused: key lacks ' || coalesce(a.metadata->>'permission', 'permission')
     from audit_events a
     where a.organization_id = ${organizationId} and a.event_type = 'authz.denied'
       and a.metadata ? 'apiKeyId'
     order by a.created_at desc limit 20)
    order by at desc
    limit 20
  `);
  return rows.map((r) => ({ kind: r.kind, at: iso(r.at), summary: r.summary, detail: r.detail }));
}

export function createSupportService(deps: SupportDeps): SupportService {
  const db = deps.database.db;
  const now = deps.now ?? (() => new Date());
  const [supportLocal, supportDomain] = deps.supportEmail.split('@') as [string, string];
  const replyTo = (ref: string) => `${supportLocal}+${ref}@${supportDomain}`;
  const tenant = <T>(organizationId: string, userId: string, fn: (tx: TenantTransaction) => Promise<T>) =>
    withTenantContext(db, { organizationId, userId }, fn);
  const admin = <T>(userId: string, fn: (tx: TenantTransaction) => Promise<T>) =>
    withPlatformAdminContext(db, userId, fn);

  /** Send, never throw: a mail problem must not lose the message that was saved. */
  async function mail(params: { to: string; subject: string; text: string; replyTo?: string; idempotencyKey?: string }) {
    try {
      await deps.notifications.sendEmail(params);
    } catch (error) {
      deps.logger.error({ err: (error as Error).message }, 'support.email_failed');
    }
  }

  async function notifyFounder(t: TicketRow, body: string, orgName: string | null) {
    const who = t.requester_name ? `${t.requester_name} <${t.requester_email}>` : t.requester_email;
    for (const to of deps.adminEmails) {
      await mail({
        to,
        subject: `[#${t.ref}] ${t.subject}`,
        replyTo: replyTo(t.ref),
        text:
          `${who}${orgName ? ` (${orgName})` : ' (no company yet)'} wrote on ${t.channel}:\n\n${body}\n\n` +
          `Open the inbox: ${deps.webUrl}/admin/support?t=${t.id}\nOr reply to this email.`,
      });
    }
  }

  async function orgName(organizationId: string | null): Promise<string | null> {
    if (!organizationId) return null;
    const rows = await withoutTenantContext(db, (tx) =>
      tx.execute<{ name: string }>(sql`select name from organizations where id = ${organizationId}`),
    );
    return rows[0]?.name ?? null;
  }

  async function scheduleCheck(t: TicketRow, messageId: string) {
    if (t.channel !== 'chat') return;
    await deps.queue
      ?.enqueueSupportCheck({ ref: t.ref, messageId }, new Date(now().getTime() + UNANSWERED_AFTER_MS))
      .catch((error: unknown) => deps.logger.error({ err: (error as Error).message }, 'support.enqueue_failed'));
  }

  /** Append a message and move the ticket's status, in whatever context `tx` carries. */
  async function append(
    tx: TenantTransaction,
    t: TicketRow,
    m: { kind: MessageView['authorKind']; body: string; userId?: string | null; email?: string | null },
    status: TicketStatus,
  ): Promise<MessageRow> {
    const rows = await tx.execute<MessageRow>(sql`
      insert into support_messages (ticket_id, author_kind, author_user_id, author_email, body)
      values (${t.id}, ${m.kind}, ${m.userId ?? null}, ${m.email ?? null}, ${m.body})
      returning id, author_kind, body, created_at::text
    `);
    await tx.execute(sql`
      update support_tickets set status = ${status}, last_message_at = now(), updated_at = now()
      where id = ${t.id}
    `);
    return rows[0]!;
  }

  /** Ticket by ref or visitor token, in the lookup context. */
  async function lookup(l: { ref?: string; visitorTokenHash?: string }): Promise<TicketRow | null> {
    const rows = await withSupportLookupContext(db, l, (tx) =>
      tx.execute<TicketRow>(sql`
        select ${TICKET_COLUMNS} from support_tickets
        where ${l.ref ? sql`ref = ${l.ref}` : sql`visitor_token_hash = ${l.visitorTokenHash!}`}
      `),
    );
    return rows[0] ?? null;
  }

  /**
   * Write on a ticket found by lookup: unassigned → the lookup context (its
   * policies allow only that ticket); a company's → that company's context.
   */
  function onTicket<T>(t: TicketRow, fn: (tx: TenantTransaction) => Promise<T>): Promise<T> {
    return t.organization_id
      ? tenant(t.organization_id, SYSTEM_USER, fn)
      : withSupportLookupContext(db, { ref: t.ref }, fn);
  }

  async function customerMessage(t: TicketRow, body: string, author: { userId?: string | null; email: string }, tx?: TenantTransaction) {
    const write = (x: TenantTransaction) =>
      append(x, t, { kind: 'customer', body, userId: author.userId ?? null, email: author.email }, statusAfterCustomer(t.status));
    const row = tx ? await write(tx) : await onTicket(t, write);
    await notifyFounder(t, body, await orgName(t.organization_id));
    await scheduleCheck(t, row.id);
    return toMessage(row);
  }

  async function messagesOf(tx: TenantTransaction, ticketId: string): Promise<MessageRow[]> {
    return tx.execute<MessageRow>(sql`
      select id, author_kind, body, created_at::text from support_messages
      where ticket_id = ${ticketId} order by created_at, id
    `);
  }

  /** Related ids must be the company's own; anything else is "not found", like any cross-company id. */
  async function checkRelated(tx: TenantTransaction, organizationId: string, input: CreateInput) {
    const exists = async (q: ReturnType<typeof sql>) => (await tx.execute(q)).length > 0;
    if (input.jobId && !(await exists(sql`select 1 from jobs where id = ${input.jobId} and organization_id = ${organizationId}`))) {
      throw ApiError.notFound('Job');
    }
    if (
      input.candidateId &&
      !(await exists(sql`select 1 from candidates where id = ${input.candidateId} and organization_id = ${organizationId}`))
    ) {
      throw ApiError.notFound('Candidate');
    }
    if (
      input.callId &&
      !(await exists(sql`
        select 1 from voice_sessions where id = ${input.callId} and organization_id = ${organizationId}
        union all
        select 1 from call_requests where id = ${input.callId} and organization_id = ${organizationId}
      `))
    ) {
      throw ApiError.notFound('Call');
    }
  }

  async function createForOrg(
    organizationId: string,
    requester: { userId: string; email: string; name: string | null },
    input: CreateInput,
  ): Promise<{ row: TicketRow; messages: MessageRow[] }> {
    const out = await tenant(organizationId, requester.userId, async (tx) => {
      await checkRelated(tx, organizationId, input);
      const context = { recentErrors: await recentErrors(tx, organizationId), snapshotAt: now().toISOString() };
      const rows = await tx.execute<TicketRow>(sql`
        insert into support_tickets (organization_id, ref, subject, channel, job_id, candidate_id, call_id,
          requester_user_id, requester_email, requester_name, context)
        values (${organizationId}, ${newRef()}, ${input.subject?.trim() || subjectFrom(input.body)}, ${input.channel},
          ${input.jobId ?? null}, ${input.candidateId ?? null}, ${input.callId ?? null},
          ${requester.userId}, ${requester.email}, ${requester.name}, ${JSON.stringify(context)}::jsonb)
        returning ${TICKET_COLUMNS}
      `);
      const row = rows[0]!;
      const msg = await append(tx, row, { kind: 'customer', body: input.body, userId: requester.userId, email: requester.email }, 'open');
      return { row, msg };
    });
    await notifyFounder(out.row, input.body, await orgName(organizationId));
    await scheduleCheck(out.row, out.msg.id);
    return { row: out.row, messages: [out.msg] };
  }

  async function createUnassigned(
    requester: { email: string; name: string | null },
    channel: TicketChannel,
    subject: string,
    body: string,
    visitorTokenHash: string | null,
  ): Promise<{ row: TicketRow; messages: MessageRow[] }> {
    const ref = newRef();
    const out = await withSupportLookupContext(
      db,
      { ref, ...(visitorTokenHash ? { visitorTokenHash } : {}) },
      async (tx) => {
        const rows = await tx.execute<TicketRow>(sql`
          insert into support_tickets (organization_id, ref, visitor_token_hash, subject, channel,
            requester_email, requester_name)
          values (null, ${ref}, ${visitorTokenHash}, ${subject}, ${channel}, ${requester.email}, ${requester.name})
          returning ${TICKET_COLUMNS}
        `);
        const row = rows[0]!;
        const msg = await append(tx, row, { kind: 'customer', body, email: requester.email }, 'open');
        return { row, msg };
      },
    );
    await notifyFounder(out.row, body, null);
    await scheduleCheck(out.row, out.msg.id);
    return { row: out.row, messages: [out.msg] };
  }

  async function getOwn(a: SupportActor, id: string): Promise<TicketRow> {
    const rows = await tenant(a.organizationId, a.userId, (tx) =>
      tx.execute<TicketRow>(sql`
        select ${TICKET_COLUMNS} from support_tickets
        where id = ${id} and organization_id = ${a.organizationId}
      `),
    );
    if (!rows[0]) throw ApiError.notFound('Ticket');
    return rows[0];
  }

  async function adminRow(adminUserId: string, id: string): Promise<TicketRow> {
    const rows = await admin(adminUserId, (tx) =>
      tx.execute<TicketRow>(sql`select ${TICKET_COLUMNS} from support_tickets where id = ${id}`),
    );
    if (!rows[0]) throw ApiError.notFound('Ticket');
    return rows[0];
  }

  async function ticketUpdated(t: TicketRow, status: TicketStatus, last: MessageRow | null) {
    if (!t.organization_id) return;
    await emitTicketEvent(
      deps.database,
      deps.queue,
      t.organization_id,
      {
        ticketId: t.id,
        ref: t.ref,
        subject: t.subject,
        status,
        ...(last ? { message: { id: last.id, authorKind: last.author_kind, body: last.body, createdAt: iso(last.created_at) } } : {}),
      },
      deps.logger,
    );
  }

  const service: SupportService = {
    async create(a, input) {
      const { row, messages } = await createForOrg(a.organizationId, { userId: a.userId, email: a.email, name: a.name || null }, input);
      return toTicket(row, messages);
    },

    async list(a, opts) {
      const rows = await tenant(a.organizationId, a.userId, (tx) =>
        tx.execute<TicketRow>(sql`
          select ${TICKET_COLUMNS} from support_tickets
          where organization_id = ${a.organizationId}
            ${opts.mine ? sql`and requester_user_id = ${a.userId}` : sql``}
            ${opts.cursor ? sql`and (created_at, id) < (${opts.cursor.createdAt}::timestamptz, ${opts.cursor.id}::uuid)` : sql``}
          order by created_at desc, id desc
          limit ${opts.limit + 1}
        `),
      );
      return rows.map((r) => ({ ...toTicket(r), created_at: r.created_at }));
    },

    async get(a, id) {
      return tenant(a.organizationId, a.userId, async (tx) => {
        const rows = await tx.execute<TicketRow>(sql`
          select ${TICKET_COLUMNS} from support_tickets
          where id = ${id} and organization_id = ${a.organizationId}
        `);
        if (!rows[0]) throw ApiError.notFound('Ticket');
        return toTicket(rows[0], await messagesOf(tx, id));
      });
    },

    async reply(a, id, body) {
      const t = await getOwn(a, id);
      return tenant(a.organizationId, a.userId, (tx) =>
        customerMessage(t, body, { userId: a.userId, email: a.email }, tx),
      );
    },

    async close(a, id) {
      await getOwn(a, id);
      return tenant(a.organizationId, a.userId, async (tx) => {
        const rows = await tx.execute<TicketRow>(sql`
          update support_tickets set status = 'solved', updated_at = now()
          where id = ${id} and organization_id = ${a.organizationId}
          returning ${TICKET_COLUMNS}
        `);
        return toTicket(rows[0]!, await messagesOf(tx, id));
      });
    },

    async publicCreate(input) {
      const token = randomBase62(32);
      const { row, messages } = await createUnassigned(
        { email: input.email.trim().toLowerCase(), name: input.name?.trim() || null },
        'chat',
        subjectFrom(input.body, 'Website chat'),
        input.body,
        hashToken(token),
      );
      return { token, ticket: toTicket(row, messages) };
    },

    async publicGet(token) {
      const visitorTokenHash = hashToken(token);
      return withSupportLookupContext(db, { visitorTokenHash }, async (tx) => {
        const rows = await tx.execute<TicketRow>(sql`
          select ${TICKET_COLUMNS} from support_tickets where visitor_token_hash = ${visitorTokenHash}
        `);
        if (!rows[0]) throw ApiError.notFound('Chat');
        return toTicket(rows[0], await messagesOf(tx, rows[0].id));
      });
    },

    async publicReply(token, body) {
      const t = await lookup({ visitorTokenHash: hashToken(token) });
      if (!t) throw ApiError.notFound('Chat');
      return customerMessage(t, body, { email: t.requester_email });
    },

    async inboundEmail(m) {
      const from = emailAddress(m.from);
      const body = visibleReply(m.text);
      if (!body) return { ref: null, created: false, ignored: 'empty' };
      const ref = ticketRefIn(m);
      const t = ref ? await lookup({ ref }) : null;
      if (t) {
        if (from === t.requester_email.toLowerCase()) {
          await customerMessage(t, body, { email: from });
          return { ref: t.ref, created: false };
        }
        if (deps.isPlatformAdmin(from)) {
          await staffReply(t, { userId: null, email: from }, body);
          return { ref: t.ref, created: false };
        }
        // Someone else answering a ticket's thread: never let a stranger post into it.
        return { ref: t.ref, created: false, ignored: 'sender_mismatch' };
      }
      const subject = m.subject.replace(/\[#[a-z0-9]{12}\]/gi, '').replace(/^\s*(re|fwd?):\s*/i, '').trim() || subjectFrom(body);
      // A sender with an account files into their company; anyone else is a platform-level ticket.
      const user = (
        await withoutTenantContext(db, (tx) =>
          tx.execute<{ id: string; name: string }>(sql`
            select id, name from users where lower(email) = ${from} and status = 'active' limit 1
          `),
        )
      )[0];
      const orgId = user
        ? (
            await withActorContext(db, user.id, (tx) =>
              tx.execute<{ organization_id: string }>(sql`
                select organization_id from organization_memberships
                where user_id = ${user.id} and status = 'active'
                order by created_at limit 1
              `),
            )
          )[0]?.organization_id
        : undefined;
      const created =
        user && orgId
          ? await createForOrg(orgId, { userId: user.id, email: from, name: user.name }, { subject, body, channel: 'email' })
          : await createUnassigned({ email: from, name: null }, 'email', subject.slice(0, 200), body, null);
      return { ref: created.row.ref, created: true };
    },

    async checkUnanswered({ ref, messageId }) {
      const t = await lookup({ ref });
      if (!t || t.channel !== 'chat' || t.status === 'solved') return false;
      const sent = await onTicket(t, async (tx) => {
        const later = await tx.execute<{ author_kind: string }>(sql`
          select m.author_kind from support_messages m
          where m.ticket_id = ${t.id}
            and m.created_at >= (select created_at from support_messages where id = ${messageId} and ticket_id = ${t.id})
            and m.id <> ${messageId}
        `);
        // Answered, or a later message has its own check, or this one already sent the notice.
        if (later.length > 0) return false;
        await tx.execute(sql`
          insert into support_messages (ticket_id, author_kind, body)
          values (${t.id}, 'system', ${`No one has answered yet. We emailed ${t.requester_email} so you will not miss the reply.`})
        `);
        return true;
      });
      if (!sent) return false;
      await mail({
        to: t.requester_email,
        subject: `We have your message [#${t.ref}]`,
        replyTo: replyTo(t.ref),
        idempotencyKey: `support-unanswered-${messageId}`,
        text:
          `Thanks for writing to HRVoice support. Nobody has answered your chat yet, so we will reply to you here by email.\n\n` +
          `Your message: "${t.subject}"\n\nReply to this email to add anything.`,
      });
      return true;
    },

    async adminList(adminUserId, filter) {
      const rows = await admin(adminUserId, (tx) =>
        tx.execute<TicketRow & { org_name: string | null; last_kind: MessageView['authorKind'] | null; last_id: string | null; last_body: string | null; last_at: string | null; unanswered: number }>(sql`
          select t.id, t.organization_id, t.ref, t.subject, t.status, t.channel, t.job_id, t.candidate_id,
                 t.call_id, t.requester_email, t.requester_name, t.context, t.created_at::text,
                 t.updated_at::text, t.last_message_at::text,
                 o.name as org_name, lm.id as last_id, lm.author_kind as last_kind, lm.body as last_body,
                 lm.created_at::text as last_at,
                 (select count(*)::int from support_messages c
                  where c.ticket_id = t.id and c.author_kind = 'customer'
                    and c.created_at > coalesce((select max(s.created_at) from support_messages s
                                                 where s.ticket_id = t.id and s.author_kind = 'staff'), '-infinity')) as unanswered
          from support_tickets t
          left join organizations o on o.id = t.organization_id
          left join lateral (select id, author_kind, body, created_at from support_messages m
                             where m.ticket_id = t.id order by m.created_at desc, m.id desc limit 1) lm on true
          where true
            ${filter.status ? sql`and t.status = ${filter.status}` : sql``}
            ${filter.unassigned ? sql`and t.organization_id is null` : sql``}
          order by t.last_message_at desc
          limit 200
        `),
      );
      return rows.map((r) => ({
        ...toTicket(r),
        organizationId: r.organization_id,
        organizationName: r.org_name,
        requesterEmail: r.requester_email,
        requesterName: r.requester_name,
        unanswered: r.unanswered,
        lastMessage: r.last_id
          ? { id: r.last_id, authorKind: r.last_kind!, body: r.last_body!, createdAt: iso(r.last_at!) }
          : null,
      }));
    },

    async adminGet(adminUserId, id) {
      const { t, messages } = await admin(adminUserId, async (tx) => {
        const rows = await tx.execute<TicketRow>(sql`select ${TICKET_COLUMNS} from support_tickets where id = ${id}`);
        if (!rows[0]) throw ApiError.notFound('Ticket');
        return { t: rows[0], messages: await messagesOf(tx, id) };
      });
      // The related job and candidate are the company's data: read under its context.
      const related =
        t.organization_id && (t.job_id || t.candidate_id)
          ? await tenant(t.organization_id, SYSTEM_USER, async (tx) => {
              const job = t.job_id
                ? (await tx.execute<{ title: string }>(sql`select title from jobs where id = ${t.job_id} and organization_id = ${t.organization_id}`))[0]
                : undefined;
              const cand = t.candidate_id
                ? (await tx.execute<{ full_name: string }>(sql`select full_name from candidates where id = ${t.candidate_id} and organization_id = ${t.organization_id}`))[0]
                : undefined;
              return { jobTitle: job?.title ?? null, candidateName: cand?.full_name ?? null };
            })
          : { jobTitle: null, candidateName: null };
      const lastStaff = [...messages].reverse().findIndex((m) => m.author_kind === 'staff');
      const tail = lastStaff === -1 ? messages : messages.slice(messages.length - lastStaff);
      return {
        ...toTicket(t, messages),
        organizationId: t.organization_id,
        organizationName: await orgName(t.organization_id),
        requesterEmail: t.requester_email,
        requesterName: t.requester_name,
        unanswered: tail.filter((m) => m.author_kind === 'customer').length,
        lastMessage: messages.length ? toMessage(messages[messages.length - 1]!) : null,
        context: {
          ...related,
          recentErrors: t.context.recentErrors ?? [],
          snapshotAt: t.context.snapshotAt ?? null,
        },
      };
    },

    async adminReply(a, id, body) {
      const t = await adminRow(a.userId, id);
      return staffReply(t, { userId: a.userId, email: a.email }, body, a.userId);
    },

    async adminSetStatus(adminUserId, id, status) {
      const t = await adminRow(adminUserId, id);
      await admin(adminUserId, (tx) =>
        tx.execute(sql`update support_tickets set status = ${status}, updated_at = now() where id = ${id}`),
      );
      if (status !== t.status) await ticketUpdated(t, status, null);
      return service.adminGet(adminUserId, id);
    },

    async adminLink(adminUserId, id, organizationId) {
      const t = await adminRow(adminUserId, id);
      if (t.organization_id) throw ApiError.conflict('This ticket already belongs to a company.');
      if (!(await orgName(organizationId))) throw ApiError.notFound('Company');
      const context = await tenant(organizationId, SYSTEM_USER, async (tx) => ({
        recentErrors: await recentErrors(tx, organizationId),
        snapshotAt: now().toISOString(),
      }));
      await admin(adminUserId, (tx) =>
        tx.execute(sql`
          update support_tickets set organization_id = ${organizationId}, context = ${JSON.stringify(context)}::jsonb,
            updated_at = now()
          where id = ${id} and organization_id is null
        `),
      );
      return service.adminGet(adminUserId, id);
    },

    async adminOrganizations(adminUserId) {
      void adminUserId;
      return withoutTenantContext(db, (tx) =>
        tx.execute<{ id: string; name: string }>(sql`select id, name from organizations order by name limit 500`),
      ).then((rows) => rows.map((r) => ({ id: r.id, name: r.name })));
    },
  };
  return service;

  /** Staff message: ticket waits on the customer, who gets an email; the company's endpoints get ticket.updated. */
  async function staffReply(t: TicketRow, author: { userId: string | null; email: string }, body: string, adminUserId?: string) {
    const write = (tx: TenantTransaction) =>
      append(tx, t, { kind: 'staff', body, userId: author.userId, email: author.email }, 'waiting_on_customer');
    const row = adminUserId ? await admin(adminUserId, write) : await onTicket(t, write);
    await mail({
      to: t.requester_email,
      subject: `Re: ${t.subject} [#${t.ref}]`,
      replyTo: replyTo(t.ref),
      text:
        `HRVoice support replied:\n\n${body}\n\n` +
        (t.organization_id ? `See the conversation under Get help in HRVoice: ${deps.webUrl}/dashboard\n` : '') +
        `Reply to this email to answer.`,
    });
    await ticketUpdated(t, 'waiting_on_customer', row);
    return toMessage(row);
  }
}
