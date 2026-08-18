/**
 * Phase boundary guards.
 *
 * These encode the founder's Phase 1 constraints as executable checks, so that
 * "no provider SDK was added" and "no Phase 2–8 functionality was built" are
 * verified facts rather than claims in a report.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');

function deps(pkgRelPath: string): string[] {
  const raw = readFileSync(join(repoRoot, pkgRelPath, 'package.json'), 'utf8');
  const pkg = JSON.parse(raw) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ];
}

/**
 * Every AI and telephony provider named as a candidate in
 * `06_PROVIDER_AND_COST_SPEC`, plus the SDK package names they ship under.
 */
const FORBIDDEN_PROVIDER_SDKS = [
  '@anthropic-ai/sdk',
  'openai',
  '@google/generative-ai',
  '@google/genai',
  '@google-cloud/speech',
  '@google-cloud/text-to-speech',
  'twilio',
  'plivo',
  'elevenlabs',
  '@elevenlabs/elevenlabs-js',
  '@deepgram/sdk',
  'sarvamai',
  '@aws-sdk/client-polly',
  '@aws-sdk/client-transcribe',
  'livekit-server-sdk',
  '@livekit/agents',
  'pipecat-ai',
  'langchain',
  '@langchain/core',
  'llamaindex',
  'ai',
  '@ai-sdk/openai',
  '@ai-sdk/anthropic',
  '@ai-sdk/google',
];

const PACKAGES = [
  'apps/api',
  'apps/web',
  'packages/db',
  'packages/permissions',
  'packages/providers',
];

describe('no external AI or telephony provider SDK is installed', () => {
  it.each(PACKAGES)('%s declares no provider SDK', (pkg) => {
    const declared = deps(pkg);
    const found = declared.filter((d) => FORBIDDEN_PROVIDER_SDKS.includes(d));
    expect(
      found,
      `${pkg} declares a provider SDK. Providers stay behind interfaces until ` +
        `selected on benchmark evidence at their phase (ADR-006 condition, ` +
        `12_ARCHITECTURE_DECISIONS_FINAL.md D2).`,
    ).toEqual([]);
  });

  it('the providers package has no runtime dependencies at all', () => {
    const raw = readFileSync(
      join(repoRoot, 'packages/providers/package.json'),
      'utf8',
    );
    const pkg = JSON.parse(raw) as { dependencies?: Record<string, string> };
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
  });

  it('no provider SDK appears anywhere in the installed tree', () => {
    // A transitive pull-in would be just as much of a lock-in as a direct one.
    const lock = join(repoRoot, 'pnpm-lock.yaml');
    // A missing lockfile FAILS: this guard must never pass vacuously
    // (audit finding — the previous version silently returned).
    expect(existsSync(lock), 'pnpm-lock.yaml must exist for the SDK guard').toBe(
      true,
    );
    const contents = readFileSync(lock, 'utf8');
    const found = FORBIDDEN_PROVIDER_SDKS.filter((sdk) => {
      const escaped = sdk.replace(/[/@.\-+]/g, '\\$&');
      // pnpm-lock v9 quotes scoped keys ('@scope/name@1.2.3':) and leaves
      // bare names unquoted — match both (audit finding: the previous regex
      // could never match a quoted scoped key). Word-anchored so 'ai' does
      // not match inside 'chai' or 'dockerignore'.
      return new RegExp(`\\n\\s+'?${escaped}@\\d`, 'i').test(contents);
    });
    expect(found, 'provider SDKs found in the lockfile').toEqual([]);
  });
});

describe('no Phase 4+ functionality exists', () => {
  // Phase 2 (agents, versions, sessions, events) and Phase 3 (knowledge
  // sources, documents, chunks) are deliverables and are deliberately absent
  // from this list. Everything below still belongs to a later phase.
  const FORBIDDEN_TABLES = [
    'jobs',
    'candidates',
    'conversations',
    'messages',
    'calls',
    'evaluations',
    'workflows',
    'workflow_runs',
    'actions',
    'integrations',
    'usage_events',
    'cost_events',
    'subscriptions',
  ];

  it('no migration defines a later-phase table', () => {
    const schemaIndex = readFileSync(
      join(repoRoot, 'packages/db/src/schema/index.ts'),
      'utf8',
    );
    // EVERY migration, not just the first — later migrations must not smuggle
    // tables in either (audit finding).
    const drizzleDir = join(repoRoot, 'packages/db/drizzle');
    const migrations = readdirSync(drizzleDir)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => readFileSync(join(drizzleDir, f), 'utf8'))
      .join('\n');

    for (const table of FORBIDDEN_TABLES) {
      expect(
        new RegExp(`CREATE TABLE "?${table}"?`, 'i').test(migrations),
        `a migration creates ${table}, which belongs to a later phase`,
      ).toBe(false);
      expect(
        new RegExp(`\\b${table}\\b`).test(schemaIndex),
        `schema exports ${table}, which belongs to a later phase`,
      ).toBe(false);
    }
  });

  it('the providers package contains interfaces only, no implementations', () => {
    const files = ['agent-session.ts', 'interfaces.ts', 'index.ts'];
    for (const file of files) {
      const src = readFileSync(
        join(repoRoot, 'packages/providers/src', file),
        'utf8',
      );
      // A class or a concrete exported function would be an implementation.
      expect(
        /export\s+class\s/.test(src),
        `${file} exports a class — Phase 1 defines interfaces only`,
      ).toBe(false);
      expect(
        /export\s+(async\s+)?function\s/.test(src),
        `${file} exports a function — Phase 1 defines interfaces only`,
      ).toBe(false);
    }
  });
});
