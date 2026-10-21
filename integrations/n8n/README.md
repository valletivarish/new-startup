# n8n-nodes-hrvoice

n8n community nodes for HRVoice, a thin layer over the public `/v1` API.

- **HRVoice API** credential: API key (sent as `Authorization: Bearer …`) and the API URL (default `https://nexstopp.com/backend`). Tested with `GET /v1/ping`.
- **HRVoice** node: Add Candidate (consent is a required switch; the node refuses before sending anything without it), Start Screening Call (placed 9:00–20:00 India time, otherwise held until 9:00), Raise Support Ticket, Create Job, Find Candidate (your ID or phone). Jobs load into a dropdown.
- **HRVoice Trigger** node: Call Completed and/or Call Failed. Activating the workflow creates a `/v1/webhook-endpoints` entry for the n8n webhook URL and keeps its signing secret in the node's static data; every delivery's `HRVoice-Signature` is checked (HMAC-SHA256, 5-minute window) and anything else gets a 401 and never starts the workflow. Deactivating deletes the endpoint.

The API key needs the scopes `jobs`, `candidates`, `calls`, `results`, `webhooks` and `support`. No runtime dependencies; `n8n-workflow` is a peer dependency provided by n8n.

## Build and test

```sh
pnpm --filter n8n-nodes-hrvoice build   # tsc to dist/, plus the icon
pnpm --filter n8n-nodes-hrvoice test    # execute(), loadOptions and the webhook methods against a fake HRVoice
```

## Try it in a local n8n

```sh
pnpm --filter n8n-nodes-hrvoice build
cd integrations/n8n && npm link
mkdir -p ~/.n8n/custom && cd ~/.n8n/custom && npm link n8n-nodes-hrvoice
npx n8n start     # the nodes appear as "HRVoice" and "HRVoice Trigger"
```

The trigger needs a URL HRVoice can reach: in production HRVoice only posts to `https` addresses, so run n8n behind https (or use `n8n start --tunnel` for a quick try).

## Publishing (the founder, with the company's npm account)

1. `npm login` with the account that should own the package.
2. Bump `version` in `package.json`, then:
   ```sh
   pnpm --filter n8n-nodes-hrvoice build
   cd integrations/n8n && npm publish --access public
   ```
   Self-hosted n8n users can then install it from Settings → Community nodes → Install → `n8n-nodes-hrvoice`.
3. To be listed for n8n Cloud as a verified node: run n8n's scanner, `npx @n8n/scan-community-package n8n-nodes-hrvoice`, fix anything it reports, then submit the package through the n8n Creator Portal. Check n8n's current verification guidelines first; they set rules such as no runtime dependencies (this package has none) and how the package must be published.
