/** Zod shapes for the public /v1 API (requests and responses); reused by OpenAPI. */

import { z } from 'zod';

const Language = z.enum(['en', 'hi']);

export const V1JobCreate = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20_000).optional(),
  mustAskQuestions: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
  language: Language.optional(),
});

export const V1JobPatch = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(20_000).optional(),
  mustAskQuestions: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
  language: Language.optional(),
  status: z.enum(['draft', 'open', 'closed']).optional(),
});

export const V1CandidateCreate = z.object({
  fullName: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(1).max(30).optional(),
  countryCode: z.string().trim().min(1).max(8).default('+91'),
  email: z.string().trim().email().max(320).optional(),
  resumeText: z.string().max(100_000).optional(),
  externalId: z.string().trim().min(1).max(200).optional(),
  consent: z.literal(true),
});

export const V1CandidateBatch = z.object({
  candidates: z.array(V1CandidateCreate).min(1).max(100),
});

export const V1Job = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  status: z.string(),
  language: Language,
  questions: z.array(z.object({ id: z.string(), text: z.string() })),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const V1Candidate = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  externalId: z.string().nullable(),
  fullName: z.string(),
  phone: z.string().nullable(),
  countryCode: z.string().nullable(),
  email: z.string().nullable(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type V1Job = z.infer<typeof V1Job>;
export type V1Candidate = z.infer<typeof V1Candidate>;

// ---- Shapes below exist for the OpenAPI document; controllers keep their own runtime parsing. ----

export const V1Error = z.object({
  code: z.enum([
    'unauthorized', 'forbidden', 'not_found', 'conflict', 'link_phone_conflict', 'gone',
    'validation_failed', 'consent_required', 'agent_required', 'idempotency_in_progress',
    'delivery_in_progress', 'rate_limited', 'call_limit_reached', 'test_call_limit_reached',
    'service_unavailable', 'internal',
  ]),
  message: z.string(),
  request_id: z.string(),
  errors: z.array(z.object({ field: z.string(), message: z.string() })).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const V1Result = z.object({
  status: z.string(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  durationSeconds: z.number().nullable(),
  answers: z.array(z.object({ questionId: z.string(), question: z.string(), answer: z.unknown() })),
  summary: z.string().nullable(),
  transcript: z.array(z.object({ role: z.string().optional(), message: z.string().optional() })).optional(),
  recordingUrl: z.string().optional(),
  failureReason: z.string().optional(),
});

export const V1Call = z.object({
  id: z.string().uuid(),
  status: z.string(),
  reason: z.string().nullable(),
  notBefore: z.string().nullable(),
  candidateId: z.string().uuid(),
  jobId: z.string().uuid(),
  result: V1Result.nullable(),
});

export const V1Usage = z.object({
  month: z.string(),
  callsPlaced: z.number().int(),
  completedScreens: z.number().int(),
  pricePerScreenInr: z.number().nullable(),
  amountInr: z.number().nullable(),
});

export const V1WebhookEventType = z.enum(['call.completed', 'call.failed']);

/** Shared by the controller (runtime) and OpenAPI (input side); events are de-duplicated. */
export const V1WebhookEndpointCreate = z.object({
  url: z.string().trim().min(1).max(2000),
  events: z.array(V1WebhookEventType).min(1).transform((e) => [...new Set(e)]),
});

export const V1CandidateCreated = V1Candidate.extend({ created: z.boolean() });
export const V1CandidateBatchCreated = z.object({ candidates: z.array(V1CandidateCreated) });

export const V1WebhookEndpoint = z.object({
  id: z.string().uuid(),
  url: z.string(),
  events: z.array(V1WebhookEventType),
  createdAt: z.string(),
});

export const V1WebhookEndpointCreated = z.object({
  id: z.string().uuid(),
  secret: z.string().describe('whsec_ + 32 base62 characters. Returned only here.'),
});

export const V1WebhookDelivery = z.object({
  id: z.string().uuid(),
  endpointId: z.string().uuid(),
  event: V1WebhookEventType,
  status: z.enum(['pending', 'delivered', 'failed']),
  attempts: z.number().int(),
  lastStatusCode: z.number().int().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  deliveredAt: z.string().nullable(),
});

export const V1WebhookEvent = z.object({
  id: z.string(),
  type: V1WebhookEventType,
  createdAt: z.string(),
  data: z.object({
    callId: z.string(),
    jobId: z.string().uuid(),
    candidateId: z.string().uuid(),
    externalId: z.string().nullable(),
    isTest: z.boolean(),
    result: V1Result,
  }),
});

export const V1CandidateLinkCreate = z.object({
  candidateId: z.string().uuid().optional(),
  fullName: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().email().max(320).optional(),
});

export const V1CandidateLinkSubmit = z.object({
  fullName: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(1).max(30),
  countryCode: z.string().trim().min(1).max(8).default('+91'),
  when: z.union([z.literal('now'), z.string().datetime({ offset: true })]),
  consent: z.literal(true),
});
