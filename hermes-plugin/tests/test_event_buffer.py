import threading

from sherwood_monitor.event_buffer import EventBuffer


def test_push_and_drain():
    b = EventBuffer()
    b.push("a")
    b.push("b")
    assert b.drain() == ["a", "b"]
    assert b.drain() == []


def test_bounded_capacity():
    b = EventBuffer(maxlen=2)
    b.push("a")
    b.push("b")
    b.push("c")
    assert b.drain() == ["b", "c"]


def test_thread_safety():
    b = EventBuffer(maxlen=500)

    def pusher():
        for i in range(100):
            b.push(str(i))

    threads = [threading.Thread(target=pusher) for _ in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(b.drain()) == 500
