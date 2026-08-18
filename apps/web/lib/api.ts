/**
 * Thin API client. All requests are same-origin (Next rewrites proxy to the
 * backend), so the httpOnly session cookie travels automatically. The client
 * never sees or stores a token — sessions are opaque and server-side
 * (ADR-002).
 */

export interface ApiFailure {
  readonly code: string;
  readonly message: string;
  readonly errors?: readonly { field: string; message: string }[];
}

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(status: number, failure: ApiFailure) {
    super(failure.message);
    this.status = status;
    this.code = failure.code;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
    credentials: 'same-origin',
  });
  const text = await response.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    throw new ApiClientError(
      response.status,
      (body ?? { code: 'internal', message: 'Request failed' }) as ApiFailure,
    );
  }
  return body as T;
}

// Better Auth surface
export const signUp = (input: { email: string; password: string; name: string }) =>
  call('/api/auth/sign-up/email', { method: 'POST', body: JSON.stringify(input) });
export const signIn = (input: { email: string; password: string }) =>
  call('/api/auth/sign-in/email', { method: 'POST', body: JSON.stringify(input) });
export const signOut = () => call('/api/auth/sign-out', { method: 'POST', body: '{}' });

// Platform surface
export interface Me {
  user: { id: string; name: string; email: string; emailVerified: boolean };
  activeOrganization: { id: string; role: string; permissions: string[] } | null;
}
export const me = () => call<Me>('/backend/auth/me');

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  status: string;
  roleKey: string;
}
export const myOrganizations = () =>
  call<{ organizations: OrganizationSummary[] }>('/backend/auth/organizations');

export const switchOrganization = (organizationId: string) =>
  call('/backend/auth/switch-organization', {
    method: 'POST',
    body: JSON.stringify({ organizationId }),
  });

export const createOrganization = (name: string) =>
  call<{ id: string; slug: string }>('/backend/organizations', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });

export interface Member {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  roleKey: string;
  status: string;
}
export const members = () =>
  call<{ members: Member[] }>('/backend/organization/members');

export interface Invitation {
  id: string;
  email: string;
  roleKey: string;
  status: string;
  expiresAt: string;
}
export const invitations = () =>
  call<{ invitations: Invitation[] }>('/backend/organization/invitations');
export const invite = (email: string, roleKey: string) =>
  call('/backend/organization/invitations', {
    method: 'POST',
    body: JSON.stringify({ email, roleKey }),
  });
export const acceptInvitation = (token: string) =>
  call<{ organizationId: string }>('/backend/invitations/accept', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
