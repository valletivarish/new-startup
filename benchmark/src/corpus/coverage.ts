/**
 * Entity-category coverage — the specification's minimums, enforced.
 *
 * `CORPUS_RECORDING_SPEC.md` section 4 states how many of each kind of fact the
 * corpus must contain. Nothing checked it. A founder could record eighty
 * utterances, write sixty-eight expectations, pass `bench validate` with zero
 * errors, and have three dates where the specification asks for eight — and
 * find out only when a category-level conclusion could not be drawn, which is
 * after the sweep has been paid for.
 *
 * These are the specification's own numbers. Nothing here is invented, and
 * nothing here changes a gate: the verdict does not split by entity kind. What
 * it does is stop a corpus being called finished when it is not.
 */

import type { EntityKind } from './manifest.js';

/** From `CORPUS_RECORDING_SPEC.md` section 4. */
export const CATEGORY_MINIMUMS: Readonly<Record<EntityKind, number>> = {
  name: 10,
  duration: 10,   // notice periods
  number: 10,
  money: 10,      // lakh and crore
  date: 8,
  phone: 6,
  location: 8,
  text: 6,        // relocation and other negation, which needs `reject` forms
};

/** What each category is FOR, so the message says why it is short. */
export const CATEGORY_PURPOSE: Readonly<Record<EntityKind, string>> = {
  name: 'Indian given names and surnames a Western-trained model has not seen',
  duration: 'notice periods, including teens-versus-units traps',
  number: 'years of experience, team sizes, counts',
  money: 'lakh and crore figures, spoken and numeric',
  date: 'dates and one time-of-day',
  phone: 'ten-digit Indian mobiles read three different ways',
  location: 'Indian cities, at least two multi-word',
  text: 'relocation and negation, which an accept-list cannot express alone',
};

export interface CoverageRow {
  readonly kind: EntityKind;
  readonly required: number;
  readonly present: number;
  readonly short: number;
}

export function coverage(
  entities: readonly { readonly kind: EntityKind }[],
): CoverageRow[] {
  return (Object.keys(CATEGORY_MINIMUMS) as EntityKind[]).map((kind) => {
    const present = entities.filter((e) => e.kind === kind).length;
    const required = CATEGORY_MINIMUMS[kind];
    return { kind, required, present, short: Math.max(0, required - present) };
  });
}

/**
 * A planned allocation of categories across recording slots.
 *
 * Deciding WHAT a speaker says is ground truth and is not generated here. Which
 * category belongs in which slot is arithmetic against the specification, and
 * doing it by hand across eighty slots is where a corpus quietly ends up with
 * four dates. The allocation is deterministic so two people running the
 * scaffold get the same sheet.
 */
export function allocate(slots: number): EntityKind[][] {
  const queue: EntityKind[] = [];
  for (const [kind, required] of Object.entries(CATEGORY_MINIMUMS) as [EntityKind, number][]) {
    for (let i = 0; i < required; i += 1) queue.push(kind);
  }
  // Interleave so a single conversation does not become all one category.
  const spread: EntityKind[] = [];
  const kinds = [...new Set(queue)];
  for (let round = 0; spread.length < queue.length; round += 1) {
    for (const kind of kinds) {
      if (queue.filter((k) => k === kind).length > round) spread.push(kind);
    }
  }

  const out: EntityKind[][] = Array.from({ length: slots }, () => []);
  spread.forEach((kind, index) => {
    (out[index % slots] as EntityKind[]).push(kind);
  });
  return out;
}
