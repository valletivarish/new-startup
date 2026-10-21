"""One screening call: Exotel audio ⇄ Deepgram → Gemini (Vertex) → voice ⇄ Exotel.

The script (prompt, first line, questions, language, voice) comes from Nest per
call; nothing here knows about companies, jobs or candidates beyond that plan.
"""

from __future__ import annotations

import asyncio
import os
import time

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
from pipecat.services.google.stt import GoogleSTTService
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
        "thank them, tell them the next step, say goodbye in one sentence, then call end_call. If you reach a "
        "voicemail or answering machine, call end_call with reason 'voicemail' at once."
    ),
    "hi": (
        "You are on a live phone call with a job candidate in India. Speak natural, polite "
        "Hindi; English words people normally use (notice period, CTC, Java) are fine. Write "
        "Hindi in Devanagari script. One or two short sentences per turn, one question at a "
        "time. Never use lists, markdown or emojis. When every question is covered, or the "
        "candidate wants to stop, thank them, tell them the next step, say goodbye in one sentence, "
        "then call end_call. "
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
# Belt and braces with Nest's prompt: these hold even if the job's prompt is missing.
SAFETY_RULE = (
    "Never ask about age, religion, caste, marital status, family plans or health; if the candidate "
    "raises them, steer back to the role. Never tell the candidate they are rejected or not selected: "
    "the hiring team decides."
)
# Deepgram nova-3: Hindi callers code-mix, so `multi` (en+hi). Malayalam has no nova-3 model:
# Nest's plan sends those calls to Google (sttProvider = google).
STT_LANGUAGE = {"en": "en-IN", "hi": "multi"}
# Chirp 2 streams ml-IN only from regional endpoints; Singapore is the closest to India.
GOOGLE_STT_LOCATION = os.environ.get("GOOGLE_STT_LOCATION", "asia-southeast1")
GOOGLE_STT_MODEL = "chirp_2"
# Gemini 2.5 Flash TTS has no Bengali or Urdu voice: those calls stay on Chirp 3 HD.
GEMINI_TTS_LANGS = {"en", "hi", "mr", "te", "ta", "gu", "kn", "ml", "pa"}
GEMINI_TTS_MODEL = "gemini-2.5-flash-tts"
GEMINI_TTS_PROMPT = "Warm, friendly Indian recruiter on a phone call, relaxed natural pace."


# Goes first in the system prompt, in the call language itself where we have it written.
LANGUAGE_FIRST_HI = (
    "भाषा का नियम (सबसे ज़रूरी): यह पूरी कॉल हिंदी में है। आपका हर जवाब, हर सवाल और विदाई सिर्फ़ "
    "हिंदी में, देवनागरी लिपि में बोलिए, पहले जवाब से ही; भले ही उम्मीदवार अंग्रेज़ी शब्द मिलाए। नीचे "
    "दिए गए सवाल अंग्रेज़ी में लिखे हैं: हर सवाल स्वाभाविक, विनम्र हिंदी में पूछिए। आम अंग्रेज़ी शब्द "
    "(notice period, CTC, Java) चल सकते हैं। लोगों और कंपनियों के नाम अंग्रेज़ी अक्षरों में ही रखिए।"
)


SPEAKER_HI = {
    "woman": "आप एक महिला हैं: अपने लिए स्त्रीलिंग रूप बोलिए (बोल रही हूँ, समझ गई)।",
    "man": "आप एक पुरुष हैं: अपने लिए पुल्लिंग रूप बोलिए (बोल रहा हूँ, समझ गया)।",
}


def speaker(plan: dict) -> str | None:
    """The Google persona's gender (Kore woman, Iapetus man); other voices: unknown."""
    if plan.get("engine") != "own_loop_google_voice":
        return None
    return "man" if "Iapetus" in str(plan.get("voiceId") or "") else "woman"


def language_first(lang: str, who: str | None = None) -> str:
    if lang == "en":
        return ""
    name = LANGUAGE_NAMES[lang]
    gender = (
        f" You are a {who}: wherever {name} genders your own words, use the {who}'s forms."
        if who
        else ""
    )
    rule = (
        f"LANGUAGE (most important rule): this whole call is in {name}. Say every reply, every "
        f"question and the goodbye only in {name}, written in {name} script, from your first reply "
        f"on, even if the candidate mixes in English words. The questions below are written in "
        f"English: ask each one in natural, polite {name}. Never answer in English sentences.{gender}"
    )
    if lang == "hi":
        return "\n".join(x for x in (LANGUAGE_FIRST_HI, SPEAKER_HI.get(who or ""), rule) if x)
    return rule


def system_prompt(plan: dict, lang: str) -> str:
    head = language_first(lang, speaker(plan))
    body = f"{plan.get('prompt', '')}\n\n{phone_rules(lang)}"
    return f"{head}\n\n{body}" if head else body


def premature_end(reason: str, turns: list[dict], questions: list) -> bool:
    """A 'completed' hang-up before every question could have been asked and answered.

    Each must-ask question takes at least one agent line and one candidate reply.
    ponytail: counts turns, not which questions were covered; a re-asked question
    still counts once per turn. Good enough to stop hanging up halfway.
    """
    if reason != "completed":
        return False
    agent = sum(1 for t in turns if t["role"] == "agent")
    user = sum(1 for t in turns if t["role"] == "user")
    return agent < len(questions) or user < len(questions)


def build_stt(plan: dict, lang: str):
    if plan.get("sttProvider") == "google":
        # Credentials: GOOGLE_APPLICATION_CREDENTIALS (a key file) or ADC, like the voice.
        return GoogleSTTService(
            location=GOOGLE_STT_LOCATION,
            settings=GoogleSTTService.Settings(
                languages=[Language(f"{lang}-IN")],
                model=GOOGLE_STT_MODEL,
                enable_automatic_punctuation=True,
                enable_interim_results=True,
            ),
        )
    return DeepgramSTTService(
        api_key=os.environ["DEEPGRAM_API_KEY"],
        settings=DeepgramSTTService.Settings(
            model="nova-3",
            language=STT_LANGUAGE.get(lang, lang),
            smart_format=True,
            punctuate=True,
            interim_results=True,
        ),
    )


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
    return f"{rules} {NAMES_RULE} {SAFETY_RULE}"


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


def transcript_of(context: LLMContext, user_starts: list[float] | None = None) -> list[dict]:
    """The call's turns; user turns carry timeInCallSecs when their start was seen.

    ponytail: the i-th candidate turn gets the i-th turn-start event; a barge-in merged into
    one message can shift later times by a turn. Good enough for a play-from-second chip.
    """
    starts = list(user_starts or [])
    users = 0
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
            turn = {"role": "user" if role == "user" else "agent", "message": text[:5000]}
            if role == "user":
                if users < len(starts):
                    turn["timeInCallSecs"] = starts[users]
                users += 1
            turns.append(turn)
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
    stt = build_stt(plan, lang)
    llm = build_llm(system_prompt(plan, lang))
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

    questions = plan.get("questions") or []
    early_refusals = {"count": 0}

    async def end_call(params: FunctionCallParams):
        reason = str(params.arguments.get("reason", "completed"))
        # Twice at most, so a confused model can still hang up instead of looping.
        if early_refusals["count"] < 2 and premature_end(reason, transcript_of(context), questions):
            early_refusals["count"] += 1
            name = LANGUAGE_NAMES[lang]
            await params.result_callback(
                {
                    "ok": False,
                    "error": "Not every question has been asked yet; do not hang up. Ask the next "
                    f"question you have not asked, in {name}, without saying goodbye.",
                }
            )
            return
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

    call_start = {"t": None}
    user_starts: list[float] = []

    @aggregators.user().event_handler("on_user_turn_started")
    async def on_user_spoke(*_args):
        silent_prompts["count"] = 0
        if call_start["t"] is not None:
            user_starts.append(round(time.monotonic() - call_start["t"], 1))

    @transport.event_handler("on_client_connected")
    async def on_connected(_transport, _client):
        call_start["t"] = time.monotonic()
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
            "transcript": transcript_of(context, user_starts),
            "durationSeconds": round(meter.duration_seconds(), 1),
            "endedReason": outcome["reason"],
            "usage": meter.usage(),
        },
    )
