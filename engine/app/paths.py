"""Repo + user-data locations for the standalone 影响网 engine.

Runtime nets live under ~/.influence-net/ (override with INFLUENCE_NET_HOME).
Bundled templates/examples ship inside the repo and are copied on demand.
"""
from __future__ import annotations

import os
from pathlib import Path

# influence-net/  (repo root: engine/app/paths.py → parents[2])
REPO_ROOT = Path(__file__).resolve().parents[2]
ENGINE_ROOT = Path(__file__).resolve().parents[1]
PACKAGE_ROOT = Path(__file__).resolve().parent

TEMPLATES_DIR = REPO_ROOT / "data" / "templates"
EXAMPLES_DIR = REPO_ROOT / "data" / "examples"
BLANK_TEMPLATE = TEMPLATES_DIR / "influence_net_blank.structure.json"
FII_EXAMPLE_DIR = EXAMPLES_DIR / "fii-601138"

DEFAULT_PORT = 18765
PRODUCT_NAME = "影响网"
PRODUCT_ID = "influence-net"


def user_home() -> Path:
    raw = (os.environ.get("INFLUENCE_NET_HOME") or "").strip()
    if raw:
        return Path(raw).expanduser().resolve()
    return (Path.home() / ".influence-net").resolve()


def nets_root() -> Path:
    return user_home() / "nets"


def ensure_user_home() -> Path:
    home = user_home()
    (home / "nets").mkdir(parents=True, exist_ok=True)
    return home
