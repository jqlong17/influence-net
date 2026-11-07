"""Graph view projections: instance grain vs abstract/dimension aggregation."""
from __future__ import annotations

from typing import Any


def _node_dim(node: dict[str, Any]) -> str | None:
    props = node.get("props") or {}
    return props.get("dimension") or node.get("dimension")


def _is_center(node: dict[str, Any], center_id: str) -> bool:
    props = node.get("props") or {}
    if props.get("role") == "center":
        return True
    return node.get("id") == center_id


def build_instance_graph(
    structure: dict[str, Any],
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
) -> dict[str, Any]:
    """Passthrough instance-grain graph; marks view=instance. No invented strength."""
    return {
        "view": "instance",
        "nodes": list(nodes),
        "edges": list(edges),
    }


def build_abstract_graph(
    structure: dict[str, Any],
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
) -> dict[str, Any]:
    """
    Dimension-layer aggregation around center.

    Nodes = center + 8 radar dimensions from graph_structure.json.
    Edges = aggregated dim→center presence with object_count / link_count /
    instance_count only — never invent strength.
    """
    center_meta = structure.get("center") or {}
    center_id = center_meta.get("id") or "center"
    dimensions = structure.get("dimensions") or []

    # Count objects per dimension (exclude center)
    object_counts: dict[str, int] = {d["id"]: 0 for d in dimensions}
    for n in nodes:
        if _is_center(n, center_id):
            continue
        dim = _node_dim(n)
        if dim and dim in object_counts:
            object_counts[dim] += 1

    # Map instance id → dimension
    id_to_dim: dict[str, str | None] = {}
    for n in nodes:
        if _is_center(n, center_id):
            id_to_dim[n["id"]] = None
        else:
            id_to_dim[n["id"]] = _node_dim(n)

    # Count links that touch a dimension and the center (or have dim prop)
    link_counts: dict[str, int] = {d["id"]: 0 for d in dimensions}
    for e in edges:
        src, tgt = e.get("source"), e.get("target")
        eprops = e.get("props") or {}
        edim = eprops.get("dimension") or e.get("dimension")

        # Prefer explicit edge dimension
        dims_hit: set[str] = set()
        if edim and edim in link_counts:
            dims_hit.add(edim)

        # Infer from endpoints: non-center endpoint's dimension
        for endpoint in (src, tgt):
            if endpoint == center_id:
                continue
            d = id_to_dim.get(endpoint)
            if d and d in link_counts:
                dims_hit.add(d)

        # Only count if the edge involves center OR has an explicit dim
        involves_center = center_id in (src, tgt)
        if involves_center or edim:
            for d in dims_hit:
                link_counts[d] += 1

    out_nodes: list[dict[str, Any]] = [
        {
            "id": center_id,
            "type": center_meta.get("type") or "Company",
            "name": center_meta.get("name") or center_id,
            "kind": "center",
            "props": {
                "role": "center",
                "ticker": center_meta.get("ticker"),
            },
        }
    ]
    for d in dimensions:
        did = d["id"]
        out_nodes.append(
            {
                "id": did,
                "type": "Dimension",
                "name": d.get("name") or did,
                "kind": "dimension",
                "props": {
                    "dimension": did,
                    "desc": d.get("desc"),
                    "object_count": object_counts.get(did, 0),
                    "link_count": link_counts.get(did, 0),
                },
            }
        )

    out_edges: list[dict[str, Any]] = []
    for d in dimensions:
        did = d["id"]
        oc = object_counts.get(did, 0)
        lc = link_counts.get(did, 0)
        # Show agg edge when there is any instance presence under the dim
        if oc == 0 and lc == 0:
            continue
        instance_count = oc  # objects hanging under dim; links separately
        out_edges.append(
            {
                "id": f"agg_{did}_to_center",
                "rel": "aggregates",
                "kind": "agg",
                "source": did,
                "target": center_id,
                "props": {
                    "dimension": did,
                    "object_count": oc,
                    "link_count": lc,
                    "instance_count": instance_count,
                    # deliberately no strength
                },
            }
        )

    return {
        "view": "abstract",
        "nodes": out_nodes,
        "edges": out_edges,
    }
