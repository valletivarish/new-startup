'use client';

import { useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type Ref } from 'react';
import { Pause, Play } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../ui/cn';
import { Notice } from '../ui/notice';
import { formatTurnTime, spokenTime } from './transcript';

export interface RecordingPlayerHandle {
  /** Jump to `at` seconds and play. */
  seek: (at: number) => void;
}

export interface RecordingPlayerProps {
  src: string;
  /** The playback position in seconds as it changes, including after a seek. Feed it to Transcript currentTime. */
  onTimeChange?: (seconds: number) => void;
  /** The call turned out to have no recording (the server has none), so a caller can stop promising one. */
  onMissing?: () => void;
  /** Accessible name of the player. */
  label?: string;
  className?: string;
  ref?: Ref<RecordingPlayerHandle>;
}

const finite = (n: number) => (Number.isFinite(n) && n > 0 ? n : null);

/** Why a recording wouldn't load: none was kept, the viewer is offline, or something else went wrong. */
export type RecordingFailure = 'missing' | 'offline' | 'error';

/**
 * An audio element only says it failed, not why. Ask the server again: a 404 or 410 means the
 * call has no recording, a fetch that throws (or no network at all) is the viewer's connection.
 */
export async function recordingFailure(src: string): Promise<RecordingFailure> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  try {
    const res = await fetch(src, { method: 'HEAD', cache: 'no-store' });
    return res.status === 404 || res.status === 410 ? 'missing' : 'error';
  } catch {
    return 'offline';
  }
}

// The native range stays the control (keyboard, touch, screen readers). Its track draws the
// played part in accent up to --played; the thumb is an accent dot with a white ring, and keyboard
// focus rings the thumb instead of the whole 44px-tall input.
const RANGE =
  'h-11 min-w-0 flex-1 cursor-pointer appearance-none bg-transparent focus-visible:outline-none focus-visible:shadow-none disabled:cursor-default ' +
  // Forced colours drop the drawn track and thumb: the native slider comes back in system colours.
  'forced-colors:appearance-auto forced-colors:focus-visible:[outline:2px_solid_Highlight] ' +
  '[&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:[background:linear-gradient(to_right,var(--accent)_var(--played),var(--border)_var(--played))] ' +
  '[&::-webkit-slider-thumb]:-mt-1.5 [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-canvas [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:[box-shadow:var(--shadow-xs)] ' +
  '[&:focus-visible::-webkit-slider-thumb]:[box-shadow:0_0_0_2px_var(--canvas),0_0_0_4px_var(--focus-ring)] ' +
  '[&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-border ' +
  '[&::-moz-range-progress]:h-1 [&::-moz-range-progress]:rounded-full [&::-moz-range-progress]:bg-accent ' +
  '[&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-canvas [&::-moz-range-thumb]:bg-accent ' +
  '[&:focus-visible::-moz-range-thumb]:[box-shadow:0_0_0_2px_var(--canvas),0_0_0_4px_var(--focus-ring)] ' +
  '[&:disabled::-webkit-slider-thumb]:bg-border-input [&:disabled::-moz-range-thumb]:bg-border-input';

/**
 * The call recording as a pill: a round play/pause button, the position slider and the times.
 * A seek handle serves time pills and transcript turns. A call with no recording says so quietly;
 * any other load failure shows a plain error with Retry.
 */
export function RecordingPlayer({
  src,
  onTimeChange,
  onMissing,
  label = 'Call recording',
  className,
  ref,
}: RecordingPlayerProps) {
  const box = useRef<HTMLDivElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const retry = useRef<HTMLButtonElement>(null);
  const [failed, setFailed] = useState(false);
  // Why it failed, once the server has been asked. null while asking.
  const [failure, setFailure] = useState<RecordingFailure | null>(null);
  // Retry keeps the error and its focused button in place until the reload settles.
  const [retrying, setRetrying] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);
  const settle = (why: RecordingFailure) => {
    setFailure(why);
    if (why === 'missing') onMissing?.();
  };
  // Where focus goes once the error appears or goes: only when it was inside the player.
  const refocus = useRef(false);

  // A new recording gets a fresh start.
  const [loaded, setLoaded] = useState(src);
  if (loaded !== src) {
    setLoaded(src);
    setFailed(false);
    setFailure(null);
    setPlaying(false);
    setTime(0);
    setDuration(null);
  }

  // The swap between controls and error removes the focused button: move focus to its
  // counterpart (Retry, or Play once the reload worked) rather than letting it fall to the page.
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    (failed ? retry : toggle).current?.focus();
  }, [failed]);

  // Events that fired before hydration, when React wasn't listening yet.
  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    if (el.error) {
      setFailed(true);
      void recordingFailure(el.currentSrc || el.src).then(settle);
    } else setDuration(finite(el.duration));
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      seek(at) {
        const el = audio.current;
        if (!el) return;
        el.currentTime = Math.max(0, at);
        // Refused by autoplay rules or a failed load: the controls still work, and onError explains a failed load.
        el.play().catch(() => undefined);
      },
    }),
    [],
  );

  const report = (el: HTMLAudioElement) => {
    setTime(el.currentTime);
    onTimeChange?.(el.currentTime);
  };
  const focusInside = () => Boolean(box.current?.contains(document.activeElement));

  // Until the length is known (or when the file never says), the slider waits and the clock still runs.
  const end = duration ?? 0;
  const at = duration == null ? time : Math.min(time, duration);
  const played = end > 0 ? (at / end) * 100 : 0;

  return (
    <div ref={box} className={className}>
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        className="hidden"
        onLoadedMetadata={(event) => {
          setDuration(finite(event.currentTarget.duration));
          if (failed) {
            refocus.current = focusInside();
            setFailed(false);
          }
          setRetrying(false);
        }}
        onDurationChange={(event) => setDuration(finite(event.currentTarget.duration))}
        onTimeUpdate={(event) => report(event.currentTarget)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={(event) => {
          refocus.current = focusInside();
          setFailed(true);
          const at = event.currentTarget.currentSrc || src;
          void recordingFailure(at).then(settle);
          setRetrying(false);
          setPlaying(false);
        }}
      />
      {failed && failure === 'missing' ? (
        <p className="m-0 px-1 text-meta text-text-3">No recording for this call</p>
      ) : failed && failure === null ? (
        // Asking the server why: hold the space quietly rather than flash an error.
        <div className="h-12" />
      ) : failed ? (
        <Notice
          kind="error"
          title="Couldn’t load the recording"
          action={
            <Button
              ref={retry}
              type="button"
              variant="secondary"
              size="sm"
              loading={retrying}
              onClick={() => {
                setRetrying(true);
                audio.current?.load();
              }}
            >
              Retry
            </Button>
          }
        >
          {failure === 'offline' ? 'Check your connection, then retry.' : 'Something went wrong on our side. Retry in a moment.'}
        </Notice>
      ) : (
        <div
          role="group"
          aria-label={label}
          className="flex h-12 min-w-0 items-center gap-3 rounded-pill border border-border bg-canvas pl-1.5 pr-4 text-caption font-medium tabular-nums text-text-2 shadow-xs"
        >
          <button
            ref={toggle}
            type="button"
            aria-label={playing ? 'Pause' : 'Play'}
            onClick={() => {
              const el = audio.current;
              if (!el) return;
              if (el.paused) el.play().catch(() => undefined);
              else el.pause();
            }}
            className={cn(
              // 36px drawn; ::after takes the hit area to 44px.
              // The transparent border is the button's edge in forced colours.
              'relative grid size-9 shrink-0 place-items-center rounded-full border border-transparent bg-primary text-primary-foreground transition-[background-color,scale] duration-fast after:absolute after:-inset-1 hover:bg-primary-hover motion-safe:active:[scale:0.97]',
              '[&_svg]:size-4 [&_svg]:fill-current',
            )}
          >
            {playing ? <Pause aria-hidden strokeWidth={1.5} /> : <Play aria-hidden strokeWidth={1.5} className="translate-x-px" />}
          </button>
          {/* The slider speaks the position, so the times are read once, through it. */}
          <span aria-hidden className="min-w-9 text-right">
            {formatTurnTime(at)}
          </span>
          <input
            type="range"
            min={0}
            max={end}
            step={1}
            value={Math.floor(at)}
            disabled={duration == null}
            aria-label="Position in the call"
            aria-valuetext={duration == null ? undefined : `${spokenTime(at)} of ${spokenTime(end)}`}
            onChange={(event) => {
              const el = audio.current;
              if (!el) return;
              el.currentTime = Number(event.currentTarget.value);
              report(el);
            }}
            // How much has played, for the track's accent part.
            style={{ '--played': `${played}%` } as CSSProperties}
            className={RANGE}
          />
          <span aria-hidden className="min-w-9 text-text-3">
            {duration == null ? '' : formatTurnTime(end)}
          </span>
        </div>
      )}
    </div>
  );
}
