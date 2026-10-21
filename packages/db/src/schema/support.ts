/**
 * Support tickets (migration 0036). organization_id NULL = an unassigned,
 * platform-level ticket (no account yet): visible only to the platform admin
 * and, through the lookup policies, to the visitor token / ticket ref that
 * names it. Messages inherit their ticket's visibility.
 */

import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { organizations } from './organizations.js';
import { users } from './auth.js';

const tstz = (name: string) => timestamp(name, { withTimezone: true });

export const supportTickets = pgTable(
  'support_tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
    ref: text('ref').notNull().unique(),
    visitorTokenHash: text('visitor_token_hash').unique(),
    subject: text('subject').notNull(),
    status: text('status').notNull().default('open'),
    channel: text('channel').notNull(),
    jobId: uuid('job_id'),
    candidateId: uuid('candidate_id'),
    callId: uuid('call_id'),
    requesterUserId: uuid('requester_user_id').references(() => users.id, { onDelete: 'set null' }),
    requesterEmail: text('requester_email').notNull(),
    requesterName: text('requester_name'),
    context: jsonb('context').notNull().default({}),
    lastMessageAt: tstz('last_message_at').notNull().defaultNow(),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('support_tickets_org_idx').on(t.organizationId, t.lastMessageAt),
    index('support_tickets_status_idx').on(t.status, t.lastMessageAt),
  ],
);

export const supportMessages = pgTable(
  'support_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => supportTickets.id, { onDelete: 'cascade' }),
    authorKind: text('author_kind').notNull(),
    authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    authorEmail: text('author_email'),
    body: text('body').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [index('support_messages_ticket_idx').on(t.ticketId, t.createdAt)],
);
