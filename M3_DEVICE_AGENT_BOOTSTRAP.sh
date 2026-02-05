#!/usr/bin/env bash
#
# M3 Device Agent Bootstrap Script
# Purpose: M1で生成した成果物をM3で自動的にopen/notify/reveal
#
# Usage: bash M3_DEVICE_AGENT_BOOTSTRAP.sh
#
# This script must be run on M3 (user's main workstation)
#

set -euo pipefail

PORT=18711
DIR="$HOME/.jarvis/device-agent"

echo "🚀 M3 Device Agent Bootstrap"
echo "============================"
echo ""

# 1. Create directory
echo "📁 Creating directory: $DIR"
mkdir -p "$DIR"

# 2. Generate secure token
echo "🔐 Generating secure token..."
TOKEN="$(python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(32))
PY
)"
printf "%s" "$TOKEN" > "$DIR/token"
echo "✅ Token generated and saved to $DIR/token"

# 3. Create Device Agent Python script
echo "📝 Creating Device Agent Python script..."
cat > "$DIR/agent.py" <<'PY'
#!/usr/bin/env python3
"""
M3 Device Agent
Purpose: Receive commands from M1 (Jarvis) and execute on M3
- /open: Open file/URL
- /reveal: Reveal file in Finder
- /notify: Show macOS notification
"""
import argparse, json, os, secrets, subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

def read_token(p):
    with open(p, "r") as f:
        return f.read().strip()

class H(BaseHTTPRequestHandler):
    token = None

    def _ok(self, code=200, obj=None):
        self.send_response(code)
        self.send_header("Content-Type","application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(json.dumps(obj or {"ok": True}, ensure_ascii=False).encode("utf-8"))

    def _bad(self, code, msg):
        self._ok(code, {"ok": False, "error": msg})

    def _auth(self):
        q = parse_qs(urlparse(self.path).query)
        t = (q.get("token",[None])[0] or "")
        ah = self.headers.get("Authorization","")
        if ah.lower().startswith("bearer "):
            t = ah.split(" ",1)[1].strip()
        return secrets.compare_digest(t, self.token or "")

    def do_GET(self):
        if self.path.startswith("/healthz"):
            if not self._auth(): return self._bad(401,"unauthorized")
            return self._ok(200, {"ok": True, "status":"healthy"})
        return self._bad(404,"not_found")

    def do_POST(self):
        if not self._auth(): return self._bad(401,"unauthorized")
        length = int(self.headers.get("Content-Length","0") or "0")
        body = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(body.decode("utf-8") or "{}")
        except Exception:
            return self._bad(400,"invalid_json")

        path = urlparse(self.path).path

        if path == "/open":
            target = data.get("path") or data.get("url")
            if not target: return self._bad(400,"missing path/url")
            cmd = ["open", target]
            if data.get("app"):
                cmd = ["open","-a", str(data["app"]), target]
            subprocess.Popen(cmd)
            return self._ok(200, {"ok": True, "opened": target})

        if path == "/reveal":
            target = data.get("path")
            if not target: return self._bad(400,"missing path")
            subprocess.Popen(["open","-R", target])
            return self._ok(200, {"ok": True, "revealed": target})

        if path == "/notify":
            title = str(data.get("title","Jarvis"))
            text  = str(data.get("text",""))
            script = f'display notification "{text}" with title "{title}"'
            subprocess.Popen(["osascript","-e", script])
            return self._ok(200, {"ok": True, "notified": True})

        return self._bad(404,"not_found")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=18711)
    ap.add_argument("--token-file", required=True)
    args = ap.parse_args()
    H.token = read_token(args.token_file)
    httpd = HTTPServer((args.host, args.port), H)
    print(f"[M3 Device Agent] Listening on {args.host}:{args.port}")
    httpd.serve_forever()

if __name__ == "__main__":
    main()
PY

chmod +x "$DIR/agent.py"
echo "✅ Device Agent script created"

# 4. Get Python binary path
PYBIN="$(command -v python3)"
echo "🐍 Python binary: $PYBIN"

# 5. Create LaunchAgent plist
PLIST="$HOME/Library/LaunchAgents/com.jarvis.device-agent.plist"
echo "📄 Creating LaunchAgent plist: $PLIST"

cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.jarvis.device-agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>$PYBIN</string>
    <string>$DIR/agent.py</string>
    <string>--host</string><string>0.0.0.0</string>
    <string>--port</string><string>$PORT</string>
    <string>--token-file</string><string>$DIR/token</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DIR/stdout.log</string>
  <key>StandardErrorPath</key><string>$DIR/stderr.log</string>
</dict></plist>
PL

echo "✅ LaunchAgent plist created"

# 6. Load LaunchAgent
echo "🔄 Loading LaunchAgent..."
launchctl unload "$PLIST" >/dev/null 2>&1 || true
launchctl load "$PLIST"
launchctl kickstart -k "gui/$UID/com.jarvis.device-agent" >/dev/null 2>&1 || true
sleep 2
echo "✅ LaunchAgent loaded"

# 7. Get M3 hostname
HOST="$(scutil --get LocalHostName).local"
echo "🖥️  M3 hostname: $HOST"

# 8. Output connection info
echo ""
echo "✅ =============================="
echo "✅ M3 Device Agent Setup Complete"
echo "✅ =============================="
echo ""
echo "📋 Copy these values and send to Jarvis:"
echo ""
echo "M3_AGENT_URL=http://$HOST:$PORT"
echo "M3_AGENT_TOKEN=$TOKEN"
echo ""

# 9. Health check
echo "🏥 Running health check..."
if curl -fsS "http://$HOST:$PORT/healthz?token=$TOKEN" >/dev/null 2>&1; then
    echo "M3_AGENT_HEALTH=OK"
    echo ""
    echo "✅ Health check passed!"
else
    echo "M3_AGENT_HEALTH=FAILED"
    echo ""
    echo "⚠️  Health check failed. Please check logs:"
    echo "   - stdout: $DIR/stdout.log"
    echo "   - stderr: $DIR/stderr.log"
fi

echo ""
echo "📖 Next steps:"
echo "   1. Copy the M3_AGENT_URL and M3_AGENT_TOKEN above"
echo "   2. Send them to Jarvis via Telegram"
echo "   3. Jarvis will update .env and start using M3 Device Agent"
