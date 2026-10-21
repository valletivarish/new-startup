import {
  NodeApiError,
  NodeOperationError,
  type IDataObject,
  type IExecuteFunctions,
  type ILoadOptionsFunctions,
  type INodeExecutionData,
  type INodePropertyOptions,
  type INodeType,
  type INodeTypeDescription,
  type JsonObject,
} from 'n8n-workflow';

import { LANGUAGES, hrvoice } from './shared';

const show = (...operation: string[]) => ({ displayOptions: { show: { operation } } });
/** Only the fields the user filled in. */
const filled = (o: IDataObject): IDataObject =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

export class HRVoice implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'HRVoice',
    name: 'hrVoice',
    icon: 'file:hrvoice.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description: 'Phone-screen candidates and raise support tickets with HRVoice',
    defaults: { name: 'HRVoice' },
    inputs: ['main'],
    outputs: ['main'],
    credentials: [{ name: 'hrVoiceApi', required: true }],
    properties: [
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        default: 'addCandidate',
        options: [
          { name: 'Add Candidate', value: 'addCandidate', action: 'Add a candidate to a job' },
          { name: 'Create Job', value: 'createJob', action: 'Create a job' },
          { name: 'Find Candidate', value: 'findCandidate', action: 'Find a candidate by your ID or phone' },
          { name: 'Raise Support Ticket', value: 'raiseTicket', action: 'Raise a support ticket' },
          {
            name: 'Start Screening Call',
            value: 'startCall',
            action: 'Start a screening call',
            description: 'Calls are placed 9:00-20:00 India time; outside those hours the call waits until 9:00',
          },
        ],
      },
      {
        displayName: 'Job Name or ID',
        name: 'jobId',
        type: 'options',
        typeOptions: { loadOptionsMethod: 'getJobs' },
        default: '',
        required: true,
        description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
        ...show('addCandidate', 'startCall', 'findCandidate'),
      },
      { displayName: 'Full Name', name: 'fullName', type: 'string', default: '', required: true, ...show('addCandidate') },
      { displayName: 'Phone', name: 'phone', type: 'string', default: '', ...show('addCandidate', 'findCandidate'),
        description: 'Mobile number. For Find Candidate it is matched on the last 10 digits.' },
      {
        displayName: 'The Candidate Agreed to a Screening Call',
        name: 'consent',
        type: 'boolean',
        default: false,
        required: true,
        description: 'Whether the candidate has agreed to be called. Required: HRVoice refuses a candidate without it.',
        ...show('addCandidate'),
      },
      { displayName: 'Your Candidate ID', name: 'externalId', type: 'string', default: '', ...show('addCandidate', 'findCandidate'),
        description: 'Your own ID for this person; the same ID updates the existing candidate' },
      {
        displayName: 'Additional Fields',
        name: 'additional',
        type: 'collection',
        placeholder: 'Add Field',
        default: {},
        ...show('addCandidate'),
        options: [
          { displayName: 'Country Code', name: 'countryCode', type: 'string', default: '+91' },
          { displayName: 'Email', name: 'email', type: 'string', placeholder: 'name@email.com', default: '' },
          { displayName: 'CV Text', name: 'resumeText', type: 'string', typeOptions: { rows: 4 }, default: '' },
        ],
      },
      { displayName: 'Candidate ID', name: 'candidateId', type: 'string', default: '', required: true, ...show('startCall') },
      { displayName: 'Message', name: 'body', type: 'string', typeOptions: { rows: 4 }, default: '', required: true, ...show('raiseTicket') },
      {
        displayName: 'Additional Fields',
        name: 'ticketFields',
        type: 'collection',
        placeholder: 'Add Field',
        default: {},
        ...show('raiseTicket'),
        options: [
          { displayName: 'Subject', name: 'subject', type: 'string', default: '' },
          { displayName: 'Related Job ID', name: 'jobId', type: 'string', default: '' },
          { displayName: 'Related Call ID', name: 'callId', type: 'string', default: '' },
        ],
      },
      { displayName: 'Job Title', name: 'title', type: 'string', default: '', required: true, ...show('createJob') },
      {
        displayName: 'Must-Ask Questions',
        name: 'mustAskQuestions',
        type: 'string',
        typeOptions: { rows: 4 },
        default: '',
        description: 'One question per line (up to 20)',
        ...show('createJob'),
      },
      { displayName: 'Language', name: 'language', type: 'options', options: LANGUAGES, default: 'en', ...show('createJob') },
      { displayName: 'Description', name: 'jobDescription', type: 'string', typeOptions: { rows: 4 }, default: '', ...show('createJob') },
    ],
  };

  methods = {
    loadOptions: {
      async getJobs(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const { jobs } = (await hrvoice(this, 'GET', '/v1/jobs')) as { jobs: { id: string; title: string }[] };
        return jobs.map((j) => ({ name: j.title, value: j.id }));
      },
    },
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const out: INodeExecutionData[] = [];
    for (let i = 0; i < items.length; i++) {
      const p = (name: string, fallback?: unknown) => this.getNodeParameter(name, i, fallback) as never;
      try {
        const op = p('operation') as string;
        let res: IDataObject | IDataObject[];
        if (op === 'addCandidate') {
          if (p('consent') !== true) {
            throw new NodeOperationError(this.getNode(), 'The candidate must agree to a screening call: turn on "The Candidate Agreed to a Screening Call".', { itemIndex: i });
          }
          const jobId = encodeURIComponent(p('jobId'));
          res = await hrvoice(this, 'POST', `/v1/jobs/${jobId}/candidates`, {
            ...filled({ fullName: p('fullName'), phone: p('phone'), externalId: p('externalId'), ...(p('additional', {}) as IDataObject) }),
            consent: true,
          });
        } else if (op === 'startCall') {
          res = await hrvoice(this, 'POST', `/v1/jobs/${encodeURIComponent(p('jobId'))}/candidates/${encodeURIComponent(p('candidateId'))}/calls`);
        } else if (op === 'findCandidate') {
          const qs = filled({ externalId: p('externalId'), phone: p('phone') });
          if (Object.keys(qs).length === 0) {
            throw new NodeOperationError(this.getNode(), 'Give your candidate ID or a phone number to search by.', { itemIndex: i });
          }
          const found = await hrvoice(this, 'GET', `/v1/jobs/${encodeURIComponent(p('jobId'))}/candidates`, undefined, { ...qs, limit: 10 });
          res = found['candidates'] as IDataObject[];
        } else if (op === 'raiseTicket') {
          res = await hrvoice(this, 'POST', '/v1/tickets', { ...filled({ body: p('body'), ...(p('ticketFields', {}) as IDataObject) }), channel: 'api' });
        } else if (op === 'createJob') {
          const questions = String(p('mustAskQuestions', '')).split('\n').map((q) => q.trim()).filter(Boolean);
          res = await hrvoice(this, 'POST', '/v1/jobs', filled({
            title: p('title'), description: p('jobDescription', ''), language: p('language'),
            mustAskQuestions: questions.length ? questions : undefined,
          }));
        } else {
          throw new NodeOperationError(this.getNode(), `Unknown operation ${op}`, { itemIndex: i });
        }
        for (const json of Array.isArray(res) ? res : [res]) out.push({ json, pairedItem: { item: i } });
      } catch (error) {
        if (this.continueOnFail()) {
          out.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
          continue;
        }
        if (error instanceof NodeOperationError) throw error;
        // Keep HRVoice's own message (e.g. "Daily call limit reached") over n8n's generic one per status.
        const e = error as { response?: { data?: { message?: string } }; description?: string; message?: string };
        const message = e.response?.data?.message ?? e.description ?? e.message;
        throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: i, ...(message ? { message } : {}) });
      }
    }
    return [out];
  }
}
