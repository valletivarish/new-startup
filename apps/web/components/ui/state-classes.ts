import type { StateFamily } from '../../lib/status-labels';

// No 'use client': server components (Notice, page shells) read these too. A client module's
// exports reach the server as client references, so indexing them there gives nothing.

/** Holder edge fill per family, shared by strips, notices and error states. */
export const STATE_EDGE: Record<StateFamily, string> = {
  queued: 'bg-state-queued-edge',
  live: 'bg-state-live-edge',
  review: 'bg-state-review-edge',
  decided: 'bg-state-decided-edge',
  failed: 'bg-state-failed-edge',
};

/** State tag tint, 1px edge border and ink per family. */
export const STATE_TAG: Record<StateFamily, string> = {
  queued: 'border-state-queued-edge bg-state-queued-tint text-state-queued-ink',
  live: 'border-state-live-edge bg-state-live-tint text-state-live-ink',
  review: 'border-state-review-edge bg-state-review-tint text-state-review-ink',
  decided: 'border-state-decided-edge bg-state-decided-tint text-state-decided-ink',
  failed: 'border-state-failed-edge bg-state-failed-tint text-state-failed-ink',
};
