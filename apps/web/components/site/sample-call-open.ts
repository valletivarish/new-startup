/**
 * What opens the sample-call player, and how it stops. Pure, so the dialog only wires them up.
 */

/** Every link that means "play the sample call": the old section and card anchors, kept as deep links. */
const HREFS = ['#sample-call', '#sample-call-card'];

export function isSampleCallHref(href: string | null | undefined): boolean {
  return href != null && HREFS.includes(href);
}

/** Pause the recording and rewind it, so closing the player never leaves a call playing. */
export function stopAudio(audio: Pick<HTMLMediaElement, 'pause' | 'currentTime'> | null | undefined): void {
  if (!audio) return;
  audio.pause();
  audio.currentTime = 0;
}
