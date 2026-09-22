/**
 * Pick the concrete NotificationProvider from env.
 * Console is for local/dev only; production must use smtp.
 */

import type { NotificationProvider } from '@platform/providers';
import type { Logger } from 'pino';

import type { Env } from '../config.js';
import { createConsoleNotificationProvider } from './console-notification-provider.js';
import { createSmtpNotificationProvider } from './smtp-notification-provider.js';

export function createNotificationTransport(
  env: Env,
  logger: Logger,
): NotificationProvider {
  if (env.NOTIFICATION_TRANSPORT === 'smtp') {
    return createSmtpNotificationProvider(logger, {
      from: env.EMAIL_FROM,
      ...(env.SMTP_URL ? { url: env.SMTP_URL } : {}),
      ...(env.SMTP_HOST ? { host: env.SMTP_HOST } : {}),
      ...(env.SMTP_PORT !== undefined ? { port: env.SMTP_PORT } : {}),
      ...(env.SMTP_USER ? { user: env.SMTP_USER } : {}),
      ...(env.SMTP_PASS ? { pass: env.SMTP_PASS } : {}),
      secure: env.SMTP_SECURE,
    });
  }

  return createConsoleNotificationProvider(logger);
}
