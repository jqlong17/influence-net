"""Fixtures for standalone 影响网 engine tests."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
ENGINE = REPO / "engine"
if str(ENGINE) not in sys.path:
    sys.path.insert(0, str(ENGINE))

EXAMPLE_SEED = REPO / "data" / "examples" / "fii-601138" / "seed.json"


@pytest.fixture()
def tmp_home(tmp_path, monkeypatch):
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("INFLUENCE_NET_HOME", str(home))
    # re-import paths bindings are functions — ok
    from app.paths import ensure_user_home

    ensure_user_home()
    return home


@pytest.fixture()
def example_seed() -> dict:
    assert EXAMPLE_SEED.is_file(), EXAMPLE_SEED
    return json.loads(EXAMPLE_SEED.read_text(encoding="utf-8"))
