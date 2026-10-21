/**
 * Settings → Connected systems: the Zoho Recruit connection. The server sends stable codes;
 * every sentence a recruiter reads is here, so none of the server's wording (tokens, scopes,
 * hosts) ever reaches the screen.
 */

import { call } from './api';

export type SkipReason = 'closed_in_zoho' | 'no_phone' | 'invalid_phone' | 'duplicate_phone';

export interface ZohoLink {
  zohoJobId: string;
  zohoJobTitle: string;
  jobId: string;
  jobTitle: string;
  autoCall: boolean;
  imported: number;
}

export interface ZohoConnection {
  status: 'connected' | 'needs_attention' | 'paused';
  reason: string | null;
  pausedUntil: string | null;
  lastSyncAt: string | null;
  connectedAt: string;
  connectedBy: string | null;
  links: ZohoLink[];
  skipped: { reason: SkipReason; count: number; names: string[] }[];
  notes: { sent: number; pending: number; failed: number; lastError: string | null };
}

export interface ZohoStatus {
  available: boolean;
  connection: ZohoConnection | null;
}

export interface ZohoJobOpening {
  id: string;
  title: string;
  status: string;
}

export interface LinkDraft {
  zohoJobId: string;
  zohoJobTitle: string;
  /** Omit to create a new HRVoice job with the Zoho title. */
  jobId?: string;
  autoCall: boolean;
}

export const getZohoStatus = () => call<ZohoStatus>('/backend/integrations/zoho');

export const startZohoConnect = () =>
  call<{ url: string }>('/backend/integrations/zoho/connect', {
    method: 'POST',
    body: JSON.stringify({ consent: true }),
  });

export const listZohoJobOpenings = () =>
  call<{ jobOpenings: ZohoJobOpening[] }>('/backend/integrations/zoho/job-openings');

export const saveZohoLinks = (links: LinkDraft[]) =>
  call<ZohoStatus>('/backend/integrations/zoho/links', { method: 'PUT', body: JSON.stringify({ links }) });

export const syncZohoNow = () => call<{ queued: boolean }>('/backend/integrations/zoho/sync', { method: 'POST' });

export const retryZohoNotes = () =>
  call<{ retried: number }>('/backend/integrations/zoho/notes/retry', { method: 'POST' });

export const disconnectZoho = () => call<null>('/backend/integrations/zoho', { method: 'DELETE' });

/** What came back from the Zoho sign-in (?zoho=<code> on the Settings URL). */
export function connectResultMessage(code: string | null): { kind: 'success' | 'error'; title: string; detail: string } | null {
  switch (code) {
    case null:
    case '':
      return null;
    case 'connected':
      return {
        kind: 'success',
        title: 'Zoho Recruit is connected',
        detail: 'Now pick the Zoho jobs whose applicants should come into HRVoice.',
      };
    case 'denied':
      return { kind: 'error', title: 'Zoho Recruit wasn’t connected', detail: 'The sign-in was cancelled in Zoho. Try again when you’re ready.' };
    case 'expired':
      return {
        kind: 'error',
        title: 'That sign-in link has expired',
        detail: 'Start again from Connect Zoho Recruit. Each sign-in works once, for 10 minutes.',
      };
    case 'no_applications_module':
      return {
        kind: 'error',
        title: 'This Zoho Recruit account doesn’t use Applications',
        detail:
          'HRVoice reads applicants from Zoho’s Applications module, which isn’t on for this account. Turning it on changes how Zoho Recruit works for your whole team, so talk to us first.',
      };
    case 'no_refresh_token':
      return {
        kind: 'error',
        title: 'Zoho didn’t give lasting access',
        detail: 'Try connecting again and approve every permission Zoho asks for.',
      };
    default:
      return { kind: 'error', title: 'Zoho Recruit wasn’t connected', detail: 'The sign-in didn’t finish. Try again in a minute.' };
  }
}

/** The connection's state line. */
export function connectionProblem(c: Pick<ZohoConnection, 'status' | 'reason' | 'pausedUntil'>, formatTime: (iso: string) => string): string | null {
  if (c.status === 'paused' && c.pausedUntil) {
    return `Zoho Recruit asked us to slow down. We’ll check again after ${formatTime(c.pausedUntil)}.`;
  }
  if (c.status === 'needs_attention') {
    switch (c.reason) {
      case 'consent_revoked':
        return 'HRVoice’s access to Zoho Recruit was removed. New applicants aren’t coming in and results aren’t being sent. Reconnect to carry on.';
      case 'connected_by_left':
        return 'The person who connected Zoho Recruit no longer has access to HRVoice. Reconnect with your own Zoho sign-in to carry on.';
      case 'no_applications_module':
        return 'This Zoho Recruit account no longer uses the Applications module, so applicants can’t be read.';
      default:
        return 'The connection needs attention. Reconnect to carry on.';
    }
  }
  if (c.reason === 'zoho_unreachable') return 'The last check couldn’t reach Zoho Recruit. We’ll try again at the next check.';
  if (c.reason === 'zoho_rejected') return 'Zoho Recruit turned down the last check. We’ll try again at the next check.';
  return null;
}

/** Why applicants didn't come in, and what to do about it. */
export const SKIP_REASON: Record<SkipReason, (n: number) => string> = {
  closed_in_zoho: (n) =>
    `${n} ${n === 1 ? 'person is' : 'people are'} rejected, hired or closed in Zoho Recruit, so they weren’t brought in and won’t be called.`,
  no_phone: (n) =>
    `${n} ${n === 1 ? 'person has' : 'people have'} no mobile number in Zoho Recruit. Add one there; they come in at the next check.`,
  invalid_phone: (n) =>
    `${n} ${n === 1 ? 'person has a mobile number' : 'people have mobile numbers'} we can’t call. Fix it in Zoho Recruit; they come in at the next check.`,
  duplicate_phone: (n) =>
    `${n} ${n === 1 ? 'person has' : 'people have'} the same mobile as someone already on the HRVoice job. If it’s the same person, make the names match.`,
};

/** Why call results couldn't be sent to Zoho. */
export function noteProblem(code: string | null): string {
  switch (code) {
    case 'expired':
      return 'We stopped trying after 24 hours.';
    case 'not_connected':
      return 'Zoho Recruit wasn’t connected when we tried. Reconnect, then retry.';
    case 'zoho_rejected':
      return 'Zoho Recruit turned the note down. The candidate may have been deleted or merged there.';
    case 'rate_limited':
      return 'Zoho Recruit asked us to slow down.';
    default:
      return 'Zoho Recruit didn’t answer.';
  }
}

/** Which links changed: true when saving would add, remove or change any of them. */
export function linksChanged(saved: readonly ZohoLink[], draft: readonly LinkDraft[]): boolean {
  if (saved.length !== draft.length) return true;
  return draft.some((d) => {
    const s = saved.find((x) => x.zohoJobId === d.zohoJobId);
    return !s || s.jobId !== d.jobId || s.autoCall !== d.autoCall;
  });
}
