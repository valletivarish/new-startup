"""HRVoice /v1 API client. Results are facts (answers, transcript, summary), never scores."""

from ._client import AsyncHRVoice, HRVoice, HRVoiceError
from ._generated import *  # noqa: F403  (the TypedDicts for every /v1 schema)
from ._webhooks import CallCompletedEvent, CallFailedEvent, HRVoiceEvent, WebhookVerificationError, verify_webhook

__all__ = [
    "AsyncHRVoice",
    "CallCompletedEvent",
    "CallFailedEvent",
    "HRVoice",
    "HRVoiceError",
    "HRVoiceEvent",
    "WebhookVerificationError",
    "verify_webhook",
]
