"""Run: python test_build_tts.py — Google voice selection, language rules, Gemini → Chirp fallback."""
import asyncio

from pipecat.services.google.tts import GoogleTTSService

GoogleTTSService._create_client = lambda self, *_a: None  # no Google credentials needed here

import bot  # noqa: E402


def plan(**kw):
    return {"engine": "own_loop_google_voice", "voiceId": "te-IN-Chirp3-HD-Kore", **kw}


def test_google_chirp_voice():
    tts = bot.build_tts(plan(), "te")
    assert isinstance(tts, bot.GoogleVoiceTTS)
    assert tts._settings.voice == "te-IN-Chirp3-HD-Kore"
    assert str(tts._settings.language) in ("te-IN", "Language.TE_IN")
    assert tts._init_sample_rate == 8000 and not tts._gemini


def test_gemini_only_where_supported():
    assert bot.build_tts(plan(ttsModel="gemini_flash", voiceId="en-IN-Chirp3-HD-Iapetus"), "en")._gemini
    assert not bot.build_tts(plan(ttsModel="gemini_flash", voiceId="bn-IN-Chirp3-HD-Kore"), "bn")._gemini


def test_language_rules():
    assert "never transliterate" in bot.phone_rules("en")
    assert "Tamil" in bot.phone_rules("ta") and "never transliterate" in bot.phone_rules("ta")
    assert bot.STT_LANGUAGE.get("ta", "ta") == "ta" and bot.STT_LANGUAGE["hi"] == "multi"


def test_gemini_failure_falls_back_to_chirp():
    tts = bot.build_tts(plan(ttsModel="gemini_flash", voiceId="en-IN-Chirp3-HD-Kore"), "en")
    used = []

    async def fake_stream(config, text, context_id, prompt=None):
        used.append((config.voice.name, config.voice.model_name))
        if config.voice.model_name:
            raise RuntimeError("429 quota")
        yield "audio"

    tts._stream_tts = fake_stream

    async def collect():
        return [f async for f in tts.run_tts("Hello", "ctx")]

    frames = asyncio.run(collect())
    assert used == [("Kore", "gemini-2.5-flash-tts"), ("en-IN-Chirp3-HD-Kore", "")], used
    assert frames == ["audio"]


if __name__ == "__main__":
    test_google_chirp_voice()
    test_gemini_only_where_supported()
    test_language_rules()
    test_gemini_failure_falls_back_to_chirp()
    print("ok")
