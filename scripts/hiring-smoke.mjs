#!/usr/bin/env node
/**
 * Non-dialing hiring loop smoke for operators.
 *
 * 1) Public health (API + web)
 * 2) Authenticated spine: signup → company → packs → agent → job → candidate
 * Does NOT place calls or touch carrier consoles.
 *
 * Usage (API on :3001, web on :3000):
 *   node scripts/hiring-smoke.mjs
 */

const API = (process.env.API_URL || 'http://localhost:3001').replace(/\/$/, '');
const WEB = (process.env.WEB_URL || 'http://localhost:3000').replace(/\/$/, '');

function cookieFrom(res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  if (raw.length > 0) {
    return raw.map((c) => c.split(';')[0]).join('; ');
  }
  const single = res.headers.get('set-cookie');
  if (!single) return '';
  return single
    .split(/,(?=[^;]+?=)/)
    .map((c) => c.split(';')[0].trim())
    .join('; ');
}

async function check(label, url, expectOk = true) {
  try {
    const res = await fetch(url, { redirect: 'manual' });
    const ok = expectOk ? res.status >= 200 && res.status < 400 : true;
    console.log(`${ok ? '✓' : '✗'} ${label} → HTTP ${res.status} (${url})`);
    return ok;
  } catch (err) {
    console.log(`✗ ${label} → ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

async function apiJson(method, path, { cookie, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      origin: WEB,
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { res, text, json, cookie: cookieFrom(res) || cookie || '' };
}

console.log('Hiring loop smoke (no dials)\n');

const publicOk = (
  await Promise.all([
    check('API health', `${API}/health`),
    check('Web landing', `${WEB}/`),
    check('Web login', `${WEB}/login`),
    check('Web health proxy', `${WEB}/api/health`),
  ])
).every(Boolean);

let authOk = false;
if (publicOk) {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `smoke-${stamp}@example.test`;
  const password = 'Smoke-Test-Pass-123!';

  try {
    const signup = await apiJson('POST', '/api/auth/sign-up/email', {
      body: { email, password, name: 'Smoke Operator' },
    });
    if (signup.res.status >= 400) {
      console.log(`✗ Signup → HTTP ${signup.res.status}`);
    } else {
      let cookie = signup.cookie;
      console.log(`✓ Signup → HTTP ${signup.res.status}`);

      // Hit API directly (not web /backend rewrite).
      const org = await apiJson('POST', '/organizations/ensure', {
        cookie,
        body: { name: `Smoke Co ${stamp}` },
      });
      if (org.res.status >= 400) {
        console.log(`✗ Create company → HTTP ${org.res.status} ${org.text.slice(0, 120)}`);
      } else {
        cookie = org.cookie || cookie;
        console.log(`✓ Create company → HTTP ${org.res.status}`);

        // ensure is idempotent — second call must not create a second company
        const orgAgain = await apiJson('POST', '/organizations/ensure', {
          cookie,
          body: { name: `Other Co ${stamp}` },
        });
        const ensureOk =
          orgAgain.res.status < 400 && orgAgain.json?.created === false;
        console.log(
          `${ensureOk ? '✓' : '✗'} Ensure company idempotent → HTTP ${orgAgain.res.status} created=${orgAgain.json?.created}`,
        );

        const packs = await apiJson('GET', '/agents/packs', { cookie });
        const packIds = (packs.json?.packs ?? []).map((p) => p.id);
        const packsOk =
          packs.res.status === 200 &&
          packIds.includes('hiring') &&
          !packIds.includes('custom');
        console.log(
          `${packsOk ? '✓' : '✗'} List packs → HTTP ${packs.res.status} (${packIds.join(',') || 'none'})`,
        );

        const agent = await apiJson('POST', '/agents', {
          cookie,
          body: {
            name: `Smoke Screener ${stamp}`,
            purpose: 'Screen candidates for the smoke role',
            agentType: 'hiring',
            mustAskQuestions: [
              'What is your full name?',
              'How many years of relevant experience do you have for this role?',
            ],
          },
        });
        const agentOk =
          agent.res.status === 201 && agent.json?.id && agent.json?.versionId;
        console.log(
          `${agentOk ? '✓' : '✗'} Create hiring agent → HTTP ${agent.res.status}`,
        );

        let publishOk = false;
        if (agentOk) {
          const published = await apiJson(
            'POST',
            `/agents/${agent.json.id}/versions/${agent.json.versionId}/publish`,
            { cookie, body: {} },
          );
          publishOk = published.res.status === 200 || published.res.status === 201;
          console.log(
            `${publishOk ? '✓' : '✗'} Publish hiring agent → HTTP ${published.res.status}`,
          );
        } else {
          console.log('✗ Publish hiring agent → skipped');
        }

        const job = await apiJson('POST', '/jobs', {
          cookie,
          body: {
            title: `Smoke Role ${stamp}`,
            ...(agentOk ? { agentId: agent.json.id } : {}),
          },
        });
        const jobOk = job.res.status === 201 && job.json?.id;
        console.log(`${jobOk ? '✓' : '✗'} Create job → HTTP ${job.res.status}`);

        const cand = await apiJson('POST', '/candidates', {
          cookie,
          body: { fullName: 'Smoke Candidate', phone: '+918919504427' },
        });
        const candOk = cand.res.status === 201 && cand.json?.id;
        console.log(
          `${candOk ? '✓' : '✗'} Create candidate → HTTP ${cand.res.status}`,
        );

        let assignOk = false;
        if (jobOk && candOk) {
          const assign = await apiJson('POST', `/jobs/${job.json.id}/candidates`, {
            cookie,
            body: { candidateId: cand.json.id },
          });
          assignOk = assign.res.status === 201;
          console.log(
            `${assignOk ? '✓' : '✗'} Assign candidate to job → HTTP ${assign.res.status}`,
          );
        } else {
          console.log('✗ Assign candidate to job → skipped');
        }

        const tel = await apiJson('GET', '/telephony/status', { cookie });
        const telOk =
          tel.res.status === 200 &&
          typeof tel.json?.outboundPhone === 'boolean' &&
          typeof tel.json?.browserDemo === 'boolean' &&
          typeof tel.json?.openOutbound === 'boolean';
        console.log(
          `${telOk ? '✓' : '✗'} Telephony status → HTTP ${tel.res.status}` +
            (telOk
              ? ` (phone=${tel.json.outboundPhone} demo=${tel.json.browserDemo} open=${tel.json.openOutbound})`
              : ''),
        );

        authOk =
          ensureOk &&
          packsOk &&
          agentOk &&
          publishOk &&
          jobOk &&
          candOk &&
          assignOk &&
          telOk;
      }
    }
  } catch (err) {
    console.log(`✗ Authenticated spine → ${err instanceof Error ? err.message : String(err)}`);
    authOk = false;
  }
}

console.log('');
if (publicOk && authOk) {
  console.log(
    'PASS: stack + hiring spine (signup → company → packs → agent → publish → job → candidate).',
  );
  console.log(
    'Next: Call phone (verified mobiles until KYC). Open outbound: pnpm telephony:check.',
  );
  process.exit(0);
}

if (publicOk && !authOk) {
  console.log('FAIL: public health OK but authenticated hiring spine failed.');
  process.exit(1);
}

console.log('FAIL: start API (:3001) and web (:3000), then re-run.');
process.exit(1);
