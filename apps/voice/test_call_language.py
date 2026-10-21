"""Run: python test_call_language.py — language-first prompt, end_call gate, STT routing."""
import os

os.environ.setdefault("DEEPGRAM_API_KEY", "test")

from google.auth.credentials import AnonymousCredentials
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.google import stt as google_stt

google_stt.default = lambda **_k: (AnonymousCredentials(), "test-project")  # no Google credentials here

import bot  # noqa: E402

QUESTIONS = [{"id": "np", "label": "What is your notice period?"}, {"id": "ctc", "label": "CTC?"}, {"id": "join", "label": "Join?"}]


def turns(*roles):
    return [{"role": r, "message": "x"} for r in roles]


def test_language_rule_comes_first():
    hi = bot.system_prompt({"prompt": "Ask these questions:"}, "hi")
    assert hi.startswith("भाषा का नियम") and "only in Hindi" in hi
    assert hi.index("भाषा") < hi.index("Ask these questions:")
    ml = bot.system_prompt({"prompt": "P"}, "ml")
    assert ml.startswith("LANGUAGE") and "in natural, polite Malayalam" in ml
    assert bot.system_prompt({"prompt": "P"}, "en").startswith("P")
    kore = {"engine": "own_loop_google_voice", "voiceId": "hi-IN-Chirp3-HD-Kore", "prompt": "P"}
    assert "बोल रही हूँ" in bot.system_prompt(kore, "hi")
    iapetus = {**kore, "voiceId": "ta-IN-Chirp3-HD-Iapetus"}
    assert "You are a man" in bot.system_prompt(iapetus, "ta")
    assert "You are a" not in ml


def test_end_call_waits_for_every_question():
    early = turns("agent", "user", "agent", "user", "agent")  # greeting + 2 questions, 2 replies
    assert bot.premature_end("completed", early, QUESTIONS)
    assert not bot.premature_end("completed", early + turns("user", "agent"), QUESTIONS)
    assert not bot.premature_end("candidate_asked_to_stop", turns("agent", "user"), QUESTIONS)
    assert not bot.premature_end("voicemail", turns("agent"), QUESTIONS)


def test_stt_routing():
    assert isinstance(bot.build_stt({"sttProvider": "deepgram"}, "hi"), DeepgramSTTService)
    assert isinstance(bot.build_stt({}, "ta"), DeepgramSTTService)
    stt = bot.build_stt({"sttProvider": "google"}, "ml")
    assert isinstance(stt, google_stt.GoogleSTTService)
    assert stt._location == "asia-southeast1" and stt._settings.model == "chirp_2"
    assert stt._get_language_codes() == ["ml-IN"]


if __name__ == "__main__":
    test_language_rule_comes_first()
    test_end_call_waits_for_every_question()
    test_stt_routing()
    print("ok")
