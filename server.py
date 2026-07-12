import base64
import hmac
import json
import os
import sys
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PORT = int(os.environ.get("PORT") or (sys.argv[1] if len(sys.argv) > 1 else 8000))
ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()

# Paths that must stay reachable without credentials (Render's health check hits this).
PUBLIC_PATHS = {"/api/health"}


def _load_users():
    """Parses ATS_USERS="alice:pw1,bob:pw2" into {username: password}.
    Also honors the older single-pair ATS_USERNAME/ATS_PASSWORD for convenience."""
    users = {}
    for pair in os.environ.get("ATS_USERS", "").split(","):
        pair = pair.strip()
        if not pair or ":" not in pair:
            continue
        user, _, password = pair.partition(":")
        user, password = user.strip(), password.strip()
        if user and password:
            users[user] = password
    legacy_user = os.environ.get("ATS_USERNAME", "").strip()
    legacy_pass = os.environ.get("ATS_PASSWORD", "").strip()
    if legacy_user and legacy_pass:
        users[legacy_user] = legacy_pass
    return users


USERS = _load_users()
AUTH_ENABLED = bool(USERS)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    def check_auth(self):
        if not AUTH_ENABLED or self.path in PUBLIC_PATHS:
            return True
        header = self.headers.get("Authorization", "")
        if header.startswith("Basic "):
            try:
                decoded = base64.b64decode(header[6:]).decode("utf-8")
                user, _, password = decoded.partition(":")
            except Exception:
                user, password = "", ""
            for expected_user, expected_password in USERS.items():
                if hmac.compare_digest(user, expected_user) and hmac.compare_digest(password, expected_password):
                    return True
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="ATS Checker"')
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"Authentication required.")
        return False

    def do_OPTIONS(self):
        if self.path == "/api/claude":
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()
        else:
            self.send_error(404)

    def do_GET(self):
        if not self.check_auth():
            return
        if self.path in {"/", "/index.html", "/ats-resume-checker.html"}:
            self.serve_static("ats-resume-checker.html")
        elif self.path == "/api/health":
            self.send_json({"ok": True, "hasKey": bool(ANTHROPIC_API_KEY), "authEnabled": AUTH_ENABLED})
        else:
            self.serve_static(self.path.lstrip("/"))

    def do_POST(self):
        if not self.check_auth():
            return
        if self.path == "/api/claude":
            self.proxy_claude()
        else:
            self.send_error(404)

    def proxy_claude(self):
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(content_length) if content_length else b"{}"
            payload = json.loads(body.decode("utf-8"))
        except Exception:
            payload = {"messages": [{"role": "user", "content": "ping"}], "max_tokens": 20, "model": "claude-sonnet-4-6"}

        if not ANTHROPIC_API_KEY:
            self.send_json({"error": "ANTHROPIC_API_KEY is not set on the server."}, status=500)
            return

        request_headers = {
            "Content-Type": "application/json",
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "Accept": "application/json",
        }

        request = urllib.request.Request(
            ANTHROPIC_API_URL,
            data=json.dumps(payload).encode("utf-8"),
            headers=request_headers,
            method="POST",
        )

        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                response_body = response.read().decode("utf-8")
                self.send_response(response.status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(response_body.encode("utf-8"))
        except urllib.error.HTTPError as exc:
            error_body = exc.read().decode("utf-8", "ignore")
            self.send_response(exc.code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(error_body.encode("utf-8"))
        except Exception as exc:
            self.send_json({"error": str(exc)}, status=502)

    def serve_static(self, path):
        if not path:
            path = "ats-resume-checker.html"
        file_path = (ROOT / path).resolve()
        if not str(file_path).startswith(str(ROOT)):
            self.send_error(403)
            return
        if not file_path.exists() or file_path.is_dir():
            file_path = ROOT / "ats-resume-checker.html"

        try:
            content = file_path.read_bytes()
        except Exception:
            self.send_error(404)
            return

        mime = "text/html"
        if file_path.suffix == ".js":
            mime = "application/javascript"
        elif file_path.suffix == ".css":
            mime = "text/css"

        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(content)

    def send_json(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"Serving on http://0.0.0.0:{PORT} (open http://127.0.0.1:{PORT} locally)")
    if not ANTHROPIC_API_KEY:
        print("WARNING: ANTHROPIC_API_KEY is not set. /api/claude will return 500 until it is.")
    if AUTH_ENABLED:
        print(f"Basic Auth is ENABLED for {len(USERS)} user(s): {', '.join(USERS)}.")
    else:
        print("WARNING: ATS_USERS (or ATS_USERNAME/ATS_PASSWORD) not set — Basic Auth is DISABLED. Do not deploy publicly like this.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
