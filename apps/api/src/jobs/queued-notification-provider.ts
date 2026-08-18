/**
 * NotificationProvider that enqueues instead of sending inline.
 *
 * Same interface, different delivery discipline: the caller returns as soon
 * as the job is durably recorded, and the worker performs the actual send
 * with retries. Swapping the concrete transport later changes only the
 * worker's provider, not this one.
 */

import type { NotificationProvider } from '@platform/providers';
import type { JobQueue } from './queue.js';

export function createQueuedNotificationProvider(
  queue: JobQueue,
): NotificationProvider {
  return {
    name: 'queued',
    async sendEmail(params) {
      await queue.enqueueEmail(
        {
          to: params.to,
          subject: params.subject,
          text: params.text,
          ...(params.html !== undefined ? { html: params.html } : {}),
        },
        params.idempotencyKey,
      );
    },
  };
}
