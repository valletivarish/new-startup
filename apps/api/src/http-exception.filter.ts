/**
 * Maps every thrown error to the standard envelope (`04_DATABASE_API_SPEC`
 * §7): { code, message, request_id, errors? }.
 *
 * Anything unrecognised becomes an opaque 500 — no stack traces, no SQL, no
 * driver messages leave the process. The full error is logged server-side
 * with the request id for correlation.
 */

import {
  Catch,
  HttpException,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from 'pino';

import { ApiError } from './errors.js';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const reply = http.getResponse<FastifyReply>();
    const request = http.getRequest<FastifyRequest>();
    const requestId = request.id;

    if (exception instanceof ApiError) {
      void reply.status(exception.status).send({
        code: exception.code,
        message: exception.message,
        request_id: requestId,
        ...(exception.fields ? { errors: exception.fields } : {}),
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      void reply.status(status).send({
        code: status === 404 ? 'not_found' : 'internal',
        message: status === 404 ? 'Not found' : 'Request failed',
        request_id: requestId,
      });
      return;
    }

    // Fastify-layer errors (rate limit, JSON body parse, payload size) carry
    // a numeric statusCode and surface here through Nest's error handler.
    // Preserve legitimate 4xx codes in the standard envelope rather than
    // flattening them to 500 (audit finding: 429s and parse 400s previously
    // lost both their status and the envelope).
    const fastifyStatus = (exception as { statusCode?: unknown }).statusCode;
    if (
      typeof fastifyStatus === 'number' &&
      fastifyStatus >= 400 &&
      fastifyStatus < 500
    ) {
      const code =
        fastifyStatus === 429
          ? 'rate_limited'
          : fastifyStatus === 400
            ? 'validation_failed'
            : 'internal';
      // Preserve a specific message when the source provided one (the
      // rate-limit builder includes retry timing); otherwise use a safe
      // generic per status.
      const sourceMessage = (exception as { message?: unknown }).message;
      const message =
        typeof sourceMessage === 'string' && sourceMessage.length > 0
          ? sourceMessage
          : fastifyStatus === 429
            ? 'Too many requests. Try again shortly.'
            : fastifyStatus === 400
              ? 'The request body could not be parsed'
              : 'Request failed';
      void reply
        .status(fastifyStatus)
        .send({ code, message, request_id: requestId });
      return;
    }

    this.logger.error(
      {
        request_id: requestId,
        err:
          exception instanceof Error
            ? { message: exception.message, stack: exception.stack }
            : String(exception),
      },
      'unhandled_error',
    );
    void reply.status(500).send({
      code: 'internal',
      message: 'Something went wrong',
      request_id: requestId,
    });
  }
}
