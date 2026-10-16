"""Talking to the Nest API: fetch a call's plan, deliver its result.

A result must not be lost if the API is briefly down: delivery retries with
backoff, then spools to disk; `flush_spool` re-sends spooled results.
"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

import httpx
from loguru import logger

API_URL = os.environ.get("NEST_INTERNAL_URL", "http://api:3001").rstrip("/")
TOKEN = os.environ.get("VOICE_INTERNAL_TOKEN", "")
# ponytail: spool lives on the container's disk; a volume makes it survive restarts.
SPOOL = Path(os.environ.get("VOICE_SPOOL_DIR", "/tmp/voice-spool"))


def _headers() -> dict[str, str]:
    return {"x-voice-token": TOKEN}


async def fetch_plan(call_id: str) -> dict | None:
    async with httpx.AsyncClient(timeout=5) as client:
        res = await client.get(f"{API_URL}/internal/voice/calls/{call_id}", headers=_headers())
    if res.status_code == 404:
        return None
    res.raise_for_status()
    return res.json()


async def _post(call_id: str, result: dict) -> bool:
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            res = await client.post(
                f"{API_URL}/internal/voice/calls/{call_id}/result", headers=_headers(), json=result
            )
        if res.status_code == 404:
            logger.warning(f"result for {call_id} rejected (404); dropping")
            return True
        return res.is_success
    except httpx.HTTPError as err:
        logger.warning(f"result post failed for {call_id}: {err}")
        return False


async def deliver_result(call_id: str, result: dict, attempts: int = 4) -> None:
    for attempt in range(attempts):
        if await _post(call_id, result):
            return
        await asyncio.sleep(2**attempt)
    SPOOL.mkdir(parents=True, exist_ok=True)
    (SPOOL / f"{call_id}.json").write_text(json.dumps(result))
    logger.error(f"result for {call_id} spooled after {attempts} failed attempts")


async def flush_spool() -> int:
    """Re-send spooled results; returns how many were delivered."""
    if not SPOOL.exists():
        return 0
    delivered = 0
    for path in sorted(SPOOL.glob("*.json")):
        if await _post(path.stem, json.loads(path.read_text())):
            path.unlink(missing_ok=True)
            delivered += 1
    return delivered
