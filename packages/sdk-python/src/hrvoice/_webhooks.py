"""Verifying HRVoice webhook deliveries."""

from __future__ import annotations

import hashlib
import hmac
import json
import re
import time
from typing import Literal

from ._generated import WebhookEvent


class WebhookVerificationError(Exception):
    pass


class CallCompletedEvent(WebhookEvent):
    type: Literal["call.completed"]  # type: ignore[misc]


class CallFailedEvent(WebhookEvent):
    type: Literal["call.failed"]  # type: ignore[misc]


HRVoiceEvent = CallCompletedEvent | CallFailedEvent


def verify_webhook(
    raw_body: str | bytes,
    header: str | None,
    secret: str,
    tolerance_sec: int = 300,
    now: float | None = None,
) -> HRVoiceEvent:
    """Checks ``HRVoice-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>``
    against the raw request body and returns the event. Raises WebhookVerificationError on a
    bad signature or a timestamp more than ``tolerance_sec`` from now. Constant-time compare."""
    if not header:
        raise WebhookVerificationError("missing HRVoice-Signature header")
    parts = dict(p.strip().split("=", 1) for p in header.split(",") if "=" in p)
    t, sig = parts.get("t", ""), parts.get("v1", "")
    if not re.fullmatch(r"\d+", t) or not re.fullmatch(r"(?:[0-9a-fA-F]{2})+", sig):
        raise WebhookVerificationError("malformed HRVoice-Signature header")
    if abs((time.time() if now is None else now) - int(t)) > tolerance_sec:
        raise WebhookVerificationError("HRVoice-Signature timestamp outside the tolerance")
    body = raw_body if isinstance(raw_body, bytes) else raw_body.encode()
    expected = hmac.new(secret.encode(), t.encode() + b"." + body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig.lower()):
        raise WebhookVerificationError("HRVoice-Signature does not match")
    return json.loads(body)
