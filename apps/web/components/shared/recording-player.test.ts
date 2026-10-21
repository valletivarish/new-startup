import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordingFailure } from './recording-player';

afterEach(() => vi.unstubAllGlobals());

describe('recordingFailure', () => {
  it('reads a 404 as no recording, not as the viewer’s connection', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    expect(await recordingFailure('/backend/x/recording')).toBe('missing');
  });

  it('blames the connection only when the request itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    expect(await recordingFailure('/backend/x/recording')).toBe('offline');
  });

  it('keeps a server error apart from both', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 502 })));
    expect(await recordingFailure('/backend/x/recording')).toBe('error');
  });
});
