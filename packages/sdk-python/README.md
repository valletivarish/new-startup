# hrvoice (Python)

Client for the HRVoice `/v1` API: create jobs, add consented candidates, start screening calls, read results and verify signed webhooks. Results are facts (answers, transcript, summary), never scores.

```python
from hrvoice import HRVoice, verify_webhook

hv = HRVoice(api_key="hrv_test_...", base_url="https://your-hrvoice-host")
job = hv.create_job({"title": "Warehouse Supervisor", "mustAskQuestions": ["What is your notice period?"]})
cand = hv.add_candidate(job["id"], {"fullName": "Asha Rao", "phone": "9000000101", "externalId": "ats-42", "consent": True})
call = hv.start_call(job["id"], cand["id"])
result = hv.get_results(job["id"], cand["id"])

# In your webhook handler, with the raw body and the secret from create_webhook_endpoint:
event = verify_webhook(raw_body, request.headers["HRVoice-Signature"], secret)
```

`AsyncHRVoice` has the same methods, awaited. Writes send an `Idempotency-Key` (a UUID unless you pass `idempotency_key=`), reused across retries; 429, 5xx and network errors are retried with backoff that honours `Retry-After` and `details.resetsAt`. Non-2xx answers raise `HRVoiceError` (`status`, `code`, `message`, `request_id`, `fields`, `details`, `resets_at`).

Types in `_generated.py` come from the API's OpenAPI document: `pnpm --filter @hrvoice/sdk generate`.

Tests: `uv run --extra dev pytest`.
