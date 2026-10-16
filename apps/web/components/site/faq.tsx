import Link from 'next/link';
import { Plus } from 'lucide-react';
import { cn } from '../ui/cn';
import { OpenChatButton } from './chat';
import { CONTAINER, Italic, SECTION, SIGNUP_HREF, siteButton } from './kit';

/** Final copy (strip-board spec 5.1), in its order. */
export const FAQ = [
  {
    question: 'Does the agent decide who gets hired?',
    answer:
      'No. It asks your questions and reports the answers, with the transcript and the recording. A person on your team moves each candidate forward or not.',
  },
  {
    question: 'What happens after I start a pilot?',
    answer:
      'You create your account and add one real job with your must-ask questions. Try a test call in your browser to hear exactly what candidates will hear. Before it phones real candidates, we set up your company’s calling number with you and agree the price per call.',
  },
  {
    question: 'Which languages does it speak?',
    answer:
      'English today. If your candidates need another language, tell us when you start your pilot and we will tell you plainly whether it is ready.',
  },
  {
    question: 'Do I need a calling number to start?',
    answer:
      'No. Start today with a test call in your browser. To call candidates’ phones, your company needs a calling number. The phone carrier runs a KYC check first, and we help you through it.',
  },
  {
    question: 'What does the candidate need to do?',
    answer: 'Nothing. They answer an ordinary phone call. They never need an account or an app.',
  },
  {
    question: 'Can a call be handed to a person?',
    answer:
      'Yes. Add phone numbers for people on your team. If a candidate asks to speak to a person, the agent transfers the call.',
  },
  {
    question: 'Who can see recordings and transcripts?',
    answer:
      'Only the people you allow. Your admin decides who on your team can hear recordings and read transcripts.',
  },
  {
    question: 'What happens if a candidate doesn’t pick up?',
    answer:
      'The call is marked with what happened, such as No answer or Reached voicemail, so you know it didn’t reach them. You can call them again from their page.',
  },
  {
    question: 'What if the transcript gets something wrong?',
    answer:
      'Transcripts are made by machine and can mishear a name or a number on a noisy line. Every answer links to the second it was said, so you can play that moment before anyone decides.',
  },
  {
    question: 'Does it connect to our applicant tracking system?',
    answer:
      'Not yet. Add candidates from a spreadsheet saved as CSV or from their resumes. Your team reviews each call and moves candidates forward in HRVoice.',
  },
] as const;

/**
 * Website section 7 (#faq): the heading on the left, the questions on the right as native
 * details, so they open by keyboard with no script. The plus turns to a cross in 200ms. The
 * heading stays in view beside the list, with a way to ask the page's helper.
 */
export function FaqSection() {
  return (
    <section id="faq" aria-labelledby="faq-title" className={cn(SECTION, 'border-t border-site-line')}>
      <div className={cn(CONTAINER, 'grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-16')}>
        <div data-reveal className="lg:sticky lg:top-28 lg:col-span-4 lg:self-start">
          <h2 id="faq-title" className="site-h2 m-0 text-white">
            <span className="block">Questions,</span>
            <Italic>answered</Italic>
          </h2>
          <p className="m-0 mt-5 max-w-[30ch] text-[1.0625rem] leading-relaxed text-site-fg-2">
            How calls work, what candidates hear, who decides and who sees what.
          </p>
          <p className="m-0 mt-10 text-[0.9375rem] leading-relaxed text-site-fg-2">
            Not on the list? Ask in your own words.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
            <OpenChatButton className={siteButton('paper', 'md')}>Ask anything</OpenChatButton>
            <Link
              href={SIGNUP_HREF}
              className="inline-flex min-h-11 items-center text-[0.9375rem] font-medium text-white underline decoration-white/40 underline-offset-[6px] transition-colors duration-200 hover:decoration-white"
            >
              Start a pilot
            </Link>
          </div>
        </div>
        <div data-reveal className="border-t border-site-line lg:col-span-8">
          {/* The first one starts open, so the list reads as answers, not just questions. */}
          {FAQ.map(({ question, answer }, i) => (
            <details key={question} open={i === 0} className="group border-b border-site-line">
              <summary className="flex min-h-[4.5rem] cursor-pointer list-none items-center justify-between gap-6 rounded-[10px] py-5 text-[1.125rem] font-normal tracking-[-0.01em] text-white [&::-webkit-details-marker]:hidden">
                {question}
                <span
                  aria-hidden
                  className="grid size-9 shrink-0 place-items-center rounded-full border border-site-line text-white/80 transition-[transform,background-color] duration-200 group-hover:bg-white/10 group-open:rotate-45"
                >
                  <Plus strokeWidth={1.5} className="size-4" />
                </span>
              </summary>
              <p className="m-0 max-w-[62ch] pb-6 text-[1rem] leading-relaxed text-site-fg-2 md:pr-14">{answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
