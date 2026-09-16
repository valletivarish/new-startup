import Image from 'next/image';
import Link from 'next/link';
import { brand } from '../lib/brand';

const { colors, radii } = brand;

const useCases = [
  {
    title: 'Hiring',
    body: 'Screen candidates and collect answers before your team gets on the phone.',
    bg: colors.tileHiring,
    cta: { href: '/login?mode=register', label: 'Start with hiring' },
  },
  {
    title: 'Support',
    body: 'Handle common questions and pass hard cases to a person.',
    bg: colors.tileSupport,
  },
  {
    title: 'Sales outreach',
    body: 'Open conversations and book the ones that show real interest.',
    bg: colors.tileSales,
  },
  {
    title: 'Appointments',
    body: 'Schedule, confirm, and reschedule without a full-time coordinator.',
    bg: colors.tileAppointments,
  },
  {
    title: 'Reminders',
    body: 'On-time nudges for visits, payments, and follow-ups.',
    bg: colors.tileReminders,
  },
  {
    title: 'Custom',
    body: 'Shape an agent for the call work only your business does.',
    bg: colors.tileCustom,
  },
] as const;

const steps = [
  {
    title: 'Sign up',
    body: 'Create your company workspace in one short form.',
  },
  {
    title: 'Create an agent',
    body: 'Add docs, must-ask questions, language, and who to transfer to.',
  },
  {
    title: 'Try a demo',
    body: 'Hear the conversation before anyone real is dialed.',
  },
  {
    title: 'Assign jobs',
    body: 'Add candidates and start screening when you are ready.',
  },
  {
    title: 'Review results',
    body: 'Read transcripts and answers. You decide what happens next.',
  },
] as const;

export default function LandingPage() {
  return (
    <main
      style={{
        background: colors.paper,
        color: colors.ink,
        minHeight: '100dvh',
        overflowX: 'hidden',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          height: 64,
          padding: '0 clamp(20px, 4vw, 56px)',
          borderBottom: `1px solid ${colors.line}`,
          position: 'sticky',
          top: 0,
          background: 'rgba(255,255,255,0.94)',
          backdropFilter: 'blur(12px)',
          zIndex: 20,
        }}
      >
        <Link
          href="/"
          style={{
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: '-0.03em',
            textDecoration: 'none',
          }}
        >
          {brand.name}
        </Link>
        <nav
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexShrink: 0,
          }}
          aria-label="Account"
        >
          <Link
            href="/login"
            style={{
              fontSize: 14,
              fontWeight: 600,
              textDecoration: 'none',
              padding: '10px 12px',
              borderRadius: radii.control,
            }}
          >
            Sign in
          </Link>
          <Link
            href="/login?mode=register"
            style={{
              fontSize: 14,
              fontWeight: 700,
              textDecoration: 'none',
              padding: '10px 16px',
              borderRadius: radii.control,
              background: colors.primary,
              color: '#fff',
            }}
          >
            Get started
          </Link>
        </nav>
      </header>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
          gap: 'clamp(28px, 5vw, 56px)',
          alignItems: 'center',
          padding:
            'clamp(32px, 5vw, 56px) clamp(20px, 4vw, 56px) clamp(48px, 7vw, 80px)',
          maxWidth: 1200,
          margin: '0 auto',
        }}
        className="ava-hero"
      >
        <div>
          <p
            style={{
              margin: '0 0 12px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              fontWeight: 700,
              color: colors.primary,
              background: colors.primarySoft,
              padding: '6px 10px',
              borderRadius: 999,
            }}
          >
            Built for India
          </p>
          <h1
            style={{
              margin: '0 0 16px',
              fontSize: 'clamp(2.25rem, 4.6vw, 3.5rem)',
              lineHeight: 1.08,
              letterSpacing: '-0.035em',
              fontWeight: 700,
              maxWidth: '18ch',
            }}
          >
            Let AI handle your routine calls
          </h1>
          <p
            style={{
              margin: '0 0 28px',
              fontSize: 17,
              lineHeight: 1.45,
              color: colors.inkMuted,
              maxWidth: '42ch',
            }}
          >
            Start with hiring screens that sound human, transfer when needed, and
            leave the decision to your team.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <Link
              href="/login?mode=register"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: 48,
                padding: '0 22px',
                borderRadius: radii.control,
                background: colors.primary,
                color: '#fff',
                fontWeight: 700,
                textDecoration: 'none',
              }}
            >
              Get started
            </Link>
            <a
              href="#how-it-works"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: 48,
                padding: '0 22px',
                borderRadius: radii.control,
                border: `1px solid ${colors.line}`,
                background: colors.paper,
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              See how it works
            </a>
          </div>
        </div>

        <div
          style={{
            position: 'relative',
            borderRadius: 24,
            overflow: 'hidden',
            background: colors.navy,
            minHeight: 360,
            boxShadow: '0 28px 60px rgba(15, 23, 42, 0.22)',
          }}
        >
          <Image
            src="https://picsum.photos/seed/india-hiring-phone-desk/1200/900"
            alt="Recruiter taking a phone call at a bright desk"
            fill
            priority
            sizes="(max-width: 860px) 100vw, 560px"
            style={{ objectFit: 'cover', opacity: 0.88 }}
          />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background:
                'linear-gradient(180deg, rgba(15,23,42,0.15) 0%, rgba(15,23,42,0.55) 100%)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: 20,
              right: 20,
              bottom: 20,
              display: 'grid',
              gap: 10,
            }}
          >
            <HeroChip title="Hiring screen" detail="+91 candidate · live" />
            <HeroChip title="Human transfer" detail="HR desk when needed" />
          </div>
        </div>
      </section>

      <section
        style={{
          padding: '56px clamp(20px, 4vw, 56px)',
          maxWidth: 1200,
          margin: '0 auto',
        }}
      >
        <h2
          style={{
            margin: '0 0 10px',
            fontSize: 'clamp(1.6rem, 3vw, 2rem)',
            letterSpacing: '-0.02em',
            fontWeight: 700,
          }}
        >
          Built for the calls you already make
        </h2>
        <p
          style={{
            margin: '0 0 28px',
            color: colors.inkMuted,
            maxWidth: '52ch',
            fontSize: 16,
          }}
        >
          Hiring is ready now. Support, sales, and the rest share the same
          workspace later without starting over.
        </p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 14,
          }}
          className="ava-tiles"
        >
          {useCases.map((item) => (
            <article
              key={item.title}
              style={{
                background: item.bg,
                borderRadius: radii.panel,
                padding: 22,
                minHeight: 168,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <h3 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 700 }}>
                  {item.title}
                </h3>
                <p
                  style={{
                    margin: 0,
                    fontSize: 14,
                    color: colors.inkMuted,
                    lineHeight: 1.45,
                  }}
                >
                  {item.body}
                </p>
              </div>
              {'cta' in item && item.cta ? (
                <Link
                  href={item.cta.href}
                  style={{
                    marginTop: 18,
                    fontSize: 13,
                    fontWeight: 700,
                    color: colors.primary,
                    textDecoration: 'none',
                  }}
                >
                  {item.cta.label}
                </Link>
              ) : (
                <span
                  style={{
                    marginTop: 18,
                    fontSize: 12,
                    fontWeight: 600,
                    color: colors.inkMuted,
                  }}
                >
                  Coming next
                </span>
              )}
            </article>
          ))}
        </div>
      </section>

      <section
        id="how-it-works"
        style={{
          background: colors.navy,
          color: '#e2e8f0',
          padding: '64px clamp(20px, 4vw, 56px)',
        }}
      >
        <div style={{ maxWidth: 880, margin: '0 auto' }}>
          <h2
            style={{
              margin: '0 0 8px',
              fontSize: 'clamp(1.6rem, 3vw, 2rem)',
              color: '#fff',
              letterSpacing: '-0.02em',
              fontWeight: 700,
            }}
          >
            How it works
          </h2>
          <p style={{ margin: '0 0 32px', color: '#94a3b8', maxWidth: '48ch' }}>
            Five clear steps. Demo before live. No engineering jargon.
          </p>
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 0 }}>
            {steps.map((step, index) => (
              <li
                key={step.title}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '40px 1fr',
                  gap: 16,
                  padding: '18px 0',
                  borderTop: index === 0 ? 'none' : '1px solid #334155',
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 999,
                    display: 'grid',
                    placeItems: 'center',
                    background: colors.primary,
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: 13,
                  }}
                >
                  {index + 1}
                </span>
                <div>
                  <h3
                    style={{
                      margin: '2px 0 6px',
                      color: '#fff',
                      fontSize: 17,
                      fontWeight: 700,
                    }}
                  >
                    {step.title}
                  </h3>
                  <p style={{ margin: 0, color: '#94a3b8', fontSize: 15 }}>
                    {step.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section
        style={{
          padding: '64px clamp(20px, 4vw, 56px)',
          textAlign: 'center',
          background: colors.paperWash,
        }}
      >
        <h2
          style={{
            margin: '0 0 10px',
            fontSize: 'clamp(1.5rem, 3vw, 1.9rem)',
            letterSpacing: '-0.02em',
            fontWeight: 700,
          }}
        >
          Ready to screen your next role?
        </h2>
        <p style={{ margin: '0 0 24px', color: colors.inkMuted }}>
          Create your company, build a hiring agent, try a demo, then go live.
        </p>
        <Link
          href="/login?mode=register"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 48,
            padding: '0 24px',
            borderRadius: radii.control,
            background: colors.primary,
            color: '#fff',
            fontWeight: 700,
            textDecoration: 'none',
          }}
        >
          Get started
        </Link>
      </section>

      <footer
        style={{
          padding: '22px clamp(20px, 4vw, 56px)',
          borderTop: `1px solid ${colors.line}`,
          fontSize: 13,
          color: colors.inkMuted,
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          background: colors.paper,
        }}
      >
        <span>{brand.name}</span>
        <span>English first · +91 ready · Human transfer built in</span>
      </footer>

      <style>{`
        @media (max-width: 860px) {
          .ava-hero {
            grid-template-columns: 1fr !important;
          }
          .ava-tiles {
            grid-template-columns: 1fr !important;
          }
        }
        @media (min-width: 861px) and (max-width: 1024px) {
          .ava-tiles {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          }
        }
      `}</style>
    </main>
  );
}

function HeroChip({ title, detail }: { title: string; detail: string }) {
  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.96)',
        color: colors.ink,
        borderRadius: 12,
        padding: '12px 14px',
        maxWidth: 280,
        boxShadow: '0 10px 28px rgba(0,0,0,0.18)',
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, color: colors.primary }}>
        {title}
      </div>
      <div style={{ fontSize: 13, marginTop: 2 }}>{detail}</div>
    </div>
  );
}
