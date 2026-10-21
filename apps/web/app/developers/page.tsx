import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { CodeBlock } from '../../components/site/code-block';
import { SiteFooter } from '../../components/site/footer';
import { CONTAINER, Italic, Tag, WORDMARK, siteButton } from '../../components/site/kit';
import { LiquidNav } from '../../components/site/nav-liquid';
import { cn } from '../../components/ui/cn';
import {
  ERROR_INFO,
  EVENT_INFO,
  SCOPE_INFO,
  API_SCOPES,
  WEBHOOK_EVENTS,
  referenceFromOpenApi,
  type ApiReference,
  type RefField,
  type RefOperation,
  type RefShape,
} from '../../lib/developers';

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://nexstopp.com';
/** The public API origin as a client sees it: the website proxies /backend to the API. */
const API_BASE = `${SITE.replace(/\/$/, '')}/backend`;
const OPENAPI_URL = `${API_BASE}/v1/openapi.json`;
const KEYS_HREF = '/settings?section=developers';

const TITLE = `Developers | ${WORDMARK}`;
const DESCRIPTION =
  'Add jobs and candidates, start screening calls and get results from your own system: the HRVoice API, webhooks, SDKs for TypeScript and Python, and an MCP server.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: '/developers' },
  openGraph: { type: 'website', url: '/developers', siteName: WORDMARK, title: TITLE, description: DESCRIPTION },
};

// The reference is read from the running API, refreshed hourly.
export const revalidate = 3600;

async function loadReference(): Promise<ApiReference | null> {
  try {
    const api = process.env.API_URL ?? 'http://localhost:3001';
    const res = await fetch(`${api}/v1/openapi.json`, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const ref = referenceFromOpenApi(await res.json());
    return ref.groups.length ? ref : null;
  } catch {
    return null;
  }
}

const NAV = [
  { href: '#quick-start', label: 'Quick start' },
  { href: '#webhooks', label: 'Webhooks' },
  { href: '#sdks', label: 'SDKs' },
  { href: '#mcp', label: 'MCP' },
  { href: '#reference', label: 'Reference' },
] as const;

const CONTENTS = [
  { href: '#quick-start', label: 'Quick start' },
  { href: '#authentication', label: 'Authentication' },
  { href: '#idempotency', label: 'Idempotency' },
  { href: '#limits', label: 'Rate limits and call limits' },
  { href: '#webhooks', label: 'Webhooks' },
  { href: '#test-mode', label: 'Test mode' },
  { href: '#sdks', label: 'SDKs' },
  { href: '#mcp', label: 'MCP' },
  { href: '#no-code', label: 'No-code tools' },
  { href: '#errors', label: 'Errors' },
  { href: '#reference', label: 'API reference' },
] as const;

/* ------------------------------------------------------------------------------------------ */
/* Samples. Every one matches @hrvoice/sdk, hrvoice (Python), apps/mcp and the /v1 routes.     */

const auth = `-H "Authorization: Bearer $HRVOICE_API_KEY"`;

const QS_JOB = `curl -X POST ${API_BASE}/v1/jobs \\
  ${auth} \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: job-warehouse-supervisor" \\
  -d '{
    "title": "Warehouse Supervisor",
    "mustAskQuestions": ["What is your notice period?", "Can you work night shifts?"]
  }'`;

const QS_CANDIDATE = `curl -X POST ${API_BASE}/v1/jobs/$JOB_ID/candidates \\
  ${auth} \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: ats-42" \\
  -d '{
    "fullName": "Asha Rao",
    "phone": "9000000101",
    "externalId": "ats-42",
    "consent": true
  }'`;

const QS_CALL = `curl -X POST ${API_BASE}/v1/jobs/$JOB_ID/candidates/$CANDIDATE_ID/calls \\
  ${auth} \\
  -H "Idempotency-Key: call-ats-42-1"

# 202 Accepted
# { "id": "…", "status": "queued", "notBefore": null, "result": null, … }`;

const PAYLOAD = `{
  "id": "evt_3b0f6c2e-…",
  "type": "call.completed",
  "createdAt": "2026-10-21T10:42:07.000Z",
  "data": {
    "callId": "8f9d…",
    "jobId": "1c2e…",
    "candidateId": "5a7b…",
    "externalId": "ats-42",
    "isTest": true,
    "result": {
      "status": "completed",
      "startedAt": "2026-10-21T10:38:30.000Z",
      "endedAt": "2026-10-21T10:42:04.000Z",
      "durationSeconds": 214,
      "answers": [
        { "questionId": "q1", "question": "What is your notice period?", "answer": "30 days" }
      ],
      "summary": "Asha has five years in warehouse operations and can join in 30 days.",
      "transcript": [{ "role": "agent", "message": "Hello Asha, …" }],
      "recordingUrl": "${API_BASE}/v1/calls/8f9d…/recording"
    }
  }
}`;

const VERIFY_JS = `import express from 'express';
import { verifyWebhook, WebhookVerificationError } from '@hrvoice/sdk';

const app = express();

// The raw body, not parsed JSON: the signature covers the exact bytes we sent.
app.post('/hrvoice/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const event = await verifyWebhook(req.body, req.get('HRVoice-Signature'), process.env.HRVOICE_WEBHOOK_SECRET!);
    if (event.type === 'call.completed') console.log(event.data.result.summary);
    res.sendStatus(204);
  } catch (err) {
    if (err instanceof WebhookVerificationError) return res.sendStatus(400);
    throw err;
  }
});`;

const VERIFY_PY = `import os
from flask import Flask, abort, request
from hrvoice import WebhookVerificationError, verify_webhook

app = Flask(__name__)

@app.post("/hrvoice/webhook")
def hrvoice_webhook():
    try:
        event = verify_webhook(
            request.get_data(),  # the raw body
            request.headers.get("HRVoice-Signature"),
            os.environ["HRVOICE_WEBHOOK_SECRET"],
        )
    except WebhookVerificationError:
        abort(400)
    if event["type"] == "call.completed":
        print(event["data"]["result"]["summary"])
    return "", 204`;

const VERIFY_RAW = `import { createHmac, timingSafeEqual } from 'node:crypto';

// header: "t=1761043327,v1=5f2c…"  rawBody: the request body exactly as received
export function isFromHRVoice(rawBody: string, header: string, secret: string): boolean {
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=')));
  const expected = createHmac('sha256', secret).update(\`\${parts.t}.\${rawBody}\`).digest('hex');
  const given = Buffer.from(parts.v1 ?? '', 'utf8');
  const fresh = Math.abs(Date.now() / 1000 - Number(parts.t)) <= 300; // refuse replays
  return fresh && given.length === expected.length && timingSafeEqual(given, Buffer.from(expected, 'utf8'));
}`;

const SDK_JS_INSTALL = `npm install @hrvoice/sdk`;
const SDK_JS = `import { HRVoice, HRVoiceError } from '@hrvoice/sdk';

const hv = new HRVoice({ apiKey: process.env.HRVOICE_API_KEY!, baseUrl: '${API_BASE}' });

const job = await hv.createJob({ title: 'Warehouse Supervisor', mustAskQuestions: ['What is your notice period?'] });
const cand = await hv.addCandidate(job.id, { fullName: 'Asha Rao', phone: '9000000101', externalId: 'ats-42', consent: true });

try {
  const call = await hv.startCall(job.id, cand.id);
  console.log(call.status); // "queued", or "scheduled" outside calling hours
} catch (err) {
  if (err instanceof HRVoiceError && err.code === 'call_limit_reached') console.log('Try again at', err.resetsAt);
  else throw err;
}

// Later, or in your call.completed handler:
const result = await hv.getResults(job.id, cand.id); // answers, summary, transcript`;

const SDK_PY_INSTALL = `pip install hrvoice`;
const SDK_PY = `import os
from hrvoice import HRVoice, HRVoiceError

hv = HRVoice(api_key=os.environ["HRVOICE_API_KEY"], base_url="${API_BASE}")

job = hv.create_job({"title": "Warehouse Supervisor", "mustAskQuestions": ["What is your notice period?"]})
cand = hv.add_candidate(job["id"], {"fullName": "Asha Rao", "phone": "9000000101", "externalId": "ats-42", "consent": True})

try:
    call = hv.start_call(job["id"], cand["id"])
except HRVoiceError as err:
    if err.code == "call_limit_reached":
        print("Try again at", err.resets_at)
    else:
        raise

result = hv.get_results(job["id"], cand["id"])
# AsyncHRVoice has the same methods, awaited.`;

const MCP_DESKTOP = `{
  "mcpServers": {
    "hrvoice": {
      "command": "npx",
      "args": ["-y", "@hrvoice/mcp"],
      "env": {
        "HRVOICE_API_KEY": "hrv_test_...",
        "HRVOICE_API_URL": "${API_BASE}"
      }
    }
  }
}`;

const MCP_CODE = `claude mcp add hrvoice \\
  --env HRVOICE_API_KEY=hrv_test_... \\
  --env HRVOICE_API_URL=${API_BASE} \\
  -- npx -y @hrvoice/mcp`;

const MCP_TOOLS: [string, string][] = [
  ['create_job', 'Create a job with must-ask questions and a screening language.'],
  ['list_jobs', 'List your company’s jobs.'],
  ['add_candidates', 'Add 1 to 100 candidates. The assistant must confirm they agreed to be called.'],
  ['start_call', 'Queue a screening call for one candidate.'],
  ['get_call', 'A call’s status, and its result once it ends.'],
  ['get_results', 'The latest answers and summary, with the transcript on request.'],
  ['list_candidates', 'One page of a job’s candidates.'],
  ['get_usage', 'Calls placed and completed screens for a month.'],
];

const NO_CODE: [string, string, string][] = [
  ['Zapier', 'Add a step, search for HRVoice and connect it with your API key.',
    'Triggers: Call completed, Call failed. Actions: Add candidate, Start screening call, Raise support ticket, Create job. Search: Find candidate.'],
  ['Make', 'Add the HRVoice app to a scenario and create a connection with your API key.',
    'Watch call events (instant), Add a candidate, Start a screening call, Raise a support ticket, Create a job, Find a candidate.'],
  ['n8n', 'In Settings → Community nodes, install n8n-nodes-hrvoice, then add an HRVoice API credential with your key.',
    'HRVoice Trigger (call completed, call failed) and the HRVoice node: add candidate, start screening call, raise support ticket, create job, find candidate.'],
  ['Power Automate', 'Add the HRVoice connector to a flow. When it asks for the API key, type Bearer, a space, then your key.',
    'Trigger: When a screening call ends. Actions: Add candidate, Start screening call, Raise support ticket, Create job, Find candidates, Get call, Get results.'],
];

/* ------------------------------------------------------------------------------------------ */

export default async function DevelopersPage() {
  const reference = await loadReference();
  return (
    <div className="site relative">
      <a
        href="#main-content"
        className="fixed left-3 top-3 z-[60] inline-flex h-11 -translate-y-[200%] items-center rounded-[10px] bg-white px-4 text-[0.875rem] font-medium text-site-black focus:translate-y-0"
      >
        Skip to content
      </a>
      <LiquidNav sections={NAV} />
      <main id="main-content">
        <header id="top" className="border-b border-site-line pb-14 pt-32 md:pb-20 md:pt-44">
          <div className={CONTAINER}>
            <Tag>Developers</Tag>
            <h1 className="site-display m-0 mt-6 max-w-[16ch] text-white">
              Phone screens <Italic>from your own system</Italic>
            </h1>
            <p className="m-0 mt-6 max-w-[60ch] text-[1.125rem] leading-relaxed text-site-fg-2">
              Send jobs and candidates from your careers site or hiring tool, start calls, and get the answers,
              summary and transcript back by webhook. Results are facts, never a score: your team decides.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href={KEYS_HREF} className={siteButton('paper')}>
                Get an API key
              </Link>
              <a href={OPENAPI_URL} className={siteButton('frost')}>
                OpenAPI file
              </a>
            </div>
          </div>
        </header>

        <div className={cn(CONTAINER, 'grid grid-cols-1 gap-12 py-14 md:py-20 lg:grid-cols-12 lg:gap-16')}>
          <nav aria-label="On this page" className="lg:sticky lg:top-28 lg:col-span-3 lg:self-start">
            <h2 className="m-0 text-[0.8125rem] font-medium text-site-fg-3">On this page</h2>
            <ul role="list" className="m-0 mt-2 grid list-none grid-cols-2 p-0 lg:grid-cols-1">
              {CONTENTS.map((c) => (
                <li key={c.href}>
                  <a href={c.href} className="inline-flex min-h-11 items-center text-[0.9375rem] text-site-fg-2 no-underline hover:text-white">
                    {c.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <article className="min-w-0 lg:col-span-9">
            <Section id="quick-start" title="Quick start">
              <P>Five steps from nothing to a finished screen. Use a test key: calls go to a simulated phone line and cost nothing.</P>
              <Step n={1} title="Create a key">
                <P>
                  In <Link href={KEYS_HREF} className={LINK}>Settings → Developers</Link>, choose <b className="font-medium text-white">Create key</b>,
                  pick <b className="font-medium text-white">Test</b> and the scopes you need. Copy the key; you see it once.
                </P>
                <CodeBlock label="Shell" code={`export HRVOICE_API_KEY=hrv_test_...`} />
              </Step>
              <Step n={2} title="Add a job">
                <P>Its must-ask questions are asked on every screen for this job.</P>
                <CodeBlock label="curl" code={QS_JOB} />
              </Step>
              <Step n={3} title="Add candidates, with their consent">
                <P>
                  Send <Code>{`"consent": true`}</Code> only when the candidate has agreed to a screening call. Sending the
                  same <Code>externalId</Code> again updates that candidate instead of adding a second one. Send up to 100 at
                  once as <Code>{`{"candidates": [...]}`}</Code>.
                </P>
                <CodeBlock label="curl" code={QS_CANDIDATE} />
              </Step>
              <Step n={4} title="Start a call">
                <P>
                  The call is queued straight away. Outside calling hours it is <Code>scheduled</Code> for 9:00 IST the
                  next morning.
                </P>
                <CodeBlock label="curl" code={QS_CALL} />
              </Step>
              <Step n={5} title="Receive call.completed">
                <P>
                  Add a webhook endpoint in Settings → Developers, or with <Code>POST /v1/webhook-endpoints</Code>. When the
                  call ends we POST the result to it. You can also poll <Code>GET /v1/calls/{'{id}'}</Code>.
                </P>
              </Step>
            </Section>

            <Section id="authentication" title="Authentication">
              <P>
                Send your key as a Bearer token on every request: <Code>Authorization: Bearer hrv_live_…</Code>. Keys belong
                to your company, not to one person’s login, and stop working the moment they are revoked.
              </P>
              <P>
                A key can do only what its scopes allow, and never more than the person who created it. If that person
                leaves your workspace, their keys stop working.
              </P>
              <dl className="m-0 mt-5 grid gap-x-8 gap-y-3 sm:grid-cols-[auto_1fr]">
                {API_SCOPES.map((s) => (
                  <div key={s} className="contents">
                    <dt className="font-mono text-[0.875rem] text-white">{s}</dt>
                    <dd className="m-0 text-site-fg-2">{SCOPE_INFO[s].description}</dd>
                  </div>
                ))}
              </dl>
              <P>Keep keys on your server. Never put one in a web page or a mobile app.</P>
            </Section>

            <Section id="idempotency" title="Idempotency">
              <P>
                Every write accepts an <Code>Idempotency-Key</Code> header (up to 255 characters). If you send the same key,
                method and path again within 24 hours, you get the first answer back and nothing happens twice: no second
                candidate, no second call. Use something stable from your side, like your applicant id. The SDKs send one
                for you and reuse it when they retry.
              </P>
              <P>
                If the first request is still running you get <Code>409 idempotency_in_progress</Code>; retry after a moment.
              </P>
            </Section>

            <Section id="limits" title="Rate limits and call limits">
              <ul role="list" className="m-0 mt-4 grid list-none gap-3 p-0">
                <Li>
                  <b className="font-medium text-white">Requests:</b> 600 a minute per key. Over that you get{' '}
                  <Code>429 rate_limited</Code>.
                </Li>
                <Li>
                  <b className="font-medium text-white">Calling hours:</b> calls are placed between 9:00 and 20:00 India
                  time (IST). A call requested outside those hours waits until 9:00.
                </Li>
                <Li>
                  <b className="font-medium text-white">Consent:</b> every candidate needs <Code>{`"consent": true`}</Code>.
                  Without it you get <Code>422 consent_required</Code>, and nobody is called.
                </Li>
                <Li>
                  <b className="font-medium text-white">Do Not Disturb:</b> once our phone carrier’s DND lookup is
                  connected, numbers on India’s Do Not Disturb register are skipped: the call ends as{' '}
                  <Code>skipped</Code> with reason <Code>dnd</Code>, and you get <Code>call.failed</Code>. Until then,
                  consent is your check.
                </Li>
                <Li>
                  <b className="font-medium text-white">Call limits:</b> each company has a limit on calls a day (50 to
                  start), calls at the same time (3) and, if agreed, a monthly cap. Over a limit you get{' '}
                  <Code>429 call_limit_reached</Code> with <Code>details.resetsAt</Code>, and no call is placed. Ask us to
                  raise them.
                </Li>
              </ul>
            </Section>

            <Section id="webhooks" title="Webhooks">
              <P>
                We POST a JSON event to each of your endpoints that subscribed to it. Answer with any 2xx within 10 seconds.
                If you don’t, we retry with growing gaps for up to 24 hours. Every attempt is in the delivery log in Settings
                → Developers, where you can send any finished one again. Redirects are not followed.
              </P>
              <dl className="m-0 mt-5 grid gap-x-8 gap-y-3 sm:grid-cols-[auto_1fr]">
                {WEBHOOK_EVENTS.map((e) => (
                  <div key={e} className="contents">
                    <dt className="font-mono text-[0.875rem] text-white">{e}</dt>
                    <dd className="m-0 text-site-fg-2">{EVENT_INFO[e]}</dd>
                  </div>
                ))}
              </dl>
              <H3>Payload</H3>
              <P>
                Headers: <Code>HRVoice-Signature</Code>, <Code>HRVoice-Event</Code> and <Code>HRVoice-Delivery</Code> (the
                delivery id; the same on a resend, so you can ignore repeats). Events carry ids and facts, never hiring
                advice.
              </P>
              <CodeBlock label="call.completed" code={PAYLOAD} />
              <H3>Check the signature</H3>
              <P>
                <Code>HRVoice-Signature: t=&lt;unix seconds&gt;,v1=&lt;hex&gt;</Code>, where the hex is
                HMAC-SHA256 of <Code>{'"<t>.<raw body>"'}</Code> keyed with your endpoint’s signing secret (
                <Code>whsec_…</Code>, shown once when you add it). Check it against the raw body before you parse it, and
                refuse old timestamps.
              </P>
              <CodeBlock label="TypeScript · @hrvoice/sdk" code={VERIFY_JS} />
              <CodeBlock label="Python · hrvoice" code={VERIFY_PY} />
              <CodeBlock label="Without the SDK · Node.js" code={VERIFY_RAW} />
            </Section>

            <Section id="test-mode" title="Test mode">
              <P>
                Keys that start with <Code>hrv_test_</Code> work exactly like live keys, but every call goes to a simulated
                phone line: a pretend candidate answers through the real voice agent, so you get real answers, a summary
                and a transcript. Test calls are free, never count towards your usage, and everything they create is
                marked as test (<Code>isTest: true</Code> in events). The test line takes up to 100 calls a day, 3 at once.
              </P>
              <P>Switch to a live key when you are ready. Nothing else in your code changes.</P>
            </Section>

            <Section id="sdks" title="SDKs">
              <P>
                Both SDKs are typed from the OpenAPI file, send idempotency keys, retry rate limits and server errors, and
                include the webhook check.
              </P>
              <H3>TypeScript and JavaScript</H3>
              <P>Node 20+, Deno, Bun and edge workers. No dependencies.</P>
              <CodeBlock label="Shell" code={SDK_JS_INSTALL} />
              <CodeBlock label="TypeScript" code={SDK_JS} />
              <H3>Python</H3>
              <CodeBlock label="Shell" code={SDK_PY_INSTALL} />
              <CodeBlock label="Python" code={SDK_PY} />
            </Section>

            <Section id="mcp" title="MCP">
              <P>
                Let an AI assistant run screens for you: “add these three people to the Warehouse Supervisor job and call
                them”. The HRVoice MCP server runs on your computer with your API key. Start with a test key.
              </P>
              <H3>Claude Desktop</H3>
              <P>
                Add this to <Code>claude_desktop_config.json</Code> (on a Mac, in{' '}
                <Code>~/Library/Application Support/Claude/</Code>; on Windows, in <Code>%APPDATA%\Claude\</Code>), then
                restart Claude.
              </P>
              <CodeBlock label="JSON" code={MCP_DESKTOP} />
              <H3>Claude Code</H3>
              <CodeBlock label="Shell" code={MCP_CODE} />
              <H3>Tools</H3>
              <dl className="m-0 mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-[auto_1fr]">
                {MCP_TOOLS.map(([name, what]) => (
                  <div key={name} className="contents">
                    <dt className="font-mono text-[0.875rem] text-white">{name}</dt>
                    <dd className="m-0 text-site-fg-2">{what}</dd>
                  </div>
                ))}
              </dl>
            </Section>

            <Section id="no-code" title="No-code tools">
              <P>
                Connect HRVoice to the tools your team already uses, without writing code. Each one works through this
                same API: create a key in <Link href={KEYS_HREF} className={LINK}>Settings → Developers</Link> with the
                jobs, candidates, calls, results, webhooks and support scopes, and paste it in when the tool asks.
              </P>
              <ul role="list" className="m-0 mt-6 grid list-none gap-3 p-0">
                <Li>Adding a candidate has a yes/no field for the candidate’s consent. HRVoice refuses the candidate without it.</Li>
                <Li>Calls started from these tools are placed between 9:00 and 20:00 India time. Outside those hours they wait until 9:00.</Li>
                <Li>The call-ended trigger brings the answers, summary and transcript, never a score.</Li>
              </ul>
              <dl className="m-0 mt-8 grid gap-6">
                {NO_CODE.map(([tool, connect, steps]) => (
                  <div key={tool}>
                    <dt className="text-[1.0625rem] text-white">{tool}</dt>
                    <dd className="m-0 mt-1 max-w-[68ch] leading-relaxed text-site-fg-2">
                      {connect} {steps}
                    </dd>
                  </div>
                ))}
              </dl>
              <P>
                If a tool does not list HRVoice in its app directory yet, ask us through Get help in your dashboard and we
                will send an invite link or the connector file. Start with a test key: test calls are free.
              </P>
            </Section>

            <Section id="errors" title="Errors">
              <P>Every error has the same shape. Quote <Code>request_id</Code> if you contact us.</P>
              <CodeBlock
                label="JSON"
                code={`{
  "code": "validation_failed",
  "message": "fullName is required",
  "request_id": "…",
  "errors": [{ "field": "fullName", "message": "fullName is required" }]
}`}
              />
              <Scroll>
                <table className="mt-5 w-full min-w-[36rem] border-collapse text-left text-[0.9375rem]">
                  <thead>
                    <tr className="border-b border-site-line text-[0.8125rem] text-site-fg-3">
                      <th scope="col" className="py-2 pr-4 font-medium">Code</th>
                      <th scope="col" className="py-2 pr-4 font-medium">HTTP</th>
                      <th scope="col" className="py-2 font-medium">What it means</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(reference?.errorCodes.length ? reference.errorCodes : Object.keys(ERROR_INFO)).map((code) => (
                      <tr key={code} className="border-b border-site-line align-top">
                        <td className="py-2.5 pr-4 font-mono text-[0.8125rem] text-white">{code}</td>
                        <td className="py-2.5 pr-4 tabular-nums text-site-fg-2">{ERROR_INFO[code]?.status ?? ''}</td>
                        <td className="py-2.5 text-site-fg-2">{ERROR_INFO[code]?.meaning ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Scroll>
            </Section>

            <Section id="reference" title="API reference">
              <P>
                Every route, read from the <a href={OPENAPI_URL} className={LINK}>OpenAPI file</a>. Paths are relative
                to <Code>{API_BASE}</Code>. Writes marked <i>idempotent</i> take an <Code>Idempotency-Key</Code>.
              </P>
              {reference ? (
                reference.groups.map((g) => (
                  <div key={g.tag} className="mt-10">
                    <H3>{g.tag}</H3>
                    <div className="mt-3 border-t border-site-line">
                      {g.operations.map((op) => (
                        <Operation key={op.id} op={op} />
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <p className="m-0 mt-5 rounded-[14px] border border-site-line p-5 text-site-fg-2">
                  The reference couldn’t be loaded just now. The <a href={OPENAPI_URL} className={LINK}>OpenAPI file</a>{' '}
                  describes every route.
                </p>
              )}
            </Section>
          </article>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ */

const LINK = 'text-white underline decoration-white/40 underline-offset-4 hover:decoration-white';

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-28 border-b border-site-line pb-14 pt-2 [&+&]:pt-14">
      <h2 id={`${id}-title`} className="m-0 text-[1.875rem] font-normal leading-tight tracking-[-0.03em] text-white md:text-[2.25rem]">
        {title}
      </h2>
      {children}
    </section>
  );
}

function H3({ children }: { children: ReactNode }) {
  return <h3 className="m-0 mt-10 text-[1.25rem] font-normal tracking-[-0.015em] text-white">{children}</h3>;
}

function P({ children }: { children: ReactNode }) {
  return <p className="m-0 mt-4 max-w-[68ch] text-[1rem] leading-relaxed text-site-fg-2">{children}</p>;
}

function Li({ children }: { children: ReactNode }) {
  return (
    <li className="flex max-w-[68ch] gap-3 leading-relaxed text-site-fg-2">
      <span aria-hidden className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-site-lime" />
      <span>{children}</span>
    </li>
  );
}

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded-[6px] bg-white/10 px-1.5 py-0.5 font-mono text-[0.875em] text-white [overflow-wrap:anywhere]">{children}</code>;
}

function Scroll({ children }: { children: ReactNode }) {
  return (
    <div tabIndex={0} role="region" aria-label="Scrollable table" className="overflow-x-auto focus-visible:outline-white">
      {children}
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="mt-10 grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-4">
      <span aria-hidden className="grid size-9 place-items-center rounded-full border border-site-lime/60 text-[0.875rem] text-white">
        {n}
      </span>
      <div className="min-w-0">
        <h3 className="m-0 pt-1 text-[1.25rem] font-normal tracking-[-0.015em] text-white">
          <span className="sr-only">Step {n}: </span>
          {title}
        </h3>
        {children}
      </div>
    </div>
  );
}

const METHOD_TONE: Record<string, string> = {
  GET: 'text-[#9fd0ff] border-[#9fd0ff]/40',
  POST: 'text-site-lime border-site-lime/50',
  PATCH: 'text-[#ffd48a] border-[#ffd48a]/40',
  DELETE: 'text-[#ffa3a3] border-[#ffa3a3]/40',
};

function Operation({ op }: { op: RefOperation }) {
  return (
    <details id={op.id} className="group scroll-mt-28 border-b border-site-line">
      <summary className="flex min-h-14 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 py-3 [&::-webkit-details-marker]:hidden">
        <span className={cn('inline-flex h-6 min-w-[3.75rem] items-center justify-center rounded-[6px] border px-1.5 font-mono text-[0.75rem] font-medium', METHOD_TONE[op.method])}>
          {op.method}
        </span>
        <code className="font-mono text-[0.875rem] text-white [overflow-wrap:anywhere]">{op.path}</code>
        <span className="basis-full text-[0.9375rem] text-site-fg-2 sm:basis-auto">{op.summary}</span>
        <span className="ml-auto flex gap-2 text-[0.75rem] text-site-fg-3">
          {op.idempotent ? <span>idempotent</span> : null}
          {!op.auth ? <span>no key needed</span> : null}
        </span>
      </summary>
      <div className="pb-6 pl-0 sm:pl-[4.5rem]">
        {op.description ? <P>{op.description}</P> : null}
        {op.params.length ? <Fields title="Parameters" fields={op.params} /> : null}
        {op.body ? <ShapeView title="Request body" shape={op.body} /> : null}
        {op.responses.map((r) => (
          <ShapeView key={r.status} title={`${r.status} · ${r.description}`} shape={r.shape} />
        ))}
      </div>
    </details>
  );
}

function ShapeView({ title, shape }: { title: string; shape?: RefShape }) {
  if (!shape) return <h4 className="m-0 mt-5 text-[0.875rem] font-medium text-white">{title}</h4>;
  if (shape.variants?.length) {
    return (
      <>
        <h4 className="m-0 mt-5 text-[0.875rem] font-medium text-white">{title}: one of</h4>
        {shape.variants.map((v, i) => (
          <ShapeView key={v.name ?? i} title={v.name ?? v.type} shape={v} />
        ))}
      </>
    );
  }
  const label = shape.name && shape.name !== title ? `${title} · ${shape.name}` : shape.fields.length ? title : `${title} · ${shape.type}`;
  return shape.fields.length ? <Fields title={label} fields={shape.fields} /> : <h4 className="m-0 mt-5 text-[0.875rem] font-medium text-white">{label}</h4>;
}

function Fields({ title, fields }: { title: string; fields: RefField[] }) {
  return (
    <>
      <h4 className="m-0 mt-5 text-[0.875rem] font-medium text-white">{title}</h4>
      <Scroll>
        <table className="mt-2 w-full min-w-[32rem] border-collapse text-left text-[0.875rem]">
          <tbody>
            {fields.map((f) => (
              <tr key={f.name} className="border-t border-site-line align-top">
                <th scope="row" className="py-2 pr-4 font-mono text-[0.8125rem] font-normal text-white">
                  {f.name}
                  {f.required ? <span className="ml-1.5 font-sans text-[0.75rem] text-site-fg-3">required</span> : null}
                </th>
                <td className="py-2 pr-4 font-mono text-[0.8125rem] text-site-fg-2 [overflow-wrap:anywhere]">{f.type}</td>
                <td className="py-2 text-site-fg-2">{f.description ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Scroll>
    </>
  );
}
