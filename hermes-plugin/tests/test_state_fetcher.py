from unittest.mock import AsyncMock, patch

import pytest

from sherwood_monitor.state_fetcher import default_state_fetcher


@pytest.mark.asyncio
async def test_fetcher_returns_none_on_cli_error():
    """Regression: fail-open on unknown state. Returning zero-defaults would
    make the pre_tool_call hook see AUM=0 and block every proposal."""
    with patch(
        "asyncio.create_subprocess_exec",
        AsyncMock(side_effect=FileNotFoundError),
    ):
        state = await default_state_fetcher("sherwood", "alpha")
    assert state is None


@pytest.mark.asyncio
async def test_fetcher_returns_none_on_nonzero_exit():
    """CLI ran but exited non-zero (e.g., `vault info --json` subcommand doesn't exist)."""
    proc = AsyncMock()
    proc.communicate = AsyncMock(return_value=(b"", b"unknown flag --json"))
    proc.returncode = 2
    with patch("asyncio.create_subprocess_exec", AsyncMock(return_value=proc)):
        state = await default_state_fetcher("sherwood", "alpha")
    assert state is None


@pytest.mark.asyncio
async def test_fetcher_returns_none_on_malformed_payload():
    """CLI returned JSON but with non-numeric fields."""
    proc = AsyncMock()
    proc.communicate = AsyncMock(return_value=(b'{"aumUsd": "not-a-number"}', b""))
    proc.returncode = 0
    with patch("asyncio.create_subprocess_exec", AsyncMock(return_value=proc)):
        state = await default_state_fetcher("sherwood", "alpha")
    assert state is None


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
