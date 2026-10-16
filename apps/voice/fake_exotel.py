"""Fake Exotel: run a whole screening call against apps/voice without a phone.

Speaks Exotel's stream protocol (connected → start → media… → stop), plays the
candidate's lines (synthesised once with Sarvam) in real time, and reports how
long the agent took to start replying after each line.

    python fake_exotel.py --url ws://localhost:8765/voice/exotel --call-id <CallSid> \
        --lang en "Thirty days." "Twelve lakhs per annum." "Yes, I can join in November."

    python fake_exotel.py --save-clips   # (re)make test_clips/ for test-mode calls
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import io
import json
import os
import time
import wave
from pathlib import Path

import httpx
import websockets

RATE = 8000
FRAME_MS = 20
FRAME_BYTES = RATE * 2 * FRAME_MS // 1000  # pcm16 mono
SILENCE = b"\x00" * FRAME_BYTES
CLIPS_DIR = Path(__file__).parent / "test_clips"

# Neutral candidate answers for test-mode calls: notice period, CTC, joining date, close.
TEST_ANSWERS = {
    "en": [
        "My notice period is thirty days.",
        "My current CTC is six lakhs per annum, and I am expecting around seven and a half.",
        "I can join from the first of next month.",
        "No questions from my side. Thank you.",
    ],
    "hi": [
        "मेरा नोटिस पीरियड तीस दिन का है।",
        "मेरा अभी का सीटीसी छह लाख सालाना है, और मुझे लगभग साढ़े सात लाख की उम्मीद है।",
        "मैं अगले महीने की पहली तारीख से जॉइन कर सकती हूँ।",
        "मेरी तरफ़ से कोई सवाल नहीं है। धन्यवाद।",
    ],
}


def synth(text: str, lang: str) -> bytes:
    res = httpx.post(
        "https://api.sarvam.ai/text-to-speech",
        headers={"api-subscription-key": os.environ["SARVAM_API_KEY"]},
        json={
            "text": text,
            "target_language_code": "hi-IN" if lang == "hi" else "en-IN",
            "model": "bulbul:v3",
            "speaker": "priya",
            "speech_sample_rate": RATE,
        },
        timeout=30,
    )
    res.raise_for_status()
    wav = base64.b64decode(res.json()["audios"][0])
    with wave.open(io.BytesIO(wav)) as w:
        return w.readframes(w.getnframes())


def save_clips() -> None:
    for lang, lines in TEST_ANSWERS.items():
        (CLIPS_DIR / lang).mkdir(parents=True, exist_ok=True)
        for i, line in enumerate(lines, 1):
            with wave.open(str(CLIPS_DIR / lang / f"answer_{i}.wav"), "wb") as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(RATE)
                w.writeframes(synth(line, lang))


async def run(
    url: str, call_id: str, lines: list[str], lang: str, max_seconds: float, clips: list[bytes] | None = None
) -> dict:
    """Play `clips` (pcm16 8 kHz mono) if given, else synthesise `lines`."""
    if clips is None:
        clips = [synth(line, lang) for line in lines]
    stream_sid = f"fake-stream-{call_id}"
    last_agent_audio = 0.0
    agent_audio_frames = 0
    replies_ms: list[float] = []
    waiting_since: float | None = None

    async with websockets.connect(url, max_size=None) as ws:
        await ws.send(json.dumps({"event": "connected"}))
        await ws.send(
            json.dumps(
                {
                    "event": "start",
                    "sequence_number": 1,
                    "stream_sid": stream_sid,
                    "start": {
                        "stream_sid": stream_sid,
                        "call_sid": call_id,
                        "account_sid": "fake-account",
                        "from": "+910000000000",
                        "to": "+910000000001",
                        "media_format": {"encoding": "base64", "sample_rate": str(RATE), "bit_rate": "128kbps"},
                    },
                }
            )
        )

        async def receive():
            nonlocal last_agent_audio, agent_audio_frames, waiting_since
            async for raw in ws:
                msg = json.loads(raw)
                if msg.get("event") == "media":
                    now = time.monotonic()
                    if waiting_since is not None:
                        replies_ms.append((now - waiting_since) * 1000)
                        waiting_since = None
                    last_agent_audio = now
                    agent_audio_frames += 1

        receiver = asyncio.create_task(receive())
        seq = 2
        start = time.monotonic()

        async def send_frame(chunk: bytes):
            nonlocal seq
            await ws.send(
                json.dumps(
                    {
                        "event": "media",
                        "sequence_number": seq,
                        "stream_sid": stream_sid,
                        "media": {"chunk": seq, "timestamp": str(int((time.monotonic() - start) * 1000)), "payload": base64.b64encode(chunk).decode()},
                    }
                )
            )
            seq += 1
            await asyncio.sleep(FRAME_MS / 1000)

        async def agent_finished_turn() -> bool:
            # The agent spoke, then went quiet for 1.5 s.
            return agent_audio_frames > 0 and time.monotonic() - last_agent_audio > 1.5

        try:
            queue = list(clips)
            while time.monotonic() - start < max_seconds and not receiver.done():
                if queue and await agent_finished_turn() and waiting_since is None:
                    clip = queue.pop(0)
                    for i in range(0, len(clip), FRAME_BYTES):
                        await send_frame(clip[i : i + FRAME_BYTES].ljust(FRAME_BYTES, b"\x00"))
                    waiting_since = time.monotonic()
                    last_agent_audio = time.monotonic()  # wait for a fresh reply
                else:
                    await send_frame(SILENCE)
                if not queue and waiting_since is None and await agent_finished_turn() and time.monotonic() - last_agent_audio > 6:
                    break
        except websockets.ConnectionClosed:
            pass  # the agent hung up: the normal end of a screen
        finally:
            try:
                await ws.send(json.dumps({"event": "stop", "stream_sid": stream_sid}))
                await ws.close()
            except Exception:  # noqa: BLE001
                pass
            receiver.cancel()

    return {
        "agentAudioSeconds": round(agent_audio_frames * FRAME_MS / 1000, 1),
        "replyMs": [round(x) for x in replies_ms],
        "linesSent": len(clips),
    }


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--save-clips", action="store_true")
    p.add_argument("--url")
    p.add_argument("--call-id")
    p.add_argument("--lang", default="en")
    p.add_argument("--max-seconds", type=float, default=150)
    p.add_argument("lines", nargs="*")
    a = p.parse_args()
    if a.save_clips:
        save_clips()
        raise SystemExit(0)
    if not (a.url and a.call_id and a.lines):
        p.error("--url, --call-id and at least one line are required")
    print(json.dumps(asyncio.run(run(a.url, a.call_id, a.lines, a.lang, a.max_seconds)), indent=2))
