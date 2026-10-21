'use client';

import { memo, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { cn } from '../ui/cn';
import { CircleCheck, Pause, Play, RotateCcw } from 'lucide-react';
import { StatusTag } from '../ui/state-tag';
import { AnswersList, answerCoverage } from '../shared/answers-list';
import { Transcript, type TranscriptTurn } from '../shared/transcript';
import { UserInitials } from '../shared/user-initials';
import { SAMPLE_CALL, SAMPLE_JOB } from './sample-data';
import { clampTime, clock, DURATION, percentAt, playFrom, positionText, turnIndexAt } from './sample-call-timeline';
import { CONTAINER, Italic, PhotoFrame, SAMPLE_NOTE, SECTION, SIGNUP_HREF, siteButton } from './kit';
import framePhoto from '../../public/images/site/sample-frame.jpg';

/** The sample call's recording. Both voices are generated; the note under the player says so. */
const AUDIO_SRC = '/audio/sample-call.mp3';

const TURNS: readonly TranscriptTurn[] = SAMPLE_CALL.turns.map((turn) => ({
  ...turn,
  name: SAMPLE_CALL.candidate.split(' ')[0],
}));

// Three moments worth jumping to. Found by their words, so the times follow the recording.
// Each carries a short quote of the turn, cut at a word near 70 characters.
const quote = (text: string) => (text.length <= 70 ? text : `${text.slice(0, text.lastIndexOf(' ', 70))}…`);
const moment = (words: string, label: string) => {
  const turn = SAMPLE_CALL.turns.find((t) => t.text.includes(words));
  return { at: turn?.at ?? 0, label, quote: turn ? quote(turn.text) : '' };
};
const MOMENTS = [
  moment('thirty days', 'Notice period: thirty days, can be shortened'),
  moment('can I pick which three days', 'She cuts in with a question'),
  moment('thirteen lakh', 'Current and expected salary'),
] as const;

// The header's one-line facts, from the data.
const COVERAGE = answerCoverage(SAMPLE_CALL.answers);
const FACTS = `${clock(DURATION)} call · ${COVERAGE.answered} of ${COVERAGE.total} answered · ${SAMPLE_CALL.language}`;

// Collapsed, the card shows the first answers and fits a laptop screen.
const ANSWERS_SHOWN = 3;

const POINTS = [
  'Summary first, transcript one click away',
  'Every answer links to the second it was said',
  'It never recommends hire or reject',
] as const;

// The clock ticks every frame; these two re-render only when the turn or a handler changes.
const CallTranscript = memo(Transcript);
const CallAnswers = memo(AnswersList);

// The real player's pill (shared/recording-player.tsx), following the sample recording. The
// native range stays the control; its track draws the played part up to --played.
const RANGE =
  'h-11 w-0 min-w-0 flex-1 cursor-pointer appearance-none bg-transparent focus-visible:outline-none focus-visible:shadow-none ' +
  'forced-colors:appearance-auto forced-colors:focus-visible:[outline:2px_solid_Highlight] ' +
  '[&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:[background:linear-gradient(to_right,var(--accent)_var(--played),var(--border)_var(--played))] ' +
  '[&::-webkit-slider-thumb]:-mt-1.5 [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-canvas [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:[box-shadow:var(--shadow-xs)] ' +
  '[&:focus-visible::-webkit-slider-thumb]:[box-shadow:0_0_0_2px_var(--canvas),0_0_0_4px_var(--focus-ring)] ' +
  '[&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-border ' +
  '[&::-moz-range-progress]:h-1 [&::-moz-range-progress]:rounded-full [&::-moz-range-progress]:bg-accent ' +
  '[&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-canvas [&::-moz-range-thumb]:bg-accent ' +
  '[&:focus-visible::-moz-range-thumb]:[box-shadow:0_0_0_2px_var(--canvas),0_0_0_4px_var(--focus-ring)]';

const LABEL = 'm-0 text-label font-semibold text-text-2';

// Play and Pause are drawn filled, as in the real player; the replay arrow stays a line.
const GLYPH_FILL = { play: 'translate-x-px fill-current', pause: 'fill-current', again: undefined } as const;

export interface SampleCallSectionProps {
  /** Classes for the section band: padding or a different background. */
  className?: string;
}

/**
 * Website section 3 (#sample-call): the pitch on the black, beside one finished sample call
 * shown as the app's own white card set in a photograph. Play plays the call's recording and
 * the transcript highlights the turn being spoken; time pills and transcript times jump to the
 * moment and play from there. It keeps playing when scrolled away, like any recording.
 */
export function SampleCallSection({ className }: SampleCallSectionProps) {
  const audio = useRef<HTMLAudioElement>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  // No turn is highlighted until the visitor plays or jumps.
  const [started, setStarted] = useState(false);
  const [allAnswers, setAllAnswers] = useState(false);

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

  // A transcript time says "Play from 0:28": jump there and play.
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
  // The turn's own start, so the transcript re-renders once per turn, not once per frame.
  const current = TURNS[turnIndexAt(time)];
  const turnTime = current?.at ?? 0;

  return (
    <section id="sample-call" aria-labelledby="sample-call-title" className={cn(SECTION, 'pt-0 md:pt-0', className)}>
      <div className={cn(CONTAINER, 'grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-10 xl:gap-16')}>
        <div data-reveal className="lg:sticky lg:top-24 lg:col-span-5 lg:self-start">
          <h2 id="sample-call-title" className="site-h2 m-0 text-white">
            {/* Never broken at its hyphen. */}
            <span className="block">Review a call</span>
            <Italic>without replaying it</Italic>
          </h2>
          <ul role="list" className="m-0 mt-8 grid list-none gap-4 p-0">
            {POINTS.map((point) => (
              <li key={point} className="flex gap-3 text-[1rem] leading-relaxed text-site-fg-2">
                <CircleCheck aria-hidden strokeWidth={1.5} className="mt-0.5 size-5 shrink-0 text-site-lime" />
                {point}
              </li>
            ))}
          </ul>
          <h3 className="m-0 mt-10 text-[0.9375rem] font-medium text-white">Moments to listen for</h3>
          <ul role="list" className="m-0 mt-3 grid list-none gap-2 p-0">
            {MOMENTS.map((moment) => (
              <li key={moment.label}>
                <button
                  type="button"
                  onClick={() => playAt(moment.at)}
                  className="group flex w-full items-start gap-3 rounded-[10px] border border-site-line p-3 text-left transition-colors duration-200 hover:border-white/40"
                >
                  <span className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[8px] border border-site-line px-2 text-[0.8125rem] tabular-nums text-white transition-colors duration-200 group-hover:border-white/40">
                    <Play aria-hidden strokeWidth={1.5} className="size-3 fill-current" />
                    {clock(moment.at)}
                  </span>
                  <span className="grid min-w-0 gap-1 pt-0.5">
                    <span className="text-[0.9375rem] text-white">{moment.label}</span>
                    <span className="text-[0.8125rem] leading-relaxed text-site-fg-3">{`“${moment.quote}”`}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <Link href={SIGNUP_HREF} className={cn(siteButton('paper'), 'mt-8')}>
            Start a pilot
          </Link>
        </div>

        <figure id="sample-call-card" data-reveal className="m-0 min-w-0 scroll-mt-6 lg:col-span-7">
          <PhotoFrame photo={framePhoto} sizes="(min-width: 1024px) 60vw, 100vw" position="50% 60%" className="p-3 sm:p-5 md:p-8 lg:p-5">
          <div className="rounded-card border border-border bg-canvas text-text shadow-float">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-border px-5 py-4 md:px-6">
              <UserInitials name={SAMPLE_CALL.candidate} size="lg" />
              <div className="min-w-0 flex-1 basis-48">
                <p className="m-0 truncate text-title font-semibold text-text">{SAMPLE_CALL.candidate}</p>
                <p className="m-0 truncate text-meta text-text-3">{`${SAMPLE_JOB.title}, ${SAMPLE_JOB.location}`}</p>
                <p className="m-0 mt-1 text-meta tabular-nums text-text-2">{FACTS}</p>
              </div>
              <StatusTag domain="call" value="ready_for_review" />
            </div>

            {/* minmax(0,1fr) tracks: the player and transcript shrink to a 320px phone. */}
            <div className="grid grid-cols-[minmax(0,1fr)] gap-4 p-5 md:p-6">
              <div>
                <h3 className={LABEL}>Summary</h3>
                <p className="m-0 mt-2 max-w-[68ch] text-md text-text">{SAMPLE_CALL.summary}</p>
              </div>

              <div className="grid gap-2">
                <div
                  role="group"
                  aria-label="Sample call playback"
                  className="flex h-14 min-w-0 items-center gap-3 rounded-pill border border-border bg-canvas pl-2 pr-4 text-caption font-medium tabular-nums text-text-2 shadow-xs"
                >
                  <button
                    type="button"
                    onClick={toggle}
                    aria-label={playing ? 'Pause' : ended ? 'Play again' : 'Play'}
                    className="relative grid size-11 shrink-0 place-items-center rounded-full border border-transparent bg-primary text-primary-foreground transition-[background-color,scale] duration-fast hover:bg-primary-hover motion-safe:active:[scale:0.97] [&_svg]:size-5"
                  >
                    <Glyph aria-hidden strokeWidth={1.5} className={GLYPH_FILL[playing ? 'pause' : ended ? 'again' : 'play']} />
                  </button>
                  {/* The slider speaks the position, so the times are read once, through it. */}
                  <span aria-hidden className="min-w-9 text-right">
                    {clock(time)}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={DURATION}
                    step={1}
                    value={Math.floor(time)}
                    aria-label="Position in the call"
                    aria-valuetext={positionText(time)}
                    onChange={(event) => seek(Number(event.currentTarget.value))}
                    // How much has played, for the track's accent part.
                    style={{ '--played': `${percentAt(time)}%` } as CSSProperties}
                    className={RANGE}
                  />
                  <span aria-hidden className="min-w-9 text-text-3">
                    {clock(DURATION)}
                  </span>
                </div>
                {/* Phones can't see the highlighted line below: the line being spoken, under the player.
                    Hidden from assistive tech, which follows the transcript's aria-current. */}
                {started && current ? (
                  <p aria-hidden className="m-0 mt-1 line-clamp-2 min-h-[2.6em] text-label text-text">
                    <span className="font-semibold">{current.speaker === 'agent' ? 'AI agent' : current.name}: </span>
                    {current.text}
                  </p>
                ) : null}
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

              <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-2">
                <div className="flex min-w-0 flex-col">
                  <h3 className={LABEL}>Transcript</h3>
                  {/* Side by side, the transcript takes the answers' height and scrolls inside it. */}
                  <div className="relative mt-3 xl:min-h-[16rem] xl:flex-1">
                    <CallTranscript
                      turns={TURNS}
                      currentTime={started ? turnTime : undefined}
                      onPlayFrom={playAt}
                      label="Transcript of the sample call"
                      agentLabel="AI hiring agent"
                      className="max-h-[16rem] xl:absolute xl:inset-0 xl:max-h-none"
                    />
                  </div>
                </div>
                <div className="min-w-0 xl:border-l xl:border-border xl:pl-6">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className={LABEL}>Answers</h3>
                    {SAMPLE_CALL.answers.length > ANSWERS_SHOWN ? (
                      // A 44px target without growing the heading row.
                      <button
                        type="button"
                        aria-expanded={allAnswers}
                        aria-controls="sample-call-answers"
                        onClick={() => setAllAnswers((open) => !open)}
                        className="relative rounded-xs text-label font-medium text-text underline decoration-border underline-offset-4 transition-colors duration-fast after:absolute after:-inset-x-2 after:-inset-y-3 hover:decoration-text"
                      >
                        {allAnswers ? 'Show fewer' : `Show all ${COVERAGE.total}`}
                      </button>
                    ) : null}
                  </div>
                  <CallAnswers
                    id="sample-call-answers"
                    items={SAMPLE_CALL.answers}
                    onSeek={seek}
                    limit={allAnswers ? undefined : ANSWERS_SHOWN}
                    className="mt-3"
                  />
                </div>
              </div>
            </div>
          </div>
          </PhotoFrame>
          <figcaption className="mt-4 text-[0.8125rem] text-site-fg-3">{SAMPLE_NOTE}</figcaption>
        </figure>
      </div>
    </section>
  );
}
