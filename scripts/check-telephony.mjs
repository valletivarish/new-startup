#!/usr/bin/env node
/**
 * Operator checklist: is live outbound phone ready?
 * Usage (from repo root, with .env loaded or env exported):
 *   node scripts/check-telephony.mjs
 *
 * Does not print secrets. Safe to run in CI logs.
 * READY is never claimed unless the phone number id still exists
 * at the voice provider (live GET), not merely because env is set.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Load KEY=VALUE pairs from a .env file without printing values. */
function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env) || process.env[key] === '') {
      process.env[key] = value;
    }
  }
}

loadEnvFile(resolve(process.cwd(), '.env'));
loadEnvFile(resolve(process.cwd(), 'apps/api/.env'));

const enabled = String(process.env.ELEVENLABS_ENABLED || '').toLowerCase() === 'true';
const phoneId = (process.env.ELEVENLABS_PHONE_NUMBER_ID || '').trim();
const apiKey = (process.env.ELEVENLABS_API_KEY || '').trim();
const provider = process.env.ELEVENLABS_OUTBOUND_PROVIDER || 'primary';

const steps = [];

function ok(msg) {
  steps.push({ ok: true, msg });
}
function bad(msg) {
  steps.push({ ok: false, msg });
}

if (!enabled) {
  bad('ELEVENLABS_ENABLED is not true — voice stays off.');
} else {
  ok('ELEVENLABS_ENABLED=true');
}

if (!apiKey) {
  bad('ELEVENLABS_API_KEY is empty.');
} else {
  ok(`ELEVENLABS_API_KEY is set (${apiKey.length} chars).`);
}

if (!phoneId) {
  bad(
    'ELEVENLABS_PHONE_NUMBER_ID is empty. Import a production India DID (open outbound to resume phones) in the voice console, then set this id.',
  );
} else {
  ok(`ELEVENLABS_PHONE_NUMBER_ID is set (${phoneId.slice(0, 6)}…).`);
}

ok(`ELEVENLABS_OUTBOUND_PROVIDER=${provider}`);
if (provider !== 'india') {
  bad(
    'For India hiring screens prefer ELEVENLABS_OUTBOUND_PROVIDER=india (linked India carrier). primary is the international path.',
  );
}

const appId = (process.env.EXOTEL_APP_ID || '').trim();
if (provider === 'india') {
  if (!appId) {
    bad(
      'EXOTEL_APP_ID is empty. Use the Exotel Voicebot flow App ID (not Landing Flow / Sales).',
    );
  } else {
    ok(`EXOTEL_APP_ID is set (${appId}). Re-import the DID after changing it.`);
  }
}

/** Live probe: env alone is not enough — deleted phone ids must fail READY. */
async function probePhoneNumberExists() {
  if (!enabled || !apiKey || !phoneId) return null;
  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/convai/phone-numbers/${encodeURIComponent(phoneId)}`,
      {
        headers: { 'xi-api-key': apiKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (res.status === 404) {
      return {
        exists: false,
        detail: 'document_not_found — this phone id is gone; reconnect a live DID.',
      };
    }
    if (!res.ok) {
      return { exists: false, detail: `HTTP ${res.status} looking up phone id.` };
    }
    return { exists: true };
  } catch (e) {
    return {
      exists: false,
      detail: e instanceof Error ? e.message : 'phone id probe failed',
    };
  }
}

/** Live carrier KYC probe — never prints secrets. */
async function probeExotelKyc() {
  const sid = (process.env.EXOTEL_ACCOUNT_SID || '').trim();
  const key = (process.env.EXOTEL_API_KEY || '').trim();
  const token = (process.env.EXOTEL_API_TOKEN || '').trim();
  if (!sid || !key || !token) return null;
  const sub = (process.env.EXOTEL_API_SUBDOMAIN || 'api.in.exotel.com').trim();
  const auth = Buffer.from(`${key}:${token}`).toString('base64');
  try {
    const res = await fetch(`https://${sub}/v1/Accounts/${encodeURIComponent(sid)}.json`, {
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const data = await res.json();
    const account = data?.Account ?? data?.account ?? {};
    return {
      status: account.Status ?? account.status ?? null,
      kyc: account.KycStatus ?? account.kyc_status ?? account.Kyc_Status ?? null,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'probe failed' };
  }
}

const phoneProbe = await probePhoneNumberExists();
let phoneExists = false;
if (phoneProbe === null) {
  // Skipped — env incomplete; already reported above.
} else if (phoneProbe.exists) {
  phoneExists = true;
  ok('Live phone id exists at the voice provider.');
} else {
  bad(
    `Live phone id check failed: ${phoneProbe.detail} Call phone will show “phone line not valid anymore” until you set a real id.`,
  );
}

console.log('Telephony readiness\n');
for (const s of steps) {
  console.log(`${s.ok ? '✓' : '✗'} ${s.msg}`);
}
console.log('');

const kycProbe = await probeExotelKyc();
if (kycProbe) {
  if (kycProbe.error) {
    console.log(`Carrier KYC probe: could not read status (${kycProbe.error}).`);
  } else {
    console.log(
      `Carrier account: status=${kycProbe.status ?? 'unknown'} · KYC=${kycProbe.kyc ?? 'unknown'}`,
    );
    const kyc = String(kycProbe.kyc || '').toLowerCase();
    // Only mention PAN when the company DID itself is live — a dead phnum_ is the
    // real Call-phone blocker and must not be drowned out by "verified number" noise.
    if (
      phoneExists &&
      kyc &&
      kyc !== 'approved' &&
      kyc !== 'verified' &&
      kyc !== 'complete' &&
      kyc !== 'completed'
    ) {
      console.log(
        'Company DID is linked. If dial still fails after reconnect, finish PAN on the phone account.',
      );
    }
  }
  console.log('');
}

const envReady =
  enabled && Boolean(apiKey) && Boolean(phoneId) && provider === 'india' && Boolean(appId);
const ready = envReady && phoneExists;

if (ready) {
  console.log('READY: Call phone can dial when the API is restarted with this env.');
  console.log('Smoke: publish agent → link to job → candidate with +91 phone → Call phone.');
  const openOutbound =
    String(process.env.TELEPHONY_OPEN_OUTBOUND || '').toLowerCase() === 'true';
  if (openOutbound) {
    console.log('TELEPHONY_OPEN_OUTBOUND=true — desk will treat resume dialing as fully open.');
  } else {
    console.log(
      'Optional: after PAN is done on the phone account, set TELEPHONY_OPEN_OUTBOUND=true and restart API.',
    );
  }
  process.exit(0);
}

// CI without voice secrets: report NOT READY but exit 0 so the job stays honest
// without needing `|| true`. Local/operator runs and CI with voice enabled still fail.
const optionalCi =
  String(process.env.CI_TELEPHONY_OPTIONAL || '').toLowerCase() === 'true' && !enabled;
if (optionalCi) {
  console.log('NOT READY (expected): voice disabled in this CI job — no live phone secrets.');
  console.log('Set CI_TELEPHONY_OPTIONAL=false and real secrets to enforce telephony readiness.');
  process.exit(0);
}

if (envReady && !phoneExists) {
  console.log(
    'NOT READY: env looks complete but the phone number id is missing at the provider.',
  );
  console.log(
    'Import or re-link a live India DID → copy the new phnum_… into ELEVENLABS_PHONE_NUMBER_ID → restart API.',
  );
  process.exit(1);
}

console.log('NOT READY: browser demo still works; live phone stays honestly blocked.');
console.log(
  'Required for hiring: KYC + paid India DID with open outbound to any resume phone; Voicebot App ID (not Landing Flow); import → ELEVENLABS_PHONE_NUMBER_ID + ELEVENLABS_OUTBOUND_PROVIDER=india → restart API.',
);
process.exit(1);
