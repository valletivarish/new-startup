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

export const listAgentKnowledge = (agentId: string) =>
  call<{ sources: { id: string; name: string }[] }>(
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

// --- Voice sessions (MVP-01 ElevenLabs) -------------------------------------

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
}

/** Provision / re-sync an ElevenLabs agent for the current published version. */
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

// --- Hiring desk (P1) ---------------------------------------------------------

export interface Job {
  id: string;
  title: string;
  description: string;
  status: string;
  agentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Candidate {
  id: string;
  fullName: string;
  source: string;
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
  candidate: {
    id: string;
    fullName: string;
    source: string;
  };
}

export interface CandidateScreeningResults {
  voiceSessionId: string | null;
  status: string | null;
  transcript: readonly { role: string; message: string }[] | null;
  summary: string | null;
  structuredAnswers: Record<string, unknown> | null;
  costCredits: number | null;
}

export const listJobs = () => call<{ jobs: Job[] }>('/backend/jobs');

export const getJob = (id: string) => call<Job>(`/backend/jobs/${id}`);

export const createJob = (input: {
  title: string;
  description?: string;
  agentId?: string;
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
  },
) =>
  call(`/backend/jobs/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });

export const listJobCandidates = (jobId: string) =>
  call<{ candidates: JobCandidateAssignment[] }>(
    `/backend/jobs/${jobId}/candidates`,
  );

export const assignCandidateToJob = (jobId: string, candidateId: string) =>
  call<{ id: string }>(`/backend/jobs/${jobId}/candidates`, {
    method: 'POST',
    body: JSON.stringify({ candidateId }),
  });

export const updateJobCandidateStatus = (
  jobId: string,
  candidateId: string,
  status: 'new' | 'screening' | 'reviewed',
) =>
  call(`/backend/jobs/${jobId}/candidates/${candidateId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });

export const getJobCandidateResults = (jobId: string, candidateId: string) =>
  call<{ results: CandidateScreeningResults }>(
    `/backend/jobs/${jobId}/candidates/${candidateId}/results`,
  );

export const listCandidates = () =>
  call<{ candidates: Candidate[] }>('/backend/candidates');

export const getCandidate = (id: string) =>
  call<Candidate>(`/backend/candidates/${id}`);

export const createCandidate = (input: {
  fullName: string;
  phone?: string;
  email?: string;
  resumeText?: string;
}) =>
  call<{ id: string }>('/backend/candidates', {
    method: 'POST',
    body: JSON.stringify(input),
  });

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
