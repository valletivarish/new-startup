/**
 * The one state map (spec §2.6). Every state renders as tint + edge + glyph + word,
 * never colour alone. Legacy label maps below are derived from it.
 */

export type StateFamily = 'queued' | 'live' | 'review' | 'decided' | 'failed';
export type StateDomain = 'candidate' | 'call' | 'voice' | 'job' | 'agent' | 'invite';

/**
 * Lucide icon names as exported by the installed lucide-react (1.x renamed some:
 * CirclePause, CircleCheck, CircleX, FileCheckCorner, CircleQuestionMark; FileCheckCorner
 * is spec 2.6's FileCheck2).
 * 'LiveBars' is not an icon: StateTag draws its three live bars instead.
 */
export type StateGlyph =
  | 'Clock'
  | 'CirclePause'
  | 'CircleCheck'
  | 'CircleX'
  | 'PhoneOutgoing'
  | 'LiveBars'
  | 'PhoneForwarded'
  | 'FileClock'
  | 'FileCheckCorner'
  | 'PhoneMissed'
  | 'PhoneOff'
  | 'Voicemail'
  | 'TriangleAlert'
  | 'PenLine'
  | 'Radio'
  | 'Archive'
  | 'Mail'
  | 'UserCheck'
  | 'CalendarX'
  | 'Ban'
  | 'CircleQuestionMark'
  | 'Unplug'
  | 'Ear'
  | 'Hourglass'
  | 'RefreshCw';

export interface StateMeta {
  label: string;
  family: StateFamily;
  glyph: StateGlyph;
}

const s = (label: string, family: StateFamily, glyph: StateGlyph): StateMeta => ({ label, family, glyph });

const calling = s('Calling', 'live', 'PhoneOutgoing');
const callFailed = s('Call didn’t connect', 'failed', 'TriangleAlert');
// Not a row of spec 2.6, which only names the review states of a finished call. Shown for a
// finished call when nothing waits on a person: the stage is already decided, or unknown.
// callStateKey gives results_pending or ready_for_review while the stage is still open.
const callEnded = s('Call ended', 'decided', 'PhoneOff');

// A stage is a decision, so an undecided candidate reads "No decision yet": "Not called yet" is a
// call's state (call.not_called), and would contradict the call tag once a call has ended.
const candidate = {
  new: s('No decision yet', 'queued', 'Clock'),
  screening: s('On hold', 'decided', 'CirclePause'),
  reviewed: s('Moved forward', 'decided', 'CircleCheck'),
  declined: s('Not moving forward', 'decided', 'CircleX'),
};

// Raw values from the API (assignment callStatus, voice session status, failureReason)
// plus two that callStateKey derives: results_pending and ready_for_review.
const call = {
  not_called: s('Not called yet', 'queued', 'Clock'),
  pending: calling,
  dialing: calling,
  ringing: calling,
  calling,
  active: s('On call', 'live', 'LiveBars'),
  transferring: s('Handing to your team', 'live', 'PhoneForwarded'),
  results_pending: s('Writing up the call', 'live', 'FileClock'),
  ready_for_review: s('Ready for review', 'review', 'FileCheckCorner'),
  completed: callEnded,
  ended: callEnded,
  // failureReason, per the backend contract. Reasons with no words of their own read as the generic one.
  no_answer: s('No answer', 'failed', 'PhoneMissed'),
  busy: s('Line busy', 'failed', 'PhoneMissed'),
  voicemail: s('Reached voicemail', 'failed', 'Voicemail'),
  line_not_connected: s('Calling number not set up', 'failed', 'Unplug'),
  invalid_number: s('Number not valid', 'failed', 'TriangleAlert'),
  carrier_blocked: callFailed,
  network: callFailed,
  unknown: callFailed,
  failed: callFailed,
};

// A test call in the browser, from the voice SDK's events (spec 7.7), in the call map's words.
const voice = {
  idle: s('Not started', 'decided', 'PhoneOff'),
  connecting: s('Connecting', 'live', 'PhoneOutgoing'),
  connected: call.active,
  listening: s('Listening', 'live', 'Ear'),
  // The caller spoke over the agent, so the agent is listening again.
  interrupted: s('Listening', 'live', 'Ear'),
  processing: s('Agent thinking', 'live', 'Hourglass'),
  speaking: s('Agent speaking', 'live', 'LiveBars'),
  reconnecting: s('Reconnecting', 'review', 'RefreshCw'),
  completed: callEnded,
  failed: callFailed,
};

export const STATE_MAP: Record<StateDomain, Record<string, StateMeta>> = {
  candidate,
  call,
  voice,
  job: {
    draft: s('Draft', 'decided', 'PenLine'),
    open: s('Open for calls', 'live', 'Radio'),
    // Open, but no calling number yet: only test calls in the browser can run.
    open_test_only: s('Open · test calls only', 'queued', 'Unplug'),
    closed: s('Closed', 'decided', 'Archive'),
    archived: s('Archived', 'decided', 'Archive'),
  },
  agent: {
    draft: s('Draft', 'decided', 'PenLine'),
    published: s('Live', 'live', 'Radio'),
    paused: s('Paused', 'review', 'CirclePause'),
    archived: s('Archived', 'decided', 'Archive'),
  },
  invite: {
    pending: s('Waiting', 'queued', 'Mail'),
    accepted: s('Joined', 'live', 'UserCheck'),
    expired: s('Expired', 'review', 'CalendarX'),
    revoked: s('Revoked', 'decided', 'Ban'),
  },
};

const UNKNOWN: StateMeta = s('Unknown', 'decided', 'CircleQuestionMark');
const warned = new Set<string>();

function warnOnce(where: string, value: string) {
  const id = `${where}:${value}`;
  if (process.env.NODE_ENV === 'production' || warned.has(id)) return;
  warned.add(id);
  console.warn(`[status-labels] No label for ${where} "${value}". Showing "Unknown".`);
}

/** Word, family and glyph for a state. Unknown or missing values give "Unknown", never the raw value. */
export function getStateMeta(domain: StateDomain, value: string | null | undefined): StateMeta {
  const meta = value && Object.hasOwn(STATE_MAP[domain], value) ? STATE_MAP[domain][value] : undefined;
  if (meta) return meta;
  if (value) warnOnce(domain, value);
  return UNKNOWN;
}

export interface CallStateInput {
  /** Assignment callStatus or voice session status: 'completed', 'ended', 'failed', 'active'... */
  callStatus: string | null | undefined;
  /** The candidate's stage on the job. Leave out when unknown. */
  stage?: string | null;
  /** Whether the call's results (answers, summary) are in. Leave out when unknown. */
  hasResults?: boolean | null;
  failureReason?: string | null;
}

/**
 * The STATE_MAP.call key to show for a call (spec 2.6): a failed call shows its mapped reason,
 * and a finished call whose candidate is still new or on hold is waiting on a person: "Writing
 * up the call" until its results are in, then "Ready for review" (the backend's readyForReview
 * rule). Once the stage is decided, or when it is unknown, a finished call is "Call ended".
 */
export function callStateKey({ callStatus, stage, hasResults, failureReason }: CallStateInput) {
  if (callStatus === 'failed') {
    const reason = failureReason && Object.hasOwn(call, failureReason) ? STATE_MAP.call[failureReason] : undefined;
    return failureReason && reason?.family === 'failed' ? failureReason : 'failed';
  }
  if (callStatus === 'completed' || callStatus === 'ended') {
    if (stage === 'new' || stage === 'screening') {
      return hasResults === false ? 'results_pending' : 'ready_for_review';
    }
    return 'completed';
  }
  return callStatus;
}

const labelsOf = (domain: StateDomain): Record<string, string> =>
  Object.fromEntries(Object.entries(STATE_MAP[domain]).map(([value, meta]) => [value, meta.label]));

export const JOB_STATUS_LABEL: Record<string, string> = labelsOf('job');

/** Candidate stage on a job. */
export const PIPELINE_STATUS_LABEL: Record<keyof typeof candidate, string> = {
  new: candidate.new.label,
  screening: candidate.screening.label,
  reviewed: candidate.reviewed.label,
  declined: candidate.declined.label,
};

export const PERSON_STATUS_LABEL: Record<string, string> = {
  ...PIPELINE_STATUS_LABEL,
  ready: 'Ready',
  completed: call.completed.label,
  failed: call.failed.label,
};

/** Assignment callStatus, derived by the API from the latest phone call. */
export const CALL_STATUS_LABEL: Record<'not_called' | 'calling' | 'completed' | 'failed', string> = {
  not_called: call.not_called.label,
  calling: call.calling.label,
  completed: call.completed.label,
  failed: call.failed.label,
};

export const IMPORT_ISSUE_LABEL: Record<string, string> = {
  missing_full_name: 'Name missing',
  missing_country_code: 'Country code missing',
  missing_phone: 'Phone missing',
  invalid_phone: 'Phone looks invalid',
  invalid_email: 'Email looks invalid',
  duplicate_in_batch: 'Duplicate in this upload',
  duplicate_on_job: 'Already on this job',
};

export const AGENT_STATUS_LABEL: Record<string, string> = labelsOf('agent');

/** Label from a legacy map. Never "None" or a raw value: unknown or missing gives "Unknown". */
export function labelStatus(map: Record<string, string>, status: string | null | undefined): string {
  const label = status && Object.hasOwn(map, status) ? map[status] : undefined;
  if (label) return label;
  if (status) warnOnce('status', status);
  return 'Unknown';
}

export function labelImportIssues(issues: readonly string[]): string {
  return issues
    .map((issue) => IMPORT_ISSUE_LABEL[issue] ?? issue.replace(/_/g, ' '))
    .join('; ');
}
