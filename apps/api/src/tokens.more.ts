/** Split from tokens.ts to avoid a circular import with controllers. */
export const SESSION_SERVICE = Symbol('SESSION_SERVICE');

export const AGENTS_SERVICE = Symbol('AGENTS_SERVICE');
export const SESSIONS_SERVICE = Symbol('SESSIONS_SERVICE');
export const AGENT_RUNTIME = Symbol('AGENT_RUNTIME');

export const KNOWLEDGE_SERVICE = Symbol('KNOWLEDGE_SERVICE');
export const KNOWLEDGE_RETRIEVER = Symbol('KNOWLEDGE_RETRIEVER');
export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');
