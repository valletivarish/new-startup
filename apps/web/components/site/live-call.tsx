'use client';

import { useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { Pause, Play } from 'lucide-react';
import { Agent } from '../brand/agent';
import type { AgentState } from '../brand/agent-draw';
import { ListeningBar, type ListeningState } from '../shared/listening-bar';
import { Transcript, type TranscriptTurn } from '../shared/transcript';
import { cn } from '../ui/cn';
import { SAMPLE_CALL, SAMPLE_JOB } from './sample-data';

gsap.registerPlugin(useGSAP);

/* The sequence. Pure, and tested in live-call.test.ts. */

const FIRST_NAME = SAMPLE_CALL.candidate.split(' ')[0] ?? SAMPLE_CALL.candidate;

/**
 * The sample call's opening: who is calling and why, two questions, and the candidate cutting
 * in while the agent explains the office days. It ends on her line, so the held frame reads
 * "Listening…".
 */
export const HERO_TURNS: readonly TranscriptTurn[] = SAMPLE_CALL.turns.slice(0, 8).map((turn) => ({
  speaker: turn.speaker,
  name: turn.speaker === 'contact' ? FIRST_NAME : undefined,
  at: turn.at,
  text: turn.text,
}));

// Timings in seconds (spec 2, website hero). A line lands every 0.9s: it fades in and rises
// 8px over 220ms on power3.out while the lines above slide up to make room.
export const LEAD = 2.6; // the phone rings (two rings and a pause) before the first line
export const GAP = 0.9;
export const BUBBLE = 0.22;
export const PUSH = 0.32;
export const HOLD = 6; // the last frame rests before the loop fades and replays
export const FADE = 0.3;

/** When each line lands, in seconds from the start of the loop. */
export const HERO_BEATS: readonly number[] = HERO_TURNS.map((_, i) => LEAD + i * GAP);

const LAST = HERO_TURNS.length - 1;
const callTime = (turn: number) => HERO_TURNS[turn]?.at ?? 0;

/** Every line on the card: the frame the loop holds, and the one the server draws. */
export const HOLD_FROM = (HERO_BEATS[LAST] ?? 0) + PUSH;
export const HERO_LOOP = HOLD_FROM + HOLD + FADE;

/** The last line on the card `time` seconds into the loop. -1 before the first. */
export function turnAt(time: number): number {
  let turn = -1;
  HERO_BEATS.forEach((at, i) => {
    if (at <= time) turn = i;
  });
  return turn;
}

/**
 * Call seconds on the timer `time` seconds into the loop. It reads each line's own time as
 * the line lands, runs on to the next line's time in between, and stops on the last.
 */
export function clockAt(time: number): number {
  const turn = turnAt(time);
  if (turn < 0) return callTime(0);
  if (turn >= LAST) return callTime(LAST);
  const progress = Math.min(1, Math.max(0, (time - (HERO_BEATS[turn] ?? 0)) / GAP));
  return callTime(turn) + (callTime(turn + 1) - callTime(turn)) * progress;
}

/** "Speaking" once the agent's line is up, "Listening…" while the candidate talks (and before anyone has). */
export function listeningOf(turn: number): ListeningState {
  return HERO_TURNS[turn]?.speaker === 'agent' ? 'speaking' : 'listening';
}

// How long the agent visibly thinks before each of its own lines.
const THINK = 0.45;

/** What the large agent acts out `time` seconds into the loop. */
export function agentStateAt(time: number): AgentState {
  const turn = turnAt(time);
  const next = HERO_TURNS[turn + 1];
  const nextAt = HERO_BEATS[turn + 1];
  if (next?.speaker === 'agent' && nextAt !== undefined && nextAt - time <= THINK && turn >= 0) return 'thinking';
  if (turn < 0) return 'ringing';
  return HERO_TURNS[turn]?.speaker === 'agent' ? 'speaking' : 'listening';
}

/* The card. */

interface Frame {
  turn: number;
  clock: number;
  agent: AgentState;
}

const HELD: Frame = { turn: LAST, clock: callTime(LAST), agent: 'listening' };

/**
 * The live call card beside the candidate in the hero photo: dark glass, the agent's header,
 * the sample call's opening playing line by line (a GSAP timeline: a line every 0.9s, then the
 * last frame rests, fades and loops) and the white Listening bar. It pauses off-screen and has
 * a "Pause sample" button; the visitor's pause wins. The first paint, no JS and reduced motion
 * all show the held last frame. The card is aria-hidden and inert: a visually hidden copy of
 * the lines stands in for it. The smoke glass keeps white text above 4.5:1 over the photo.
 */
export function LiveCall({ className }: { className?: string }) {
  const scope = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<Frame>(HELD);
  const [paused, setPaused] = useState(false);
  const [running, setRunning] = useState(false);
  const player = useRef<{ tl: gsap.core.Timeline | null; onScreen: boolean; paused: boolean }>({
    tl: null,
    onScreen: false,
    paused: false,
  });

  // Plays only on screen and only while the visitor hasn't paused: their pause wins.
  const sync = () => {
    const { tl, onScreen, paused: held } = player.current;
    tl?.paused(!onScreen || held);
  };

  useGSAP(
    () => {
      const root = scope.current;
      const surface = card.current;
      const list = surface?.querySelector<HTMLElement>('ol');
      const items = surface ? gsap.utils.toArray<HTMLElement>('[data-turn]', surface) : [];
      if (!root || !list || items.length !== HERO_TURNS.length) return;

      const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) player.current.onScreen = entry.isIntersecting; // the last entry is current
        sync();
      });
      observer.observe(root);

      const mm = gsap.matchMedia(root);
      // Reduced motion keeps the held frame, with nothing to pause.
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        let shown = HELD;
        const tl = gsap.timeline({
          paused: true,
          onUpdate: () => {
            const time = tl.time();
            const next = { turn: turnAt(time), clock: Math.floor(clockAt(time)), agent: agentStateAt(time) };
            if (next.turn === shown.turn && next.clock === shown.clock && next.agent === shown.agent) return;
            shown = next;
            setFrame(next);
          },
          onComplete: () => {
            tl.restart();
          },
        });
        buildLoop(tl, list, items);

        let idle = 0;
        let timer = 0;
        const go = () => {
          // Measured now, after load: the lines' heights decide how far the list slides.
          // The loop starts on its held frame, the same frame the server drew.
          tl.seek(HOLD_FROM);
          player.current.tl = tl;
          setRunning(true);
          sync();
        };
        const start = () => {
          if (typeof window.requestIdleCallback === 'function') idle = window.requestIdleCallback(go, { timeout: 2000 });
          else timer = window.setTimeout(go, 200);
        };
        if (document.readyState === 'complete') start();
        else window.addEventListener('load', start, { once: true });

        return () => {
          window.removeEventListener('load', start);
          if (idle) window.cancelIdleCallback(idle);
          window.clearTimeout(timer);
          player.current.tl = null;
          // The timeline reverts to the held frame; the timer and the bar follow.
          setRunning(false);
          setFrame(HELD);
        };
      });

      return () => {
        observer.disconnect();
        mm.revert();
      };
    },
    { scope },
  );

  const toggle = () => {
    player.current.paused = !paused;
    setPaused(!paused);
    sync();
  };

  // The lines never change; GSAP moves them. Memoised so a tick of the timer leaves them alone.
  const transcript = useMemo(
    () => (
      <Transcript
        turns={HERO_TURNS}
        variant="glass"
        bare
        label="Sample call"
        agentLabel="HRVoice"
        // Lines stack up from the Listening bar; older ones slide up under the top fade.
        className="flex max-h-none min-h-0 flex-1 flex-col justify-end overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,var(--text)_4rem)]"
      />
    ),
    [],
  );

  return (
    <div ref={scope} className={cn('relative flex min-h-0 flex-col', className)}>
      <div className="sr-only">
        <p>
          Sample call: HRVoice phones {FIRST_NAME} about the {SAMPLE_JOB.title.toLowerCase()} job.
        </p>
        <ol>
          {HERO_TURNS.map((turn, i) => (
            <li key={i}>
              {turn.speaker === 'agent' ? 'HRVoice' : turn.name}: {turn.text}
            </li>
          ))}
        </ol>
      </div>
      <div
        ref={card}
        aria-hidden
        inert
        className={cn(
          'site-smoke flex min-h-0 w-full flex-1 flex-col rounded-[22px] text-white',
          paused && '[&_*]:[animation-play-state:paused]',
        )}
      >
        {/* Room on the right for the pause button, which sits over the card but outside it. */}
        <div className="flex items-center gap-3 px-14 pb-3 pt-12 text-center">
          <div className="min-w-0 flex-1">
            <p className="m-0 truncate text-[0.9375rem] font-medium tracking-[-0.01em]">HRVoice, for the hiring team</p>
            <p className="m-0 line-clamp-2 text-[0.75rem] text-white/70">
              Calling {FIRST_NAME} about the {SAMPLE_JOB.title.toLowerCase()} job
            </p>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col px-4">{transcript}</div>
        <div className="px-3 pt-3">
          <ListeningBar
            state={frame.turn < 0 ? 'ringing' : listeningOf(frame.turn)}
            seconds={frame.clock}
            // A pause freezes the bars where they are, with everything else (animation-play-state above).
            active={running}
            activity={frame.turn}
            announce={false}
          />
        </div>
      </div>
      {/* The agent, seated on the card, acting out the call: ringing, thinking, speaking, listening. */}
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-[62%]">
        <Agent colour="pearl" size={92} state={frame.agent} />
      </div>
      <button
        type="button"
        onClick={toggle}
        aria-label={paused ? 'Play the sample call' : 'Pause the sample call'}
        // Shows once the loop runs; never under reduced motion, where nothing moves.
        className={cn(
          'absolute right-3 top-3.5 grid size-8 place-items-center rounded-full after:absolute after:-inset-1.5 border border-white/25 bg-white/10 text-white transition-colors duration-200 hover:bg-white/20 motion-reduce:hidden [&_svg]:size-3.5',
          !running && 'invisible',
        )}
      >
        {paused ? <Play aria-hidden strokeWidth={2} className="translate-x-px fill-current" /> : <Pause aria-hidden strokeWidth={2} className="fill-current" />}
      </button>
    </div>
  );
}

/**
 * One loop: every line hides, then each lands on its beat while the list slides up by the
 * new line's height. The last frame holds, the lines fade, and onComplete restarts. Opacity
 * sits in both ends of each fromTo so a restart lands every property on the loop's start.
 */
function buildLoop(tl: gsap.core.Timeline, list: HTMLElement, items: HTMLElement[]) {
  const gap = Number.parseFloat(getComputedStyle(list).rowGap) || 0;
  tl.set(items, { display: 'none' }, 0);
  HERO_BEATS.forEach((at, i) => {
    const item = items[i];
    if (!item) return;
    tl.set(item, { display: 'flex' }, at);
    tl.fromTo(
      list,
      { y: () => item.offsetHeight + (i > 0 ? gap : 0) },
      { y: 0, duration: PUSH, ease: 'power3.out', immediateRender: false },
      at,
    );
    tl.fromTo(
      item,
      { autoAlpha: 0, y: 8 },
      { autoAlpha: 1, y: 0, duration: BUBBLE, ease: 'power3.out', immediateRender: false },
      at,
    );
  });
  tl.fromTo(list, { autoAlpha: 1 }, { autoAlpha: 0, duration: FADE, ease: 'power2.in', immediateRender: false }, HERO_LOOP - FADE);
}
