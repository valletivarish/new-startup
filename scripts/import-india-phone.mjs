#!/usr/bin/env node
/**
 * Operator helper: list or import an India DID into the voice console.
 *
 * Product rule: Call phone dials candidate numbers from resumes/jobs.
 * This script never adds a product whitelist — it only links a carrier DID
 * that already allows open outbound (KYC + paid India number).
 *
 * Usage (repo root, .env loaded):
 *   node scripts/import-india-phone.mjs              # list linked numbers
 *   node scripts/import-india-phone.mjs --import      # import when EXOTEL_* set
 *
 * Does not print secrets. Writes nothing to .env (prints the id to paste).
 */

const apiKey = (process.env.ELEVENLABS_API_KEY || '').trim();
const wantImport = process.argv.includes('--import');

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

if (!apiKey) {
  fail('ELEVENLABS_API_KEY is empty.');
}

const headers = {
  'xi-api-key': apiKey,
  'Content-Type': 'application/json',
};

async function listNumbers() {
  const res = await fetch('https://api.elevenlabs.io/v1/convai/phone-numbers', {
    headers: { 'xi-api-key': apiKey },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    fail(`List failed HTTP ${res.status}: ${JSON.stringify(body)?.slice(0, 200)}`);
  }
  const list = Array.isArray(body) ? body : body?.phone_numbers || body?.items || [];
  return list;
}

function printList(list) {
  console.log(`Linked phone numbers: ${list.length}\n`);
  if (list.length === 0) {
    console.log('None yet. Complete India carrier KYC + buy a DID with open outbound,');
    console.log('then re-run with --import (EXOTEL_* env) or import in the voice console.');
    return;
  }
  for (const row of list) {
    const id = row.phone_number_id || row.phoneNumberId || row.id || '?';
    const num = row.phone_number || row.phoneNumber || '?';
    const label = row.label || '';
    console.log(`  id=${id}  number=${num}  ${label}`);
  }
  console.log('\nSet ELEVENLABS_PHONE_NUMBER_ID=<id> and ELEVENLABS_OUTBOUND_PROVIDER=india, then restart API.');
  console.log('Then: pnpm telephony:check');
}

async function importExotel() {
  const phoneNumber = (process.env.EXOTEL_PHONE_NUMBER || '').trim();
  const accountSid = (process.env.EXOTEL_ACCOUNT_SID || '').trim();
  const exotelApiKey = (process.env.EXOTEL_API_KEY || '').trim();
  const apiToken = (process.env.EXOTEL_API_TOKEN || '').trim();
  const appId = (process.env.EXOTEL_APP_ID || '').trim();
  const subdomain = (process.env.EXOTEL_API_SUBDOMAIN || 'api.in.exotel.com').trim();
  const label = (process.env.EXOTEL_LABEL || 'India hiring outbound').trim();

  const missing = [];
  if (!phoneNumber) missing.push('EXOTEL_PHONE_NUMBER');
  if (!accountSid) missing.push('EXOTEL_ACCOUNT_SID');
  if (!exotelApiKey) missing.push('EXOTEL_API_KEY');
  if (!apiToken) missing.push('EXOTEL_API_TOKEN');
  if (!appId) missing.push('EXOTEL_APP_ID');
  if (missing.length) {
    fail(
      `Missing ${missing.join(', ')}. Use a KYC’d production DID (open outbound to resume phones), not a trial whitelist number. EXOTEL_APP_ID must be a Voicebot applet id (not Landing Flow).`,
    );
  }

  const res = await fetch('https://api.elevenlabs.io/v1/convai/phone-numbers', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      provider: 'exotel',
      phone_number: phoneNumber,
      label,
      account_sid: accountSid,
      api_key: exotelApiKey,
      api_token: apiToken,
      api_subdomain: subdomain,
      app_id: appId,
    }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    fail(`Import failed HTTP ${res.status}: ${JSON.stringify(body)?.slice(0, 400)}`);
  }
  const id = body?.phone_number_id || body?.phoneNumberId || body?.id;
  if (!id) {
    fail(`Import response missing id: ${JSON.stringify(body)?.slice(0, 400)}`);
  }
  console.log('Imported India DID into the voice console.');
  console.log(`Paste into .env:\n  ELEVENLABS_PHONE_NUMBER_ID=${id}\n  ELEVENLABS_OUTBOUND_PROVIDER=india`);
  console.log('Restart API, then run: pnpm telephony:check');
}

const list = await listNumbers();
printList(list);

if (wantImport) {
  console.log('');
  await importExotel();
} else if (list.length === 0) {
  console.log('\nWhen KYC + DID are ready: set EXOTEL_* in env and run:');
  console.log('  node scripts/import-india-phone.mjs --import');
  process.exit(1);
}
