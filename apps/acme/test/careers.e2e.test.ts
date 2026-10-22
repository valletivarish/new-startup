/**
 * Acme's careers page with the HR Voice embed snippet, in a real headless Chrome. The web app
 * (started by `pnpm test:clients`) serves /embed.js and proxies /backend to the API, exactly as
 * nexstopp.com does. An admin makes the job's careers-page form from the dashboard route; the
 * page is served by Acme on another origin; the applicant fills the form, the test call on the
 * fake line completes, and the result reaches Acme by webhook with answers and no score.
 * The same page on an origin that isn't on the list gets no form.
 *
 * EMBED_SCREENSHOTS=<dir> also saves the form and the job page panel at 1440 and 390 px.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { HRVoice } from '@hrvoice/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAcme, type Acme, type AcmeJob } from '../src/server.ts';

const API = process.env['HRVOICE_API_URL'] ?? 'http://localhost:3001';
const WEB = process.env['CLIENTS_WEB_URL'] ?? 'http://localhost:3012';
const PORT = Number(process.env['ACME_CAREERS_PORT'] ?? 4101);
const SITE = `http://localhost:${PORT}`;
const CHROME = process.env['CHROME_PATH'] ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS = process.env['EMBED_SCREENSHOTS'];
const PASSWORD = 'correct-horse-battery-staple';
const QUESTIONS = ['What is your notice period?', 'When can you join?'];
const SCORE_KEYS = /fitpercent|fit_percent|score|recommend/i;

async function http(method: string, path: string, opts: { cookie?: string; body?: unknown } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      origin: 'http://localhost:3000',
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const text = await res.text();
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0]!)
    .filter((c) => c.includes('session_token'))
    .join('; ');
  return { status: res.status, body: text ? JSON.parse(text) : null, cookie };
}

async function until<T>(what: string, fn: () => T | undefined | Promise<T | undefined>, ms = 240_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v !== undefined && v !== null && v !== false) return v;
    if (Date.now() > deadline) throw new Error(`timed out after ${ms / 1000}s waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

function keysOf(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      keysOf(x, out);
    }
  }
  return out;
}

/** playwright-core from the pnpm store (no extra dependency for Acme). */
async function playwright() {
  const store = resolve(import.meta.dirname, '../../../node_modules/.pnpm');
  const dir = readdirSync(store).find((d) => d.startsWith('playwright-core@'));
  if (!dir) throw new Error('playwright-core is not in node_modules/.pnpm');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await import(pathToFileURL(join(store, dir, 'node_modules/playwright-core/index.mjs')).href)) as any;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
let browser: any;
let acme: Acme;
let hv: HRVoice;
let cookie: string;
let job: AcmeJob;

describe('Acme careers page with the HR Voice form', () => {
  beforeAll(async () => {
    if (!existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME}; set CHROME_PATH`);
    const embed = await fetch(`${WEB}/embed.js`);
    expect(embed.status, `${WEB}/embed.js`).toBe(200);
    browser = await (await playwright()).chromium.launch({ executablePath: CHROME, headless: true });
  });
  afterAll(async () => {
    await browser?.close();
    await acme?.stop();
  });

  it('E1. an admin makes the careers-page form for a test job, for Acme’s website only', async () => {
    const signUp = await http('POST', '/api/auth/sign-up/email', {
      body: { email: `careers-${randomUUID().slice(0, 8)}@example.test`, password: PASSWORD, name: 'Careers Admin' },
    });
    expect(signUp.status).toBe(200);
    cookie = signUp.cookie;
    await http('POST', '/organizations', { cookie, body: { name: 'Acme Careers' } });
    const agent = await http('POST', '/agents', { cookie, body: { name: 'Careers Screener', purpose: 'Screen applicants', agentType: 'hiring' } });
    await http('POST', `/agents/${agent.body.id}/versions/${agent.body.versionId}/publish`, { cookie, body: {} });
    const key = await http('POST', '/organization/api-keys', {
      cookie,
      body: { name: 'Acme careers', mode: 'test', scopes: ['jobs', 'candidates', 'calls', 'results', 'webhooks'] },
    });
    hv = new HRVoice({ apiKey: key.body.key, baseUrl: API });
    acme = createAcme(hv);
    await acme.start(PORT);
    await acme.registerWebhook(`${SITE}/hrvoice/webhook`);
    job = await acme.createJob('Delivery Partner', QUESTIONS);

    const made = await http('POST', `/jobs/${job.hrvoiceJobId}/careers-page`, { cookie, body: { allowedOrigins: [SITE] } });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.key).toMatchObject({ mode: 'test', allowedOrigins: [SITE] });
    acme.setCareersForm(job.id, made.body.key.publicKey, `${WEB}/embed.js`);
  });

  it('E2. a website that isn’t on the list gets no form', async () => {
    const page = await browser.newPage();
    // Same page, other origin: 127.0.0.1 is not localhost.
    await page.goto(`http://127.0.0.1:${PORT}/careers/${job.id}`);
    // getByText reaches into the form's (open) shadow root.
    await page.getByText('This form isn’t taking applications right now.').waitFor({ timeout: 20_000 });
    expect(await page.getByLabel('Your name').count()).toBe(0);
    await page.close();
  });

  it('E3. the applicant fills the form on Acme’s page; errors first, then the thank-you', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(`${SITE}/careers/${job.id}`);
    const name = page.getByLabel('Your name');
    await name.waitFor({ timeout: 20_000 });
    expect(await page.getByText('Delivery Partner at Acme Careers').count()).toBe(1);

    // Acme's CSS ("button{background:red}", 9px pink inputs) doesn't reach the form.
    const button = page.getByRole('button', { name: 'Request my call' });
    // Runs in the page (no DOM types in this package).
    const look = await button.evaluate((b: any) => {
      const s = (globalThis as any).getComputedStyle(b);
      return { bg: s.backgroundColor, h: b.getBoundingClientRect().height, size: s.fontSize };
    });
    expect(look).toEqual({ bg: 'rgb(11, 110, 79)', h: 48, size: '16px' });

    await button.click();
    expect(await page.getByText('Enter your name.').count()).toBe(1);
    expect(await page.getByText('Tick the box to agree to the screening call.').count()).toBe(1);
    expect(await name.getAttribute('aria-invalid')).toBe('true');
    expect(await name.evaluate((el: any) => el.getRootNode().activeElement === el)).toBe(true);
    if (SHOTS) await shot(page, 'form-errors-1440');

    await name.fill('Priya Embed');
    await page.getByLabel('Mobile number').fill('90000 00401');
    await page.getByLabel('Email (optional)').fill('priya.embed@example.test');
    await page.getByRole('checkbox').check();
    if (SHOTS) {
      await shot(page, 'form-filled-1440');
      await page.setViewportSize({ width: 390, height: 900 });
      await shot(page, 'form-filled-390');
    }
    await button.click();
    const thanks = page.getByRole('status');
    await expect
      .poll(() => thanks.textContent(), { timeout: 20_000 })
      .toBe('Thanks, Priya. You’ll get a call from our hiring team’s screening assistant shortly.');
    if (SHOTS) await shot(page, 'form-thanks-390');
    expect(await page.locator('body').innerText()).not.toMatch(/score|fit|recommend/i);
    await page.close();
  });

  it('E4. the call on the fake line completes and Acme gets the answers, never a score', async () => {
    const candidate = await until('the candidate', async () =>
      (await hv.listCandidates(job.hrvoiceJobId)).candidates.find((c) => c.fullName === 'Priya Embed'),
    );
    const event = await until('call.completed for the applicant', () =>
      acme.events.find((e) => e.candidateId === candidate.id && e.type === 'call.completed'),
    );
    expect(event.isTest).toBe(true);
    const result = event.result as { answers: { question: string; answer: unknown }[]; summary: string };
    expect(result.answers.map((a) => a.question)).toEqual(QUESTIONS);
    expect(result.answers.filter((a) => a.answer !== null && a.answer !== '').length).toBeGreaterThan(0);
    expect(keysOf(event).filter((k) => SCORE_KEYS.test(k))).toEqual([]);
  });

  it('E5. turning the form off closes it on the page at once', async () => {
    if (SHOTS) await panelShots();
    expect((await http('DELETE', `/jobs/${job.hrvoiceJobId}/careers-page`, { cookie })).status).toBe(204);
    const page = await browser.newPage();
    await page.goto(`${SITE}/careers/${job.id}`);
    // getByText reaches into the form's (open) shadow root.
    await page.getByText('This form isn’t taking applications right now.').waitFor({ timeout: 20_000 });
    await page.close();
  });
});

async function shot(page: any, name: string) {
  mkdirSync(SHOTS!, { recursive: true });
  await page.screenshot({ path: join(SHOTS!, `${name}.png`) });
}

/** The job page panel, signed in as the admin, on the web app. */
async function panelShots() {
  const pair = cookie.split('; ')[0]!;
  const name = pair.slice(0, pair.indexOf('='));
  const value = pair.slice(pair.indexOf('=') + 1);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name, value, url: WEB }]);
  const page = await context.newPage();
  await page.goto(`${WEB}/jobs/${job.hrvoiceJobId}#careers-page`, { timeout: 180_000 });
  const panel = page.locator('#careers-page');
  await panel.getByText('Paste this where the form should appear').waitFor({ timeout: 180_000 });
  await panel.getByLabel('Your name').waitFor();
  const top = () => panel.evaluate((el: any) => el.scrollIntoView({ block: 'start' }));
  await top();
  await page.screenshot({ path: join(SHOTS!, 'panel-1440.png') });
  await panel.getByText('What applicants see').evaluate((el: any) => el.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: join(SHOTS!, 'panel-preview-1440.png') });
  await page.setViewportSize({ width: 390, height: 900 });
  await top();
  await page.screenshot({ path: join(SHOTS!, 'panel-390.png') });
  await panel.getByText('What applicants see').evaluate((el: any) => el.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: join(SHOTS!, 'panel-preview-390.png') });
  await context.close();
}
