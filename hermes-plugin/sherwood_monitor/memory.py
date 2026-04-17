"""Build and write post-settlement memory records."""
from __future__ import annotations

import json
import re
import time
from typing import Any, Callable

MemoryWriter = Callable[[dict], None]

_PROPOSAL_ID_RE = re.compile(r"\b(\d+)\b")


def _parse_proposal_id(command: str) -> int | None:
    m = _PROPOSAL_ID_RE.search(command.split()[-1]) if command else None
    if m:
        try:
            return int(m.group(1))
        except ValueError:
            return None
    return None


def build_record(
    *,
    subdomain: str,
    action: str,
    command: str,
    result_json: str,
) -> dict[str, Any]:
    tx_hash: str | None = None
    proposal_id: int | None = _parse_proposal_id(command)
    pnl_usd: float | None = None
    try:
        parsed = json.loads(result_json)
        if isinstance(parsed, dict):
            tx_hash = parsed.get("tx") or parsed.get("txHash")
            if parsed.get("proposalId"):
                try:
                    proposal_id = int(parsed["proposalId"])
                except (ValueError, TypeError):
                    pass
            pnl_raw = parsed.get("pnl")
            if pnl_raw is not None:
                try:
                    pnl_usd = float(pnl_raw) / 1_000_000
                except (ValueError, TypeError):
                    pnl_usd = None
    except (json.JSONDecodeError, TypeError):
        pass

    return {
        "syndicate": subdomain,
        "action": action,
        "timestamp": int(time.time()),
        "command": command,
        "tx_hash": tx_hash,
        "proposal_id": proposal_id,
        "pnl_usd": pnl_usd,
    }


def write_settlement(
    writer: MemoryWriter,
    *,
    subdomain: str,
    action: str,
    command: str,
    result_json: str,
) -> None:
    record = build_record(
        subdomain=subdomain, action=action, command=command, result_json=result_json
    )
    try:
        writer(record)
    except Exception:
        # Memory write failures must never affect agent behavior
        pass
