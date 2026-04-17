"""Default state fetcher used by the pre_tool_call risk hook.

Shells out to `sherwood vault info <subdomain> --json` and returns a state
dict for risk evaluation, OR `None` if the data is unavailable.

**Fail-open contract (safety-critical):** returning `None` signals "state
unknown" to the pre_tool_call hook, which then ALLOWS the proposal and logs
a warning. Returning a dict with zeros signals "state known and is zero" —
that is treated as a real signal and will (correctly) block.

The current Sherwood CLI does not ship a `vault info --json` subcommand.
Until that lands upstream, this fetcher always returns `None`, so all
`pre_tool_call` risk checks fail-open. This is the intended day-one
behavior: the plugin ships enforcement infrastructure without synthesizing
fake vault state. Once the CLI subcommand exists and is pinned in
preflight, checks engage automatically with no plugin change.
"""
from __future__ import annotations

import asyncio
import json
import logging

_log = logging.getLogger(__name__)


async def fetch_vault_info(sherwood_bin: str, subdomain: str) -> dict | None:
    """Shell out to `sherwood vault info <subdomain> --json` and return the raw dict.

    Returns None on any failure (non-zero exit, parse error, subprocess error,
    or the subcommand not existing on this CLI version).
    """
    try:
        proc = await asyncio.create_subprocess_exec(
            sherwood_bin,
            "vault",
            "info",
            subdomain,
            "--json",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _stderr = await proc.communicate()
        if proc.returncode != 0:
            return None
        return json.loads(stdout.decode("utf-8", "replace") or "{}") or None
    except Exception as exc:
        _log.warning("fetch_vault_info failed for %s: %s", subdomain, exc)
        return None


async def default_state_fetcher(sherwood_bin: str, subdomain: str) -> dict | None:
    """Return the risk-check state dict for a syndicate, or None if unknown.

    Contract:
    - dict with `vault_aum_usd`, `current_exposure_usd`, `allowed_protocols`
      when `vault info --json` returned parseable data.
    - `None` when the CLI returned no data, returned malformed data, or the
      subcommand is unavailable. The caller (pre_tool_call hook) treats
      `None` as fail-open: allow the proposal and log a warning.

    Previously returned zero-defaults on failure, which the risk checks
    interpreted as "vault has zero AUM" and blocked every proposal. That was
    a fail-closed regression contradicting the documented fail-open intent.
    """
    payload = await fetch_vault_info(sherwood_bin, subdomain)
    if payload is None:
        return None

    try:
        return {
            "vault_aum_usd": float(payload.get("aumUsd", 0)),
            "current_exposure_usd": float(payload.get("currentExposureUsd", 0)),
            "allowed_protocols": list(payload.get("allowedProtocols", [])),
        }
    except (ValueError, TypeError):
        return None


def stderr_memory_writer(record: dict) -> None:
    """Day-1 memory writer: log to stderr. Hermes memory provider wiring is follow-up."""
    import sys

    sys.stderr.write(f"[sherwood-monitor memory] {json.dumps(record)}\n")
