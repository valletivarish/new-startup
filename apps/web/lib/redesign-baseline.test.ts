import { describe, expect, it } from 'vitest';
import { BULK_CONFIRM_AT, needsTypedConfirm } from '../components/jobs/people-filters';
import { jobReadiness } from '../components/jobs/setup';
import { meetsAllFirst } from '../components/candidates/fit';
import { adminLinks, buildNav, gate } from '../components/layout/app-shell/nav';
import { HIRING_USE_CASE } from './use-case-definitions';
import type { CallFit } from './api';

const job = {
  description: 'x'.repeat(30),
  hasJdDocs: false,
  agentId: 'agent-1',
  status: 'open',
  screeningQuestions: [],
  requirements: null,
} as unknown as Parameters<typeof jobReadiness>[0];
const noDocs = { readyDocs: 0, pendingDocs: 0 };

describe('redesign baseline', () => {
  describe('jobReadiness', () => {
    it('is ready only with a saved description and a live agent', () => {
      expect(jobReadiness(job, [], true).ready).toBe(true);
      expect(jobReadiness({ ...job, description: 'too short' }, [], true).ready).toBe(false);
      expect(jobReadiness(job, [], false).ready).toBe(false);
      expect(jobReadiness({ ...job, agentId: null }, [], true).ready).toBe(false);
    });

    it('needs a connected calling number on top for phoneReady', () => {
      expect(jobReadiness(job, [], true, 'connected').phoneReady).toBe(true);
      expect(jobReadiness(job, [], true, 'not-connected').phoneReady).toBe(false);
      expect(jobReadiness({ ...job, description: '' }, [], true, 'connected').phoneReady).toBe(false);
    });

    it('reports a description file still being read as preparing', () => {
      const r = jobReadiness({ ...job, description: '' }, [{ readyDocs: 0, pendingDocs: 1 }], true);
      expect(r.description).toBe('preparing');
      expect(r.ready).toBe(false);
      expect(jobReadiness({ ...job, description: '' }, [noDocs], true).description).toBe('missing');
    });
  });

  describe('fit sort', () => {
    const item = (id: string, overall?: CallFit['overall']) => ({
      id,
      fit: overall ? ({ overall } as CallFit) : null,
    });

    it('puts meets_all first and keeps the given order otherwise', () => {
      const items = [item('a', 'doesnt_meet'), item('b', 'meets_all'), item('c'), item('d', 'meets_all'), item('e', 'doesnt_meet')];
      expect(meetsAllFirst(items).map((i) => i.id)).toEqual(['b', 'd', 'a', 'c', 'e']);
    });

    it('is stable when nobody meets all', () => {
      const items = [item('a'), item('b', 'doesnt_meet'), item('c')];
      expect(meetsAllFirst(items).map((i) => i.id)).toEqual(['a', 'b', 'c']);
    });
  });

  describe('bulk decisions', () => {
    it('asks for the typed confirmation at exactly 24 people and not at 23', () => {
      expect(BULK_CONFIRM_AT).toBe(24);
      expect(needsTypedConfirm(23)).toBe(false);
      expect(needsTypedConfirm(24)).toBe(true);
    });
  });

  describe('nav gate()', () => {
    // The nav itself changed by design (slice 2); gating behaviour must not.
    const all = [...buildNav(HIRING_USE_CASE.labels).main, ...adminLinks];

    it('hides items whose permission the person lacks and keeps ungated ones', () => {
      const hrefs = gate(all, ['jobs.read']).map((i) => i.href);
      expect(hrefs).toContain('/jobs');
      expect(hrefs).toContain('/settings');
      expect(hrefs).not.toContain('/people');
      expect(hrefs).not.toContain('/reports');
      expect(hrefs).not.toContain('/admin/costs');
    });

    it('marks gated items pending while permissions are unknown, and hides them with no workspace', () => {
      const pending = gate(all, undefined);
      expect(pending.find((i) => i.href === '/people')?.pending).toBe(true);
      expect(pending.find((i) => i.href === '/settings')?.pending).toBe(false);
      expect(gate(all, null).map((i) => i.href)).toEqual(['/jobs', '/settings']);
    });
  });
});
