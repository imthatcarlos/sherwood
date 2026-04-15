import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from sherwood_monitor.config import Config
from sherwood_monitor.hooks import make_session_hooks, on_session_end_factory


@pytest.mark.asyncio
async def test_session_start_injects_catchup_summary(fixture):
    cfg = Config(sherwood_bin="sherwood", syndicates=["alpha"], auto_start=False)
    ctx = MagicMock()
    sup = MagicMock()
    sup.start = AsyncMock()

    payload = json.dumps(fixture("session_check_output"))

    async def fake_comm():
        return (payload.encode(), b"")

    proc = MagicMock()
    proc.communicate = AsyncMock(side_effect=[(payload.encode(), b"")])
    proc.wait = AsyncMock(return_value=0)

    with patch("asyncio.create_subprocess_exec", AsyncMock(return_value=proc)):
        hooks = make_session_hooks(cfg=cfg, ctx=ctx, supervisor=sup)
        await hooks["on_session_start"]()

    # Injected a catch-up summary referencing the syndicate
    assert any(
        "alpha" in call.kwargs.get("content", "")
        for call in ctx.inject_message.call_args_list
    )


@pytest.mark.asyncio
async def test_session_start_auto_starts_supervisors(fixture):
    cfg = Config(sherwood_bin="sherwood", syndicates=["alpha"], auto_start=True)
    ctx = MagicMock()
    sup = MagicMock()
    sup.start = AsyncMock()

    payload = json.dumps(
        {"syndicate": "alpha", "messages": [], "events": [], "meta": {"newMessages": 0, "newEvents": 0, "blocksScanned": 0, "lastCheckAt": "never"}}
    )
    proc = MagicMock()
    proc.communicate = AsyncMock(return_value=(payload.encode(), b""))
    proc.wait = AsyncMock(return_value=0)

    with patch("asyncio.create_subprocess_exec", AsyncMock(return_value=proc)):
        hooks = make_session_hooks(cfg=cfg, ctx=ctx, supervisor=sup)
        await hooks["on_session_start"]()

    sup.start.assert_awaited_once_with("alpha")


@pytest.mark.asyncio
async def test_session_end_stops_all():
    sup = MagicMock()
    sup.stop_all = AsyncMock()
    end = on_session_end_factory(sup)
    await end()
    sup.stop_all.assert_awaited_once()


from unittest.mock import AsyncMock

from sherwood_monitor.hooks import make_pre_tool_call_hook
from sherwood_monitor.risk import RiskVerdict


def _state_fetcher(result):
    async def fetch(sub):
        return result
    return fetch


@pytest.mark.asyncio
async def test_pre_tool_call_passes_through_non_sherwood_commands():
    fetch = _state_fetcher({"vault_aum_usd": 100_000, "current_exposure_usd": 0, "allowed_protocols": ["moonwell"]})
    hook = make_pre_tool_call_hook(state_fetcher=fetch)
    result = await hook(tool_name="bash", params={"command": "ls -la"})
    assert result is None


@pytest.mark.asyncio
async def test_pre_tool_call_passes_through_non_terminal_tools():
    fetch = _state_fetcher({"vault_aum_usd": 100_000, "current_exposure_usd": 0, "allowed_protocols": ["moonwell"]})
    hook = make_pre_tool_call_hook(state_fetcher=fetch)
    result = await hook(
        tool_name="web_search", params={"command": "sherwood proposal create alpha --size-usd 5000"}
    )
    assert result is None


@pytest.mark.asyncio
async def test_pre_tool_call_blocks_oversized_proposal():
    fetch = _state_fetcher({"vault_aum_usd": 100_000, "current_exposure_usd": 0, "allowed_protocols": ["moonwell"]})
    hook = make_pre_tool_call_hook(state_fetcher=fetch)
    result = await hook(
        tool_name="bash",
        params={
            "command": "sherwood proposal create alpha --size-usd 30000 --protocol moonwell"
        },
    )
    assert result == {"blocked": True, "reason": result["reason"]}
    assert "position" in result["reason"].lower()


@pytest.mark.asyncio
async def test_pre_tool_call_allows_compliant_proposal():
    fetch = _state_fetcher({"vault_aum_usd": 100_000, "current_exposure_usd": 0, "allowed_protocols": ["moonwell"]})
    hook = make_pre_tool_call_hook(state_fetcher=fetch)
    result = await hook(
        tool_name="bash",
        params={
            "command": "sherwood proposal create alpha --size-usd 5000 --protocol moonwell"
        },
    )
    assert result is None


@pytest.mark.asyncio
async def test_pre_tool_call_blocks_disallowed_protocol():
    fetch = _state_fetcher({"vault_aum_usd": 100_000, "current_exposure_usd": 0, "allowed_protocols": ["moonwell"]})
    hook = make_pre_tool_call_hook(state_fetcher=fetch)
    result = await hook(
        tool_name="bash",
        params={
            "command": "sherwood proposal create alpha --size-usd 5000 --protocol unknown"
        },
    )
    assert result is not None
    assert result["blocked"] is True
    assert "mandate" in result["reason"].lower()


@pytest.mark.asyncio
async def test_pre_tool_call_strategy_propose_pattern():
    fetch = _state_fetcher({"vault_aum_usd": 100_000, "current_exposure_usd": 0, "allowed_protocols": ["moonwell"]})
    hook = make_pre_tool_call_hook(state_fetcher=fetch)
    result = await hook(
        tool_name="terminal",
        params={
            "command": "sherwood strategy propose alpha --size-usd 5000 --protocol moonwell"
        },
    )
    assert result is None


@pytest.mark.asyncio
async def test_pre_tool_call_swallows_fetcher_exception():
    async def fetch(sub):
        raise RuntimeError("rpc down")

    hook = make_pre_tool_call_hook(state_fetcher=fetch)
    result = await hook(
        tool_name="bash",
        params={
            "command": "sherwood proposal create alpha --size-usd 5000 --protocol moonwell"
        },
    )
    # On fetcher error, pass through (don't block agent if we can't verify)
    assert result is None
