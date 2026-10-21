import { Plus } from 'lucide-react';
import { cn } from '../ui/cn';
import { OpenChatButton } from './chat';
import { CONTAINER, SECTION, siteButton } from './kit';

/** Six questions. The pilot's steps live in How it works, so they are not repeated here. */
export const FAQ = [
  {
    question: 'Does the agent decide who gets hired?',
    answer:
      'No. It asks your questions and reports the answers, with the transcript and the recording. A person on your team moves each candidate forward or not.',
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
    question: 'Who can see recordings and transcripts?',
    answer:
      'Only the people you allow. Your admin decides who on your team can hear recordings and read transcripts.',
  },
  {
    question: 'What happens if a candidate doesn’t pick up?',
    answer:
      'The call is marked with what happened, such as No answer or Reached voicemail, so you know it didn’t reach them. You can call them again from their page.',
  },
] as const;

/**
 * Website section 6 (#faq), after Margin's FAQ: the heading on the left, the questions on the right as native
 * details, so they open by keyboard with no script. The plus turns to a cross in 200ms. The
 * heading stays in view beside the list, with a way to ask the page's helper.
 */
export function FaqSection() {
  return (
    <section id="faq" aria-labelledby="faq-title" className={cn(SECTION, 'border-t border-site-line')}>
      <div className={cn(CONTAINER, 'grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-16')}>
        <div data-reveal className="lg:sticky lg:top-28 lg:col-span-4 lg:self-start">
          <h2 id="faq-title" className="site-h2 m-0 text-white">
            Questions, answered
          </h2>
          <p className="m-0 mt-5 max-w-[30ch] text-[1.0625rem] leading-relaxed text-site-fg-2 max-sm:hidden">
            How calls work, what candidates hear, who decides and who sees what.
          </p>
          <p className="m-0 mt-6 text-[0.9375rem] md:mt-10 leading-relaxed text-site-fg-2">
            Not on the list? Ask in your own words.
          </p>
          <OpenChatButton className={cn(siteButton('frost', 'md'), 'mt-4')}>Ask anything</OpenChatButton>
        </div>
        <div data-reveal className="border-t border-site-line lg:col-span-8">
          {/* The first one starts open, so the list reads as answers, not just questions. */}
          {FAQ.map(({ question, answer }, i) => (
            <details key={question} open={i === 0} className="group border-b border-site-line">
              <summary className="flex min-h-[4rem] cursor-pointer list-none items-center justify-between gap-6 rounded-[10px] py-3.5 md:py-5 text-[1.125rem] font-normal tracking-[-0.01em] text-white [&::-webkit-details-marker]:hidden">
                {question}
                <span
                  aria-hidden
                  className="grid size-11 shrink-0 md:size-9 place-items-center rounded-full border border-site-line text-white/80 transition-[transform,background-color] duration-200 group-hover:bg-white/10 group-open:rotate-45"
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
