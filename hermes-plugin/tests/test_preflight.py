from pathlib import Path
from unittest.mock import MagicMock, patch

from sherwood_monitor.preflight import (
    PreflightResult,
    check_cli_installed,
    check_cli_configured,
    run_preflight,
)


def test_check_cli_installed_ok():
    fake_run = MagicMock(return_value=MagicMock(returncode=0, stdout="0.4.1"))
    with patch("subprocess.run", fake_run):
        ok, version = check_cli_installed("sherwood")
    assert ok is True
    assert version == "0.4.1"


def test_check_cli_installed_missing():
    with patch("subprocess.run", side_effect=FileNotFoundError):
        ok, version = check_cli_installed("sherwood")
    assert ok is False
    assert version is None


def test_check_cli_installed_version_too_old():
    fake_run = MagicMock(return_value=MagicMock(returncode=0, stdout="0.3.9"))
    with patch("subprocess.run", fake_run):
        ok, version = check_cli_installed("sherwood", min_version="0.4.0")
    assert ok is False
    assert version == "0.3.9"


def test_check_cli_configured_ok(tmp_path: Path):
    cfg = tmp_path / ".sherwood" / "config.json"
    cfg.parent.mkdir()
    cfg.write_text("{}")
    assert check_cli_configured(tmp_path) is True


def test_check_cli_configured_missing(tmp_path: Path):
    assert check_cli_configured(tmp_path) is False


def test_run_preflight_all_ok(tmp_path: Path):
    cfg = tmp_path / ".sherwood" / "config.json"
    cfg.parent.mkdir()
    cfg.write_text("{}")
    fake_run = MagicMock(return_value=MagicMock(returncode=0, stdout="0.5.0"))
    with patch("subprocess.run", fake_run):
        result = run_preflight("sherwood", home=tmp_path)
    assert isinstance(result, PreflightResult)
    assert result.cli_ok is True
    assert result.config_ok is True
    assert result.warnings == []


def test_run_preflight_missing_cli(tmp_path: Path):
    with patch("subprocess.run", side_effect=FileNotFoundError):
        result = run_preflight("sherwood", home=tmp_path)
    assert result.cli_ok is False
    assert any("npm i -g @sherwoodagent/cli" in w for w in result.warnings)
