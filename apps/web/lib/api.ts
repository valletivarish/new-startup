/**
 * Thin API client. All requests are same-origin (Next rewrites proxy to the
 * backend), so the httpOnly session cookie travels automatically. The client
 * never sees or stores a token — sessions are opaque and server-side
 * (ADR-002).
 *
 * Every failure is an ApiClientError whose `message` is already a plain sentence
 * (lib/errors.ts); use `toUserMessage(error, context)` for title, detail and action.
 */

import { loginPathForReturn } from './auth-redirect';
import { ApiClientError, NotAvailableError, type ApiFailure } from './errors';
import type { TtsModel, VoiceEngine, VoicePersona } from '@/app/admin/costs-api';

/** Call languages (India launch set, docs/voice-selection.md). */
export const SCREENING_LANGUAGE_LABEL = {
  en: 'English',
  hi: 'Hindi',
  bn: 'Bengali',
  mr: 'Marathi',
  te: 'Telugu',
  ta: 'Tamil',
  gu: 'Gujarati',
  ur: 'Urdu',
  kn: 'Kannada',
  ml: 'Malayalam',
  pa: 'Punjabi',
} as const;
export type ScreeningLanguage = keyof typeof SCREENING_LANGUAGE_LABEL;
export const isScreeningLanguage = (v: unknown): v is ScreeningLanguage =>
  typeof v === 'string' && v in SCREENING_LANGUAGE_LABEL;

export { ApiClientError, NotAvailableError };
export type { ApiFailure };

/** User-facing notice; server errors carry their support ref. */
export function formatApiError(error: unknown, fallback: string): string {
  return error instanceof ApiClientError ? error.message : fallback;
}

// --- Session end ----------------------------------------------------------------

const SESSION_ENDED_KEY = 'session-ended';
export const SESSION_ENDED_MESSAGE = 'Your session ended. Sign in to continue.';

/** Sign-in and public invite routes answer 401 as part of their job: never redirect for them. */
const AUTH_ENDPOINT = /^\/(?:api\/auth\/|backend\/invitations\/|backend\/public\/|backend\/auth\/password-reset\/)/;
/** Pages that work signed out (a 401 there must not bounce to sign-in). */
const PUBLIC_PAGE = /^\/(?:$|login|reset-password|invitations|c|status)(?:[/?#]|$)/;

let redirecting = false;

/** True once a 401 has sent this page to sign-in (unsaved-changes guards stand down). */
export function isRedirectingToLogin(): boolean {
  return redirecting;
}

/** For the sign-in page: true once after a forced sign-out, then cleared. Show SESSION_ENDED_MESSAGE. */
export function takeSessionEndedNotice(): boolean {
  try {
    const ended = window.sessionStorage.getItem(SESSION_ENDED_KEY) === '1';
    window.sessionStorage.removeItem(SESSION_ENDED_KEY);
    return ended;
  } catch {
    return false;
  }
}

function redirectToLogin(path: string) {
  if (typeof window === 'undefined' || redirecting) return;
  if (AUTH_ENDPOINT.test(path) || PUBLIC_PAGE.test(window.location.pathname)) return;
  redirecting = true;
  try {
    window.sessionStorage.setItem(SESSION_ENDED_KEY, '1');
  } catch {
    // Storage blocked: the sign-in page just won't explain why.
  }
  window.location.assign(loginPathForReturn());
}

// --- Request --------------------------------------------------------------------

interface CallOptions {
  /** A route newer backends add. 404 "Not found" or 405 throws NotAvailableError so the UI can fall back. */
  optional?: boolean;
}
const OPTIONAL: CallOptions = { optional: true };

/** fetch with the session cookie; a dropped connection becomes ApiClientError status 0. */
async function send(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(path, { ...init, credentials: 'same-origin' });
  } catch (error) {
    if ((error as Error | null)?.name === 'AbortError') throw error;
    throw new ApiClientError(0, { code: 'network', message: '' });
  }
}

function safeJson(text: string): unknown {
  try {
    return text ? (JSON.parse(text) as unknown) : null;
  } catch {
    return null;
  }
}

/** The error for a non-2xx response. Never throws from parsing; a 401 also starts the sign-in redirect. */
async function failureOf(response: Response, path: string, options?: CallOptions): Promise<ApiClientError> {
  const body = safeJson(await response.text().catch(() => ''));
  const envelope = body && typeof body === 'object' ? (body as Partial<ApiFailure>) : {};
  const message = typeof envelope.message === 'string' ? envelope.message.trim() : '';
  const failure: ApiFailure = {
    ...envelope,
    code: typeof envelope.code === 'string' ? envelope.code : 'http_error',
    message,
  };
  if (response.status === 401) redirectToLogin(path);
  // Both backends answer an unknown route with a bare "Not found"; real misses name the thing.
  const routeMissing =
    response.status === 405 || (response.status === 404 && (!message || /^not found\.?$/i.test(message)));
  if (options?.optional && routeMissing) return new NotAvailableError(response.status, failure);
  return new ApiClientError(response.status, failure);
}

export async function call<T>(path: string, init?: RequestInit, options?: CallOptions): Promise<T> {
  const response = await send(path, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) throw await failureOf(response, path, options);
  const text = await response.text();
  if (!text) return null as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    // A 2xx that isn't JSON (proxy page, truncated body) is a server-side failure.
    throw new ApiClientError(502, { code: 'invalid_response', message: '' });
  }
}

// Better Auth surface
export const signUp = (input: { email: string; password: string; name: string }) =>
  call('/api/auth/sign-up/email', { method: 'POST', body: JSON.stringify(input) });
export const signIn = (input: { email: string; password: string }) =>
  call('/api/auth/sign-in/email', { method: 'POST', body: JSON.stringify(input) });
export const signOut = () => call('/api/auth/sign-out', { method: 'POST', body: '{}' });
/** Who is signed in, or null. Answers 200 either way, so a signed-out page logs no 401. */
export const getSession = () =>
  call<{ user: { id: string; email: string; name: string } } | null>('/api/auth/get-session');

/** Same answer for known and unknown emails. Reset links travel only by email (audit A1). */
export const requestPasswordReset = async (email: string, redirectTo: string) => {
  await call<{ status: boolean; message: string }>('/api/auth/request-password-reset', {
    method: 'POST',
    body: JSON.stringify({ email, redirectTo }),
  });
  return { status: true as const };
};

export const resetPassword = (newPassword: string, token: string) =>
  call<{ status: boolean }>('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ newPassword, token }),
  });

/** The signed-in person's display name. Email can't change here. */
export const updateUser = (input: { name: string }) =>
  call<{ status: boolean }>('/api/auth/update-user', { method: 'POST', body: JSON.stringify(input) });

/** 400 INVALID_PASSWORD when the current password is wrong. Other sessions stay signed in. */
export const changePassword = (input: { currentPassword: string; newPassword: string }) =>
  call<unknown>('/api/auth/change-password', { method: 'POST', body: JSON.stringify(input) });

// Platform surface
export interface Me {
  user: { id: string; name: string; email: string; emailVerified: boolean };
  activeOrganization: { id: string; role: string; permissions: string[] } | null;
  /** Platform owner (PLATFORM_ADMIN_EMAILS): sees the cross-company cost dashboard. */
  isPlatformAdmin?: boolean;
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

/** PATCH /organization: rename the active workspace (organization.update). */
export const updateOrganization = (input: { name: string }) =>
  call<{ updated: true }>('/backend/organization', { method: 'PATCH', body: JSON.stringify(input) });

/** Idempotent: create a company if the user has none, else activate the existing one. */
export const ensureOrganization = (name: string) =>
  call<{ id: string; slug: string; created: boolean }>('/backend/organizations/ensure', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });

// Team routes follow apps/api-java/MIGRATION_STATUS.md "Frontend contract additions", which
// supersedes spec §8: the workspace comes from the session (`/organization/...`, `/roles`), and
// members are addressed by membershipId. Fields marked "newer backends" may be absent.

export interface Member {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  roleKey: string;
  status: string;
  /** Newer backends. */
  roleId?: string;
  roleName?: string;
  roleIsSystem?: boolean;
  joinedAt?: string;
}
export const members = () =>
  call<{ members: Member[] }>('/backend/organization/members');

/** Attach a different role to a member (invalidates their sessions in this company). */
export const changeMemberRole = (membershipId: string, roleKey: string) =>
  call<{ updated: true }>(`/backend/organization/members/${membershipId}/role`, {
    method: 'PATCH',
    body: JSON.stringify({ roleKey }),
  });

/** DELETE /organization/members/:membershipId → `{ removed: true }`. 409 for the last owner. */
export const removeMember = (membershipId: string) =>
  call<{ removed: true }>(`/backend/organization/members/${membershipId}`, { method: 'DELETE' });

/**
 * POST /organization/members/:membershipId/password-reset → `{ sent: true }`.
 * Emails the member a reset link; never returns the link. Optional: NotAvailableError on older backends.
 */
export const sendMemberPasswordReset = (membershipId: string) =>
  call<{ sent: true }>(
    `/backend/organization/members/${membershipId}/password-reset`,
    { method: 'POST', body: '{}' },
    OPTIONAL,
  );

export type InvitationStatus = 'pending' | 'expired' | 'revoked' | 'accepted';

export interface Invitation {
  id: string;
  email: string;
  roleKey: string;
  /** InvitationStatus; older backends list pending invites only. */
  status: string;
  expiresAt: string;
  /** Newer backends. */
  roleId?: string;
  roleName?: string;
  invitedByName?: string;
  createdAt?: string;
  acceptedAt?: string | null;
}
export const invitations = () =>
  call<{ invitations: Invitation[] }>('/backend/organization/invitations');

/** Create and resend answer the same shape. Say "We emailed them" only when emailDelivery is 'sent'. */
export interface InviteResult {
  id: string;
  acceptUrl: string;
  /** Newer backends: the stored invite, the copyable link (same as acceptUrl) and email outcome. */
  invitation?: Invitation;
  inviteUrl?: string;
  emailDelivery?: 'sent' | 'not_configured';
}
/** `roleKey` may be a custom role key (`custom_<slug>`). */
export const invite = (email: string, roleKey: string) =>
  call<InviteResult>('/backend/organization/invitations', {
    method: 'POST',
    body: JSON.stringify({ email, roleKey }),
  });

/**
 * POST /organization/invitations/:id/resend → InviteResult. Rotates the link (the old one stops
 * working) with a new expiry; 409 if accepted or revoked. Optional: NotAvailableError on older backends.
 */
export const resendInvitation = (invitationId: string) =>
  call<InviteResult>(
    `/backend/organization/invitations/${invitationId}/resend`,
    { method: 'POST', body: '{}' },
    OPTIONAL,
  );

/** DELETE /organization/invitations/:id → `{ revoked: true }`; 404 unless still pending. */
export const revokeInvitation = (invitationId: string) =>
  call<{ revoked: true }>(`/backend/organization/invitations/${invitationId}`, { method: 'DELETE' });

export const acceptInvitation = (token: string) =>
  call<{ organizationId: string }>('/backend/invitations/accept', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });

export interface InvitationPreview {
  organizationName: string;
  inviterName: string;
  roleName: string;
  email: string;
  status: InvitationStatus;
  accountExists: boolean;
}

/**
 * Public. GET /invitations/:token → InvitationPreview; 404 ApiClientError for an unknown token.
 * (The spec's `/invitations/preview?token=` became this route in MIGRATION_STATUS.md.)
 * Optional: NotAvailableError on older backends, then fall back to sign-in-to-accept.
 */
export const previewInvitation = (token: string) =>
  call<InvitationPreview>(`/backend/invitations/${encodeURIComponent(token)}`, undefined, OPTIONAL);

/**
 * Public. POST /invitations/accept-new `{ token, name, password }` → `{ organizationId, userId }`
 * and signs the person in. 422 field errors (name, password), 409 when the account already
 * exists (sign in instead), 410 expired or revoked. Optional: NotAvailableError on older backends.
 */
export const acceptInvitationAsNewUser = (input: { token: string; name: string; password: string }) =>
  call<{ organizationId: string; userId: string }>(
    '/backend/invitations/accept-new',
    { method: 'POST', body: JSON.stringify(input) },
    OPTIONAL,
  );

export interface CandidateLinkInfo {
  companyName: string;
  jobTitle: string;
  fullName: string | null;
  expiresAt: string;
}

/** Public. 404 when the link is unknown, used or expired. */
export const getCandidateLink = (token: string) =>
  call<CandidateLinkInfo>(`/backend/public/candidate-links/${encodeURIComponent(token)}`);

/**
 * Public. `when` is 'now' or an ISO time. The candidate's own consent is sent as `consent: true`.
 * 404 spent link, 422 field errors, 429 too many tries.
 */
export const submitCandidateLink = (
  token: string,
  input: { fullName: string; phone: string; countryCode: string; when: string },
) =>
  call<{ scheduledFor: string | null }>(`/backend/public/candidate-links/${encodeURIComponent(token)}`, {
    method: 'POST',
    body: JSON.stringify({ ...input, consent: true }),
  });

export interface Role {
  id: string;
  /** Custom roles are `custom_<slug>`. */
  key: string;
  name: string;
  description: string;
  isSystem: boolean;
  /** Newer backends; absent means unknown, not "none". */
  permissions?: string[];
  memberCount?: number;
}

/** GET /roles → system and this workspace's custom roles. */
export const listRoles = async () => {
  const { roles } = await call<{ roles: (Omit<Role, 'isSystem'> & { isSystem?: boolean })[] }>(
    '/backend/roles',
  );
  return { roles: roles.map((r): Role => ({ ...r, isSystem: r.isSystem ?? !r.key.startsWith('custom_') })) };
};

export interface PermissionInfo {
  key: string;
  label: string;
  /** Area for the matrix (People, Jobs, Calls, ...). */
  group: string;
  description: string;
  /** Personal data: every read is logged. */
  isSensitive: boolean;
}

/** GET /permissions, normalised: older backends send `resource`/`is_sensitive` and no label or group. */
export const listPermissions = async () => {
  const { permissions } = await call<{
    permissions: {
      key: string;
      label?: string;
      group?: string;
      resource?: string;
      description?: string;
      isSensitive?: boolean;
      is_sensitive?: boolean;
    }[];
  }>('/backend/permissions');
  return {
    permissions: permissions.map(
      (p): PermissionInfo => ({
        key: p.key,
        label: p.label || p.description || p.key,
        group: p.group || p.resource || 'Other',
        description: p.description ?? '',
        isSensitive: p.isSensitive ?? p.is_sensitive ?? false,
      }),
    ),
  };
};

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

export interface WizardField {
  key: string;
  label: string;
  kind: 'text' | 'textarea' | 'string_list' | 'phone_list';
  required: boolean;
}

export interface PackDefinition {
  id: string;
  label: string;
  description: string;
  wizardFields: WizardField[];
  suggestedMustAskQuestions?: string[];
}

export const listAgents = () => call<{ agents: Agent[] }>('/backend/agents');
export const listPacks = () => call<{ packs: PackDefinition[] }>('/backend/agents/packs');
export const getAgent = (id: string) => call<Agent>(`/backend/agents/${id}`);
export const createAgent = (input: {
  name: string;
  purpose: string;
  description?: string;
  agentType?: string;
  mustAskQuestions?: string[];
  transferPhones?: string[];
  knowledgeSourceIds?: string[];
}) =>
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

// --- Knowledge (Phase 3) ----------------------------------------------------

export interface KnowledgeSource {
  id: string;
  name: string;
  description: string;
  type: string;
  status: string;
  documentCount: number;
}

export interface KnowledgeDocument {
  id: string;
  sourceId: string;
  name: string;
  contentType: string;
  byteSize: number;
  status: string;
  version: number;
  indexedVersion: number | null;
  chunkCount: number;
  failureReason: string | null;
  failureCategory: string | null;
}

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  documentName: string;
  content: string;
  similarity: number;
  section: string | null;
}

/**
 * The description that marks a job's own document set: the job page creates it with this, and so
 * does the server (HiringController.saveJdText). Knowledge leaves these sets out of company facts.
 * ponytail: matched by text until sources carry a job id; change it here and on the server together.
 */
export const JOB_SOURCE_DESCRIPTION = 'Job description and role docs for screening';

export const listKnowledgeSources = () =>
  call<{ sources: KnowledgeSource[] }>('/backend/knowledge/sources');
export const createKnowledgeSource = (name: string, description?: string) =>
  call<{ id: string }>('/backend/knowledge/sources', {
    method: 'POST',
    body: JSON.stringify({ name, description }),
  });
export const deleteKnowledgeSource = (id: string) =>
  call(`/backend/knowledge/sources/${id}`, { method: 'DELETE' });

export const listKnowledgeDocuments = (sourceId?: string) =>
  call<{ documents: KnowledgeDocument[] }>(
    `/backend/knowledge/documents${sourceId ? `?sourceId=${sourceId}` : ''}`,
  );
export const uploadKnowledgeDocument = (input: {
  sourceId: string;
  name: string;
  contentType: string;
  content: string;
  contentEncoding?: 'utf8' | 'base64';
}) =>
  call<{ id: string; deduplicated: boolean }>('/backend/knowledge/documents', {
    method: 'POST',
    body: JSON.stringify(input),
  });
export const deleteKnowledgeDocument = (id: string) =>
  call(`/backend/knowledge/documents/${id}`, { method: 'DELETE' });
export const reindexKnowledgeDocument = (id: string) =>
  call<{ version: number }>(`/backend/knowledge/documents/${id}/reindex`, {
    method: 'POST',
    body: '{}',
  });

export const searchKnowledge = (query: string, topK = 5) =>
  call<{ outcome: string; chunks: RetrievedChunk[]; error?: string }>(
    '/backend/knowledge/search',
    { method: 'POST', body: JSON.stringify({ query, topK }) },
  );

export interface AgentKnowledgeSource {
  id: string;
  name: string;
  readyDocs: number;
  pendingDocs: number;
  failedDocs: number;
}

export const listAgentKnowledge = (agentId: string) =>
  call<{ sources: AgentKnowledgeSource[] }>(
    `/backend/agents/${agentId}/knowledge`,
  );
export const attachAgentKnowledge = (agentId: string, sourceId: string) =>
  call(`/backend/agents/${agentId}/knowledge`, {
    method: 'POST',
    body: JSON.stringify({ sourceId }),
  });
export const detachAgentKnowledge = (agentId: string, sourceId: string) =>
  call(`/backend/agents/${agentId}/knowledge/${sourceId}`, { method: 'DELETE' });

// --- Tools and intelligence (Phase 4) ---------------------------------------

export interface Tool {
  id: string;
  name: string;
  description: string;
  inputSchema: unknown;
  outputSchema: unknown;
  /**
   * The permission the ACTING USER must hold for this tool to run. Shown so an
   * operator can see why a tool was refused. It is never sent to the model.
   */
  requiredPermission: string;
  enabled: boolean;
  version: number;
}

export interface ToolExecution {
  id: string;
  sessionId: string;
  toolName: string;
  callId: string;
  status: string;
  denialReason: string | null;
  durationMs: number | null;
  outputChars: number | null;
  createdAt: string;
}

export const listTools = () => call<{ tools: Tool[] }>('/backend/tools');
export const installBuiltInTools = () =>
  call<{ tools: Tool[] }>('/backend/tools/install-builtins', {
    method: 'POST',
    body: '{}',
  });
export const setToolEnabled = (toolId: string, enabled: boolean) =>
  call(`/backend/tools/${toolId}`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  });

export const listAgentTools = (agentId: string) =>
  call<{ tools: Tool[] }>(`/backend/agents/${agentId}/tools`);
export const grantAgentTool = (agentId: string, toolId: string) =>
  call(`/backend/agents/${agentId}/tools`, {
    method: 'POST',
    body: JSON.stringify({ toolId }),
  });
export const revokeAgentTool = (agentId: string, toolId: string) =>
  call(`/backend/agents/${agentId}/tools/${toolId}`, { method: 'DELETE' });

export const listToolExecutions = (sessionId: string) =>
  call<{ executions: ToolExecution[] }>(
    `/backend/sessions/${sessionId}/tool-executions`,
  );

// --- Voice sessions (browser demo + outbound phone) -------------------------

export interface VoiceDeployment {
  id: string;
  agentVersionId: string;
  provider: string;
  environment: string;
  externalAgentId: string;
  llmModel: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TranscriptTurn {
  role: 'agent' | 'user';
  message: string;
  timeInCallSecs?: number;
}

export interface VoiceSession {
  id: string;
  sessionId: string;
  deploymentId: string;
  provider: string;
  externalConversationId: string | null;
  status: 'pending' | 'active' | 'ended' | 'failed';
  transcript: TranscriptTurn[] | null;
  summary: string | null;
  structuredAnswers: Record<string, unknown> | null;
  durationSeconds: number | null;
  costCredits: number | null;
  startedAt: string;
  endedAt: string | null;
  jobId?: string | null;
  candidateId?: string | null;
  agentId?: string | null;
  agentName?: string | null;
  jobTitle?: string | null;
  candidateName?: string | null;
  channel?: string | null;
  /**
   * Why a call didn't connect, when known (newer backends): 'no_answer' | 'busy' | 'voicemail' |
   * 'line_not_connected' | 'invalid_number' | 'carrier_blocked' | 'network' | 'unknown' | null
   * (backend contract; never provider text). Words via callStateKey + STATE_MAP.call.
   */
  failureReason?: string | null;
}

/** Provision / re-sync the voice provider agent for the current published version. */
export const provisionVoiceDeployment = (
  agentId: string,
  input: { voiceId?: string } = {},
) =>
  call<{ deployment: VoiceDeployment }>(
    `/backend/agents/${agentId}/voice-deployments`,
    { method: 'POST', body: JSON.stringify(input) },
  );

/**
 * Start a test voice session.
 * Returns the conversationToken for the voice SDK integration layer.
 * Optional jobId/candidateId link the session to a hiring assignment.
 */
export const startVoiceSession = (
  agentId: string,
  options?: { jobId?: string; candidateId?: string },
) =>
  call<{ voiceSessionId: string; conversationToken: string; voiceSession: VoiceSession }>(
    `/backend/agents/${agentId}/voice-sessions`,
    {
      method: 'POST',
      body: JSON.stringify(options ?? {}),
    },
  );

/** Get the current state of a voice session (no token returned). */
export const getVoiceSession = (agentId: string, voiceSessionId: string) =>
  call<{ voiceSession: VoiceSession }>(
    `/backend/agents/${agentId}/voice-sessions/${voiceSessionId}`,
  );

/** Pull the latest result from the provider. */
export const reconcileVoiceSession = (agentId: string, voiceSessionId: string) =>
  call<{ voiceSession: VoiceSession }>(
    `/backend/agents/${agentId}/voice-sessions/${voiceSessionId}/reconcile`,
    { method: 'POST', body: '{}' },
  );

/** End an active voice session so another screen can start. */
export const endVoiceSession = (agentId: string, voiceSessionId: string) =>
  call<{ voiceSession: VoiceSession }>(
    `/backend/agents/${agentId}/voice-sessions/${voiceSessionId}/end`,
    { method: 'POST', body: '{}' },
  );

export const listVoiceSessions = (opts?: {
  candidateId?: string;
  jobId?: string;
}) => {
  const params = new URLSearchParams();
  if (opts?.candidateId?.trim()) {
    params.set('candidateId', opts.candidateId.trim());
  }
  if (opts?.jobId?.trim()) {
    params.set('jobId', opts.jobId.trim());
  }
  const q = params.toString() ? `?${params.toString()}` : '';
  return call<{ sessions: VoiceSession[] }>(`/backend/voice-sessions${q}`);
};

export const getTelephonyStatus = () =>
  call<{
    outboundPhone: boolean;
    browserDemo: boolean;
    /** Always false until carrier business verification unlocks any-resume dialing. */
    openOutbound: boolean;
    message: string;
  }>('/backend/telephony/status');

export const startOutboundCall = (jobId: string, candidateId: string) =>
  call<{
    voiceSessionId: string;
    voiceSession: { id: string; status: string };
  }>(`/backend/jobs/${jobId}/candidates/${candidateId}/outbound-call`, {
    method: 'POST',
    body: '{}',
  });

// --- Hiring desk (P1) ---------------------------------------------------------

export interface Job {
  id: string;
  title: string;
  description: string;
  status: string;
  agentId: string | null;
  screeningQuestions: { id: string; label: string }[];
  screeningLanguage: ScreeningLanguage;
  createdAt: string;
  updatedAt: string;
  /** Attached JD knowledge docs (file upload or saved text). Both backends always send it. */
  hasJdDocs: boolean;
  voiceEngine?: VoiceEngine;
  voicePersona?: VoicePersona;
  ttsModel?: TtsModel;
  /** What HR says the role needs; null when none are set. */
  requirements?: JobRequirements | null;
}

export type WorkMode = 'on_site' | 'hybrid' | 'remote';

/** The job's requirements sheet (apps/api/src/hiring/requirements.ts). All optional. */
export interface JobRequirements {
  salaryMinLakh: number | null;
  salaryMaxLakh: number | null;
  salaryFlexible: boolean;
  maxNoticeDays: number | null;
  workMode: WorkMode | null;
  officeDaysPerWeek: number | null;
  city: string | null;
  /** Up to 5 short lines. */
  mustHaves: string[];
  nightShiftRequired: boolean;
  replyWithinWorkingDays: number;
}

export type FitOverall = 'meets_all' | 'check' | 'doesnt_meet';
export type FitVerdict = 'met' | 'not_met' | 'unclear';
export type FitLane = FitOverall | 'not_screened';

/** One call checked against the job's requirements. Evidence is dropped without transcript access. */
export interface CallFit {
  overall: FitOverall;
  items: {
    requirement: string;
    label: string;
    verdict: FitVerdict;
    evidence?: string | null;
    atSeconds?: number | null;
  }[];
  flags: {
    kind: string;
    text: string;
    atSeconds?: number | null;
    requirement?: string | null;
  }[];
}

export type FitTotals = Record<FitLane, number>;

export const getJobRequirements = (jobId: string) =>
  call<{ requirements: JobRequirements | null }>(`/backend/jobs/${jobId}/requirements`);

export const saveJobRequirements = (jobId: string, requirements: JobRequirements | null) =>
  call<{ requirements: JobRequirements | null }>(`/backend/jobs/${jobId}/requirements`, {
    method: 'PUT',
    body: JSON.stringify({ requirements }),
  });

/** Drafted from the saved description; not saved. 409 when the assistant isn't set up. */
export const draftJobRequirements = (jobId: string) =>
  call<{ requirements: JobRequirements }>(`/backend/jobs/${jobId}/requirements/draft`, {
    method: 'POST',
    body: '{}',
  });

export interface OrganizationSettings {
  autoAdvanceMeetsAll: boolean;
}

export const getOrganizationSettings = () => call<OrganizationSettings>('/backend/organization/settings');

export const updateOrganizationSettings = (input: OrganizationSettings) =>
  call<OrganizationSettings>('/backend/organization/settings', {
    method: 'PUT',
    body: JSON.stringify(input),
  });

export interface JobKnowledgeSource {
  id: string;
  name: string;
  readyDocs: number;
  pendingDocs: number;
  failedDocs: number;
}

/** Candidate stage on a job. `declined` = "Not moving forward" (newer backends). */
export type CandidateStage = 'new' | 'screening' | 'reviewed' | 'declined';

export interface Candidate {
  id: string;
  jobId: string;
  fullName: string;
  source: string;
  screeningStatus?: string;
  countryCode?: string | null;
  createdAt: string;
  updatedAt: string;
  phone?: string | null;
  email?: string | null;
  resumeText?: string | null;
}

export interface JobCandidateAssignment {
  id: string;
  candidateId: string;
  status: string;
  /** Derived from latest phone voice session: not_called | calling | completed | failed */
  callStatus?: 'not_called' | 'calling' | 'completed' | 'failed';
  /** Why that call didn't connect, when the backend says (see VoiceSession.failureReason). */
  failureReason?: string | null;
  callReceived?: boolean;
  /** The latest call checked against the job's requirements; null when not scored. */
  fit?: CallFit | null;
  candidate: {
    id: string;
    fullName: string;
    source: string;
    phone?: string | null;
  };
}

export interface CandidateScreeningResults {
  voiceSessionId: string | null;
  status: string | null;
  transcript: readonly {
    role: string;
    message: string;
    timeInCallSecs?: number;
  }[] | null;
  summary: string | null;
  structuredAnswers: Record<string, unknown> | null;
  costCredits: number | null;
  recordingAvailable?: boolean;
  fitPercent?: number | null;
  startedAt?: string | null;
  durationSeconds?: number | null;
  /** Why the call didn't connect, when the backend says (see VoiceSession.failureReason). */
  failureReason?: string | null;
  fit?: CallFit | null;
}

export const listJobs = () => call<{ jobs: Job[] }>('/backend/jobs');

export const getJob = (id: string) => call<Job>(`/backend/jobs/${id}`);

export const createJob = (input: {
  title: string;
  description?: string;
  agentId?: string;
  mustAskQuestions?: string[];
  screeningLanguage?: ScreeningLanguage;
}) =>
  call<{ id: string }>('/backend/jobs', {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const updateJob = (
  id: string,
  input: {
    title?: string;
    description?: string;
    status?: 'draft' | 'open' | 'closed';
    agentId?: string | null;
    mustAskQuestions?: string[];
    screeningLanguage?: ScreeningLanguage;
  },
) =>
  call(`/backend/jobs/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });

export const listJobKnowledge = (jobId: string) =>
  call<{ sources: JobKnowledgeSource[] }>(`/backend/jobs/${jobId}/knowledge`);

export const attachJobKnowledge = (jobId: string, sourceId: string) =>
  call(`/backend/jobs/${jobId}/knowledge`, {
    method: 'POST',
    body: JSON.stringify({ sourceId }),
  });

export const assistJobDescription = (
  jobId: string,
  input: {
    mode: 'generate' | 'format' | 'questions';
    notes: string;
    title?: string;
  },
) =>
  call<{ jdText: string; questions?: string[] }>(
    `/backend/jobs/${jobId}/jd/assist`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );

export const saveJobDescriptionText = (jobId: string, text: string) =>
  call<{ sourceId: string; documentId: string }>(
    `/backend/jobs/${jobId}/jd/text`,
    {
      method: 'POST',
      body: JSON.stringify({ text }),
    },
  );

export const listJobCandidates = (
  jobId: string,
  opts?: {
    limit?: number;
    cursor?: string;
    status?: CandidateStage;
    q?: string;
    fit?: FitLane;
  },
) => {
  const params = new URLSearchParams();
  if (opts?.fit) params.set('fit', opts.fit);
  if (opts?.limit != null) params.set('limit', String(opts.limit));
  if (opts?.cursor) params.set('cursor', opts.cursor);
  if (opts?.status) params.set('status', opts.status);
  if (opts?.q?.trim()) params.set('q', opts.q.trim());
  const qs = params.toString();
  return call<{
    candidates: JobCandidateAssignment[];
    nextCursor: string | null;
    totals: {
      all: number;
      new: number;
      screening: number;
      reviewed: number;
      /** Newer backends. */
      declined?: number;
    };
    /** Newer backends. */
    fitTotals?: FitTotals;
  }>(`/backend/jobs/${jobId}/candidates${qs ? `?${qs}` : ''}`);
};

/**
 * GET /jobs/:jobId/candidates/:candidateId → one row, same shape as a listJobCandidates row,
 * so `?c=` deep links work past the first page. 404 ApiClientError when the person isn't on
 * this job. Optional: NotAvailableError on older backends.
 */
export const getJobCandidate = (jobId: string, candidateId: string) =>
  call<JobCandidateAssignment>(`/backend/jobs/${jobId}/candidates/${candidateId}`, undefined, OPTIONAL);

export interface HiringQueueItem {
  jobId: string;
  jobTitle: string;
  candidateId: string;
  fullName: string;
  stage: CandidateStage;
  callStatus: NonNullable<JobCandidateAssignment['callStatus']>;
  /** For didn't-connect rows; see VoiceSession.failureReason. */
  failureReason?: string | null;
  lastCallAt?: string | null;
  fit?: CallFit | null;
}

/** Home queues: `total` is the true count, `items` the first few rows. */
export interface HiringSummary {
  /** `agents` is null for someone who can't read agents. */
  counts: { agents: number | null; openJobs: number; candidates: number };
  /** Jobs in any status. Older backends don't send it. */
  totals?: { jobs: number };
  /** Every job with where its people stand (`funnel` null: no permission to read candidates). */
  jobs?: {
    jobId: string;
    jobTitle: string;
    jobStatus: string;
    funnel: { total: number; notCalled: number; toReview: number; onHold: number; movedForward: number } | null;
  }[];
  queues: Record<
    'readyForReview' | 'notConnected' | 'notCalled' | 'onHold',
    { total: number; items: HiringQueueItem[] }
  >;
}

/**
 * GET /hiring/summary → HiringSummary, in one request instead of one per job (audit H8).
 * apps/api serves it (hiring/summary.ts). Optional: NotAvailableError on older backends; load per job.
 */
export const getHiringSummary = () => call<HiringSummary>('/backend/hiring/summary', undefined, OPTIONAL);

export type CandidateImportIssue =
  | 'missing_full_name'
  | 'missing_country_code'
  | 'missing_phone'
  | 'invalid_phone'
  | 'invalid_email'
  | 'duplicate_in_batch'
  | 'duplicate_on_job';

export type CandidateImportRow = {
  rowIndex: number;
  fullName: string | null;
  countryCode: string | null;
  phone: string | null;
  email: string | null;
  raw: Record<string, string>;
  issues: CandidateImportIssue[];
  valid: boolean;
};

export const previewCandidateImport = (jobId: string, csvText: string) =>
  call<{
    rows: CandidateImportRow[];
    summary: { total: number; valid: number; invalid: number };
  }>(`/backend/jobs/${jobId}/candidates/import/preview`, {
    method: 'POST',
    body: JSON.stringify({ csvText }),
  });

export const confirmCandidateImport = (
  jobId: string,
  rows: {
    fullName: string;
    countryCode: string;
    phone: string;
    email?: string;
  }[],
) =>
  call<{
    created: { id: string; fullName: string; phone: string }[];
    skipped: number;
    rejected: { fullName: string; phone: string; issues: string[] }[];
  }>(`/backend/jobs/${jobId}/candidates/import/confirm`, {
    method: 'POST',
    body: JSON.stringify({ rows }),
  });

export const assignCandidateToJob = (_jobId: string, _candidateId: string) =>
  Promise.reject(
    new ApiClientError(422, {
      code: 'validation_failed',
      message:
        'Assigning from a directory is no longer supported. Add the candidate under this job.',
    }),
  );

export const updateJobCandidateStatus = (
  jobId: string,
  candidateId: string,
  status: CandidateStage,
) =>
  call<{ updated: true; previous: string; status: string }>(
    `/backend/jobs/${jobId}/candidates/${candidateId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    },
  );

export const bulkUpdateJobCandidateStatus = (
  jobId: string,
  updates: readonly {
    candidateId: string;
    status: CandidateStage;
  }[],
  reason?: string,
) =>
  call<{
    updated: number;
    results: readonly {
      candidateId: string;
      previous: string;
      status: string;
    }[];
  }>(`/backend/jobs/${jobId}/candidates/bulk-status`, {
    method: 'POST',
    body: JSON.stringify({
      updates,
      ...(reason?.trim() ? { reason: reason.trim() } : {}),
    }),
  });

export interface CandidateStageHistoryEvent {
  id: string;
  previous: string | null;
  status: string | null;
  reason?: string | null;
  /** The system made the change (auto-advance), not a person. */
  automatic?: boolean;
  actorUserId: string | null;
  actorName?: string | null;
  createdAt: string;
}

export const listCandidateStageHistory = (
  jobId: string,
  candidateId: string,
) =>
  call<{ events: CandidateStageHistoryEvent[] }>(
    `/backend/jobs/${jobId}/candidates/${candidateId}/stage-history`,
  );

export const getJobCandidateResults = (jobId: string, candidateId: string) =>
  call<{ results: CandidateScreeningResults; sessions: CandidateScreeningResults[] }>(
    `/backend/jobs/${jobId}/candidates/${candidateId}/results`,
  );

/** Ask about a candidate's screens using stored call facts only. */
export const askJobCandidateReview = (
  jobId: string,
  candidateId: string,
  input: { message: string; voiceSessionId?: string },
) =>
  call<{ reply: string; voiceSessionId: string | null }>(
    `/backend/jobs/${jobId}/candidates/${candidateId}/review-chat`,
    { method: 'POST', body: JSON.stringify(input) },
  );

export type ReviewChatStreamEvent =
  | { type: 'meta'; voiceSessionId: string }
  | { type: 'delta'; text: string }
  | { type: 'done'; reply: string; voiceSessionId: string | null };

/**
 * Streaming ask — calls onEvent for each SSE frame so the reply can paint live.
 */
export async function askJobCandidateReviewStream(
  jobId: string,
  candidateId: string,
  input: { message: string; voiceSessionId?: string },
  onEvent: (event: ReviewChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<{ reply: string; voiceSessionId: string | null }> {
  const path = `/backend/jobs/${jobId}/candidates/${candidateId}/review-chat/stream`;
  const response = await send(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok) throw await failureOf(response, path);
  if (!response.body) {
    throw new ApiClientError(502, { code: 'empty_stream', message: '' });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalReply = '';
  let finalSession: string | null = null;

  const handleFrame = (frame: string) => {
    const payload = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(line.startsWith('data: ') ? 6 : 5))
      .join('\n');
    if (!payload.trim()) return;
    let event: ReviewChatStreamEvent;
    try {
      event = JSON.parse(payload) as ReviewChatStreamEvent;
    } catch {
      return;
    }
    onEvent(event);
    if (event.type === 'done') {
      finalReply = event.reply;
      finalSession = event.voiceSessionId;
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n|\r/g, '\n');
      for (;;) {
        const split = buffer.indexOf('\n\n');
        if (split === -1) break;
        handleFrame(buffer.slice(0, split));
        buffer = buffer.slice(split + 2);
      }
      if (done) {
        if (buffer.trim()) handleFrame(buffer);
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { reply: finalReply, voiceSessionId: finalSession };
}

/** Authenticated recording URL for an ended voice session (stream in <audio>). */
export const voiceSessionRecordingUrl = (agentId: string, voiceSessionId: string) =>
  `/backend/agents/${agentId}/voice-sessions/${voiceSessionId}/recording`;

export interface AuditEventRow {
  id: string;
  actorUserId: string | null;
  actorName: string | null;
  eventType: string;
  resourceType: string | null;
  resourceId: string | null;
  subjectName?: string | null;
  jobTitle?: string | null;
  metadata: unknown;
  createdAt: string;
}

export const listAuditEvents = (opts?: {
  limit?: number;
  cursor?: string;
  eventType?: string;
  from?: string;
  to?: string;
}) => {
  const params = new URLSearchParams();
  if (opts?.limit != null) params.set('limit', String(opts.limit));
  if (opts?.cursor) params.set('cursor', opts.cursor);
  if (opts?.eventType) params.set('eventType', opts.eventType);
  if (opts?.from) params.set('from', opts.from);
  if (opts?.to) params.set('to', opts.to);
  const qs = params.toString();
  return call<{ events: AuditEventRow[]; nextCursor: string | null }>(
    `/backend/audit${qs ? `?${qs}` : ''}`,
  );
};

export const recordAuditExport = (input: {
  kind: 'all' | 'stage';
  count: number;
}) =>
  call<{ recorded: true }>('/backend/audit/exports', {
    method: 'POST',
    body: JSON.stringify(input),
  });

/** POST body for server-streamed CSV download (up to ~100k rows). */
export async function downloadAuditExportCsv(opts: {
  kind: 'all' | 'stage';
  from?: string;
  to?: string;
}): Promise<{ blob: Blob; truncated: boolean; count: number }> {
  const path = '/backend/audit/export.csv';
  const res = await send(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: opts.kind,
      ...(opts.from ? { from: opts.from } : {}),
      ...(opts.to ? { to: opts.to } : {}),
    }),
  });
  if (!res.ok) throw await failureOf(res, path);
  const text = await res.text();
  const metaMatch = text.match(
    /# export_meta count=(\d+) truncated=(true|false)\s*$/,
  );
  const count = metaMatch ? Number(metaMatch[1]) : 0;
  const truncated = metaMatch?.[2] === 'true';
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  return { blob, truncated, count };
}

/** @deprecated Prefer downloadAuditExportCsv (POST). */
export function auditExportCsvUrl(opts: {
  kind: 'all' | 'stage';
  from?: string;
  to?: string;
}): string {
  const params = new URLSearchParams();
  params.set('kind', opts.kind);
  if (opts.from) params.set('from', opts.from);
  if (opts.to) params.set('to', opts.to);
  return `/backend/audit/export.csv?${params.toString()}`;
}

export const listCandidates = (jobId: string) =>
  call<{ candidates: Candidate[] }>(
    `/backend/candidates?jobId=${encodeURIComponent(jobId)}`,
  );

export const getCandidate = (id: string) =>
  call<Candidate>(`/backend/candidates/${id}`);

export const createCandidate = (input: {
  jobId: string;
  fullName: string;
  phone?: string;
  countryCode?: string;
  email?: string;
  resumeText?: string;
  resumeFile?: {
    name: string;
    contentType: string;
    content: string;
    contentEncoding: 'base64';
  };
}) =>
  call<{ id: string; phone: string | null; phoneFromResume: boolean }>(
    '/backend/candidates',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );

export const updateCandidate = (
  id: string,
  input: {
    fullName?: string;
    phone?: string | null;
    email?: string | null;
    resumeText?: string | null;
  },
) =>
  call(`/backend/candidates/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });

export const deleteCandidate = (id: string) =>
  call<{ deleted: boolean }>(`/backend/candidates/${id}`, { method: 'DELETE' });

export const exportCandidate = (id: string) =>
  call<{ exportedAt: string; candidate: Candidate }>(
    `/backend/candidates/${id}/export`,
  );
