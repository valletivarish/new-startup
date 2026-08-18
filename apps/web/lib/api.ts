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

// --- Agents (Phase 2) -------------------------------------------------------

export interface Agent {
  id: string;
  name: string;
  description: string;
  purpose: string;
  type: string;
  status: string;
  currentVersionId: string | null;
  currentVersion: number | null;
}

export interface AgentVersion {
  id: string;
  version: number;
  status: string;
  configuration: Record<string, unknown>;
  publishedAt: string | null;
}

export interface AgentSession {
  id: string;
  agentId: string;
  agentVersion: number;
  status: string;
  startedAt: string;
  endedReason: string | null;
}

export interface SessionEvent {
  id: string;
  sequence: number;
  type: string;
  direction: string;
  payload: Record<string, unknown>;
}

export const listAgents = () => call<{ agents: Agent[] }>('/backend/agents');
export const getAgent = (id: string) => call<Agent>(`/backend/agents/${id}`);
export const createAgent = (input: { name: string; purpose: string; description?: string }) =>
  call<{ id: string; versionId: string }>('/backend/agents', {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const listVersions = (agentId: string) =>
  call<{ versions: AgentVersion[] }>(`/backend/agents/${agentId}/versions`);
export const createDraft = (agentId: string, configuration: unknown) =>
  call<{ id: string; version: number }>(`/backend/agents/${agentId}/versions`, {
    method: 'POST',
    body: JSON.stringify({ configuration }),
  });
export const updateDraft = (agentId: string, versionId: string, configuration: unknown) =>
  call(`/backend/agents/${agentId}/versions/${versionId}`, {
    method: 'PATCH',
    body: JSON.stringify({ configuration }),
  });
export const publishVersion = (agentId: string, versionId: string) =>
  call(`/backend/agents/${agentId}/versions/${versionId}/publish`, { method: 'POST', body: '{}' });

export const agentAction = (agentId: string, action: 'publish' | 'pause' | 'archive') =>
  call(`/backend/agents/${agentId}/${action}`, { method: 'POST', body: '{}' });

export const listSessions = (agentId?: string) =>
  call<{ sessions: AgentSession[] }>(
    `/backend/sessions${agentId ? `?agentId=${agentId}` : ''}`,
  );
export const createSession = (agentId: string) =>
  call<AgentSession>('/backend/sessions', {
    method: 'POST',
    body: JSON.stringify({ agentId }),
  });
export const listSessionEvents = (sessionId: string) =>
  call<{ events: SessionEvent[] }>(`/backend/sessions/${sessionId}/events`);
export const sendSessionMessage = (sessionId: string, content: string) =>
  call(`/backend/sessions/${sessionId}/events`, {
    method: 'POST',
    body: JSON.stringify({ type: 'UserMessageReceived', payload: { content } }),
  });
