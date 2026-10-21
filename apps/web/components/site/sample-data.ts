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
 * one question at a time from the job's six, and only those. Like a real call it isn't
 * strictly one line each: Priya gives one vague answer and the agent asks again in other
 * words; and she cuts in while the agent explains the office days (the agent stops, says it
 * will check with the hiring team, and carries on). A line that was cut off ends in a dash.
 * Each turn's text is what the recording says, fillers included, and its `at` is its first word.
 */
export const SAMPLE_CALL = {
  candidate: 'Priya Raghunathan',
  durationSeconds: 90,
  language: 'English',
  turns: [
    { speaker: 'agent', at: 0, text: `Hi, this is the hiring agent from ${SAMPLE_COMPANY}, calling about a role you applied for. Do you have a couple of minutes?` },
    { speaker: 'contact', at: 7.04, text: 'Oh, hi! Yes, sure, I can talk now.' },
    { speaker: 'agent', at: 9.84, text: 'Great, thank you, Priya. So, how many years have you worked as a software engineer?' },
    { speaker: 'contact', at: 14.7, text: 'Umm, let me think. About five… no, sorry, about four years now. Mostly web apps, in Java and Python.' },
    { speaker: 'agent', at: 23.09, text: 'Okay, got it. And what’s your notice period at your current company?' },
    { speaker: 'contact', at: 27.28, text: 'It depends on my manager, actually.' },
    { speaker: 'agent', at: 30.72, text: 'Right. But as per your contract, how many days is it?' },
    { speaker: 'contact', at: 34.56, text: 'Oh, it’s thirty days. But I think it can be shortened if needed.' },
    { speaker: 'agent', at: 38.72, text: 'Thirty days, and it can be shortened, got it. Now, this job is hybrid, three days a week in our Pune office, and the other two days—' },
    { speaker: 'contact', at: 46.98, text: 'Sorry, sorry. Are the office days fixed, or can I choose?' },
    { speaker: 'agent', at: 51.06, text: 'Good question. I’ll check that with the hiring team. So, do three office days a week work for you?' },
    { speaker: 'contact', at: 56.56, text: 'Mm-hmm, yes, that works. I live in Pune, so it’s easy for me.' },
    { speaker: 'agent', at: 60.96, text: 'Perfect. What is your current salary, and what are you expecting?' },
    { speaker: 'contact', at: 65.12, text: 'I’d rather not share my current salary. But I’m expecting around eighteen lakh a year.' },
    { speaker: 'agent', at: 70.92, text: 'Okay, no problem. Eighteen lakhs, noted. And would you be free for a technical interview next week?' },
    { speaker: 'contact', at: 77.16, text: 'Yes, Tuesday or Wednesday afternoon is good for me. Is the first round online?' },
    { speaker: 'agent', at: 82.05, text: 'Yes, the first round is a video call. Thank you, Priya. The hiring team will review this call and get back to you.' },
    { speaker: 'contact', at: 88.53, text: 'Okay, thank you so much. Bye!' },
  ] satisfies SampleTurn[],
  // The job's six questions, in the order the agent asks them, then what she raised herself.
  answers: [
    { question: 'Software engineering experience', answer: 'About four years, mostly Java and Python', at: 14.7 },
    { question: 'Notice period', answer: 'Thirty days, can be shortened', at: 34.56 },
    { question: 'Hybrid, three office days a week in Pune', answer: 'Works for her. Lives in Pune', at: 56.56 },
    { question: 'Current salary', answer: null, at: null },
    { question: 'Expected salary', answer: 'About ₹18 lakh a year', at: 65.12 },
    { question: 'Technical interview next week', answer: 'Free Tuesday or Wednesday afternoon', at: 77.16 },
    { question: 'Asked about office days', answer: 'Wants to know if she can choose which three days she comes in. Passed to the hiring team', at: 46.98, extra: true },
    { question: 'Asked about the first round', answer: 'Told it’s a video call', at: 77.16, extra: true },
  ] satisfies SampleAnswer[],
  summary:
    'Priya has about four years as a software engineer, mostly building web applications in Java and Python, and a thirty-day notice period that can be shortened. She lives in Pune, is fine with three office days a week, expects about ₹18 lakh a year and chose not to share her current salary. She is free for a technical interview on Tuesday or Wednesday afternoon, and asked if she can choose which three days she comes to the office.',
} as const;

export const SAMPLE_LABEL = 'Sample calls. Names and answers are illustrative.';
