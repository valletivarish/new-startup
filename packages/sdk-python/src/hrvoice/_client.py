"""HRVoice /v1 clients (sync and async) over httpx."""

from __future__ import annotations

import asyncio
import random
import time
import uuid
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

import httpx

from ._generated import (
    Call,
    Candidate,
    CandidateCreate,
    CandidateCreated,
    Job,
    JobCreate,
    JobPatch,
    Result,
    Usage,
    WebhookDelivery,
    WebhookEndpoint,
    WebhookEndpointCreate,
    WebhookEndpointCreated,
)

_RETRY_STATUS = {429, 500, 502, 503, 504}


class HRVoiceError(Exception):
    """Any non-2xx answer, carrying the API's error envelope."""

    def __init__(self, status: int, body: dict[str, Any] | None, fallback: str) -> None:
        body = body or {}
        self.status = status
        self.code: str = body.get("code") or ("network_error" if status == 0 else "http_error")
        self.message: str = body.get("message") or fallback
        self.request_id: str | None = body.get("request_id")
        self.fields: list[dict[str, str]] = body.get("errors") or []
        self.details: dict[str, Any] = body.get("details") or {}
        super().__init__(self.message)

    @property
    def resets_at(self) -> datetime | None:
        """When a rate or call limit lifts (``details.resetsAt``), if the API said."""
        r = self.details.get("resetsAt")
        return datetime.fromisoformat(r.replace("Z", "+00:00")) if isinstance(r, str) else None


def _q(s: str) -> str:
    return quote(s, safe="")


def _backoff(attempt: int) -> float:
    """0.5 s, 1 s, 2 s ... capped at 8 s, with jitter."""
    return min(8.0, 0.5 * 2**attempt) * (0.75 + random.random() * 0.5)


class _Base:
    def __init__(
        self,
        api_key: str,
        base_url: str,
        *,
        max_retries: int = 2,
        max_retry_delay: float = 30.0,
        timeout: float = 30.0,
    ) -> None:
        if not api_key:
            raise ValueError("HRVoice: api_key is required")
        if not base_url:
            raise ValueError("HRVoice: base_url is required")
        self._key = api_key
        self._base = base_url.rstrip("/")
        self._retries = max_retries
        self._max_delay = max_retry_delay
        self._timeout = timeout

    @property
    def is_test(self) -> bool:
        return self._key.startswith("hrv_test_")

    def recording_url(self, call_id: str) -> str:
        """Where the recording streams from (needs this key as a Bearer token)."""
        return f"{self._base}/v1/calls/{_q(call_id)}/recording"

    def _prepare(self, method: str, path: str, body: Any, params: dict[str, Any] | None, idem: str | None) -> dict[str, Any]:
        headers = {"authorization": f"Bearer {self._key}", "accept": "application/json"}
        if method != "GET":
            # Reused across retries, so a retried write never runs twice.
            headers["idempotency-key"] = idem or str(uuid.uuid4())
        kw: dict[str, Any] = {"method": method, "url": f"{self._base}{path}", "headers": headers}
        if params:
            kw["params"] = {k: v for k, v in params.items() if v is not None}
        if body is not None:
            kw["json"] = body
        return kw

    def _failure(self, r: httpx.Response, attempt: int) -> tuple[HRVoiceError, float | None]:
        """The error for a non-2xx response, and how long to wait before a retry (None: don't)."""
        try:
            parsed = r.json()
            body = parsed if isinstance(parsed, dict) and "code" in parsed else None
        except ValueError:
            body = None
        err = HRVoiceError(r.status_code, body, f"HTTP {r.status_code}")
        if attempt >= self._retries or not (r.status_code in _RETRY_STATUS or err.code == "idempotency_in_progress"):
            return err, None
        wait = _backoff(attempt)
        if err.resets_at:
            wait = max(wait, (err.resets_at - datetime.now(timezone.utc)).total_seconds())
        try:
            wait = max(wait, float(r.headers.get("retry-after", "")))
        except ValueError:
            pass
        return err, (wait if wait <= self._max_delay else None)

    @staticmethod
    def _body(r: httpx.Response) -> Any:
        return r.json() if r.content else None


class HRVoice(_Base):
    """Sync client. ``HRVoice(api_key="hrv_test_...", base_url="https://...")``."""

    def __init__(self, api_key: str, base_url: str, *, transport: httpx.BaseTransport | None = None, **kw: Any) -> None:
        super().__init__(api_key, base_url, **kw)
        self._http = httpx.Client(timeout=self._timeout, transport=transport)

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> HRVoice:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def _send(self, method: str, path: str, body: Any = None, params: dict[str, Any] | None = None, idem: str | None = None) -> httpx.Response:
        kw = self._prepare(method, path, body, params, idem)
        attempt = 0
        while True:
            try:
                r = self._http.request(**kw)
            except httpx.TransportError as e:
                if attempt >= self._retries:
                    raise HRVoiceError(0, None, f"HRVoice request failed: {e}") from e
                time.sleep(_backoff(attempt))
                attempt += 1
                continue
            if r.is_success:
                return r
            err, wait = self._failure(r, attempt)
            if wait is None:
                raise err
            time.sleep(wait)
            attempt += 1

    def _json(self, method: str, path: str, body: Any = None, params: dict[str, Any] | None = None, idem: str | None = None) -> Any:
        return self._body(self._send(method, path, body, params, idem))

    # Account
    def ping(self) -> dict[str, Any]:
        """Checks the key; returns its company and key mode."""
        return self._json("GET", "/v1/ping")

    def openapi(self) -> dict[str, Any]:
        return self._json("GET", "/v1/openapi.json")

    # Jobs
    def list_jobs(self) -> list[Job]:
        return self._json("GET", "/v1/jobs")["jobs"]

    def create_job(self, job: JobCreate, *, idempotency_key: str | None = None) -> Job:
        """``mustAskQuestions`` are asked on every screen for this job."""
        return self._json("POST", "/v1/jobs", job, idem=idempotency_key)

    def get_job(self, job_id: str) -> Job:
        return self._json("GET", f"/v1/jobs/{_q(job_id)}")

    def update_job(self, job_id: str, patch: JobPatch, *, idempotency_key: str | None = None) -> Job:
        return self._json("PATCH", f"/v1/jobs/{_q(job_id)}", patch, idem=idempotency_key)

    # Candidates
    def list_candidates(self, job_id: str, *, limit: int | None = None, cursor: str | None = None) -> dict[str, Any]:
        """One page: ``{"candidates": [...], "nextCursor": ...}``."""
        return self._json("GET", f"/v1/jobs/{_q(job_id)}/candidates", params={"limit": limit, "cursor": cursor})

    def add_candidate(self, job_id: str, candidate: CandidateCreate, *, idempotency_key: str | None = None) -> CandidateCreated:
        """``consent: True`` is required. An ``externalId`` already on the job updates in place (``created`` False)."""
        return self._json("POST", f"/v1/jobs/{_q(job_id)}/candidates", candidate, idem=idempotency_key)

    def add_candidates(self, job_id: str, candidates: list[CandidateCreate], *, idempotency_key: str | None = None) -> list[CandidateCreated]:
        """1-100 candidates in one request."""
        return self._json("POST", f"/v1/jobs/{_q(job_id)}/candidates", {"candidates": candidates}, idem=idempotency_key)["candidates"]

    def get_candidate(self, job_id: str, candidate_id: str) -> Candidate:
        return self._json("GET", f"/v1/jobs/{_q(job_id)}/candidates/{_q(candidate_id)}")

    # Calls and results
    def start_call(self, job_id: str, candidate_id: str, *, idempotency_key: str | None = None) -> Call:
        """Queues a screening call. Poll ``get_call`` or listen for call.completed / call.failed."""
        return self._json("POST", f"/v1/jobs/{_q(job_id)}/candidates/{_q(candidate_id)}/calls", idem=idempotency_key)

    def get_call(self, call_id: str) -> Call:
        return self._json("GET", f"/v1/calls/{_q(call_id)}")

    def get_results(self, job_id: str, candidate_id: str) -> Result:
        """The candidate's latest screen: answers, summary, transcript. Never a score."""
        return self._json("GET", f"/v1/jobs/{_q(job_id)}/candidates/{_q(candidate_id)}/results")

    def get_recording(self, call_id: str) -> tuple[str, bytes]:
        """``(content_type, audio bytes)``."""
        r = self._send("GET", f"/v1/calls/{_q(call_id)}/recording")
        return r.headers.get("content-type", "application/octet-stream"), r.content

    # Usage
    def get_usage(self, month: str | None = None) -> Usage:
        """Calls placed and billable screens for ``month`` (YYYY-MM, default this month IST)."""
        return self._json("GET", "/v1/usage", params={"month": month})

    # Candidate links
    def create_candidate_link(self, job_id: str, body: dict[str, Any] | None = None, *, idempotency_key: str | None = None) -> dict[str, str]:
        """A personal link for a candidate with no number: ``{"url", "expiresAt"}``."""
        return self._json("POST", f"/v1/jobs/{_q(job_id)}/candidate-links", body or {}, idem=idempotency_key)

    # Webhooks
    def create_webhook_endpoint(self, endpoint: WebhookEndpointCreate, *, idempotency_key: str | None = None) -> WebhookEndpointCreated:
        """The returned ``secret`` is shown only here; keep it for ``verify_webhook``."""
        return self._json("POST", "/v1/webhook-endpoints", endpoint, idem=idempotency_key)

    def list_webhook_endpoints(self) -> list[WebhookEndpoint]:
        return self._json("GET", "/v1/webhook-endpoints")["endpoints"]

    def delete_webhook_endpoint(self, endpoint_id: str, *, idempotency_key: str | None = None) -> dict[str, bool]:
        return self._json("DELETE", f"/v1/webhook-endpoints/{_q(endpoint_id)}", idem=idempotency_key)

    def list_webhook_deliveries(self, status: str | None = None) -> list[WebhookDelivery]:
        return self._json("GET", "/v1/webhook-deliveries", params={"status": status})["deliveries"]

    def resend_webhook_delivery(self, delivery_id: str, *, idempotency_key: str | None = None) -> WebhookDelivery:
        return self._json("POST", f"/v1/webhook-deliveries/{_q(delivery_id)}/resend", idem=idempotency_key)


class AsyncHRVoice(_Base):
    """Async client; same methods as ``HRVoice``, awaited."""

    def __init__(self, api_key: str, base_url: str, *, transport: httpx.AsyncBaseTransport | None = None, **kw: Any) -> None:
        super().__init__(api_key, base_url, **kw)
        self._http = httpx.AsyncClient(timeout=self._timeout, transport=transport)

    async def aclose(self) -> None:
        await self._http.aclose()

    async def __aenter__(self) -> AsyncHRVoice:
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.aclose()

    async def _send(self, method: str, path: str, body: Any = None, params: dict[str, Any] | None = None, idem: str | None = None) -> httpx.Response:
        kw = self._prepare(method, path, body, params, idem)
        attempt = 0
        while True:
            try:
                r = await self._http.request(**kw)
            except httpx.TransportError as e:
                if attempt >= self._retries:
                    raise HRVoiceError(0, None, f"HRVoice request failed: {e}") from e
                await asyncio.sleep(_backoff(attempt))
                attempt += 1
                continue
            if r.is_success:
                return r
            err, wait = self._failure(r, attempt)
            if wait is None:
                raise err
            await asyncio.sleep(wait)
            attempt += 1

    async def _json(self, method: str, path: str, body: Any = None, params: dict[str, Any] | None = None, idem: str | None = None) -> Any:
        return self._body(await self._send(method, path, body, params, idem))

    async def ping(self) -> dict[str, Any]:
        return await self._json("GET", "/v1/ping")

    async def openapi(self) -> dict[str, Any]:
        return await self._json("GET", "/v1/openapi.json")

    async def list_jobs(self) -> list[Job]:
        return (await self._json("GET", "/v1/jobs"))["jobs"]

    async def create_job(self, job: JobCreate, *, idempotency_key: str | None = None) -> Job:
        return await self._json("POST", "/v1/jobs", job, idem=idempotency_key)

    async def get_job(self, job_id: str) -> Job:
        return await self._json("GET", f"/v1/jobs/{_q(job_id)}")

    async def update_job(self, job_id: str, patch: JobPatch, *, idempotency_key: str | None = None) -> Job:
        return await self._json("PATCH", f"/v1/jobs/{_q(job_id)}", patch, idem=idempotency_key)

    async def list_candidates(self, job_id: str, *, limit: int | None = None, cursor: str | None = None) -> dict[str, Any]:
        return await self._json("GET", f"/v1/jobs/{_q(job_id)}/candidates", params={"limit": limit, "cursor": cursor})

    async def add_candidate(self, job_id: str, candidate: CandidateCreate, *, idempotency_key: str | None = None) -> CandidateCreated:
        return await self._json("POST", f"/v1/jobs/{_q(job_id)}/candidates", candidate, idem=idempotency_key)

    async def add_candidates(self, job_id: str, candidates: list[CandidateCreate], *, idempotency_key: str | None = None) -> list[CandidateCreated]:
        return (await self._json("POST", f"/v1/jobs/{_q(job_id)}/candidates", {"candidates": candidates}, idem=idempotency_key))["candidates"]

    async def get_candidate(self, job_id: str, candidate_id: str) -> Candidate:
        return await self._json("GET", f"/v1/jobs/{_q(job_id)}/candidates/{_q(candidate_id)}")

    async def start_call(self, job_id: str, candidate_id: str, *, idempotency_key: str | None = None) -> Call:
        return await self._json("POST", f"/v1/jobs/{_q(job_id)}/candidates/{_q(candidate_id)}/calls", idem=idempotency_key)

    async def get_call(self, call_id: str) -> Call:
        return await self._json("GET", f"/v1/calls/{_q(call_id)}")

    async def get_results(self, job_id: str, candidate_id: str) -> Result:
        return await self._json("GET", f"/v1/jobs/{_q(job_id)}/candidates/{_q(candidate_id)}/results")

    async def get_recording(self, call_id: str) -> tuple[str, bytes]:
        r = await self._send("GET", f"/v1/calls/{_q(call_id)}/recording")
        return r.headers.get("content-type", "application/octet-stream"), r.content

    async def get_usage(self, month: str | None = None) -> Usage:
        return await self._json("GET", "/v1/usage", params={"month": month})

    async def create_candidate_link(self, job_id: str, body: dict[str, Any] | None = None, *, idempotency_key: str | None = None) -> dict[str, str]:
        return await self._json("POST", f"/v1/jobs/{_q(job_id)}/candidate-links", body or {}, idem=idempotency_key)

    async def create_webhook_endpoint(self, endpoint: WebhookEndpointCreate, *, idempotency_key: str | None = None) -> WebhookEndpointCreated:
        return await self._json("POST", "/v1/webhook-endpoints", endpoint, idem=idempotency_key)

    async def list_webhook_endpoints(self) -> list[WebhookEndpoint]:
        return (await self._json("GET", "/v1/webhook-endpoints"))["endpoints"]

    async def delete_webhook_endpoint(self, endpoint_id: str, *, idempotency_key: str | None = None) -> dict[str, bool]:
        return await self._json("DELETE", f"/v1/webhook-endpoints/{_q(endpoint_id)}", idem=idempotency_key)

    async def list_webhook_deliveries(self, status: str | None = None) -> list[WebhookDelivery]:
        return (await self._json("GET", "/v1/webhook-deliveries", params={"status": status}))["deliveries"]

    async def resend_webhook_delivery(self, delivery_id: str, *, idempotency_key: str | None = None) -> WebhookDelivery:
        return await self._json("POST", f"/v1/webhook-deliveries/{_q(delivery_id)}/resend", idem=idempotency_key)
