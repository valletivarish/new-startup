/**
 * Thin API client. All requests are same-origin (Next rewrites proxy to the
 * backend), so the httpOnly session cookie travels automatically. The client
 * never sees or stores a token — sessions are opaque and server-side
 * (ADR-002).
 */

export interface ApiFailure {
  readonly code: string;
  readonly message: string;
  readonly request_id?: string;
  readonly errors?: readonly { field: string; message: string }[];
}

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId: string | null;
  constructor(status: number, failure: ApiFailure) {
    const fieldMessage = failure.errors?.[0]?.message?.trim();
    const top = failure.message?.trim() || 'Request failed';
    const message =
      fieldMessage &&
      (top === 'Validation failed' || top === 'Request failed' || !failure.message)
        ? fieldMessage
        : top;
    super(message);
    this.status = status;
    this.code = failure.code;
    this.requestId = failure.request_id ?? null;
  }
}

/** User-facing notice; includes Support ID on server errors for ops correlation. */
export function formatApiError(error: unknown, fallback: string): string {
  if (!(error instanceof ApiClientError)) return fallback;
  if (error.status >= 500 && error.requestId) {
    return `${error.message} (Support ID: ${error.requestId})`;
  }
  return error.message || fallback;
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

export const requestPasswordReset = async (email: string, redirectTo: string) => {
  await call<{ status: boolean; message: string }>('/api/auth/request-password-reset', {
    method: 'POST',
    body: JSON.stringify({ email, redirectTo }),
  });
  try {
    const link = await call<{ url: string }>('/backend/auth/password-reset/console-link', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    return { status: true as const, consoleResetUrl: link.url };
  } catch {
    return { status: true as const, consoleResetUrl: null as string | null };
  }
};

export const resetPassword = (newPassword: string, token: string) =>
  call<{ status: boolean }>('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ newPassword, token }),
  });

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

/** Idempotent: create a company if the user has none, else activate the existing one. */
export const ensureOrganization = (name: string) =>
  call<{ id: string; slug: string; created: boolean }>('/backend/organizations/ensure', {
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

/** Attach a different role to a member (invalidates their sessions in this company). */
export const changeMemberRole = (membershipId: string, roleKey: string) =>
  call<{ updated: true }>(`/backend/organization/members/${membershipId}/role`, {
    method: 'PATCH',
    body: JSON.stringify({ roleKey }),
  });

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
  call<{ id: string; acceptUrl: string }>('/backend/organization/invitations', {
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

export const listVoiceSessions = (opts?: { candidateId?: string }) => {
  const q =
    opts?.candidateId != null && opts.candidateId.trim()
      ? `?candidateId=${encodeURIComponent(opts.candidateId.trim())}`
      : '';
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
  screeningLanguage: 'en' | 'hi';
  createdAt: string;
  updatedAt: string;
  /** Attached JD knowledge docs (file upload or saved text). */
  hasJdDocs?: boolean;
}

export interface JobKnowledgeSource {
  id: string;
  name: string;
  readyDocs: number;
  pendingDocs: number;
  failedDocs: number;
}

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
  callReceived?: boolean;
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
}

export const listJobs = () => call<{ jobs: Job[] }>('/backend/jobs');

export const getJob = (id: string) => call<Job>(`/backend/jobs/${id}`);

export const createJob = (input: {
  title: string;
  description?: string;
  agentId?: string;
  mustAskQuestions?: string[];
  screeningLanguage?: 'en' | 'hi';
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
    screeningLanguage?: 'en' | 'hi';
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
    status?: 'new' | 'screening' | 'reviewed';
    q?: string;
  },
) => {
  const params = new URLSearchParams();
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
    };
  }>(`/backend/jobs/${jobId}/candidates${qs ? `?${qs}` : ''}`);
};

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
  status: 'new' | 'screening' | 'reviewed',
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
    status: 'new' | 'screening' | 'reviewed';
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
  const response = await fetch(
    `/backend/jobs/${jobId}/candidates/${candidateId}/review-chat/stream`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(input),
      signal,
    },
  );
  if (!response.ok) {
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    throw new ApiClientError(
      response.status,
      (body ?? { code: 'internal', message: 'Request failed' }) as ApiFailure,
    );
  }
  if (!response.body) {
    throw new ApiClientError(502, {
      code: 'internal',
      message: 'Empty stream from review chat.',
    });
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
  const res = await fetch('/backend/audit/export.csv', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: opts.kind,
      ...(opts.from ? { from: opts.from } : {}),
      ...(opts.to ? { to: opts.to } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiClientError(res.status, {
      code: 'export_failed',
      message: text.slice(0, 200) || `Export failed (${res.status})`,
    });
  }
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
