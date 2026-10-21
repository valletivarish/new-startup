/**
 * HRVoice for Zapier. A thin layer over the public /v1 API: every request is
 * an ordinary /v1 call with the customer's API key, so consent, calling hours
 * (9:00-20:00 India time), limits and the no-score rule are enforced by the API.
 */

const { signatureOk } = require('./signature');

/** API origin. The env override exists for local tests only. */
const api = () => (process.env.HRVOICE_API_URL || 'https://nexstopp.com/backend').replace(/\/$/, '');

const LANGUAGES = {
  en: 'English', hi: 'Hindi', bn: 'Bengali', mr: 'Marathi', te: 'Telugu', ta: 'Tamil',
  gu: 'Gujarati', ur: 'Urdu', kn: 'Kannada', ml: 'Malayalam', pa: 'Punjabi',
};

const yes = (v) => v === true || /^(true|yes|1)$/i.test(String(v ?? '').trim());
/** Only the fields the user filled in. */
const filled = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

// ---- Auth and errors ----

const addAuth = (request, z, bundle) => {
  // Our afterResponse reads 429s: a call limit is not a retry-in-a-moment throttle.
  request.throwForThrottlingEarly = false;
  if (bundle.authData && bundle.authData.apiKey) {
    request.headers = { ...request.headers, Authorization: `Bearer ${bundle.authData.apiKey}` };
  }
  return request;
};

/** Turns the API's error envelope into a readable Zapier error. */
const handleErrors = (response, z) => {
  if (response.status < 400) return response;
  let body = {};
  try {
    body = JSON.parse(response.content);
  } catch {
    /* not JSON */
  }
  const message = body.message || `HRVoice answered HTTP ${response.status}`;
  // Too many requests per key: Zapier retries later. A daily or monthly call limit is shown as is.
  if (response.status === 429 && body.code === 'rate_limited') {
    throw new z.errors.ThrottledError(message, Number(response.headers.get('retry-after')) || 60);
  }
  throw new z.errors.Error(message, body.code || `http_${response.status}`, response.status);
};

const authentication = {
  type: 'custom',
  fields: [
    {
      key: 'apiKey',
      label: 'API key',
      type: 'password',
      required: true,
      helpText:
        'In HRVoice open Settings → Developers and create a key with the jobs, candidates, calls, results, webhooks and support scopes. ' +
        'Keys starting `hrv_test_` place free calls on a test line.',
    },
  ],
  test: (z) => z.request({ url: `${api()}/v1/ping` }).then((r) => r.json),
  connectionLabel: (z, bundle) =>
    bundle.inputData && bundle.inputData.apiKey && bundle.inputData.apiKey.mode === 'test' ? 'Test key' : 'Live key',
};

// ---- Signed call events (REST hooks) ----

const callSample = (type) => ({
  id: 'evt_recent_3f6c1b52-8f0e-4c53-a0b2-2d1b8b0f7a11',
  type,
  createdAt: '2026-10-20T06:42:10.000Z',
  data: {
    callId: '3f6c1b52-8f0e-4c53-a0b2-2d1b8b0f7a11',
    jobId: '0b8f8c9e-4f1d-4a43-9f6b-6d2c3c1f5e20',
    candidateId: '7d9e2a10-5b3c-4f8e-8a1d-9c0b1e2f3a45',
    externalId: 'ats-1042',
    isTest: false,
    result:
      type === 'call.completed'
        ? {
            status: 'ended',
            startedAt: '2026-10-20T06:38:02.000Z',
            endedAt: '2026-10-20T06:42:08.000Z',
            durationSeconds: 246,
            answers: [{ questionId: 'q1', question: 'What is your notice period?', answer: '30 days' }],
            summary: 'Notice period is 30 days. Can join from 1 December.',
            transcript: [{ role: 'agent', message: 'What is your notice period?' }, { role: 'user', message: 'Thirty days.' }],
            recordingUrl: 'https://nexstopp.com/backend/v1/calls/3f6c1b52-8f0e-4c53-a0b2-2d1b8b0f7a11/recording',
          }
        : {
            status: 'failed', startedAt: null, endedAt: null, durationSeconds: null,
            answers: [], summary: null, failureReason: 'no_answer',
          },
  },
});

const eventOutputFields = [
  { key: 'id', label: 'Event ID' },
  { key: 'type', label: 'Event type' },
  { key: 'createdAt', label: 'Event time', type: 'datetime' },
  { key: 'data__callId', label: 'Call ID' },
  { key: 'data__jobId', label: 'Job ID' },
  { key: 'data__candidateId', label: 'Candidate ID' },
  { key: 'data__externalId', label: 'Your candidate ID' },
  { key: 'data__isTest', label: 'Test call', type: 'boolean' },
  { key: 'data__result__status', label: 'Call status' },
  { key: 'data__result__durationSeconds', label: 'Duration (seconds)', type: 'integer' },
  { key: 'data__result__summary', label: 'Summary' },
  { key: 'data__result__recordingUrl', label: 'Recording URL (needs the API key)' },
  { key: 'data__result__failureReason', label: 'Why the call failed' },
];

function callTrigger(type, noun, label, description) {
  return {
    key: type === 'call.completed' ? 'call_completed' : 'call_failed',
    noun,
    display: { label, description },
    operation: {
      type: 'hook',
      performSubscribe: (z, bundle) =>
        z
          .request({ url: `${api()}/v1/webhook-endpoints`, method: 'POST', body: { url: bundle.targetUrl, events: [type] } })
          .then((r) => r.json),
      performUnsubscribe: (z, bundle) =>
        z
          .request({ url: `${api()}/v1/webhook-endpoints/${encodeURIComponent(bundle.subscribeData.id)}`, method: 'DELETE' })
          .then((r) => r.json),
      perform: (z, bundle) => {
        // A request without HRVoice's signature is dropped, not run.
        if (!signatureOk(bundle.rawRequest, bundle.subscribeData && bundle.subscribeData.secret)) return [];
        const event = JSON.parse(bundle.rawRequest.content);
        return event.type === type ? [event] : [];
      },
      performList: (z) =>
        z
          .request({ url: `${api()}/v1/events`, params: { type, limit: 3 } })
          .then((r) => r.json.events),
      sample: callSample(type),
      outputFields: eventOutputFields,
    },
  };
}

// ---- Dropdowns ----

const jobList = {
  key: 'job',
  noun: 'Job',
  display: { label: 'New Job', description: 'Lists jobs for dropdowns.', hidden: true },
  operation: {
    perform: (z) => z.request({ url: `${api()}/v1/jobs` }).then((r) => r.json.jobs),
    sample: { id: '0b8f8c9e-4f1d-4a43-9f6b-6d2c3c1f5e20', title: 'Warehouse Supervisor', status: 'open' },
  },
};

const candidateList = {
  key: 'candidate',
  noun: 'Candidate',
  display: { label: 'New Candidate', description: 'Lists a job\'s candidates for dropdowns.', hidden: true },
  operation: {
    perform: (z, bundle) => {
      if (!bundle.inputData.jobId) return [];
      return z
        .request({ url: `${api()}/v1/jobs/${encodeURIComponent(bundle.inputData.jobId)}/candidates`, params: { limit: 200 } })
        .then((r) => r.json.candidates);
    },
    sample: { id: '7d9e2a10-5b3c-4f8e-8a1d-9c0b1e2f3a45', fullName: 'Asha Rao' },
  },
};

const jobField = {
  key: 'jobId', label: 'Job', required: true, dynamic: 'job.id.title', altersDynamicFields: true,
};

const candidateOutputFields = [
  { key: 'id', label: 'Candidate ID' },
  { key: 'jobId', label: 'Job ID' },
  { key: 'externalId', label: 'Your candidate ID' },
  { key: 'fullName', label: 'Name' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'status', label: 'Screening status' },
];

const candidateSample = {
  id: '7d9e2a10-5b3c-4f8e-8a1d-9c0b1e2f3a45', jobId: '0b8f8c9e-4f1d-4a43-9f6b-6d2c3c1f5e20',
  externalId: 'ats-1042', fullName: 'Asha Rao', phone: '9000000101', countryCode: '+91',
  email: null, status: 'not_started', createdAt: '2026-10-20T06:30:00.000Z', updatedAt: '2026-10-20T06:30:00.000Z',
};

// ---- Actions ----

const addCandidate = {
  key: 'add_candidate',
  noun: 'Candidate',
  display: {
    label: 'Add Candidate',
    description: 'Adds a candidate to a job. The same "Your candidate ID" updates the existing candidate.',
  },
  operation: {
    inputFields: [
      jobField,
      { key: 'fullName', label: 'Full name', required: true },
      { key: 'phone', label: 'Phone', helpText: 'Mobile number. Leave empty if it is in the CV text.' },
      { key: 'countryCode', label: 'Country code', default: '+91' },
      { key: 'email', label: 'Email' },
      { key: 'externalId', label: 'Your candidate ID', helpText: 'Your own ID for this person, e.g. from your hiring tool.' },
      { key: 'resumeText', label: 'CV text', type: 'text' },
      {
        key: 'consent',
        label: 'The candidate agreed to a screening call',
        type: 'boolean',
        required: true,
        helpText: 'Required. Set to true only when the candidate has agreed to be called. Without it HRVoice refuses the candidate.',
      },
    ],
    perform: (z, bundle) => {
      const d = bundle.inputData;
      if (!yes(d.consent)) {
        throw new z.errors.Error(
          'The candidate must agree to a screening call: set "The candidate agreed to a screening call" to true.',
          'consent_required',
          422,
        );
      }
      return z
        .request({
          url: `${api()}/v1/jobs/${encodeURIComponent(d.jobId)}/candidates`,
          method: 'POST',
          body: {
            ...filled({
              fullName: d.fullName, phone: d.phone, countryCode: d.countryCode, email: d.email,
              externalId: d.externalId, resumeText: d.resumeText,
            }),
            consent: true,
          },
        })
        .then((r) => r.json);
    },
    sample: { ...candidateSample, created: true },
    outputFields: [...candidateOutputFields, { key: 'created', label: 'Newly created', type: 'boolean' }],
  },
};

const startCall = {
  key: 'start_call',
  noun: 'Call',
  display: {
    label: 'Start Screening Call',
    description: 'Queues a screening call. Calls are placed between 9:00 and 20:00 India time; outside those hours the call waits until 9:00.',
  },
  operation: {
    inputFields: [
      jobField,
      { key: 'candidateId', label: 'Candidate', required: true, dynamic: 'candidate.id.fullName', search: 'find_candidate.id' },
    ],
    perform: (z, bundle) =>
      z
        .request({
          url: `${api()}/v1/jobs/${encodeURIComponent(bundle.inputData.jobId)}/candidates/${encodeURIComponent(bundle.inputData.candidateId)}/calls`,
          method: 'POST',
        })
        .then((r) => r.json),
    sample: {
      id: '3f6c1b52-8f0e-4c53-a0b2-2d1b8b0f7a11', status: 'queued', reason: null, notBefore: null,
      candidateId: candidateSample.id, jobId: candidateSample.jobId, result: null,
    },
    outputFields: [
      { key: 'id', label: 'Call ID' },
      { key: 'status', label: 'Status' },
      { key: 'notBefore', label: 'Scheduled for', type: 'datetime' },
      { key: 'reason', label: 'Reason' },
    ],
  },
};

const raiseTicket = {
  key: 'raise_ticket',
  noun: 'Support Ticket',
  display: { label: 'Raise Support Ticket', description: 'Asks HRVoice support for help. Replies arrive by email and in HRVoice.' },
  operation: {
    inputFields: [
      { key: 'subject', label: 'Subject' },
      { key: 'body', label: 'Message', type: 'text', required: true },
      { key: 'jobId', label: 'Related job', dynamic: 'job.id.title' },
      { key: 'callId', label: 'Related call ID' },
    ],
    perform: (z, bundle) => {
      const d = bundle.inputData;
      return z
        .request({
          url: `${api()}/v1/tickets`,
          method: 'POST',
          body: { ...filled({ subject: d.subject, body: d.body, jobId: d.jobId, callId: d.callId }), channel: 'api' },
        })
        .then((r) => r.json);
    },
    sample: {
      id: '5e1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b', ref: 'K7Q2M9', subject: 'Calls not starting',
      status: 'open', channel: 'api', jobId: null, candidateId: null, callId: null,
      createdAt: '2026-10-20T06:30:00.000Z', updatedAt: '2026-10-20T06:30:00.000Z', lastMessageAt: '2026-10-20T06:30:00.000Z',
    },
    outputFields: [
      { key: 'id', label: 'Ticket ID' },
      { key: 'ref', label: 'Reference' },
      { key: 'status', label: 'Status' },
    ],
  },
};

const createJob = {
  key: 'create_job',
  noun: 'Job',
  display: { label: 'Create Job', description: 'Creates a job with the questions every candidate must be asked.' },
  operation: {
    inputFields: [
      { key: 'title', label: 'Job title', required: true },
      { key: 'description', label: 'Job description', type: 'text' },
      { key: 'mustAskQuestions', label: 'Must-ask questions', list: true, helpText: 'Up to 20.' },
      { key: 'language', label: 'Screening language', choices: LANGUAGES, default: 'en' },
    ],
    perform: (z, bundle) => {
      const d = bundle.inputData;
      const questions = (d.mustAskQuestions || []).map((q) => String(q).trim()).filter(Boolean);
      return z
        .request({
          url: `${api()}/v1/jobs`,
          method: 'POST',
          body: filled({
            title: d.title, description: d.description, language: d.language,
            mustAskQuestions: questions.length ? questions : undefined,
          }),
        })
        .then((r) => r.json);
    },
    sample: {
      id: '0b8f8c9e-4f1d-4a43-9f6b-6d2c3c1f5e20', title: 'Warehouse Supervisor', description: '', status: 'open',
      language: 'en', questions: [{ id: 'q1', text: 'What is your notice period?' }],
      createdAt: '2026-10-20T06:00:00.000Z', updatedAt: '2026-10-20T06:00:00.000Z',
    },
    outputFields: [{ key: 'id', label: 'Job ID' }, { key: 'title', label: 'Title' }, { key: 'status', label: 'Status' }],
  },
};

// ---- Searches ----

const findCandidate = {
  key: 'find_candidate',
  noun: 'Candidate',
  display: { label: 'Find Candidate', description: 'Finds a candidate on a job by your candidate ID or by phone.' },
  operation: {
    inputFields: [
      jobField,
      { key: 'externalId', label: 'Your candidate ID' },
      { key: 'phone', label: 'Phone', helpText: 'Matched on the last 10 digits.' },
    ],
    perform: (z, bundle) => {
      const d = bundle.inputData;
      if (!d.externalId && !d.phone) {
        throw new z.errors.Error('Give your candidate ID or a phone number to search by.', 'validation_failed', 422);
      }
      return z
        .request({
          url: `${api()}/v1/jobs/${encodeURIComponent(d.jobId)}/candidates`,
          params: filled({ externalId: d.externalId, phone: d.phone, limit: 10 }),
        })
        .then((r) => r.json.candidates);
    },
    sample: candidateSample,
    outputFields: candidateOutputFields,
  },
};

const callCompleted = callTrigger(
  'call.completed', 'Call', 'Call Completed',
  'Triggers when a screening call ends and the candidate answered: answers, summary and transcript.',
);
const callFailed = callTrigger(
  'call.failed', 'Call', 'Call Failed',
  'Triggers when a screening call could not be completed (no answer, busy, voicemail, too short, or skipped).',
);

module.exports = {
  version: require('./package.json').version,
  platformVersion: require('zapier-platform-core').version,
  authentication,
  beforeRequest: [addAuth],
  afterResponse: [handleErrors],
  triggers: {
    [callCompleted.key]: callCompleted,
    [callFailed.key]: callFailed,
    [jobList.key]: jobList,
    [candidateList.key]: candidateList,
  },
  creates: {
    [addCandidate.key]: addCandidate,
    [startCall.key]: startCall,
    [raiseTicket.key]: raiseTicket,
    [createJob.key]: createJob,
  },
  searches: {
    [findCandidate.key]: findCandidate,
  },
};
