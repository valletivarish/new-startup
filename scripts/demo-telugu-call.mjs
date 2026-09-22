#!/usr/bin/env node
/**
 * Demo-only Telugu phone screen from the command line.
 * Does NOT change the website job language options (en/hi only).
 *
 * Live API check (this account): agent language `te`/`tel` is REJECTED.
 * Allowed Indian agent langs include `hi` and `ta` only — not Telugu.
 * Demo workaround: Telugu-accent voice (Vandana) + multilingual TTS +
 * Telugu-script first message + Telugu-only prompt.
 *
 * Usage (repo root):
 *   pnpm demo:telugu-call
 *   pnpm demo:telugu-call -- --to=+918919504427
 *
 * Env: ELEVENLABS_API_KEY, ELEVENLABS_PHONE_NUMBER_ID
 * Optional: DEMO_TE_TO, DEMO_TE_AGENT_ID, DEMO_TE_VOICE_ID
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function loadDotEnv() {
  const path = resolve(process.cwd(), '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
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

const apiKey = (process.env.ELEVENLABS_API_KEY || '').trim();
const phoneId = (process.env.ELEVENLABS_PHONE_NUMBER_ID || '').trim();
const defaultTo = (process.env.DEMO_TE_TO || '+918919504427').trim();
const fixedAgentId = (process.env.DEMO_TE_AGENT_ID || '').trim();
/** Vandana - Telugu Relatable Conversation (shared library, added to workspace). */
const DEFAULT_TE_VOICE = 'eh5YJlyB5bmWfcmcEsLN';
const voiceId = (
  process.env.DEMO_TE_VOICE_ID ||
  DEFAULT_TE_VOICE
).trim();

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1].trim();
  return null;
}

const toNumber = argValue('--to') || defaultTo;

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

if (!apiKey) fail('ELEVENLABS_API_KEY is empty.');
if (!phoneId) {
  fail('ELEVENLABS_PHONE_NUMBER_ID is empty. Run pnpm telephony:check / import first.');
}
if (!/^\+[1-9]\d{7,14}$/.test(toNumber)) {
  fail(`Bad --to number "${toNumber}". Use E.164 like +918919504427.`);
}

const headers = {
  'xi-api-key': apiKey,
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

const DEMO_NAME = 'Telugu Demo Screen';

const TELUGU_PROMPT = [
  'మీరు అలెక్స్, హైరింగ్ ఫోన్ స్క్రీనర్.',
  'పూర్తి కాల్ తెలుగులోనే నడపాలి. ఆంగ్లం/హిందీలో మాట్లాడవద్దు (బ్రాండ్ పేర్లు తప్ప).',
  'ఒకేసారి ఒక ప్రశ్న మాత్రమే అడగండి. సమాధానం వచ్చాకే తర్వాతి ప్రశ్న.',
  'ప్రశ్నలు (తెలుగులోనే అడగండి):',
  '1. మీకు ఎన్ని సంవత్సరాల అనుభవం ఉంది?',
  '2. మీరు ప్రస్తుతం ఏ నగరంలో ఉన్నారు?',
  '3. నోటీస్ పీరియడ్ ఎంత?',
  '4. ఈ రోల్ కోసం మీ అంచనా సీటీసీ ఎంత?',
  'చివరి సమాధానం తర్వాత తెలుగులో ధన్యవాదాలు చెప్పి కాల్ ముగించండి.',
  'సమాధానాలు మాత్రమే సేకరించండి. హైర్/రిజెక్ట్ సలహా ఇవ్వవద్దు.',
  'వాయిస్ మెయిల్ వస్తే తెలుగులో చిన్న కాల్‌బ్యాక్ మెసేజ్ చెప్పి ముగించండి.',
  'Speak slowly and clearly. Short sentences only.',
].join('\n');

const FIRST_MESSAGE =
  'నమస్కారం, నేను అలెక్స్. ఈ ఉద్యోగం గురించి రెండు నిమిషాలు మాట్లాడవచ్చా?';

function agentConfig() {
  return {
    name: DEMO_NAME,
    conversation_config: {
      agent: {
        // `te` is not in ElevenAgents language enum for this account (verified live).
        // Use Hindi as closest supported Indian ASR/TTS path + Telugu voice/script.
        language: 'hi',
        first_message: FIRST_MESSAGE,
        prompt: {
          prompt: TELUGU_PROMPT,
          llm: 'gemini-2.0-flash',
        },
      },
      tts: {
        voice_id: voiceId,
        model_id: 'eleven_multilingual_v2',
        stability: 0.75,
        similarity_boost: 0.85,
        speed: 0.88,
        optimize_streaming_latency: 2,
      },
      conversation: {
        max_duration_seconds: 600,
      },
    },
  };
}

async function listAgents() {
  const res = await fetch('https://api.elevenlabs.io/v1/convai/agents', {
    headers: { 'xi-api-key': apiKey },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    fail(`List agents HTTP ${res.status}: ${JSON.stringify(body)?.slice(0, 200)}`);
  }
  return Array.isArray(body) ? body : body?.agents || body?.items || [];
}

async function putAgent(agentId) {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/convai/agents/${encodeURIComponent(agentId)}`,
    {
      method: 'PATCH',
      headers,
      body: JSON.stringify(agentConfig()),
    },
  );
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    fail(
      `Update Telugu demo agent failed HTTP ${res.status}: ${JSON.stringify(body)?.slice(0, 400)}`,
    );
  }
  return agentId;
}

async function ensureDemoAgent() {
  if (fixedAgentId) return putAgent(fixedAgentId);

  const agents = await listAgents();
  const existing = agents.find((a) => (a.name || '') === DEMO_NAME);
  if (existing?.agent_id) return putAgent(existing.agent_id);

  const res = await fetch('https://api.elevenlabs.io/v1/convai/agents/create', {
    method: 'POST',
    headers,
    body: JSON.stringify(agentConfig()),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    fail(
      `Create Telugu demo agent failed HTTP ${res.status}: ${JSON.stringify(body)?.slice(0, 400)}`,
    );
  }
  const id = body?.agent_id || body?.agentId || body?.id;
  if (!id) fail(`Create response missing agent id: ${JSON.stringify(body)?.slice(0, 400)}`);
  return id;
}

async function dial(agentId) {
  const res = await fetch(
    'https://api.elevenlabs.io/v1/convai/exotel/outbound-call',
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        agent_id: agentId,
        agent_phone_number_id: phoneId,
        to_number: toNumber,
      }),
    },
  );
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    fail(`Outbound dial failed HTTP ${res.status}: ${JSON.stringify(body)?.slice(0, 500)}`);
  }
  return body;
}

console.log('Telugu demo call (CLI only — website language unchanged)');
console.log(`To: ${toNumber}`);

const agentId = await ensureDemoAgent();
console.log(`Agent: ${agentId.slice(0, 18)}… (${DEMO_NAME})`);

const result = await dial(agentId);
const ok = Boolean(result?.success ?? result?.conversation_id ?? result?.conversationId);
console.log(ok ? 'Call started — answer for Telugu screen.' : 'Dial returned without success.');
if (result?.conversation_id || result?.conversationId) {
  console.log(`conversation_id=${result.conversation_id || result.conversationId}`);
}
if (result?.callSid || result?.call_sid) {
  console.log(`callSid=${result.callSid || result.call_sid}`);
}
if (!ok) process.exit(1);
