import { describe, expect, it } from 'vitest';

import type { Env } from '../src/config.js';
import { createExotelClient } from '../src/providers/exotel/exotel.js';

/** A fetch that never answers, only rejecting when its signal aborts. */
const hangingFetch = ((_url: string, init?: RequestInit) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
  })) as typeof fetch;

const env = { EXOTEL_API_SUBDOMAIN: 'api.example.test', EXOTEL_ACCOUNT_SID: 'sid' } as Env;

describe('Exotel client timeouts', () => {
  it('gives up on a hung connectCall and getCall instead of blocking the worker', async () => {
    const client = createExotelClient(env, hangingFetch, 50);
    await expect(
      client.connectCall({ to: '+919000000000', statusCallbackUrl: 'https://x.test/cb', timeLimitSeconds: 60 }),
    ).rejects.toThrow(/timeout|abort/i);
    await expect(client.getCall('CA1')).rejects.toThrow(/timeout|abort/i);
  });
});
