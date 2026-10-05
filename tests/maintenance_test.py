#!/usr/bin/env python3
"""End-to-end test of maintenance/bot.py against a fake Telegram Bot API server."""
import json, os, signal, subprocess, sys, tempfile, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = "123456:SECRET-TOKEN-abc"
NOTICE = "درود وقتتون بخیر، ربات درحال بروزرسانی  میباشد.\nلطفا برای خرید، تمدید و پیگیری سرویس ها به پشتیبانی پیام بدید :\n@pichanet_support"
calls, lock = [], threading.Lock()
faults = {"updates_502": 1, "updates_409": 1, "send429": 1}
updates = []


def msg(uid, chat, text="hi", ctype="private", user="u", **extra):
    m = {"message_id": uid, "chat": {"id": chat, "type": ctype}, "from": {"id": chat, "username": user, "language_code": "fa"}, "date": 1, "text": text}
    m.update(extra)
    return {"update_id": uid, "message": m}


updates += [
    msg(1, 100, "سلام خرید دارم", user="ali"),
    msg(2, 100, "جواب بده", user="ali"),                       # same chat -> cooldown
    msg(3, -500, "group", ctype="supergroup"),                  # group -> ignored
    {"update_id": 4, "callback_query": {"id": "cb1", "from": {"id": 101, "username": "sara"}, "message": {"message_id": 9, "chat": {"id": 101, "type": "private"}}, "data": "buy"}},
    {"update_id": 5, "message": {"message_id": 5, "chat": {"id": 102, "type": "private"}, "from": {"id": 102, "first_name": "Reza"}, "date": 1, "photo": [{}], "caption": "رسید"}},
    {"update_id": 6, "my_chat_member": {"chat": {"id": 103, "type": "private"}, "from": {"id": 103}, "new_chat_member": {"status": "kicked"}}},
    msg(7, 666, "blocked user"),                                # sendMessage -> 403
    msg(8, 777, "rate limited once"),                           # sendMessage -> 429 then ok
    msg(9, 888, "'=cmd|x'!A1 " + "x" * 200),                    # long/odd text must be truncated in logs
]


class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def reply(self, obj, code=200):
        b = json.dumps(obj).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0)); body = json.loads(self.rfile.read(n) or b"{}")
        parts = self.path.strip("/").split("/"); method = parts[1]
        if parts[0] != "bot" + TOKEN:
            return self.reply({"ok": False, "error_code": 401, "description": "Unauthorized"}, 401)
        with lock: calls.append((method, body))
        if method == "getMe": return self.reply({"ok": True, "result": {"id": 1, "username": "testbot", "first_name": "T"}})
        if method == "getWebhookInfo": return self.reply({"ok": True, "result": {"url": "https://old.example/index.php", "pending_update_count": 27, "last_error_message": "Connection timed out"}})
        if method in ("deleteWebhook", "answerCallbackQuery", "setWebhook"): return self.reply({"ok": True, "result": True})
        if method == "getUpdates":
            with lock:
                if faults["updates_502"] and body.get("offset"):
                    faults["updates_502"] -= 1; self.send_response(502); self.send_header("Content-Length", "3"); self.end_headers(); self.wfile.write(b"bad"); return
                if faults["updates_409"] and body.get("offset") and body["offset"] > 5:
                    faults["updates_409"] -= 1; return self.reply({"ok": False, "error_code": 409, "description": "Conflict: terminated by other getUpdates request"}, 409)
            off = body.get("offset") or 0
            out = [u for u in updates if u["update_id"] >= off][:4]
            if not out: time.sleep(0.4)
            return self.reply({"ok": True, "result": out})
        if method == "sendMessage":
            cid = body["chat_id"]
            if cid == 666: return self.reply({"ok": False, "error_code": 403, "description": "Forbidden: bot was blocked by the user"}, 403)
            with lock:
                if cid == 777 and faults["send429"]:
                    faults["send429"] -= 1; return self.reply({"ok": False, "error_code": 429, "description": "Too Many Requests", "parameters": {"retry_after": 1}}, 429)
            return self.reply({"ok": True, "result": {"message_id": 1000 + cid % 1000}})
        self.reply({"ok": False, "error_code": 404, "description": "no such method"}, 404)


srv = ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
tmp = tempfile.mkdtemp()
env = dict(os.environ, PICHA_BOT_TOKEN=TOKEN, PICHA_API_BASE="http://127.0.0.1:%d" % srv.server_port, PICHA_LOG_DIR=tmp + "/log", PICHA_STATE_DIR=tmp + "/state",
           PICHA_MESSAGE_FILE=tmp + "/none.txt", PICHA_POLL_TIMEOUT="1", PICHA_HEARTBEAT="2", PICHA_COOLDOWN="30", PICHA_CONFLICT_WAIT="1")
fails = 0
def check(name, cond, extra=""):
    global fails
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else "  -> %s" % extra)); fails += (not cond)

here = os.path.dirname(os.path.abspath(__file__)); bot = os.path.join(here, "..", "maintenance", "bot.py")

# --check diagnostics
r = subprocess.run([sys.executable, bot, "check"], env=env, capture_output=True, text=True)
check("check: READY with valid token", "RESULT: READY" in r.stdout and "token valid: @testbot" in r.stdout and "webhook currently set" in r.stdout, r.stdout)
r = subprocess.run([sys.executable, bot, "check"], env=dict(env, PICHA_BOT_TOKEN="bad"), capture_output=True, text=True)
check("check: bad token reports failure, exit 1", r.returncode == 1 and "Unauthorized" in r.stdout, r.stdout)

p = subprocess.Popen([sys.executable, bot, "run"], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
time.sleep(9)
p.send_signal(signal.SIGTERM)
try: out = p.communicate(timeout=10)[0]
except subprocess.TimeoutExpired: p.kill(); out = p.communicate()[0]
check("clean exit on SIGTERM (code 0)", p.returncode == 0, p.returncode)

sent = [(b["chat_id"], b["text"]) for m, b in calls if m == "sendMessage"]
chats = [c for c, _ in sent]
check("webhook removed at startup", any(m == "deleteWebhook" for m, _ in calls))
check("exact notice text sent", all(t == NOTICE for _, t in sent) and len(sent) >= 4, sent[:2])
check("replied to private msg (100) exactly once despite 2 messages", chats.count(100) == 1, chats)
check("callback query answered + replied (101)", any(m == "answerCallbackQuery" for m, _ in calls) and 101 in chats, chats)
check("photo message replied (102)", 102 in chats, chats)
check("group message ignored", -500 not in chats, chats)
check("429 retried then delivered (777)", chats.count(777) == 2, chats)  # first attempt 429 + retry ok
check("blocked user (666) handled without crash", 666 in chats and "blocked the bot" in out, out[-600:])
check("survived 502 + 409 on getUpdates", "network problem while polling" in out and "409 conflict" in out, out[-900:])
check("all updates consumed (offset advanced past 9)", any(m == "getUpdates" and b.get("offset") == 10 for m, b in calls))
check("token never appears in output", TOKEN not in out and "SECRET-TOKEN" not in out)
logf = open(tmp + "/log/bot.log", encoding="utf-8").read(); jl = open(tmp + "/log/messages.jsonl", encoding="utf-8").read()
check("token never appears in log files", TOKEN not in logf and TOKEN not in jl)
check("log has user, chat, outcome", "user=@ali(100)" in logf and "replied message_id=" in logf and "skipped (replied" in logf, logf[:600])
check("long text truncated in logs", "x" * 100 not in logf and "…" in logf)
check("heartbeat logged", "heartbeat:" in logf)
events = [json.loads(l) for l in jl.splitlines()]
check("jsonl audit trail has actions", {"replied", "cooldown", "ignored_not_private", "reply_failed"} <= {e.get("action") for e in events}, {e.get("action") for e in events})
st = json.load(open(tmp + "/state/chats.json"))
check("state persisted (chats served)", {"100", "101", "102", "777"} <= set(st) and st["666"].get("blocked"), list(st))

# restart: backlog must not be re-sent because cooldown state persisted
calls.clear(); faults.update(updates_502=0, updates_409=0, send429=0)
p = subprocess.Popen([sys.executable, bot, "run"], env=dict(env, PICHA_COOLDOWN="3600"), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
time.sleep(4); p.send_signal(signal.SIGTERM); out2 = p.communicate(timeout=10)[0]
check("after restart: no duplicate notices to already-served chats", [b["chat_id"] for m, b in calls if m == "sendMessage"].count(100) == 0, [b["chat_id"] for m, b in calls if m == "sendMessage"])

# bad token exits with code 2 (systemd must not loop)
p = subprocess.run([sys.executable, bot, "run"], env=dict(env, PICHA_BOT_TOKEN="wrong"), capture_output=True, text=True, timeout=20)
check("revoked/invalid token -> exit code 2", p.returncode == 2, (p.returncode, p.stdout[-300:]))
# unreachable network: keeps retrying (does not crash)
p = subprocess.Popen([sys.executable, bot, "run"], env=dict(env, PICHA_API_BASE="http://127.0.0.1:9"), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
time.sleep(3); alive = p.poll() is None; p.send_signal(signal.SIGTERM); o3 = p.communicate(timeout=10)[0]
check("no network: stays alive and logs retries", alive and "cannot reach Telegram" in o3, o3[-300:])
print("\nFAILED:", fails); sys.exit(1 if fails else 0)
