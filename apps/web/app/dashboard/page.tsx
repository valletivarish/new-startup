'use client';

/**
 * Dashboard shell: organization switcher, members and invitations.
 *
 * Permission gating here is a usability feature ONLY — every decision is
 * enforced server-side, and this page simply hides controls the API would
 * refuse (`05_UX_DASHBOARD_SPEC` §18.11).
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppShell, panel, primaryBtn, shell, STATUS_COLOR } from '../../components/AppShell';
import {
  ApiClientError,
  createOrganization,
  invitations as fetchInvitations,
  invite,
  listCandidates,
  listJobCandidates,
  listJobs,
  me,
  members as fetchMembers,
  myOrganizations,
  signOut,
  switchOrganization,
  type Invitation,
  type Me,
  type Member,
  type OrganizationSummary,
} from '../../lib/api';

interface AssignmentRow {
  jobTitle: string;
  jobId: string;
  candidateName: string;
  status: string;
}

interface HiringMetrics {
  jobCount: number;
  candidateCount: number;
  assignmentCount: number;
  recentAssignments: AssignmentRow[];
}

export default function DashboardPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Me | null>(null);
  const [orgs, setOrgs] = useState<OrganizationSummary[]>([]);
  const [memberRows, setMemberRows] = useState<Member[]>([]);
  const [inviteRows, setInviteRows] = useState<Invitation[]>([]);
  const [newOrgName, setNewOrgName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('viewer');
  const [notice, setNotice] = useState<string | null>(null);
  const [hiringMetrics, setHiringMetrics] = useState<HiringMetrics | null>(null);

  const reload = useCallback(async () => {
    try {
      const [profileData, orgData] = await Promise.all([me(), myOrganizations()]);
      setProfile(profileData);
      setOrgs(orgData.organizations);

      if (profileData.activeOrganization) {
        const permissions = new Set(profileData.activeOrganization.permissions);
        if (permissions.has('users.read')) {
          setMemberRows((await fetchMembers()).members);
          setInviteRows((await fetchInvitations()).invitations);
        } else {
          setMemberRows([]);
          setInviteRows([]);
        }

        const canJobs = permissions.has('jobs.read');
        const canCandidates = permissions.has('candidates.read');
        if (canJobs || canCandidates) {
          const metrics: HiringMetrics = {
            jobCount: 0,
            candidateCount: 0,
            assignmentCount: 0,
            recentAssignments: [],
          };

          if (canJobs) {
            const { jobs } = await listJobs();
            metrics.jobCount = jobs.length;

            if (canCandidates) {
              const assignmentRows: AssignmentRow[] = [];
              for (const job of jobs) {
                try {
                  const { candidates } = await listJobCandidates(job.id);
                  for (const row of candidates) {
                    assignmentRows.push({
                      jobId: job.id,
                      jobTitle: job.title,
                      candidateName: row.candidate.fullName,
                      status: row.status,
                    });
                  }
                } catch {
                  // Skip jobs where candidate list is forbidden or unavailable.
                }
              }
              metrics.assignmentCount = assignmentRows.length;
              metrics.recentAssignments = assignmentRows.slice(0, 8);
            }
          }

          if (canCandidates) {
            const { candidates } = await listCandidates();
            metrics.candidateCount = candidates.length;
          }

          setHiringMetrics(metrics);
        } else {
          setHiringMetrics(null);
        }
      } else {
        setHiringMetrics(null);
      }
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 401) router.push('/');
      else setNotice('Could not load your workspace. Refresh to retry.');
    }
  }, [router]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!profile) {
    return (
      <AppShell profile={null}>
        <main style={shell}>Loading…</main>
      </AppShell>
    );
  }

  const active = profile.activeOrganization;
  const permissions = new Set(active?.permissions ?? []);

  async function onCreateOrg(event: FormEvent) {
    event.preventDefault();
    await createOrganization(newOrgName);
    setNewOrgName('');
    await reload();
  }

  async function onSwitch(id: string) {
    await switchOrganization(id);
    await reload();
  }

  async function onInvite(event: FormEvent) {
    event.preventDefault();
    try {
      await invite(inviteEmail, inviteRole);
      setInviteEmail('');
      setNotice('Invitation sent.');
      await reload();
    } catch (e) {
      setNotice(
        e instanceof ApiClientError ? e.message : 'Invitation failed.',
      );
    }
  }

  return (
    <AppShell profile={profile}>
      <main style={shell}>
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '14px 0',
          }}
        >
          <strong>Dashboard</strong>
          <span style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 14 }}>
            <select
              value={active?.id ?? ''}
              onChange={(e) => void onSwitch(e.target.value)}
              aria-label="Active organization"
            >
              {!active && <option value="">No organization</option>}
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} · {o.roleKey}
                </option>
              ))}
            </select>
            {profile.user.email}
            <button
              onClick={() => void signOut().then(() => router.push('/'))}
              type="button"
            >
              Sign out
            </button>
          </span>
        </header>

        {notice && (
          <p role="status" style={{ color: '#0d6e63', fontSize: 13 }}>
            {notice}
          </p>
        )}

        {!active && (
          <section style={panel}>
            <h2 style={{ marginTop: 0, fontSize: 17 }}>Create your organization</h2>
            <p style={{ fontSize: 14, color: '#545c56' }}>
              You are not a member of any organization yet. Create one, or accept
              an invitation from your email.
            </p>
            <form onSubmit={onCreateOrg} style={{ display: 'flex', gap: 8 }}>
              <input
                value={newOrgName}
                onChange={(e) => setNewOrgName(e.target.value)}
                placeholder="Organization name"
                required
                minLength={2}
                style={{ flex: 1, padding: '8px 10px' }}
              />
              <button type="submit">Create</button>
            </form>
          </section>
        )}

        {active && (
          <>
            {hiringMetrics && (
              <section style={{ marginBottom: 18 }}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                    gap: 12,
                    marginBottom: 16,
                  }}
                >
                  {permissions.has('jobs.read') && (
                    <div style={{ ...panel, marginBottom: 0, textAlign: 'center' }}>
                      <div style={{ fontSize: 28, fontWeight: 700, color: '#1e40af' }}>
                        {hiringMetrics.jobCount}
                      </div>
                      <div style={{ fontSize: 13, color: '#545c56' }}>Jobs</div>
                    </div>
                  )}
                  {permissions.has('candidates.read') && (
                    <div style={{ ...panel, marginBottom: 0, textAlign: 'center' }}>
                      <div style={{ fontSize: 28, fontWeight: 700, color: '#1e40af' }}>
                        {hiringMetrics.candidateCount}
                      </div>
                      <div style={{ fontSize: 13, color: '#545c56' }}>Candidates</div>
                    </div>
                  )}
                  {permissions.has('jobs.read') &&
                    permissions.has('candidates.read') &&
                    hiringMetrics.assignmentCount > 0 && (
                      <div style={{ ...panel, marginBottom: 0, textAlign: 'center' }}>
                        <div style={{ fontSize: 28, fontWeight: 700, color: '#1e40af' }}>
                          {hiringMetrics.assignmentCount}
                        </div>
                        <div style={{ fontSize: 13, color: '#545c56' }}>Assignments</div>
                      </div>
                    )}
                </div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {permissions.has('jobs.read') && (
                    <Link href="/jobs" style={primaryBtn}>
                      View jobs
                    </Link>
                  )}
                  {permissions.has('candidates.read') && (
                    <Link href="/candidates" style={primaryBtn}>
                      View candidates
                    </Link>
                  )}
                </div>
              </section>
            )}

            {hiringMetrics &&
              permissions.has('jobs.read') &&
              permissions.has('candidates.read') &&
              hiringMetrics.recentAssignments.length > 0 && (
                <section style={panel}>
                  <h2 style={{ marginTop: 0, fontSize: 17 }}>Recent assignments</h2>
                  <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: '#545c56' }}>
                        <th style={{ padding: '6px 8px' }}>Job</th>
                        <th style={{ padding: '6px 8px' }}>Candidate</th>
                        <th style={{ padding: '6px 8px' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hiringMetrics.recentAssignments.map((row, i) => (
                        <tr key={`${row.jobId}-${row.candidateName}-${i}`} style={{ borderTop: '1px solid #e4e7e0' }}>
                          <td style={{ padding: '6px 8px' }}>
                            <Link href={`/jobs/${row.jobId}`} style={{ color: '#1e40af' }}>
                              {row.jobTitle}
                            </Link>
                          </td>
                          <td style={{ padding: '6px 8px' }}>{row.candidateName}</td>
                          <td
                            style={{
                              padding: '6px 8px',
                              color: STATUS_COLOR[row.status] ?? '#545c56',
                            }}
                          >
                            {row.status}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}

            <section style={panel}>
              <h2 style={{ marginTop: 0, fontSize: 17 }}>
                Your role: {active.role}
              </h2>
              <p style={{ fontSize: 14 }}>
                <Link href="/agents" style={{ color: '#0d6e63' }}>
                  Manage agents →
                </Link>
                {' · '}
                <Link href="/knowledge" style={{ color: '#0d6e63' }}>
                  Knowledge →
                </Link>
                {' · '}
                <Link href="/tools" style={{ color: '#0d6e63' }}>
                  Tools →
                </Link>
              </p>
              <p style={{ fontSize: 13, color: '#545c56' }}>
                {active.permissions.length} permissions in this organization.
              </p>
            </section>

          {permissions.has('users.read') && (
            <section style={panel}>
              <h2 style={{ marginTop: 0, fontSize: 17 }}>Members</h2>
              <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: '#545c56' }}>
                    <th style={{ padding: '6px 8px' }}>Name</th>
                    <th style={{ padding: '6px 8px' }}>Email</th>
                    <th style={{ padding: '6px 8px' }}>Role</th>
                    <th style={{ padding: '6px 8px' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {memberRows.map((m) => (
                    <tr key={m.membershipId} style={{ borderTop: '1px solid #e4e7e0' }}>
                      <td style={{ padding: '6px 8px' }}>{m.name}</td>
                      <td style={{ padding: '6px 8px' }}>{m.email}</td>
                      <td style={{ padding: '6px 8px' }}>{m.roleKey}</td>
                      <td style={{ padding: '6px 8px' }}>{m.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {permissions.has('users.invite') && (
            <section style={panel}>
              <h2 style={{ marginTop: 0, fontSize: 17 }}>Invite someone</h2>
              <form onSubmit={onInvite} style={{ display: 'flex', gap: 8 }}>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="email@company.com"
                  required
                  style={{ flex: 1, padding: '8px 10px' }}
                />
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  aria-label="Role for the invited member"
                >
                  {['administrator', 'agent_manager', 'knowledge_manager', 'recruiter', 'analyst', 'viewer'].map(
                    (r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ),
                  )}
                </select>
                <button type="submit">Invite</button>
              </form>
              {inviteRows.filter((i) => i.status === 'pending').length > 0 && (
                <ul style={{ fontSize: 13, color: '#545c56' }}>
                  {inviteRows
                    .filter((i) => i.status === 'pending')
                    .map((i) => (
                      <li key={i.id}>
                        {i.email} — {i.roleKey}, expires{' '}
                        {new Date(i.expiresAt).toLocaleDateString()}
                      </li>
                    ))}
                </ul>
              )}
            </section>
          )}
          </>
        )}
      </main>
    </AppShell>
  );
}
