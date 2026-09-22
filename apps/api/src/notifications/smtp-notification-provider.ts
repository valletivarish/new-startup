/**
 * SMTP NotificationProvider — delivers mail via nodemailer.
 * Used when NOTIFICATION_TRANSPORT=smtp (production / staging with a real inbox).
 */

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { NotificationProvider } from '@platform/providers';
import type { Logger } from 'pino';

export interface SmtpTransportOptions {
  readonly from: string;
  readonly url?: string;
  readonly host?: string;
  readonly port?: number;
  readonly user?: string;
  readonly pass?: string;
  readonly secure?: boolean;
}

export function createSmtpNotificationProvider(
  logger: Logger,
  options: SmtpTransportOptions,
): NotificationProvider {
  const transporter: Transporter = options.url
    ? nodemailer.createTransport(options.url)
    : nodemailer.createTransport({
        host: options.host,
        port: options.port ?? 587,
        secure: options.secure ?? false,
        auth:
          options.user && options.pass
            ? { user: options.user, pass: options.pass }
            : undefined,
      });

  return {
    name: 'smtp',
    async sendEmail(params) {
      await transporter.sendMail({
        from: options.from,
        to: params.to,
        subject: params.subject,
        text: params.text,
        ...(params.html !== undefined ? { html: params.html } : {}),
      });
      logger.info({ to: params.to, subject: params.subject }, 'notification.email.sent');
    },
  };
}
