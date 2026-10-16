"""apps/voice — our own voice loop. Exotel opens a media stream per answered call.

    GET /health          liveness
    WS  /voice/exotel    Exotel Voicebot stream (Caddy routes /voice/* here)
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket
from loguru import logger
from pipecat.runner.utils import parse_telephony_websocket

from bot import run_call
from nest import fetch_plan, flush_spool


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
