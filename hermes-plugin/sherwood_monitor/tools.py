"""LLM-callable tool handlers."""
from __future__ import annotations

import json
from typing import Any, Awaitable, Callable

from .supervisor import Supervisor

ToolHandler = Callable[[dict], Awaitable[str]]


def make_handlers(sup: Supervisor) -> dict[str, ToolHandler]:
    async def start(args: dict, **_: Any) -> str:
        try:
            sub = args.get("subdomain")
            if not sub:
                return json.dumps({"error": "subdomain required"})
            pid = await sup.start(sub)
            return json.dumps({"started": True, "pid": pid})
        except Exception as exc:
            return json.dumps({"error": str(exc)})

    async def stop(args: dict, **_: Any) -> str:
        try:
            sub = args.get("subdomain")
            if not sub:
                return json.dumps({"error": "subdomain required"})
            await sup.stop(sub)
            return json.dumps({"stopped": True})
        except Exception as exc:
            return json.dumps({"error": str(exc)})

    async def status(args: dict, **_: Any) -> str:
        try:
            return json.dumps(sup.status())
        except Exception as exc:
            return json.dumps({"error": str(exc)})

    return {
        "sherwood_monitor_start": start,
        "sherwood_monitor_stop": stop,
        "sherwood_monitor_status": status,
    }
