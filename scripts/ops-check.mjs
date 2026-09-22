#!/usr/bin/env node
/**
 * Operator readiness check for the hiring desk (non-secret).
 * Exit 0 when the stack looks operable for a company deploy.
 * Exit 1 on hard failures. With CI_OPS_OPTIONAL=true, voice/KYC gaps warn only.
 *
 * Usage:
 *   node scripts/ops-check.mjs
 *   API_URL=http://localhost:3001 node scripts/ops-check.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const optional = process.env.CI_OPS_OPTIONAL === 'true';
const apiUrl = (process.env.API_URL || 'http://localhost:3001').replace(/\/$/, '');

function loadDotEnv() {
  const path = resolve(root, '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadDotEnv();

const warnings = [];
const failures = [];

function ok(msg) {
  console.log(`✓ ${msg}`);
}
function warn(msg) {
  warnings.push(msg);
  console.log(`⚠ ${msg}`);
}
function fail(msg) {
  failures.push(msg);
  console.log(`✗ ${msg}`);
}

console.log('Hiring ops readiness\n');

try {
  const res = await fetch(`${apiUrl}/health`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) {
    if (optional) warn(`API health HTTP ${res.status} (${apiUrl}/health)`);
    else fail(`API health HTTP ${res.status} (${apiUrl}/health)`);
  } else {
    const body = await res.json();
    if (body.status !== 'ok') fail(`API health status=${body.status}`);
    else ok(`API health → ok (${apiUrl}/health)`);
    const r = body.readiness ?? {};
    if (r.email === 'smtp') ok('Email transport: smtp');
    else if (r.email)
      warn('Email transport is console — invites/reset need SMTP for real delivery');
    if (r.storage === 's3') ok('Object storage: s3');
    else if (r.storage)
      warn('Object storage is local — set STORAGE_BACKEND=s3 before real candidate docs');
    if (r.voiceEnabled) ok('Voice enabled');
    else if (r.voiceEnabled === false) warn('Voice disabled (ELEVENLABS_ENABLED=false)');
    if (r.outboundConfigured) ok('Outbound phone configured');
    else if (r.outboundConfigured === false)
      warn('Outbound phone not configured (no phone number id)');
    if (r.openOutbound) ok('Open outbound flag on (TELEPHONY_OPEN_OUTBOUND=true)');
    else if (r.openOutbound === false)
      warn(
        'Open outbound off — carrier KYC/PAN then TELEPHONY_OPEN_OUTBOUND=true for any-resume dialing',
      );
    if (r.jobsEnabled) ok('Background jobs enabled');
    else if (r.jobsEnabled === false)
      warn('JOBS_ENABLED=false — emails/indexing run inline or not at all');
    if (typeof r.jobsBacklog === 'number') {
      if (r.jobsBacklog > 0)
        warn(
          `Job backlog: ${r.jobsBacklog} queued >2m — is the worker running? (pnpm dev:worker / compose worker)`,
        );
      else ok('Job queue backlog clear');
    }
  }
} catch (e) {
  const msg = `API unreachable at ${apiUrl}/health (${e instanceof Error ? e.message : e})`;
  if (optional) warn(msg);
  else fail(msg);
}

if (!existsSync(resolve(root, 'docker/Caddyfile'))) fail('Missing docker/Caddyfile');
else ok('Caddyfile present');
if (!existsSync(resolve(root, 'docker-compose.prod.yml'))) fail('Missing docker-compose.prod.yml');
else ok('docker-compose.prod.yml present');
if (!existsSync(resolve(root, 'scripts/backup.sh'))) fail('Missing scripts/backup.sh');
else ok('backup.sh present');

console.log('');
if (failures.length) {
  console.log(`FAIL: ${failures.length} hard issue(s).`);
  process.exit(1);
}
if (warnings.length) {
  console.log(`PASS with ${warnings.length} warning(s).`);
  process.exit(optional ? 0 : 0);
}
console.log('PASS: ops surface looks ready.');
process.exit(0);
