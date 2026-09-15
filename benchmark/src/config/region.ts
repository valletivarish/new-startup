/**
 * The benchmark execution region.
 *
 * WHY THIS IS MANDATORY: the benchmark exists to predict production latency,
 * and its budget is 1200 ms p50. Every provider call is made from the benchmark
 * host, so the host's network position is a constant added to every
 * measurement — it does not bias one provider against another, but it does bias
 * the absolute figures against the gate. `PHASE_5_PROVIDER_COMPARISON` already
 * budgets 20–250 ms for "carrier media edge to Bangalore VM" and marks it
 * Unknown; a 200 ms uncertainty is 17% of the gate.
 *
 * So the region is pre-registered, required, recorded in run metadata, and
 * refused when absent. A result that cannot be tied to where it ran is an
 * assertion about latency, not a measurement of it.
 *
 * WHAT THIS CANNOT DO: prove the region. There is no way to verify from inside
 * the process that a machine is where its operator says it is, short of calling
 * a cloud metadata service — a network dependency this harness will not take.
 * The value is therefore DECLARED, recorded as declared, and printed as
 * declared in every report. Calling it "verified" would be a lie of exactly the
 * kind this project keeps catching.
 */

/**
 * The only region a real run may execute from.
 *
 * Bangalore, resolving the Mumbai/Bangalore contradiction in favour of the
 * infrastructure production will actually use: DigitalOcean BLR1 is PRIMARY in
 * `PHASE_5B_DECISION_MATRIX` section 7 and `PHASE_5_RECOMMENDATION`, and the
 * research found it is the only provider combining a real Indian region with
 * managed Postgres in that region. Benchmarking from one city and deploying to
 * another leaves the difference unmeasured on every turn, forever.
 */
export const ALLOWED_REGIONS = ['BLR1'] as const;
export type BenchmarkRegion = (typeof ALLOWED_REGIONS)[number];

export const REGION_ENV_VAR = 'BENCHMARK_REGION';

export class RegionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegionError';
  }
}

/** The declared region, or undefined when unset. Never guesses. */
export function declaredRegion(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env[REGION_ENV_VAR];
  return raw === undefined || raw.trim() === '' ? undefined : raw.trim();
}

/**
 * The region a spending run may use, or an error explaining why it may not.
 *
 * Called in the free pre-flight, before `--confirm`, so learning that the
 * region is wrong costs nothing.
 */
export function requireRegion(env: NodeJS.ProcessEnv = process.env): BenchmarkRegion {
  const declared = declaredRegion(env);
  if (declared === undefined) {
    throw new RegionError(
      `${REGION_ENV_VAR} is not set. The benchmark location is pre-registered as ` +
        `${ALLOWED_REGIONS.join(' or ')}, and every latency figure depends on it: the host's ` +
        'network position is added to every measurement, so a result that cannot be tied to ' +
        'where it ran cannot be compared with the 1200 ms budget. Set it on the benchmark VM. ' +
        'Do not set it on a laptop to make this message go away — that produces a number that ' +
        'looks like a measurement and is not one.',
    );
  }
  const match = ALLOWED_REGIONS.find((r) => r.toLowerCase() === declared.toLowerCase());
  if (!match) {
    throw new RegionError(
      `${REGION_ENV_VAR} is "${declared}", which is not a pre-registered benchmark region ` +
        `(${ALLOWED_REGIONS.join(', ')}). A region chosen after the protocol was registered ` +
        'makes the run incomparable with every other run. If the location genuinely needs to ' +
        'change, amend the design document first, so the change is recorded rather than implied.',
    );
  }
  return match;
}
