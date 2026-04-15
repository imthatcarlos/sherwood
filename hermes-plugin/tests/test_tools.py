import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from sherwood_monitor.tools import make_handlers


@pytest.mark.asyncio
async def test_start_handler_returns_pid():
    sup = MagicMock()
    sup.start = AsyncMock(return_value=9999)
    handlers = make_handlers(sup)
    result = await handlers["sherwood_monitor_start"]({"subdomain": "alpha"})
    assert json.loads(result) == {"started": True, "pid": 9999}


@pytest.mark.asyncio
async def test_start_handler_missing_arg():
    sup = MagicMock()
    handlers = make_handlers(sup)
    result = await handlers["sherwood_monitor_start"]({})
    assert "error" in json.loads(result)


@pytest.mark.asyncio
async def test_stop_handler():
    sup = MagicMock()
    sup.stop = AsyncMock()
    handlers = make_handlers(sup)
    result = await handlers["sherwood_monitor_stop"]({"subdomain": "alpha"})
    assert json.loads(result) == {"stopped": True}


@pytest.mark.asyncio
async def test_status_handler():
    sup = MagicMock()
    sup.status = MagicMock(return_value={"syndicates": [{"subdomain": "alpha"}]})
    handlers = make_handlers(sup)
    result = await handlers["sherwood_monitor_status"]({})
    assert json.loads(result)["syndicates"][0]["subdomain"] == "alpha"


@pytest.mark.asyncio
async def test_handler_swallows_exception():
    sup = MagicMock()
    sup.start = AsyncMock(side_effect=RuntimeError("boom"))
    handlers = make_handlers(sup)
    result = await handlers["sherwood_monitor_start"]({"subdomain": "alpha"})
    parsed = json.loads(result)
    assert "error" in parsed
    assert "boom" in parsed["error"]
