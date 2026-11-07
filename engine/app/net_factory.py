"""Create a new influence net from the blank structure template.

Structure (schema shell) is cloned; instances start with center Company only.
Meat is filled later via MCP propose — never invent a full fake network.
"""
from __future__ import annotations

import json
import re
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from app.paths import BLANK_TEMPLATE, nets_root

DEFAULT_TEMPLATE = BLANK_TEMPLATE

SHANGHAI = timezone(timedelta(hours=8))

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS nets (
    net_id TEXT PRIMARY KEY,
    title TEXT,
    center_id TEXT,
    current_version INTEGER DEFAULT 1,
    meta_json TEXT
);
CREATE TABLE IF NOT EXISTS objects (
    id TEXT PRIMARY KEY,
    net_id TEXT NOT NULL,
    type TEXT NOT NULL,
    name TEXT,
    props_json TEXT NOT NULL,
    version INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS links (
    id TEXT PRIMARY KEY,
    net_id TEXT NOT NULL,
    rel TEXT,
    source TEXT NOT NULL,
    target TEXT NOT NULL,
    props_json TEXT NOT NULL,
    evidence_refs_json TEXT,
    attribution_tier TEXT
);
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    net_id TEXT NOT NULL,
    asof TEXT,
    summary TEXT,
    props_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    net_id TEXT NOT NULL,
    url TEXT NOT NULL,
    title TEXT,
    domain TEXT,
    props_json TEXT
);
CREATE TABLE IF NOT EXISTS session_patches (
    id TEXT PRIMARY KEY,
    net_id TEXT NOT NULL,
    status TEXT NOT NULL,
    summary TEXT,
    ops_json TEXT NOT NULL,
    warnings_json TEXT,
    utterance TEXT,
    created_at TEXT,
    resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    net_id TEXT,
    tool TEXT,
    patch_id TEXT,
    detail_json TEXT,
    created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_objects_net ON objects(net_id);
CREATE INDEX IF NOT EXISTS idx_links_net ON links(net_id);
CREATE INDEX IF NOT EXISTS idx_links_src ON links(source);
CREATE INDEX IF NOT EXISTS idx_links_tgt ON links(target);
CREATE INDEX IF NOT EXISTS idx_events_asof ON events(asof);
CREATE INDEX IF NOT EXISTS idx_patches_status ON session_patches(status);
"""


def _now_iso() -> str:
    return datetime.now(SHANGHAI).isoformat(timespec="seconds")


def normalize_ticker(raw: str) -> dict[str, str]:
    """Parse user ticker into code / exchange hint / display."""
    s = (raw or "").strip().upper()
    if not s:
        raise ValueError("ticker required")
    # strip market prefix like SHSE.
    s = re.sub(r"^(SHSE|SZSE|SSE|SZ)\.", "", s)
    m = re.match(r"^([A-Z0-9]+)(?:\.(SH|SZ|SS|HK|US))?$", s)
    if not m:
        raise ValueError(f"unrecognized ticker: {raw!r}")
    code, exch = m.group(1), m.group(2)
    if exch == "SS":
        exch = "SH"
    # A-share 6-digit heuristic
    if code.isdigit() and len(code) == 6 and not exch:
        exch = "SH" if code.startswith(("6", "9")) else "SZ"
    display = f"{code}.{exch}" if exch else code
    return {"code": code, "exchange": exch or "", "display": display, "raw": raw.strip()}


def _load_template(path: Path | None = None) -> dict[str, Any]:
    p = path or DEFAULT_TEMPLATE
    if not p.is_file():
        raise FileNotFoundError(f"blank template missing: {p}")
    return json.loads(p.read_text(encoding="utf-8"))


def create_net_from_template(
    *,
    ticker: str,
    name: str | None = None,
    nets_root: Path | str | None = None,
    template_path: Path | str | None = None,
) -> dict[str, Any]:
    """Create net_<code>/ with structure shell + center-only sqlite.

    Raises ValueError if net directory already exists.
    """
    info = normalize_ticker(ticker)
    code = info["code"]
    # keep alphanumeric slug
    slug = re.sub(r"[^A-Za-z0-9]+", "", code).lower() or code.lower()
    net_id = f"net_{slug}"
    center_id = f"c_{slug}"
    display_name = (name or "").strip() or code
    root = Path(nets_root) if nets_root else nets_root()
    net_dir = root / net_id
    if net_dir.exists():
        raise ValueError(f"net already exists: {net_id} ({net_dir})")

    tmpl = _load_template(Path(template_path) if template_path else None)
    title = (tmpl.get("title_pattern") or "{name}影响网络").format(
        name=display_name, ticker=info["display"]
    )
    purpose = (tmpl.get("purpose_pattern") or "").format(
        name=display_name, ticker=info["display"]
    )
    structure = {
        "net_id": net_id,
        "title": title,
        "purpose": purpose,
        "asof": _now_iso()[:10],
        "timezone": tmpl.get("timezone") or "Asia/Shanghai",
        "center": {
            "id": center_id,
            "type": "Company",
            "name": display_name,
            "ticker": info["display"],
            "role": "center",
        },
        "dimensions": list(tmpl.get("dimensions") or []),
        "horizons": tmpl.get("horizons") or {
            "near": "近（周–季）",
            "mid": "中（季–年）",
            "long": "远（年+）",
        },
        "type_catalog": list(tmpl.get("type_catalog") or []),
        "type_mapping": dict(tmpl.get("type_mapping") or {}),
        "layout": tmpl.get("layout") or {"hints": {}},
        "schema_version": tmpl.get("schema_version") or "influence-net.structure.1",
        "template_id": tmpl.get("template_id") or "influence_net_blank_v1",
        "imported_at": _now_iso(),
    }
    if len(structure["dimensions"]) != 8:
        raise ValueError("blank template must define exactly 8 dimensions")

    net_dir.mkdir(parents=True, exist_ok=False)
    (net_dir / "graph_structure.json").write_text(
        json.dumps(structure, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    db_path = net_dir / "instances.sqlite"
    con = sqlite3.connect(db_path)
    try:
        con.executescript(SCHEMA_SQL)
        props = {
            "role": "center",
            "ticker": info["display"],
            "narrative": f"{display_name}（{info['display']}）影响网已开壳，实例待补充。",
            "narrative_refined": "空壳中心节点；请用口述/证据逐步填充。",
        }
        con.execute(
            "INSERT INTO nets(net_id, title, center_id, current_version, meta_json) VALUES (?,?,?,?,?)",
            (
                net_id,
                title,
                center_id,
                1,
                json.dumps({"ticker": info["display"], "template_id": structure["template_id"]}, ensure_ascii=False),
            ),
        )
        con.execute(
            "INSERT INTO objects(id, net_id, type, name, props_json, version) VALUES (?,?,?,?,?,?)",
            (
                center_id,
                net_id,
                "Company",
                display_name,
                json.dumps(props, ensure_ascii=False),
                1,
            ),
        )
        con.execute(
            "INSERT INTO audit_log(net_id, tool, patch_id, detail_json, created_at) VALUES (?,?,?,?,?)",
            (
                net_id,
                "create_net_from_template",
                None,
                json.dumps({"ticker": info["display"], "center_id": center_id}, ensure_ascii=False),
                _now_iso(),
            ),
        )
        con.commit()
    finally:
        con.close()

    return {
        "net_id": net_id,
        "center_id": center_id,
        "net_dir": str(net_dir),
        "ticker": info["display"],
        "name": display_name,
        "title": title,
        "object_count": 1,
        "link_count": 0,
        "note": "结构壳已建；实例仅中心。后续用 propose 填充，勿一次编满。",
    }


def list_nets(nets_root: Path | str | None = None) -> list[dict[str, Any]]:
    root = Path(nets_root) if nets_root else nets_root()
    if not root.is_dir():
        return []
    out: list[dict[str, Any]] = []
    for p in sorted(root.iterdir()):
        struct = p / "graph_structure.json"
        if not struct.is_file():
            continue
        try:
            d = json.loads(struct.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        center = d.get("center") or {}
        out.append(
            {
                "net_id": d.get("net_id") or p.name,
                "title": d.get("title"),
                "ticker": center.get("ticker"),
                "name": center.get("name"),
                "center_id": center.get("id"),
                "net_dir": str(p),
            }
        )
    return out
