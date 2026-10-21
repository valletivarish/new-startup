import asyncio
import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone

import httpx
import pytest

import hrvoice._client as client_mod
from hrvoice import AsyncHRVoice, HRVoice, HRVoiceError, WebhookVerificationError, verify_webhook


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    """Backoff waits are recorded, not slept."""
    waits: list[float] = []
    monkeypatch.setattr(client_mod.time, "sleep", waits.append)

    async def fake(s):
        waits.append(s)

    monkeypatch.setattr(client_mod.asyncio, "sleep", fake)
    return waits


def envelope(code, **extra):
    return {"code": code, "message": code, "request_id": "req-1", **extra}


def queue(*responses):
    """A MockTransport that answers from a list and records requests."""
    seen: list[httpx.Request] = []
    items = list(responses)

    def handler(request: httpx.Request):
        seen.append(request)
        nxt = items.pop(0)
        if isinstance(nxt, Exception):
            raise nxt
        return nxt

    return handler, seen


def sync_client(handler, **kw):
    return HRVoice("hrv_test_x", "http://api.test/", transport=httpx.MockTransport(handler), **kw)


def test_auth_paths_and_query():
    handler, seen = queue(httpx.Response(200, json={"candidates": [], "nextCursor": None}))
    sync_client(handler).list_candidates("job 1", limit=5)
    assert str(seen[0].url) == "http://api.test/v1/jobs/job%201/candidates?limit=5"
    assert seen[0].headers["authorization"] == "Bearer hrv_test_x"
    assert "idempotency-key" not in seen[0].headers


def test_idempotency_key_auto_and_override():
    handler, seen = queue(httpx.Response(201, json={"id": "j"}), httpx.Response(202, json={"id": "c"}))
    hv = sync_client(handler)
    hv.create_job({"title": "Picker"})
    hv.start_call("j", "cand", idempotency_key="mine")
    assert len(seen[0].headers["idempotency-key"]) == 36
    assert seen[1].headers["idempotency-key"] == "mine"
    assert json.loads(seen[0].content) == {"title": "Picker"}


def test_batch_and_unwrap():
    handler, seen = queue(
        httpx.Response(201, json={"candidates": [{"id": "a", "created": True}]}),
        httpx.Response(200, json={"jobs": [{"id": "j"}]}),
    )
    hv = sync_client(handler)
    assert hv.add_candidates("j", [{"fullName": "A", "consent": True}]) == [{"id": "a", "created": True}]
    assert json.loads(seen[0].content) == {"candidates": [{"fullName": "A", "consent": True}]}
    assert hv.list_jobs() == [{"id": "j"}]


def test_retry_429_honours_retry_after_and_keeps_key(no_sleep):
    handler, seen = queue(
        httpx.Response(429, json=envelope("rate_limited"), headers={"retry-after": "3"}),
        httpx.Response(202, json={"id": "call"}),
    )
    assert sync_client(handler).start_call("j", "c") == {"id": "call"}
    assert no_sleep == [3.0]
    assert seen[0].headers["idempotency-key"] == seen[1].headers["idempotency-key"]


def test_retry_5xx_and_network_then_give_up():
    handler, _ = queue(
        httpx.ConnectError("boom"),
        httpx.Response(503, json=envelope("service_unavailable")),
        httpx.Response(200, json={"ok": 1}),
    )
    assert sync_client(handler).ping() == {"ok": 1}

    handler, seen = queue(httpx.Response(500, json=envelope("internal")), httpx.Response(500, json=envelope("internal")))
    with pytest.raises(HRVoiceError) as e:
        sync_client(handler, max_retries=1).ping()
    assert (e.value.status, e.value.code, len(seen)) == (500, "internal", 2)


def test_call_limit_hours_away_fails_fast():
    resets = (datetime.now(timezone.utc) + timedelta(hours=6)).isoformat()
    handler, seen = queue(httpx.Response(429, json=envelope("call_limit_reached", details={"resetsAt": resets})))
    with pytest.raises(HRVoiceError) as e:
        sync_client(handler).start_call("j", "c")
    assert e.value.code == "call_limit_reached"
    assert e.value.resets_at is not None and len(seen) == 1


def test_error_envelope_mapping_no_retry_on_4xx():
    handler, seen = queue(
        httpx.Response(422, json=envelope("validation_failed", errors=[{"field": "title", "message": "Required"}])),
        httpx.Response(404, text="<html>nope</html>"),
    )
    hv = sync_client(handler)
    with pytest.raises(HRVoiceError) as e:
        hv.create_job({"title": ""})
    assert (e.value.status, e.value.code, e.value.request_id) == (422, "validation_failed", "req-1")
    assert e.value.fields == [{"field": "title", "message": "Required"}]
    with pytest.raises(HRVoiceError) as e2:
        hv.get_job("x")
    assert (e2.value.status, e2.value.code) == (404, "http_error")
    assert len(seen) == 2


def test_async_client_same_surface(no_sleep):
    handler, seen = queue(
        httpx.Response(429, json=envelope("rate_limited")),
        httpx.Response(200, json={"jobs": [{"id": "j"}]}),
    )

    async def run():
        async with AsyncHRVoice("hrv_test_x", "http://api.test", transport=httpx.MockTransport(handler)) as hv:
            return await hv.list_jobs()

    assert asyncio.run(run()) == [{"id": "j"}]
    assert len(seen) == 2 and len(no_sleep) == 1
    assert {n for n in dir(HRVoice) if not n.startswith("_")} == {n for n in dir(AsyncHRVoice) if not n.startswith("_")} - {"aclose"} | {"close"}


SECRET = "whsec_test"
BODY = json.dumps({"id": "evt_1", "type": "call.completed", "createdAt": "x", "data": {}})
NOW = 1_760_000_000


def sign(t, body=BODY, key=SECRET):
    return f"t={t},v1={hmac.new(key.encode(), f'{t}.{body}'.encode(), hashlib.sha256).hexdigest()}"


def test_verify_webhook_valid():
    evt = verify_webhook(BODY, sign(NOW), SECRET, now=NOW)
    assert evt["type"] == "call.completed"
    assert verify_webhook(BODY.encode(), sign(NOW), SECRET, now=NOW)["id"] == "evt_1"


@pytest.mark.parametrize(
    "body,header,match",
    [
        (BODY.replace("evt_1", "evt_2"), sign(NOW), "does not match"),
        (BODY, sign(NOW, key="other"), "does not match"),
        (BODY, f"t={NOW},v1={'0' * 64}", "does not match"),
        (BODY, sign(NOW - 301), "tolerance"),
        (BODY, sign(NOW + 301), "tolerance"),
        (BODY, "v1=abc", "malformed"),
        (BODY, None, "missing"),
    ],
)
def test_verify_webhook_rejects(body, header, match):
    with pytest.raises(WebhookVerificationError, match=match):
        verify_webhook(body, header, SECRET, now=NOW)
