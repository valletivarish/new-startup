"""Run: python test_internal_test_call.py — the /internal/test-call guard."""
import os

os.environ["VOICE_INTERNAL_TOKEN"] = "tok-for-tests"

from fastapi.testclient import TestClient  # noqa: E402

import server  # noqa: E402

GOOD = {"callId": "test-0b0f6a2e-1c1d-4e8a-9a55-2a0c7f1b3d4e", "language": "hi"}


async def _noop(call_id: str, lang: str) -> None:
    return None


def test_guard():
    server.run_test_call = _noop
    with TestClient(server.app) as c:
        url = "/internal/test-call"
        assert c.post(url, json=GOOD).status_code == 404
        assert c.post(url, json=GOOD, headers={"x-voice-token": "wrong"}).status_code == 404
        ok = {"x-voice-token": "tok-for-tests"}
        assert c.post(url, json={"callId": "exo123"}, headers=ok).status_code == 422
        assert c.post(url, json=GOOD, headers=ok).status_code == 202
        server.TOKEN = ""  # unset token: the route does not exist
        assert c.post(url, json=GOOD, headers={"x-voice-token": ""}).status_code == 404
        server.TOKEN = "tok-for-tests"


def test_busy():
    server.TOKEN = "tok-for-tests"
    server._test_calls.update(object() for _ in range(server.MAX_TEST_CALLS))
    try:
        with TestClient(server.app) as c:
            res = c.post("/internal/test-call", json=GOOD, headers={"x-voice-token": "tok-for-tests"})
            assert res.status_code == 429
    finally:
        server._test_calls.clear()


if __name__ == "__main__":
    test_guard()
    test_busy()
    print("ok")
