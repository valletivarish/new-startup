/** The job page's "Put this job on your careers page" panel: the job's publishable key and its snippet. */

import { call } from './api';

export interface CareersKey {
  id: string;
  publicKey: string;
  mode: 'live' | 'test';
  allowedOrigins: string[];
  lastUsedAt: string | null;
  createdAt: string;
}

const path = (jobId: string) => `/backend/jobs/${encodeURIComponent(jobId)}/careers-page`;

export const getCareersKey = (jobId: string) =>
  call<{ key: CareersKey | null; companyName: string }>(path(jobId));

export const createCareersKey = (jobId: string, allowedOrigins: string[]) =>
  call<{ key: CareersKey }>(path(jobId), { method: 'POST', body: JSON.stringify({ allowedOrigins }) });

export const updateCareersOrigins = (jobId: string, allowedOrigins: string[]) =>
  call<{ key: CareersKey }>(path(jobId), { method: 'PATCH', body: JSON.stringify({ allowedOrigins }) });

export const revokeCareersKey = (jobId: string) => call<null>(path(jobId), { method: 'DELETE' });

/** One website per line (commas work too); blanks dropped. The API normalises and checks each. */
export const websitesFromText = (text: string) =>
  text
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

export const DEFAULT_ACCENT = '#0F1A2E';

/** What the company pastes. `site` is where embed.js is served (this site). */
export function careersSnippet(publicKey: string, site: string, accent = DEFAULT_ACCENT): string {
  const colour = accent.toUpperCase() === DEFAULT_ACCENT ? '' : ` data-accent="${accent}"`;
  return `<script src="${site}/embed.js" data-key="${publicKey}"${colour} async></script>\n<div data-hrvoice-apply></div>`;
}
