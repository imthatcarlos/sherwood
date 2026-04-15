from unittest.mock import AsyncMock, patch

import pytest

from sherwood_monitor.state_fetcher import default_state_fetcher


@pytest.mark.asyncio
async def test_fetcher_returns_defaults_on_cli_error():
    with patch(
        "asyncio.create_subprocess_exec",
        AsyncMock(side_effect=FileNotFoundError),
    ):
        state = await default_state_fetcher("sherwood", "alpha")
    assert state == {
        "vault_aum_usd": 0.0,
        "current_exposure_usd": 0.0,
        "allowed_protocols": [],
    }


@pytest.mark.asyncio
async def test_fetcher_parses_valid_json():
    payload = b'{"aumUsd": "150000", "currentExposureUsd": "10000", "allowedProtocols": ["moonwell", "aerodrome"]}'
    proc = AsyncMock()
    proc.communicate = AsyncMock(return_value=(payload, b""))
    proc.wait = AsyncMock(return_value=0)
    proc.returncode = 0
    with patch("asyncio.create_subprocess_exec", AsyncMock(return_value=proc)):
        state = await default_state_fetcher("sherwood", "alpha")
    assert state["vault_aum_usd"] == 150_000
    assert state["current_exposure_usd"] == 10_000
    assert state["allowed_protocols"] == ["moonwell", "aerodrome"]
