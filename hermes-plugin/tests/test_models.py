import pytest

from sherwood_monitor.models import (
    ChainEvent,
    SessionMessage,
    decode_record,
)


def test_decode_chain_event():
    raw = {
        "source": "chain",
        "type": "ProposalCreated",
        "block": 12345,
        "tx": "0xabc",
        "args": {"proposalId": "1", "proposer": "0xdef"},
    }
    rec = decode_record(raw)
    assert isinstance(rec, ChainEvent)
    assert rec.type == "ProposalCreated"
    assert rec.block == 12345
    assert rec.args["proposalId"] == "1"


def test_decode_xmtp_message():
    raw = {
        "source": "xmtp",
        "id": "msg-1",
        "from": "0xsender",
        "type": "RISK_ALERT",
        "text": "Health factor below 1.2",
        "sentAt": "2026-04-15T12:00:00.000Z",
    }
    rec = decode_record(raw)
    assert isinstance(rec, SessionMessage)
    assert rec.type == "RISK_ALERT"
    assert rec.text == "Health factor below 1.2"


def test_decode_unknown_source_raises():
    with pytest.raises(ValueError, match="unknown source"):
        decode_record({"source": "martian", "type": "Nope"})


def test_decode_non_dict_raises():
    with pytest.raises(ValueError):
        decode_record("not a dict")  # type: ignore[arg-type]
