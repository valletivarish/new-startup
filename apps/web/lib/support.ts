/**
 * Support: shared shapes and pure helpers for Get help, the website chat, the founder's inbox
 * and the status page. The fetch calls live in support-api.ts.
 */

import { fromPublicId } from './public-id';

export type TicketStatus = 'open' | 'waiting_on_us' | 'waiting_on_customer' | 'solved';
export type TicketChannel = 'dashboard' | 'chat' | 'email' | 'api' | 'mcp';

export interface SupportMessage {
  id: string;
  authorKind: 'customer' | 'staff' | 'system';
  body: string;
  createdAt: string;
}

export interface Ticket {
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
  messages?: SupportMessage[];
}

export interface IntegrationError {
  kind: 'webhook' | 'call' | 'api';
  at: string;
  summary: string;
  detail: string | null;
}

export interface AdminTicket extends Ticket {
  organizationId: string | null;
  organizationName: string | null;
  requesterEmail: string;
  requesterName: string | null;
  lastMessage: SupportMessage | null;
  unanswered: number;
  context?: {
    jobTitle: string | null;
    candidateName: string | null;
    recentErrors: IntegrationError[];
    snapshotAt: string | null;
  };
}

/** Live chat and the inbox refresh this often; no open connection is kept. */
export const POLL_MS = 4000;

/** What the customer sees: whose move it is, in plain words. */
export const CUSTOMER_STATUS: Record<TicketStatus, { label: string; tone: 'info' | 'warning' | 'success' | 'neutral' }> = {
  open: { label: 'Sent', tone: 'info' },
  waiting_on_us: { label: 'With HRVoice', tone: 'info' },
  waiting_on_customer: { label: 'Replied', tone: 'warning' },
  solved: { label: 'Solved', tone: 'success' },
};

/** What the founder sees in the inbox. */
export const STAFF_STATUS: Record<TicketStatus, { label: string; tone: 'info' | 'warning' | 'success' | 'neutral' }> = {
  open: { label: 'New', tone: 'warning' },
  waiting_on_us: { label: 'Waiting on us', tone: 'warning' },
  waiting_on_customer: { label: 'Waiting on customer', tone: 'neutral' },
  solved: { label: 'Solved', tone: 'success' },
};

export const CHANNEL_LABEL: Record<TicketChannel, string> = {
  dashboard: 'Get help form',
  chat: 'Chat',
  email: 'Email',
  api: 'API',
  mcp: 'AI assistant',
};

/**
 * The job and candidate the person is looking at, read from the address: /jobs/<id>/… and
 * ?c=<candidate>. Ids in addresses are public tokens; both forms decode here.
 */
export function relatedFromLocation(pathname: string, search: string): { jobId?: string; candidateId?: string } {
  const out: { jobId?: string; candidateId?: string } = {};
  const job = /^\/jobs\/([^/?#]+)/.exec(pathname)?.[1];
  const jobId = job && job !== 'new' ? fromPublicId(decodeURIComponent(job)) : null;
  if (jobId) out.jobId = jobId;
  const c = new URLSearchParams(search).get('c');
  const candidateId = c ? fromPublicId(c) : null;
  if (candidateId) out.candidateId = candidateId;
  return out;
}

/**
 * Inbox tickets with a customer message newer than `since`: what a browser notification should
 * announce. The first load passes since = null and announces nothing.
 */
export function newCustomerMessages(tickets: readonly AdminTicket[], since: string | null): AdminTicket[] {
  if (since === null) return [];
  const t = Date.parse(since);
  return tickets.filter(
    (x) => x.lastMessage?.authorKind === 'customer' && Date.parse(x.lastMessage.createdAt) > t,
  );
}

/** The newest message time across the inbox, for the next `since`. */
export function latestMessageAt(tickets: readonly AdminTicket[], previous: string | null): string | null {
  let best = previous ? Date.parse(previous) : -Infinity;
  for (const x of tickets) {
    const at = x.lastMessage ? Date.parse(x.lastMessage.createdAt) : -Infinity;
    if (at > best) best = at;
  }
  return Number.isFinite(best) ? new Date(best).toISOString() : previous;
}

export type ComponentState = 'operational' | 'degraded' | 'down';
export interface StatusComponent {
  id: 'api' | 'calls' | 'webhooks';
  name: string;
  state: ComponentState;
  note: string;
}

export const STATE_LABEL: Record<ComponentState, { label: string; tone: 'success' | 'warning' | 'danger' }> = {
  operational: { label: 'Working', tone: 'success' },
  degraded: { label: 'Slow or partly down', tone: 'warning' },
  down: { label: 'Down', tone: 'danger' },
};

/** One line for the page head: the worst state wins. */
export function overallState(components: readonly StatusComponent[]): ComponentState {
  if (components.some((c) => c.state === 'down')) return 'down';
  if (components.some((c) => c.state === 'degraded')) return 'degraded';
  return 'operational';
}

/** A plain email check, the server checks again. */
export const looksLikeEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

/** The website chat keeps its token here so a reload finds the conversation again. */
export const VISITOR_CHAT_KEY = 'support-chat-token';
