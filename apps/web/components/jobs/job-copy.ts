// TODO(merge): use status-labels export. These two live in lib/status-labels.ts once the
// vocabulary pass merges; delete this file's copies then.
export const TEST_ONLY_BANNER = 'Browser test calls only until your calling number is set up';

export const JOB_ACTION_LABEL = {
  open: 'Make active',
  reopen: 'Make active again',
  draft: 'Move to draft',
  close: 'Close job',
} as const;
