"""Preflight checks for Sherwood CLI installation and config."""
from __future__ import annotations

import subprocess
from dataclasses import dataclass, field
from pathlib import Path

MIN_CLI_VERSION = "0.4.0"


@dataclass(frozen=True)
class PreflightResult:
    cli_ok: bool
    cli_version: str | None
    config_ok: bool
    warnings: list[str] = field(default_factory=list)


def _parse_version(s: str) -> tuple[int, ...]:
    return tuple(int(p) for p in s.strip().split(".") if p.isdigit())


def check_cli_installed(
    bin_path: str, min_version: str = MIN_CLI_VERSION
) -> tuple[bool, str | None]:
    """Return (ok, version_string)."""
    try:
        res = subprocess.run(
            [bin_path, "--version"],
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False, None

    if res.returncode != 0:
        return False, None

    version = res.stdout.strip().split()[-1]
    try:
        if _parse_version(version) < _parse_version(min_version):
            return False, version
    except ValueError:
        return False, version

    return True, version


def check_cli_configured(home: Path) -> bool:
    """Return True if `~/.sherwood/config.json` exists."""
    return (home / ".sherwood" / "config.json").exists()


def run_preflight(sherwood_bin: str, home: Path | None = None) -> PreflightResult:
    """Run all preflight checks and collect warnings."""
    home = home or Path.home()
    warnings: list[str] = []

    cli_ok, cli_version = check_cli_installed(sherwood_bin)
    if not cli_ok:
        if cli_version is None:
            warnings.append(
                "Sherwood CLI not found. Install: npm i -g @sherwoodagent/cli"
            )
        else:
            warnings.append(
                f"Sherwood CLI version {cli_version} is below minimum "
                f"{MIN_CLI_VERSION}. Upgrade: npm i -g @sherwoodagent/cli@latest"
            )

    config_ok = check_cli_configured(home)
    if not config_ok:
        warnings.append(
            "Sherwood CLI not configured. Run: sherwood config set"
        )

    return PreflightResult(
        cli_ok=cli_ok,
        cli_version=cli_version,
        config_ok=config_ok,
        warnings=warnings,
    )
