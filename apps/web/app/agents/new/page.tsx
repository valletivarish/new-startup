'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ApiClientError,
  createAgent,
  listPacks,
  me,
  type Me,
  type PackDefinition,
} from '../../../lib/api';

const BLUE = '#1e40af';
const BLUE_LIGHT = '#dbeafe';
const MUTED = '#64748b';
const BORDER = '#e2e8f0';

const shell: React.CSSProperties = {
  maxWidth: 720,
  margin: '0 auto',
  padding: '32px 24px',
};
const panel: React.CSSProperties = {
  background: '#fff',
  border: `1px solid ${BORDER}`,
  borderRadius: 12,
  padding: 28,
  marginBottom: 20,
};
const primaryBtn: React.CSSProperties = {
  background: BLUE,
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  padding: '10px 20px',
  fontSize: 15,
  fontWeight: 600,
  cursor: 'pointer',
};
const secondaryBtn: React.CSSProperties = {
  background: '#fff',
  color: BLUE,
  border: `1px solid ${BORDER}`,
  borderRadius: 8,
  padding: '10px 20px',
  fontSize: 15,
  cursor: 'pointer',
};
const input: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '10px 12px',
  border: `1px solid ${BORDER}`,
  borderRadius: 8,
  fontSize: 15,
  marginTop: 6,
};

type Step = 'type' | 'configure' | 'review' | 'done';

function parseLines(value: string): string[] {
  return value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function NewAgentPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Me | null>(null);
  const [packs, setPacks] = useState<PackDefinition[]>([]);
  const [step, setStep] = useState<Step>('type');
  const [selectedPack, setSelectedPack] = useState<PackDefinition | null>(null);
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [mustAskQuestions, setMustAskQuestions] = useState('');
  const [transferPhones, setTransferPhones] = useState('');
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [p, pk] = await Promise.all([me(), listPacks()]);
      setProfile(p);
      setPacks(pk.packs);
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 401) router.push('/');
      else setNotice(e instanceof ApiClientError ? e.message : 'Could not load wizard.');
    }
  }, [router]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const canCreate = profile?.activeOrganization?.permissions.includes('agents.create') ?? false;

  function selectPack(pack: PackDefinition) {
    setSelectedPack(pack);
    setStep('configure');
    setNotice(null);
  }

  function goReview(event: FormEvent) {
    event.preventDefault();
    if (!purpose.trim()) {
      setNotice('Please describe what this agent should do.');
      return;
    }
    setNotice(null);
    setStep('review');
  }

  async function onSubmit() {
    if (!selectedPack || !name.trim()) return;
    setSubmitting(true);
    setNotice(null);
    try {
      const result = await createAgent({
        name: name.trim(),
        purpose: purpose.trim(),
        agentType: selectedPack.id,
        mustAskQuestions: parseLines(mustAskQuestions),
        transferPhones: parseLines(transferPhones),
      });
      setCreatedId(result.id);
      setStep('done');
    } catch (e) {
      setNotice(e instanceof ApiClientError ? e.message : 'Could not create the agent.');
    } finally {
      setSubmitting(false);
    }
  }

  const stepLabels = ['Choose type', 'Configure', 'Review', 'Done'];
  const stepIndex = ['type', 'configure', 'review', 'done'].indexOf(step);

  if (!profile) {
    return (
      <main style={shell}>
        <p style={{ color: MUTED }}>Loading…</p>
      </main>
    );
  }

  if (!canCreate) {
    return (
      <main style={shell}>
        <header style={{ marginBottom: 24 }}>
          <Link href="/agents" style={{ color: BLUE, fontSize: 14, textDecoration: 'none' }}>
            ← All agents
          </Link>
        </header>
        <section style={panel}>
          <p style={{ margin: 0, color: MUTED }}>
            You do not have permission to create agents in this organization.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main style={shell}>
      <header style={{ marginBottom: 28 }}>
        <p style={{ margin: '0 0 4px', fontSize: 13, color: MUTED, letterSpacing: '0.02em' }}>
          ai voice agent
        </p>
        <h1 style={{ margin: '0 0 8px', fontSize: 26, fontWeight: 700, color: '#0f172a' }}>
          Create an agent
        </h1>
        <Link href="/agents" style={{ color: BLUE, fontSize: 14, textDecoration: 'none' }}>
          ← All agents
        </Link>
      </header>

      <nav
        aria-label="Wizard progress"
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 24,
          flexWrap: 'wrap',
        }}
      >
        {stepLabels.map((label, i) => (
          <span
            key={label}
            style={{
              fontSize: 13,
              padding: '6px 12px',
              borderRadius: 999,
              background: i <= stepIndex ? BLUE_LIGHT : '#f8fafc',
              color: i <= stepIndex ? BLUE : MUTED,
              fontWeight: i === stepIndex ? 600 : 400,
            }}
          >
            {i + 1}. {label}
          </span>
        ))}
      </nav>

      {notice && (
        <p role="alert" style={{ fontSize: 14, color: '#b45309', marginBottom: 16 }}>
          {notice}
        </p>
      )}

      {step === 'type' && (
        <section style={panel}>
          <h2 style={{ marginTop: 0, fontSize: 18, color: '#0f172a' }}>What should this agent do?</h2>
          <p style={{ fontSize: 14, color: MUTED, marginTop: 0 }}>
            Choose a starting template. You can refine details in the next steps.
          </p>
          <div style={{ display: 'grid', gap: 12, marginTop: 20 }}>
            {packs.map((pack) => (
              <button
                key={pack.id}
                type="button"
                onClick={() => selectPack(pack)}
                style={{
                  textAlign: 'left',
                  background: '#fff',
                  border: `1px solid ${BORDER}`,
                  borderRadius: 10,
                  padding: '16px 18px',
                  cursor: 'pointer',
                }}
              >
                <strong style={{ display: 'block', fontSize: 16, color: '#0f172a' }}>
                  {pack.label}
                </strong>
                <span style={{ fontSize: 14, color: MUTED }}>{pack.description}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {step === 'configure' && selectedPack && (
        <form onSubmit={goReview}>
          <section style={panel}>
            <h2 style={{ marginTop: 0, fontSize: 18, color: '#0f172a' }}>
              Configure your {selectedPack.label.toLowerCase()}
            </h2>

            <label style={{ display: 'block', marginBottom: 18, fontSize: 14, color: '#334155' }}>
              Agent name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. JD screening assistant"
                required
                minLength={2}
                style={input}
              />
            </label>

            <label style={{ display: 'block', marginBottom: 18, fontSize: 14, color: '#334155' }}>
              What should this agent do?
              <textarea
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="Screen candidates against the open role and report fit"
                required
                rows={4}
                style={{ ...input, resize: 'vertical' }}
              />
            </label>

            <div
              style={{
                marginBottom: 18,
                padding: '14px 16px',
                background: '#f8fafc',
                border: `1px solid ${BORDER}`,
                borderRadius: 8,
              }}
            >
              <p style={{ margin: '0 0 6px', fontSize: 14, color: '#334155', fontWeight: 600 }}>
                Job description and related docs
              </p>
              <p style={{ margin: '0 0 12px', fontSize: 13, color: MUTED, lineHeight: 1.5 }}>
                Upload documents on the knowledge page, then attach them to this agent from
                the agent detail view after you create it.
              </p>
              <Link
                href="/knowledge"
                style={{
                  ...secondaryBtn,
                  display: 'inline-block',
                  textDecoration: 'none',
                  fontSize: 14,
                }}
              >
                Go to knowledge
              </Link>
            </div>

            <label style={{ display: 'block', marginBottom: 18, fontSize: 14, color: '#334155' }}>
              Questions to always ask (optional)
              <span style={{ display: 'block', fontSize: 13, color: MUTED, marginTop: 2 }}>
                One question per line
              </span>
              <textarea
                value={mustAskQuestions}
                onChange={(e) => setMustAskQuestions(e.target.value)}
                placeholder={'How many years of relevant experience?\nWhat is your notice period?'}
                rows={3}
                style={{ ...input, resize: 'vertical' }}
              />
            </label>

            <label style={{ display: 'block', marginBottom: 8, fontSize: 14, color: '#334155' }}>
              Transfer to a human (phone numbers)
              <span style={{ display: 'block', fontSize: 13, color: MUTED, marginTop: 2 }}>
                One number per line, e.g. +919876543210
              </span>
              <textarea
                value={transferPhones}
                onChange={(e) => setTransferPhones(e.target.value)}
                placeholder="+919876543210"
                rows={2}
                style={{ ...input, resize: 'vertical' }}
              />
            </label>
          </section>

          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" style={secondaryBtn} onClick={() => setStep('type')}>
              Back
            </button>
            <button type="submit" style={primaryBtn}>
              Review
            </button>
          </div>
        </form>
      )}

      {step === 'review' && selectedPack && (
        <section style={panel}>
          <h2 style={{ marginTop: 0, fontSize: 18, color: '#0f172a' }}>Review and create</h2>
          <dl style={{ margin: '0 0 24px', fontSize: 14, lineHeight: 1.7 }}>
            <dt style={{ color: MUTED, marginTop: 12 }}>Type</dt>
            <dd style={{ margin: '2px 0 0', color: '#0f172a' }}>{selectedPack.label}</dd>
            <dt style={{ color: MUTED, marginTop: 12 }}>Name</dt>
            <dd style={{ margin: '2px 0 0', color: '#0f172a' }}>{name}</dd>
            <dt style={{ color: MUTED, marginTop: 12 }}>Purpose</dt>
            <dd style={{ margin: '2px 0 0', color: '#0f172a' }}>{purpose}</dd>
            {parseLines(mustAskQuestions).length > 0 && (
              <>
                <dt style={{ color: MUTED, marginTop: 12 }}>Must-ask questions</dt>
                <dd style={{ margin: '2px 0 0', color: '#0f172a' }}>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {parseLines(mustAskQuestions).map((q) => (
                      <li key={q}>{q}</li>
                    ))}
                  </ul>
                </dd>
              </>
            )}
            {parseLines(transferPhones).length > 0 && (
              <>
                <dt style={{ color: MUTED, marginTop: 12 }}>Transfer phones</dt>
                <dd style={{ margin: '2px 0 0', color: '#0f172a' }}>
                  {parseLines(transferPhones).join(', ')}
                </dd>
              </>
            )}
          </dl>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" style={secondaryBtn} onClick={() => setStep('configure')}>
              Back
            </button>
            <button
              type="button"
              style={{ ...primaryBtn, opacity: submitting ? 0.7 : 1 }}
              disabled={submitting}
              onClick={() => void onSubmit()}
            >
              {submitting ? 'Creating…' : 'Create agent'}
            </button>
          </div>
        </section>
      )}

      {step === 'done' && createdId && (
        <section style={{ ...panel, textAlign: 'center' }}>
          <h2 style={{ marginTop: 0, fontSize: 20, color: '#0f172a' }}>Agent created</h2>
          <p style={{ fontSize: 15, color: MUTED, marginBottom: 24 }}>
            Your agent is saved as a draft. Publish it when you are ready, then try a demo
            conversation.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link
              href={`/agents/${createdId}`}
              style={{
                ...primaryBtn,
                display: 'inline-block',
                textDecoration: 'none',
              }}
            >
              Try a demo conversation
            </Link>
            <Link
              href="/agents"
              style={{
                ...secondaryBtn,
                display: 'inline-block',
                textDecoration: 'none',
              }}
            >
              All agents
            </Link>
          </div>
        </section>
      )}
    </main>
  );
}
