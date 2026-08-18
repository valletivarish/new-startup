/**
 * Provider abstraction layer — interfaces only.
 *
 * This package has NO runtime dependencies and NO provider SDKs, by design.
 * A test asserts that its dependency list stays empty.
 */

export type {
  AgentSession,
  InboundEvent,
  OutboundEvent,
  SessionEndReason,
} from './agent-session.js';

export type {
  CalendarProvider,
  CRMProvider,
  EmbeddingProvider,
  KnowledgeChunkRef,
  KnowledgeStore,
  LLMChunk,
  LLMMessage,
  LLMProvider,
  LLMRequest,
  LLMResult,
  LLMToolDefinition,
  NotificationProvider,
  SpeechToTextProvider,
  TelephonyCall,
  TelephonyProvider,
  TextToSpeechProvider,
  UsageRecord,
  VoicePipeline,
} from './interfaces.js';

export type {
  AgentContext,
  AgentRuntime,
  AgentRuntimeResult,
  ConversationState,
  ExecutionStrategy,
  InboundRuntimeEvent,
  MemoryProvider,
  RuntimeDecision,
  RuntimeEvent,
  StrategyInput,
  ToolDefinition,
  ToolExecutionRequest,
  ToolExecutionResult,
  ToolExecutor,
  ToolRegistry,
} from './runtime.js';

export type {
  Chunker,
  ChunkInput,
  KnowledgeRetriever,
  ObjectStorage,
  RetrievalContext,
  RetrievalOptions,
  RetrievalOutcome,
  RetrievalResult,
  RetrievedChunk,
  StoredObject,
  TextChunk,
} from './knowledge.js';
