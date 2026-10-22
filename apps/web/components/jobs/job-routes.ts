import { openingTab } from '../../features/readiness/next-action';

type Query = Record<string, string | string[] | undefined>;

/** The query string as it came in (every old param kept), with its leading "?" or nothing. */
export function queryString(params: Query): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    for (const x of Array.isArray(v) ? v : v === undefined ? [] : [v]) q.append(k, x);
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Where the old /jobs/[id]/candidates URL lands: Review when it asked for answers or a fit lane, else People. */
export function legacyBoardPath(jobId: string, params: Query): string {
  const review = first(params.stage) === 'reviewed' || params.lane !== undefined || params.fit !== undefined;
  return `/jobs/${jobId}/${review ? 'review' : 'people'}${queryString(params)}`;
}

/** Where /jobs/[id] lands: a Draft opens on Set up, anything else (or an unreadable job) on People. */
export function openingPath(jobId: string, status: string | null, params: Query): string {
  return `/jobs/${jobId}/${status ? openingTab(status) : 'people'}${queryString(params)}`;
}
