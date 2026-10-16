"""apps/voice — our own voice loop. Exotel opens a media stream per answered call.

    GET /health          liveness
    WS  /voice/exotel    Exotel Voicebot stream (Caddy routes /voice/* here)
    POST /internal/test-call   Nest only (x-voice-token): ring the fake line for a test call
"""

from __future__ import annotations

import asyncio
import hmac
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException, WebSocket
from loguru import logger
from pipecat.runner.utils import parse_telephony_websocket
from pydantic import BaseModel, Field

from bot import run_call
from nest import TOKEN, fetch_plan, flush_spool
from test_call import run_test_call

# Strong refs: asyncio only keeps weak ones to running tasks.
_test_calls: set[asyncio.Task] = set()


async def _flush_forever():
    while True:
        try:
            sent = await flush_spool()
            if sent:
                logger.info(f"delivered {sent} spooled call results")
        except Exception as err:  # noqa: BLE001
            logger.warning(f"spool flush failed: {err}")
        await asyncio.sleep(60)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    task = asyncio.create_task(_flush_forever())
    yield
    task.cancel()


app = FastAPI(lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok"}


class TestCall(BaseModel):
    callId: str = Field(pattern=r"^test-[0-9a-f-]{36}$")
    language: str = Field(default="en", max_length=16)


@app.post("/internal/test-call", status_code=202)
async def test_call(body: TestCall, x_voice_token: str = Header(default="")):
    # Like Nest's internal routes: without the shared secret the route does not exist.
    if not TOKEN or not hmac.compare_digest(x_voice_token.encode(), TOKEN.encode()):
        raise HTTPException(status_code=404)
    task = asyncio.create_task(run_test_call(body.callId, body.language))
    _test_calls.add(task)
    task.add_done_callback(_test_calls.discard)
    return {"status": "started"}


@app.websocket("/voice/exotel")
async def exotel_stream(websocket: WebSocket):
    await websocket.accept()
    transport_type, call_data = await parse_telephony_websocket(websocket)
    call_id = str(call_data.get("call_id") or "")
    stream_id = str(call_data.get("stream_id") or "")
    if transport_type != "exotel" or not call_id or not stream_id:
        logger.warning(f"rejected stream: type={transport_type}")
        await websocket.close()
        return

    # Only calls Nest placed (and still considers live) get a plan; anyone else is hung up.
    plan = await fetch_plan(call_id)
    if not plan:
        logger.warning(f"no live own-loop call for {call_id}; closing")
        await websocket.close()
        return

    logger.info(f"call {call_id} engine={plan.get('engine')} lang={plan.get('language')}")
    await run_call(websocket, call_id, stream_id, plan)
