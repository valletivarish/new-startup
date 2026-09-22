/**
 * Production boundary — the benchmark must never leak into production.
 *
 * Phase 5C introduced provider-specific code for the first time: the benchmark
 * harness contains adapters that name Sarvam, Deepgram, Azure and Cartesia.
 * That is permitted ONLY inside `benchmark/`, which is deliberately not under
 * `apps/` or `packages/` so the separation is structural rather than a
 * convention someone has to remember.
 *
 * These tests fail the build if that boundary is crossed. They are cheap,
 * mechanical, and they are the only thing standing between "we benchmarked a
 * provider" and "we accidentally shipped one".
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');

/** Every production source tree. The benchmark is deliberately absent. */
const PRODUCTION_TREES = [
  'apps/api/src',
  'apps/web/app',
  'apps/web/lib',
  'apps/web/src',
  'packages/db/src',
  'packages/permissions/src',
  'packages/providers/src',
];

/**
 * Adapter directories that are allowed to contain provider-specific names.
 *
 * MVP-01: ElevenLabs is the first selected provider. Its SDK and vendor name
 * are confined to exactly these two directories and nowhere else in production.
 * Adding a new entry here is a deliberate, reviewable act.
 */
const VENDOR_ADAPTER_DIRS = [
  'apps/api/src/providers/elevenlabs',
  'apps/web/src/integrations/elevenlabs',
];

/**
 * Remove comments without eating code.
 *
 * Deliberately conservative: a `//` only starts a comment when it is not
 * preceded by a `:` (a URL scheme) and not inside a string literal on that
 * line. Getting this wrong in the permissive direction hides code from the
 * vendor scan, which is the failure mode that matters here.
 */
function stripComments(source: string): string {
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, '');
  return withoutBlocks
    .split('\n')
    .map((line) => {
      let inString: string | null = null;
      for (let i = 0; i < line.length; i += 1) {
        const char = line[i] as string;
        const previous = line[i - 1];
        if (inString) {
          if (char === inString && previous !== '\\') inString = null;
          continue;
        }
        if (char === '"' || char === "'" || char === '`') { inString = char; continue; }
        if (char === '/' && line[i + 1] === '/' && previous !== ':') return line.slice(0, i);
      }
      return line;
    })
    .join('\n');
}

function sourceFiles(dir: string): string[] {
  const root = join(repoRoot, dir);
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      if (entry === 'node_modules' || entry === '.next' || entry === 'dist') continue;
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
  };
  walk(root);
  return out;
}

describe('the benchmark package cannot reach production', () => {
  it('no production file imports @platform/benchmark', () => {
    const offenders: string[] = [];
    for (const tree of PRODUCTION_TREES) {
      for (const file of sourceFiles(tree)) {
        const src = readFileSync(file, 'utf8');
        if (/@platform\/benchmark/.test(src)) {
          offenders.push(file.replace(`${repoRoot}/`, ''));
        }
      }
    }
    expect(
      offenders,
      'Production code imported the benchmark package. Benchmark adapters name real ' +
        'providers; importing them into production is exactly the vendor lock-in the ' +
        'whole architecture exists to prevent.',
    ).toEqual([]);
  });

  it('no production file reaches into the benchmark directory by relative path', () => {
    const offenders: string[] = [];
    for (const tree of PRODUCTION_TREES) {
      for (const file of sourceFiles(tree)) {
        const src = readFileSync(file, 'utf8');
        // A relative path that climbs out and back into benchmark/ would evade
        // the package-name check above.
        if (/from\s+['"][./]+benchmark\//.test(src)) {
          offenders.push(file.replace(`${repoRoot}/`, ''));
        }
      }
    }
    expect(offenders, 'Production code reached into benchmark/ by relative path.').toEqual([]);
  });

  it('no production package depends on @platform/benchmark', () => {
    const packages = [
      'apps/api/package.json',
      'apps/web/package.json',
      'packages/db/package.json',
      'packages/permissions/package.json',
      'packages/providers/package.json',
    ];
    for (const relative of packages) {
      const path = join(repoRoot, relative);
      if (!existsSync(path)) continue;
      const pkg = JSON.parse(readFileSync(path, 'utf8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const all = { ...pkg.dependencies, ...pkg.devDependencies };
      expect(
        Object.keys(all),
        `${relative} depends on the benchmark package`,
      ).not.toContain('@platform/benchmark');
    }
  });

  it('no provider name appears in production source outside adapter directories', () => {
    // The one thing the customer-facing abstraction promises is that a vendor
    // choice never leaks into the product. A provider name in production code
    // is that promise broken — UNLESS the code lives inside the adapter
    // directory designated for that provider (VENDOR_ADAPTER_DIRS above).
    //
    // Every vendor named anywhere in the benchmark or the phase documents. An
    // omission here is a hole in the only check that enforces the promise, and
    // 'azure'/'microsoft' were missing while Azure was one of the four
    // benchmarked providers — named in this file's own header.
    const VENDORS = [
      'sarvam', 'deepgram', 'cartesia', 'assemblyai',
      'azure', 'microsoft', 'cognitiveservices', 'openai', 'anthropic',
      'google', 'gcp', 'aws', 'rime', 'smallest',
      'plivo', 'twilio', 'exotel', 'knowlarity', 'ozonetel',
      'airtel', 'tanla', 'kaleyra',
    ];

    /**
     * Vendors that ARE allowed in production, but only inside their designated
     * adapter directories listed in VENDOR_ADAPTER_DIRS.
     */
    const ADAPTER_ONLY_VENDORS = ['elevenlabs'];

    const offenders: string[] = [];

    for (const tree of PRODUCTION_TREES) {
      for (const file of sourceFiles(tree)) {
        const relPath = file.replace(`${repoRoot}/`, '');
        const isAdapterDir = VENDOR_ADAPTER_DIRS.some((d) => relPath.startsWith(d));

        const src = readFileSync(file, 'utf8');
        // Strip comments: the provider interfaces legitimately DISCUSS
        // candidates in prose, which is documentation, not a dependency.
        //
        // The line-comment pattern must NOT match the `//` inside a URL — a
        // naive /\/\/.*$/ deleted everything after "https:" on any line
        // containing a link, which silently removed real code from the scan.
        const code = stripComments(src).toLowerCase();

        /**
         * Check raw (comment-stripped, NOT yet lowercased) source lines for
         * a vendor reference. Returns true only when the occurrence is a REAL
         * SDK violation — not just an env-var name, config string, or import
         * path pointing to our own adapter directory.
         *
         * Allowed occurrences outside adapter dirs:
         *   1. import/export from a RELATIVE path (our own adapters): no violation.
         *      Only flagged when from an external npm package.
         *   2. UPPER_CASE env-var tokens (ELEVENLABS_ENABLED etc.): not SDK usage.
         *   3. String literals that are simple config/default values
         *      (.default('elevenlabs'), provider: 'elevenlabs').
         */
        const strippedSrc = stripComments(src);

        function isRealVendorViolation(rawLine: string, vendor: string): boolean {
          const lc = rawLine.toLowerCase();
          if (!lc.includes(vendor)) return false;

          const t = rawLine.trim();
          const lct = t.toLowerCase();

          // import / export / multi-line `from '...'` / `import('...')` type refs.
          // Relative paths into OUR adapter folders are wiring; npm packages are not.
          const looksLikeImport =
            /^(import|export)\b/i.test(t) ||
            /\bfrom\s+['"`]/i.test(t) ||
            /\bimport\s*\(/i.test(t);
          if (looksLikeImport) {
            const vendorPkg = `@${vendor}/`;
            return lct.includes(`'${vendorPkg}`) || lct.includes(`"${vendorPkg}`)
              || lct.includes(`'${vendor}'`) || lct.includes(`"${vendor}"`);
          }

          // Remove UPPER_CASE identifiers (env-var names like ELEVENLABS_ENABLED)
          const withoutUppercase = rawLine.replace(/\b[A-Z][A-Z0-9_]{2,}\b/g, '');
          // After lowercasing survivors, also strip env-style vendor_ prefixes.
          const withoutEnv = withoutUppercase
            .toLowerCase()
            .replace(new RegExp(`\\b${vendor}[_-][a-z0-9_]+\\b`, 'g'), '');
          if (!withoutEnv.includes(vendor)) return false;

          // Simple config/default string value (e.g. .default('elevenlabs') or provider: 'elevenlabs')
          if (/\.(default|notNull)\(['"`][\w-]*['"`]\)/.test(rawLine)) return false;
          if (/\bdefault:\s*['"`][\w-]*['"`]/.test(rawLine)) return false;
          if (/:\s*text\([\w'"]+\).*\.default\(/.test(rawLine)) return false;
          if (new RegExp(`\\b${vendor}[A-Za-z0-9]*Controller\\b`, 'i').test(rawLine)) return false;

          return true;
        }

        for (const vendor of VENDORS) {
          // Adapter directories are the only place vendor names belong.
          if (isAdapterDir) continue;
          if (code.includes(vendor)) {
            const lines = strippedSrc.split('\n').filter((l) => l.toLowerCase().includes(vendor));
            if (!lines.some((l) => isRealVendorViolation(l, vendor))) continue;
            offenders.push(`${relPath} → ${vendor}`);
          }
        }

        // Adapter-only vendors: allowed inside adapter dirs, banned everywhere else.
        if (!isAdapterDir) {
          for (const vendor of ADAPTER_ONLY_VENDORS) {
            if (code.includes(vendor)) {
              const lines = strippedSrc.split('\n').filter((l) => l.toLowerCase().includes(vendor));
              if (!lines.some((l) => isRealVendorViolation(l, vendor))) continue;
              offenders.push(`${relPath} → ${vendor} (only allowed in adapter dirs)`);
            }
          }
        }
      }
    }
    expect(
      offenders,
      'A provider name appears in production CODE (not comments) outside its adapter ' +
        'directory. Providers are selected by DI binding; their names belong only inside ' +
        'the adapter directories listed in VENDOR_ADAPTER_DIRS.',
    ).toEqual([]);
  });

  it('the benchmark package is not inside apps/ or packages/', () => {
    // Structural separation beats a convention. If someone moves it under
    // apps/, the workspace globs would pick it up as a production app and
    // every check above would start passing vacuously.
    expect(existsSync(join(repoRoot, 'benchmark/package.json'))).toBe(true);
    expect(existsSync(join(repoRoot, 'apps/benchmark'))).toBe(false);
    expect(existsSync(join(repoRoot, 'packages/benchmark'))).toBe(false);
  });

  it('no provider SDK is installed anywhere, including the benchmark package', () => {
    // The benchmark uses fetch, so even its isolated package needs no SDK —
    // which makes the "no SDK in production" boundary trivially true rather
    // than merely enforced.
    //
    // NOTE: @elevenlabs/elevenlabs-js (apps/api) and @elevenlabs/react (apps/web)
    // are deliberately excluded from this benchmark check — they are production
    // dependencies selected for MVP-01 and verified in phase-boundary.test.ts.
    const pkg = JSON.parse(
      readFileSync(join(repoRoot, 'benchmark/package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    const SDKS = [
      '@anthropic-ai/sdk', 'openai', '@google-cloud/speech', '@google-cloud/text-to-speech',
      '@deepgram/sdk', 'sarvamai', '@elevenlabs/elevenlabs-js', '@elevenlabs/react',
      '@cartesia/cartesia-js', 'microsoft-cognitiveservices-speech-sdk', 'twilio', 'plivo',
    ];
    expect(declared.filter((d) => SDKS.includes(d))).toEqual([]);
  });
});
