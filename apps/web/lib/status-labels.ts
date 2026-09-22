/** Plain HR labels for statuses shown in the hiring desk. */

export const JOB_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  open: 'Open',
  closed: 'Closed',
  archived: 'Archived',
};

/** Assignment pipeline — same words on lists, sheet, Analytics, and Jobs. */
export const PIPELINE_STATUS_LABEL: Record<
  'new' | 'screening' | 'reviewed',
  string
> = {
  new: 'In queue',
  screening: 'On hold',
  reviewed: 'Moved forward',
};

export const PERSON_STATUS_LABEL: Record<string, string> = {
  ...PIPELINE_STATUS_LABEL,
  ready: 'Ready',
  completed: 'Screen done',
  failed: 'Call failed',
};

export const CALL_STATUS_LABEL: Record<
  'not_called' | 'calling' | 'completed' | 'failed',
  string
> = {
  not_called: 'Not called yet',
  calling: 'Call in progress',
  completed: 'Call finished',
  failed: 'Call failed',
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

export const AGENT_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  published: 'Published',
  archived: 'Archived',
};

export function labelStatus(
  map: Record<string, string>,
  status: string | null | undefined,
): string {
  if (!status) return '—';
  return map[status] ?? status;
}

export function labelImportIssues(issues: readonly string[]): string {
  return issues
    .map((issue) => IMPORT_ISSUE_LABEL[issue] ?? issue.replace(/_/g, ' '))
    .join('; ');
}
