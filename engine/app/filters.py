"""Dimension / horizon filter helpers (shared by API + tests)."""
from __future__ import annotations

from typing import Any


def _props(node: dict) -> dict:
    return node.get("props") or {}


def _is_center(node: dict) -> bool:
    props = _props(node)
    return props.get("role") == "center" or node.get("id", "").startswith("fii_") and props.get("role") == "center"


def node_matches(node: dict, dimension: str | None, horizon: str | None) -> bool:
    props = _props(node)
    if props.get("role") == "center":
        return True
    if dimension:
        if props.get("dimension") != dimension and node.get("dimension") != dimension:
            return False
    if horizon:
        hz = props.get("horizons") or node.get("horizons") or []
        if horizon not in hz:
            return False
    return True


def filter_graph(
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    dimension: str | None = None,
    horizon: str | None = None,
) -> dict[str, list]:
    kept = [n for n in nodes if node_matches(n, dimension, horizon)]
    ids = {n["id"] for n in kept}
    kept_edges = [
        e
        for e in edges
        if e.get("source") in ids and e.get("target") in ids
    ]
    return {"nodes": kept, "edges": kept_edges}
