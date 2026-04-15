from unittest.mock import AsyncMock, MagicMock

import pytest

from sherwood_monitor.config import Config
from sherwood_monitor.handlers import handle_chain_event
from sherwood_monitor.models import ChainEvent


@pytest.fixture
def cfg():
    return Config(xmtp_summaries=True, sherwood_bin="sherwood")


def _event(type_: str, args: dict[str, str] | None = None) -> ChainEvent:
    return ChainEvent(type=type_, block=1, tx="0x0", args=args or {})


@pytest.mark.asyncio
async def test_proposal_created_injects_and_posts(cfg):
    ctx = MagicMock()
    post = AsyncMock()
    ev = _event(
        "ProposalCreated",
        {
            "proposalId": "1",
            "proposer": "0xabc",
            "metadataName": "Aero LP",
            "metadataDescription": "1 week",
            "performanceFeeBps": "1000",
            "strategyDuration": "604800",
        },
    )
    await handle_chain_event("alpha", ev, ctx, cfg, post)
    ctx.inject_message.assert_called_once()
    call_content = ctx.inject_message.call_args.kwargs["content"]
    assert 'syndicate="alpha"' in call_content
    assert 'type="ProposalCreated"' in call_content
    assert "Aero LP" in call_content
    post.assert_called_once()
    assert post.call_args.args[0] == "sherwood"
    assert post.call_args.args[1] == "alpha"
    assert "Proposal #1" in post.call_args.args[2]


@pytest.mark.asyncio
async def test_proposal_settled_injects_and_posts(cfg):
    ctx = MagicMock()
    post = AsyncMock()
    ev = _event(
        "ProposalSettled",
        {"proposalId": "1", "pnl": "500000000", "duration": "604800", "performanceFee": "50000000"},
    )
    await handle_chain_event("alpha", ev, ctx, cfg, post)
    ctx.inject_message.assert_called_once()
    post.assert_called_once()
    assert "pnl" in post.call_args.args[2].lower()


@pytest.mark.asyncio
async def test_vote_cast_injects_no_post(cfg):
    ctx = MagicMock()
    post = AsyncMock()
    ev = _event(
        "VoteCast",
        {"proposalId": "1", "voter": "0xabc", "support": "1", "weight": "1"},
    )
    await handle_chain_event("alpha", ev, ctx, cfg, post)
    ctx.inject_message.assert_called_once()
    post.assert_not_called()


@pytest.mark.asyncio
async def test_xmtp_summaries_disabled_suppresses_post(cfg):
    ctx = MagicMock()
    post = AsyncMock()
    cfg_no_post = Config(xmtp_summaries=False, sherwood_bin="sherwood")
    ev = _event("ProposalCreated", {"proposalId": "1"})
    await handle_chain_event("alpha", ev, ctx, cfg_no_post, post)
    ctx.inject_message.assert_called_once()
    post.assert_not_called()


@pytest.mark.asyncio
async def test_deposited_and_withdrawn_skipped(cfg):
    ctx = MagicMock()
    post = AsyncMock()
    ev = _event("Deposited", {"amount": "100"})
    await handle_chain_event("alpha", ev, ctx, cfg, post)
    ctx.inject_message.assert_called_once()
    post.assert_not_called()


@pytest.mark.asyncio
async def test_unknown_event_logged_not_raised(cfg, caplog):
    ctx = MagicMock()
    post = AsyncMock()
    ev = _event("UFOSighting", {})
    await handle_chain_event("alpha", ev, ctx, cfg, post)
    ctx.inject_message.assert_not_called()
    post.assert_not_called()
    assert any("unhandled" in r.message.lower() for r in caplog.records)
