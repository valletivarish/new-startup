"""One screening call: Exotel audio ⇄ Deepgram → Gemini (Vertex) → voice ⇄ Exotel.

The script (prompt, first line, questions, language, voice) comes from Nest per
call; nothing here knows about companies, jobs or candidates beyond that plan.
"""

from __future__ import annotations

import asyncio
import os

from fastapi import WebSocket
from google.genai import types as genai_types
from loguru import logger
from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.adapters.schemas.tools_schema import ToolsSchema
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import EndFrame, EndTaskFrame, FunctionCallResultProperties, TTSSpeakFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.processors.frame_processor import FrameDirection
from pipecat.serializers.exotel import ExotelFrameSerializer
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.elevenlabs.tts import ElevenLabsTTSService
from pipecat.services.google.llm import GoogleLLMService
from pipecat.services.llm_service import FunctionCallParams
from pipecat.services.sarvam.tts import SarvamTTSService
from pipecat.transports.websocket.fastapi import FastAPIWebsocketParams, FastAPIWebsocketTransport

from meter import CallMeter, MeterObserver
from nest import deliver_result

PHONE_RULES = {
    "en": (
        "You are on a live phone call with a job candidate. Speak naturally and briefly: "
        "one or two short sentences per turn, one question at a time. Never use lists, "
        "markdown or emojis. When every question is covered, or the candidate wants to stop, "
        "thank them, say goodbye in one sentence, then call end_call. If you reach a "
        "voicemail or answering machine, call end_call with reason 'voicemail' at once."
    ),
    "hi": (
        "You are on a live phone call with a job candidate in India. Speak natural, polite "
        "Hindi; English words people normally use (notice period, CTC, Java) are fine. Write "
        "Hindi in Devanagari script. One or two short sentences per turn, one question at a "
        "time. Never use lists, markdown or emojis. When every question is covered, or the "
        "candidate wants to stop, thank them, say goodbye in one sentence, then call end_call. "
        "If you reach a voicemail or answering machine, call end_call with reason 'voicemail' at once."
    ),
}
STILL_THERE = {"en": "Are you still there?", "hi": "क्या आप लाइन पर हैं?"}
GOODBYE_SILENT = {
    "en": "I can't hear you, so I'll end the call here. Thank you, goodbye.",
    "hi": "मुझे आपकी आवाज़ नहीं आ रही, इसलिए मैं कॉल यहीं समाप्त कर रही हूँ। धन्यवाद।",
}
GOODBYE_TIME = {
    "en": "We're out of time for today. Thank you for your answers, goodbye.",
    "hi": "आज के लिए हमारा समय पूरा हुआ। आपके जवाबों के लिए धन्यवाद।",
}

END_CALL = FunctionSchema(
    name="end_call",
    description="Hang up after the goodbye line, or immediately on voicemail.",
    properties={
        "reason": {
            "type": "string",
            "enum": ["completed", "candidate_asked_to_stop", "voicemail"],
        }
    },
    required=["reason"],
)


def build_tts(plan: dict, lang: str):
    if plan["engine"] == "own_loop_sarvam_voice":
        return SarvamTTSService(
            api_key=os.environ["SARVAM_API_KEY"],
            settings=SarvamTTSService.Settings(
                model="bulbul:v3",
                voice=plan.get("voiceId") or "shubh",
                language="hi-IN" if lang == "hi" else "en-IN",
            ),
        )
    return ElevenLabsTTSService(
        api_key=os.environ["ELEVENLABS_API_KEY"],
        voice_id=plan.get("voiceId") or os.environ.get("ELEVENLABS_DEFAULT_VOICE_ID", ""),
        settings=ElevenLabsTTSService.Settings(model="eleven_flash_v2_5", language=lang),
    )


def build_llm(system_prompt: str) -> GoogleLLMService:
    base = os.environ.get("GEMINI_BASE_URL", "").rstrip("/")
    http_options = genai_types.HttpOptions(base_url=f"{base}/", api_version="") if base else None
    return GoogleLLMService(
        api_key=os.environ["GEMINI_API_KEY"],
        http_options=http_options,
        settings=GoogleLLMService.Settings(
            model=os.environ.get("GEMINI_MODEL", "gemini-2.5-flash-lite"),
            system_instruction=system_prompt,
            temperature=0.4,
            max_tokens=300,
        ),
    )


def transcript_of(context: LLMContext) -> list[dict]:
    turns = []
    for message in context.get_messages():
        if not isinstance(message, dict):
            continue
        role = message.get("role")
        if role not in ("user", "assistant"):
            continue
        content = message.get("content")
        if isinstance(content, list):
            content = " ".join(p.get("text", "") for p in content if isinstance(p, dict))
        text = str(content or "").strip()
        if text:
            turns.append({"role": "user" if role == "user" else "agent", "message": text[:5000]})
    return turns


async def run_call(websocket: WebSocket, call_id: str, stream_id: str, plan: dict) -> None:
    lang = "hi" if str(plan.get("language", "en")).startswith("hi") else "en"
    meter = CallMeter()
    outcome = {"reason": "candidate_hung_up"}

    serializer = ExotelFrameSerializer(stream_sid=stream_id, call_sid=call_id)
    transport = FastAPIWebsocketTransport(
        websocket=websocket,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            add_wav_header=False,
            serializer=serializer,
        ),
    )
    stt = DeepgramSTTService(
        api_key=os.environ["DEEPGRAM_API_KEY"],
        settings=DeepgramSTTService.Settings(
            model="nova-3",
            language="multi" if lang == "hi" else "en-IN",
            smart_format=True,
            punctuate=True,
            interim_results=True,
        ),
    )
    llm = build_llm(f"{plan.get('prompt', '')}\n\n{PHONE_RULES[lang]}")
    tts = build_tts(plan, lang)

    context = LLMContext(tools=ToolsSchema(standard_tools=[END_CALL]))
    aggregators = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(
            vad_analyzer=SileroVADAnalyzer(params=VADParams(stop_secs=0.5)),
            user_idle_timeout=7.0,
        ),
    )

    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            aggregators.user(),
            llm,
            tts,
            transport.output(),
            aggregators.assistant(),
        ]
    )
    worker = PipelineWorker(
        pipeline,
        params=PipelineParams(
            audio_in_sample_rate=16000,
            audio_out_sample_rate=16000,
            enable_metrics=True,
            enable_usage_metrics=True,
        ),
        observers=[MeterObserver(meter)],
        idle_timeout_secs=60,
    )

    async def end_call(params: FunctionCallParams):
        reason = str(params.arguments.get("reason", "completed"))
        outcome["reason"] = "voicemail" if reason == "voicemail" else "completed"
        await params.result_callback({"ok": True}, properties=FunctionCallResultProperties(run_llm=False))
        await params.llm.push_frame(EndTaskFrame(), FrameDirection.UPSTREAM)

    llm.register_function("end_call", end_call)

    silent_prompts = {"count": 0}

    @aggregators.user().event_handler("on_user_turn_idle")
    async def on_idle(_aggregator):
        silent_prompts["count"] += 1
        if silent_prompts["count"] == 1:
            await worker.queue_frame(TTSSpeakFrame(STILL_THERE[lang]))
        else:
            outcome["reason"] = "silence"
            await worker.queue_frames([TTSSpeakFrame(GOODBYE_SILENT[lang]), EndFrame()])

    @aggregators.user().event_handler("on_user_turn_started")
    async def on_user_spoke(*_args):
        silent_prompts["count"] = 0

    @transport.event_handler("on_client_connected")
    async def on_connected(_transport, _client):
        first = plan.get("firstMessage") or ""
        if first:
            await worker.queue_frame(TTSSpeakFrame(first))

    @transport.event_handler("on_client_disconnected")
    async def on_disconnected(_transport, _client):
        await worker.cancel()

    async def time_limit():
        await asyncio.sleep(int(plan.get("maxCallSeconds", 480)))
        outcome["reason"] = "max_duration"
        await worker.queue_frames([TTSSpeakFrame(GOODBYE_TIME[lang]), EndFrame()])

    limiter = asyncio.create_task(time_limit())
    try:
        await PipelineRunner(handle_sigint=False).run(worker)
    except Exception as err:  # noqa: BLE001 — any provider failure ends the call as engine_error
        logger.exception(f"call {call_id} failed: {err}")
        outcome["reason"] = "engine_error"
    finally:
        limiter.cancel()

    await deliver_result(
        call_id,
        {
            "transcript": transcript_of(context),
            "durationSeconds": round(meter.duration_seconds(), 1),
            "endedReason": outcome["reason"],
            "usage": meter.usage(),
        },
    )
