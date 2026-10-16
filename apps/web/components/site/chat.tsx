'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowUp, Mic, X } from 'lucide-react';
import { Agent } from '../brand/agent';
import type { AgentState } from '../brand/agent-draw';
import { cn } from '../ui/cn';
import { SIGNUP_HREF } from './kit';

/*
  "Ask anything": a small helper on the landing page, with the agent as its face. It answers
  only from what the website already says (PRODUCT.md truth, the FAQ, pricing), matches typed
  questions to those answers by their words, and says so plainly when it has no answer. It
  makes no claim the page doesn't make. Answering open questions with the AI itself is a
  founder decision (cost and abuse limits), so it isn't wired here.

  Hands-free (off until the visitor turns it on): the browser's own speech recognition
  listens for WAKE_PHRASE; hearing it opens the chat and asks the rest of the sentence, or
  the next one. Browsers without speech recognition don't show the switch. While it's on,
  the launcher's agent shows its listening pose, so a live microphone is always visible.
*/

/** Opens the chat from anywhere on the page: window.dispatchEvent(new Event(OPEN_CHAT)). */
export const OPEN_CHAT = 'site-chat:open';

/** A button elsewhere on the page that opens the chat, e.g. under the FAQ. */
export function OpenChatButton({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new Event(OPEN_CHAT))}>
      {children}
    </button>
  );
}

/** Say this to open the chat hands-free. A plain word speech services always spell right. */
export const WAKE_PHRASE = 'Hey helper';
// The greeting varies ("hey", "hi", "okay"), or "helper" alone starts what was heard.
const WAKE = /(?:^\s*|\b(?:hey|hay|hi|hello|okay|ok|a)[\s,.!-]+)helper\b[\s,.!?]*/i;

/** What was said after the wake phrase ('' if nothing), or null if the phrase wasn't said. */
export function afterWake(heard: string): string | null {
  const m = WAKE.exec(heard);
  return m ? heard.slice(m.index + m[0].length).trim() : null;
}

// The browser's speech recognition, typed to the parts used here (not in TypeScript's DOM lib).
interface Recognizer {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognizerClass = new () => Recognizer;
const recognizerClass = () => {
  const w = window as unknown as {
    SpeechRecognition?: RecognizerClass;
    webkitSpeechRecognition?: RecognizerClass;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

const VOICE_KEY = 'site-chat-hands-free';
type Voice = 'unsupported' | 'off' | 'on' | 'blocked' | 'offline' | 'nomic';
const VOICE_NOTE: Record<Voice, string> = {
  unsupported: '',
  off: `Turn this on, then say “${WAKE_PHRASE}” and your question. It answers out loud, even with the chat closed.`,
  on: `Listening. With the chat open, just ask. Closed, say “${WAKE_PHRASE}” and your question; it answers out loud. While this is on, your browser’s speech service hears what you say.`,
  blocked: 'The microphone is blocked for this site. Allow it from the address bar, then turn this on again.',
  offline: 'Hands-free needs a connection to your browser’s speech service. Turn it on again when you’re online.',
  nomic: 'No sound from a microphone. Check one is connected and that your computer allows this browser to use it (on a Mac: System Settings → Privacy & Security → Microphone), then turn this on again.',
};

interface Entry {
  id: string;
  /** The suggested question, as a visitor would ask it. */
  ask: string;
  /**
   * Words that point to this answer, lower case. A phrase (with a space) scores 2 and matches
   * where a word starts; a single word scores 1 and matches itself or, from 4 letters, itself
   * plus a short ending (start: started, starting).
   */
  words: string[];
  answer: string;
  /** Show the suggested questions under the answer. */
  offers?: boolean;
  /** An optional next step under the answer. */
  link?: { href: string; label: string };
}

const ENTRIES: readonly Entry[] = [
  {
    id: 'hello',
    ask: 'Hello',
    words: ['hi', 'hello', 'hey', 'namaste', 'thanks', 'thank', 'good morning', 'good evening'],
    answer: 'Hello. Ask me how calls work, what it costs or how to start.',
    offers: true,
  },
  {
    id: 'how',
    ask: 'How does a screening call work?',
    words: [
      'work',
      'screening call',
      'screen',
      'process',
      'interview',
      'what does it do',
      'sample',
      'demo',
      'example',
      'hear',
      'listen',
      'question',
      'ask',
      'asks',
      'asked',
    ],
    answer:
      'Add a job and the questions every candidate must answer. HRVoice, an AI voice agent, phones each candidate, asks your questions, answers their questions from your job description, and sends you the recording, transcript and answers. You decide who moves forward.',
    link: { href: '#sample-call-card', label: 'Hear a sample call' },
  },
  {
    id: 'cost',
    ask: 'What does it cost?',
    words: [
      'cost',
      'price',
      'pricing',
      'fee',
      'fees',
      'charge',
      'pay',
      'paid',
      'paying',
      'payment',
      'rate',
      'cheap',
      'expensive',
      'rupee',
      'money',
      'how much',
      'budget',
      'billing',
      'bill',
      'invoice',
      'subscription',
      'plan',
      'free',
    ],
    answer:
      'You pay for each completed screening call, and there are no fees per user. We start with a pilot on one of your real jobs and agree the price per call with you before any real candidate is called.',
    link: { href: SIGNUP_HREF, label: 'Start a pilot' },
  },
  {
    id: 'start',
    ask: 'What do I need to start?',
    words: [
      'start',
      'begin',
      'pilot',
      'sign up',
      'signup',
      'register',
      'setup',
      'set up',
      'onboard',
      'trial',
      'try',
      'trying',
      'access',
      'account',
    ],
    answer:
      'Create your account, add one real job and try a test call in your browser. You don’t need a calling number for that. Before it calls real candidates, we set up your company’s calling number with you.',
    link: { href: SIGNUP_HREF, label: 'Start a pilot' },
  },
  {
    id: 'decide',
    ask: 'Does it decide who gets hired?',
    words: ['decide', 'decision', 'hire', 'reject', 'select', 'shortlist', 'score', 'rank', 'judge', 'filter', 'bias', 'fair'],
    answer:
      'No. It asks your questions and reports the answers, with the transcript and the recording. A person on your team moves each candidate forward or not.',
  },
  {
    id: 'language',
    ask: 'Which languages does it speak?',
    words: [
      'language',
      'hindi',
      'english',
      'tamil',
      'telugu',
      'marathi',
      'kannada',
      'bengali',
      'gujarati',
      'malayalam',
      'punjabi',
      'urdu',
      'speak',
      'accent',
      'regional',
      'multilingual',
    ],
    answer:
      'English today. If your candidates need another language, tell us when you start your pilot and we will tell you plainly whether it is ready.',
  },
  {
    id: 'line',
    ask: 'Do I need a calling number?',
    words: [
      'phone line',
      'line',
      'number',
      'sim',
      'sims',
      'kyc',
      'telecom',
      'carrier',
      'caller id',
      'calling number',
      'own number',
    ],
    answer:
      'Not to start: you can test in your browser today. To call candidates’ phones, your company needs a calling number. The phone carrier runs a KYC check first, and we help you through it.',
  },
  {
    id: 'candidate',
    ask: 'What does the candidate need to do?',
    words: [
      'download',
      'install',
      'an app',
      'the app',
      'candidate need',
      'candidates need',
      'candidate do',
      'candidates do',
      'for candidates',
      'candidate experience',
    ],
    answer: 'Nothing. They answer an ordinary phone call. They never need an account or an app.',
  },
  {
    id: 'person',
    ask: 'Can a call go to a person?',
    words: ['person', 'human', 'transfer', 'recruiter', 'talk to', 'speak to', 'escalate', 'manager'],
    answer:
      'Yes. Add phone numbers for people on your team. If a candidate asks to speak to a person, the agent transfers the call.',
  },
  {
    id: 'data',
    ask: 'Who can see recordings?',
    words: [
      'data',
      'privacy',
      'private',
      'secure',
      'security',
      'safe',
      'record',
      'store',
      'stored',
      'who can',
      'who has',
      'dpdp',
      'gdpr',
      'confidential',
    ],
    answer:
      'Only the people you allow: your admin decides who on your team can hear recordings and read transcripts. Each company’s workspace is walled off from every other company’s. Ask us for our data terms before your pilot.',
  },
  {
    id: 'missed',
    ask: 'What if a candidate doesn’t pick up?',
    words: [
      'pick',
      'answer',
      'miss',
      'busy',
      'voicemail',
      'unreachable',
      'retry',
      'switched off',
      'not available',
      'call again',
      'call back',
    ],
    answer:
      'The call is marked with what happened, such as No answer or Reached voicemail, so you know it didn’t reach them. You can call them again from their page.',
  },
  {
    id: 'accuracy',
    ask: 'What if the transcript is wrong?',
    words: ['wrong', 'mistake', 'accurate', 'accuracy', 'error', 'mishear', 'transcript', 'noisy', 'noise'],
    answer:
      'Transcripts are made by machine and can mishear a name or a number on a noisy line. Every answer links to the second it was said, so you can play that moment before anyone decides.',
  },
  {
    id: 'ats',
    ask: 'Does it connect to our ATS?',
    words: [
      'ats',
      'integrat',
      'connect',
      'tracking',
      'work with',
      'excel',
      'csv',
      'spreadsheet',
      'import',
      'upload',
      'resume',
      'cv',
      'cvs',
      'naukri',
      'zoho',
      'workday',
      'greenhouse',
    ],
    answer:
      'Not yet. Add candidates from a spreadsheet saved as CSV or from their resumes. Your team reviews each call and moves candidates forward in HRVoice.',
  },
  {
    id: 'other',
    ask: 'Can it do more than hiring?',
    words: [
      'support',
      'sales',
      'appointment',
      'reception',
      'booking',
      'customer',
      'other team',
      'other use',
      'use case',
      'besides hiring',
      'more than hiring',
      'beyond hiring',
      'reminder',
    ],
    answer:
      'Hiring is live today. Support calls, sales follow-ups and appointment reminders are coming later on the same platform.',
  },
];

const SUGGESTED = ['how', 'cost', 'start', 'language', 'decide', 'data'] as const;

const GREETING = 'Hi. Ask me how HRVoice calls work, what it costs or how to start. I answer from what this page says.';

/** The best answer for a typed question, or null. Pure; exported for tests. */
export function answerFor(question: string): Entry | null {
  const tokens = question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ');
  const text = ` ${tokens.join(' ')} `;
  const has = (w: string) =>
    w.includes(' ')
      ? text.includes(` ${w}`)
      : tokens.some((t) => t === w || (w.length >= 4 && t.startsWith(w) && t.length - w.length <= 4));
  // Ties go to the earlier entry.
  let best: Entry | null = null;
  let bestScore = 0;
  for (const entry of ENTRIES) {
    let score = 0;
    for (const w of entry.words) if (has(w)) score += w.includes(' ') ? 2 : 1;
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return best;
}

type Message = {
  from: 'bot' | 'you';
  text: string;
  link?: Entry['link'];
  offers?: boolean;
};

/**
 * The launcher (bottom right) and the chat panel. The panel is not modal: the page stays
 * usable behind it. Escape closes it and returns focus to the launcher. New messages are
 * announced politely. The agent thinks while it "types" and speaks as an answer lands.
 */
export function SiteChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([{ from: 'bot', text: GREETING, offers: true }]);
  const [draft, setDraft] = useState('');
  const [agent, setAgent] = useState<AgentState>('idle');
  const [typing, setTyping] = useState(false);
  const [voice, setVoice] = useState<Voice>('unsupported');
  const [heard, setHeard] = useState('');
  const openRef = useRef(open);
  openRef.current = open;
  const launcher = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const panelId = useId();
  const titleId = useId();

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_CHAT, show);
    return () => window.removeEventListener(OPEN_CHAT, show);
  }, []);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [messages, typing]);

  // An answer read aloud reaches the microphone. The recognizer is stopped while it plays (and
  // for a moment after) so the helper never hears itself and answers its own answer.
  const speaking = useRef(false);
  const lastSaid = useRef('');
  const pauseRec = useRef<(() => void) | null>(null);
  const resumeRec = useRef<(() => void) | null>(null);
  const speak = (text: string) => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-IN';
    speaking.current = true;
    lastSaid.current = text.toLowerCase();
    pauseRec.current?.();
    u.onend = u.onerror = () => {
      window.setTimeout(() => {
        speaking.current = false;
        resumeRec.current?.();
      }, 700);
    };
    synth.speak(u);
  };

  const reply = (entry: Entry | null, aloud = false) => {
    setTyping(true);
    setAgent('thinking');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    timers.current.push(
      window.setTimeout(
        () => {
          setTyping(false);
          setAgent('speaking');
          if (aloud) speak(entry ? entry.answer : 'This page doesn’t answer that yet. Ask us when you start your pilot.');
          setMessages((list) => [
            ...list,
            entry
              ? {
                  from: 'bot',
                  text: entry.answer,
                  link: entry.link,
                  offers: entry.offers,
                }
              : {
                  from: 'bot',
                  text: 'This page doesn’t answer that yet. Ask us when you start your pilot, or pick one of these:',
                  offers: true,
                  link: { href: SIGNUP_HREF, label: 'Start a pilot' },
                },
          ]);
          timers.current.push(window.setTimeout(() => setAgent('idle'), 1800));
        },
        reduce ? 0 : 750,
      ),
    );
  };

  const ask = (text: string, entry?: Entry | null, aloud = false) => {
    const question = text.trim();
    if (!question) return;
    setMessages((list) => [...list, { from: 'you', text: question }]);
    setDraft('');
    reply(entry === undefined ? answerFor(question) : entry, aloud);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    ask(draft);
  };

  const close = () => {
    setOpen(false);
    launcher.current?.focus();
  };

  // Hands-free. Shown only where the browser has speech recognition; turned back on at load
  // only if the visitor left it on and the microphone is already allowed (no surprise prompt).
  useEffect(() => {
    if (!recognizerClass()) return;
    setVoice('off');
    let saved = false;
    try {
      saved = localStorage.getItem(VOICE_KEY) === '1';
    } catch {
      // Storage blocked: hands-free just isn't remembered.
    }
    if (saved)
      navigator.permissions
        ?.query({ name: 'microphone' as PermissionName })
        .then((p) => p.state === 'granted' && setVoice('on'))
        .catch(() => {});
  }, []);

  const setHandsFree = (on: boolean) => {
    setVoice(on ? 'on' : 'off');
    try {
      localStorage.setItem(VOICE_KEY, on ? '1' : '0');
    } catch {
      // Storage blocked: the choice lasts until the page closes.
    }
  };

  // The latest ask, for the recognizer's callbacks.
  const askRef = useRef(ask);
  askRef.current = ask;

  useEffect(() => {
    const Rec = voice === 'on' ? recognizerClass() : undefined;
    if (!Rec) return;
    const rec = new Rec();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-IN';
    let live = true;
    // After the phrase on its own, the next sentence (within 8 seconds) is the question.
    let questionUntil = 0;
    let lastFinal = { text: '', at: 0 };
    const start = () => {
      try {
        rec.start();
      } catch {
        // Already listening.
      }
    };
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (!result || speaking.current) continue;
        const heard = result[0].transcript.trim();
        // Backstop: words from the answer just read aloud are its echo, not a question.
        if (heard.length > 8 && lastSaid.current.includes(heard.toLowerCase().replace(/[.?!]+$/, ''))) continue;
        setHeard(heard);
        if (!result.isFinal) continue;
        // Some browsers deliver the same final sentence more than once: count it once.
        const key = heard.toLowerCase();
        if (key === lastFinal.text && performance.now() - lastFinal.at < 6000) continue;
        lastFinal = { text: key, at: performance.now() };
        const rest = afterWake(heard);
        if (rest !== null) {
          // Answered out loud where the visitor is; the chat stays as it is (closed or open).
          if (rest.length > 2) askRef.current(rest, undefined, true);
          else {
            questionUntil = performance.now() + 8000;
            setAgent('listening');
            timers.current.push(window.setTimeout(() => setAgent((a) => (a === 'listening' ? 'idle' : a)), 8000));
          }
        } else if (heard && (openRef.current || performance.now() < questionUntil)) {
          questionUntil = 0;
          askRef.current(heard, undefined, true);
        }
      }
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') setVoice('blocked');
      else if (e.error === 'network') setVoice('offline');
      else if (e.error === 'audio-capture') setVoice('nomic');
      else return;
      live = false;
      try {
        localStorage.setItem(VOICE_KEY, '0');
      } catch {
        // Storage blocked: nothing to forget.
      }
    };
    // Browsers end a session after a silence or a while; keep listening until switched off.
    rec.onend = () => {
      if (live && !document.hidden && !speaking.current) window.setTimeout(() => live && !speaking.current && start(), 300);
    };
    pauseRec.current = () => rec.abort();
    resumeRec.current = () => live && !document.hidden && start();
    const onVisible = () => !document.hidden && live && start();
    document.addEventListener('visibilitychange', onVisible);
    start();
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', onVisible);
      rec.onend = null;
      pauseRec.current = resumeRec.current = null;
      rec.abort();
      window.speechSynthesis?.cancel();
    };
  }, [voice]);

  const listening = voice === 'on';

  return (
    <>
      <button
        ref={launcher}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => (open ? close() : setOpen(true))}
        className={cn(
          'fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-4 z-50 inline-flex h-14 items-center gap-2.5 rounded-full border border-white/15 bg-[rgb(12_18_26/0.86)] pl-2.5 pr-2.5 text-white shadow-[0_16px_40px_-16px_rgb(0_0_0/0.7)] backdrop-blur-xl transition-[scale] duration-200 motion-safe:active:[scale:0.97] sm:right-6 sm:pr-5',
          open && 'max-sm:hidden',
        )}
      >
        {/* Listening pose while hands-free is on: the microphone is live. */}
        <Agent colour="pearl" size={36} state={open ? 'idle' : agent !== 'idle' ? agent : listening ? 'listening' : 'idle'} hoverable />
        <span className="hidden text-[0.9375rem] font-medium sm:inline">
          {open ? 'Close chat' : listening ? `Say “${WAKE_PHRASE}”` : 'Ask anything'}
        </span>
        <span className="sr-only sm:hidden">{open ? 'Close chat' : 'Ask anything'}</span>
      </button>

      {open ? (
        <section
          id={panelId}
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          onKeyDown={(e) => e.key === 'Escape' && close()}
          className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 flex max-h-[min(36rem,calc(100dvh-6rem))] flex-col overflow-hidden rounded-[24px] border border-white/15 bg-[rgb(12_18_26/0.94)] text-white shadow-[0_30px_80px_-24px_rgb(0_0_0/0.7)] backdrop-blur-xl sm:inset-x-auto sm:bottom-24 sm:right-6 sm:w-[23.5rem]"
        >
          <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
            <Agent colour="pearl" size={40} state={agent === 'idle' && listening ? 'listening' : agent} />
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="m-0 text-[0.9375rem] font-medium tracking-[-0.01em]">
                Ask about HRVoice
              </h2>
              <p className="m-0 text-[0.75rem] text-white/65">Answers from this page</p>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Close chat"
              className="grid size-11 place-items-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            >
              <X aria-hidden strokeWidth={1.75} className="size-5" />
            </button>
          </div>

          {voice !== 'unsupported' ? (
            <div className="border-b border-white/10 px-4 py-2.5">
              <div className="flex items-center gap-3">
                <Mic
                  aria-hidden
                  strokeWidth={1.75}
                  className={cn('size-4 shrink-0', listening ? 'text-site-lime' : 'text-white/65')}
                />
                <span id={`${panelId}-hf`} className="flex-1 text-[0.8125rem] font-medium">
                  Hands-free
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={listening}
                  aria-labelledby={`${panelId}-hf`}
                  aria-describedby={`${panelId}-hf-note`}
                  onClick={() => setHandsFree(!listening)}
                  className="group grid h-11 w-14 shrink-0 place-items-center rounded-full"
                >
                  <span
                    aria-hidden
                    className={cn(
                      'relative h-6 w-10 rounded-full border transition-colors duration-200',
                      listening ? 'border-site-lime bg-site-lime/80' : 'border-white/30 bg-white/10 group-hover:bg-white/20',
                    )}
                  >
                    <span
                      className={cn(
                        'absolute top-0.5 size-[1.125rem] rounded-full bg-white shadow transition-[left] duration-200',
                        listening ? 'left-[1.0625rem]' : 'left-0.5',
                      )}
                    />
                  </span>
                </button>
              </div>
              <p
                id={`${panelId}-hf-note`}
                className={cn(
                  'm-0 mt-0.5 text-[0.75rem] leading-snug',
                  voice === 'blocked' || voice === 'offline' || voice === 'nomic' ? 'text-[#ffb4a8]' : 'text-white/65',
                )}
              >
                {VOICE_NOTE[voice]}
              </p>
              {listening && heard ? (
                <p aria-live="polite" className="m-0 mt-1 truncate text-[0.75rem] text-white/85">
                  Heard: “{heard}”
                </p>
              ) : null}
            </div>
          ) : null}

          <div ref={log} role="log" aria-live="polite" aria-label="Conversation" className="flex-1 overflow-y-auto p-4">
            <ol className="m-0 flex list-none flex-col gap-3 p-0">
              {messages.map((m, i) => (
                <li key={i} className={cn('flex flex-col gap-2', m.from === 'you' ? 'items-end' : 'items-start')}>
                  <p
                    className={cn(
                      'm-0 max-w-[88%] rounded-[16px] px-3.5 py-2.5 text-[0.875rem] leading-relaxed',
                      m.from === 'you'
                        ? 'rounded-br-[6px] bg-white text-site-black'
                        : 'rounded-bl-[6px] bg-white/[0.08] text-white/90',
                    )}
                  >
                    <span className="sr-only">{m.from === 'you' ? 'You: ' : 'Helper: '}</span>
                    {m.text}
                  </p>
                  {m.link ? (
                    <Link
                      href={m.link.href}
                      onClick={() => m.link?.href.startsWith('#') && setOpen(false)}
                      className="inline-flex min-h-9 items-center rounded-full border border-site-lime/50 px-3 text-[0.8125rem] font-medium text-white no-underline transition-colors hover:bg-white/10"
                    >
                      {m.link.label}
                    </Link>
                  ) : null}
                  {m.offers ? (
                    <ul role="list" aria-label="Suggested questions" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                      {SUGGESTED.map((id) => {
                        const entry = ENTRIES.find((e) => e.id === id)!;
                        return (
                          <li key={id}>
                            <button
                              type="button"
                              onClick={() => ask(entry.ask, entry)}
                              className="min-h-9 rounded-full border border-white/20 px-3 text-left text-[0.8125rem] text-white/90 transition-colors hover:border-white/40 hover:bg-white/10"
                            >
                              {entry.ask}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </li>
              ))}
              {typing ? (
                <li className="flex items-start" aria-hidden>
                  <span className="inline-flex items-center gap-1 rounded-[16px] rounded-bl-[6px] bg-white/[0.08] px-3.5 py-3">
                    {[0, 1, 2].map((d) => (
                      <span
                        key={d}
                        className="size-1.5 rounded-full bg-white/70 motion-safe:animate-pulse"
                        style={{ animationDelay: `${d * 150}ms` }}
                      />
                    ))}
                  </span>
                </li>
              ) : null}
            </ol>
          </div>

          <form onSubmit={onSubmit} className="flex items-center gap-2 border-t border-white/10 p-3">
            <label htmlFor={`${panelId}-q`} className="sr-only">
              Your question
            </label>
            <input
              ref={input}
              id={`${panelId}-q`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask about calls, pricing or starting"
              autoComplete="off"
              className="h-11 min-w-0 flex-1 rounded-full border border-white/15 bg-white/[0.06] px-4 text-[0.875rem] text-white placeholder:text-white/55 focus-visible:border-white/40"
            />
            <button
              type="submit"
              aria-label="Send"
              disabled={!draft.trim()}
              className="grid size-11 shrink-0 place-items-center rounded-full bg-white text-site-black transition-[opacity,scale] disabled:opacity-40 motion-safe:active:[scale:0.95]"
            >
              <ArrowUp aria-hidden strokeWidth={2} className="size-5" />
            </button>
          </form>
        </section>
      ) : null}
    </>
  );
}
