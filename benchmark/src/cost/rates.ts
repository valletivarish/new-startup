/**
 * Cost estimation for a planned sweep.
 *
 * THE RULE THIS FILE ENFORCES: **a rate that has not been verified is not a
 * rate.** Every entry carries its source and the date it was checked, and a
 * missing entry produces "NOT PRICED" rather than a plausible number. This
 * project has already caught a search summary that was wrong on three of three
 * Sarvam figures; an invented rate in a spend estimate would be the same
 * mistake with money attached.
 *
 * The rate card is DATA, not code — a JSON file the founder maintains — so that
 * updating a price is not a code change and every price in an estimate can be
 * traced to a page someone actually read.
 */

import { z } from 'zod';

export const RateSource = z.enum(['OFFICIAL', 'THIRD_PARTY', 'ESTIMATE']);
export type RateSource = z.infer<typeof RateSource>;

/** What a provider meters. Nothing is priced against a unit it does not bill in. */
export const RateUnit = z.enum([
  'per_audio_hour',
  'per_audio_minute',
  'per_1k_characters',
  'per_10k_characters',
  'per_1m_input_tokens',
  'per_1m_output_tokens',
]);
export type RateUnit = z.infer<typeof RateUnit>;

export const RateEntrySchema = z
  .object({
    unit: RateUnit,
    amount: z.number().min(0),
    currency: z.enum(['INR', 'USD']),
    /** OFFICIAL means: read on the provider's own page, on the date below. */
    source: RateSource,
    url: z.string().min(1),
    verifiedOn: z.string().min(8),
    /**
     * Free allowance in the same unit, if the provider documents one.
     *
     * Applied ONCE per key across the whole estimate, not once per line. It was
     * subtracted inside the per-line loop, so a provider used by three runs got
     * its monthly allowance three times — which understates spend by exactly
     * the amount a founder is relying on the estimate to bound.
     */
    freeAllowance: z.number().min(0).optional(),
    /**
     * What period the allowance covers, for the reader.
     *
     * The estimator cannot know how much of a monthly allowance is already
     * spent, so it says so rather than assuming a full one.
     */
    freeAllowancePeriod: z.enum(['once', 'per_month']).optional(),
    note: z.string().optional(),
  })
  .strict();
export type RateEntry = z.infer<typeof RateEntrySchema>;

export const RateCardSchema = z
  .object({
    /** Bumped whenever any rate changes, and recorded in every estimate. */
    version: z.string().min(1),
    /** Used only to present a single-currency total; always an ESTIMATE. */
    usdToInr: z.object({
      rate: z.number().positive(),
      source: RateSource,
      verifiedOn: z.string().min(8),
    }),
    /** Keyed `<adapterId>.<stt|tts|llm>`, e.g. "sarvam.stt". */
    rates: z.record(z.string(), RateEntrySchema),
  })
  .strict();
export type RateCard = z.infer<typeof RateCardSchema>;

export function parseRateCard(raw: unknown): RateCard {
  return RateCardSchema.parse(raw);
}

export interface PricedLine {
  readonly runId: string;
  readonly key: string;
  readonly quantity: number;
  readonly unit: RateUnit | 'unknown';
  /** Undefined when no rate exists — never zero, which would read as free. */
  readonly inr?: number;
  readonly source?: RateSource;
  readonly missingReason?: string;
}

export interface CostEstimate {
  readonly rateCardVersion: string;
  readonly lines: readonly PricedLine[];
  /** Sum of the lines that COULD be priced. Never presented as the total. */
  readonly pricedInr: number;
  readonly unpriced: readonly string[];
  /** True only when every line was priced from an OFFICIAL rate. */
  readonly complete: boolean;
  readonly warnings: readonly string[];
}

function toInr(entry: RateEntry, card: RateCard): number {
  return entry.currency === 'INR' ? entry.amount : entry.amount * card.usdToInr.rate;
}

/** Quantity in the entry's own unit, from audio seconds / characters. */
function quantityFor(unit: RateUnit, audioSeconds: number, characters: number): number {
  switch (unit) {
    case 'per_audio_hour': return audioSeconds / 3600;
    case 'per_audio_minute': return audioSeconds / 60;
    case 'per_1k_characters': return characters / 1000;
    case 'per_10k_characters': return characters / 10_000;
    // Token units cannot be derived from audio or characters. An estimate that
    // guessed a token count would be inventing the number it is asked for.
    case 'per_1m_input_tokens':
    case 'per_1m_output_tokens':
      return Number.NaN;
  }
}

export interface CostInput {
  readonly runId: string;
  /**
   * `<adapterId>.<service>`, optionally `.<variant>`.
   *
   * The variant exists because at least one candidate bills code-mixed audio at
   * a different rate from monolingual audio, and a single per-provider rate
   * would price the Hinglish third of the corpus at the cheaper number. The
   * estimator falls back to the base key when no variant entry exists, and says
   * which key it used.
   */
  readonly key: string;
  readonly audioSeconds: number;
  readonly characters: number;
}

/** Try the variant key, then the base key. Report which was used. */
function resolveEntry(card: RateCard, key: string): { key: string; entry?: RateEntry } {
  const exact = card.rates[key];
  if (exact) return { key, entry: exact };
  const base = key.split('.').slice(0, 2).join('.');
  const fallback = card.rates[base];
  if (fallback) return { key: base, entry: fallback };
  return { key };
}

/**
 * Price a planned sweep.
 *
 * WORST CASE, not expected case. Retries re-send the whole utterance and
 * re-synthesise the whole line, so the quantities passed in should already
 * include the retry multiplier — an estimate a founder can exceed by 3× while
 * doing nothing wrong is not a budget.
 */
export function estimateCost(inputs: readonly CostInput[], card: RateCard): CostEstimate {
  const lines: PricedLine[] = [];
  const unpriced: string[] = [];
  const warnings: string[] = [];
  let pricedInr = 0;

  if (card.usdToInr.source !== 'OFFICIAL') {
    warnings.push(
      `The USD to INR rate (${card.usdToInr.rate}) is ${card.usdToInr.source}, verified ` +
        `${card.usdToInr.verifiedOn}. Every dollar-denominated line below inherits that uncertainty.`,
    );
  }

  // Allowances are per KEY, per period — not per line.
  const allowanceRemaining = new Map<string, number>();

  for (const input of inputs) {
    const resolved = resolveEntry(card, input.key);
    const entry = resolved.entry;
    if (resolved.entry && resolved.key !== input.key) {
      warnings.push(
        `"${input.key}" has no rate; priced with the base rate "${resolved.key}". If this ` +
          'provider bills this variant differently, the estimate is wrong in its favour.',
      );
    }
    if (!entry) {
      unpriced.push(input.key);
      lines.push({
        runId: input.runId, key: input.key, quantity: 0, unit: 'unknown',
        missingReason: `No rate for "${input.key}" in rate card ${card.version}.`,
      });
      continue;
    }
    const quantity = quantityFor(entry.unit, input.audioSeconds, input.characters);
    if (!Number.isFinite(quantity)) {
      unpriced.push(input.key);
      lines.push({
        runId: input.runId, key: input.key, quantity: 0, unit: entry.unit,
        missingReason:
          `"${input.key}" is billed ${entry.unit}, which cannot be derived from audio seconds ` +
          'or characters. Token counts depend on the model and the prompt and must be measured, ' +
          'not assumed.',
      });
      continue;
    }
    const allowance = entry.freeAllowance ?? 0;
    const remaining = allowanceRemaining.get(resolved.key) ?? allowance;
    const covered = Math.min(quantity, remaining);
    allowanceRemaining.set(resolved.key, remaining - covered);
    const inr = (quantity - covered) * toInr(entry, card);
    pricedInr += inr;
    lines.push({
      runId: input.runId, key: resolved.key, quantity, unit: entry.unit,
      inr, source: entry.source,
    });
    if (entry.source !== 'OFFICIAL') {
      warnings.push(
        `"${input.key}" is priced from a ${entry.source} rate (${entry.url}, checked ` +
          `${entry.verifiedOn}). Confirm it on the provider's own page before relying on the total.`,
      );
    }
    if (allowance > 0) {
      warnings.push(
        `"${resolved.key}" applies a free allowance of ${allowance} ${entry.unit}` +
          `${entry.freeAllowancePeriod === 'per_month' ? ' per month' : ''}, once across this ` +
          'whole estimate. The estimator cannot know how much of it you have already spent, so ' +
          'it assumes the full allowance is available — which makes this line optimistic.',
      );
    }
  }

  return {
    rateCardVersion: card.version,
    lines,
    pricedInr,
    unpriced: [...new Set(unpriced)],
    complete: unpriced.length === 0 && lines.every((l) => l.source === 'OFFICIAL'),
    warnings,
  };
}

export function renderCostEstimate(estimate: CostEstimate): string {
  const lines = [
    `Cost estimate (rate card ${estimate.rateCardVersion}) — WORST CASE, retries included`,
    '',
  ];
  for (const line of estimate.lines) {
    if (line.inr === undefined) {
      lines.push(`  ${line.runId.padEnd(40)} ${line.key.padEnd(16)} NOT PRICED`);
      lines.push(`      ${line.missingReason ?? ''}`);
    } else {
      lines.push(
        `  ${line.runId.padEnd(40)} ${line.key.padEnd(16)} ` +
          `${line.quantity.toFixed(3)} ${line.unit.padEnd(20)} INR ${line.inr.toFixed(2)} [${line.source}]`,
      );
    }
  }
  lines.push('', `  Priced lines total: INR ${estimate.pricedInr.toFixed(2)}`);
  if (estimate.unpriced.length > 0) {
    lines.push(
      '',
      `  ! ${estimate.unpriced.length} line(s) could NOT be priced: ${estimate.unpriced.join(', ')}.`,
      '    The total above is a FLOOR, not an estimate of what the sweep will cost.',
    );
  }
  if (!estimate.complete) {
    lines.push('', '  This estimate is INCOMPLETE. Do not budget from it as though it were final.');
  }
  for (const warning of estimate.warnings) lines.push(`  ! ${warning}`);
  return lines.join('\n');
}
