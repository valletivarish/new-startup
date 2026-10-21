# HRVoice for Power Automate and Power Apps

A custom connector: `apiDefinition.swagger.json` (Swagger 2.0 with `x-ms-*` extensions) and `apiProperties.json`. The Swagger is **generated** from the API's own OpenAPI document by `scripts/generate.ts`, and a test fails if the committed file differs from what the generator makes, so the connector cannot drift from `/v1`.

| Operation | Shown as |
|---|---|
| `WhenCallEnds` (webhook trigger) | When a screening call ends: completed and/or failed |
| `AddCandidate` | Add candidate (`consent` is required and can only be `true`) |
| `StartCall` | Start screening call (placed 9:00–20:00 India time, otherwise held until 9:00) |
| `RaiseTicket` | Raise support ticket |
| `CreateJob` | Create job |
| `FindCandidates`, `GetCall`, `GetResults` | Advanced actions |
| `ListJobs`, `DeleteWebhook` | Internal (job dropdown; unsubscribing) |

The trigger posts the flow's callback URL to `/v1/webhook-endpoints`; Power Automate later unsubscribes by calling `DELETE` on the `Location` header that call returns. Power Automate cannot check the `HRVoice-Signature` HMAC itself; its callback URL carries its own signature, so only a holder of that URL (HRVoice) can start the flow.

## Regenerate and test

```sh
pnpm --filter @hrvoice/power-automate generate                     # from the source, i.e. what /v1/openapi.json serves
pnpm --filter @hrvoice/power-automate generate -- https://nexstopp.com/backend/v1/openapi.json   # or from a running API
pnpm --filter @hrvoice/power-automate test                         # same as generated, valid Swagger 2.0, operations, consent, no score
```

Run `generate` and commit the result whenever the `/v1` schemas change.

## Importing it (the founder, with the company's Microsoft account)

1. make.powerautomate.com → **Custom connectors** (under Data, or More) → **New custom connector** → **Import an OpenAPI file**. Name it `HRVoice` and pick `apiDefinition.swagger.json`.
2. **General**: upload the icon (square PNG, under 1 MB), background colour `#1f2a44`. Scheme HTTPS, host `nexstopp.com`, base URL `/backend` (already filled in).
3. **Security**: API Key; label "API key"; parameter name `Authorization`; location Header.
4. **Definition**: nothing to change. **Create connector**.
5. **Test**: New connection → type `Bearer hrv_test_…` (the word Bearer, a space, then a test key with scopes jobs, candidates, calls, results, webhooks, support). Run `ListJobs`, then build a flow with "When a screening call ends" and "Add candidate" to see the trigger fire on a free test call.

Or from a terminal, with Microsoft's `paconn` CLI: `pip install paconn`, `paconn login`, then `paconn create --api-def apiDefinition.swagger.json --api-prop apiProperties.json --icon <icon.png>` (and `paconn update …` for later versions).

6. **Share** the connector with people in the same Microsoft tenant from its menu. Clients in other tenants import the same two files themselves (steps 1–5) until the connector is certified.
7. **Certification** (listed for every Power Automate user): Microsoft's connector certification, through Partner Center as a verified publisher. It needs the company's legal name as `publisher` and `stackOwner` in `apiProperties.json`, a privacy-policy URL (nexstopp.com has none yet) and a support contact, plus Microsoft's readme and intro files. Run `paconn validate --api-def apiDefinition.swagger.json` before submitting.
