'use client';

import { useQuery } from '@tanstack/react-query';
import {
  listJobCandidates,
  listJobs,
  type Job,
} from '../lib/api';

export interface HiringPerson {
  candidateId: string;
  fullName: string;
  jobId: string;
  jobTitle: string;
  status: string;
  callStatus: string;
  phone?: string | null;
}

export interface JobFunnel {
  total: number;
  toScreen: number;
  inScreen: number;
  reviewed: number;
}

export interface HiringPeopleSnapshot {
  jobs: Job[];
  people: HiringPerson[];
  funnels: Record<string, JobFunnel>;
}

async function fetchHiringPeople(q?: string): Promise<HiringPeopleSnapshot> {
  const { jobs } = await listJobs();
  const openJobs = jobs.filter((j) => j.status !== 'closed');
  const qTrim = q?.trim() ?? '';
  const qLower = qTrim.toLowerCase();

  const batches = await Promise.all(
    openJobs.map(async (job) => {
      try {
        const titleHit =
          qLower.length > 0 && job.title.toLowerCase().includes(qLower);
        const { candidates } = await listJobCandidates(job.id, {
          // Job-title hits need the full roster; otherwise search name/mobile on the API.
          q: titleHit ? undefined : qTrim || undefined,
        });
        return { job, candidates };
      } catch {
        return { job, candidates: [] as Awaited<
          ReturnType<typeof listJobCandidates>
        >['candidates'] };
      }
    }),
  );

  const people: HiringPerson[] = [];
  const funnels: Record<string, JobFunnel> = {};

  for (const { job, candidates } of batches) {
    funnels[job.id] = {
      total: candidates.length,
      toScreen: candidates.filter((c) => c.status === 'new').length,
      inScreen: candidates.filter((c) => c.status === 'screening').length,
      reviewed: candidates.filter((c) => c.status === 'reviewed').length,
    };
    for (const row of candidates) {
      people.push({
        candidateId: row.candidateId,
        fullName: row.candidate.fullName,
        jobId: job.id,
        jobTitle: job.title,
        status: row.status,
        callStatus: row.callStatus ?? 'not_called',
        phone: row.candidate.phone ?? null,
      });
    }
  }

  return { jobs, people, funnels };
}

export const hiringPeopleQueryKey = ['hiring-people'] as const;

export function useHiringPeople(enabled = true, q = '') {
  const trimmed = q.trim();
  return useQuery({
    queryKey: [...hiringPeopleQueryKey, trimmed],
    queryFn: () => fetchHiringPeople(trimmed || undefined),
    enabled,
    staleTime: 30_000,
  });
}
