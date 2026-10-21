/**
 * Call cost ledger + platform-admin cost reporting.
 *
 * recordCallCost   one ledger row per voice session (idempotent upsert),
 *                  written under the session's own organization context.
 * admin*           cross-company reads/writes, ONLY under
 *                  withPlatformAdminContext after the caller's email was
 *                  checked against PLATFORM_ADMIN_EMAILS.
 */

import {
  sql,
  withPlatformAdminContext,
  withTenantContext,
  type Database,
  type TenantTransaction,
} from '@platform/db';
import type { Env } from '../config.js';
import { ApiError } from '../errors.js';
import { priceCall, type CallUsage, type Rates, type VoiceEngine } from './pricing.js';
import type { TtsModel, VoicePersona } from '../hiring/jobs.service.js';

const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000';

/** Usage + quality metrics reported by the own loop for one call. */
export interface LoopUsage {
  sttSeconds?: number | null;
  llmInputTokens?: number | null;
  llmOutputTokens?: number | null;
  ttsCharacters?: number | null;
  responseP50Ms?: number | null;
  responseP90Ms?: number | null;
  interruptions?: number | null;
}

export type CallOutcome =
  | 'completed'
  | 'short'
  | 'no_answer'
  | 'busy'
  | 'voicemail'
  | 'failed';

export interface CostService {
  isPlatformAdmin(email: string | null | undefined): boolean;
  recordCallCost(
    organizationId: string,
    voiceSessionId: string,
    extra?: { usage?: LoopUsage; telephonyBilledInr?: number | null },
  ): Promise<void>;
  adminListServices(userId: string): Promise<ServiceRow[]>;
  adminUpdateService(
    userId: string,
    key: string,
    patch: { rateInr?: number; status?: 'in_use' | 'testing' | 'off'; notes?: string | null },
  ): Promise<ServiceRow>;
  adminSummary(userId: string, monthStart: string): Promise<CostSummary>;
  adminListCalls(userId: string, limit: number): Promise<LedgerCall[]>;
  adminListOrganizations(userId: string): Promise<{ id: string; name: string }[]>;
  adminRateCall(userId: string, voiceSessionId: string, rating: number, note: string | null): Promise<void>;
  /** Pick a job's engine — in the admin's own active workspace (tenant RLS applies). */
  setJobEngine(
    organizationId: string,
    userId: string,
    jobId: string,
    engine: VoiceEngine,
    voice?: { persona?: VoicePersona; ttsModel?: TtsModel },
  ): Promise<void>;
}

export interface ServiceRow {
  key: string;
  name: string;
  vendor: string;
  usedFor: string;
  billing: string;
  rateInr: number;
  status: string;
  notes: string | null;
  updatedAt: string;
}

export interface ArmSummary {
  engine: string;
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
  arms: ArmSummary[];
}

export interface LedgerCall {
  voiceSessionId: string;
  organizationName: string;
  engine: string | null;
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

const num = (v: unknown): number | null =>
  v === null || v === undefined || v === '' ? null : Number(v);

/** A screen counts as completed when the candidate actually spoke and the call ran 20s+. */
export function callOutcome(row: {
  status: string;
  failure_reason: string | null;
  duration_seconds: number | null;
  transcript: unknown;
}): CallOutcome {
  if (row.failure_reason === 'no_answer') return 'no_answer';
  if (row.failure_reason === 'busy') return 'busy';
  if (row.failure_reason === 'voicemail') return 'voicemail';
  if (row.status === 'failed') return 'failed';
  const userSpoke =
    Array.isArray(row.transcript) &&
    row.transcript.some(
      (t) =>
        t &&
        typeof t === 'object' &&
        String((t as Record<string, unknown>)['role']) === 'user' &&
        String((t as Record<string, unknown>)['message'] ?? '').trim().length > 0,
    );
  return userSpoke && (row.duration_seconds ?? 0) >= 20 ? 'completed' : 'short';
}

async function loadRates(tx: TenantTransaction): Promise<Rates> {
  const rows = await tx.execute<{ key: string; rate_inr: string }>(sql`
    select key, rate_inr::text from cost_services
  `);
  return Object.fromEntries(rows.map((r) => [r.key, Number(r.rate_inr)]));
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

export function createCostService(database: Database, env: Env): CostService {
  const admins = new Set(
    env.PLATFORM_ADMIN_EMAILS.split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );

  const asAdmin = <T>(userId: string, fn: (tx: TenantTransaction) => Promise<T>) =>
    withPlatformAdminContext(database.db, userId, fn);

  return {
    isPlatformAdmin(email) {
      return Boolean(email) && admins.has(email!.trim().toLowerCase());
    },

    async recordCallCost(organizationId, voiceSessionId, extra = {}) {
      await withTenantContext(
        database.db,
        { organizationId, userId: SYSTEM_ACTOR_ID },
        async (tx) => {
          const rows = await tx.execute<{
            status: string;
            engine: VoiceEngine;
            failure_reason: string | null;
            duration_seconds: number | null;
            cost_credits: string | null;
            transcript: unknown;
            job_id: string | null;
            candidate_id: string | null;
            channel: string | null;
            is_test: boolean;
            tts_model: string | null;
          }>(sql`
            select vs.status, vs.engine, vs.failure_reason, vs.duration_seconds,
                   vs.cost_credits::text, vs.transcript, vs.job_id, vs.candidate_id,
                   s.channel, vs.is_test, vs.provision_snapshot->>'ttsModel' as tts_model
            from voice_sessions vs
            left join agent_sessions s on s.id = vs.session_id
            where vs.id = ${voiceSessionId} and vs.organization_id = ${organizationId}
          `);
          const vs = rows[0];
          if (!vs) return;

          const prevRows = await tx.execute<{
            stt_seconds: number | null;
            tts_characters: number | null;
            llm_input_tokens: string | null;
            llm_output_tokens: string | null;
            response_p50_ms: number | null;
            response_p90_ms: number | null;
            interruptions: number | null;
            telephony_cost: string | null;
            telephony_billed: boolean;
          }>(sql`
            select stt_seconds, tts_characters, llm_input_tokens::text, llm_output_tokens::text,
                   response_p50_ms, response_p90_ms, interruptions,
                   telephony_cost::text, telephony_billed
            from call_cost_ledger
            where voice_session_id = ${voiceSessionId} and organization_id = ${organizationId}
          `);
          const prev = prevRows[0];
          const u = extra.usage ?? {};
          const pick = <T>(a: T | null | undefined, b: T | null | undefined) =>
            a !== null && a !== undefined ? a : (b ?? null);

          const usage: CallUsage = {
            engine: vs.engine,
            callSeconds: vs.duration_seconds ?? 0,
            telephonyBilledInr: pick(
              extra.telephonyBilledInr,
              prev?.telephony_billed ? num(prev.telephony_cost) : null,
            ),
            sttSeconds: pick(u.sttSeconds, prev?.stt_seconds),
            llmInputTokens: pick(u.llmInputTokens, num(prev?.llm_input_tokens)),
            llmOutputTokens: pick(u.llmOutputTokens, num(prev?.llm_output_tokens)),
            ttsCharacters: pick(u.ttsCharacters, prev?.tts_characters),
            ttsModel: vs.tts_model,
            providerCredits: num(vs.cost_credits),
          };
          const rates = await loadRates(tx);
          const priced = priceCall(usage, rates);
          // Test-key calls are free: keep the usage, zero every cost.
          const price = vs.is_test
            ? { ...priced, telephony: 0, stt: 0, llm: 0, tts: 0, agent: 0, total: 0 }
            : priced;
          const outcome = callOutcome(vs);
          const rateCard = JSON.stringify(rates);

          await tx.execute(sql`
            insert into call_cost_ledger (
              organization_id, voice_session_id, use_case, channel, outcome, job_id, candidate_id,
              engine, connected_seconds, billed_telephony_seconds,
              stt_seconds, tts_characters, llm_input_tokens, llm_output_tokens,
              provider_reported_cost, provider_cost_unit,
              telephony_cost, stt_cost, tts_cost, llm_cost, agent_cost, total_cost,
              telephony_billed, response_p50_ms, response_p90_ms, interruptions, rate_card
            ) values (
              ${organizationId}, ${voiceSessionId}, 'hiring', ${vs.channel ?? 'phone'}, ${outcome},
              ${vs.job_id}, ${vs.candidate_id},
              ${vs.engine}, ${vs.duration_seconds}, ${Math.ceil((vs.duration_seconds ?? 0) / 60) * 60},
              ${usage.sttSeconds ?? null}, ${usage.ttsCharacters ?? null},
              ${usage.llmInputTokens ?? null}, ${usage.llmOutputTokens ?? null},
              ${usage.providerCredits ?? null}, ${usage.providerCredits !== null ? 'elevenlabs_credits' : null},
              ${price.telephony}, ${price.stt}, ${price.tts}, ${price.llm}, ${price.agent}, ${price.total},
              ${price.telephonyBilled},
              ${pick(u.responseP50Ms, prev?.response_p50_ms)},
              ${pick(u.responseP90Ms, prev?.response_p90_ms)},
              ${pick(u.interruptions, prev?.interruptions)},
              ${rateCard}
            )
            on conflict (voice_session_id) do update set
              outcome = excluded.outcome,
              engine = excluded.engine,
              connected_seconds = excluded.connected_seconds,
              billed_telephony_seconds = excluded.billed_telephony_seconds,
              stt_seconds = excluded.stt_seconds,
              tts_characters = excluded.tts_characters,
              llm_input_tokens = excluded.llm_input_tokens,
              llm_output_tokens = excluded.llm_output_tokens,
              provider_reported_cost = excluded.provider_reported_cost,
              provider_cost_unit = excluded.provider_cost_unit,
              telephony_cost = excluded.telephony_cost,
              stt_cost = excluded.stt_cost,
              tts_cost = excluded.tts_cost,
              llm_cost = excluded.llm_cost,
              agent_cost = excluded.agent_cost,
              total_cost = excluded.total_cost,
              telephony_billed = excluded.telephony_billed,
              response_p50_ms = excluded.response_p50_ms,
              response_p90_ms = excluded.response_p90_ms,
              interruptions = excluded.interruptions,
              rate_card = excluded.rate_card,
              updated_at = now()
          `);
        },
      );
    },

    async adminListServices(userId) {
      return asAdmin(userId, async (tx) => {
        const rows = await tx.execute<Record<string, string | null>>(sql`
          select key, name, vendor, used_for, billing, rate_inr::text, status, notes,
                 updated_at::text
          from cost_services
          order by billing = 'monthly_fixed', vendor, key
        `);
        return rows.map(toService);
      });
    },

    async adminUpdateService(userId, key, patch) {
      return asAdmin(userId, async (tx) => {
        const rows = await tx.execute<Record<string, string | null>>(sql`
          update cost_services set
            rate_inr = coalesce(${patch.rateInr ?? null}::numeric, rate_inr),
            status = coalesce(${patch.status ?? null}, status),
            notes = ${patch.notes === undefined ? sql`notes` : patch.notes},
            updated_at = now()
          where key = ${key}
          returning key, name, vendor, used_for, billing, rate_inr::text, status, notes,
                    updated_at::text
        `);
        if (!rows[0]) throw ApiError.notFound('Service');
        return toService(rows[0]);
      });
    },

    async adminSummary(userId, monthStart) {
      return asAdmin(userId, async (tx) => {
        const services = await tx.execute<Record<string, string | null>>(sql`
          select key, name, vendor, used_for, billing, rate_inr::text, status, notes,
                 updated_at::text
          from cost_services
        `);
        const sums = await tx.execute<Record<string, string | null>>(sql`
          select
            coalesce(sum(telephony_cost), 0)::text as telephony,
            coalesce(sum(stt_cost), 0)::text as stt,
            coalesce(sum(llm_cost), 0)::text as llm,
            coalesce(sum(tts_cost) filter (where engine = 'own_loop_elevenlabs_voice'), 0)::text as tts_el,
            coalesce(sum(tts_cost) filter (where engine = 'own_loop_sarvam_voice'), 0)::text as tts_sarvam,
            -- ponytail: Gemini Flash voice spend is summed under google_tts too (the ledger
            -- has no model column); add one if both models carry real traffic.
            coalesce(sum(tts_cost) filter (where engine = 'own_loop_google_voice'), 0)::text as tts_google,
            coalesce(sum(agent_cost), 0)::text as agent
          from call_cost_ledger
          where created_at >= ${monthStart}::date
            and created_at < (${monthStart}::date + interval '1 month')
        `);
        const s = sums[0] ?? {};
        const usageByKey: Record<string, number> = {
          exotel_minute: Number(s['telephony'] ?? 0),
          deepgram_stt: Number(s['stt'] ?? 0),
          gemini_input: Number(s['llm'] ?? 0),
          elevenlabs_tts: Number(s['tts_el'] ?? 0),
          sarvam_tts: Number(s['tts_sarvam'] ?? 0),
          google_tts: Number(s['tts_google'] ?? 0),
          elevenlabs_agent: Number(s['agent'] ?? 0),
        };
        const serviceRows = services
          .map(toService)
          .filter((svc) => svc.key !== 'gemini_output') // LLM spend is reported once, on gemini_input
          .map((svc) => ({
            key: svc.key,
            name: svc.key === 'gemini_input' ? 'Gemini 2.5 Flash-Lite' : svc.name,
            vendor: svc.vendor,
            status: svc.status,
            billing: svc.billing,
            spendInr:
              svc.billing === 'monthly_fixed'
                ? svc.status === 'off'
                  ? 0
                  : svc.rateInr
                : Math.round((usageByKey[svc.key] ?? 0) * 100) / 100,
          }));
        const usageTotalInr = serviceRows
          .filter((x) => x.billing !== 'monthly_fixed')
          .reduce((a, x) => a + x.spendInr, 0);
        const fixedTotalInr = serviceRows
          .filter((x) => x.billing === 'monthly_fixed')
          .reduce((a, x) => a + x.spendInr, 0);

        const calls = await tx.execute<{
          engine: string | null;
          outcome: string;
          connected_seconds: number | null;
          total_cost: string | null;
          response_p50_ms: number | null;
          quality_rating: number | null;
        }>(sql`
          select engine, outcome, connected_seconds, total_cost::text, response_p50_ms, quality_rating
          from call_cost_ledger
          where created_at >= ${monthStart}::date
            and created_at < (${monthStart}::date + interval '1 month')
        `);
        const arms = (['elevenlabs_agent', 'own_loop_elevenlabs_voice', 'own_loop_sarvam_voice'] as const).map(
          (engine): ArmSummary => {
            const mine = calls.filter((c) => (c.engine ?? 'elevenlabs_agent') === engine);
            const completed = mine.filter((c) => c.outcome === 'completed').length;
            const seconds = mine.reduce((a, c) => a + (c.connected_seconds ?? 0), 0);
            const total = mine.reduce((a, c) => a + Number(c.total_cost ?? 0), 0);
            const rated = mine.filter((c) => c.quality_rating !== null);
            const minutes = seconds / 60;
            return {
              engine,
              calls: mine.length,
              completedScreens: completed,
              minutes: Math.round(minutes * 10) / 10,
              totalInr: Math.round(total * 100) / 100,
              costPerMinute: minutes > 0 ? Math.round((total / minutes) * 100) / 100 : null,
              costPerCompletedScreen: completed > 0 ? Math.round((total / completed) * 100) / 100 : null,
              medianResponseMs: median(
                mine.map((c) => c.response_p50_ms).filter((v): v is number => v !== null),
              ),
              completionRate: mine.length > 0 ? Math.round((completed / mine.length) * 1000) / 10 : null,
              avgRating:
                rated.length > 0
                  ? Math.round((rated.reduce((a, c) => a + (c.quality_rating ?? 0), 0) / rated.length) * 10) / 10
                  : null,
              ratedCalls: rated.length,
            };
          },
        );
        return {
          monthStart,
          services: serviceRows,
          usageTotalInr: Math.round(usageTotalInr * 100) / 100,
          fixedTotalInr: Math.round(fixedTotalInr * 100) / 100,
          arms,
        };
      });
    },

    async adminListOrganizations(userId) {
      return asAdmin(userId, async (tx) =>
        tx.execute<{ id: string; name: string }>(sql`select id, name from organizations order by name`),
      );
    },

    async adminListCalls(userId, limit) {
      return asAdmin(userId, async (tx) => {
        const rows = await tx.execute<Record<string, unknown>>(sql`
          select l.voice_session_id, o.name as organization_name, l.engine, l.outcome,
                 l.connected_seconds, l.telephony_cost::text, l.stt_cost::text, l.llm_cost::text,
                 l.tts_cost::text, l.agent_cost::text, l.total_cost::text, l.telephony_billed,
                 l.response_p50_ms, l.interruptions, l.quality_rating, l.quality_note,
                 l.created_at::text
          from call_cost_ledger l
          join organizations o on o.id = l.organization_id
          order by l.created_at desc
          limit ${Math.min(Math.max(limit, 1), 200)}
        `);
        return rows.map((r) => ({
          voiceSessionId: String(r['voice_session_id']),
          organizationName: String(r['organization_name'] ?? ''),
          engine: (r['engine'] as string | null) ?? null,
          outcome: String(r['outcome']),
          connectedSeconds: num(r['connected_seconds']),
          telephonyCost: num(r['telephony_cost']),
          sttCost: num(r['stt_cost']),
          llmCost: num(r['llm_cost']),
          ttsCost: num(r['tts_cost']),
          agentCost: num(r['agent_cost']),
          totalCost: num(r['total_cost']),
          telephonyBilled: Boolean(r['telephony_billed']),
          responseP50Ms: num(r['response_p50_ms']),
          interruptions: num(r['interruptions']),
          qualityRating: num(r['quality_rating']),
          qualityNote: (r['quality_note'] as string | null) ?? null,
          createdAt: String(r['created_at']),
        }));
      });
    },

    async setJobEngine(organizationId, userId, jobId, engine, voice = {}) {
      await withTenantContext(database.db, { organizationId, userId }, async (tx) => {
        const rows = await tx.execute<{ id: string }>(sql`
          update jobs set voice_engine = ${engine},
            voice_persona = coalesce(${voice.persona ?? null}, voice_persona),
            tts_model = coalesce(${voice.ttsModel ?? null}, tts_model),
            updated_at = now()
          where id = ${jobId} and organization_id = ${organizationId}
          returning id
        `);
        if (!rows[0]) throw ApiError.notFound('Job');
      });
    },

    async adminRateCall(userId, voiceSessionId, rating, note) {
      await asAdmin(userId, async (tx) => {
        const rows = await tx.execute<{ id: string }>(sql`
          update call_cost_ledger
          set quality_rating = ${rating}, quality_note = ${note}, updated_at = now()
          where voice_session_id = ${voiceSessionId}
          returning id
        `);
        if (!rows[0]) throw ApiError.notFound('Call');
      });
    },
  };
}

function toService(r: Record<string, string | null>): ServiceRow {
  return {
    key: String(r['key']),
    name: String(r['name']),
    vendor: String(r['vendor']),
    usedFor: String(r['used_for']),
    billing: String(r['billing']),
    rateInr: Number(r['rate_inr'] ?? 0),
    status: String(r['status']),
    notes: r['notes'] ?? null,
    updatedAt: String(r['updated_at']),
  };
}
