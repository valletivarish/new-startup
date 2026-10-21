import type { IAuthenticateGeneric, ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

export class HRVoiceApi implements ICredentialType {
  name = 'hrVoiceApi';
  displayName = 'HRVoice API';
  documentationUrl = 'https://nexstopp.com/developers';
  properties: INodeProperties[] = [
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: true,
      description:
        'Create one in HRVoice under Settings → Developers with the jobs, candidates, calls, results, webhooks and support scopes. Keys starting hrv_test_ place free calls on a test line.',
    },
    {
      displayName: 'API URL',
      name: 'baseUrl',
      type: 'string',
      default: 'https://nexstopp.com/backend',
    },
  ];
  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: { headers: { Authorization: '=Bearer {{$credentials.apiKey}}' } },
  };
  test: ICredentialTestRequest = {
    request: { baseURL: '={{$credentials.baseUrl.replace(/\\/$/, "")}}', url: '/v1/ping' },
  };
}
