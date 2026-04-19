"""Typed records for events arriving from `sherwood session check`."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Union


@dataclass(frozen=True)
class ChainEvent:
    """On-chain event emitted by Sherwood vault or governor contracts."""

    type: str
    block: int
    tx: str
    args: dict[str, str] = field(default_factory=dict)
    source: str = "chain"


@dataclass(frozen=True)
class SessionMessage:
    """XMTP message observed in the syndicate group chat."""

    id: str
    type: str
    text: str
    sent_at: str  # ISO 8601
    from_: str  # 'from' is reserved
    source: str = "xmtp"


Record = Union[ChainEvent, SessionMessage]


def decode_record(raw: Any) -> Record:
    """Decode a JSON line from `sherwood session check` into a typed record."""
    if not isinstance(raw, dict):
        raise ValueError(f"expected dict, got {type(raw).__name__}")

    source = raw.get("source")

    if source == "chain":
        return ChainEvent(
            type=str(raw.get("type", "")),
            block=int(raw.get("block", 0)),
            tx=str(raw.get("tx", "")),
            args=dict(raw.get("args", {})),
        )

    if source == "xmtp":
        return SessionMessage(
            id=str(raw.get("id", "")),
            type=str(raw.get("type", "")),
            text=str(raw.get("text", "")),
            sent_at=str(raw.get("sentAt", "")),
            from_=str(raw.get("from", "")),
        )

    raise ValueError(f"unknown source: {source!r}")
