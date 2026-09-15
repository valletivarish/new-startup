/**
 * Transcript accuracy — WER, CER, and kind-aware entity scoring.
 *
 * WER ALONE WOULD MISLEAD THIS PRODUCT:
 *
 *   reference   "I have nine years of experience"
 *   hypothesis  "I have 9 years of experience"        1 word wrong, zero harm
 *
 *   reference   "my notice period is ninety days"
 *   hypothesis  "my notice period is nineteen days"   1 word wrong, screen ruined
 *
 * So entity accuracy is gated alongside WER, and entities are matched by KIND.
 * Kind matters because the right comparison differs: a number needs
 * boundary-safe matching, a phone number needs digits compared with separators
 * ignored, a name needs to survive transliteration variance.
 *
 * THE DEFECT THIS FILE EXISTS TO NOT REPEAT: matching used substring search on
 * a joined string, so "19 years" contained "9 years" and the teens-for-units
 * confusion — the most common Indian-English STT error, and the exact case the
 * metric exists to catch — scored as a successful capture.
 *
 * THE THIRD DEFECT, and the one that would have chosen the winner: each STT
 * adapter is asked for its own DOCUMENTED language configuration on code-mixed
 * audio — one gets an auto-detect sentinel, one a code-switching mode, one an
 * Indian English locale — and those configurations return DIFFERENT SCRIPTS.
 * A romanised reference scored against a Devanagari transcription produces WER
 * above 1.0 for a PERFECT transcription. Measured: the same flawless
 * recognition scored 0%, 37.5% and 125% depending only on script. That is not a
 * provider difference; it is our configuration and the corpus's choice of
 * reference alphabet. So scoring is now script-aware: a hypothesis is compared
 * against a reference in the SAME script when the corpus supplies one, and an
 * unscoreable cross-script comparison is INCOMPLETE, never a FAIL.
 *
 * THE SECOND DEFECT: normalisation was one-way. A provider asked for inverse
 * text normalisation returns "120000" where the reference says "one hundred
 * twenty thousand", and a word-by-word table cannot bridge that — so the SAME
 * correct recognition scored WER 0.44 from one provider and 0.00 from another,
 * on a gate that is one of only two that can FAIL a run. Numbers are therefore
 * folded to a canonical value on BOTH sides, and every adapter is required to
 * request the same text normalisation (`AdapterIdentity.textNormalisation`).
 */

import type { TranscriptAccuracy } from '@platform/providers';
import type { EntityExpectationInput, EntityKind } from '../corpus/manifest.js';

const NUMBER_WORDS: Readonly<Record<string, string>> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15',
  sixteen: '16', seventeen: '17', eighteen: '18', nineteen: '19', twenty: '20',
  thirty: '30', forty: '40', fifty: '50', sixty: '60', seventy: '70',
  eighty: '80', ninety: '90', hundred: '100', thousand: '1000',
  lakh: '100000', lakhs: '100000', crore: '10000000', crores: '10000000',
  // 'oh' is the standard spoken zero in an Indian phone read-back. Without it
  // the digit run breaks and a perfectly-heard number scores as missing.
  oh: '0', o: '0', naught: '0', zed: '0',

  // DEVANAGARI NUMBER WORDS.
  //
  // Without these an India-first benchmark cannot score a number spoken in
  // Hindi at all: a phone read out as "नौ आठ सात छह" folded to nothing, the
  // digit run never formed, and a perfectly-heard number scored as missing.
  // Digits first, then the values a screening call actually contains — notice
  // periods, years of experience and lakh figures.
  'शून्य': '0', 'एक': '1', 'दो': '2', 'तीन': '3', 'चार': '4',
  'पांच': '5', 'पाँच': '5', 'छह': '6', 'छः': '6', 'सात': '7',
  'आठ': '8', 'नौ': '9', 'दस': '10',
  'ग्यारह': '11', 'बारह': '12', 'तेरह': '13', 'चौदह': '14', 'पंद्रह': '15',
  'सोलह': '16', 'सत्रह': '17', 'अठारह': '18', 'उन्नीस': '19', 'बीस': '20',
  'बाईस': '22', 'पच्चीस': '25', 'तीस': '30', 'पैंतालीस': '45',
  'चालीस': '40', 'पचास': '50', 'साठ': '60', 'सत्तर': '70',
  'अस्सी': '80', 'नब्बे': '90', 'सौ': '100', 'हज़ार': '1000', 'हजार': '1000',
  'लाख': '100000', 'करोड़': '10000000',
};

/**
 * Values that multiply what precedes them, rather than adding to it.
 *
 * Folding is applied ONLY to runs containing one of these. "3 30" (a time) must
 * not become 33, but "one hundred twenty thousand" must become 120000 —
 * otherwise a numeral-emitting provider and a word-emitting one are scored on
 * different scales.
 */
const MULTIPLIERS: ReadonlySet<number> = new Set([100, 1000, 100000, 10000000]);

/**
 * Fold an additive spoken run: "twenty two" is 22, "ninety" is 90.
 *
 * Only applies when each later token is strictly smaller than the running tens
 * value AND the leading token is a round multiple of ten from twenty upward.
 * That is the actual grammar of spoken English numbers, and it deliberately
 * leaves "3 30" (a time) and "9 8 7 6 5" (a digit read-back) alone — both of
 * which a naive "add everything adjacent" rule would corrupt.
 */
function foldAdditiveRun(run: readonly number[]): string[] {
  if (run.length < 2) return run.map(String);
  if (run.some((value) => !Number.isInteger(value))) return run.map(String);
  const head = run[0] as number;
  if (head < 20 || head % 10 !== 0) return run.map(String);
  const rest = run.slice(1);
  if (!rest.every((value) => value > 0 && value < 10)) return run.map(String);
  return [String(head + rest.reduce((a, b) => a + b, 0))];
}

function foldNumberRun(run: readonly number[]): string[] {
  if (!run.some((value) => MULTIPLIERS.has(value))) return foldAdditiveRun(run);
  let total = 0;
  let current = 0;
  for (const value of run) {
    if (MULTIPLIERS.has(value)) {
      if (current === 0) current = 1;
      if (value === 100) current *= 100;
      else { total += current * value; current = 0; }
    } else {
      current += value;
    }
  }
  return [String(total + current)];
}

/** Collapse spoken multi-token numbers into the numeral a provider might emit. */
function foldNumbers(tokens: readonly string[]): string[] {
  const out: string[] = [];
  let run: number[] = [];
  const flush = () => {
    if (run.length > 0) { out.push(...foldNumberRun(run)); run = []; }
  };
  for (const token of tokens) {
    // Decimals participate in a multiplier fold ("1.2 lakh") but never in an
    // additive one.
    if (/^\d+(\.\d+)?$/.test(token)) run.push(Number(token));
    else { flush(); out.push(token); }
  }
  flush();
  return out;
}

/**
 * Which alphabet a piece of text is written in.
 *
 * Only the distinction that matters here: Devanagari versus Latin. `mixed` is
 * the honest answer for genuinely code-mixed romanised-plus-native text, and it
 * is compatible with either reference.
 */
export type Script = 'latin' | 'devanagari' | 'mixed' | 'empty';

/**
 * Which alphabet DOMINATES, not merely which appear.
 *
 * A presence test called a romanised Hinglish sentence containing one
 * Devanagari word "mixed" — and "mixed" was treated as compatible with
 * everything, so a corpus could satisfy the both-alphabets rule with a SINGLE
 * reference and no alternate at all. The rule then guarded nothing, and the
 * providers configured to return Devanagari would still have been scored
 * against romanised text.
 *
 * A script has to carry most of the letters to be the script.
 */
const DOMINANCE = 0.6;

export function detectScript(text: string): Script {
  const devanagari = (text.match(/[\u0900-\u097F]/gu) ?? []).length;
  const latin = (text.match(/[A-Za-z]/gu) ?? []).length;
  const total = devanagari + latin;
  if (total === 0) return 'empty';
  if (devanagari / total >= DOMINANCE) return 'devanagari';
  if (latin / total >= DOMINANCE) return 'latin';
  return 'mixed';
}

/** Can these two be meaningfully compared word for word? */
export function scriptsComparable(a: Script, b: Script): boolean {
  if (a === 'empty' || b === 'empty') return true;
  if (a === 'mixed' || b === 'mixed') return true;
  return a === b;
}

/**
 * Pick the reference written in the same alphabet as the hypothesis.
 *
 * Returns undefined when the corpus supplies no reference in a comparable
 * script — which is a corpus gap, not a provider failure, and the caller must
 * record it as unscoreable rather than scoring 125% word error against it.
 */
export function chooseReference(
  references: readonly string[],
  hypothesis: string,
): { reference: string; index: number } | undefined {
  const target = detectScript(hypothesis);
  const candidates = references.filter((r) => r.trim() !== '');
  if (candidates.length === 0) return undefined;
  const exact = candidates.findIndex((r) => detectScript(r) === target);
  if (exact >= 0) return { reference: candidates[exact] as string, index: exact };
  const compatible = candidates.findIndex((r) => scriptsComparable(detectScript(r), target));
  if (compatible >= 0) return { reference: candidates[compatible] as string, index: compatible };
  return undefined;
}

export interface NormalisationOptions {
  readonly normaliseNumbers?: boolean;
  /**
   * Explicit equivalences, applied identically to reference and hypothesis.
   * Caller-supplied rather than built in: an equivalence the scorer invents is
   * a thumb on the scale.
   */
  readonly aliases?: Readonly<Record<string, string>>;
}

export function tokenise(
  text: string,
  options: NormalisationOptions = {},
): readonly string[] {
  const { normaliseNumbers = true, aliases } = options;
  const cleaned = text
    .toLowerCase()
    // Digit-group separators go FIRST: the scrub below turns them into spaces,
    // which shreds "1,200,000" into three tokens that can never match "twelve
    // lakhs".
    .replace(/(\d)[,](?=\d)/g, '$1')
    // `\p{M}` IS LOAD-BEARING. Devanagari vowel signs are combining MARKS, not
    // letters, so a class of `\p{L}\p{N}` alone strips every matra and shreds
    // "मेरा" into "म" + "र". Every Hindi and Hinglish transcript was being
    // reduced to bare consonants, which would have destroyed the Hinglish
    // sub-gate silently — the tests missed it because they compared two
    // identically-shredded strings and got a word error rate of zero.
    //
    // The dot is kept for now: stripping it turned "1.2 lakh" into tokens
    // [1, 2, lakh], which the multiplier fold then ADDED before multiplying —
    // 300000 instead of 120000. A 2.5x error invented by the scorer, on the
    // entity kind the money gate is about.
    .replace(/[^\p{L}\p{N}\p{M}\s.]/gu, ' ')
    // Now drop every dot that is NOT a decimal point between two digits.
    .replace(/\.(?!\d)/g, ' ')
    .replace(/(?<!\d)\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned === '') return [];
  const mapped = cleaned.split(' ').map((token) => {
    const aliased = aliases?.[token] ?? token;
    return normaliseNumbers ? (NUMBER_WORDS[aliased] ?? aliased) : aliased;
  });
  return normaliseNumbers ? foldNumbers(mapped) : mapped;
}

/**
 * Word-to-digit mapping WITHOUT multiplier folding.
 *
 * Folding is right for matching — "twelve lakhs" and "1,200,000" must compare
 * equal — but it destroys the structure the wrong-vs-missing heuristic reads.
 * Once "fifteen lakhs" is one token, there is no unit sitting next to a number
 * any more, and a confidently WRONG figure was silently downgraded to a merely
 * missing one: the exact collapse the entity metric exists to prevent.
 */
function tokeniseUnfolded(
  text: string,
  options: NormalisationOptions = {},
): readonly string[] {
  const { normaliseNumbers = true, aliases } = options;
  const cleaned = text
    .toLowerCase()
    .replace(/(\d)[,](?=\d)/g, '$1')
    // `\p{M}` for the same reason as above: Devanagari matras are marks.
    .replace(/[^\p{L}\p{N}\p{M}\s.]/gu, ' ')
    .replace(/\.(?!\d)/g, ' ')
    .replace(/(?<!\d)\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned === '') return [];
  return cleaned.split(' ').map((token) => {
    const aliased = aliases?.[token] ?? token;
    return normaliseNumbers ? (NUMBER_WORDS[aliased] ?? aliased) : aliased;
  });
}

/**
 * Maximal runs of adjacent numeric tokens, concatenated.
 *
 * A phone number survives transcription as "98765 43210", "9876543210" or ten
 * separate spoken digits; all three are the same number and must score the same.
 */
function digitRuns(tokens: readonly string[]): string[] {
  const runs: string[] = [];
  let current = '';
  for (const token of tokens) {
    if (/^\d+$/.test(token)) current += token;
    else if (current !== '') { runs.push(current); current = ''; }
  }
  if (current !== '') runs.push(current);
  return runs;
}

/** Country-code prefixes an Indian number may legitimately carry. */
const PHONE_PREFIXES = ['', '91', '091', '0'];

function align(
  reference: readonly string[],
  hypothesis: readonly string[],
): { substitutions: number; deletions: number; insertions: number; distance: number } {
  const n = reference.length;
  const m = hypothesis.length;
  type Cell = { cost: number; sub: number; del: number; ins: number };
  let previous: Cell[] = Array.from({ length: m + 1 }, (_, j) => ({
    cost: j, sub: 0, del: 0, ins: j,
  }));

  for (let i = 1; i <= n; i += 1) {
    const current: Cell[] = new Array(m + 1);
    current[0] = { cost: i, sub: 0, del: i, ins: 0 };
    for (let j = 1; j <= m; j += 1) {
      const match = reference[i - 1] === hypothesis[j - 1];
      const diagonal = previous[j - 1] as Cell;
      const above = previous[j] as Cell;
      const left = current[j - 1] as Cell;
      const substitute: Cell = {
        cost: diagonal.cost + (match ? 0 : 1),
        sub: diagonal.sub + (match ? 0 : 1),
        del: diagonal.del, ins: diagonal.ins,
      };
      const deleteRef: Cell = {
        cost: above.cost + 1, sub: above.sub, del: above.del + 1, ins: above.ins,
      };
      const insertHyp: Cell = {
        cost: left.cost + 1, sub: left.sub, del: left.del, ins: left.ins + 1,
      };
      let best = substitute;
      if (deleteRef.cost < best.cost) best = deleteRef;
      if (insertHyp.cost < best.cost) best = insertHyp;
      current[j] = best;
    }
    previous = current;
  }
  const final = previous[m] as Cell;
  return {
    substitutions: final.sub,
    deletions: final.del,
    insertions: final.ins,
    distance: final.cost,
  };
}

/** Does `needle` appear as a whole-token run inside `haystack`? */
function containsTokenRun(
  haystack: readonly string[],
  needle: readonly string[],
): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    let matched = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) { matched = false; break; }
    }
    if (matched) return true;
  }
  return false;
}

/** Levenshtein ratio, for transliteration-tolerant name matching. */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const distance = align(a.split(''), b.split('')).distance;
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 1 : 1 - distance / longest;
}

/** Names survive transliteration variance; everything else must match exactly. */
const NAME_SIMILARITY_THRESHOLD = 0.8;

export type EntityOutcome = 'found' | 'wrong' | 'missing';

export interface EntityResult {
  readonly name: string;
  readonly kind: EntityKind;
  readonly outcome: EntityOutcome;
  /** What the transcript actually said, when the outcome is `wrong`. */
  readonly heard?: string;
}

/**
 * Score one entity against a transcript.
 *
 * `wrong` is distinguished from `missing` because they have different
 * consequences: a missing fact makes the agent re-ask, a wrong one silently
 * rejects a qualified candidate.
 */
export function scoreEntity(
  hypothesis: string,
  expectation: EntityExpectationInput,
  options: NormalisationOptions = {},
): EntityResult {
  const tokens = tokenise(hypothesis, options);
  const base = { name: expectation.name, kind: expectation.kind } as const;

  // A rejecting form present means the meaning inverted — "I cannot relocate"
  // must not satisfy an accept-form of "relocate".
  for (const form of expectation.reject ?? []) {
    if (containsTokenRun(tokens, tokenise(form, options))) {
      return { ...base, outcome: 'wrong', heard: form };
    }
  }

  if (expectation.kind === 'phone') {
    // Digits only: separators, spacing and grouping vary freely and none of them
    // changes the number. But the comparison runs over the NORMALISED tokens, so
    // a provider that spells the digits out is scored identically to one that
    // emits numerals — and it matches a whole digit run rather than a substring,
    // so a longer number does not satisfy a shorter expectation by containing it.
    const runs = digitRuns(tokens);
    for (const form of expectation.accept) {
      const wanted = form.replace(/\D/g, '');
      if (wanted === '') continue;
      for (const run of runs) {
        if (PHONE_PREFIXES.some((prefix) => run === prefix + wanted)) {
          return { ...base, outcome: 'found' };
        }
      }
    }
    const expectedLength = expectation.accept[0]?.replace(/\D/g, '').length ?? 0;
    const confused = runs.find((run) => run.length === expectedLength);
    return confused !== undefined
      ? { ...base, outcome: 'wrong', heard: confused }
      : { ...base, outcome: 'missing' };
  }

  if (expectation.kind === 'name') {
    // Transliteration varies ("Rajesh"/"Rajish"), so accept near matches — but
    // only for names, and only per-token, never across a whole transcript.
    for (const form of expectation.accept) {
      const wanted = tokenise(form, options);
      if (containsTokenRun(tokens, wanted)) return { ...base, outcome: 'found' };
      if (wanted.length === 1) {
        const target = wanted[0] as string;
        if (tokens.some((t) => similarity(t, target) >= NAME_SIMILARITY_THRESHOLD)) {
          return { ...base, outcome: 'found' };
        }
      }
    }
    return { ...base, outcome: 'missing' };
  }

  // Everything else: whole-token-run matching. THIS is the boundary safety that
  // stops "19 years" satisfying "9 years".
  for (const form of expectation.accept) {
    if (containsTokenRun(tokens, tokenise(form, options))) {
      return { ...base, outcome: 'found' };
    }
  }

  // Not captured. For numeric kinds with a declared unit, decide whether the
  // transcript said something confidently different.
  if (expectation.unit) {
    // Read on the UNFOLDED view, where the unit is still its own token.
    const unfolded = tokeniseUnfolded(hypothesis, options);
    const unit = tokeniseUnfolded(expectation.unit, options).join(' ');
    for (let i = 0; i < unfolded.length; i += 1) {
      if (unfolded[i] !== unit) continue;
      const preceding = i > 0 ? (unfolded[i - 1] as string) : undefined;
      if (preceding !== undefined && /^\d+$/.test(preceding)) {
        // Report the unit the expectation was WRITTEN with, so "112 lakhs"
        // reads as itself rather than as "112 100000".
        return { ...base, outcome: 'wrong', heard: `${preceding} ${expectation.unit}` };
      }
    }
  }

  return { ...base, outcome: 'missing' };
}

export interface EntityScore {
  readonly results: readonly EntityResult[];
  readonly expected: number;
  readonly found: number;
  readonly wrong: number;
  readonly missing: number;
  readonly accuracy: number;
}

export function scoreEntities(
  hypothesis: string,
  expectations: readonly EntityExpectationInput[],
  options: NormalisationOptions = {},
): EntityScore {
  const results = expectations.map((e) => scoreEntity(hypothesis, e, options));
  const found = results.filter((r) => r.outcome === 'found').length;
  const wrong = results.filter((r) => r.outcome === 'wrong').length;
  return {
    results,
    expected: expectations.length,
    found,
    wrong,
    missing: results.length - found - wrong,
    accuracy: expectations.length === 0 ? 1 : found / expectations.length,
  };
}

/**
 * Score against whichever supplied reference shares the hypothesis's alphabet.
 *
 * Returns `unscoreable` when none does. That is a corpus gap — nobody wrote a
 * reference in the script this provider was configured to produce — and it must
 * never be reported as a 125% word error rate, which is what comparing
 * Devanagari against romanised text produces for a flawless transcription.
 */
export function scoreAgainstBestReference(
  references: readonly string[],
  hypothesis: string,
  options: NormalisationOptions = {},
  entities: readonly EntityExpectationInput[] = [],
): (TranscriptAccuracy & { entityResults?: readonly EntityResult[] }) | { unscoreable: true; reason: string } {
  const chosen = chooseReference(references, hypothesis);
  if (!chosen) {
    return {
      unscoreable: true,
      reason:
        `The transcript is in ${detectScript(hypothesis)} script and the corpus supplies no ` +
        `reference in a comparable script (has: ${references.map(detectScript).join(', ')}). ` +
        'Scoring across alphabets would report a perfect transcription as a total failure, ' +
        'so this sample is excluded rather than counted against the provider.',
    };
  }
  return scoreTranscript(chosen.reference, hypothesis, options, entities);
}

export function scoreTranscript(
  reference: string,
  hypothesis: string,
  options: NormalisationOptions = {},
  entities: readonly EntityExpectationInput[] = [],
): TranscriptAccuracy & { entityResults?: readonly EntityResult[] } {
  const referenceTokens = tokenise(reference, options);
  const hypothesisTokens = tokenise(hypothesis, options);

  const words = align(referenceTokens, hypothesisTokens);
  const characters = align(
    referenceTokens.join(' ').split(''),
    hypothesisTokens.join(' ').split(''),
  );
  const referenceWords = referenceTokens.length;
  const referenceChars = referenceTokens.join(' ').length;

  const wer =
    referenceWords === 0
      ? hypothesisTokens.length === 0 ? 0 : 1
      : words.distance / referenceWords;
  const cer =
    referenceChars === 0
      ? hypothesisTokens.length === 0 ? 0 : 1
      : characters.distance / referenceChars;

  const entityScore = entities.length > 0 ? scoreEntities(hypothesis, entities, options) : undefined;

  return {
    wer,
    cer,
    substitutions: words.substitutions,
    deletions: words.deletions,
    insertions: words.insertions,
    referenceWords,
    ...(entityScore
      ? {
          entityAccuracy: entityScore.accuracy,
          entitiesExpected: entityScore.expected,
          entitiesFound: entityScore.found,
          entitiesWrong: entityScore.wrong,
          entityResults: entityScore.results,
        }
      : {}),
  };
}

/** Combine per-utterance scores, weighting WER by reference length. */
export function combineAccuracy(
  scores: readonly TranscriptAccuracy[],
): TranscriptAccuracy | undefined {
  if (scores.length === 0) return undefined;

  const referenceWords = scores.reduce((n, s) => n + s.referenceWords, 0);
  const substitutions = scores.reduce((n, s) => n + s.substitutions, 0);
  const deletions = scores.reduce((n, s) => n + s.deletions, 0);
  const insertions = scores.reduce((n, s) => n + s.insertions, 0);
  const entitiesExpected = scores.reduce((n, s) => n + (s.entitiesExpected ?? 0), 0);
  const entitiesFound = scores.reduce((n, s) => n + (s.entitiesFound ?? 0), 0);
  const entitiesWrong = scores.reduce((n, s) => n + (s.entitiesWrong ?? 0), 0);

  // Length-weighted: a three-word "yes" must not outweigh a fifty-word answer.
  const wer = referenceWords === 0 ? 0 : (substitutions + deletions + insertions) / referenceWords;
  const cer =
    scores.reduce((n, s) => n + s.cer * s.referenceWords, 0) / Math.max(1, referenceWords);

  return {
    wer, cer, substitutions, deletions, insertions, referenceWords,
    ...(entitiesExpected > 0
      ? {
          entityAccuracy: entitiesFound / entitiesExpected,
          entitiesExpected, entitiesFound, entitiesWrong,
        }
      : {}),
  };
}
