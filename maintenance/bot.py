#!/usr/bin/env python3
"""Picha maintenance bot: answers every private message with a fixed notice.

Long polling, standard library only (Python 3.8+). Needs outbound HTTPS to api.telegram.org
and nothing else: no domain, no SSL, no web server, no open ports.

Commands:  run (default) | check | stats | test CHAT_ID | webhook URL | version
Config (environment, normally /etc/picha-maintenance.env):
  PICHA_BOT_TOKEN   bot token (required)
  PICHA_MESSAGE_FILE  text file with the notice (default: message.txt next to this script, else built-in text)
  PICHA_LOG_DIR     default /var/log/picha-maintenance   (bot.log + messages.jsonl, rotated)
  PICHA_STATE_DIR   default /var/lib/picha-maintenance   (chats.json: who was served)
  PICHA_COOLDOWN    seconds between replies to the same chat, default 10
  PICHA_HEARTBEAT   seconds between status lines, default 300
  PICHA_LOG_LEVEL   DEBUG | INFO | WARNING, default INFO
  PICHA_CONFLICT_WAIT seconds to wait after a 409 conflict, default 15
  PICHA_LOG_TEXT    1 = log first 60 chars of user messages (default), 0 = never log message text
  PICHA_API_BASE    default https://api.telegram.org (tests override this)
"""
import json
import logging
import logging.handlers
import os
import signal
import socket
import sys
import time
import traceback
import urllib.error
import urllib.request

VERSION = "1.0.0"

DEFAULT_MESSAGE = (
    "درود وقتتون بخیر، ربات درحال بروزرسانی  میباشد.\n"
    "لطفا برای خرید، تمدید و پیگیری سرویس ها به پشتیبانی پیام بدید :\n"
    "@pichanet_support"
)

HERE = os.path.dirname(os.path.abspath(__file__))


def env(name, default=""):
    return os.environ.get(name, default).strip()


TOKEN = env("PICHA_BOT_TOKEN")
API_BASE = env("PICHA_API_BASE", "https://api.telegram.org").rstrip("/")
LOG_DIR = env("PICHA_LOG_DIR", "/var/log/picha-maintenance")
STATE_DIR = env("PICHA_STATE_DIR", "/var/lib/picha-maintenance")
MESSAGE_FILE = env("PICHA_MESSAGE_FILE", os.path.join(HERE, "message.txt"))
COOLDOWN = float(env("PICHA_COOLDOWN", "10"))
HEARTBEAT = float(env("PICHA_HEARTBEAT", "300"))
POLL_TIMEOUT = int(env("PICHA_POLL_TIMEOUT", "50"))
CONFLICT_WAIT = float(env("PICHA_CONFLICT_WAIT", "15"))
LOG_TEXT = env("PICHA_LOG_TEXT", "1") != "0"
LOG_LEVEL = env("PICHA_LOG_LEVEL", "INFO").upper()

log = logging.getLogger("picha")


class TokenMask(logging.Filter):
    """Never let the bot token reach a log file, even inside an exception message."""

    def filter(self, record):
        if TOKEN:
            record.msg = str(record.msg).replace(TOKEN, "<token>")
            if record.args:
                record.args = tuple(str(a).replace(TOKEN, "<token>") if isinstance(a, str) else a for a in record.args)
        return True


def setup_logging(console=True):
    log.setLevel(getattr(logging, LOG_LEVEL, logging.INFO))
    log.handlers.clear()
    fmt = logging.Formatter("%(asctime)s %(levelname)-7s %(message)s", "%Y-%m-%d %H:%M:%S")
    flt = TokenMask()
    if console:
        h = logging.StreamHandler(sys.stdout)
        h.setFormatter(fmt)
        h.addFilter(flt)
        log.addHandler(h)
    try:
        os.makedirs(LOG_DIR, exist_ok=True)
        fh = logging.handlers.RotatingFileHandler(os.path.join(LOG_DIR, "bot.log"), maxBytes=5_000_000, backupCount=5, encoding="utf-8")
        fh.setFormatter(fmt)
        fh.addFilter(flt)
        log.addHandler(fh)
    except OSError as e:
        log.warning("cannot write log files in %s (%s); logging to console only", LOG_DIR, e)


_jsonl = None


def jsonl(event):
    """Machine-readable audit trail: one JSON object per handled update."""
    global _jsonl
    try:
        if _jsonl is None:
            os.makedirs(LOG_DIR, exist_ok=True)
            _jsonl = logging.handlers.RotatingFileHandler(os.path.join(LOG_DIR, "messages.jsonl"), maxBytes=10_000_000, backupCount=5, encoding="utf-8")
            _jsonl.setFormatter(logging.Formatter("%(message)s"))
        event = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"), **event}
        _jsonl.emit(logging.LogRecord("jsonl", logging.INFO, "", 0, json.dumps(event, ensure_ascii=False), None, None))
    except Exception:  # logging must never break the bot
        pass


class TelegramError(Exception):
    def __init__(self, method, code, description, retry_after=0):
        super().__init__("%s failed: %s %s" % (method, code, description))
        self.method, self.code, self.description, self.retry_after = method, code, description, retry_after


class NetworkError(Exception):
    pass


def call(method, params=None, timeout=15):
    """POST to the Bot API. Raises TelegramError (API said no) or NetworkError (couldn't reach it)."""
    data = json.dumps(params or {}).encode()
    req = urllib.request.Request("%s/bot%s/%s" % (API_BASE, TOKEN, method), data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read().decode("utf-8"))
        except Exception:
            raise NetworkError("%s: HTTP %s" % (method, e.code))
    except (urllib.error.URLError, socket.timeout, ConnectionError, OSError) as e:
        raise NetworkError("%s: %s" % (method, getattr(e, "reason", e)))
    except ValueError:
        raise NetworkError("%s: invalid JSON from server" % method)
    if not body.get("ok"):
        raise TelegramError(method, body.get("error_code"), body.get("description"), (body.get("parameters") or {}).get("retry_after", 0))
    return body["result"]


def load_message():
    try:
        with open(MESSAGE_FILE, encoding="utf-8") as f:
            text = f.read().strip()
        if text:
            return text
        log.warning("message file %s is empty; using built-in text", MESSAGE_FILE)
    except FileNotFoundError:
        pass
    except OSError as e:
        log.warning("cannot read message file %s: %s; using built-in text", MESSAGE_FILE, e)
    return DEFAULT_MESSAGE


class State:
    """Remembers who was served (survives restarts, so a restart never re-spams the backlog)."""

    def __init__(self):
        self.path = os.path.join(STATE_DIR, "chats.json")
        self.chats = {}
        self.dirty = False
        self.counters = {"updates": 0, "replies": 0, "cooldown": 0, "ignored": 0, "errors": 0, "blocked": 0}
        try:
            with open(self.path, encoding="utf-8") as f:
                self.chats = json.load(f)
        except FileNotFoundError:
            pass
        except Exception as e:
            log.warning("could not read %s (%s); starting with empty state", self.path, e)

    def last_reply(self, chat):
        return self.chats.get(str(chat), {}).get("last_reply", 0)

    def served(self, chat, user):
        c = self.chats.setdefault(str(chat), {"first_seen": int(time.time()), "replies": 0})
        c.update(last_reply=time.time(), replies=c.get("replies", 0) + 1, user=user)
        self.dirty = True

    def mark_blocked(self, chat):
        self.chats.setdefault(str(chat), {"first_seen": int(time.time()), "replies": 0})["blocked"] = True
        self.dirty = True

    def save(self):
        if not self.dirty:
            return
        try:
            os.makedirs(STATE_DIR, exist_ok=True)
            tmp = self.path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self.chats, f, ensure_ascii=False)
            os.replace(tmp, self.path)
            self.dirty = False
        except OSError as e:
            log.warning("could not save state to %s: %s", self.path, e)


def who(msg_from):
    if not msg_from:
        return "unknown"
    name = ("@" + msg_from["username"]) if msg_from.get("username") else (msg_from.get("first_name") or "?")
    return "%s(%s)" % (name, msg_from.get("id"))


def excerpt(text):
    if not LOG_TEXT or not text:
        return ""
    t = " ".join(text.split())
    return t[:60] + ("…" if len(t) > 60 else "")


def send_notice(chat_id, text):
    """Send with one retry on 429. Returns message id."""
    for attempt in (1, 2):
        try:
            return call("sendMessage", {"chat_id": chat_id, "text": text, "disable_web_page_preview": True})["message_id"]
        except TelegramError as e:
            if e.code == 429 and attempt == 1:
                wait = min(max(e.retry_after, 1), 30)
                log.warning("rate limited by Telegram, waiting %ss", wait)
                time.sleep(wait)
                continue
            raise


def handle_update(upd, state, text):
    state.counters["updates"] += 1
    uid = upd.get("update_id")
    kind = next((k for k in upd if k != "update_id"), "unknown")
    msg = upd.get("message") or (upd.get("callback_query") or {}).get("message")
    frm = (upd.get("message") or upd.get("callback_query") or {}).get("from")
    t0 = time.time()

    if "callback_query" in upd:
        try:  # stop the loading spinner on the user's button
            call("answerCallbackQuery", {"callback_query_id": upd["callback_query"]["id"]})
        except (TelegramError, NetworkError) as e:
            log.debug("answerCallbackQuery failed: %s", e)

    if kind in ("my_chat_member", "chat_member"):
        m = upd[kind]
        log.info("update=%s %s chat=%s user=%s status=%s", uid, kind, m.get("chat", {}).get("id"), who(m.get("from")), (m.get("new_chat_member") or {}).get("status"))
        jsonl({"update": uid, "kind": kind, "action": "logged"})
        return
    if not msg:
        state.counters["ignored"] += 1
        log.info("update=%s kind=%s ignored (no message)", uid, kind)
        jsonl({"update": uid, "kind": kind, "action": "ignored"})
        return

    chat = msg["chat"]
    chat_id = chat["id"]
    preview = excerpt((upd.get("message") or {}).get("text") or (upd.get("message") or {}).get("caption") or "")
    base = {"update": uid, "kind": kind, "chat": chat_id, "chat_type": chat.get("type"), "user": who(frm), "lang": (frm or {}).get("language_code")}

    if chat.get("type") != "private":
        state.counters["ignored"] += 1
        log.info("update=%s %s chat=%s type=%s user=%s ignored (not a private chat)", uid, kind, chat_id, chat.get("type"), who(frm))
        jsonl({**base, "action": "ignored_not_private"})
        return

    since = time.time() - state.last_reply(chat_id)
    if since < COOLDOWN:
        state.counters["cooldown"] += 1
        log.info("update=%s %s chat=%s user=%s text=%r skipped (replied %.0fs ago, cooldown %.0fs)", uid, kind, chat_id, who(frm), preview, since, COOLDOWN)
        jsonl({**base, "action": "cooldown", "text": preview})
        return

    try:
        mid = send_notice(chat_id, text)
    except TelegramError as e:
        state.counters["errors"] += 1
        if e.code == 403:
            state.counters["blocked"] += 1
            state.mark_blocked(chat_id)
            log.warning("update=%s chat=%s user=%s cannot reply: %s (user blocked the bot or deleted the chat)", uid, chat_id, who(frm), e.description)
        else:
            log.error("update=%s chat=%s user=%s reply failed: %s", uid, chat_id, who(frm), e)
        jsonl({**base, "action": "reply_failed", "error": "%s %s" % (e.code, e.description)})
        return
    ms = int((time.time() - t0) * 1000)
    state.counters["replies"] += 1
    state.served(chat_id, who(frm))
    log.info("update=%s %s chat=%s user=%s text=%r -> replied message_id=%s in %dms", uid, kind, chat_id, who(frm), preview, mid, ms)
    jsonl({**base, "action": "replied", "text": preview, "message_id": mid, "ms": ms})


class Stop(Exception):
    pass


_stop = False


def _sig(signum, _frame):
    global _stop
    _stop = True
    log.info("received signal %s, shutting down after the current request", signum)


def run():
    setup_logging()
    if not TOKEN:
        log.error("PICHA_BOT_TOKEN is not set. Put it in /etc/picha-maintenance.env")
        return 2
    signal.signal(signal.SIGTERM, _sig)
    signal.signal(signal.SIGINT, _sig)

    log.info("picha-maintenance %s starting (python %s, pid %s)", VERSION, sys.version.split()[0], os.getpid())
    log.info("config: api=%s cooldown=%ss poll_timeout=%ss log_dir=%s state_dir=%s message_file=%s", API_BASE, COOLDOWN, POLL_TIMEOUT, LOG_DIR, STATE_DIR, MESSAGE_FILE)

    backoff = 1
    while not _stop:  # wait until Telegram is reachable instead of dying (server may still be booting)
        try:
            me = call("getMe")
            break
        except NetworkError as e:
            log.warning("cannot reach Telegram (%s); retrying in %ss", e, backoff)
            time.sleep(backoff)
            backoff = min(backoff * 2, 60)
        except TelegramError as e:
            if e.code == 401:
                log.error("Telegram rejected the token (401 Unauthorized). Was it revoked in @BotFather? Fix with: picha-maint set-token")
                return 2
            log.error("getMe failed: %s", e)
            time.sleep(10)
    if _stop:
        return 0
    log.info("authenticated as @%s (id %s)", me.get("username"), me.get("id"))

    try:
        wh = call("getWebhookInfo")
        if wh.get("url"):
            log.warning("a webhook is set (%s, pending=%s, last_error=%r): removing it so polling works. To go back to the real bot later run its table.php / setWebhook", wh["url"], wh.get("pending_update_count"), wh.get("last_error_message"))
            call("deleteWebhook", {"drop_pending_updates": False})
            log.info("webhook removed")
        else:
            log.info("no webhook set (good)")
    except (TelegramError, NetworkError) as e:
        log.error("could not check/remove webhook: %s", e)

    state = State()
    text = load_message()
    log.info("notice text (%d chars): %s", len(text), text.replace("\n", " | "))
    log.info("known chats from earlier runs: %d", len(state.chats))

    offset = None
    started = last_beat = last_save = time.time()
    last_msg_reload = time.time()
    backoff = 1
    first_batch = True
    while not _stop:
        try:
            ups = call("getUpdates", {"offset": offset, "timeout": POLL_TIMEOUT, "allowed_updates": ["message", "callback_query", "my_chat_member"]}, timeout=POLL_TIMEOUT + 15)
            backoff = 1
        except NetworkError as e:
            state.counters["errors"] += 1
            log.warning("network problem while polling: %s; retrying in %ss", e, backoff)
            time.sleep(backoff)
            backoff = min(backoff * 2, 60)
            continue
        except TelegramError as e:
            state.counters["errors"] += 1
            if e.code == 401:
                log.error("token rejected (401). Exiting; fix with: picha-maint set-token")
                return 2
            if e.code == 409:
                log.error("409 conflict: another process is polling this bot, or a webhook got set again (%s). Retrying in %ss. Check: picha-maint check", e.description, CONFLICT_WAIT)
                try:
                    call("deleteWebhook", {"drop_pending_updates": False})
                except Exception:
                    pass
                time.sleep(CONFLICT_WAIT)
                continue
            if e.code == 429:
                time.sleep(min(max(e.retry_after, 1), 60))
                continue
            log.error("getUpdates failed: %s; retrying in %ss", e, backoff)
            time.sleep(backoff)
            backoff = min(backoff * 2, 60)
            continue

        if ups and first_batch:
            log.info("processing backlog of %d update(s) received while the bot was offline", len(ups))
        first_batch = False
        for upd in ups:
            offset = upd["update_id"] + 1  # advance first: a bad update must never be retried forever
            try:
                handle_update(upd, state, text)
            except Exception:
                state.counters["errors"] += 1
                log.error("unexpected error handling update %s:\n%s", upd.get("update_id"), traceback.format_exc())

        now = time.time()
        if now - last_save > 30:
            state.save()
            last_save = now
        if now - last_msg_reload > 60:  # edit message.txt without restarting
            new = load_message()
            if new != text:
                text = new
                log.info("notice text reloaded from %s (%d chars)", MESSAGE_FILE, len(text))
            last_msg_reload = now
        if now - last_beat >= HEARTBEAT:
            c = state.counters
            log.info("heartbeat: up %s | updates=%d replies=%d cooldown=%d ignored=%d blocked=%d errors=%d | chats served=%d", fmt_dur(now - started), c["updates"], c["replies"], c["cooldown"], c["ignored"], c["blocked"], c["errors"], len(state.chats))
            last_beat = now

    state.save()
    log.info("stopped cleanly. totals: %s", json.dumps(state.counters))
    return 0


def fmt_dur(s):
    s = int(s)
    d, s = divmod(s, 86400)
    h, s = divmod(s, 3600)
    m, s = divmod(s, 60)
    return ("%dd" % d if d else "") + ("%dh" % h if h or d else "") + "%dm" % m


def resolve(host):
    out = {}
    for fam, name in ((socket.AF_INET, "IPv4"), (socket.AF_INET6, "IPv6")):
        try:
            out[name] = sorted({a[4][0] for a in socket.getaddrinfo(host, 443, fam, socket.SOCK_STREAM)})
        except socket.gaierror:
            out[name] = []
    return out


def connect_ok(host, fam):
    try:
        info = socket.getaddrinfo(host, 443, fam, socket.SOCK_STREAM)
        s = socket.socket(fam, socket.SOCK_STREAM)
        s.settimeout(6)
        s.connect(info[0][4])
        s.close()
        return True
    except Exception:
        return False


def check():
    """Human-readable diagnostics. Exit code 0 only if the bot can run."""
    ok = True

    def line(good, text):
        nonlocal ok
        ok = ok and good
        print(("  [ OK ] " if good else "  [FAIL] ") + text)

    print("picha-maintenance %s  python %s" % (VERSION, sys.version.split()[0]))
    line(bool(TOKEN), "token is set" if TOKEN else "PICHA_BOT_TOKEN is not set")
    host = API_BASE.split("//")[-1].split("/")[0]
    if host == "api.telegram.org":
        ips = resolve(host)
        print("  DNS %s: v4=%s v6=%s" % (host, ",".join(ips["IPv4"]) or "none", ",".join(ips["IPv6"]) or "none"))
        v4, v6 = connect_ok(host, socket.AF_INET), connect_ok(host, socket.AF_INET6)
        line(v4 or v6, "can open a connection to %s:443 (IPv4=%s IPv6=%s)" % (host, "yes" if v4 else "no", "yes" if v6 else "no"))
        if not (v4 or v6):
            print("         -> the server has no outbound internet to Telegram (firewall? IPv6-only without NAT64? provider blocks Telegram?)")
    me = None
    if TOKEN:
        try:
            me = call("getMe", timeout=15)
            line(True, "token valid: @%s (%s)" % (me.get("username"), me.get("first_name")))
        except TelegramError as e:
            line(False, "Telegram says: %s" % e)
        except NetworkError as e:
            line(False, "cannot reach Telegram API: %s" % e)
    if me:
        try:
            wh = call("getWebhookInfo")
            if wh.get("url"):
                print("  [INFO] webhook currently set to %s (pending=%s, last_error=%r)" % (wh["url"], wh.get("pending_update_count"), wh.get("last_error_message")))
                print("         -> running the service REMOVES this webhook (so polling works). Restore the real bot later via its table.php")
            else:
                print("  [ OK ] no webhook set (polling will work)")
        except (TelegramError, NetworkError) as e:
            line(False, "getWebhookInfo: %s" % e)
    for d, label in ((LOG_DIR, "log dir"), (STATE_DIR, "state dir")):
        try:
            os.makedirs(d, exist_ok=True)
            t = os.path.join(d, ".w")
            open(t, "w").close()
            os.remove(t)
            line(True, "%s writable: %s" % (label, d))
        except OSError as e:
            line(False, "%s not writable: %s (%s)" % (label, d, e))
    msg = load_message()
    print("  notice text (%d chars):" % len(msg))
    for ln in msg.splitlines():
        print("      " + ln)
    print("RESULT: %s" % ("READY" if ok else "PROBLEMS FOUND"))
    return 0 if ok else 1


def stats():
    st = State()
    total = len(st.chats)
    blocked = sum(1 for c in st.chats.values() if c.get("blocked"))
    replies = sum(c.get("replies", 0) for c in st.chats.values())
    day = time.time() - 86400
    today = sum(1 for c in st.chats.values() if c.get("last_reply", 0) > day)
    print("chats served (all time): %d" % total)
    print("  active in last 24h:   %d" % today)
    print("  blocked the bot:      %d" % blocked)
    print("notice messages sent:   %d" % replies)
    recent = sorted(st.chats.items(), key=lambda kv: kv[1].get("last_reply", 0), reverse=True)[:10]
    if recent:
        print("most recent:")
        for cid, c in recent:
            print("  %s  %-24s  %s" % (time.strftime("%Y-%m-%d %H:%M", time.localtime(c.get("last_reply", 0))), c.get("user", "?"), cid))
    return 0


def main(argv):
    cmd = argv[1] if len(argv) > 1 else "run"
    if cmd == "run":
        return run()
    if cmd == "check":
        setup_logging(console=False)
        return check()
    if cmd == "stats":
        return stats()
    if cmd == "version":
        print(VERSION)
        return 0
    if cmd == "test" and len(argv) > 2:
        setup_logging()
        try:
            mid = send_notice(argv[2], load_message())
            print("sent test notice to %s (message_id %s)" % (argv[2], mid))
            return 0
        except (TelegramError, NetworkError) as e:
            print("failed: %s" % e)
            return 1
    if cmd == "webhook" and len(argv) > 2:
        setup_logging()
        try:
            call("setWebhook", {"url": argv[2], "drop_pending_updates": False})
            print("webhook set to %s" % argv[2])
            return 0
        except (TelegramError, NetworkError) as e:
            print("failed: %s" % e)
            return 1
    print(__doc__)
    return 64


if __name__ == "__main__":
    sys.exit(main(sys.argv))
