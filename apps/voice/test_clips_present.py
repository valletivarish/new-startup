"""Run: python test_clips_present.py — the 20 test-mode clips exist as pcm16 8 kHz mono."""
import wave

from fake_exotel import CLIPS_DIR


def test_clips_present():
    for lang in ("en", "hi", "ta", "te", "ml"):
        for i in range(1, 5):
            path = CLIPS_DIR / lang / f"answer_{i}.wav"
            assert path.exists(), f"missing {path}"
            with wave.open(str(path)) as w:
                assert (w.getframerate(), w.getnchannels(), w.getsampwidth()) == (8000, 1, 2), path
                assert w.getnframes() > 8000 // 2, f"{path} is under half a second"


if __name__ == "__main__":
    test_clips_present()
    print("ok")
