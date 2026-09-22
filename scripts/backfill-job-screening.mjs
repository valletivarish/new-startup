#!/usr/bin/env node
/**
 * PO Q3 re-runnable migrator wrapper.
 *
 * Prefer `pnpm db:migrate` (applies 0021 once). This script re-runs the same
 * idempotent backfill safely after deploy.
 *
 * Requires DATABASE_MIGRATION_URL (platform_migrator).
 *
 * Usage:
 *   node scripts/backfill-job-screening.mjs
 *   # or
 *   pnpm db:backfill-job-screening
 */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const entry = join(
  repoRoot,
  'packages/db/src/scripts/backfill-job-screening.ts',
);

const result = spawnSync(
  'pnpm',
  ['--filter', '@platform/db', 'exec', 'tsx', entry],
  {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
  },
);

process.exit(result.status ?? 1);
