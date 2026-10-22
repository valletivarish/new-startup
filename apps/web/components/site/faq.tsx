import { Plus } from 'lucide-react';
import { cn } from '../ui/cn';
import { OpenChatButton } from './chat';
import { CONTAINER, SECTION, siteButton } from './kit';

/** Nine questions. The pilot's steps live in How it works, so they are not repeated here. */
export const FAQ = [
  {
    question: 'Does HRVoice decide who gets hired?',
    answer:
      'No. It makes the call and writes down what the candidate said. It marks each candidate Meets all, Needs a look or Doesn’t meet, against the requirements you wrote. You listen, read and decide. It never rejects anyone.',
  },
  {
    question: 'What does the call actually sound like?',
    answer:
      'Like a short chat, not a form. It asks one question at a time and follows up on what the candidate says, for example “What’s behind the eighteen?” If the candidate cuts in, it stops and answers. Play the 83-second sample call on this page and judge for yourself.',
  },
  {
    question: 'Will candidates know it’s automated?',
    answer:
      'If a candidate asks, it tells them plainly that it is an automated screening assistant for the hiring team, then carries on. The call opens by saying who it is calling for and why, and it never claims to be a person.',
  },
  {
    question: 'Which languages does it speak?',
    answer:
      'English only today. If your candidates need another language, tell us when you sign up. We will tell you straight whether we can call in it yet.',
  },
  {
    question: 'Do I need a calling number to start?',
    answer:
      'No. You can make a test call in your browser today. To call candidates’ real phones, your company needs its own calling number. The phone company runs a KYC check on your company first, and we help you with it.',
  },
  {
    question: 'What does it cost?',
    answer:
      '₹20 per completed call, plus 18% GST. A call is completed when the candidate answered and talked with HRVoice. Calls that don’t connect (no answer, busy, voicemail, unreachable number) cost nothing, and test calls in your browser are free. There is no fee per user, no lock-in and no monthly minimum. Calls run about 4 to 6 minutes, and the price is per call, not per minute.',
  },
  {
    question: 'What does the candidate need to do?',
    answer: 'Nothing. They pick up an ordinary phone call, between 9 am and 8 pm IST. No account and no app.',
  },
  {
    question: 'Who can see recordings and transcripts?',
    answer:
      'Only the people you allow. Your admin decides who on your team can hear recordings and read transcripts.',
  },
  {
    question: 'What happens if a candidate doesn’t pick up?',
    answer:
      'The call is marked with what happened, such as Rang out or Voicemail, so you know it didn’t reach them. You can call them again from their page.',
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
            Questions HR teams ask
          </h2>
          <p className="m-0 mt-5 max-w-[30ch] text-[1.0625rem] leading-relaxed text-site-fg-2 max-sm:hidden">
            What the call sounds like, what candidates hear, who decides and who can hear recordings.
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
