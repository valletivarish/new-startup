'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { cn } from '../ui/cn';
import { answerCoverage } from '../shared/answers-list';
import { SAMPLE_CALL, SAMPLE_JOB } from './sample-data';
import { clampTime, clock, DURATION, percentAt, playFrom, positionText, turnIndexAt } from './sample-call-timeline';
import { CONTAINER, Italic, SECTION, Tag } from './kit';
import framePhoto from '../../public/images/site/sample-frame.jpg';

/** The sample call's recording. Labelled as a sample beside the player. */
const AUDIO_SRC = '/audio/sample-call.mp3';

const FIRST_NAME = SAMPLE_CALL.candidate.split(' ')[0] ?? SAMPLE_CALL.candidate;
const TURNS = SAMPLE_CALL.turns;

// Three moments worth jumping to. Found by their words, so the times follow the recording.
// Each carries a short quote of the turn, cut at a word near 70 characters.
const quote = (text: string) => (text.length <= 70 ? text : `${text.slice(0, text.lastIndexOf(' ', 70))}…`);
const moment = (words: string, label: string) => {
  const turn = SAMPLE_CALL.turns.find((t) => t.text.includes(words));
  return { at: turn?.at ?? 0, label, quote: turn ? quote(turn.text) : '' };
};
const MOMENTS = [
  moment('thirty days', 'Notice period: thirty days, can be shortened'),
  moment('can I pick which three days', 'Priya cuts in. It answers, then returns to its question'),
  moment('good jump from thirteen', 'It follows up on her salary: what’s behind the eighteen?'),
] as const;

// The turn each moment starts on, so a chip lights up while its turn is spoken.
const MOMENT_TURNS = MOMENTS.map((m) => TURNS.findIndex((t) => t.at === m.at));

// The job's own questions; what she raised herself is in the transcript.
const ASKED = SAMPLE_CALL.answers.filter((a) => !('extra' in a && a.extra));
const COVERAGE = answerCoverage(SAMPLE_CALL.answers);
const FACTS = `${SAMPLE_JOB.title}, ${SAMPLE_JOB.location} · ${clock(DURATION)} · ${COVERAGE.answered} of ${COVERAGE.total} answered`;

/** Three plain facts under the card, true of every call. */
const POINTS = ['Same questions, in your order, on every call', 'Tap an answer to hear that moment', 'It never rejects anyone. You decide.'] as const;

// A picture of the recording's loudness for the scrubber: fixed, so server and client agree.
const BARS = Array.from({ length: 72 }, (_, i) => {
  const v = Math.abs(Math.sin(i * 1.71) * 0.6 + Math.sin(i * 0.43) * 0.4);
  return Math.round(22 + v * 78);
});

// Play and Pause are drawn filled; the replay arrow stays a line.
const GLYPH_FILL = { play: 'translate-x-0.5 fill-current', pause: 'fill-current', again: undefined } as const;

export interface SampleCallSectionProps {
  /** Classes for the section band: padding or a different background. */
  className?: string;
}

/**
 * Website section 2 (#sample-call), the page's signature moment, laid out after Halo's "Hear a
 * real call": one wide glass card over a darkened photograph. Left, the moments to jump to, a
 * large play button and a waveform scrubber, then the job's answers. Right, the transcript.
 * Press play and the three light up together: the line being spoken gets a lime rule, the
 * moment chip of that turn fills, and each answer brightens the second it is said. Every chip
 * and answer jumps to its second and plays from there. It keeps playing when scrolled away,
 * like any recording. Reduced motion: no transitions, the transcript jumps instead of gliding.
 */
export function SampleCallSection({ className }: SampleCallSectionProps) {
  const audio = useRef<HTMLAudioElement>(null);
  const lines = useRef<HTMLOListElement>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  // Nothing is highlighted or dimmed until the visitor plays or jumps.
  const [started, setStarted] = useState(false);
  const [fullTranscript, setFullTranscript] = useState(false);

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

  // "Hear a sample call" (hero, closing band, chat) scrolls here; it starts the recording too,
  // since that click is the visitor asking to hear it.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest('a[href="#sample-call-card"]') : null;
      if (link && audio.current?.paused) playAt(playFrom(audio.current.currentTime));
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [playAt]);

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
    <section
      id="sample-call"
      aria-labelledby="sample-call-title"
      className={cn(SECTION, 'relative isolate overflow-hidden pt-16 md:pt-24', className)}
    >
      {/* The photograph the glass sits on, darkened to black at both edges. */}
      <div aria-hidden data-photo-frame className="absolute inset-0 -z-10">
        <div data-photo-drift className="absolute inset-[-6%_0]">
          <Image src={framePhoto} alt="" fill sizes="100vw" placeholder="blur" className="object-cover object-[50%_60%]" />
        </div>
        <div className="absolute inset-0 [background:linear-gradient(to_bottom,#050505_0%,rgb(5_5_5/0.55)_30%,rgb(5_5_5/0.5)_70%,#050505_100%)]" />
      </div>

      <div className={CONTAINER}>
        <div data-reveal className="flex flex-col items-center text-center">
          <Tag>Sample call</Tag>
          <h2 id="sample-call-title" className="site-h2 m-0 mt-5 text-white">
            Hear a full screening call. <Italic>Then&nbsp;read&nbsp;the&nbsp;answers.</Italic>
          </h2>
        </div>

        <figure
          id="sample-call-card"
          data-reveal
          className="site-smoke m-0 mt-10 grid scroll-mt-24 grid-cols-[minmax(0,1fr)] overflow-hidden rounded-[26px] md:mt-14 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]"
        >
          {/* The player: moments, play, the scrubber. */}
          <div className="min-w-0 p-5 sm:p-7 lg:col-start-1 lg:row-start-1 lg:p-9 lg:pb-6">
            <p className="m-0 text-[0.8125rem] text-site-fg-3" id="sample-call-moments">
              Jump to a part of the call
            </p>
            <ul
              role="list"
              aria-labelledby="sample-call-moments"
              className="-mx-5 m-0 mt-2.5 flex list-none snap-x scroll-px-5 gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] sm:-mx-7 sm:px-7 lg:mx-0 lg:flex-wrap lg:px-0"
            >
              {MOMENTS.map((m, i) => {
                const on = current === MOMENT_TURNS[i];
                return (
                  <li key={m.label} className="shrink-0 snap-start">
                    <button
                      type="button"
                      onClick={() => playAt(m.at)}
                      aria-pressed={on}
                      className={cn(
                        'inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-[10px] border px-3.5 text-[0.875rem] transition-colors duration-200',
                        on
                          ? 'border-white bg-white text-site-black'
                          : 'border-white/20 bg-white/[0.06] text-white hover:border-white/45',
                      )}
                    >
                      <span className={cn('tabular-nums', on ? 'text-site-black/70' : 'text-site-fg-3')}>{clock(m.at)}</span>
                      {m.label}
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="mt-7 flex items-center gap-4 sm:gap-5">
              <button
                type="button"
                onClick={toggle}
                aria-label={playing ? 'Pause the sample call' : ended ? 'Play the sample call again' : 'Play the sample call'}
                className="grid size-16 shrink-0 place-items-center rounded-full bg-white text-site-black shadow-[0_0_0_8px_rgb(255_255_255/0.08)] transition-[background-color,scale] duration-200 hover:bg-[#e9ebee] focus-visible:outline-white motion-safe:active:[scale:0.96] sm:size-[4.5rem] [&_svg]:size-6"
              >
                <Glyph aria-hidden strokeWidth={1.5} className={GLYPH_FILL[playing ? 'pause' : ended ? 'again' : 'play']} />
              </button>
              <div className="min-w-0">
                <h3 className="m-0 truncate text-[clamp(1.25rem,1rem+0.8vw,1.625rem)] font-normal tracking-[-0.025em] text-white">
                  Screening {SAMPLE_CALL.candidate}
                </h3>
                <p className="m-0 mt-1 text-[0.875rem] tabular-nums text-site-fg-2">{FACTS}</p>
              </div>
            </div>

            {/* The waveform is a picture; the native range on top of it is the control. */}
            <div className="mt-6">
              <div className="relative h-12 rounded-[6px] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-4 has-[:focus-visible]:outline-white">
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
              </div>
              <div aria-hidden className="mt-2 flex justify-between text-[0.8125rem] tabular-nums text-site-fg-3">
                <span>{clock(time)}</span>
                <span>{clock(DURATION)}</span>
              </div>
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

          {/* The transcript: the spoken line gets the lime rule, the lines before it dim. */}
          <div className="relative flex min-w-0 flex-col border-t border-white/10 bg-black/25 p-5 sm:p-7 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:border-l lg:border-t-0 lg:p-8">
            <h3 id="sample-call-transcript" className="m-0 text-[0.8125rem] font-medium uppercase tracking-[0.08em] text-site-fg-3">
              Transcript
            </h3>
            <div className="relative mt-4 min-h-0 flex-1">
              <ol
                ref={lines}
                id="sample-call-lines"
                role="list"
                tabIndex={0}
                aria-labelledby="sample-call-transcript"
                className={cn(
                  'm-0 grid list-none content-start gap-4 overflow-y-auto overscroll-contain p-0 pr-2 focus-visible:outline-white lg:absolute lg:inset-0 lg:max-h-none',
                  !fullTranscript && 'max-h-[12.5rem] [mask-image:linear-gradient(to_bottom,#000_75%,transparent)] lg:[mask-image:none]',
                )}
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
                      <p className="m-0 mt-1 text-[0.9375rem] leading-relaxed text-white">{turn.text}</p>
                    </li>
                  );
                })}
              </ol>
            </div>
            <button
              type="button"
              aria-expanded={fullTranscript}
              aria-controls="sample-call-lines"
              onClick={() => setFullTranscript((open) => !open)}
              className="mt-2 inline-flex min-h-11 w-fit items-center text-[0.875rem] font-medium text-white underline decoration-white/40 underline-offset-[5px] hover:decoration-white lg:hidden"
            >
              {fullTranscript ? 'Shorter transcript' : 'Full transcript'}
            </button>
          </div>

          {/* The job's answers, each lighting up the second it is said. */}
          <div className="min-w-0 border-t border-white/10 p-5 sm:p-7 lg:col-start-1 lg:row-start-2 lg:p-9 lg:pt-7">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="m-0 text-[0.8125rem] font-medium uppercase tracking-[0.08em] text-site-fg-3">Your must-ask questions</h3>
            </div>
            <ul role="list" className="m-0 mt-4 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2">
              {ASKED.map((item, i) => {
                const heard = !started || (item.at !== null && time >= item.at);
                return (
                  // Phones show the first four, to keep the section near a screen and a half.
                  <li key={item.question} className={i >= 4 ? 'max-sm:hidden' : undefined}>
                    <button
                      type="button"
                      disabled={item.at === null}
                      onClick={() => item.at !== null && playAt(item.at)}
                      className={cn(
                        'group flex size-full min-h-11 items-start gap-3 rounded-[12px] border px-3.5 py-3 text-left transition-[opacity,border-color,background-color] duration-300',
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
        </figure>

        <ul role="list" className="m-0 mt-8 flex list-none flex-wrap justify-center gap-x-8 gap-y-3 p-0">
          {POINTS.map((point) => (
            <li key={point} className="inline-flex items-center gap-2.5 text-[0.9375rem] text-site-fg-2">
              <span aria-hidden className="size-1.5 rounded-full bg-site-lime" />
              {point}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
