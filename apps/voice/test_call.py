"""Test-mode calls: the fake line rings our own /voice/exotel and plays the
recorded answers in test_clips/{en,hi}/answer_{1..4}.wav, so a test key gets
a whole screen (plan, agent, transcript, result) without a phone or carrier.
"""

from __future__ import annotations

import wave
from pathlib import Path

from loguru import logger

from fake_exotel import CLIPS_DIR, run

PORT = 8765
MAX_SECONDS = 240


def load_clips(lang: str, clips_dir: Path = CLIPS_DIR) -> list[bytes]:
    lang = "hi" if lang.startswith("hi") else "en"
    clips = []
    for i in range(1, 5):
        with wave.open(str(clips_dir / lang / f"answer_{i}.wav")) as w:
            clips.append(w.readframes(w.getnframes()))
    return clips


async def run_test_call(call_id: str, lang: str) -> None:
    try:
        report = await run(
            f"ws://127.0.0.1:{PORT}/voice/exotel", call_id, [], lang, MAX_SECONDS, clips=load_clips(lang)
        )
        logger.info(f"test call {call_id} done: {report}")
    except Exception as err:  # noqa: BLE001
        logger.warning(f"test call {call_id} failed: {err}")
