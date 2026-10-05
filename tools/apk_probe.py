#!/usr/bin/env python3
"""Reads an Android APK LOCALLY and prints a redacted summary of how it talks to a server.

    python apk_probe.py mirza-forwarding-app.apk

Standard library only (Python 3.7+). Nothing is uploaded or executed. The report is written next to the APK
(apk_probe_report.txt) and printed. Anything that looks like a secret (tokens, keys, long random strings,
query values for key/token/secret/password) is masked, so the report is safe to paste into a chat.
"""
import hashlib
import os
import re
import sys
import zipfile

MAX_SCAN = 40 * 1024 * 1024  # bytes read per file

KEYWORDS = re.compile(
    r"(sms|message|sender|body|text|amount|price|bank|card|payment|notification|notif|forward|webhook|callback|sync|"
    r"device|secret|token|apikey|api_key|auth|bearer|signature|hmac|sign|timestamp|mirza|invoice|order|verify|confirm|"
    r"retry|queue|post|json|content-type|authorization|x-[a-z-]+)", re.I)
SECRETISH_KEY = re.compile(r"(key|token|secret|pass|pwd|sign|auth|hash|code)", re.I)


def ascii_runs(data, min_len=5):
    for m in re.finditer(rb"[\x20-\x7e]{%d,}" % min_len, data):
        yield m.group().decode("ascii", "ignore")


def utf16_runs(data, min_len=5):
    for m in re.finditer(rb"(?:[\x20-\x7e]\x00){%d,}" % min_len, data):
        yield m.group().decode("utf-16le", "ignore")


def utf8_persian_runs(data):
    # Persian / Arabic text stored as UTF-8 (Android resources and dex strings)
    for m in re.finditer(rb"(?:[\xd8-\xdb][\x80-\xbf]|[\x20-\x7e]){4,}", data):
        t = m.group().decode("utf-8", "ignore")
        if len(re.findall(r"[\u0600-\u06ff]", t)) >= 2:
            yield t


def mask_token(s):
    return s[:4] + "…" + "<%d chars>" % len(s)


def mask(s):
    """Hide anything that looks like a secret, keep the structure readable."""
    # query/form values for secret-like names
    s = re.sub(r"((?:[?&;]|^)([A-Za-z_\-]*(?:key|token|secret|pass|pwd|sign|auth|hash|code)[A-Za-z_\-]*)=)([^&\s\"']+)",
               lambda m: m.group(1) + mask_token(m.group(3)), s, flags=re.I)
    # long random-looking strings anywhere
    s = re.sub(r"[A-Za-z0-9_\-+/=]{28,}", lambda m: mask_token(m.group()) if not m.group().startswith(("android.", "androidx.", "com.", "java.", "kotlin.")) else m.group(), s)
    # bearer/basic values
    s = re.sub(r"(Bearer|Basic)\s+\S+", lambda m: m.group(1) + " <masked>", s, flags=re.I)
    return s


def main(path):
    if not os.path.isfile(path):
        sys.exit("file not found: " + path)
    out = []

    def p(line=""):
        out.append(line)

    size = os.path.getsize(path)
    with open(path, "rb") as f:
        sha = hashlib.sha256(f.read()).hexdigest()
    p("APK: %s  (%.1f MB)  sha256 %s" % (os.path.basename(path), size / 1048576, sha))
    try:
        z = zipfile.ZipFile(path)
    except zipfile.BadZipFile:
        sys.exit("not a valid APK/zip file")
    names = z.namelist()
    p("files inside: %d" % len(names))

    # --- what framework / structure
    kinds = []
    joined = " ".join(names)
    for label, pat in [("Flutter", "libflutter.so"), ("React Native", "index.android.bundle"), ("Unity", "libunity.so"),
                       ("Cordova/Ionic web view", "assets/www/"), ("Xamarin/.NET", "assemblies/"), ("Kotlin", "kotlin/"),
                       ("native libraries", ".so")]:
        if pat in joined:
            kinds.append(label)
    p("built with / contains: " + (", ".join(kinds) or "plain Java/Kotlin"))
    p("dex files: %s" % ", ".join(n for n in names if re.match(r"classes\d*\.dex$", n)))
    sig = [n for n in names if n.startswith("META-INF/") and n.endswith((".RSA", ".DSA", ".EC"))]
    for n in sig:
        p("signed by certificate file %s  sha256 %s" % (n, hashlib.sha256(z.read(n)).hexdigest()[:32]))
    p("")

    # --- gather strings
    strings = {}
    scan = [n for n in names if re.match(r"classes\d*\.dex$", n) or n.endswith((".so", ".arsc", ".xml", ".json", ".js", ".html", ".txt", ".properties", ".bundle"))
            or n.startswith(("assets/", "lib/")) or n == "AndroidManifest.xml"]
    for n in scan:
        try:
            data = z.read(n)[:MAX_SCAN]
        except Exception:
            continue
        for s in ascii_runs(data):
            strings.setdefault(s, n)
        for s in utf8_persian_runs(data):
            strings.setdefault(s, n)
        if n.endswith((".xml", ".arsc")) or n == "AndroidManifest.xml":
            for s in utf16_runs(data):
                strings.setdefault(s, n)

    # --- manifest facts
    manifest = [s for s, n in strings.items() if n == "AndroidManifest.xml"]
    perms = sorted({s for s in manifest if s.startswith("android.permission.") or "permission." in s})
    pkg = next((s for s in manifest if re.fullmatch(r"[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2,}", s) and not s.startswith(("android.", "androidx."))), "?")
    comps = sorted({s for s in manifest if re.search(r"(Receiver|Service|Activity|Worker|Listener)$", s)})
    p("package: " + pkg)
    p("permissions requested:")
    for x in perms:
        p("   " + x)
    p("components (receivers / services / activities):")
    for x in comps[:40]:
        p("   " + x)
    p("")

    # --- network details
    urls = sorted({mask(m.group()) for s in strings for m in re.finditer(r"https?://[^\s\"'<>\\]+", s)})
    p("URLs found (secrets masked):")
    for u in urls[:60]:
        p("   " + u)
    if not urls:
        p("   (none as plain text: the address may be typed by the user in the app, or built at runtime)")
    paths = sorted({mask(s) for s in strings if re.fullmatch(r"/[A-Za-z0-9_\-./{}:]{3,80}", s) and not s.startswith(("/res/", "/data/", "/system/", "/proc/", "/dev/"))})
    p("")
    p("URL paths (e.g. API routes):")
    for x in paths[:60]:
        p("   " + x)
    p("")

    headers = sorted({s for s in strings if re.fullmatch(r"[A-Za-z][A-Za-z\-]{2,40}", s) and (s.lower() in
                      ("authorization", "content-type", "accept", "user-agent", "x-api-key") or s.lower().startswith("x-"))})
    p("HTTP header names seen: " + (", ".join(headers) or "(none)"))
    ctype = sorted({s for s in strings if s.lower().startswith(("application/", "text/plain", "multipart/"))})
    p("content types: " + (", ".join(ctype) or "(none)"))
    p("HTTP libraries: " + (", ".join(sorted({l for l, pat in [("OkHttp", "okhttp3"), ("Retrofit", "retrofit2"), ("Volley", "com/android/volley"),
                                                                ("HttpURLConnection", "HttpURLConnection"), ("Ktor", "io/ktor"), ("Dio (Flutter)", "dio")]
                                              if any(pat in s for s in strings)})) or "(unknown)"))
    p("")

    # --- field names that look like JSON / form keys
    keys = set()
    for s in strings:
        for m in re.finditer(r"\"([A-Za-z_][A-Za-z0-9_]{1,30})\"\s*:", s):
            keys.add(m.group(1))
        if re.fullmatch(r"[a-z][a-z0-9_]{2,25}", s) and KEYWORDS.search(s):
            keys.add(s)
    p("field / key names that look relevant (what the app sends or reads):")
    p("   " + ", ".join(sorted(keys)[:120]))
    p("")

    # --- message-format hints (what text the app looks for in SMS/notifications)
    hints = sorted({mask(s) for s in strings if len(s) <= 90 and re.search(r"(واریز|برداشت|مبلغ|بانک|ریال|تومان|deposit|amount|balance|blu|بلو|کارت)", s, re.I)})
    p("text patterns about banks / amounts (parsing hints, if any):")
    for x in hints[:40]:
        p("   " + x)
    if not hints:
        p("   (none: the app probably forwards the raw message and the server does the parsing)")
    p("")

    # --- other relevant strings
    rel = sorted({mask(s) for s in strings if 6 <= len(s) <= 100 and KEYWORDS.search(s) and not s.startswith(("android.", "androidx.", "com.google", "kotlin", "java.", "Landroid", "L", "Ljava"))
                  and re.fullmatch(r"[\x20-\x7e]+", s) and " " not in s.strip() or (len(s) <= 100 and s.lower().startswith("sms"))})
    p("other relevant strings (first 80):")
    for x in rel[:80]:
        p("   " + x)
    p("")
    p("--- end of report. Secrets are masked; the full APK was not uploaded anywhere. ---")

    text = "\n".join(out)
    rp = os.path.join(os.path.dirname(os.path.abspath(path)), "apk_probe_report.txt")
    with open(rp, "w", encoding="utf-8") as f:
        f.write(text)
    print(text)
    print("\n(saved to %s)" % rp)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
