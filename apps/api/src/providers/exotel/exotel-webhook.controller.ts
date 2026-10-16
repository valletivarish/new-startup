/**
 * Exotel status callback (POST /webhooks/exotel), registered on every own-loop
 * dial. Unsigned, so nothing in the body is trusted except the call id: the
 * final status, length and billed price are fetched from Exotel's API, and
 * only for a call id that belongs to one of our own-loop sessions.
 */

import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { Public } from '../../authz/decorators.js';
import { OWN_LOOP_SERVICE } from '../../tokens.more.js';
import type { OwnLoopService } from '../own-loop/own-loop.service.js';

@Controller('webhooks')
export class ExotelWebhookController {
  constructor(@Inject(OWN_LOOP_SERVICE) private readonly ownLoop: OwnLoopService) {}

  @Public()
  @Post('exotel')
  @HttpCode(200)
  async status(@Body() body: unknown) {
    const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const callId = String(b['CallSid'] ?? b['call_sid'] ?? b['CallSID'] ?? '').trim();
    if (/^[A-Za-z0-9_-]{6,128}$/.test(callId)) {
      try {
        await this.ownLoop.refreshCarrier(callId);
      } catch {
        /* the next callback or the result post will catch up */
      }
    }
    return { received: true };
  }
}
