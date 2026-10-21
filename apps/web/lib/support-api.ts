/** Support routes: Get help (session), the founder's inbox (platform admin), the website chat and /status. */

import { call } from './api';
import type { AdminTicket, StatusComponent, SupportMessage, Ticket, TicketStatus } from './support';

const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

export const createTicket = (input: {
  body: string;
  subject?: string;
  channel: 'dashboard' | 'chat';
  jobId?: string;
  candidateId?: string;
}) => call<Ticket>('/backend/support/tickets', json(input));
export const listMyTickets = () => call<{ tickets: Ticket[] }>('/backend/support/tickets');
export const getTicket = (id: string) => call<Ticket>(`/backend/support/tickets/${id}`);
export const replyTicket = (id: string, body: string) =>
  call<SupportMessage>(`/backend/support/tickets/${id}/messages`, json({ body }));
export const closeTicket = (id: string) => call<Ticket>(`/backend/support/tickets/${id}/close`, json({}));

export const adminTickets = (filter: { status?: TicketStatus; unassigned?: boolean }) => {
  const q = new URLSearchParams();
  if (filter.status) q.set('status', filter.status);
  if (filter.unassigned) q.set('unassigned', '1');
  return call<{ tickets: AdminTicket[] }>(`/backend/admin/support/tickets?${q}`);
};
export const adminTicket = (id: string) => call<AdminTicket>(`/backend/admin/support/tickets/${id}`);
export const adminReply = (id: string, body: string) =>
  call<SupportMessage>(`/backend/admin/support/tickets/${id}/messages`, json({ body }));
export const adminSetStatus = (id: string, status: TicketStatus) =>
  call<AdminTicket>(`/backend/admin/support/tickets/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
export const adminLink = (id: string, organizationId: string) =>
  call<AdminTicket>(`/backend/admin/support/tickets/${id}/link`, json({ organizationId }));
export const adminOrganizations = () =>
  call<{ organizations: { id: string; name: string }[] }>('/backend/admin/support/organizations');

export const startVisitorChat = (input: { email: string; name?: string; body: string }) =>
  call<{ token: string; ticket: Ticket }>('/backend/public/support/chats', json(input));
export const getVisitorChat = (token: string) => call<Ticket>(`/backend/public/support/chats/${token}`);
export const replyVisitorChat = (token: string, body: string) =>
  call<SupportMessage>(`/backend/public/support/chats/${token}/messages`, json({ body }));

export const getStatus = () => call<{ checkedAt: string; components: StatusComponent[] }>('/backend/status');
