# @hrvoice/mcp

An MCP server (stdio) that lets an AI assistant run HRVoice phone screens: create a job, add consented candidates, start calls and read the results. It is a thin layer over [`@hrvoice/sdk`](../../packages/sdk-js) and the public `/v1` API; results are answers and a neutral summary, never a score.

| Tool | What it does |
|---|---|
| `create_job` | Create a job with must-ask questions and a screening language |
| `list_jobs` | List the company's jobs |
| `add_candidates` | Add 1-100 candidates (the user must confirm consent; same `externalId` updates) |
| `start_call` | Queue a screening call for one candidate |
| `get_call` | Call status, and its result once ended |
| `get_results` | Latest answers and summary (transcript on request) |
| `list_candidates` | One page of a job's candidates |
| `get_usage` | Calls placed and billable screens for a month |

Environment: `HRVOICE_API_KEY` (`hrv_live_...`, or `hrv_test_...` for free calls on the fake line) and `HRVOICE_API_URL` (your HRVoice API origin). Create a key in Settings → Developers.

## Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "hrvoice": {
      "command": "npx",
      "args": ["-y", "@hrvoice/mcp"],
      "env": {
        "HRVOICE_API_KEY": "hrv_test_...",
        "HRVOICE_API_URL": "https://your-hrvoice-host"
      }
    }
  }
}
```

## Claude Code

```sh
claude mcp add hrvoice --env HRVOICE_API_KEY=hrv_test_... --env HRVOICE_API_URL=https://your-hrvoice-host -- npx -y @hrvoice/mcp
```

## From this repo (before the package is published)

Node 22.18+ runs the TypeScript source directly; use it in place of `npx -y @hrvoice/mcp` above:

```sh
node /path/to/repo/apps/mcp/src/index.ts
```

Or `pnpm --filter @hrvoice/mcp build` and run `node /path/to/repo/apps/mcp/dist/index.js`.

Tests: `pnpm --filter @hrvoice/mcp test` (tool handlers with a mock SDK, and the tools over an in-memory MCP connection). The `pnpm test:clients` e2e also drives this server over stdio against a real local stack.
