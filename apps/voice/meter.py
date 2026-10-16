"""Per-call meter: usage counts for pricing and response-time / interruption stats.

Observers see a frame once per hop between processors, so every frame is counted
once by id.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    MetricsFrame,
    UserStartedSpeakingFrame,
    UserStoppedSpeakingFrame,
)
from pipecat.metrics.metrics import LLMUsageMetricsData, STTUsageMetricsData, TTSUsageMetricsData
from pipecat.observers.base_observer import BaseObserver, FramePushed


def percentile(values: list[float], p: float) -> int | None:
    """Nearest-rank percentile, in whole ms. None for no samples."""
    if not values:
        return None
    ordered = sorted(values)
    rank = max(1, min(len(ordered), round(p / 100 * len(ordered) + 0.5)))
    return int(round(ordered[rank - 1]))


@dataclass
class CallMeter:
    started_at: float = field(default_factory=time.monotonic)
    stt_seconds: float = 0.0
    llm_input_tokens: int = 0
    llm_output_tokens: int = 0
    tts_characters: int = 0
    interruptions: int = 0
    response_ms: list[float] = field(default_factory=list)
    _bot_speaking: bool = False
    _user_stopped_at: float | None = None

    def user_stopped(self, at: float) -> None:
        self._user_stopped_at = at

    def user_started(self) -> None:
        if self._bot_speaking:
            self.interruptions += 1

    def bot_started(self, at: float) -> None:
        self._bot_speaking = True
        if self._user_stopped_at is not None:
            self.response_ms.append((at - self._user_stopped_at) * 1000)
            self._user_stopped_at = None

    def bot_stopped(self) -> None:
        self._bot_speaking = False

    def duration_seconds(self) -> float:
        return time.monotonic() - self.started_at

    def usage(self) -> dict:
        return {
            "sttSeconds": int(round(self.stt_seconds)),
            "llmInputTokens": self.llm_input_tokens,
            "llmOutputTokens": self.llm_output_tokens,
            "ttsCharacters": self.tts_characters,
            "responseP50Ms": percentile(self.response_ms, 50),
            "responseP90Ms": percentile(self.response_ms, 90),
            "interruptions": self.interruptions,
        }


class MeterObserver(BaseObserver):
    def __init__(self, meter: CallMeter):
        super().__init__()
        self._meter = meter
        self._seen: set[int] = set()

    async def on_push_frame(self, data: FramePushed):
        frame = data.frame
        if frame.id in self._seen:
            return
        self._seen.add(frame.id)
        now = time.monotonic()
        if isinstance(frame, UserStoppedSpeakingFrame):
            self._meter.user_stopped(now)
        elif isinstance(frame, UserStartedSpeakingFrame):
            self._meter.user_started()
        elif isinstance(frame, BotStartedSpeakingFrame):
            self._meter.bot_started(now)
        elif isinstance(frame, BotStoppedSpeakingFrame):
            self._meter.bot_stopped()
        elif isinstance(frame, MetricsFrame):
            for item in frame.data:
                if isinstance(item, LLMUsageMetricsData):
                    self._meter.llm_input_tokens += item.value.prompt_tokens or 0
                    self._meter.llm_output_tokens += item.value.completion_tokens or 0
                elif isinstance(item, TTSUsageMetricsData):
                    self._meter.tts_characters += item.value or 0
                elif isinstance(item, STTUsageMetricsData):
                    self._meter.stt_seconds += item.value.audio_seconds or 0.0
