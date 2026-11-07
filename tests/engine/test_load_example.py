from __future__ import annotations

import json
from pathlib import Path


def test_load_example_fii(tmp_home, example_seed):
    from app.example_loader import load_example
    from app.paths import nets_root

    result = load_example("fii", force=True, dest_root=nets_root())
    assert result["net_id"] == "net_fii_601138"
    assert result["counts"]["objects"] == 1 + len(example_seed["nodes"])
    assert result["counts"]["links"] == len(example_seed["edges"])
    assert result["demo"] is True
    net_dir = Path(result["net_dir"])
    structure = json.loads((net_dir / "graph_structure.json").read_text(encoding="utf-8"))
    assert structure.get("demo") is True
    assert "工业富联" in structure["title"]


def test_boot_autoloads_example(tmp_home):
    from app.server import boot_ensure_data, has_active_net, load_graph_rows

    boot = boot_ensure_data(autoload_example=True)
    assert boot["active_net"] == "net_fii_601138"
    assert has_active_net()
    nodes, edges = load_graph_rows()
    assert len(nodes) >= 20
    assert len(edges) >= 20
