#!/usr/bin/env python3
"""影响网 local engine: structure/graph/health + MCP propose/apply (stdlib HTTP).

Data lives under ~/.influence-net/nets/ (INFLUENCE_NET_HOME). No Influence Lab dependency.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from app.example_loader import list_examples, load_example
from app.filters import filter_graph
from app.mcp_tools import InfluenceMCP
from app.net_factory import list_nets
from app.paths import (
    DEFAULT_PORT,
    PRODUCT_ID,
    PRODUCT_NAME,
    REPO_ROOT,
    ensure_user_home,
    nets_root,
)
from app.views import build_abstract_graph, build_instance_graph

DEFAULT_NET_ID = "net_fii_601138"

# Active net (mutable). Prefer set_active_net() over writing these directly.
NET_ID = ""
NET_DIR = Path(".")
STRUCTURE_PATH = Path(".")
SQLITE_PATH = Path(".")


def _refresh_paths_from_id(net_id: str) -> None:
    global NET_ID, NET_DIR, STRUCTURE_PATH, SQLITE_PATH
    net_dir = nets_root() / net_id
    NET_ID = net_id
    NET_DIR = net_dir
    STRUCTURE_PATH = net_dir / "graph_structure.json"
    SQLITE_PATH = net_dir / "instances.sqlite"


def set_active_net(net_id: str) -> dict:
    """Switch the process-wide active net; raises FileNotFoundError if missing."""
    net_id = (net_id or "").strip()
    if not net_id:
        raise ValueError("net_id required")
    net_dir = nets_root() / net_id
    structure = net_dir / "graph_structure.json"
    sqlite_path = net_dir / "instances.sqlite"
    if not structure.is_file() or not sqlite_path.is_file():
        raise FileNotFoundError(f"net not found or incomplete: {net_id}")
    _refresh_paths_from_id(net_id)
    return {"net_id": NET_ID, "net_dir": str(NET_DIR)}


def has_active_net() -> bool:
    return bool(NET_ID) and STRUCTURE_PATH.is_file() and SQLITE_PATH.is_file()


def boot_ensure_data(*, autoload_example: bool = True) -> dict:
    """Ensure user home exists; optionally load FII demo when nets are empty."""
    ensure_user_home()
    existing = list_nets(nets_root())
    info: dict = {"home": str(ensure_user_home()), "nets": len(existing)}
    if not existing and autoload_example:
        loaded = load_example("fii", force=False)
        info["autoload_example"] = loaded
        existing = list_nets(nets_root())
    if existing:
        preferred = next((n for n in existing if n["net_id"] == DEFAULT_NET_ID), existing[0])
        set_active_net(preferred["net_id"])
        info["active_net"] = preferred["net_id"]
    else:
        info["active_net"] = None
    return info


def load_structure() -> dict:
    return json.loads(STRUCTURE_PATH.read_text(encoding="utf-8"))


def get_mcp() -> InfluenceMCP:
    if not has_active_net():
        raise RuntimeError("no active net; load an example or create_net first")
    mcp = InfluenceMCP(net_dir=NET_DIR, net_id=NET_ID)
    mcp.ensure_schema()
    return mcp


def load_graph_rows() -> tuple[list[dict], list[dict]]:
    conn = sqlite3.connect(SQLITE_PATH)
    conn.row_factory = sqlite3.Row
    try:
        nodes = []
        for r in conn.execute(
            "SELECT id, type, name, props_json FROM objects WHERE net_id=?",
            (NET_ID,),
        ):
            props = json.loads(r["props_json"] or "{}")
            nodes.append(
                {
                    "id": r["id"],
                    "type": r["type"],
                    "name": r["name"],
                    "props": props,
                    "dimension": props.get("dimension"),
                    "horizons": props.get("horizons") or [],
                }
            )
        edges = []
        for r in conn.execute(
            "SELECT id, rel, source, target, props_json, attribution_tier, evidence_refs_json FROM links WHERE net_id=?",
            (NET_ID,),
        ):
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
                    "dimension": props.get("dimension"),
                    "horizons": props.get("horizons") or [],
                }
            )
        return nodes, edges
    finally:
        conn.close()


def load_events() -> list[dict]:
    conn = sqlite3.connect(SQLITE_PATH)
    conn.row_factory = sqlite3.Row
    try:
        out = []
        for r in conn.execute(
            "SELECT id, asof, summary, props_json FROM events WHERE net_id=? ORDER BY asof",
            (NET_ID,),
        ):
            props = json.loads(r["props_json"] or "{}")
            out.append(
                {
                    "id": r["id"],
                    "asof": r["asof"],
                    "summary": r["summary"],
                    "props": props,
                }
            )
        return out
    finally:
        conn.close()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        super().log_message(fmt, *args)

    def _cors_headers(self) -> None:
        origin = self.headers.get("Origin") or "*"
        if origin.startswith("http://127.0.0.1:") or origin.startswith("http://localhost:"):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        else:
            self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header(
            "Access-Control-Allow-Headers",
            "Content-Type, Authorization",
        )

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _send_json(self, data: dict, status: int = 200) -> None:
        raw = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self._cors_headers()
        self.end_headers()
        self.wfile.write(raw)

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        if path == "/api/health":
            return self._send_json(
                {
                    "ok": True,
                    "product": PRODUCT_NAME,
                    "product_id": PRODUCT_ID,
                    "net_id": NET_ID or None,
                    "home": str(ensure_user_home()),
                    "repo": str(REPO_ROOT),
                }
            )

        if path == "/api/examples":
            return self._send_json({"examples": list_examples()})

        if path == "/api/structure":
            if not has_active_net():
                return self._send_json({"error": "no active net"}, 404)
            return self._send_json(load_structure())

        if path == "/api/graph":
            if not has_active_net():
                return self._send_json({"error": "no active net"}, 404)
            view = (qs.get("view") or ["instance"])[0]
            dimension = (qs.get("dimension") or [None])[0]
            horizon = (qs.get("horizon") or [None])[0]
            structure = load_structure()
            nodes, edges = load_graph_rows()
            if view == "abstract":
                graph = build_abstract_graph(structure, nodes, edges)
            else:
                graph = build_instance_graph(structure, nodes, edges)
            if dimension or horizon:
                graph = filter_graph(graph, dimension=dimension, horizon=horizon)
            graph["view"] = "abstract" if view == "abstract" else "instance"
            graph["net_id"] = NET_ID
            return self._send_json(graph)

        if path == "/api/events":
            if not has_active_net():
                return self._send_json({"error": "no active net"}, 404)
            return self._send_json({"events": load_events(), "net_id": NET_ID})

        if path == "/api/nets":
            return self._send_json(
                {
                    "nets": list_nets(nets_root()),
                    "active_net_id": NET_ID or None,
                }
            )

        if path == "/api/mcp/pending":
            if not has_active_net():
                return self._send_json({"patches": [], "net_id": None})
            mcp = get_mcp()
            try:
                return self._send_json({"patches": mcp.list_pending_patches(), "net_id": NET_ID})
            finally:
                mcp.close()

        if path in ("/", "/index.html"):
            return self._send_json(
                {
                    "product": PRODUCT_NAME,
                    "product_id": PRODUCT_ID,
                    "hint": "UI is the dsh plugin sidebar; this process is the local engine API.",
                    "health": "/api/health",
                    "active_net_id": NET_ID or None,
                }
            )

        return self._send_json({"error": f"unknown GET {path}"}, 404)

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path
        body = self._read_json()

        if path == "/api/mcp/create_net":
            from app.net_factory import create_net_from_template

            ticker = body.get("ticker") or ""
            name = body.get("name")
            try:
                result = create_net_from_template(
                    ticker=ticker,
                    name=name,
                    nets_root=nets_root(),
                )
            except ValueError as e:
                return self._send_json({"error": str(e)}, 409)
            except Exception as e:  # noqa: BLE001
                return self._send_json({"error": str(e)}, 400)
            activate = body.get("activate", True)
            if activate:
                set_active_net(result["net_id"])
                result["activated"] = True
            else:
                result["activated"] = False
            return self._send_json(result)

        if path == "/api/nets/activate":
            net_id = body.get("net_id") or ""
            try:
                result = set_active_net(net_id)
            except FileNotFoundError as e:
                return self._send_json({"error": str(e)}, 404)
            except ValueError as e:
                return self._send_json({"error": str(e)}, 400)
            return self._send_json(result)

        if path == "/api/mcp/load_example":
            example_id = body.get("example_id") or body.get("example") or "fii"
            force = bool(body.get("force", False))
            activate = body.get("activate", True)
            try:
                result = load_example(example_id, force=force)
            except (ValueError, FileNotFoundError) as e:
                return self._send_json({"error": str(e)}, 400)
            if activate and result.get("net_id"):
                set_active_net(result["net_id"])
                result["activated"] = True
            return self._send_json(result)

        if not has_active_net():
            return self._send_json(
                {"error": "no active net; POST /api/mcp/load_example or create_net first"},
                404,
            )

        mcp = get_mcp()
        try:
            if path == "/api/mcp/propose":
                try:
                    patch = mcp.propose_from_utterance(
                        body.get("utterance") or body.get("text") or "",
                        target_id=body.get("target_id"),
                        evidence_urls=body.get("evidence_urls"),
                        tier=body.get("tier"),
                        write_mode=body.get("write_mode"),
                    )
                except Exception as e:  # noqa: BLE001
                    return self._send_json({"error": str(e)}, 400)
                return self._send_json(patch)

            if path == "/api/mcp/apply":
                pid = body.get("patch_id") or ""
                try:
                    result = mcp.apply_patch(pid)
                except Exception as e:  # noqa: BLE001
                    return self._send_json({"error": str(e)}, 400)
                return self._send_json(result)

            if path == "/api/mcp/bulk_seed":
                try:
                    result = mcp.bulk_seed_from_design(
                        body.get("design") or body,
                        write_mode=body.get("write_mode"),
                    )
                except Exception as e:  # noqa: BLE001
                    return self._send_json({"error": str(e)}, 400)
                return self._send_json(result)

            if path == "/api/mcp/reject":
                pid = body.get("patch_id") or ""
                try:
                    result = mcp.reject_patch(pid)
                except Exception as e:  # noqa: BLE001
                    return self._send_json({"error": str(e)}, 400)
                return self._send_json(result)

            return self._send_json({"error": f"unknown POST {path}"}, 404)
        finally:
            mcp.close()


def make_server(host: str = "127.0.0.1", port: int = DEFAULT_PORT):
    return ThreadingHTTPServer((host, port), Handler)


def main() -> None:
    ap = argparse.ArgumentParser(description=f"{PRODUCT_NAME} local engine")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    ap.add_argument(
        "--no-autoload-example",
        action="store_true",
        help="Do not auto-load FII demo when nets dir is empty",
    )
    args = ap.parse_args()
    boot = boot_ensure_data(autoload_example=not args.no_autoload_example)
    httpd = make_server(args.host, args.port)
    print(f"{PRODUCT_NAME} engine → http://{args.host}:{args.port}/")
    print(f"  home:   {boot.get('home')}")
    print(f"  active: {boot.get('active_net')}")
    print("  MCP: propose|apply|reject|bulk_seed|create_net|load_example")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")
        httpd.shutdown()


if __name__ == "__main__":
    main()
