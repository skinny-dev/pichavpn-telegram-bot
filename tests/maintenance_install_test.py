#!/usr/bin/env python3
"""Runs maintenance/install.sh + picha-maint inside a throwaway root (PICHA_ROOT) against a fake Telegram API."""
import json, os, subprocess, tempfile, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = "123456789:AAFakeTokenForTesting_abcdefghij"
sent = []

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        m = self.path.split("/")[-1]
        ok = self.path.startswith("/bot" + TOKEN + "/")
        res = {"getMe": {"id": 9, "username": "pichanet_bot", "first_name": "Picha"}, "getWebhookInfo": {"url": "https://old/x", "pending_update_count": 3},
               "sendMessage": {"message_id": 55}, "setWebhook": True}.get(m, True)
        if m == "sendMessage": sent.append(body)
        out = json.dumps({"ok": True, "result": res} if ok else {"ok": False, "error_code": 401, "description": "Unauthorized"}).encode()
        self.send_response(200 if ok else 401); self.send_header("Content-Length", str(len(out))); self.end_headers(); self.wfile.write(out)

srv = ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
root = tempfile.mkdtemp(); here = os.path.dirname(os.path.abspath(__file__)); mdir = os.path.join(here, "..", "maintenance")
env = dict(os.environ, PICHA_ROOT=root, PICHA_API_BASE="http://127.0.0.1:%d" % srv.server_port)
fails = 0
def check(n, c, x=""):
    global fails; print(("PASS " if c else "FAIL ") + n + ("" if c else "  -> %s" % x)); fails += (not c)
def run(cmd, **kw): return subprocess.run(cmd, env=dict(env, **kw.pop("env", {})), capture_output=True, text=True, stdin=subprocess.DEVNULL, **kw)

r = run(["bash", mdir + "/install.sh", "--token", "garbage", "--yes"])
check("rejects malformed token", r.returncode != 0 and "does not look like a bot token" in r.stderr, r.stderr)
r = run(["bash", mdir + "/install.sh", "--token", "123456789:AAWrongTokenWrongToken_abcdefg", "--yes"])
check("rejects token Telegram refuses", r.returncode != 0 and "rejected" in r.stderr, r.stdout[-300:] + r.stderr)
check("rejected token leaves no token file and no unit", not os.path.exists(root + "/etc/picha-maintenance.env") and not os.path.exists(root + "/etc/systemd/system/picha-maintenance.service"))
r = run(["bash", mdir + "/install.sh", "--token", TOKEN, "--yes"])
check("install succeeds", r.returncode == 0 and "Maintenance bot is live" in r.stdout, r.stdout[-500:] + r.stderr)
check("check step shows @pichanet_bot + webhook warning", "@pichanet_bot" in r.stdout and "webhook currently set" in r.stdout, r.stdout)
env_file = root + "/etc/picha-maintenance.env"
check("token file is mode 600 and has token", oct(os.stat(env_file).st_mode)[-3:] == "600" and TOKEN in open(env_file).read())
unit = open(root + "/etc/systemd/system/picha-maintenance.service").read()
check("unit restarts always, not on bad token, unprivileged, hardened", "Restart=always" in unit and "RestartPreventExitStatus=2" in unit and "User=picha-maint" in unit and "ProtectSystem=strict" in unit and TOKEN not in unit)
check("message.txt installed with exact notice", open(root + "/opt/picha-maintenance/message.txt", encoding="utf-8").read().strip().endswith("@pichanet_support"))
pm = root + "/usr/local/bin/picha-maint"
stray = tempfile.mkdtemp(); open(stray + "/bot.py", "w").write("# stray picha-maintenance file\nraise SystemExit('WRONG FILE USED')\n")
r = subprocess.run(["bash", "-s", "--", "--token", TOKEN, "--yes"], input=open(mdir + "/install.sh").read(), env=dict(env, PICHA_RAW_BASE="file://" + os.path.abspath(mdir)), cwd=stray, capture_output=True, text=True)
check("piped install ignores stray bot.py in cwd (downloads instead)", "WRONG FILE" not in r.stdout + r.stderr and "Maintenance bot is live" in r.stdout, r.stdout[-300:] + r.stderr[-300:])
r = run([pm, "check"]); check("picha-maint check READY", "RESULT: READY" in r.stdout, r.stdout)
r = run([pm, "test", "4242"]); check("picha-maint test sends the notice", r.returncode == 0 and sent and sent[-1]["chat_id"] == "4242" and "@pichanet_support" in sent[-1]["text"], (r.stdout, sent))
r = run([pm, "test"]); check("picha-maint test without id prints usage", "usage" in r.stdout)
r = run([pm, "status"]); check("picha-maint status works with no logs yet", r.returncode == 0 and "chats served" in r.stdout, r.stdout + r.stderr)
r = run([pm, "show"]); check("picha-maint show prints notice", "درود" in r.stdout)
r = run([pm, "webhook", "https://example.com/index.php"]); check("picha-maint webhook", "webhook set" in r.stdout, r.stdout)
r = run([pm]); check("help text", "status" in r.stdout and "uninstall" in r.stdout)
r = run(["bash", mdir + "/install.sh", "--token", TOKEN, "--yes"]); check("re-running installer is idempotent", r.returncode == 0, r.stderr)
print("\nFAILED:", fails); raise SystemExit(1 if fails else 0)
