/**
 * The Phase 1 NotificationProvider: prints to the server log.
 *
 * No external email provider is selected (12_ARCHITECTURE_DECISIONS_FINAL D3).
 * When one is chosen it becomes another implementation of the same interface;
 * nothing else changes.
 */

import type { NotificationProvider } from '@platform/providers';
import type { Logger } from 'pino';

export function createConsoleNotificationProvider(
  logger: Logger,
): NotificationProvider {
  return {
    name: 'console',
    async sendEmail(params) {
      // The body may contain verification/reset URLs. That is acceptable for
      // a local console transport and would NOT be for production logging.
      logger.info(
        { to: params.to, subject: params.subject, body: params.text },
        'notification.email (console transport)',
      );
    },
  };
}
