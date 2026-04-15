"""Conservative risk checks for agent-initiated Sherwood proposals."""
from __future__ import annotations

from dataclasses import dataclass, field

MAX_TOTAL_EXPOSURE_PCT = 0.50
MAX_SINGLE_POSITION_PCT = 0.25


@dataclass(frozen=True)
class RiskVerdict:
    ok: bool
    reason: str = ""


@dataclass(frozen=True)
class ProposeParams:
    subdomain: str
    proposed_size_usd: float
    current_exposure_usd: float
    vault_aum_usd: float
    protocol: str
    allowed_protocols: list[str] = field(default_factory=list)


def check_portfolio_exposure(
    proposed_size_usd: float,
    current_exposure_usd: float,
    vault_aum_usd: float,
) -> RiskVerdict:
    if vault_aum_usd <= 0:
        return RiskVerdict(False, "portfolio exposure: vault AUM is zero")
    total = proposed_size_usd + current_exposure_usd
    if total / vault_aum_usd > MAX_TOTAL_EXPOSURE_PCT:
        pct = int((total / vault_aum_usd) * 100)
        return RiskVerdict(
            False,
            f"portfolio exposure would reach {pct}% of AUM "
            f"(max {int(MAX_TOTAL_EXPOSURE_PCT * 100)}%)",
        )
    return RiskVerdict(True)


def check_mandate_compliance(protocol: str, allowed: list[str]) -> RiskVerdict:
    if not allowed:
        return RiskVerdict(True)  # no mandate configured = permissive
    if protocol.lower() not in {p.lower() for p in allowed}:
        return RiskVerdict(
            False,
            f"mandate compliance: protocol '{protocol}' not in allowed list {allowed}",
        )
    return RiskVerdict(True)


def check_position_sizing(
    proposed_size_usd: float, vault_aum_usd: float
) -> RiskVerdict:
    if vault_aum_usd <= 0:
        return RiskVerdict(False, "position sizing: vault AUM is zero")
    if proposed_size_usd / vault_aum_usd > MAX_SINGLE_POSITION_PCT:
        pct = int((proposed_size_usd / vault_aum_usd) * 100)
        return RiskVerdict(
            False,
            f"position sizing: single position at {pct}% of AUM "
            f"(max {int(MAX_SINGLE_POSITION_PCT * 100)}%)",
        )
    return RiskVerdict(True)


def evaluate_propose(params: ProposeParams) -> RiskVerdict:
    for verdict in (
        check_position_sizing(params.proposed_size_usd, params.vault_aum_usd),
        check_portfolio_exposure(
            params.proposed_size_usd,
            params.current_exposure_usd,
            params.vault_aum_usd,
        ),
        check_mandate_compliance(params.protocol, params.allowed_protocols),
    ):
        if not verdict.ok:
            return verdict
    return RiskVerdict(True)
