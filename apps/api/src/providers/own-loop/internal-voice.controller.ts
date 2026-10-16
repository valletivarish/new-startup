/**
 * Internal routes for apps/voice (docker network only; Caddy 404s /internal/*).
 *
 *   GET  /internal/voice/calls/:callId          the call's plan (script, voice, language)
 *   POST /internal/voice/calls/:callId/result   transcript + usage when the call ends
 *
 * Authenticated by a shared secret header, compared in constant time. With no
 * secret configured every request is 404, so the routes don't exist.
 */

import { timingSafeEqual } from 'node:crypto';
import { Body, Controller, Get, Headers, Inject, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../../authz/decorators.js';
import type { Env } from '../../config.js';
import { ApiError } from '../../errors.js';
import { ENV } from '../../tokens.js';
import { OWN_LOOP_SERVICE } from '../../tokens.more.js';
import { parse } from '../../validate.js';
import type { OwnLoopService } from './own-loop.service.js';

const count = z.number().int().min(0).max(1e9).nullable().optional();

const ResultBody = z
  .object({
    transcript: z
      .array(z.object({ role: z.enum(['agent', 'user']), message: z.string().max(5000) }))
      .max(500),
    durationSeconds: z.number().min(0).max(7200),
    endedReason: z.enum([
      'completed',
      'candidate_hung_up',
      'silence',
      'voicemail',
      'max_duration',
      'engine_error',
    ]),
    usage: z
      .object({
        sttSeconds: count,
        llmInputTokens: count,
        llmOutputTokens: count,
        ttsCharacters: count,
        responseP50Ms: count,
        responseP90Ms: count,
        interruptions: count,
      })
      .strict(),
  })
  .strict();

const CallId = z.string().min(6).max(128).regex(/^[A-Za-z0-9_-]+$/);

@Controller('internal/voice')
export class InternalVoiceController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(OWN_LOOP_SERVICE) private readonly ownLoop: OwnLoopService,
  ) {}

  private authorize(token: string | undefined): void {
    const expected = this.env.VOICE_INTERNAL_TOKEN;
    const a = Buffer.from(token ?? '');
    const b = Buffer.from(expected);
    if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) {
      throw ApiError.notFound('Page');
    }
  }

  @Public()
  @Get('calls/:callId')
  async plan(@Headers('x-voice-token') token: string | undefined, @Param('callId') callId: string) {
    this.authorize(token);
    return this.ownLoop.getCallPlan(parse(CallId, callId));
  }

  @Public()
  @Post('calls/:callId/result')
  async result(
    @Headers('x-voice-token') token: string | undefined,
    @Param('callId') callId: string,
    @Body() body: unknown,
  ) {
    this.authorize(token);
    await this.ownLoop.saveCallResult(parse(CallId, callId), parse(ResultBody, body));
    return { ok: true };
  }
}
