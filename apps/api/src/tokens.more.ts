/** Split from tokens.ts to avoid a circular import with controllers. */
export const SESSION_SERVICE = Symbol('SESSION_SERVICE');

export const AGENTS_SERVICE = Symbol('AGENTS_SERVICE');
export const SESSIONS_SERVICE = Symbol('SESSIONS_SERVICE');
export const AGENT_RUNTIME = Symbol('AGENT_RUNTIME');

export const KNOWLEDGE_SERVICE = Symbol('KNOWLEDGE_SERVICE');
export const KNOWLEDGE_RETRIEVER = Symbol('KNOWLEDGE_RETRIEVER');
export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

export const TOOL_REGISTRY = Symbol('TOOL_REGISTRY');
export const TOOL_EXECUTOR = Symbol('TOOL_EXECUTOR');
export const TOOLS_SERVICE = Symbol('TOOLS_SERVICE');
export const INTELLIGENCE_PROVIDER = Symbol('INTELLIGENCE_PROVIDER');
export const INTELLIGENCE_ORCHESTRATOR = Symbol('INTELLIGENCE_ORCHESTRATOR');

/** MVP-01 ElevenLabs browser-voice */
export const VOICE_SESSION_ADAPTER = Symbol('VOICE_SESSION_ADAPTER');
export const VOICE_SESSION_SERVICE = Symbol('VOICE_SESSION_SERVICE');

export const JOBS_SERVICE = Symbol('JOBS_SERVICE');
export const CANDIDATES_SERVICE = Symbol('CANDIDATES_SERVICE');

/** Call cost ledger + platform-admin cost dashboard. */
export const COST_SERVICE = Symbol('COST_SERVICE');

/** Own voice loop (apps/voice ↔ Nest). */
export const OWN_LOOP_SERVICE = Symbol('OWN_LOOP_SERVICE');

/** Company API keys (client integrations). */
export const API_KEYS_SERVICE = Symbol('API_KEYS_SERVICE');

/** Queued /v1 call requests. */
export const CALL_REQUESTS_SERVICE = Symbol('CALL_REQUESTS_SERVICE');
