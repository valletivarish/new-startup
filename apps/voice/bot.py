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
from pipecat.services.google.tts import GoogleTTSService
from google.cloud import texttospeech_v1
from pipecat.services.llm_service import FunctionCallParams
from pipecat.services.sarvam.tts import SarvamTTSService
from pipecat.transcriptions.language import Language
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
# India launch set (docs/voice-selection.md). Calls run in `<code>-IN`.
LANGUAGE_NAMES = {
    "en": "English", "hi": "Hindi", "bn": "Bengali", "mr": "Marathi", "te": "Telugu", "ta": "Tamil",
    "gu": "Gujarati", "ur": "Urdu", "kn": "Kannada", "ml": "Malayalam", "pa": "Punjabi",
}
NAMES_RULE = (
    "Keep person and company names in English letters; never transliterate them into another script. "
    "Never call end_call before every question has been asked, unless the candidate wants to stop "
    "or it is a voicemail."
)
# Deepgram nova-3: Hindi callers code-mix, so `multi` (en+hi). Malayalam has no nova-3 model:
# ponytail: `multi` only hears its English words; switch STT provider for ml if it launches.
STT_LANGUAGE = {"en": "en-IN", "hi": "multi", "ml": "multi"}
# Gemini 2.5 Flash TTS has no Bengali or Urdu voice: those calls stay on Chirp 3 HD.
GEMINI_TTS_LANGS = {"en", "hi", "mr", "te", "ta", "gu", "kn", "ml", "pa"}
GEMINI_TTS_MODEL = "gemini-2.5-flash-tts"
GEMINI_TTS_PROMPT = "Warm, friendly Indian recruiter on a phone call, relaxed natural pace."


def phone_rules(lang: str) -> str:
    if lang in PHONE_RULES:
        rules = PHONE_RULES[lang]
    else:
        name = LANGUAGE_NAMES[lang]
        rules = (
            f"{PHONE_RULES['en']} Speak natural, polite {name} throughout, written in {name} script; "
            "English words people normally use (notice period, CTC, Java) are fine."
        )
    if lang != "en":
        # The opening line is the job's greeting, usually English: don't let it set the language.
        rules += (
            f" The opening greeting may have been in English; reply only in {LANGUAGE_NAMES[lang]} "
            "from your first reply on, even if the candidate mixes in English words."
        )
    return f"{rules} {NAMES_RULE}"


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


class GoogleVoiceTTS(GoogleTTSService):
    """Chirp 3 HD, or Gemini 2.5 Flash with the same persona when `gemini` is set.

    A Gemini line that fails before any audio (429 quota, unsupported language, …)
    is spoken again by Chirp 3 HD, so the caller never hears silence.
    """

    def __init__(self, *, gemini: bool, **kwargs):
        super().__init__(**kwargs)
        self._gemini = gemini

    async def run_tts(self, text: str, context_id: str):
        if self._gemini:
            voice = texttospeech_v1.VoiceSelectionParams(
                language_code=self._settings.language,
                name=str(self._settings.voice).rsplit("-", 1)[-1],  # en-IN-Chirp3-HD-Kore → Kore
                model_name=GEMINI_TTS_MODEL,
            )
            config = texttospeech_v1.StreamingSynthesizeConfig(
                voice=voice,
                streaming_audio_config=texttospeech_v1.StreamingAudioConfig(
                    audio_encoding=texttospeech_v1.AudioEncoding.PCM,
                    sample_rate_hertz=self.sample_rate,
                ),
            )
            spoke = False
            try:
                async for frame in self._stream_tts(config, text, context_id, GEMINI_TTS_PROMPT):
                    spoke = True
                    yield frame
                return
            except Exception as err:  # noqa: BLE001
                if spoke:
                    await self.push_error(error_msg=f"Gemini TTS failed mid-line: {err}", exception=err)
                    return
                logger.warning(f"Gemini TTS failed, falling back to Chirp 3 HD: {err}")
        async for frame in super().run_tts(text, context_id):
            yield frame


def build_tts(plan: dict, lang: str):
    if plan["engine"] == "own_loop_google_voice":
        gemini = plan.get("ttsModel") == "gemini_flash" and lang in GEMINI_TTS_LANGS
        return GoogleVoiceTTS(
            gemini=gemini,
            # Credentials: GOOGLE_APPLICATION_CREDENTIALS (a key file) or ADC.
            # Gemini voices only come at 24 kHz; Chirp at the phone line's 8 kHz.
            sample_rate=24000 if gemini else 8000,
            settings=GoogleTTSService.Settings(
                voice=plan.get("voiceId") or f"{lang}-IN-Chirp3-HD-Kore",
                language=Language(f"{lang}-IN"),
            ),
        )
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
    code = str(plan.get("language", "en"))[:2].lower()
    lang = code if code in LANGUAGE_NAMES else "en"
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
            language=STT_LANGUAGE.get(lang, lang),
            smart_format=True,
            punctuate=True,
            interim_results=True,
        ),
    )
    llm = build_llm(f"{plan.get('prompt', '')}\n\n{phone_rules(lang)}")
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
            await worker.queue_frame(TTSSpeakFrame(STILL_THERE.get(lang, STILL_THERE["en"])))
        else:
            outcome["reason"] = "silence"
            await worker.queue_frames([TTSSpeakFrame(GOODBYE_SILENT.get(lang, GOODBYE_SILENT["en"])), EndFrame()])

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
        await worker.queue_frames([TTSSpeakFrame(GOODBYE_TIME.get(lang, GOODBYE_TIME["en"])), EndFrame()])

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
