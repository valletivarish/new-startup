'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, X } from 'lucide-react';
import { cn } from '../ui/cn';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import { answerCoverage } from '../shared/answers-list';
import { SAMPLE_CALL } from './sample-data';
import { isSampleCallHref, stopAudio } from './sample-call-open';
import { clampTime, clock, DURATION, percentAt, playFrom, positionText, turnIndexAt } from './sample-call-timeline';

/** The sample call's recording. Labelled as a sample beside the player. */
const AUDIO_SRC = '/audio/sample-call.mp3';

const FIRST_NAME = SAMPLE_CALL.candidate.split(' ')[0] ?? SAMPLE_CALL.candidate;
const TURNS = SAMPLE_CALL.turns;

// Three moments worth jumping to. Found by their words, so the times follow the recording.
const moment = (words: string, label: string) => ({ at: TURNS.find((t) => t.text.includes(words))?.at ?? 0, label });
const MOMENTS = [
  moment('thirty days', 'Notice period: thirty days, can be shortened'),
  moment('can I pick which three days', 'Priya cuts in. It answers, then returns to its question'),
  moment('good jump from thirteen', 'It follows up on her salary: what’s behind the eighteen?'),
] as const;

// The turn each moment starts on, so its row lights up while its turn is spoken.
const MOMENT_TURNS = MOMENTS.map((m) => TURNS.findIndex((t) => t.at === m.at));

// The job's own questions; what she raised herself is in the transcript.
const ASKED = SAMPLE_CALL.answers.filter((a) => !('extra' in a && a.extra));
const COVERAGE = answerCoverage(SAMPLE_CALL.answers);

// A picture of the recording's loudness for the scrubber: fixed, so server and client agree.
const BARS = Array.from({ length: 72 }, (_, i) => {
  const v = Math.abs(Math.sin(i * 1.71) * 0.6 + Math.sin(i * 0.43) * 0.4);
  return Math.round(22 + v * 78);
});

// Play and Pause are drawn filled; the replay arrow stays a line.
const GLYPH_FILL = { play: 'translate-x-0.5 fill-current', pause: 'fill-current', again: undefined } as const;

const LABEL = 'm-0 text-[0.8125rem] font-medium uppercase tracking-[0.08em] text-site-fg-3';

interface PlayerProps {
  /** False once the dialog is closing: the recording stops while the panel slides away. */
  active: boolean;
  /** Start playing as soon as the player shows. Only after a click, never on a deep link. */
  autoPlay: boolean;
}

/**
 * The sample call's player: play and pause, a scrubber with the three moments marked on it,
 * the live transcript and the answers HRVoice wrote down. Press play and they light up
 * together: the line being spoken gets a lime rule, the moment of that turn fills, and each
 * answer brightens the second it is said. Every moment and answer jumps to its second and
 * plays from there. Reduced motion: no transitions, the transcript jumps instead of gliding.
 */
function SampleCallPlayer({ active, autoPlay }: PlayerProps) {
  const audio = useRef<HTMLAudioElement>(null);
  const lines = useRef<HTMLOListElement>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  // Nothing is highlighted or dimmed until the visitor plays or jumps.
  const [started, setStarted] = useState(false);

  // Moves the recording to `at`, or as soon as it knows its length if it doesn't yet.
  const seek = useCallback((at: number) => {
    const to = clampTime(at);
    setTime(to);
    setStarted(true);
    const a = audio.current;
    if (!a) return;
    if (a.readyState >= HTMLMediaElement.HAVE_METADATA) a.currentTime = to;
    else a.addEventListener('loadedmetadata', () => (a.currentTime = to), { once: true });
  }, []);

  const play = useCallback(() => {
    audio.current?.play().catch(() => setPlaying(false));
  }, []);

  // A moment or an answer: jump there and play.
  const playAt = useCallback(
    (at: number) => {
      seek(at);
      play();
    },
    [seek, play],
  );

  // The visitor's click opened the player, so it may play from the top straight away.
  useEffect(() => {
    if (autoPlay) playAt(0);
  }, [autoPlay, playAt]);

  // Closing stops the recording at once, not after the exit animation.
  useEffect(() => {
    if (!active) stopAudio(audio.current);
  }, [active]);

  // While it plays, the playhead follows the recording every frame.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      if (audio.current) setTime(audio.current.currentTime);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const current = started ? turnIndexAt(time) : -1;

  // The transcript keeps the spoken line a third of the way down its own box. Only the box
  // scrolls, never the page.
  useEffect(() => {
    const box = lines.current;
    const line = box?.children[current] as HTMLElement | undefined;
    if (!box || !line || box.scrollHeight <= box.clientHeight) return;
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    box.scrollTo({ top: line.offsetTop - box.clientHeight / 3, behavior: smooth ? 'smooth' : 'auto' });
  }, [current]);

  function toggle() {
    if (playing) {
      audio.current?.pause();
      return;
    }
    seek(playFrom(time));
    play();
  }

  const ended = time >= DURATION;
  const Glyph = playing ? Pause : ended ? RotateCcw : Play;
  const played = percentAt(time);

  return (
    <div className="grid min-h-0 grid-cols-[minmax(0,1fr)] overflow-y-auto overscroll-contain lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      {/* Play, the scrubber with its moments, the live transcript. */}
      <div className="min-w-0 px-5 pb-6 sm:px-8 lg:pb-8">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={toggle}
            aria-label={playing ? 'Pause the sample call' : ended ? 'Play the sample call again' : 'Play the sample call'}
            className="grid size-14 shrink-0 place-items-center rounded-full bg-white text-site-black shadow-[0_0_0_7px_rgb(255_255_255/0.08)] transition-[background-color,scale] duration-200 hover:bg-[#e9ebee] focus-visible:outline-white motion-safe:active:[scale:0.96] sm:size-16 [&_svg]:size-5"
          >
            <Glyph aria-hidden strokeWidth={1.5} className={GLYPH_FILL[playing ? 'pause' : ended ? 'again' : 'play']} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="m-0 truncate text-[1.0625rem] text-white">{SAMPLE_CALL.candidate}</p>
            <p className="m-0 mt-0.5 text-[0.875rem] tabular-nums text-site-fg-2">
              {clock(time)} <span className="text-site-fg-3">of {clock(DURATION)}</span>
            </p>
          </div>
        </div>

        {/* The waveform is a picture; the native range under the moment markers is the control. */}
        <div className="relative mt-6 h-12 rounded-[6px] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-4 has-[:focus-visible]:outline-white">
          <div aria-hidden className="flex h-full items-center gap-[3px]">
            {BARS.map((h, i) => (
              <span
                key={i}
                className={cn('min-w-0 flex-1 rounded-full', ((i + 0.5) / BARS.length) * 100 <= played ? 'bg-white' : 'bg-white/25')}
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
          {started ? (
            <span aria-hidden className="absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full bg-site-lime" style={{ left: `${played}%` }} />
          ) : null}
          <input
            type="range"
            min={0}
            max={DURATION}
            step={1}
            value={Math.floor(time)}
            aria-label="Position in the sample call"
            aria-valuetext={positionText(time)}
            onChange={(event) => seek(Number(event.currentTarget.value))}
            className="absolute inset-0 size-full cursor-pointer appearance-none opacity-0"
          />
          {MOMENTS.map((m, i) => (
            <button
              key={m.label}
              type="button"
              title={m.label}
              aria-label={`Jump to ${clock(m.at)}: ${m.label}`}
              onClick={() => playAt(m.at)}
              className="group/mark absolute -top-3 z-10 size-6 -translate-x-1/2 rounded-full before:absolute before:-inset-2.5 before:content-[''] focus-visible:outline-white"
              style={{ left: `${percentAt(m.at)}%` }}
            >
              <span
                className={cn(
                  'absolute left-1/2 top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-site-lime transition-[background-color,scale] duration-200 group-hover/mark:scale-125',
                  current === MOMENT_TURNS[i] ? 'bg-site-lime' : 'bg-[#0b1117]',
                )}
              />
            </button>
          ))}
        </div>

        <ul role="list" aria-label="Moments in the call" className="m-0 mt-5 grid list-none gap-1.5 p-0">
          {MOMENTS.map((m, i) => {
            const on = current === MOMENT_TURNS[i];
            return (
              <li key={m.label}>
                <button
                  type="button"
                  onClick={() => playAt(m.at)}
                  aria-pressed={on}
                  className={cn(
                    'flex min-h-11 w-full items-center gap-3 rounded-[10px] border px-3 py-2 text-left text-[0.875rem] leading-snug transition-colors duration-200',
                    on ? 'border-white bg-white text-site-black' : 'border-white/15 bg-white/[0.04] text-white hover:border-white/40',
                  )}
                >
                  <span className={cn('shrink-0 tabular-nums', on ? 'text-site-black/70' : 'text-site-fg-3')}>{clock(m.at)}</span>
                  {m.label}
                </button>
              </li>
            );
          })}
        </ul>

        <h3 id="sample-call-transcript" className={cn(LABEL, 'mt-7')}>
          Transcript
        </h3>
        <ol
          ref={lines}
          role="list"
          tabIndex={0}
          aria-labelledby="sample-call-transcript"
          className="relative m-0 mt-3 grid h-[11.5rem] list-none content-start gap-3.5 overflow-y-auto overscroll-contain p-0 pr-2 focus-visible:outline-white lg:h-[13rem]"
        >
          {TURNS.map((turn, i) => {
            const now = i === current;
            return (
              <li
                key={turn.at}
                aria-current={now ? 'true' : undefined}
                className={cn(
                  'border-l-2 pl-3.5 transition-[opacity,border-color] duration-300',
                  now ? 'border-site-lime opacity-100' : 'border-transparent',
                  !now && current >= 0 && (i < current ? 'opacity-50' : 'opacity-80'),
                )}
              >
                <p className="m-0 flex items-baseline gap-2 text-[0.75rem] text-site-fg-3">
                  <span className="font-medium text-site-fg-2">{turn.speaker === 'agent' ? 'Hiring team' : FIRST_NAME}</span>
                  <span className="tabular-nums">{clock(turn.at)}</span>
                </p>
                <p className="m-0 mt-0.5 text-[0.9375rem] leading-relaxed text-white">{turn.text}</p>
              </li>
            );
          })}
        </ol>
      </div>

      {/* What HRVoice wrote down, each answer lighting up the second it is said. */}
      <div className="min-w-0 border-t border-white/10 bg-black/25 px-5 py-6 sm:px-8 lg:border-l lg:border-t-0">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className={LABEL}>What HRVoice wrote down</h3>
          <p className="m-0 text-[0.8125rem] tabular-nums text-site-fg-3">
            {COVERAGE.answered} of {COVERAGE.total} answered
          </p>
        </div>
        <ul role="list" className="m-0 mt-4 grid list-none gap-2 p-0">
          {ASKED.map((item) => {
            const heard = !started || (item.at !== null && time >= item.at);
            return (
              <li key={item.question}>
                <button
                  type="button"
                  disabled={item.at === null}
                  onClick={() => item.at !== null && playAt(item.at)}
                  className={cn(
                    'group flex size-full min-h-11 items-start gap-3 rounded-[12px] border px-3.5 py-2.5 text-left transition-[opacity,border-color,background-color] duration-300',
                    heard ? 'border-white/15 bg-white/[0.05] hover:border-white/40' : 'border-white/10 opacity-45',
                    started && heard && 'border-l-site-lime',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.75rem] text-site-fg-3">{item.question}</span>
                    <span className="mt-0.5 block text-[0.875rem] leading-snug text-white">
                      {heard ? item.answer ?? 'Not answered' : 'Not asked yet'}
                    </span>
                  </span>
                  {item.at !== null ? (
                    <span className="inline-flex shrink-0 items-center gap-1 pt-0.5 text-[0.75rem] tabular-nums text-site-fg-2 group-hover:text-white">
                      <Play aria-hidden strokeWidth={1.5} className="size-3 fill-current" />
                      <span className="sr-only">Play from </span>
                      {clock(item.at)}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <audio
        ref={audio}
        src={AUDIO_SRC}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setTime(DURATION);
        }}
      />
    </div>
  );
}

/**
 * The sample call, as a dialog: a sheet from the bottom on phones, a centred panel from md.
 * It opens from any "Hear a sample call" button or link on the page (the hero and closing
 * buttons, the chat's links, `#sample-call` and the old `#sample-call-card`) and from a deep
 * link on load. A click starts the recording; a deep link only shows the player, because the
 * browser wouldn't let it play unasked. Radix traps focus, Esc closes, and focus goes back to
 * whatever opened it.
 */
export function SampleCallDialog() {
  const [open, setOpen] = useState(false);
  const [autoPlay, setAutoPlay] = useState(false);

  useEffect(() => {
    const show = (withSound: boolean) => {
      setAutoPlay(withSound);
      setOpen(true);
    };
    // Capture phase and preventDefault: a Next link to the anchor must not also scroll or navigate.
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const opener = event.target instanceof Element ? event.target.closest('[data-sample-call-open], a[href^="#"]') : null;
      if (!opener || !(opener.hasAttribute('data-sample-call-open') || isSampleCallHref(opener.getAttribute('href')))) return;
      event.preventDefault();
      show(true);
    };
    const onHash = () => isSampleCallHref(window.location.hash) && show(false);
    document.addEventListener('click', onClick, true);
    window.addEventListener('hashchange', onHash);
    onHash();
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('hashchange', onHash);
    };
  }, []);

  function onOpenChange(next: boolean) {
    setOpen(next);
    // A deep link shouldn't reopen the player on refresh once it has been closed.
    if (!next && isSampleCallHref(window.location.hash)) history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        className={cn(
          'max-h-none gap-0 overflow-visible border-0 bg-transparent p-0 shadow-none',
          // A sheet from the bottom on phones, a centred panel from md.
          'inset-x-0 bottom-0 left-0 top-auto w-full translate-x-0',
          'max-md:data-[state=closed]:animate-slide-out-down max-md:data-[state=open]:animate-slide-in-up',
          'md:bottom-auto md:left-1/2 md:top-1/2 md:w-[min(62rem,calc(100vw-4rem))] md:-translate-x-1/2 md:-translate-y-1/2',
        )}
      >
        {/* Outside .site in the DOM (a portal), so the site's tokens are set again here. */}
        <div className="site relative flex max-h-[92dvh] flex-col overflow-hidden rounded-t-[26px] border border-white/15 shadow-[0_40px_120px_rgb(0_0_0/0.6)] md:max-h-[min(52rem,90dvh)] md:rounded-[26px]">
          <div className="relative px-5 pb-5 pt-6 pr-16 sm:px-8 sm:pr-20 md:pt-8">
            <DialogTitle className="text-[clamp(1.375rem,1.1rem+0.9vw,1.875rem)] font-normal tracking-[-0.03em] text-white">
              Sample screening call
            </DialogTitle>
            <DialogDescription className="mt-1.5 max-w-[52ch] text-[0.9375rem] leading-relaxed text-site-fg-2">
              A sample call for a software engineer role at a sample company.
            </DialogDescription>
            <DialogClose
              aria-label="Close the sample call"
              className="site-frost absolute right-4 top-4 inline-flex size-11 items-center justify-center rounded-full text-white transition-colors hover:bg-white/25 focus-visible:outline-white sm:right-6 sm:top-6 md:top-7"
            >
              <X aria-hidden strokeWidth={1.5} className="size-5" />
            </DialogClose>
          </div>
          <SampleCallPlayer active={open} autoPlay={autoPlay} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
