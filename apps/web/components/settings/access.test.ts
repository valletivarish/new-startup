import { describe, expect, it } from 'vitest';
import { HIRING_USE_CASE } from '../../lib/use-case-definitions';
import { accessName, accessNameFromServer, canGrant, groupPermissions, permissionsToSave } from './access';

const admin = { role: 'administrator', permissions: ['jobs.read', 'candidates.read'] };

describe('canGrant', () => {
  it('only an Owner gives out Owner', () => {
    expect(canGrant({ key: 'owner' }, admin)).toBe(false);
    expect(canGrant({ key: 'owner' }, { role: 'owner', permissions: [] })).toBe(true);
  });

  it('nobody gives more than they hold, unless the server sent no permissions to compare', () => {
    expect(canGrant({ key: 'custom_a', permissions: ['jobs.read'] }, admin)).toBe(true);
    expect(canGrant({ key: 'custom_b', permissions: ['jobs.read', 'calls.read_recording'] }, admin)).toBe(false);
    expect(canGrant({ key: 'recruiter' }, admin)).toBe(true);
  });
});

describe('permissionsToSave', () => {
  it('keeps hidden permissions the level already had, and nothing hidden it lacked', () => {
    const hidden = new Set(['workflows.read', 'billing.read']);
    expect(permissionsToSave(new Set(['jobs.read']), ['workflows.read', 'calls.read'], hidden)).toEqual([
      'jobs.read',
      'workflows.read',
    ]);
  });
});

describe('groupPermissions', () => {
  it('leaves out areas that are not built and uses the use case words', () => {
    const p = (key: string, group: string) => ({ key, label: key, group, description: '', isSensitive: false });
    const groups = groupPermissions(
      [p('organization.read', 'Company'), p('workflows.read', 'Workflows'), p('jobs.read', 'Jobs')],
      HIRING_USE_CASE.labels,
    );
    expect(groups.map((g) => g.name)).toEqual([HIRING_USE_CASE.labels.workItem.many, 'Workspace']);
  });
});

it('accessName prefers our words for built-in levels and falls back to a readable key', () => {
  expect(accessName('recruiter', 'Recruiter / Operator')).toBe('Recruiter');
  expect(accessName('custom_team_lead', '')).toBe('Team lead');
  expect(accessNameFromServer('Recruiter / Operator')).toBe('Recruiter');
  expect(accessNameFromServer('Hiring lead')).toBe('Hiring lead');
});
