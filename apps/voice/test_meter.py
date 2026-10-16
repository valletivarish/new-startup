"""Run: python -m pytest test_meter.py  (or python test_meter.py)"""
from meter import CallMeter, percentile


def test_percentile():
    assert percentile([], 50) is None
    assert percentile([900, 700, 1200, 800], 50) == 800
    assert percentile([900, 700, 1200, 800], 90) == 1200


def test_response_and_interruptions():
    m = CallMeter()
    m.user_stopped(10.0)
    m.bot_started(10.85)  # replied 850 ms after the candidate stopped
    m.user_started()      # candidate talks over the agent
    m.bot_stopped()
    m.user_started()      # agent silent: not an interruption
    assert m.usage()["responseP50Ms"] == 850
    assert m.usage()["interruptions"] == 1


if __name__ == "__main__":
    test_percentile()
    test_response_and_interruptions()
    print("ok")
