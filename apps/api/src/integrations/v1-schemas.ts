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
