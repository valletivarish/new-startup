/**
 * The frozen screening script.
 *
 * PRE-REGISTERED, like the thresholds and the TTS line set. The end-to-end run
 * measures `total_turn`, and the LLM's share of that depends on what it is
 * asked to do — so the prompt must be fixed before any number exists. A prompt
 * tuned after seeing results is a thumb on the scale for whichever provider
 * happened to be measured first.
 *
 * It is deliberately SHORT. This is a latency instrument, not a product prompt:
 * a long system prompt inflates time-to-first-token for every stack equally and
 * makes the stage attribution less legible without changing the comparison.
 *
 * The reply-length instruction is load-bearing. TTS is billed per character,
 * and an unbounded reply would make the end-to-end run's cost depend on the
 * LLM's verbosity rather than on the corpus.
 */

export const SCREENING_PROMPT_VERSION = 'screen-1.0.0';

export const SCREENING_SYSTEM_PROMPT = [
  'You are conducting a short recruitment screening call with a candidate in India.',
  'You have already introduced yourself. Ask one clear follow-up question at a time',
  'about their experience, notice period, expected compensation, or location.',
  'Reply with ONE sentence of at most 25 words. Do not greet again. Do not summarise.',
  'Write plain sentences with no markdown, no lists, and no emoji, because your reply',
  'is spoken aloud.',
].join(' ');

/**
 * Build the message list for one turn.
 *
 * `history` is the conversation so far, oldest first. The candidate's latest
 * utterance arrives as the TRANSCRIPT the STT produced — not as the reference —
 * because the end-to-end run must feel the consequences of transcription
 * errors. Feeding the reference here would measure a pipeline that does not
 * exist and would make every STT look identical downstream.
 */
export function screeningMessages(
  history: readonly { readonly role: 'user' | 'assistant'; readonly content: string }[],
  transcript: string,
): readonly { readonly role: 'system' | 'user' | 'assistant'; readonly content: string }[] {
  return [
    { role: 'system' as const, content: SCREENING_SYSTEM_PROMPT },
    ...history,
    { role: 'user' as const, content: transcript },
  ];
}
