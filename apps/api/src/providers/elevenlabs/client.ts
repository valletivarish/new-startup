/**
 * ElevenLabs SDK client factory.
 *
 * This module is the ONLY place in the API that imports @elevenlabs/elevenlabs-js.
 * Every other module in the application depends on the normalized adapter
 * interface (types.ts), not on this SDK client.
 *
 * The factory is lazy: no client is created if ELEVENLABS_ENABLED=false, which
 * means a missing or invalid key never crashes a process that does not use it.
 */

import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import type { Env } from '../../config.js';

export type ElevenLabsSDKClient = ElevenLabsClient;

let _client: ElevenLabsClient | null = null;

/**
 * Returns the shared ElevenLabs client.
 *
 * Throws at call-time (not at module load) if the feature is disabled or the
 * key is missing, so every caller must check `env.ELEVENLABS_ENABLED` before
 * calling this.
 */
export function getElevenLabsClient(env: Env): ElevenLabsClient {
  if (!env.ELEVENLABS_ENABLED) {
    throw new Error(
      'ElevenLabs integration is disabled (ELEVENLABS_ENABLED=false). ' +
        'Check your environment configuration.',
    );
  }
  if (!env.ELEVENLABS_API_KEY) {
    throw new Error('ELEVENLABS_API_KEY is not set');
  }
  if (!_client) {
    _client = new ElevenLabsClient({ apiKey: env.ELEVENLABS_API_KEY });
  }
  return _client;
}

/**
 * Clear the cached client (test helper — production code never calls this).
 */
export function _resetClientForTesting(): void {
  _client = null;
}
