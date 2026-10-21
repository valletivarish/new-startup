/**
 * Acme Hiring: a pretend ATS that uses HR Voice the way a real client would,
 * only through @hrvoice/sdk (/v1) and signed webhooks. In-memory jobs and applicants.
 *
 *   GET  /                  jobs
 *   GET  /jobs/:id          applicants for a job
 *   GET  /applicants/:id    one applicant and their screen result
 *   POST /hrvoice/webhook   HR Voice events (HRVoice-Signature verified)
 *
 * Run alone: HRVOICE_API_KEY=hrv_test_... node src/server.ts
 */

import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { HRVoice, verifyWebhook, type HRVoiceEvent } from '@hrvoice/sdk';

export interface AcmeJob {
  id: string;
  title: string;
  hrvoiceJobId: string;
}

export interface AcmeApplicant {
  id: string;
  jobId: string;
  name: string;
  phone: string;
  hrvoiceCandidateId: string;
  callIds: string[];
  /** The `data.result` of the last verified call event for this applicant. */
  result: unknown;
  resultEvent: string | null;
}

export interface AcmeEvent {
  id: string;
  type: string;
  callId: string;
  candidateId: string;
  externalId: string | null;
  isTest: boolean;
  result: unknown;
  receivedAt: string;
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(res: ServerResponse, title: string, body: string, status = 200) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><title>${esc(title)} · Acme Hiring</title><h1>${esc(title)}</h1>${body}`);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 1_000_000) req.destroy(new Error('body too large'));
      else chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
    req.on('error', fail);
  });
}

export function createAcme(hrvoice: HRVoice) {
  const jobs = new Map<string, AcmeJob>();
  const applicants = new Map<string, AcmeApplicant>();
  const events: AcmeEvent[] = [];
  let webhookSecret: string | null = null;
  let rejected = 0;

  async function onEvent(raw: string, signature: string, res: ServerResponse) {
    let evt: HRVoiceEvent;
    try {
      if (!webhookSecret) throw new Error('no webhook registered');
      evt = await verifyWebhook(raw, signature, webhookSecret);
    } catch {
      rejected += 1;
      res.writeHead(400).end('bad signature');
      return;
    }
    // Retries can repeat an event; the id makes it a no-op.
    if (!events.some((e) => e.id === evt.id)) {
      const d = evt.data;
      events.push({
        id: evt.id,
        type: evt.type,
        callId: d.callId,
        candidateId: d.candidateId,
        externalId: d.externalId,
        isTest: d.isTest,
        result: d.result,
        receivedAt: new Date().toISOString(),
      });
      const applicant = d.externalId ? applicants.get(d.externalId) : undefined;
      if (applicant) {
        applicant.result = d.result;
        applicant.resultEvent = evt.type;
      }
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const path = (req.url ?? '/').split('?')[0]!;
    if (req.method === 'POST' && path === '/hrvoice/webhook') {
      return onEvent(await readBody(req), String(req.headers['hrvoice-signature'] ?? ''), res);
    }
    if (req.method !== 'GET') return void res.writeHead(405).end();
    if (path === '/') {
      const items = [...jobs.values()].map((j) => `<li><a href="/jobs/${esc(j.id)}">${esc(j.title)}</a></li>`);
      return page(res, 'Jobs', `<ul>${items.join('')}</ul>`);
    }
    const job = /^\/jobs\/([^/]+)$/.exec(path);
    if (job && jobs.has(job[1]!)) {
      const j = jobs.get(job[1]!)!;
      const rows = [...applicants.values()]
        .filter((a) => a.jobId === j.id)
        .map((a) => `<li><a href="/applicants/${esc(a.id)}">${esc(a.name)}</a> · ${esc(a.resultEvent ?? 'not screened')}</li>`);
      return page(res, j.title, `<ul>${rows.join('')}</ul>`);
    }
    const app = /^\/applicants\/([^/]+)$/.exec(path);
    if (app && applicants.has(app[1]!)) {
      const a = applicants.get(app[1]!)!;
      const r = a.result as { summary?: string; answers?: { question: string; answer: unknown }[] } | null;
      const answers = (r?.answers ?? []).map((x) => `<dt>${esc(x.question)}</dt><dd>${esc(JSON.stringify(x.answer))}</dd>`);
      return page(res, a.name, `<p>${esc(a.resultEvent ?? 'not screened')}</p><dl>${answers.join('')}</dl><p>${esc(r?.summary)}</p>`);
    }
    page(res, 'Not found', '', 404);
  }

  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  return {
    jobs,
    applicants,
    events,
    get rejected() {
      return rejected;
    },

    start(port: number): Promise<void> {
      return new Promise((ok, fail) => {
        server.once('error', fail);
        server.listen(port, () => {
          server.off('error', fail);
          ok();
        });
      });
    },

    /** Stops listening and drops open connections; start() again to resume. */
    stop(): Promise<void> {
      return new Promise((ok) => {
        server.close(() => ok());
        server.closeAllConnections();
      });
    },

    async registerWebhook(url: string): Promise<void> {
      const out = await hrvoice.createWebhookEndpoint({ url, events: ['call.completed', 'call.failed'] });
      webhookSecret = out.secret;
    },

    async createJob(title: string, questions: string[]): Promise<AcmeJob> {
      const out = await hrvoice.createJob({ title, mustAskQuestions: questions });
      const j = { id: randomUUID(), title, hrvoiceJobId: out.id };
      jobs.set(j.id, j);
      return j;
    },

    /** Acme collects consent on its own application form, then passes it on. */
    async addApplicant(jobId: string, name: string, phone: string): Promise<AcmeApplicant> {
      const j = jobs.get(jobId);
      if (!j) throw new Error(`no job ${jobId}`);
      const id = randomUUID();
      const out = await hrvoice.addCandidate(j.hrvoiceJobId, { fullName: name, phone, externalId: id, consent: true });
      const a: AcmeApplicant = {
        id, jobId, name, phone, hrvoiceCandidateId: out.id, callIds: [], result: null, resultEvent: null,
      };
      applicants.set(id, a);
      return a;
    },

    /** Requests a screen; throws HRVoiceError on a limit or refusal. */
    async screen(applicantId: string, idempotencyKey?: string) {
      const a = applicants.get(applicantId);
      if (!a) throw new Error(`no applicant ${applicantId}`);
      const j = jobs.get(a.jobId)!;
      const call = await hrvoice.startCall(j.hrvoiceJobId, a.hrvoiceCandidateId, idempotencyKey ? { idempotencyKey } : {});
      if (!a.callIds.includes(call.id)) a.callIds.push(call.id);
      return call;
    },

    /** An "ask the candidate" link for a person Acme has no phone number for yet. */
    async askCandidateLink(jobId: string): Promise<string> {
      const j = jobs.get(jobId)!;
      return (await hrvoice.createCandidateLink(j.hrvoiceJobId)).url;
    },
  };
}

export type Acme = ReturnType<typeof createAcme>;

if (import.meta.url === `file://${process.argv[1]}`) {
  const key = process.env['HRVOICE_API_KEY'];
  if (!key) throw new Error('set HRVOICE_API_KEY');
  const acme = createAcme(new HRVoice({ apiKey: key, baseUrl: process.env['HRVOICE_API_URL'] ?? 'http://localhost:3001' }));
  const port = Number(process.env['ACME_PORT'] ?? 4100);
  await acme.start(port);
  if (process.env['ACME_WEBHOOK_URL']) await acme.registerWebhook(process.env['ACME_WEBHOOK_URL']);
  console.log(`Acme Hiring on http://localhost:${port}`);
}
