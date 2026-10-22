import { describe, expect, it, vi } from 'vitest';
import { isSampleCallHref, stopAudio } from './sample-call-open';

describe('sample call deep links', () => {
  it('opens for the section and card anchors, the way old links and the chat write them', () => {
    expect(isSampleCallHref('#sample-call')).toBe(true);
    expect(isSampleCallHref('#sample-call-card')).toBe(true);
  });

  it('ignores every other link', () => {
    for (const href of ['#faq', '#sample-call-x', '/login', '', null, undefined]) expect(isSampleCallHref(href)).toBe(false);
  });
});

describe('closing the player', () => {
  it('pauses the recording and rewinds it', () => {
    const audio = { pause: vi.fn(), currentTime: 41 };
    stopAudio(audio);
    expect(audio.pause).toHaveBeenCalledOnce();
    expect(audio.currentTime).toBe(0);
  });

  it('does nothing when there is no recording yet', () => {
    expect(() => stopAudio(null)).not.toThrow();
  });
});
