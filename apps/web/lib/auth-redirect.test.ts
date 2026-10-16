import { afterEach, describe, expect, it, vi } from 'vitest';
import { loginPathForReturn, safeReturnPath } from './auth-redirect';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('safeReturnPath', () => {
  it.each([
    '/\\evil.com',
    '/\\\t/evil.com',
    '/\t/evil.com',
    '/\n/evil.com',
    '//evil.com',
    'https://evil.com',
    'evil.com',
    '/login',
    '/login?next=/jobs',
    '',
    null,
    undefined,
  ])('refuses %j', (raw) => {
    expect(safeReturnPath(raw)).toBeNull();
  });

  it('refuses what URLSearchParams decodes from a crafted link', () => {
    const next = (query: string) => new URLSearchParams(query).get('next');
    expect(safeReturnPath(next('next=/%5Cevil.example'))).toBeNull();
    expect(safeReturnPath(next('next=/%09/evil.example'))).toBeNull();
    expect(safeReturnPath(next('next=/%0A/evil.example'))).toBeNull();
  });

  it('keeps paths on this site with their query and hash', () => {
    expect(safeReturnPath('/jobs?stage=new')).toBe('/jobs?stage=new');
    expect(safeReturnPath('/invitations/accept?token=abc123')).toBe('/invitations/accept?token=abc123');
    expect(safeReturnPath('/jobs/1/candidates?c=9#answers')).toBe('/jobs/1/candidates?c=9#answers');
  });
});

describe('loginPathForReturn', () => {
  it('carries a safe current path, and drops an unsafe one', () => {
    vi.stubGlobal('window', { location: { pathname: '/jobs/1', search: '?c=2' } });
    expect(loginPathForReturn()).toBe('/login?next=%2Fjobs%2F1%3Fc%3D2');
    expect(loginPathForReturn('/\\evil.com')).toBe('/login');
    expect(loginPathForReturn('/login')).toBe('/login');
  });
});
