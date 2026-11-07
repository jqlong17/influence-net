from __future__ import annotations

import json
import threading
from http.client import HTTPConnection


def test_health_and_graph(tmp_home):
    from app.server import boot_ensure_data, make_server

    boot_ensure_data(autoload_example=True)
    httpd = make_server(host="127.0.0.1", port=0)
    port = httpd.server_address[1]
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    try:
        conn = HTTPConnection("127.0.0.1", port, timeout=5)
        conn.request("GET", "/api/health")
        resp = conn.getresponse()
        data = json.loads(resp.read())
        assert resp.status == 200
        assert data["ok"] is True
        assert data["product_id"] == "influence-net"
        assert data["net_id"] == "net_fii_601138"

        conn.request("GET", "/api/graph?view=instance")
        resp = conn.getresponse()
        graph = json.loads(resp.read())
        assert resp.status == 200
        assert len(graph["nodes"]) >= 20

        conn.request("POST", "/api/mcp/load_example", body=json.dumps({"example_id": "fii", "force": False}), headers={"Content-Type": "application/json"})
        resp = conn.getresponse()
        body = json.loads(resp.read())
        assert resp.status == 200
        assert body.get("net_id") == "net_fii_601138"
        conn.close()
    finally:
        httpd.shutdown()
