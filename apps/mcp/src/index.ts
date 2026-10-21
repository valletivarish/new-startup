#!/usr/bin/env node
/**
 * HRVoice MCP server over stdio. Env: HRVOICE_API_KEY (hrv_live_... or hrv_test_...)
 * and HRVOICE_API_URL (the HRVoice API origin).
 */

import { HRVoice } from '@hrvoice/sdk';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { register } from './tools.ts';

const apiKey = process.env['HRVOICE_API_KEY'];
const baseUrl = process.env['HRVOICE_API_URL'];
if (!apiKey || !baseUrl) {
  // stdout is the MCP channel; diagnostics go to stderr.
  console.error('hrvoice-mcp: set HRVOICE_API_KEY and HRVOICE_API_URL');
  process.exit(1);
}

const server = new McpServer(
  { name: 'hrvoice', version: '0.1.0' },
  {
    instructions:
      'HRVoice places AI phone screening calls to job candidates. Typical flow: create_job (or list_jobs), ' +
      'add_candidates (only with the user confirming consent), start_call per candidate, then get_results. ' +
      'Results are answers and a neutral summary; never turn them into a score or a hire/reject recommendation.',
  },
);
register(server, new HRVoice({ apiKey, baseUrl }));
await server.connect(new StdioServerTransport());
