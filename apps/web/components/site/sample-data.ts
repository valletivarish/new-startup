/**
 * Sample data for the website only. Every name, number and answer here is
 * illustrative and is labelled as a sample wherever it renders. Nothing in
 * this file is read by the app or presented as a real customer or result.
 * The agent's lines mirror the real hiring definition's opening and flow.
 */

export const SAMPLE_COMPANY = 'Asha Software';

export const SAMPLE_JOB = {
  title: 'Software engineer',
  location: 'Pune',
} as const;

export type SampleStripState =
  | 'not_called'
  | 'calling'
  | 'on_call'
  | 'ready_for_review'
  | 'no_answer'
  | 'voicemail'
  | 'moved_forward'
  | 'on_hold'
  | 'not_moving_forward';

export interface SampleCandidate {
  id: string;
  name: string;
  phoneMasked: string;
  state: SampleStripState;
  /** Questions answered, out of the job's six. Null before a call. */
  answered: number | null;
  /** Call length in seconds. Null before a call. */
  durationSeconds: number | null;
}

/** The people on the sample job. Used by the hero board and the desk demo. */
export const SAMPLE_CANDIDATES: readonly SampleCandidate[] = [
  { id: 'arjun', name: 'Arjun Nair', phoneMasked: '+91 98•••• 2231', state: 'calling', answered: null, durationSeconds: null },
  { id: 'meera', name: 'Meera Iyer', phoneMasked: '+91 99•••• 7810', state: 'calling', answered: null, durationSeconds: null },
  { id: 'sameer', name: 'Sameer Qureshi', phoneMasked: '+91 97•••• 0442', state: 'not_called', answered: null, durationSeconds: null },
  { id: 'priya', name: 'Priya Raghunathan', phoneMasked: '+91 98•••• 4410', state: 'on_call', answered: 2, durationSeconds: 37 },
  { id: 'kavya', name: 'Kavya Menon', phoneMasked: '+91 90•••• 6123', state: 'ready_for_review', answered: 6, durationSeconds: 252 },
  { id: 'rohan', name: 'Rohan Das', phoneMasked: '+91 96•••• 3378', state: 'ready_for_review', answered: 5, durationSeconds: 220 },
  { id: 'ananya', name: 'Ananya Kulkarni', phoneMasked: '+91 93•••• 9014', state: 'not_called', answered: null, durationSeconds: null },
  { id: 'farhan', name: 'Farhan Sheikh', phoneMasked: '+91 95•••• 5520', state: 'no_answer', answered: null, durationSeconds: null },
  { id: 'divya', name: 'Divya Pillai', phoneMasked: '+91 91•••• 8846', state: 'voicemail', answered: null, durationSeconds: null },
  { id: 'vikram', name: 'Vikram Rao', phoneMasked: '+91 99•••• 1207', state: 'moved_forward', answered: 6, durationSeconds: 268 },
  { id: 'neha', name: 'Neha Joshi', phoneMasked: '+91 98•••• 6639', state: 'on_hold', answered: 4, durationSeconds: 194 },
];

export interface SampleTurn {
  speaker: 'agent' | 'contact';
  /** Seconds from the start of the call. */
  at: number;
  text: string;
}

export interface SampleAnswer {
  question: string;
  /** Null when the candidate did not answer. Never filled in by us. */
  answer: string | null;
  /** Second of the call the answer came from. */
  at: number | null;
  extra?: boolean;
}

/**
 * One complete sample screening call, start to finish, as heard in the sample recording
 * (public/audio/sample-call.mp3). It follows the real hiring agent: the same opening line,
 * one question at a time from the job's six, and only those. Priya cuts in once while the
 * agent explains the office days; it stops, answers, and picks the question back up. A line
 * that was cut off ends in a dash. Each turn's text is what the
 * recording says, fillers included, and its `at` is its first word.
 */
export const SAMPLE_CALL = {
  candidate: 'Priya Raghunathan',
  durationSeconds: 84,
  language: 'English',
  turns: [
    { speaker: 'agent', at: 0, text: `Hi, this is the hiring agent from ${SAMPLE_COMPANY}. I’m calling about the software engineer role you applied for. Is now a good time to talk for a few minutes?` },
    { speaker: 'contact', at: 8.4, text: 'Yeah, sure, now is fine.' },
    { speaker: 'agent', at: 9.84, text: 'Great, thanks, Priya. So, how long have you been working as a software engineer?' },
    { speaker: 'contact', at: 14.29, text: 'It’s been about four years now. Mostly web applications, in Java and Python.' },
    { speaker: 'agent', at: 18.68, text: 'Nice. And what’s your notice period at the moment?' },
    { speaker: 'contact', at: 21.73, text: 'It’s thirty days. But it can be shortened if needed, I think.' },
    { speaker: 'agent', at: 25.48, text: 'Okay, that’s helpful. So this role is hybrid, three days a week from our Pune office, and the other two days you can work—' },
    { speaker: 'contact', at: 32.23, text: 'Sorry, just one thing, can I pick which three days?' },
    { speaker: 'agent', at: 35.35, text: 'Good question. I’ll check that with the hiring team and they’ll confirm. So, do three office days a week work for you?' },
    { speaker: 'contact', at: 41.68, text: 'Yes, that’s fine. I live in Pune, so it’s easy for me.' },
    { speaker: 'agent', at: 44.95, text: 'Good to hear. And what’s your current salary, and what are you expecting?' },
    { speaker: 'contact', at: 48.95, text: 'Right now I’m at about thirteen lakh a year, and I’m expecting around eighteen lakh.' },
    { speaker: 'agent', at: 54, text: 'That’s a good jump from thirteen. What’s behind the eighteen?' },
    { speaker: 'contact', at: 57.41, text: 'I’m leading a small team now, and I have an offer at around seventeen, so eighteen felt fair. There’s some flexibility for the right role, though.' },
    { speaker: 'agent', at: 64.77, text: 'That’s helpful, thanks. Would you be free for a technical interview next week?' },
    { speaker: 'contact', at: 68.77, text: 'Yes, Tuesday or Wednesday afternoon works for me. Actually, is the first round online?' },
    { speaker: 'agent', at: 73.3, text: 'Yes, the first round is a video call. So that’s everything from my side, Priya. The hiring team will review this call and, uh, get back to you soon.' },
    { speaker: 'contact', at: 81.22, text: 'Okay, thank you so much. Bye!' },
    { speaker: 'agent', at: 82.74, text: 'Bye, have a nice day!' },
  ] satisfies SampleTurn[],
  // The job's six questions, in the order the agent asks them, then what she raised herself.
  answers: [
    { question: 'Software engineering experience', answer: 'About four years, mostly Java and Python', at: 14.29 },
    { question: 'Notice period', answer: 'Thirty days, can be shortened', at: 21.73 },
    { question: 'Hybrid, three office days a week in Pune', answer: 'Works for her. Lives in Pune', at: 41.68 },
    { question: 'Current salary', answer: 'About ₹13 lakh a year', at: 48.95 },
    { question: 'Expected salary', answer: 'About ₹18 lakh a year. She leads a small team and has an offer at about ₹17 lakh; some flexibility for the right role', at: 48.95 },
    { question: 'Technical interview next week', answer: 'Free Tuesday or Wednesday afternoon', at: 68.77 },
    { question: 'Asked about office days', answer: 'Wants to know if she can choose which three days she comes in. Passed to the hiring team', at: 32.23, extra: true },
    { question: 'Asked about the first round', answer: 'Told it’s a video call', at: 68.77, extra: true },
  ] satisfies SampleAnswer[],
  summary:
    'Priya has about four years as a software engineer, mostly building web applications in Java and Python, and a thirty-day notice period that can be shortened. She lives in Pune and is fine with three office days a week. She earns about ₹13 lakh a year now and expects about ₹18 lakh, because she leads a small team and has another offer at about ₹17 lakh; she has some flexibility for the right role. She is free for a technical interview on Tuesday or Wednesday afternoon, and asked whether the first round is online. She also asked if she can choose which three days she comes to the office; the agent said it would check with the hiring team.',
} as const;

export const SAMPLE_LABEL = 'Sample calls. Names and answers are illustrative.';
