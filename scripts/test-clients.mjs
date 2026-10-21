#!/usr/bin/env node
/* global fetch, setTimeout */
/**
 * pnpm test:clients — the client-integration e2e against a real stack:
 * local compose Postgres (a dedicated `platform_clients_test` database, so
 * the developer's `platform` data is untouched), the API and worker on tsx,
 * and the apps/voice container running test calls on the fake line. Acme
 * itself is started on :4100 inside the vitest run, because check 8 stops
 * and restarts its webhook listener.
 *
 * Exotel and ElevenLabs settings are never passed to the API: nothing can
 * dial a real phone from this run.
 *
 * Extra arguments go to vitest (e.g. `pnpm test:clients -t "v1 [1-3]\."`).
 * Exits with vitest's exit code; tears everything down on any exit. Logs of
 * the API, worker and voice container stay in the printed temp directory.
 */

import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, mkdtempSync, existsSync, openSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';

const root = resolve(import.meta.dirname, '..');
const DB = 'platform_clients_test';
const VOICE_CONTAINER = 'platform-voice-clients-test';
const ADMIN_EMAIL = 'clients-admin@example.test';
// CLIENTS_API_PORT moves the API off 3001 when a dev API is already running there.
const API_PORT = process.env.CLIENTS_API_PORT ?? '3001';
const PG = { app: 'app_local_dev', migrator: 'migrator_local_dev' };
const appUrl = `postgresql://platform_app:${process.env.POSTGRES_APP_PASSWORD ?? PG.app}@localhost:5434/${DB}`;
const migrationUrl = `postgresql://platform_migrator:${process.env.POSTGRES_MIGRATOR_PASSWORD ?? PG.migrator}@localhost:5434/${DB}`;

const logDir = mkdtempSync(join(tmpdir(), 'hrvoice-clients-'));
const children = [];
let voiceStarted = false;

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: ['pipe', 'inherit', 'inherit'], ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} exited ${r.status}`);
  return r;
}

function teardown() {
  for (const child of children) {
    // Detached: the negative pid kills pnpm/tsx and everything under them.
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
  }
  if (voiceStarted) {
    const fd = openSync(join(logDir, 'voice.log'), 'w');
    spawnSync('docker', ['logs', VOICE_CONTAINER], { stdio: ['ignore', fd, fd] });
    closeSync(fd);
    spawnSync('docker', ['rm', '-f', VOICE_CONTAINER], { stdio: 'ignore' });
  }
}
process.on('exit', teardown);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

function portFree(port) {
  return new Promise((ok) => {
    const s = createConnection({ port, host: '127.0.0.1' });
    s.once('connect', () => { s.destroy(); ok(false); });
    s.once('error', () => ok(true));
  });
}

async function waitFor(url, label, ms = 90_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} did not become healthy at ${url} (logs: ${logDir})`);
}

function start(name, args, env) {
  const fd = openSync(join(logDir, `${name}.log`), 'a');
  const child = spawn('pnpm', args, { cwd: root, env, detached: true, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  children.push(child);
  child.on('exit', (code) => {
    if (code !== null && code !== 0) console.error(`${name} exited ${code} (log: ${logDir}/${name}.log)`);
  });
}

function tail(name, lines = 40) {
  try {
    const text = readFileSync(join(logDir, `${name}.log`), 'utf8').trimEnd().split('\n');
    console.error(`--- last ${lines} lines of ${name}.log ---\n${text.slice(-lines).join('\n')}`);
  } catch { /* no log */ }
}

async function main() {
  for (const port of [Number(API_PORT), 4100, 8765]) {
    if (!(await portFree(port))) throw new Error(`port ${port} is in use; stop whatever is on it first`);
  }

  // Provider keys for the real voice loop. Values are only ever passed by env, never printed.
  const dotenv = parseEnv(readFileSync(join(root, '.env'), 'utf8'));
  const providers = {};
  for (const k of ['DEEPGRAM_API_KEY', 'SARVAM_API_KEY', 'GEMINI_API_KEY', 'GEMINI_BASE_URL', 'GEMINI_MODEL']) {
    const v = process.env[k] || dotenv[k];
    if (!v) throw new Error(`${k} is not set in .env`);
    providers[k] = v;
  }
  const voiceToken = randomBytes(24).toString('hex');
  const adc = join(homedir(), '.config/gcloud/application_default_credentials.json');
  if (!existsSync(adc)) console.warn('· no gcloud application-default login: Google voices will fail');

  console.log('· postgres (local compose)');
  run('docker', ['compose', 'up', '-d', '--wait', 'postgres']);
  const psql = (sqlText, db = 'postgres') =>
    run('docker', ['exec', '-i', 'platform-postgres', 'psql', '-q', '-U', 'postgres', '-d', db], {
      input: sqlText,
      stdio: ['pipe', 'ignore', 'inherit'],
    });
  psql(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE);\nCREATE DATABASE ${DB};`);
  // Same bootstrap as a fresh volume, minus the cluster-wide roles that already exist.
  const initDir = join(root, 'docker/postgres/init');
  for (const f of ['00-extensions-and-roles.sql', '01-tenant-context-functions.sql']) {
    const text = readFileSync(join(initDir, f), 'utf8')
      .replace(/CREATE ROLE [\s\S]*?;/g, '')
      .replaceAll('DATABASE platform ', `DATABASE ${DB} `);
    psql(`\\set ON_ERROR_STOP on\n${text}`, DB);
  }
  console.log('· migrate');
  run('pnpm', ['-s', 'db:migrate'], {
    env: { ...process.env, DATABASE_MIGRATION_URL: migrationUrl },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  console.log('· voice image');
  run('docker', ['build', '-q', '-t', 'platform-voice:dev', 'apps/voice'], { stdio: ['ignore', 'ignore', 'inherit'] });
  spawnSync('docker', ['rm', '-f', VOICE_CONTAINER], { stdio: 'ignore' });
  voiceStarted = true;
  run(
    'docker',
    [
      'run', '-d', '--name', VOICE_CONTAINER, '-p', '8765:8765',
      '--add-host', 'host.docker.internal:host-gateway',
      // Google voices sign in with this machine's gcloud login (gcloud auth application-default login).
      ...(existsSync(adc) ? ['-v', `${adc}:/gcloud/adc.json:ro`, '-e', 'GOOGLE_APPLICATION_CREDENTIALS=/gcloud/adc.json', '-e', `GOOGLE_CLOUD_QUOTA_PROJECT=${process.env.GOOGLE_CLOUD_QUOTA_PROJECT || 'hrvoice-prod-10097299'}`] : []),
      '-e', `NEST_INTERNAL_URL=http://host.docker.internal:${API_PORT}`,
      // Name-only -e: values come from this process's env, so they never sit in argv.
      ...['VOICE_INTERNAL_TOKEN', ...Object.keys(providers)].flatMap((k) => ['-e', k]),
      'platform-voice:dev',
    ],
    { env: { ...process.env, ...providers, VOICE_INTERNAL_TOKEN: voiceToken }, stdio: ['ignore', 'ignore', 'inherit'] },
  );

  // A clean env: nothing Exotel/ElevenLabs from the shell, so no carrier is configured.
  const base = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !/^(EXOTEL_|ELEVENLABS_|DATABASE_|CALLING_HOURS_NOW)/.test(k)),
  );
  const istToday = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const apiEnv = {
    ...base,
    NODE_ENV: 'development',
    API_PORT,
    API_URL: `http://localhost:${API_PORT}`,
    WEB_URL: 'http://localhost:3000',
    DATABASE_URL: appUrl,
    BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
    COOKIE_SECURE: 'false',
    NOTIFICATION_TRANSPORT: 'console',
    LOG_LEVEL: 'info',
    RATE_LIMIT_MAX: '10000',
    JOBS_ENABLED: 'true',
    ELEVENLABS_ENABLED: 'false',
    VOICE_OWN_LOOP_ENABLED: 'true',
    VOICE_INTERNAL_TOKEN: voiceToken,
    VOICE_SERVICE_URL: 'http://localhost:8765',
    PLATFORM_ADMIN_EMAILS: ADMIN_EMAIL,
    // Inside calling hours; test calls skip hours anyway.
    CALLING_HOURS_NOW: `${istToday}T12:00:00+05:30`,
    GEMINI_API_KEY: providers.GEMINI_API_KEY,
    GEMINI_BASE_URL: providers.GEMINI_BASE_URL,
    GEMINI_MODEL: providers.GEMINI_MODEL,
  };
  console.log(`· api + worker (logs: ${logDir})`);
  start('api', ['--filter', '@platform/api', 'exec', 'tsx', 'src/main.ts'], apiEnv);
  start('worker', ['--filter', '@platform/api', 'exec', 'tsx', 'src/jobs/worker.ts'], apiEnv);
  await waitFor(`http://localhost:${API_PORT}/health`, 'api');
  await waitFor('http://localhost:8765/health', 'voice');

  console.log('· vitest apps/acme/test');
  const vitest = spawnSync('pnpm', ['--filter', '@platform/acme', 'exec', 'vitest', 'run', 'test', ...process.argv.slice(2)], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      HRVOICE_API_URL: `http://localhost:${API_PORT}`,
      ACME_PORT: '4100',
      CLIENTS_ADMIN_EMAIL: ADMIN_EMAIL,
      CLIENTS_TEST_DB: DB,
    },
  });
  if (vitest.status !== 0) {
    tail('api');
    tail('worker');
    spawnSync('docker', ['logs', '--tail', '40', VOICE_CONTAINER], { stdio: 'inherit' });
  }
  return vitest.status ?? 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    tail('api');
    tail('worker');
    process.exit(1);
  },
);
