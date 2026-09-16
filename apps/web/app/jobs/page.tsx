'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppShell, panel, primaryBtn, shell, STATUS_COLOR } from '../../components/AppShell';
import {
  ApiClientError,
  createJob,
  listJobs,
  me,
  type Job,
  type Me,
} from '../../lib/api';

export default function JobsPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Me | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const p = await me();
      setProfile(p);
      try {
        const j = await listJobs();
        setJobs(j.jobs);
      } catch (e) {
        setJobs([]);
        if (e instanceof ApiClientError && e.status === 403) {
          setNotice('You do not have access to jobs in this organization.');
        } else setNotice('Could not load jobs.');
      }
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 401) router.push('/');
      else setNotice('Could not load profile.');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const can = (p: string) =>
    profile?.activeOrganization?.permissions.includes(p) ?? false;

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    try {
      const { id } = await createJob({
        title,
        description: description || undefined,
      });
      setTitle('');
      setDescription('');
      setNotice('Job created.');
      router.push(`/jobs/${id}`);
    } catch (e) {
      setNotice(e instanceof ApiClientError ? e.message : 'Could not create job.');
    }
  }

  if (!profile) {
    return (
      <AppShell profile={null}>
        <main style={shell}>
          {loading ? (
            'Loading…'
          ) : (
            notice && (
              <p role="alert" style={{ fontSize: 13, color: '#a63a24' }}>
                {notice}
              </p>
            )
          )}
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell profile={profile}>
      <main style={shell}>
        <header style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 0' }}>
          <strong>Jobs</strong>
        </header>

        {notice && (
          <p role="status" style={{ fontSize: 13, color: '#0d6e63' }}>
            {notice}
          </p>
        )}

        {can('jobs.create') && (
          <section style={panel}>
            <h2 style={{ marginTop: 0, fontSize: 17 }}>Create a job</h2>
            <p style={{ fontSize: 14, color: '#545c56', marginTop: 0 }}>
              Open roles appear on your hiring desk for candidate assignment and
              screening.
            </p>
            <form onSubmit={onCreate} style={{ display: 'grid', gap: 8 }}>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Job title"
                required
                minLength={1}
                maxLength={200}
                style={{ padding: '8px 10px' }}
              />
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Description (optional)"
                rows={3}
                maxLength={5000}
                style={{ padding: 10, fontFamily: 'inherit' }}
              />
              <button type="submit" style={primaryBtn}>
                Create job
              </button>
            </form>
          </section>
        )}

        <section style={panel}>
          <h2 style={{ marginTop: 0, fontSize: 17 }}>Your jobs</h2>
          {jobs.length === 0 && (
            <p style={{ fontSize: 14, color: '#545c56' }}>No jobs yet.</p>
          )}
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {jobs.map((job) => (
              <li
                key={job.id}
                style={{
                  borderTop: '1px solid #e4e7e0',
                  padding: '12px 0',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <span>
                  <Link
                    href={`/jobs/${job.id}`}
                    style={{ fontWeight: 600, color: '#1a1f1c' }}
                  >
                    {job.title}
                  </Link>
                  {job.description && (
                    <span style={{ display: 'block', fontSize: 13, color: '#545c56' }}>
                      {job.description.slice(0, 120)}
                      {job.description.length > 120 ? '…' : ''}
                    </span>
                  )}
                </span>
                <span style={{ fontSize: 13, color: STATUS_COLOR[job.status] ?? '#545c56' }}>
                  {job.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </AppShell>
  );
}
