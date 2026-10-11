#!/usr/bin/env python3
"""Local-only deterministic fixture for Safari and WKContentRuleList verification."""
import argparse
from collections import Counter
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import subprocess
import threading

ROOT = Path(__file__).resolve().parents[1]


class Handler(BaseHTTPRequestHandler):
    requests = Counter()

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        type_, body = {
            "/": ("text/html; charset=utf-8", (ROOT / "Fixtures/index.html").read_bytes()),
            "/youtube-test": ("text/html; charset=utf-8", (ROOT / "Fixtures/youtube.html").read_bytes()),
            "/personal-test": ("text/html; charset=utf-8", (ROOT / "Fixtures/personal.html").read_bytes()),
            "/content/control.js": ("text/javascript", b"window.normalScriptLoaded = true;"),
            "/adv-demo/blocked.js": ("text/javascript", b"window.adScriptLoaded = true;"),
            "/adv-demo/blocked.svg": ("image/svg+xml", b'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect width="64" height="32" fill="#f77"/></svg>'),
        }.get(path, ("text/plain", b"Not found"))
        self.requests[path] += 1
        self.send_response(200 if path in ["/", "/youtube-test", "/personal-test", "/content/control.js", "/adv-demo/blocked.js", "/adv-demo/blocked.svg"] else 404)
        self.send_header("Content-Type", type_)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--verify", action="store_true", help="Build/run WebKit checks, then exit")
    parser.add_argument("--rules", type=Path, help="Validate the packaged extension's networkRules.json")
    parser.add_argument("--youtube-resources", type=Path, default=ROOT / "WebExtension", help="YouTube script/CSS directory (can point at the packaged extension)")
    args = parser.parse_args()
    with ThreadingHTTPServer(("127.0.0.1", 0 if args.verify else args.port), Handler) as server:
        url = f"http://127.0.0.1:{server.server_port}/"
        print(url, flush=True)
        if args.verify:
            subprocess.run(["swift", "build", "--product", "ADVCheck"], cwd=ROOT, check=True)
            binary_dir = subprocess.check_output(["swift", "build", "--show-bin-path"], cwd=ROOT, text=True).strip()
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                command = [str(Path(binary_dir) / "ADVCheck"), url]
                rule_path = args.rules
                if not rule_path:
                    rule_path = ROOT / ".build/verification-rules.json"
                    subprocess.run([str(Path(binary_dir) / "ADVCheck"), "export", str(rule_path)], cwd=ROOT, check=True)
                command.extend([str(rule_path.resolve()), str(args.youtube_resources.resolve())])
                subprocess.run(command, cwd=ROOT, check=True, timeout=60)
                # Exactly one unfiltered ad request; the filtered navigation must not hit the server.
                assert Handler.requests["/adv-demo/blocked.js"] == 1, Handler.requests
                assert Handler.requests["/adv-demo/blocked.svg"] == 1, Handler.requests
                assert Handler.requests["/content/control.js"] == 2, Handler.requests
                print("PASS: Server confirms ad requests never arrived for the filtered page.")
            finally:
                server.shutdown()
                thread.join()
        else:
            print("Open this address in Safari; compare ADV enabled/disabled. Ctrl-C stops the server.")
            try:
                server.serve_forever()
            except KeyboardInterrupt:
                pass


if __name__ == "__main__":
    main()
