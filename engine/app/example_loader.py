"""Load bundled demo nets into the user data directory."""
from __future__ import annotations

import hashlib
import json
import re
import shutil
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from app.net_factory import SCHEMA_SQL
from app.paths import EXAMPLES_DIR, FII_EXAMPLE_DIR, nets_root

SHANGHAI = timezone(timedelta(hours=8))

TYPE_MAPPING: dict[str, str] = {
    "Company": "Company",
    "Competitor": "Company",
    "CompetitorSet": "Company",
    "Supplier": "Company",
    "CSP": "CSP",
    "ProductPlatform": "ProductPlatform",
    "ProductLine": "ProductPlatform",
    "Capability": "ProductPlatform",
    "Capacity": "ProductPlatform",
    "DemandDriver": "DemandDriver",
    "TechTrend": "TechTrend",
    "BusinessModel": "BusinessModel",
    "Narrative": "Narrative",
    "MacroCycle": "Narrative",
    "MacroEvent": "Narrative",
    "CalendarEvent": "Narrative",
    "Policy": "PolicyRisk",
    "PolicyRisk": "PolicyRisk",
    "LegalRisk": "PolicyRisk",
    "StructuralRisk": "PolicyRisk",
    "Governance": "PolicyRisk",
    "FinancialMetric": "FinanceSignal",
    "FinanceSignal": "FinanceSignal",
    "Event": "Event",
    "Document": "Document",
}

EXAMPLES = {
    "fii": {
        "example_id": "fii",
        "net_id": "net_fii_601138",
        "dir": FII_EXAMPLE_DIR,
        "seed": FII_EXAMPLE_DIR / "seed.json",
        "title": "工业富联（示例）",
    }
}


def _now_iso() -> str:
    return datetime.now(SHANGHAI).isoformat(timespec="seconds")


def map_type(seed_type: str | None) -> str:
    if not seed_type:
        return "Company"
    return TYPE_MAPPING.get(seed_type, seed_type)


def _doc_id(url: str) -> str:
    h = hashlib.sha1(url.encode("utf-8")).hexdigest()[:10]
    return f"doc_{h}"


def extract_documents(seed: dict) -> list[dict]:
    docs: dict[str, dict] = {}

    def add(url: str, title: str | None = None, date: str | None = None):
        url = url.strip().rstrip(").,;]")
        if not url.startswith("http"):
            return
        did = _doc_id(url)
        if did in docs:
            return
        domain = urlparse(url).netloc
        docs[did] = {
            "id": did,
            "url": url,
            "title": title or domain,
            "domain": domain,
            "fetched_at": date or seed.get("asof"),
        }

    for m in re.findall(r"https?://[^\s\"<>]+", json.dumps(seed, ensure_ascii=False)):
        add(m)
    return list(docs.values())


def build_structure(seed: dict, net_id: str) -> dict:
    center = dict(seed["center"])
    center["role"] = "center"
    structure = {
        "net_id": net_id,
        "title": seed.get("title") or "影响网络",
        "purpose": seed.get("purpose"),
        "asof": seed.get("asof"),
        "timezone": seed.get("timezone") or "Asia/Shanghai",
        "center": center,
        "dimensions": list(seed.get("dimensions") or []),
        "horizons": seed.get("horizons") or {},
        "type_catalog": seed.get("type_catalog"),
        "type_mapping": seed.get("type_mapping") or TYPE_MAPPING,
        "layout": {"hints": {}},
        "schema_version": seed.get("schema_version") or "influence-net.structure.1",
        "demo": True,
        "demo_disclaimer": seed.get("demo_disclaimer")
        or "示例数据，仅供产品演示。非投资建议。",
        "imported_at": _now_iso(),
    }
    # Prefer bundled graph_structure dimensions if seed omitted catalog
    struct_path = EXAMPLES["fii"]["dir"] / "graph_structure.json"
    if struct_path.is_file():
        bundled = json.loads(struct_path.read_text(encoding="utf-8"))
        if not structure.get("type_catalog"):
            structure["type_catalog"] = bundled.get("type_catalog")
        if not structure.get("type_mapping"):
            structure["type_mapping"] = bundled.get("type_mapping") or TYPE_MAPPING
        if not structure.get("dimensions"):
            structure["dimensions"] = bundled.get("dimensions")
        if not structure.get("horizons"):
            structure["horizons"] = bundled.get("horizons")
    return structure


def materialize_seed(seed: dict, out_dir: Path, net_id: str) -> dict[str, Any]:
    out_dir = Path(out_dir)
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    structure = build_structure(seed, net_id)
    (out_dir / "graph_structure.json").write_text(
        json.dumps(structure, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    sqlite_path = out_dir / "instances.sqlite"
    conn = sqlite3.connect(sqlite_path)
    try:
        conn.executescript(SCHEMA_SQL)
        conn.execute(
            "INSERT INTO nets(net_id, title, center_id, current_version, meta_json) VALUES (?,?,?,?,?)",
            (
                net_id,
                structure["title"],
                structure["center"]["id"],
                1,
                json.dumps(
                    {
                        "asof": structure.get("asof"),
                        "timezone": structure.get("timezone"),
                        "demo": True,
                    },
                    ensure_ascii=False,
                ),
            ),
        )

        c = seed["center"]
        center_props = {
            "role": "center",
            "ticker": c.get("ticker"),
            "seed_role": c.get("role"),
            "dimension": None,
            "horizons": ["near", "mid", "long"],
            "note": "demo center",
            "demo": True,
        }
        conn.execute(
            "INSERT INTO objects(id, net_id, type, name, props_json, version) VALUES (?,?,?,?,?,?)",
            (
                c["id"],
                net_id,
                map_type(c.get("type")),
                c.get("name"),
                json.dumps(center_props, ensure_ascii=False),
                1,
            ),
        )

        for n in seed.get("nodes") or []:
            props = {
                "dimension": n.get("dimension"),
                "horizons": n.get("horizons") or [],
                "lag": n.get("lag"),
                "channel": n.get("channel"),
                "strength": n.get("strength"),
                "note": n.get("note"),
                "seed_type": n.get("type"),
                "demo": True,
            }
            for k, v in n.items():
                if k not in {
                    "id",
                    "name",
                    "type",
                    "dimension",
                    "horizons",
                    "lag",
                    "channel",
                    "strength",
                    "note",
                }:
                    props[k] = v
            conn.execute(
                "INSERT INTO objects(id, net_id, type, name, props_json, version) VALUES (?,?,?,?,?,?)",
                (
                    n["id"],
                    net_id,
                    map_type(n.get("type")),
                    n.get("name"),
                    json.dumps(props, ensure_ascii=False),
                    1,
                ),
            )

        for e in seed.get("edges") or []:
            props = {
                "dimension": e.get("dimension"),
                "horizons": e.get("horizons") or [],
                "strength": e.get("strength"),
                "lag": e.get("lag"),
                "channel": e.get("channel"),
                "demo": True,
            }
            for k, v in e.items():
                if k not in {
                    "id",
                    "source",
                    "target",
                    "rel",
                    "dimension",
                    "horizons",
                    "strength",
                    "lag",
                    "channel",
                }:
                    props[k] = v
            conn.execute(
                "INSERT INTO links(id, net_id, rel, source, target, props_json, evidence_refs_json, attribution_tier) VALUES (?,?,?,?,?,?,?,?)",
                (
                    e["id"],
                    net_id,
                    e.get("rel") or "influences",
                    e["source"],
                    e["target"],
                    json.dumps(props, ensure_ascii=False),
                    json.dumps([], ensure_ascii=False),
                    None,
                ),
            )

        for ev in seed.get("events") or []:
            props = {
                "horizon_focus": ev.get("horizon_focus"),
                "touched_nodes": ev.get("touched_nodes") or [],
                "source": ev.get("source") or "demo seed",
                "attribution_tier": ev.get("attribution_tier") or "weak",
                "dimension": ev.get("dimension"),
                "horizon": ev.get("horizon"),
                "demo": True,
            }
            conn.execute(
                "INSERT INTO events(id, net_id, asof, summary, props_json) VALUES (?,?,?,?,?)",
                (
                    ev["id"],
                    net_id,
                    ev.get("asof"),
                    ev.get("summary"),
                    json.dumps(props, ensure_ascii=False),
                ),
            )

        for doc in extract_documents(seed):
            conn.execute(
                "INSERT INTO documents(id, net_id, url, title, domain, props_json) VALUES (?,?,?,?,?,?)",
                (
                    doc["id"],
                    net_id,
                    doc["url"],
                    doc.get("title"),
                    doc.get("domain"),
                    json.dumps({"fetched_at": doc.get("fetched_at"), "demo": True}, ensure_ascii=False),
                ),
            )

        conn.execute(
            "INSERT INTO audit_log(net_id, tool, patch_id, detail_json, created_at) VALUES (?,?,?,?,?)",
            (
                net_id,
                "load_example",
                None,
                json.dumps({"example": "fii", "demo": True}, ensure_ascii=False),
                _now_iso(),
            ),
        )
        conn.commit()
        counts = {
            "objects": conn.execute("SELECT COUNT(*) FROM objects").fetchone()[0],
            "links": conn.execute("SELECT COUNT(*) FROM links").fetchone()[0],
            "events": conn.execute("SELECT COUNT(*) FROM events").fetchone()[0],
            "documents": conn.execute("SELECT COUNT(*) FROM documents").fetchone()[0],
        }
    finally:
        conn.close()

    return {
        "net_id": net_id,
        "net_dir": str(out_dir),
        "counts": counts,
        "demo": True,
    }


def load_example(
    example_id: str = "fii",
    *,
    force: bool = False,
    dest_root: Path | None = None,
) -> dict[str, Any]:
    meta = EXAMPLES.get(example_id)
    if not meta:
        raise ValueError(f"unknown example: {example_id!r}; known={list(EXAMPLES)}")
    seed_path = Path(meta["seed"])
    if not seed_path.is_file():
        raise FileNotFoundError(f"example seed missing: {seed_path}")
    seed = json.loads(seed_path.read_text(encoding="utf-8"))
    root = Path(dest_root) if dest_root else nets_root()
    root.mkdir(parents=True, exist_ok=True)
    net_id = meta["net_id"]
    out_dir = root / net_id
    if out_dir.exists() and not force:
        return {
            "net_id": net_id,
            "net_dir": str(out_dir),
            "already_present": True,
            "demo": True,
            "note": "example already loaded; pass force=true to replace",
        }
    result = materialize_seed(seed, out_dir, net_id)
    result["example_id"] = example_id
    result["already_present"] = False
    result["disclaimer"] = seed.get("demo_disclaimer")
    return result


def list_examples() -> list[dict[str, Any]]:
    out = []
    for eid, meta in EXAMPLES.items():
        out.append(
            {
                "example_id": eid,
                "net_id": meta["net_id"],
                "title": meta["title"],
                "seed_present": Path(meta["seed"]).is_file(),
            }
        )
    return out
