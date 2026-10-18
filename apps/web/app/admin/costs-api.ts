/**
 * Platform-owner cost dashboard client. Lives under app/admin because naming
 * the vendors we pay is its whole purpose, and only platform admins
 * (PLATFORM_ADMIN_EMAILS) ever reach it.
 */

import { call } from '@/lib/api';

export type VoiceEngine = 'elevenlabs_agent' | 'own_loop_elevenlabs_voice' | 'own_loop_sarvam_voice';
export const ENGINE_LABEL: Record<VoiceEngine, string> = {
  elevenlabs_agent: 'ElevenLabs agent (baseline)',
  own_loop_elevenlabs_voice: 'Our loop + ElevenLabs voice',
  own_loop_sarvam_voice: 'Our loop + Sarvam voice',
};
export interface CostServiceRow {
  key: string;
  name: string;
  vendor: string;
  usedFor: string;
  billing: 'per_minute' | 'per_1k_chars' | 'per_1m_tokens_in' | 'per_1m_tokens_out' | 'per_credit' | 'monthly_fixed';
  rateInr: number;
  status: 'in_use' | 'testing' | 'off';
  notes: string | null;
  updatedAt: string;
}
export interface CostArm {
  engine: VoiceEngine;
  calls: number;
  completedScreens: number;
  minutes: number;
  totalInr: number;
  costPerMinute: number | null;
  costPerCompletedScreen: number | null;
  medianResponseMs: number | null;
  completionRate: number | null;
  avgRating: number | null;
  ratedCalls: number;
}
export interface CostSummary {
  monthStart: string;
  services: { key: string; name: string; vendor: string; status: string; billing: string; spendInr: number }[];
  usageTotalInr: number;
  fixedTotalInr: number;
  arms: CostArm[];
}
export interface CostCall {
  voiceSessionId: string;
  organizationName: string;
  engine: VoiceEngine | null;
  outcome: string;
  connectedSeconds: number | null;
  telephonyCost: number | null;
  sttCost: number | null;
  llmCost: number | null;
  ttsCost: number | null;
  agentCost: number | null;
  totalCost: number | null;
  telephonyBilled: boolean;
  responseP50Ms: number | null;
  interruptions: number | null;
  qualityRating: number | null;
  qualityNote: string | null;
  createdAt: string;
}
export const getCostSummary = (month?: string) =>
  call<{ summary: CostSummary }>(`/backend/admin/costs/summary${month ? `?month=${month}` : ''}`);
export const listCostServices = () => call<{ services: CostServiceRow[] }>('/backend/admin/costs/services');
export const updateCostService = (
  key: string,
  patch: { rateInr?: number; status?: CostServiceRow['status']; notes?: string | null },
) =>
  call<{ service: CostServiceRow }>(`/backend/admin/costs/services/${encodeURIComponent(key)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
/** Platform admin only: which voice engine phones this job's candidates. */
export const setJobEngine = (jobId: string, engine: VoiceEngine) =>
  call<{ ok: true; engine: VoiceEngine }>(`/backend/admin/costs/jobs/${jobId}/engine`, {
    method: 'POST',
    body: JSON.stringify({ engine }),
  });
export const listCostCalls = () => call<{ calls: CostCall[] }>('/backend/admin/costs/calls');
export const rateCostCall = (voiceSessionId: string, rating: number, note: string | null) =>
  call<{ ok: true }>(`/backend/admin/costs/calls/${voiceSessionId}/rating`, {
    method: 'POST',
    body: JSON.stringify({ rating, note }),
  });
