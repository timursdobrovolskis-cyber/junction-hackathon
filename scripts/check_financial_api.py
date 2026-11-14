"""Smoke-test the local HTTP adapter against the prepared synthetic database."""

from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import sys
import threading
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.financial_engine import FinancialEngine
from scripts.run_financial_engine import make_handler


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(FinancialEngine(), "http://localhost:3000"))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        with urlopen(base + "/health", timeout=10) as response:
            assert json.load(response)["status"] == "ok"
        data = Path("fixtures/financial-plan-request.json").read_bytes()
        request = Request(base + "/api/plan", data=data,
                          headers={"Content-Type": "application/json", "Origin": "http://localhost:3000"})
        with urlopen(request, timeout=10) as response:
            assert response.headers["Access-Control-Allow-Origin"] == "http://localhost:3000"
            plan = json.load(response)
        assert plan == json.loads(Path("fixtures/financial-plan-demo.json").read_text())
        request = Request(base + "/api/plan", method="OPTIONS", headers={"Origin": "http://localhost:3000"})
        with urlopen(request, timeout=10) as response:
            assert response.status == 204
        for body, origin, status in [(b"{}", "http://localhost:3000", 400),
                                     (data, "http://example.com", 403)]:
            try:
                urlopen(Request(base + "/api/plan", data=body, headers={"Origin": origin}), timeout=10)
            except HTTPError as error:
                assert error.code == status
            else:
                raise AssertionError("Expected rejection")
        print("HTTP checks passed: health, real customer plan, fixture equality, CORS preflight, invalid request, blocked origin.")
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


if __name__ == "__main__":
    main()
