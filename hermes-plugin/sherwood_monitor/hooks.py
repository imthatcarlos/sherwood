"""Hermes lifecycle hooks."""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Awaitable, Callable

from .config import Config
from .supervisor import Supervisor

_log = logging.getLogger(__name__)


async def _catchup_one(sherwood_bin: str, subdomain: str) -> dict | None:
    try:
        proc = await asyncio.create_subprocess_exec(
            sherwood_bin,
            "session",
            "check",
            subdomain,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _stderr = await proc.communicate()
        rc = await proc.wait()
        if rc != 0:
            _log.warning("catch-up for %s exited rc=%s", subdomain, rc)
            return None
        return json.loads(stdout.decode("utf-8", "replace") or "{}")
    except Exception as exc:
        _log.warning("catch-up for %s failed: %s", subdomain, exc)
        return None


def _format_catchup_injection(subdomain: str, payload: dict) -> str:
    meta = payload.get("meta", {})
    new_msgs = meta.get("newMessages", 0)
    new_events = meta.get("newEvents", 0)
    return (
        f'<sherwood-catchup syndicate="{subdomain}">\n'
        f"{new_msgs} new messages, {new_events} new events since last check.\n"
        f"{json.dumps(payload, indent=2)}\n"
        f"</sherwood-catchup>"
    )


def make_session_hooks(
    cfg: Config, ctx: Any, supervisor: Supervisor
) -> dict[str, Callable[[], Awaitable[None]]]:
    async def on_session_start() -> None:
        for sub in cfg.syndicates:
            payload = await _catchup_one(cfg.sherwood_bin, sub)
            if payload is not None:
                ctx.inject_message(
                    content=_format_catchup_injection(sub, payload), role="user"
                )
            if cfg.auto_start:
                try:
                    await supervisor.start(sub)
                except Exception as exc:
                    _log.warning("auto-start failed for %s: %s", sub, exc)

    return {"on_session_start": on_session_start}


def on_session_end_factory(supervisor: Supervisor) -> Callable[[], Awaitable[None]]:
    async def on_session_end() -> None:
        await supervisor.stop_all()

    return on_session_end
