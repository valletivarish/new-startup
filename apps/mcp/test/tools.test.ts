import { HRVoiceError } from '@hrvoice/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it, vi } from 'vitest';

import { call, register, scrub, tools } from '../src/tools.ts';

const JOB = '11111111-1111-4111-8111-111111111111';
const CAND = '22222222-2222-4222-8222-222222222222';

function mockSdk() {
  return {
    createJob: vi.fn(async (j: object) => ({ id: JOB, ...j })),
    listJobs: vi.fn(async () => [{ id: JOB, title: 'Java' }]),
    addCandidates: vi.fn(async (_job: string, cs: object[]) => cs.map((c) => ({ ...c, id: CAND, created: true }))),
    startCall: vi.fn(async () => ({ id: 'call-1', status: 'queued' })),
    getCall: vi.fn(async () => ({ id: 'call-1', status: 'placed', result: null })),
    getResults: vi.fn(async () => ({
      status: 'ended', answers: [{ questionId: 'q1', question: 'Notice?', answer: '30 days' }],
      summary: 'Asha has a 30 day notice period.', transcript: [{ role: 'agent', message: 'Hi' }],
      fitPercent: 82, score: 4,
    })),
    listCandidates: vi.fn(async () => ({ candidates: [], nextCursor: null })),
    getUsage: vi.fn(async () => ({ month: '2026-10', callsPlaced: 0, completedScreens: 0 })),
  };
}
type Sdk = ReturnType<typeof mockSdk>;
const text = (r: { content: { text: string }[] }) => JSON.parse(r.content[0]!.text);

describe('MCP tools', () => {
  it('exposes exactly the planned tools', () => {
    expect(Object.keys(tools(mockSdk() as never)).sort()).toEqual(
      ['add_candidates', 'create_job', 'get_call', 'get_results', 'get_usage', 'list_candidates', 'list_jobs', 'start_call'],
    );
  });

  it('add_candidates passes consent on every candidate', async () => {
    const sdk = mockSdk();
    const t = tools(sdk as never);
    const r = await call(t.add_candidates, { jobId: JOB, consent: true, candidates: [{ fullName: 'Asha', phone: '9000000101' }] });
    expect(sdk.addCandidates).toHaveBeenCalledWith(JOB, [{ fullName: 'Asha', phone: '9000000101', consent: true }]);
    expect(text(r)[0].created).toBe(true);
  });

  it('get_results never includes a score and drops the transcript unless asked', async () => {
    const sdk: Sdk = mockSdk();
    const t = tools(sdk as never);
    const out = text(await call(t.get_results, { jobId: JOB, candidateId: CAND }));
    expect(out.summary).toContain('30 day');
    expect(out).not.toHaveProperty('fitPercent');
    expect(out).not.toHaveProperty('score');
    expect(out).not.toHaveProperty('transcript');
    const full = text(await call(t.get_results, { jobId: JOB, candidateId: CAND, includeTranscript: true }));
    expect(full.transcript).toHaveLength(1);
    expect(JSON.stringify(full)).not.toMatch(/fitPercent|score/i);
  });

  it('scrub removes score-like keys at any depth', () => {
    expect(scrub({ a: [{ fit_percent: 1, recommendation: 'hire', ok: { overallScore: 2, keep: 1 } }] })).toEqual({
      a: [{ ok: { keep: 1 } }],
    });
  });

  it('API errors come back as readable tool errors', async () => {
    const sdk = mockSdk();
    sdk.startCall.mockRejectedValueOnce(
      new HRVoiceError(429, { code: 'call_limit_reached', message: 'Daily call limit reached', request_id: 'r',
        details: { resetsAt: '2026-10-22T00:00:00.000Z' } }, 'x'),
    );
    const r = await call(tools(sdk as never).start_call, { jobId: JOB, candidateId: CAND });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toBe(
      'HRVoice 429 call_limit_reached: Daily call limit reached Resets at 2026-10-22T00:00:00.000Z.',
    );
  });

  it('registers on an MCP server and validates input over the protocol', async () => {
    const sdk = mockSdk();
    const server = new McpServer({ name: 'hrvoice', version: 'test' });
    register(server, sdk as never);
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '1' });
    await Promise.all([server.connect(a), client.connect(b)]);

    const listed = await client.listTools();
    expect(listed.tools.map((t) => t.name)).toContain('create_job');
    const create = listed.tools.find((t) => t.name === 'create_job')!;
    expect(create.inputSchema.required).toEqual(['title']);

    const r = await client.callTool({ name: 'create_job', arguments: { title: 'Java Developer', mustAskQuestions: ['Notice?'] } });
    expect(JSON.parse((r.content as { text: string }[])[0]!.text).id).toBe(JOB);

    // consent must be literally true
    const refused = await client.callTool({
      name: 'add_candidates', arguments: { jobId: JOB, consent: false, candidates: [{ fullName: 'X' }] },
    });
    expect(refused.isError).toBe(true);
    expect(sdk.addCandidates).not.toHaveBeenCalled();
    await client.close();
  });
});
