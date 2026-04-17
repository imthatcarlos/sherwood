import pytest

from sherwood_monitor.risk import (
    ProposeParams,
    RiskVerdict,
    check_mandate_compliance,
    check_portfolio_exposure,
    check_position_sizing,
    evaluate_propose,
)


def test_portfolio_exposure_ok():
    v = check_portfolio_exposure(proposed_size_usd=5_000, current_exposure_usd=10_000, vault_aum_usd=100_000)
    assert v.ok is True


def test_portfolio_exposure_blocks_when_total_over_50pct():
    v = check_portfolio_exposure(proposed_size_usd=50_000, current_exposure_usd=10_000, vault_aum_usd=100_000)
    assert v.ok is False
    assert "exposure" in v.reason.lower()


def test_mandate_compliance_ok():
    v = check_mandate_compliance(protocol="moonwell", allowed=["moonwell", "aerodrome"])
    assert v.ok is True


def test_mandate_compliance_blocks_unknown():
    v = check_mandate_compliance(protocol="unknown-defi", allowed=["moonwell"])
    assert v.ok is False
    assert "mandate" in v.reason.lower()


def test_position_sizing_ok():
    v = check_position_sizing(proposed_size_usd=5_000, vault_aum_usd=100_000)
    assert v.ok is True


def test_position_sizing_blocks_over_25pct_single_position():
    v = check_position_sizing(proposed_size_usd=30_000, vault_aum_usd=100_000)
    assert v.ok is False
    assert "position" in v.reason.lower()


def test_evaluate_propose_aggregates_checks():
    params = ProposeParams(
        subdomain="alpha",
        proposed_size_usd=30_000,
        current_exposure_usd=10_000,
        vault_aum_usd=100_000,
        protocol="moonwell",
        allowed_protocols=["moonwell"],
    )
    verdict = evaluate_propose(params)
    assert verdict.ok is False
    assert "position" in verdict.reason.lower()


def test_evaluate_propose_all_pass():
    params = ProposeParams(
        subdomain="alpha",
        proposed_size_usd=5_000,
        current_exposure_usd=10_000,
        vault_aum_usd=100_000,
        protocol="moonwell",
        allowed_protocols=["moonwell"],
    )
    verdict = evaluate_propose(params)
    assert verdict.ok is True
