'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell, panel, primaryBtn, shell } from '../../components/AppShell';
import {
  ApiClientError,
  createCandidate,
  listCandidates,
  me,
  type Candidate,
  type Me,
} from '../../lib/api';

export default function CandidatesPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Me | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [resumeText, setResumeText] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([me(), listCandidates()]);
      setProfile(p);
      setCandidates(c.candidates);
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 401) router.push('/');
      else if (e instanceof ApiClientError && e.status === 403) {
        setNotice('You do not have access to candidates in this organization.');
      } else setNotice('Could not load candidates.');
    }
  }, [router]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const can = (p: string) =>
    profile?.activeOrganization?.permissions.includes(p) ?? false;
  const canPii = can('candidates.read_pii');

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    try {
      await createCandidate({
        fullName,
        phone: phone || undefined,
        email: email || undefined,
        resumeText: resumeText || undefined,
      });
      setFullName('');
      setPhone('');
      setEmail('');
      setResumeText('');
      setNotice('Candidate added.');
      await reload();
    } catch (e) {
      setNotice(e instanceof ApiClientError ? e.message : 'Could not add candidate.');
    }
  }

  if (!profile) {
    return (
      <AppShell profile={null}>
        <main style={shell}>Loading…</main>
      </AppShell>
    );
  }

  return (
    <AppShell profile={profile}>
      <main style={shell}>
        <header style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 0' }}>
          <strong>Candidates</strong>
        </header>

        {notice && (
          <p role="status" style={{ fontSize: 13, color: '#0d6e63' }}>
            {notice}
          </p>
        )}

        {can('candidates.create') && (
          <section style={panel}>
            <h2 style={{ marginTop: 0, fontSize: 17 }}>Add a candidate</h2>
            <p style={{ fontSize: 14, color: '#545c56', marginTop: 0 }}>
              Paste resume text to extract a phone number automatically, or enter
              contact details directly.
            </p>
            <form onSubmit={onCreate} style={{ display: 'grid', gap: 8 }}>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Full name"
                required
                minLength={1}
                maxLength={200}
                style={{ padding: '8px 10px' }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Phone (optional)"
                  maxLength={30}
                  style={{ flex: 1, padding: '8px 10px' }}
                />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email (optional)"
                  maxLength={320}
                  style={{ flex: 1, padding: '8px 10px' }}
                />
              </div>
              <textarea
                value={resumeText}
                onChange={(e) => setResumeText(e.target.value)}
                placeholder="Paste resume text (optional — phone numbers are extracted on save)"
                rows={8}
                maxLength={50_000}
                style={{ padding: 10, fontFamily: 'inherit' }}
              />
              <button type="submit" style={primaryBtn}>
                Add candidate
              </button>
            </form>
          </section>
        )}

        <section style={panel}>
          <h2 style={{ marginTop: 0, fontSize: 17 }}>Your candidates</h2>
          {candidates.length === 0 && (
            <p style={{ fontSize: 14, color: '#545c56' }}>No candidates yet.</p>
          )}
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {candidates.map((c) => (
              <li
                key={c.id}
                style={{
                  borderTop: '1px solid #e4e7e0',
                  padding: '12px 0',
                }}
              >
                <strong>{c.fullName}</strong>
                <span style={{ display: 'block', fontSize: 13, color: '#545c56' }}>
                  Source: {c.source}
                  {canPii && c.phone && ` · ${c.phone}`}
                  {canPii && c.email && ` · ${c.email}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </AppShell>
  );
}
