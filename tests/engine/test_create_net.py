from __future__ import annotations

import json
import sqlite3
from pathlib import Path


def test_create_net_writes_structure_and_sqlite(tmp_home):
    from app.net_factory import create_net_from_template
    from app.paths import nets_root

    result = create_net_from_template(
        ticker="300750",
        name="宁德时代",
        nets_root=nets_root(),
    )
    assert result["net_id"] == "net_300750"
    net_dir = Path(result["net_dir"])
    structure = json.loads((net_dir / "graph_structure.json").read_text(encoding="utf-8"))
    assert structure["net_id"] == "net_300750"
    assert structure["center"]["name"] == "宁德时代"
    assert len(structure["dimensions"]) == 8
    assert "工业富联" not in json.dumps(structure, ensure_ascii=False)
    assert structure["schema_version"].startswith("influence-net")


def test_create_net_seeds_only_center(tmp_home):
    from app.net_factory import create_net_from_template
    from app.paths import nets_root

    result = create_net_from_template(ticker="300750", name="宁德时代", nets_root=nets_root())
    con = sqlite3.connect(Path(result["net_dir"]) / "instances.sqlite")
    n = con.execute("select count(*) from objects").fetchone()[0]
    links = con.execute("select count(*) from links").fetchone()[0]
    con.close()
    assert n == 1
    assert links == 0
