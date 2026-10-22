import Image from 'next/image';
import Link from 'next/link';
import { Mail, MessageCircle } from 'lucide-react';
import closingPhoto from '../../public/images/site/closing.jpg';
import { CONTACT } from './contact';
import { SampleCallButton } from './sample-call-button';
import { CONTAINER, Italic, SIGNUP_HREF, siteButton } from './kit';

/** The pilot's terms in one plain line. Text, not chips: lime stays off the photo. */
const TERMS = ['Test calls in your browser', '₹20 per completed call', 'A recording of every call'] as const;

/**
 * The closing band (Levito's dusk sky, Margin's centred close): green hills under open sky,
 * faded in from the black above and out into the footer's black below, so the band and the
 * footer read as one. The page's last italic phrase, Create account and Hear a sample call, the
 * terms in one line, and the contact row (Aerosea) once the founder has set it in contact.ts.
 */
export function ClosingSection() {
  const hasContact = CONTACT.email || CONTACT.whatsapp;
  return (
    <section id="closing" aria-labelledby="closing-title" className="relative isolate overflow-hidden">
      <div data-photo-frame className="absolute inset-0 -z-20">
        <div data-photo-drift className="absolute inset-[-6%_0]">
          <Image src={closingPhoto} alt="" fill sizes="100vw" placeholder="blur" className="object-cover object-[50%_70%]" />
        </div>
      </div>
      <div
        aria-hidden
        className="absolute inset-0 -z-10 [background:linear-gradient(to_bottom,#050505_0%,rgb(9_27_46/0.45)_18%,rgb(9_27_46/0.42)_58%,rgb(5_5_5/0.35)_80%,#050505_100%)]"
      />
      <div className={`${CONTAINER} flex min-h-[34rem] flex-col items-center justify-center py-24 text-center md:min-h-[46rem] md:py-32`}>
        <h2 id="closing-title" className="site-h2 m-0 text-white [text-shadow:0_1px_24px_rgb(9_27_46/0.3)]">
          <span className="block">Hear the call before any candidate does.</span>
          <span className="block">
            Start with <Italic>one real job.</Italic>
          </span>
        </h2>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <Link href={SIGNUP_HREF} className={siteButton('paper')}>
            Create account
          </Link>
          <SampleCallButton />
        </div>
        <p className="m-0 mt-6 max-w-[36rem] text-[0.9375rem] leading-relaxed text-white [text-shadow:0_1px_10px_rgb(9_27_46/0.6)]">
          {TERMS.join(' · ')}
        </p>
        {hasContact ? (
          <ul role="list" className="m-0 mt-8 flex list-none flex-wrap justify-center gap-x-8 gap-y-2 p-0">
            {CONTACT.email ? (
              <li>
                <a
                  href={`mailto:${CONTACT.email}`}
                  className="inline-flex min-h-11 items-center gap-2 text-[0.9375rem] text-white underline decoration-white/40 underline-offset-4 hover:decoration-white"
                >
                  <Mail aria-hidden strokeWidth={1.5} className="size-4" />
                  {CONTACT.email}
                </a>
              </li>
            ) : null}
            {CONTACT.whatsapp ? (
              <li className="inline-flex min-h-11 items-center gap-2 text-[0.9375rem] text-white">
                <MessageCircle aria-hidden strokeWidth={1.5} className="size-4" />
                WhatsApp {CONTACT.whatsapp}
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
