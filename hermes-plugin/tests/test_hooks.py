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
