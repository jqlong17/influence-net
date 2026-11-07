"""In-process MCP tools for 影响网.

Hard rules:
- Model/UI never raw-SQL the meat; only these tools write.
- write_mode: auto (default) | confirm | strict.
  auto: low-risk narrative-only upserts on existing ids apply immediately;
  medium/high always stay pending for user confirm; confirm/strict never auto-apply.
- Vague oral influence → narrative + narrative_refined; tier=weak; no fake strength.
- Never invent strength: bulk_seed strips it (warn); propose preserves prior only.
- dimension (in props) must be one of the 8 radar ids or omitted/null (center ok).
- public attribution_tier requires evidence_urls AND at least one issuer|mainstream
  source_tier (host-classified); industry/aggregator/unverified alone → strip to weak + warn.
  Empty evidence_urls + public still hard-rejects on bulk_seed.
- Each evidence ref is stamped {url, via, source_tier}.

Tool contract (MCP):
- bulk_seed_from_design: research seed structure, not fake precision coefficients;
  stamps source_tier; enforces public credibility bar.
- propose_from_utterance: narrative meat; never invent strength; same public bar.
"""
from __future__ import annotations

import json
import re
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

SHANGHAI = timezone(timedelta(hours=8))

CENTER_ID = "fii_601138"
NVDA_ID = "nvda"
NVDA_EDGE_ID = "e_nvda_to_center"


def _now_iso() -> str:
    return datetime.now(SHANGHAI).isoformat(timespec="seconds")


def _patch_id() -> str:
    return f"patch_{uuid.uuid4().hex[:12]}"


WRITE_MODES = ("auto", "confirm", "strict")

# 8 radar dimensions from blank structure template (center may omit / null).
DIMENSION_IDS: frozenset[str] = frozenset(
    {
        "dim_upstream",
        "dim_csp",
        "dim_peers",
        "dim_capacity",
        "dim_product",
        "dim_finance",
        "dim_policy",
        "dim_narrative",
    }
)


def _validate_dimension(dim: object, *, where: str) -> None:
    """Raise if dim is set and not in DIMENSION_IDS. None/""/omitted OK."""
    if dim is None or dim == "":
        return
    if not isinstance(dim, str):
        raise ValueError(
            f"{where}: dimension must be a string or null, got {type(dim).__name__}"
        )
    if dim not in DIMENSION_IDS:
        raise ValueError(
            f"{where}: dimension {dim!r} not in whitelist {sorted(DIMENSION_IDS)}"
        )


def _strip_strength_from_props(props: dict, *, where: str, warnings: list[str]) -> dict:
    """Return props without invented strength; append warning if stripped."""
    out = dict(props)
    if "strength" in out:
        out.pop("strength", None)
        warnings.append(f"stripped strength from {where} (do not invent)")
    return out


SOURCE_TIERS: frozenset[str] = frozenset(
    {"issuer", "mainstream", "industry", "aggregator", "unverified", "dead"}
)
PUBLIC_SOURCE_TIERS: frozenset[str] = frozenset({"issuer", "mainstream"})

# Host suffix → source_tier (longest match wins). Offline-fast; no HTTP.
_SOURCE_TIER_HOST_SUFFIXES: tuple[tuple[str, str], ...] = (
    # issuer — exchange filings / regulator disclosure portals
    ("sse.com.cn", "issuer"),
    ("szse.cn", "issuer"),
    ("bse.cn", "issuer"),
    ("cninfo.com.cn", "issuer"),
    ("hkexnews.hk", "issuer"),
    ("sec.gov", "issuer"),
    # mainstream — major finance press / gov / embassy
    ("stcn.com", "mainstream"),
    ("eastmoney.com", "mainstream"),
    ("sina.com.cn", "mainstream"),
    ("sina.cn", "mainstream"),
    ("cs.com.cn", "mainstream"),
    ("cnstock.com", "mainstream"),
    ("cls.cn", "mainstream"),
    ("yicai.com", "mainstream"),
    ("caixin.com", "mainstream"),
    ("reuters.com", "mainstream"),
    ("bloomberg.com", "mainstream"),
    ("gov.cn", "mainstream"),
    ("chinese-embassy.org.uk", "mainstream"),
    # industry — sector trade press (旁证, not alone for public)
    ("haijingshe.com", "industry"),
    ("cnenergynews.cn", "industry"),
    ("china5e.com", "industry"),
    ("in-en.com", "industry"),
    ("bjx.com.cn", "industry"),
    # aggregator / soft reprint / report farms
    ("sohu.com", "aggregator"),
    ("ifeng.com", "aggregator"),
    ("sgpjbg.com", "aggregator"),
    ("9fzt.com", "aggregator"),
    ("hynyw.com", "aggregator"),
    ("ictrade.com", "aggregator"),
    ("aastocks.com", "aggregator"),
    ("hangyan.co", "aggregator"),
    ("hangyan.com", "aggregator"),
    ("stockstar.com", "aggregator"),
    ("jrj.com.cn", "aggregator"),
)


def _url_host(url: str) -> str:
    from urllib.parse import urlparse

    if not url or not isinstance(url, str):
        return ""
    try:
        host = (urlparse(url.strip()).hostname or "").lower()
    except Exception:
        return ""
    if host.startswith("www."):
        host = host[4:]
    return host


def classify_url_source_tier(url: str) -> str:
    """Host-based evidence credibility tier. Offline; unknown → unverified."""
    host = _url_host(url)
    if not host:
        return "unverified"
    # Longest suffix first so sse.com.cn beats com.cn-style accidents
    best: tuple[int, str] | None = None
    for suffix, tier in _SOURCE_TIER_HOST_SUFFIXES:
        if host == suffix or host.endswith("." + suffix):
            if best is None or len(suffix) > best[0]:
                best = (len(suffix), tier)
    return best[1] if best else "unverified"


def _stamp_evidence_ref(url: str, *, via: str = "mcp_propose") -> dict:
    return {
        "url": url,
        "via": via,
        "source_tier": classify_url_source_tier(url),
    }


def _urls_support_public(urls: list) -> bool:
    for u in urls or []:
        if isinstance(u, dict):
            tier = u.get("source_tier") or classify_url_source_tier(u.get("url") or "")
            raw = u.get("url") or ""
        else:
            raw = u
            tier = classify_url_source_tier(raw)
        if raw and tier in PUBLIC_SOURCE_TIERS:
            return True
    return False


def _enforce_public_source_bar(
    tier: str,
    urls: list,
    *,
    where: str,
    warnings: list[str],
) -> str:
    """If public but no issuer/mainstream URL → downgrade to weak + warn (strip pattern)."""
    t = (tier or "weak").strip().lower()
    if t != "public":
        return t
    if not urls:
        # caller may hard-reject empty; keep public here so empty check still fires
        return t
    if _urls_support_public(urls):
        return "public"
    seen = sorted(
        {
            (
                (u.get("source_tier") if isinstance(u, dict) else None)
                or classify_url_source_tier(u.get("url") if isinstance(u, dict) else u)
            )
            for u in urls
            if u
        }
    )
    warnings.append(
        f"downgraded {where} attribution_tier public→weak "
        f"(need issuer|mainstream evidence; got {seen or ['none']})"
    )
    return "weak"


RISK_RANK = {"low": 0, "medium": 1, "high": 2}


def classify_patch_risk(ops: list[dict]) -> str:
    """Return low|medium|high for a list of propose ops.

    Annotations (optional, set by propose builder):
      _existing, _props_delta_keys, _strength_changed
    Without annotations, infer conservatively from op kind.
    """
    if not ops:
        return "low"
    worst = "low"
    for op in ops:
        kind = op.get("op") or ""
        if kind in ("delete_edge", "delete_node", "structure_patch", "bulk_overwrite", "clear_non_center"):
            level = "high"
        elif kind == "add_event":
            level = "medium"
        elif kind in ("upsert_edge", "upsert_node"):
            if op.get("_strength_changed"):
                level = "high"
            elif op.get("_existing") is False:
                level = "medium"
            else:
                delta = set(op.get("_props_delta_keys") or [])
                structural = delta & {
                    "dimension",
                    "horizons",
                    "horizon",
                    "lag",
                    "type",
                    "rel",
                    "source",
                    "target",
                }
                if "strength" in delta or op.get("_strength_changed"):
                    level = "high"
                elif structural:
                    level = "medium"
                elif op.get("_existing") is True or not delta or delta <= {
                    "narrative",
                    "narrative_refined",
                    "note",
                    "channel",
                    "evidence_refs",
                }:
                    # narrative-only (or unknown delta treated via _existing True)
                    if op.get("_existing") is True or delta <= {
                        "narrative",
                        "narrative_refined",
                        "note",
                        "channel",
                        "evidence_refs",
                    }:
                        level = "low"
                    else:
                        level = "medium"
                else:
                    level = "medium"
        else:
            level = "medium"
        if RISK_RANK[level] > RISK_RANK[worst]:
            worst = level
    return worst


def normalize_write_mode(mode: str | None) -> str:
    m = (mode or "auto").strip().lower()
    if m not in WRITE_MODES:
        raise ValueError(f"write_mode must be one of {WRITE_MODES}, got {mode!r}")
    return m



def refine_narrative(utterance: str, *, source_name: str = "英伟达", target_name: str = "工业富联") -> str:
    """Deterministic light refine — no LLM, no invented coefficients."""
    text = utterance.strip()
    # strip leading time hint for the refined body
    body = re.sub(r"^(上周|本周|近日|最近)\s*", "", text)
    refined = f"{source_name}（NVDA）价格/情绪可能传导至{target_name}（用户口述，机制未量化）"
    if body and "上周" in utterance:
        refined = "近周：" + refined
    # hard cap
    return refined[:100]


def detect_nvda_influence(utterance: str) -> bool:
    u = utterance.lower()
    has_nvda = any(k in utterance for k in ("英伟达", "NVDA", "nvda", "辉达"))
    has_effect = any(k in utterance for k in ("影响", "传导", "关联", "带动", "拖累"))
    has_price = any(k in utterance for k in ("股价", "价格", "行情", "股票", "涨", "跌"))
    return has_nvda and (has_effect or has_price)


def mentions_last_week(utterance: str) -> bool:
    return any(k in utterance for k in ("上周", "近一周", "本周早些", "上星期"))


# v2 matcher: map oral utterances to existing instance nodes (id → aliases).
NODE_ALIASES: list[tuple[str, tuple[str, ...]]] = [
    ("segment_mix", ("segment_mix", "云计算收入", "云计算业务", "收入占比", "三季报", "AI-ASIC", "AI-GPU机柜", "新一代AI机柜")),
    ("ocf_wc", ("ocf_wc", "经营现金流", "营运资本", "现金流净额", "经营活动现金流")),
    ("itc_337", ("itc_337", "ITC", "337", "Vicor", "337-TA")),
    ("nvda_earn_q3fy27", ("nvda_earn", "FY27Q3", "FY27 Q3", "财报窗口", "电话会")),
    ("esop_2026", ("esop_2026", "员工持股")),
    ("customer_conc", ("customer_conc", "前五大客户", "客户集中度")),
]


def refine_node_narrative(utterance: str, *, node_name: str) -> str:
    """Light refine for non-NVDA node updates — no invented coefficients."""
    body = utterance.strip()
    body = re.sub(r"^(上周|本周|近日|最近)\s*", "", body)
    return f"{node_name}：用户口述更新（未强行量化）— {body}"[:160]


def resolve_node_from_utterance(utterance: str) -> str | None:
    """Return best node id if utterance clearly points at one known instance."""
    hits: list[tuple[int, str]] = []
    for node_id, aliases in NODE_ALIASES:
        score = sum(1 for a in aliases if a.lower() in utterance.lower() or a in utterance)
        if score:
            hits.append((score, node_id))
    if not hits:
        return None
    hits.sort(key=lambda x: (-x[0], x[1]))
    # require a minimum signal; single weak alias like bare "三季报" alone is ok for segment_mix
    return hits[0][1]


class InfluenceMCP:
    def __init__(self, net_dir: Path, net_id: str = "net_fii_601138"):
        self.net_dir = Path(net_dir)
        self.net_id = net_id
        self.sqlite_path = self.net_dir / "instances.sqlite"
        self.structure_path = self.net_dir / "graph_structure.json"
        self._conn: sqlite3.Connection | None = None

    @property
    def conn(self) -> sqlite3.Connection:
        if self._conn is None:
            self._conn = sqlite3.connect(self.sqlite_path, check_same_thread=False)
            self._conn.row_factory = sqlite3.Row
        return self._conn

    def close(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None

    def ensure_schema(self) -> None:
        self.conn.executescript(
            """
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
            CREATE INDEX IF NOT EXISTS idx_patches_status ON session_patches(status);
            CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                net_id TEXT,
                tool TEXT,
                patch_id TEXT,
                detail_json TEXT,
                created_at TEXT
            );
            """
        )
        self.conn.commit()

    def _audit(self, tool: str, patch_id: str | None, detail: dict) -> None:
        self.conn.execute(
            "INSERT INTO audit_log(net_id, tool, patch_id, detail_json, created_at) VALUES (?,?,?,?,?)",
            (self.net_id, tool, patch_id, json.dumps(detail, ensure_ascii=False), _now_iso()),
        )
        self.conn.commit()

    # --- read tools ---

    def search_instances(self, query: str, limit: int = 20) -> list[dict]:
        q = f"%{query}%"
        rows = self.conn.execute(
            """
            SELECT id, type, name, props_json FROM objects
            WHERE net_id=? AND (name LIKE ? OR id LIKE ?)
            LIMIT ?
            """,
            (self.net_id, q, q, limit),
        ).fetchall()
        out = []
        for r in rows:
            out.append(
                {
                    "id": r["id"],
                    "type": r["type"],
                    "name": r["name"],
                    "kind": "object",
                    "props": json.loads(r["props_json"] or "{}"),
                }
            )
        return out

    def get_subgraph(self, node_ids: list[str] | None = None, dimension: str | None = None, horizon: str | None = None) -> dict:
        nodes: list[dict] = []
        if node_ids:
            placeholders = ",".join("?" * len(node_ids))
            rows = self.conn.execute(
                f"SELECT id, type, name, props_json FROM objects WHERE net_id=? AND id IN ({placeholders})",
                (self.net_id, *node_ids),
            ).fetchall()
        else:
            rows = self.conn.execute(
                "SELECT id, type, name, props_json FROM objects WHERE net_id=?",
                (self.net_id,),
            ).fetchall()
        id_set = set()
        for r in rows:
            props = json.loads(r["props_json"] or "{}")
            if dimension and props.get("role") != "center" and props.get("dimension") != dimension:
                continue
            if horizon and props.get("role") != "center":
                hz = props.get("horizons") or []
                if horizon not in hz:
                    continue
            nodes.append({"id": r["id"], "type": r["type"], "name": r["name"], "props": props})
            id_set.add(r["id"])

        edges = []
        for r in self.conn.execute(
            "SELECT id, rel, source, target, props_json, attribution_tier, evidence_refs_json FROM links WHERE net_id=?",
            (self.net_id,),
        ):
            if node_ids and (r["source"] not in id_set or r["target"] not in id_set):
                continue
            if not node_ids and id_set and (r["source"] not in id_set or r["target"] not in id_set):
                continue
            props = json.loads(r["props_json"] or "{}")
            edges.append(
                {
                    "id": r["id"],
                    "rel": r["rel"],
                    "source": r["source"],
                    "target": r["target"],
                    "props": props,
                    "attribution_tier": r["attribution_tier"],
                    "evidence_refs": json.loads(r["evidence_refs_json"] or "[]"),
                }
            )
        return {"net_id": self.net_id, "nodes": nodes, "edges": edges}

    def get_structure(self) -> dict:
        return json.loads(self.structure_path.read_text(encoding="utf-8"))

    def list_evidence(self, instance_id: str | None = None) -> list[dict]:
        rows = self.conn.execute(
            "SELECT id, url, title, domain, props_json FROM documents WHERE net_id=?",
            (self.net_id,),
        ).fetchall()
        return [
            {
                "id": r["id"],
                "url": r["url"],
                "title": r["title"],
                "domain": r["domain"],
                "props": json.loads(r["props_json"] or "{}"),
            }
            for r in rows
        ]

    # --- propose / apply ---

    def propose_from_utterance(
        self,
        text: str,
        *,
        context: dict | None = None,
        evidence_urls: list[str] | None = None,
        write_mode: str | None = None,
    ) -> dict:
        self.ensure_schema()
        text = (text or "").strip()
        if not text:
            raise ValueError("empty utterance")
        mode = normalize_write_mode(write_mode)

        evidence_urls = evidence_urls or []
        # never auto-public without URL; issuer|mainstream bar enforced below
        tier = "public" if evidence_urls else "weak"
        ops: list[dict] = []
        warnings: list[str] = []
        tier = _enforce_public_source_bar(
            tier, evidence_urls, where="propose", warnings=warnings
        )

        if detect_nvda_influence(text):
            # verify existing edge
            row = self.conn.execute(
                "SELECT id, props_json FROM links WHERE id=? AND net_id=?",
                (NVDA_EDGE_ID, self.net_id),
            ).fetchone()
            if row is None:
                # fallback: find any nvda → center
                row = self.conn.execute(
                    "SELECT id, props_json FROM links WHERE net_id=? AND source=? AND target=?",
                    (self.net_id, NVDA_ID, CENTER_ID),
                ).fetchone()
            if row is None:
                raise ValueError("nvda→center link missing; seed import required")

            existing = json.loads(row["props_json"] or "{}")
            refined = refine_narrative(text)
            # merge: keep strength / lag / dimensions unless explicitly overridden
            new_props = dict(existing)
            new_props.update(
                {
                    "dimension": existing.get("dimension") or "dim_upstream",
                    "horizons": existing.get("horizons") or ["near"],
                    "lag": existing.get("lag"),
                    "channel": "股价/情绪通道（用户口述，非订单量化）",
                    "narrative": text,
                    "narrative_refined": refined,
                }
            )
            # preserve-only: never invent strength from utterance
            if "strength" in existing and existing.get("strength") is not None:
                new_props["strength"] = existing["strength"]
            else:
                new_props.pop("strength", None)

            # if user didn't specify mid/long, prefer near when vague
            if "中期" in text and "mid" not in new_props["horizons"]:
                new_props["horizons"] = list(dict.fromkeys([*new_props["horizons"], "mid"]))
            if "长期" in text or "远期" in text:
                new_props["horizons"] = list(dict.fromkeys([*new_props["horizons"], "long"]))

            delta_keys = sorted(
                k for k in new_props.keys()
                if existing.get(k) != new_props.get(k)
            )
            # narrative fields always count as touched even if equal (first write)
            for k in ("narrative", "narrative_refined"):
                if k not in delta_keys:
                    delta_keys.append(k)
            strength_changed = existing.get("strength") != new_props.get("strength") and (
                "strength" in new_props and existing.get("strength") != new_props.get("strength")
            )
            # keep strength → not a change
            if existing.get("strength") == new_props.get("strength"):
                strength_changed = False
            ops.append(
                {
                    "op": "upsert_edge",
                    "instance": {
                        "id": row["id"],
                        "rel": "influences",
                        "source": NVDA_ID,
                        "target": CENTER_ID,
                        "props": new_props,
                    },
                    "attribution_tier": tier,
                    "evidence_urls": evidence_urls,
                    "rationale": (
                        "用户口述 NVDA 股价影响；issuer/mainstream URL → public"
                        if tier == "public"
                        else "用户口述 NVDA 股价影响；无合格公开源 → weak"
                    ),
                    "_existing": True,
                    "_props_delta_keys": delta_keys,
                    "_strength_changed": strength_changed,
                }
            )
            if not evidence_urls:
                warnings.append("弱推断：无证据 URL，确认后仍标 weak，不升 public")

            # optional weak event when 上周 mentioned
            ctx = context or {}
            if mentions_last_week(text) or ctx.get("hint_asof") == "last_week":
                asof = ctx.get("asof")
                if not asof:
                    today = datetime.now(SHANGHAI).date()
                    asof = (today - timedelta(days=today.weekday() + 7)).isoformat()
                evt_id = f"evt_oral_{asof.replace('-', '')}_nvda_price"
                ops.append(
                    {
                        "op": "add_event",
                        "instance": {
                            "id": evt_id,
                            "asof": asof,
                            "summary": refine_narrative(text),
                            "touched_nodes": [NVDA_ID, CENTER_ID],
                            "sources": [],
                            "attribution_tier": "weak",
                            "narrative": text,
                            "narrative_refined": refine_narrative(text),
                            "dimension": "dim_upstream",
                            "horizon": "near",
                            "not_a_proof": True,
                        },
                        "attribution_tier": "weak",
                        "evidence_urls": [],
                        "rationale": "用户点名上周；仅弱事件记录，不作公开归因",
                    }
                )
            target_label = NVDA_EDGE_ID
        else:
            node_id = resolve_node_from_utterance(text)
            if not node_id:
                raise ValueError(
                    "utterance not recognized (v2 matcher): need NVDA→center influence "
                    "or a known node alias (segment_mix/ocf_wc/itc_337/...)"
                )
            nrow = self.conn.execute(
                "SELECT id, type, name, props_json FROM objects WHERE id=? AND net_id=?",
                (node_id, self.net_id),
            ).fetchone()
            if nrow is None:
                raise ValueError(f"matched node missing in sqlite: {node_id}")
            existing = json.loads(nrow["props_json"] or "{}")
            node_name = nrow["name"] or node_id
            refined = refine_node_narrative(text, node_name=node_name)
            new_props = dict(existing)
            new_props["narrative"] = text
            new_props["narrative_refined"] = refined
            # preserve-only strength (utterance must not invent)
            if "strength" not in existing or existing.get("strength") is None:
                new_props.pop("strength", None)
            else:
                new_props["strength"] = existing["strength"]
            delta_keys = sorted(
                k for k in ("narrative", "narrative_refined")
                if existing.get(k) != new_props.get(k)
            )
            if not delta_keys:
                delta_keys = ["narrative", "narrative_refined"]
            ops.append(
                {
                    "op": "upsert_node",
                    "instance": {
                        "id": nrow["id"],
                        "type": nrow["type"],
                        "name": node_name,
                        "props": new_props,
                    },
                    "attribution_tier": tier,
                    "evidence_urls": evidence_urls,
                    "rationale": (
                        f"口述更新节点 {node_id}；issuer/mainstream URL → public"
                        if tier == "public"
                        else f"口述更新节点 {node_id}；无公开 URL → weak"
                    ),
                    "_existing": True,
                    "_props_delta_keys": delta_keys,
                    "_strength_changed": False,
                }
            )
            if not evidence_urls:
                warnings.append("弱推断：无证据 URL，确认后仍标 weak，不升 public")
            target_label = node_id

        # stash for summary below via local
        self._last_propose_target = target_label

        risk = classify_patch_risk(ops)
        patch_id = _patch_id()
        summary = f"口述影响：更新 {getattr(self, '_last_propose_target', NVDA_EDGE_ID)} 叙述（tier={tier}）"
        # Strip internal risk annotations from persisted/returned ops view
        public_ops = []
        for op in ops:
            clean = {k: v for k, v in op.items() if not str(k).startswith("_")}
            public_ops.append(clean)

        should_auto = mode == "auto" and risk == "low"
        status = "pending"
        patch = {
            "patch_id": patch_id,
            "summary": summary,
            "ops": public_ops,
            "warnings": warnings,
            "status": status,
            "utterance": text,
            "created_at": _now_iso(),
            "risk": risk,
            "write_mode": mode,
            "auto_applied": False,
        }
        self.conn.execute(
            """
            INSERT INTO session_patches(id, net_id, status, summary, ops_json, warnings_json, utterance, created_at)
            VALUES (?,?,?,?,?,?,?,?)
            """,
            (
                patch_id,
                self.net_id,
                "pending",
                summary,
                json.dumps(public_ops, ensure_ascii=False),
                json.dumps(warnings, ensure_ascii=False),
                text,
                patch["created_at"],
            ),
        )
        self.conn.commit()
        self._audit(
            "propose_from_utterance",
            patch_id,
            {"utterance": text, "n_ops": len(ops), "risk": risk, "write_mode": mode},
        )

        if should_auto:
            applied = self.apply_patch(patch_id)
            patch["status"] = "applied"
            patch["auto_applied"] = True
            patch["apply_result"] = applied
            if "auto-applied (write_mode=auto, risk=low)" not in warnings:
                patch["warnings"] = list(warnings) + ["auto-applied (write_mode=auto, risk=low)"]
        return patch


    def bulk_seed_from_design(
        self,
        design: dict,
        *,
        write_mode: str | None = None,
        replace_non_center: bool = True,
    ) -> dict:
        """Seed nodes/edges from a design JSON via session_patches + apply_patch.

        Models must use this (or propose/apply) — never bash/sqlite-write instances.
        write_mode default is confirm; auto means intentional seed and applies
        even though risk is always high.

        Guards:
        - props.dimension must be in DIMENSION_IDS (or omitted/null).
        - invented props.strength is stripped with a warning (seed still applies).
        - public attribution_tier requires evidence_urls (empty → hard reject).
        - public also needs ≥1 issuer|mainstream URL; else strip to weak + warn.
        - evidence refs stamped with source_tier on apply.
        """
        self.ensure_schema()
        if not isinstance(design, dict):
            raise ValueError("design must be a dict")
        design_net = design.get("net_id")
        if design_net != self.net_id:
            raise ValueError(
                f"design.net_id {design_net!r} does not match MCP net_id {self.net_id!r}"
            )
        nodes = design.get("nodes") or []
        edges = design.get("edges") or []
        if not nodes:
            raise ValueError("empty design: nodes required")

        design_ids: set[str] = set()
        for n in nodes:
            if not isinstance(n, dict) or not n.get("id") or not n.get("name"):
                raise ValueError("each node requires id and name")
            design_ids.add(n["id"])

        existing_ids = {
            r["id"]
            for r in self.conn.execute(
                "SELECT id FROM objects WHERE net_id=?", (self.net_id,)
            )
        }
        known = design_ids | existing_ids

        for e in edges:
            if not isinstance(e, dict) or not e.get("id"):
                raise ValueError("each edge requires id")
            src, tgt = e.get("source"), e.get("target")
            if src not in known:
                raise ValueError(f"edge {e.get('id')}: unknown source {src!r}")
            if tgt not in known:
                raise ValueError(f"edge {e.get('id')}: unknown target {tgt!r}")
            tier = (e.get("attribution_tier") or "weak").strip().lower()
            urls = e.get("evidence_urls") or []
            if tier == "public" and not urls:
                raise ValueError(
                    f"edge {e.get('id')}: public attribution_tier requires evidence_urls"
                )

        # Validate dimensions (whitelist) before building ops
        for n in nodes:
            props = n.get("props") or {}
            _validate_dimension(props.get("dimension"), where=f"node {n.get('id')}")
        for e in edges:
            props = e.get("props") or {}
            _validate_dimension(props.get("dimension"), where=f"edge {e.get('id')}")

        mode = normalize_write_mode(write_mode if write_mode is not None else "confirm")
        ops: list[dict] = []
        warnings: list[str] = []

        if replace_non_center:
            ops.append(
                {
                    "op": "clear_non_center",
                    "rationale": "bulk seed: clear links + non-center objects before upsert",
                }
            )

        structure_meta = design.get("structure") or {}
        meta_patch = {
            k: structure_meta[k]
            for k in ("title", "purpose", "asof")
            if k in structure_meta
        }
        if meta_patch:
            ops.append(
                {
                    "op": "structure_patch",
                    "patch": meta_patch,
                    "rationale": "bulk seed: optional structure meta",
                }
            )

        for n in nodes:
            raw_props = dict(n.get("props") or {})
            clean_props = _strip_strength_from_props(
                raw_props, where=f"node {n['id']}", warnings=warnings
            )
            ops.append(
                {
                    "op": "upsert_node",
                    "instance": {
                        "id": n["id"],
                        "type": n.get("type") or "Company",
                        "name": n["name"],
                        "props": clean_props,
                    },
                    "attribution_tier": "weak",
                    "evidence_urls": [],
                    "rationale": f"bulk seed node {n['id']}",
                    "_existing": n["id"] in existing_ids,
                    "_props_delta_keys": list(clean_props.keys()) or ["narrative"],
                    "_strength_changed": False,
                }
            )

        for e in edges:
            tier = (e.get("attribution_tier") or "weak").strip().lower()
            urls = list(e.get("evidence_urls") or [])
            tier = _enforce_public_source_bar(
                tier, urls, where=f"edge {e['id']}", warnings=warnings
            )
            raw_props = dict(e.get("props") or {})
            clean_props = _strip_strength_from_props(
                raw_props, where=f"edge {e['id']}", warnings=warnings
            )
            ops.append(
                {
                    "op": "upsert_edge",
                    "instance": {
                        "id": e["id"],
                        "rel": e.get("rel") or "influences",
                        "source": e["source"],
                        "target": e["target"],
                        "props": clean_props,
                    },
                    "attribution_tier": tier,
                    "evidence_urls": urls,
                    "rationale": f"bulk seed edge {e['id']}",
                    "_existing": False,
                    "_props_delta_keys": list(clean_props.keys()) or ["narrative"],
                    "_strength_changed": False,
                }
            )

        # Bulk seed is always high risk (clear + many new nodes/edges)
        risk = "high"
        # also annotate via classify for consistency
        classified = classify_patch_risk(ops)
        if RISK_RANK[classified] > RISK_RANK[risk]:
            risk = classified

        patch_id = _patch_id()
        summary = (
            f"bulk_seed_from_design: {len(nodes)} nodes, {len(edges)} edges"
            + (" (replace_non_center)" if replace_non_center else "")
        )
        public_ops = []
        for op in ops:
            clean = {k: v for k, v in op.items() if not str(k).startswith("_")}
            public_ops.append(clean)

        # Explicit exception: auto write_mode for bulk_seed applies even when high risk
        should_auto = mode == "auto"
        status = "pending"
        created = _now_iso()
        patch = {
            "patch_id": patch_id,
            "summary": summary,
            "ops": public_ops,
            "warnings": warnings,
            "status": status,
            "utterance": None,
            "created_at": created,
            "risk": risk,
            "write_mode": mode,
            "auto_applied": False,
            "n_nodes": len(nodes),
            "n_edges": len(edges),
            "replace_non_center": replace_non_center,
        }
        self.conn.execute(
            """
            INSERT INTO session_patches(id, net_id, status, summary, ops_json, warnings_json, utterance, created_at)
            VALUES (?,?,?,?,?,?,?,?)
            """,
            (
                patch_id,
                self.net_id,
                "pending",
                summary,
                json.dumps(public_ops, ensure_ascii=False),
                json.dumps(warnings, ensure_ascii=False),
                None,
                created,
            ),
        )
        self.conn.commit()
        self._audit(
            "bulk_seed_from_design",
            patch_id,
            {
                "n_nodes": len(nodes),
                "n_edges": len(edges),
                "risk": risk,
                "write_mode": mode,
                "replace_non_center": replace_non_center,
            },
        )

        if should_auto:
            applied = self.apply_patch(patch_id)
            patch["status"] = "applied"
            patch["auto_applied"] = True
            patch["apply_result"] = applied
            patch["warnings"] = list(warnings) + [
                "auto-applied (write_mode=auto bulk_seed; intentional high-risk seed)"
            ]
        return patch

    def list_pending_patches(self) -> list[dict]:
        self.ensure_schema()
        rows = self.conn.execute(
            """
            SELECT id, status, summary, ops_json, warnings_json, utterance, created_at
            FROM session_patches WHERE net_id=? AND status='pending' ORDER BY created_at
            """,
            (self.net_id,),
        ).fetchall()
        out = []
        for r in rows:
            out.append(
                {
                    "patch_id": r["id"],
                    "status": r["status"],
                    "summary": r["summary"],
                    "ops": json.loads(r["ops_json"] or "[]"),
                    "warnings": json.loads(r["warnings_json"] or "[]"),
                    "utterance": r["utterance"],
                    "created_at": r["created_at"],
                }
            )
        return out

    def get_patch(self, patch_id: str) -> dict | None:
        self.ensure_schema()
        r = self.conn.execute(
            "SELECT id, status, summary, ops_json, warnings_json, utterance, created_at FROM session_patches WHERE id=?",
            (patch_id,),
        ).fetchone()
        if not r:
            return None
        return {
            "patch_id": r["id"],
            "status": r["status"],
            "summary": r["summary"],
            "ops": json.loads(r["ops_json"] or "[]"),
            "warnings": json.loads(r["warnings_json"] or "[]"),
            "utterance": r["utterance"],
            "created_at": r["created_at"],
        }

    def reject_patch(self, patch_id: str) -> dict:
        self.ensure_schema()
        row = self.conn.execute(
            "SELECT status FROM session_patches WHERE id=?", (patch_id,)
        ).fetchone()
        if row is None:
            raise KeyError(f"patch not found: {patch_id}")
        if row["status"] != "pending":
            raise ValueError(f"patch not pending: {row['status']}")
        self.conn.execute(
            "UPDATE session_patches SET status='rejected', resolved_at=? WHERE id=?",
            (_now_iso(), patch_id),
        )
        self.conn.commit()
        self._audit("reject_patch", patch_id, {})
        return {"patch_id": patch_id, "status": "rejected"}

    def apply_patch(self, patch_id: str) -> dict:
        self.ensure_schema()
        row = self.conn.execute(
            "SELECT status, ops_json FROM session_patches WHERE id=?", (patch_id,)
        ).fetchone()
        if row is None:
            raise KeyError(f"patch not found: {patch_id}")
        if row["status"] != "pending":
            raise ValueError(f"patch not pending (status={row['status']}); refuse apply")
        ops = json.loads(row["ops_json"] or "[]")
        applied = []
        for op in ops:
            kind = op["op"]
            if kind == "clear_non_center":
                self._apply_clear_non_center(op)
                applied.append("clear_non_center")
            elif kind == "structure_patch":
                self._apply_structure_patch(op)
                applied.append("structure_patch")
            elif kind == "upsert_edge":
                self._apply_upsert_edge(op)
                applied.append(op["instance"]["id"])
            elif kind == "add_event":
                self._apply_add_event(op)
                applied.append(op["instance"]["id"])
            elif kind == "upsert_node":
                self._apply_upsert_node(op)
                applied.append(op["instance"]["id"])
            else:
                raise ValueError(f"unsupported op: {kind}")

        self.conn.execute(
            "UPDATE session_patches SET status='accepted', resolved_at=? WHERE id=?",
            (_now_iso(), patch_id),
        )
        # bump net version
        self.conn.execute(
            "UPDATE nets SET current_version = COALESCE(current_version,1) + 1 WHERE net_id=?",
            (self.net_id,),
        )
        self.conn.commit()
        self._audit("apply_patch", patch_id, {"applied": applied})
        return {"patch_id": patch_id, "status": "accepted", "applied": applied}

    def _apply_upsert_edge(self, op: dict) -> None:
        inst = op["instance"]
        tier = op.get("attribution_tier") or "weak"
        urls = op.get("evidence_urls") or []
        if tier == "public" and not urls:
            tier = "weak"
        elif tier == "public" and not _urls_support_public(urls):
            tier = "weak"
        incoming = dict(inst.get("props") or {})
        if incoming.get("strength") is None:
            incoming.pop("strength", None)
        evidence_refs = []
        existing = self.conn.execute(
            "SELECT props_json, evidence_refs_json FROM links WHERE id=? AND net_id=?",
            (inst["id"], self.net_id),
        ).fetchone()
        if existing:
            prior = json.loads(existing["props_json"] or "{}")
            # merge: prior first, then incoming overrides; keep prior strength if incoming omitted it
            props = dict(prior)
            props.update(incoming)
            if "strength" not in incoming and prior.get("strength") is not None:
                props["strength"] = prior["strength"]
            evidence_refs = json.loads(existing["evidence_refs_json"] or "[]")
            for url in urls:
                if url and not any(
                    (isinstance(r, dict) and r.get("url") == url) or r == url for r in evidence_refs
                ):
                    evidence_refs.append(_stamp_evidence_ref(url, via="mcp_propose"))
            self.conn.execute(
                """
                UPDATE links
                SET rel=?, source=?, target=?, props_json=?, evidence_refs_json=?, attribution_tier=?
                WHERE id=? AND net_id=?
                """,
                (
                    inst.get("rel") or "influences",
                    inst["source"],
                    inst["target"],
                    json.dumps(props, ensure_ascii=False),
                    json.dumps(evidence_refs, ensure_ascii=False),
                    tier,
                    inst["id"],
                    self.net_id,
                ),
            )
        else:
            props = incoming
            for url in urls:
                if url:
                    evidence_refs.append(_stamp_evidence_ref(url, via="mcp_propose"))
            self.conn.execute(
                """
                INSERT INTO links(id, net_id, rel, source, target, props_json, evidence_refs_json, attribution_tier)
                VALUES (?,?,?,?,?,?,?,?)
                """,
                (
                    inst["id"],
                    self.net_id,
                    inst.get("rel") or "influences",
                    inst["source"],
                    inst["target"],
                    json.dumps(props, ensure_ascii=False),
                    json.dumps(evidence_refs, ensure_ascii=False),
                    tier,
                ),
            )

    def _apply_add_event(self, op: dict) -> None:
        inst = op["instance"]
        tier = op.get("attribution_tier") or inst.get("attribution_tier") or "weak"
        props = {
            "touched_nodes": inst.get("touched_nodes") or [],
            "sources": inst.get("sources") or [],
            "attribution_tier": tier,
            "dimension": inst.get("dimension"),
            "horizon": inst.get("horizon"),
            "narrative": inst.get("narrative"),
            "narrative_refined": inst.get("narrative_refined"),
            "not_a_proof": inst.get("not_a_proof", True),
        }
        existing = self.conn.execute(
            "SELECT id FROM events WHERE id=?", (inst["id"],)
        ).fetchone()
        if existing:
            # events append-only: if id exists, write new id suffix
            new_id = f"{inst['id']}_{uuid.uuid4().hex[:6]}"
            inst = {**inst, "id": new_id}
        self.conn.execute(
            "INSERT INTO events(id, net_id, asof, summary, props_json) VALUES (?,?,?,?,?)",
            (
                inst["id"],
                self.net_id,
                inst.get("asof"),
                inst.get("summary"),
                json.dumps(props, ensure_ascii=False),
            ),
        )

    def _apply_upsert_node(self, op: dict) -> None:
        inst = op["instance"]
        incoming = dict(inst.get("props") or {})
        urls = op.get("evidence_urls") or []
        row = self.conn.execute(
            "SELECT id, type, name, props_json FROM objects WHERE id=?",
            (inst["id"],),
        ).fetchone()
        if row:
            prior = json.loads(row["props_json"] or "{}")
            props = dict(prior)
            props.update(incoming)
            if urls:
                refs = list(props.get("evidence_refs") or [])
                for url in urls:
                    if url and not any(
                        (isinstance(r, dict) and r.get("url") == url) or r == url for r in refs
                    ):
                        refs.append(_stamp_evidence_ref(url, via="mcp_propose"))
                props["evidence_refs"] = refs
            self.conn.execute(
                "UPDATE objects SET type=?, name=?, props_json=?, version=COALESCE(version,1)+1 WHERE id=?",
                (
                    inst.get("type") or row["type"] or "Company",
                    inst.get("name") or row["name"],
                    json.dumps(props, ensure_ascii=False),
                    inst["id"],
                ),
            )
        else:
            props = incoming
            if urls:
                props["evidence_refs"] = [
                    _stamp_evidence_ref(u, via="mcp_propose") for u in urls if u
                ]
            self.conn.execute(
                "INSERT INTO objects(id, net_id, type, name, props_json, version) VALUES (?,?,?,?,?,?)",
                (
                    inst["id"],
                    self.net_id,
                    inst.get("type") or "Company",
                    inst.get("name"),
                    json.dumps(props, ensure_ascii=False),
                    1,
                ),
            )



    def _apply_clear_non_center(self, op: dict) -> None:
        """DELETE all links for net + non-center objects. Center from graph_structure.json."""
        structure = self.get_structure()
        center = structure.get("center") or {}
        center_id = center.get("id")
        if not center_id:
            raise ValueError("graph_structure.json missing center.id")
        self.conn.execute("DELETE FROM links WHERE net_id=?", (self.net_id,))
        self.conn.execute(
            "DELETE FROM objects WHERE net_id=? AND id<>?",
            (self.net_id, center_id),
        )

    def _apply_structure_patch(self, op: dict) -> None:
        """Patch optional structure meta (title/purpose/asof) on apply only."""
        patch = op.get("patch") or op.get("instance") or {}
        if not patch:
            return
        structure = self.get_structure()
        for k in ("title", "purpose", "asof"):
            if k in patch:
                structure[k] = patch[k]
        structure["seeded_at"] = _now_iso()
        structure["seed_note"] = "bulk seed via MCP bulk_seed_from_design"
        self.structure_path.write_text(
            json.dumps(structure, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )



def default_mcp() -> InfluenceMCP:
    root = Path(__file__).resolve().parents[1]
    return InfluenceMCP(net_dir=root / "data" / "nets" / "net_fii_601138")
