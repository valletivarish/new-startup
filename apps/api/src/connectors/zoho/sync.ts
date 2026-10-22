/**
 * Pure parts of the Zoho sync: how applications are paged, how a Zoho record
 * maps onto a candidate, and the note text. No I/O here, so each rule has a
 * plain unit test (test/zoho-sync.test.ts).
 *
 * PAGING DECISION (settles the OPEN item in docs/integrations/ARCHITECTURE.md):
 * Applications are read sorted by Modified_Time ascending with
 * If-Modified-Since, and the window moves forward instead of the page number.
 * After each page the next request asks for records modified since the last
 * record's Modified_Time minus one second, at page 1. So no request ever goes
 * deep, and an offset/depth cap (2,000 in Zoho CRM; unverified for Recruit)
 * is never reached, whatever the account's size.
 *
 * Equal timestamps: re-reading the boundary second makes the rule safe whether
 * Zoho compares If-Modified-Since inclusively or not, and the writes are
 * idempotent (keyed by Zoho application id; a record whose Modified_Time we
 * already stored is skipped). The one case that cannot move forward is a full
 * page whose records all share the boundary second (a bulk update in Zoho):
 * then, and only then, the page number goes up inside that one second, and
 * goes back to 1 as soon as time moves on.
 * ponytail: more than ~2,000 applications stamped with the very same second
 * would meet a depth cap inside that second; nothing short of Zoho's own
 * page_token (not documented for Recruit) can page that.
 *
 * Every later scan starts at the stored cursor minus OVERLAP_MS, so a record
 * whose change Zoho committed a little late (stamped before one we already
 * read) is still picked up. A new job link clears the cursor: the next scan
 * reads everything again, which is safe because the writes are idempotent.
 * This replaces v13's "two completed scans", its separate full-read path,
 * its page position in the cursor and its too_many_to_read entry.
 */

import type { ZohoRecord } from './client.js';

export const OVERLAP_MS = 2 * 60_000;
export const PAGE_SIZE = 200;

export interface ReadPosition {
  modifiedSince: Date | null;
  page: number;
}

export function firstRead(cursor: Date | null): ReadPosition {
  return { modifiedSince: cursor ? new Date(cursor.getTime() - OVERLAP_MS) : null, page: 1 };
}

/** Where the next request goes after a page, or null when the scan is done. `latest` is the page's max Modified_Time. */
export function nextRead(
  at: ReadPosition,
  page: { latest: Date | null; more: boolean },
): ReadPosition | null {
  if (!page.more || !page.latest) return null;
  const since = new Date(Math.floor(page.latest.getTime() / 1000) * 1000 - 1000);
  if (at.modifiedSince && since.getTime() <= at.modifiedSince.getTime()) {
    // The whole page sat inside the window's first second: step through that second.
    return { modifiedSince: at.modifiedSince, page: at.page + 1 };
  }
  return { modifiedSince: since, page: 1 };
}

export interface MappedApplication {
  applicationId: string;
  zohoJobId: string | null;
  zohoCandidateId: string | null;
  fullName: string;
  phone: string | null;
  email: string | null;
  status: string;
  modifiedTime: Date;
}

const lookupId = (v: unknown): string | null => {
  if (typeof v === 'string' && v) return v;
  if (v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string') return (v as { id: string }).id;
  return null;
};
const lookupName = (v: unknown): string | null =>
  v && typeof v === 'object' && typeof (v as { name?: unknown }).name === 'string' ? (v as { name: string }).name : null;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Field names follow Zoho Recruit's Applications module. A few spellings are
 * accepted for the lookups because Zoho's docs use more than one (checked in
 * the real-account trial).
 */
export function mapApplication(r: ZohoRecord): MappedApplication | null {
  // Real Zoho applications carry no Modified_Time; Last_Activity_Time is what
  // moves on a change and what If-Modified-Since filters on.
  const modified = Date.parse(String(r['Last_Activity_Time'] ?? r['Modified_Time'] ?? r['Created_Time'] ?? ''));
  if (!r.id || !Number.isFinite(modified)) return null;
  // Ids first: on a real account Job_Opening_Name is the title as a plain string.
  const job = r['$Job_Opening_Id'] ?? (typeof r['Job_Opening_Name'] === 'object' ? r['Job_Opening_Name'] : null) ?? r['Job_Opening'];
  const cand = r['$Candidate_Id'] ?? (typeof r['Candidate_Name'] === 'object' ? r['Candidate_Name'] : null) ?? r['Candidate'];
  const first = str(r['First_Name']);
  const last = str(r['Last_Name']);
  const fullName =
    str(r['Full_Name']) ?? ([first, last].filter(Boolean).join(' ') || null) ?? lookupName(cand) ?? 'Applicant';
  return {
    applicationId: String(r.id),
    zohoJobId: lookupId(job),
    zohoCandidateId: lookupId(cand),
    fullName,
    phone: str(r['Mobile']) ?? str(r['Phone']),
    email: str(r['Email']),
    status: str(r['Application_Status']) ?? str(r['Candidate_Status']) ?? '',
    modifiedTime: new Date(modified),
  };
}

/**
 * Rejected, hired or otherwise finished in Zoho: never called. Statuses are
 * custom per account, so this matches the words Zoho's default pipeline uses
 * for its end stages and anything plainly negative.
 */
const CLOSED = /hired|rejected|archived|junk|withdrawn|not interested|unqualified|offer[ -]?declined|joined|converted|disqualified|closed/i;

export function isClosedStatus(status: string): boolean {
  return CLOSED.test(status);
}

/** What leaves for Zoho after a call: facts only. Never a score, fit or recommendation. */
export interface NoteInput {
  jobTitle: string;
  startedAt: string | null;
  durationSeconds: number | null;
  outcome: 'completed' | 'short' | 'no_answer' | 'busy' | 'voicemail' | 'failed';
  answers: readonly { question: string; answer: unknown }[];
  questions: readonly string[];
  summary: string | null;
  link: string;
}

const OUTCOME: Record<NoteInput['outcome'], string> = {
  completed: 'Call completed',
  short: 'Picked up, but the call was very short',
  no_answer: 'No answer',
  busy: 'Line busy',
  voicemail: 'Reached voicemail',
  failed: 'The call could not be completed',
};

const whenIst = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function answerText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

export function buildNote(n: NoteInput): { title: string; content: string } {
  const head = [
    `HRVoice screening call · ${n.jobTitle}`,
    n.startedAt ? `${whenIst.format(new Date(n.startedAt))} IST` : null,
    n.durationSeconds ? `${Math.max(1, Math.round(n.durationSeconds / 60))} min` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const lines = [head, `Outcome: ${OUTCOME[n.outcome]}`];
  if (n.questions.length > 0 && (n.outcome === 'completed' || n.outcome === 'short')) {
    lines.push('', 'Answers noted from the call (automatic; check the recording)');
    for (const q of n.questions) {
      const a = answerText(n.answers.find((x) => x.question === q)?.answer);
      lines.push(`- ${q}: ${a || 'No answer noted; check the recording'}`);
    }
  }
  if (n.summary) lines.push('', `Summary: ${n.summary}`);
  lines.push(
    '',
    `Recording, transcript and full details in HRVoice: ${n.link}`,
    'A person on your team decides who moves forward. HRVoice does not score or recommend.',
  );
  return { title: `HRVoice screening: ${OUTCOME[n.outcome]}`, content: lines.join('\n') };
}
