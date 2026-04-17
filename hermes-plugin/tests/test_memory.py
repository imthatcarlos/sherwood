import json
from unittest.mock import MagicMock

import pytest

from sherwood_monitor.memory import build_record, write_settlement


def test_build_record_execute():
    rec = build_record(
        subdomain="alpha",
        action="execute",
        command="sherwood proposal execute alpha 42",
        result_json='{"tx": "0xabc", "proposalId": 42}',
    )
    assert rec["syndicate"] == "alpha"
    assert rec["action"] == "execute"
    assert rec["tx_hash"] == "0xabc"
    assert rec["proposal_id"] == 42


def test_build_record_settle_with_pnl():
    rec = build_record(
        subdomain="alpha",
        action="settle",
        command="sherwood proposal settle alpha 42",
        result_json='{"tx": "0xdef", "proposalId": 42, "pnl": "1500000000"}',
    )
    assert rec["action"] == "settle"
    assert rec["pnl_usd"] == 1500.0


def test_build_record_handles_non_json_result():
    rec = build_record(
        subdomain="alpha",
        action="execute",
        command="sherwood proposal execute alpha 42",
        result_json="ok",
    )
    assert rec["syndicate"] == "alpha"
    assert rec["tx_hash"] is None


def test_write_settlement_calls_memory_writer():
    writer = MagicMock()
    write_settlement(
        writer,
        subdomain="alpha",
        action="settle",
        command="sherwood proposal settle alpha 42",
        result_json='{"tx": "0x1", "proposalId": 42}',
    )
    writer.assert_called_once()
    args = writer.call_args.args
    assert args[0]["syndicate"] == "alpha"
