import type {
  IDataObject,
  IHookFunctions,
  INodeType,
  INodeTypeDescription,
  IWebhookFunctions,
  IWebhookResponseData,
} from 'n8n-workflow';

import { hrvoice, signatureOk } from '../HRVoice/shared';

type Endpoint = { id: string; url: string };

export class HRVoiceTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'HRVoice Trigger',
    name: 'hrVoiceTrigger',
    icon: 'file:hrvoice.svg',
    group: ['trigger'],
    version: 1,
    subtitle: '={{$parameter["events"].join(", ")}}',
    description: 'Starts the workflow when an HRVoice screening call ends',
    defaults: { name: 'HRVoice Trigger' },
    inputs: [],
    outputs: ['main'],
    credentials: [{ name: 'hrVoiceApi', required: true }],
    webhooks: [{ name: 'default', httpMethod: 'POST', responseMode: 'onReceived', path: 'webhook' }],
    properties: [
      {
        displayName: 'Events',
        name: 'events',
        type: 'multiOptions',
        required: true,
        default: ['call.completed'],
        options: [
          { name: 'Call Completed', value: 'call.completed', description: 'The candidate answered; answers, summary and transcript' },
          { name: 'Call Failed', value: 'call.failed', description: 'No answer, busy, voicemail, too short, or skipped' },
        ],
      },
    ],
  };

  webhookMethods = {
    default: {
      async checkExists(this: IHookFunctions): Promise<boolean> {
        const data = this.getWorkflowStaticData('node');
        if (!data['endpointId']) return false;
        const { endpoints } = (await hrvoice(this, 'GET', '/v1/webhook-endpoints')) as { endpoints: Endpoint[] };
        const url = this.getNodeWebhookUrl('default');
        if (endpoints.some((e) => e.id === data['endpointId'] && e.url === url)) return true;
        delete data['endpointId'];
        delete data['secret'];
        return false;
      },
      async create(this: IHookFunctions): Promise<boolean> {
        const created = await hrvoice(this, 'POST', '/v1/webhook-endpoints', {
          url: this.getNodeWebhookUrl('default') as string,
          events: this.getNodeParameter('events') as string[],
        });
        const data = this.getWorkflowStaticData('node');
        data['endpointId'] = created['id'];
        data['secret'] = created['secret'];
        return true;
      },
      async delete(this: IHookFunctions): Promise<boolean> {
        const data = this.getWorkflowStaticData('node');
        if (data['endpointId']) {
          try {
            await hrvoice(this, 'DELETE', `/v1/webhook-endpoints/${encodeURIComponent(String(data['endpointId']))}`);
          } catch {
            // Already gone on the HRVoice side.
          }
        }
        delete data['endpointId'];
        delete data['secret'];
        return true;
      },
    },
  };

  async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
    const req = this.getRequestObject();
    const secret = String(this.getWorkflowStaticData('node')['secret'] ?? '');
    const raw = (req as unknown as { rawBody?: Buffer }).rawBody?.toString('utf8') ?? JSON.stringify(req.body);
    // Anything not signed by HRVoice is refused and never starts the workflow.
    if (!signatureOk(this.getHeaderData()['hrvoice-signature'] as string | undefined, raw, secret)) {
      this.getResponseObject().status(401).send('invalid signature');
      return { noWebhookResponse: true };
    }
    const event = JSON.parse(raw) as IDataObject;
    const wanted = this.getNodeParameter('events') as string[];
    if (!wanted.includes(String(event['type']))) return { webhookResponse: 'ignored' };
    return { workflowData: [this.helpers.returnJsonArray([event])] };
  }
}
