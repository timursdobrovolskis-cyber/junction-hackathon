"""Run one JSON request, or serve the read-only engine locally without API keys."""

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.financial_engine import FinancialEngine


def make_handler(engine, allowed_origin=None):
    class Handler(BaseHTTPRequestHandler):
        def respond(self, code, payload):
            data = json.dumps(payload).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            if allowed_origin and self.headers.get("Origin") == allowed_origin:
                self.send_header("Access-Control-Allow-Origin", allowed_origin)
                self.send_header("Vary", "Origin")
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path == "/health":
                self.respond(200, {"status": "ok", "modelVersion": engine.model["modelVersion"]})
            else:
                self.respond(404, {"error": "Not found"})

        def do_OPTIONS(self):
            if self.path != "/api/plan" or not allowed_origin or self.headers.get("Origin") != allowed_origin:
                self.respond(403, {"error": "Origin not allowed"})
                return
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", allowed_origin)
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()

        def do_POST(self):
            if self.path != "/api/plan":
                self.respond(404, {"error": "Not found"})
                return
            if self.headers.get("Origin") and self.headers["Origin"] != allowed_origin:
                self.respond(403, {"error": "Origin not allowed"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 65536:
                    self.respond(413, {"error": "Request must contain 1–65536 bytes"})
                    return
                request = json.loads(self.rfile.read(length))
                self.respond(200, engine.plan(request))
            except (ValueError, TypeError) as error:
                self.respond(400, {"error": str(error)})
            except Exception:
                self.respond(500, {"error": "Engine failed; check local database and model artifacts"})

        def log_message(self, format, *args):
            pass  # Do not log customer request bodies.
    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=Path("data/local/bank.sqlite"))
    parser.add_argument("--model", type=Path, default=Path("data/models/income-v2.json"))
    parser.add_argument("--calibration", type=Path, default=Path("data/models/income-v2-calibration.json"))
    parser.add_argument("--request", type=Path, help="JSON request file")
    parser.add_argument("--output", type=Path, default=Path("data/local/financial-plan.json"))
    parser.add_argument("--serve", action="store_true")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--allow-origin", help="Exact local frontend origin, e.g. http://localhost:3000")
    args = parser.parse_args()
    if args.serve == bool(args.request):
        parser.error("Choose either --serve or --request")
    if args.allow_origin:
        from urllib.parse import urlparse
        origin = urlparse(args.allow_origin)
        if origin.scheme != "http" or origin.hostname not in {"localhost", "127.0.0.1"} or origin.path or origin.query or origin.fragment:
            parser.error("This development server accepts only an exact localhost HTTP origin")
    engine = FinancialEngine(args.database, args.model, args.calibration)
    if args.serve:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(engine, args.allow_origin))
        print(f"Local engine listening at http://127.0.0.1:{server.server_port}; POST /api/plan", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
    else:
        if args.output.resolve() in {p.resolve() for p in (args.database, args.model, args.calibration, args.request)}:
            parser.error("Output must not overwrite an input")
        result = engine.plan(json.loads(args.request.read_text()))
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + "\n")
        print(f"Wrote {args.output}")


if __name__ == "__main__":
    main()
