# @hrvoice/sdk

TypeScript client for the HRVoice `/v1` API. ESM, typed from the API's OpenAPI document, no runtime dependencies (uses `fetch` and Web Crypto, so it runs on Node 20+, Deno, Bun and edge workers).

```ts
import { HRVoice, verifyWebhook } from '@hrvoice/sdk';

const hv = new HRVoice({ apiKey: process.env.HRVOICE_API_KEY!, baseUrl: 'https://your-hrvoice-host' });
const job = await hv.createJob({ title: 'Warehouse Supervisor', mustAskQuestions: ['What is your notice period?'] });
const cand = await hv.addCandidate(job.id, { fullName: 'Asha Rao', phone: '9000000101', externalId: 'ats-42', consent: true });
const call = await hv.startCall(job.id, cand.id);
const result = await hv.getResults(job.id, cand.id); // answers, summary, transcript: never a score

// Webhook handler: pass the raw body, not parsed JSON.
const event = await verifyWebhook(rawBody, req.headers['hrvoice-signature'], secret);
if (event.type === 'call.completed') console.log(event.data.result.summary);
```

- Every `/v1` route has a method: `ping`, `openApi`, `listJobs`, `createJob`, `getJob`, `updateJob`, `listCandidates`, `addCandidate`, `addCandidates` (batch), `getCandidate`, `startCall`, `getCall`, `getResults`, `recordingUrl`, `getRecording`, `getUsage`, `createCandidateLink`, `createWebhookEndpoint`, `listWebhookEndpoints`, `deleteWebhookEndpoint`, `listWebhookDeliveries`, `resendWebhookDelivery`.
- Writes send an `Idempotency-Key` (a UUID unless you pass `{ idempotencyKey }`), reused across retries.
- 429, 5xx, in-flight duplicates and network errors are retried (`maxRetries`, default 2) with backoff that honours `Retry-After` and `details.resetsAt`; a wait longer than `maxRetryDelayMs` (30 s) fails at once, so a daily call limit surfaces immediately.
- Non-2xx answers throw `HRVoiceError` with `status`, `code`, `message`, `requestId`, `fields`, `details` and `resetsAt`.
- `verifyWebhook(rawBody, header, secret, toleranceSec = 300)` checks `HRVoice-Signature` in constant time and rejects old timestamps; it returns a typed `HRVoiceEvent`.

`src/generated.ts` is generated from the API's OpenAPI document: `pnpm --filter @hrvoice/sdk generate` (also writes the Python SDK's TypedDicts).
