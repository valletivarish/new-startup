import Image from 'next/image';
import Link from 'next/link';
import { BadgeIndianRupee, FileAudio, Laptop, UsersRound, type LucideIcon } from 'lucide-react';
import closingPhoto from '../../public/images/site/closing.jpg';
import { CONTAINER, Italic, SIGNUP_HREF, Tag, siteButton } from './kit';

const TERMS: readonly { icon: LucideIcon; label: string }[] = [
  { icon: Laptop, label: 'Test calls in your browser' },
  { icon: BadgeIndianRupee, label: 'Pay per completed call' },
  { icon: UsersRound, label: 'No fee per user' },
  { icon: FileAudio, label: 'A recording of every call' },
];

/**
 * The closing band: green hills under open sky, faded in from the black above and out into the
 * footer's black below. One heading, one line, the two buttons and the pilot's terms.
 */
export function ClosingSection() {
  return (
    <section aria-labelledby="closing-title" className="relative isolate overflow-hidden">
      <div data-photo-frame className="absolute inset-0 -z-20">
        <div data-photo-drift className="absolute inset-[-6%_0]">
          <Image src={closingPhoto} alt="" fill sizes="100vw" placeholder="blur" className="object-cover object-[50%_70%]" />
        </div>
      </div>
      <div
        aria-hidden
        className="absolute inset-0 -z-10 [background:linear-gradient(to_bottom,#050505_0%,rgb(9_27_46/0.42)_16%,rgb(9_27_46/0.42)_62%,rgb(5_5_5/0.2)_80%,#050505_100%)]"
      />
      <div className={`${CONTAINER} flex min-h-[44rem] flex-col items-center justify-center py-32 text-center md:min-h-[48rem]`}>
        <Tag tone="sky">
          Start with a pilot
        </Tag>
        <h2 id="closing-title" className="site-h2 m-0 mt-6 text-white [text-shadow:0_1px_24px_rgb(9_27_46/0.3)]">
          <span className="block">Try it on</span>
          <Italic>one real job.</Italic>
        </h2>
        <p className="m-0 mt-5 max-w-[32rem] text-[1.0625rem] leading-relaxed text-white/90 [text-shadow:0_1px_12px_rgb(9_27_46/0.4)]">
          We set it up with you and agree the price per call before any candidate is called.
        </p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <Link href={SIGNUP_HREF} className={siteButton('paper')}>
            Start a pilot
          </Link>
          <a href="#sample-call-card" className={siteButton('ink')}>
            Hear a sample call
          </a>
        </div>
        <ul role="list" className="m-0 mt-14 flex list-none flex-wrap justify-center gap-x-8 gap-y-3 p-0">
          {TERMS.map(({ icon: Icon, label }) => (
            <li key={label} className="inline-flex items-center gap-2 text-[0.875rem] text-white/90 [text-shadow:0_1px_10px_rgb(9_27_46/0.5)]">
              <Icon aria-hidden strokeWidth={1.75} className="size-4 text-site-lime" />
              {label}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
