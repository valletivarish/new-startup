/**
 * The frozen TTS line set.
 *
 * FROZEN on purpose. Every TTS provider must synthesise IDENTICAL text —
 * different text would make the comparison meaningless, and "roughly similar"
 * text is the kind of difference that produces a confident wrong answer.
 *
 * Each line stresses something Indian recruitment screening actually contains
 * and that TTS engines actually get wrong: Indian names, lakh/crore figures,
 * dates, English technical terms inside Hindi sentences, and bare numerals.
 *
 * TWENTY lines, not ten. The verdict rule needs 20 successful samples before a
 * percentile is reported as a result, and a TTS run's sample count IS the line
 * count — so a ten-line set made every TTS run structurally INCOMPLETE no
 * matter how much was spent on it. Twenty lines of synthesis costs a few rupees
 * per provider; an unreachable verdict costs the whole run.
 */

import type { QualityLine } from './blind.js';

export const QUALITY_LINES: readonly QualityLine[] = [
  {
    lineId: 'q01-name-role',
    text: 'Hello Rajeshwari, I am calling about the Senior Backend Engineer position at Infosys.',
    language: 'en-IN',
    probes: ['indian_name', 'english_technical_term'],
  },
  {
    lineId: 'q02-lakh',
    text: 'Your current CTC is 12 lakhs and the offered range is 18 to 22 lakhs per annum.',
    language: 'en-IN',
    probes: ['lakh_crore', 'numerals'],
  },
  {
    lineId: 'q03-notice',
    text: 'Could you confirm whether your notice period is 90 days or negotiable to 60 days?',
    language: 'en-IN',
    probes: ['numerals'],
  },
  {
    lineId: 'q04-date',
    text: 'The interview is scheduled for Tuesday, 14th October 2026 at 3:30 in the afternoon.',
    language: 'en-IN',
    probes: ['date', 'numerals'],
  },
  {
    lineId: 'q05-tech',
    text: 'The role requires Kubernetes, PostgreSQL and CI/CD experience with AWS or GCP.',
    language: 'en-IN',
    probes: ['english_technical_term'],
  },
  {
    lineId: 'q06-hinglish-basic',
    text: 'Aapka current notice period kitna hai, aur kya aap immediately join kar sakte hain?',
    language: 'hi-IN',
    probes: ['code_switch'],
  },
  {
    lineId: 'q07-hinglish-money',
    text: 'Aapki expected salary 15 lakhs per annum hai, ya negotiable hai?',
    language: 'hi-IN',
    probes: ['code_switch', 'lakh_crore', 'numerals'],
  },
  {
    lineId: 'q08-hinglish-name',
    text: 'Namaste Venkateshwaran ji, main HR team se baat kar rahi hoon.',
    language: 'hi-IN',
    probes: ['code_switch', 'indian_name'],
  },
  {
    lineId: 'q09-location',
    text: 'The position is based in Bengaluru, with hybrid work from Hyderabad also possible.',
    language: 'en-IN',
    probes: ['indian_name'],
  },
  {
    lineId: 'q10-mixed-numerals',
    text: 'You have 9 years of experience, 4 of them in Java, and a 30 day notice period.',
    language: 'en-IN',
    probes: ['numerals'],
  },
  {
    lineId: 'q11-crore',
    text: 'The annual budget for this team is 2 crores, split across 3 cost centres.',
    language: 'en-IN',
    probes: ['lakh_crore', 'numerals'],
  },
  {
    lineId: 'q12-name-surname',
    text: 'I have your application under the name Priyadarshini Krishnamurthy, is that correct?',
    language: 'en-IN',
    probes: ['indian_name'],
  },
  {
    lineId: 'q13-hinglish-schedule',
    text: 'Kya aap kal subah gyarah baje ke interview ke liye available rahenge?',
    language: 'hi-IN',
    probes: ['code_switch', 'numerals'],
  },
  {
    lineId: 'q14-tech-stack',
    text: 'Do you have hands-on experience with Kafka, Redis, Terraform and GraphQL?',
    language: 'en-IN',
    probes: ['english_technical_term'],
  },
  {
    lineId: 'q15-date-range',
    text: 'The offer is valid until 31st March 2027, and joining must be before 15th April.',
    language: 'en-IN',
    probes: ['date', 'numerals'],
  },
  {
    lineId: 'q16-hinglish-ctc',
    text: 'Aapka current CTC 8 lakh 50 thousand hai, aur expected 12 lakh hai, sahi hai na?',
    language: 'hi-IN',
    probes: ['code_switch', 'lakh_crore', 'numerals'],
  },
  {
    lineId: 'q17-location-pair',
    text: 'We have openings in Pune, Gurugram and Thiruvananthapuram for this role.',
    language: 'en-IN',
    probes: ['indian_name'],
  },
  {
    lineId: 'q18-phone-readback',
    text: 'Let me confirm your number: 9 8 7 6 5, 4 3 2 1 0. Is that right?',
    language: 'en-IN',
    probes: ['numerals'],
  },
  {
    lineId: 'q19-hinglish-tech',
    text: 'Aapne backend development mein microservices aur Docker ka use kiya hai?',
    language: 'hi-IN',
    probes: ['code_switch', 'english_technical_term'],
  },
  {
    lineId: 'q20-mixed-summary',
    text: 'To summarise: 7 years experience, 45 day notice period, 20 lakhs expected, based in Chennai.',
    language: 'en-IN',
    probes: ['numerals', 'lakh_crore', 'indian_name'],
  },
];
