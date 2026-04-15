"""JSON schemas for LLM-callable tools."""
from __future__ import annotations

START = {
    "name": "sherwood_monitor_start",
    "description": (
        "Start monitoring a Sherwood syndicate. Spawns a streaming subprocess "
        "that forwards on-chain events and XMTP messages into this conversation. "
        "Use this when the user asks to watch a new syndicate or after adding "
        "one to the config."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "subdomain": {
                "type": "string",
                "description": "Sherwood syndicate subdomain, e.g. 'alpha-fund'",
            }
        },
        "required": ["subdomain"],
    },
}

STOP = {
    "name": "sherwood_monitor_stop",
    "description": (
        "Stop monitoring a Sherwood syndicate. Terminates the streaming "
        "subprocess. Use when the user wants to stop receiving events from "
        "a syndicate."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "subdomain": {"type": "string"},
        },
        "required": ["subdomain"],
    },
}

STATUS = {
    "name": "sherwood_monitor_status",
    "description": (
        "Get the status of all monitored syndicates: pid, uptime, events seen, "
        "last event time, and recent stderr. Use to answer 'is my syndicate "
        "being watched?' or to debug a silent monitor."
    ),
    "parameters": {"type": "object", "properties": {}, "required": []},
}
