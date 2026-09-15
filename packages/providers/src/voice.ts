/**
 * Voice transport contracts — normalized audio (Phase 5C).
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: **no provider-specific audio format
 * leaks past the telephony boundary.** The research made this concrete —
 * carriers do not agree on the wire format:
 *
 *   TTBS Smartflo   audio/x-mulaw, 8000 Hz, 8-bit, payload multiples of 160 B
 *   Plivo           mu-law 8 kHz, no transcoding
 *   Knowlarity      linear16 PCM, sample rate SELECTABLE 8/16/24/32/48 kHz
 *   Exotel          16-bit little-endian mono PCM, base64 inside JSON frames
 *   Twilio          mu-law 8 kHz, base64 inside JSON frames
 *
 * An adapter's job is to turn any of those into a `NormalizedAudioFrame` on the
 * way in, and to turn a `NormalizedAudioFrame` back into the carrier's wire
 * format on the way out. Everything downstream — VAD, STT, the runtime, TTS —
 * sees one shape and never learns which carrier produced it.
 *
 * Interfaces only. No implementation, no provider SDK, nothing selected.
 */

/**
 * Sample encodings the platform handles.
 *
 * Deliberately only two. `mulaw` because it is what the Indian PSTN actually
 * delivers, and `pcm16` because it is what every STT and TTS vendor accepts.
 * Adding a third would mean a transcoding path nobody has a use for.
 */
export type AudioEncoding = 'pcm16' | 'mulaw';

/** Sample rates the platform handles. 8 kHz is the PSTN reality; 16 kHz is what STT prefers. */
export type AudioSampleRate = 8000 | 16000;

/**
 * One frame of audio, normalized.
 *
 * `timestampMs` is measured from the start of the media stream, NOT wall clock:
 * a benchmark needs to reason about stream position independently of when the
 * process happened to read the socket.
 */
export interface NormalizedAudioFrame {
  readonly encoding: AudioEncoding;
  readonly sampleRate: AudioSampleRate;
  /** Mono only. Telephony is mono, and a stereo path would be silently wrong. */
  readonly channels: 1;
  /** Milliseconds from the start of the stream. */
  readonly timestampMs: number;
  /** Monotonically increasing per stream. Gaps mean dropped frames. */
  readonly sequence: number;
  readonly payload: Uint8Array;
}

/** The format an endpoint expects, so adapters can convert without guessing. */
export interface AudioFormat {
  readonly encoding: AudioEncoding;
  readonly sampleRate: AudioSampleRate;
  readonly channels: 1;
  /** Frame size the carrier requires, where it mandates one (TTBS: 160 bytes). */
  readonly frameBytes?: number;
}

/**
 * A live bidirectional media stream, normalized.
 *
 * `inbound` is the caller's audio. `send` plays audio back into the call.
 * `clear` is the barge-in primitive: it discards audio already queued at the
 * carrier, which is the only way an interruption sounds immediate rather than
 * arriving after the agent finishes its sentence.
 */
export interface MediaStream {
  /** What the carrier is actually sending us, after normalization. */
  readonly inboundFormat: AudioFormat;
  /** What the carrier expects back. Often, but not always, the same. */
  readonly outboundFormat: AudioFormat;

  inbound(): AsyncIterable<NormalizedAudioFrame>;
  send(frame: NormalizedAudioFrame): Promise<void>;
  /** Discard carrier-side playback buffer — barge-in. */
  clear(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Converts between normalized frames and whatever a carrier speaks.
 *
 * Separated from `TelephonyProvider` on purpose: the conversion is pure and
 * testable without a carrier, and two carriers that share a wire format should
 * share one codec rather than each reimplementing it.
 */
export interface AudioCodec {
  readonly name: string;
  /** Convert a frame to the target format. A no-op when already correct. */
  convert(frame: NormalizedAudioFrame, to: AudioFormat): NormalizedAudioFrame;
}

/**
 * Voice activity detection — the endpointing seam.
 *
 * Endpointing is the largest and most tunable component of perceived turn
 * latency, and it sits BEFORE speech-to-text. It is a first-class interface so
 * it can be measured and swapped independently of the STT vendor, rather than
 * being an opaque setting inside one.
 */
export interface VoiceActivityDetector {
  readonly name: string;
  /**
   * Feed a frame. Returns a transition when one occurs, else null.
   *
   * `speech_ended` is the mark the latency budget starts from — the moment the
   * platform believes the candidate stopped talking.
   */
  push(frame: NormalizedAudioFrame): 'speech_started' | 'speech_ended' | null;
  reset(): void;
}
