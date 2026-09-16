'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { AppShell, panel, shell, STATUS_COLOR } from '../../../components/AppShell';
import {
  ApiClientError,
  assignCandidateToJob,
  getJob,
  getJobCandidateResults,
  listCandidates,
  listJobCandidates,
  me,
  updateJob,
  updateJobCandidateStatus,
  type CandidateScreeningResults,
  type Job,
  type JobCandidateAssignment,
  type Me,
} from '../../../lib/api';

const ASSIGNMENT_STATUSES = ['new', 'screening', 'reviewed'] as const;
const JOB_STATUSES = ['draft', 'open', 'closed'] as const;

function ReviewPanel({
  jobId,
  candidateId,
}: {
  jobId: string;
  candidateId: string;
}) {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<CandidateScreeningResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await getJobCandidateResults(jobId, candidateId);
      setResults(res.results);
      setExpanded(true);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not load screening results.');
    } finally {
      setLoading(false);
    }
  }

  const hasContent =
    results &&
    (results.summary ||
      results.transcript?.length ||
      results.structuredAnswers ||
      results.costCredits != null);

  return (
    <div style={{ marginTop: 10, fontSize: 13 }}>
      {!expanded && (
        <button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'View screening results'}
        </button>
      )}
      {error && (
        <p role="alert" style={{ color: '#a63a24', margin: '8px 0 0' }}>
          {error}
        </p>
      )}
      {expanded && results && (
        <div
          style={{
            marginTop: 8,
            padding: 12,
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 6,
          }}
        >
          {!hasContent && (
            <p style={{ margin: 0, color: '#545c56' }}>
              Screening results are not available yet.
            </p>
          )}
          {results.status && (
            <p style={{ margin: '0 0 8px', color: '#545c56' }}>
              Session status: {results.status}
            </p>
          )}
          {results.summary && (
            <div style={{ marginBottom: 10 }}>
              <strong>Summary</strong>
              <p style={{ margin: '4px 0 0', color: '#1a1f1c' }}>{results.summary}</p>
            </div>
          )}
          {results.structuredAnswers && Object.keys(results.structuredAnswers).length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <strong>Structured answers</strong>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {Object.entries(results.structuredAnswers).map(([key, value]) => (
                  <li key={key}>
                    {key}: {typeof value === 'string' ? value : JSON.stringify(value)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {results.transcript && results.transcript.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <strong>Transcript</strong>
              <ol style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {results.transcript.map((turn, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    <span style={{ color: '#545c56' }}>{turn.role}:</span>{' '}
                    {turn.message}
                  </li>
                ))}
              </ol>
            </div>
          )}
          {results.costCredits != null && (
            <p style={{ margin: 0, color: '#545c56' }}>
              Cost: {results.costCredits} credits
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function JobDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const jobId = params.id;

  const [profile, setProfile] = useState<Me | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [assignments, setAssignments] = useState<JobCandidateAssignment[]>([]);
  const [allCandidates, setAllCandidates] = useState<{ id: string; fullName: string }[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const p = await me();
      setProfile(p);
      const j = await getJob(jobId);
      setJob(j);

      const perms = new Set(p.activeOrganization?.permissions ?? []);
      if (perms.has('candidates.read')) {
        const [assigned, pool] = await Promise.all([
          listJobCandidates(jobId),
          listCandidates(),
        ]);
        setAssignments(assigned.candidates);
        setAllCandidates(pool.candidates.map((c) => ({ id: c.id, fullName: c.fullName })));
      } else {
        setAssignments([]);
        setAllCandidates([]);
      }
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 401) router.push('/');
      else if (e instanceof ApiClientError && e.status === 404) {
        setNotice('Job not found.');
      } else if (e instanceof ApiClientError && e.status === 403) {
        setNotice('You do not have access to this job.');
      } else setNotice('Could not load job.');
    }
  }, [jobId, router]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const can = (p: string) =>
    profile?.activeOrganization?.permissions.includes(p) ?? false;

  async function run(action: () => Promise<unknown>, ok: string) {
    try {
      await action();
      setNotice(ok);
      await reload();
    } catch (e) {
      setNotice(e instanceof ApiClientError ? e.message : 'That did not work.');
    }
  }

  async function onAssign() {
    if (!selectedCandidate) return;
    await run(
      () => assignCandidateToJob(jobId, selectedCandidate),
      'Candidate assigned.',
    );
    setSelectedCandidate('');
  }

  async function onJobStatusChange(status: (typeof JOB_STATUSES)[number]) {
    await run(() => updateJob(jobId, { status }), 'Job status updated.');
  }

  async function onAssignmentStatusChange(
    candidateId: string,
    status: (typeof ASSIGNMENT_STATUSES)[number],
  ) {
    await run(
      () => updateJobCandidateStatus(jobId, candidateId, status),
      'Assignment status updated.',
    );
  }

  if (!profile || !job) {
    return (
      <AppShell profile={profile}>
        <main style={shell}>{profile ? 'Loading…' : 'Loading…'}</main>
      </AppShell>
    );
  }

  const assignedIds = new Set(assignments.map((a) => a.candidateId));
  const unassigned = allCandidates.filter((c) => !assignedIds.has(c.id));

  return (
    <AppShell profile={profile}>
      <main style={shell}>
        <header style={{ padding: '14px 0' }}>
          <Link href="/jobs" style={{ fontSize: 14, color: '#0d6e63' }}>
            ← All jobs
          </Link>
          <h1 style={{ margin: '8px 0 4px', fontSize: 22 }}>{job.title}</h1>
          <span style={{ fontSize: 13, color: STATUS_COLOR[job.status] ?? '#545c56' }}>
            {job.status}
          </span>
        </header>

        {notice && (
          <p role="status" style={{ fontSize: 13, color: '#0d6e63' }}>
            {notice}
          </p>
        )}

        <section style={panel}>
          <h2 style={{ marginTop: 0, fontSize: 17 }}>Job details</h2>
          {job.description ? (
            <p style={{ fontSize: 14, color: '#1a1f1c', whiteSpace: 'pre-wrap' }}>
              {job.description}
            </p>
          ) : (
            <p style={{ fontSize: 14, color: '#545c56' }}>No description.</p>
          )}
          {can('jobs.update') && (
            <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {JOB_STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={job.status === s}
                  onClick={() => void onJobStatusChange(s)}
                >
                  Mark {s}
                </button>
              ))}
            </div>
          )}
        </section>

        {can('jobs.update') && can('candidates.read') && unassigned.length > 0 && (
          <section style={panel}>
            <h2 style={{ marginTop: 0, fontSize: 17 }}>Assign a candidate</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <select
                value={selectedCandidate}
                onChange={(e) => setSelectedCandidate(e.target.value)}
                aria-label="Candidate to assign"
                style={{ flex: 1, padding: '8px 10px' }}
              >
                <option value="">Select candidate…</option>
                {unassigned.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.fullName}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => void onAssign()} disabled={!selectedCandidate}>
                Assign
              </button>
            </div>
          </section>
        )}

        {can('candidates.read') && (
          <section style={panel}>
            <h2 style={{ marginTop: 0, fontSize: 17 }}>Assigned candidates</h2>
            {assignments.length === 0 && (
              <p style={{ fontSize: 14, color: '#545c56' }}>No candidates assigned yet.</p>
            )}
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {assignments.map((row) => (
                <li
                  key={row.id}
                  style={{
                    borderTop: '1px solid #e4e7e0',
                    padding: '14px 0',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 12,
                      flexWrap: 'wrap',
                    }}
                  >
                    <span>
                      <strong>{row.candidate.fullName}</strong>
                      <span style={{ display: 'block', fontSize: 13, color: '#545c56' }}>
                        Source: {row.candidate.source}
                      </span>
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        style={{
                          fontSize: 13,
                          color: STATUS_COLOR[row.status] ?? '#545c56',
                        }}
                      >
                        {row.status}
                      </span>
                      {can('jobs.update') && (
                        <select
                          value={row.status}
                          onChange={(e) =>
                            void onAssignmentStatusChange(
                              row.candidateId,
                              e.target.value as (typeof ASSIGNMENT_STATUSES)[number],
                            )
                          }
                          aria-label={`Status for ${row.candidate.fullName}`}
                          style={{ fontSize: 13 }}
                        >
                          {ASSIGNMENT_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      )}
                    </span>
                  </div>
                  <ReviewPanel jobId={jobId} candidateId={row.candidateId} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </AppShell>
  );
}
