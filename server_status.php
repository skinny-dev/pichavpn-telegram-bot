<?php
// Server status for the channel: connects through every location of a monitor service (exactly like a customer's
// app, with Xray), measures the real ping and download speed, and posts / updates one emoji-rich message.
//
// Settings: storage/server_status.json (scripts/server_status.php setup ...). The monitor service is a normal panel
// user that has every location (use an unlimited one). Tests run from the bot server, so a location that is down here
// is down; one that is fine here can still be filtered for some customers inside Iran.

const SS_FILE = __DIR__ . '/storage/server_status.json';
const SS_STATE = __DIR__ . '/storage/server_status_state.json';
const SS_LOCK = __DIR__ . '/storage/server_status.lock';

function ssConfig(): array
{
    $c = is_file(SS_FILE) ? json_decode((string) @file_get_contents(SS_FILE), true) : null;
    return array_merge([
        'enabled' => false,          // automatic posting
        'panel' => '',               // panel name in the bot
        'username' => '',            // monitor service on that panel
        'channel' => 'reports',      // reports = the bot's report group (a topic is created for it), or @channel / -100…
        'topic' => 'وضعیت سرور ها',  // topic name in the report group
        'every_minutes' => 180,
        'mode' => 'edit',            // edit = keep one message up to date, new = a new post every time
        'seconds' => 5,              // download test length per location
        'ping_url' => 'http://www.gstatic.com/generate_204',
        'download_url' => 'https://speed.cloudflare.com/__down?bytes=25000000', // max 25 MB per location per run
        'title' => 'وضعیت سرورهای پیچا',
        'names' => (object) [],      // {"config name": "name to show"}
        'hide' => [],                // config names not to test / show
        'xray' => '',                // path to the xray binary (default storage/bin/xray, then PATH)
        'source' => 'local',         // local = test from this server, agent = a server inside Iran runs it (status_agent.php)
        'agent_key' => '',
        'agent_label' => '🇮🇷 ایران',
    ], is_array($c) ? $c : []);
}

function ssSaveConfig(array $c): void
{
    @mkdir(dirname(SS_FILE), 0775, true);
    file_put_contents(SS_FILE, json_encode($c, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX);
}

function ssState(): array
{
    $s = is_file(SS_STATE) ? json_decode((string) @file_get_contents(SS_STATE), true) : null;
    return is_array($s) ? $s : [];
}

function ssSaveState(array $s): void
{
    file_put_contents(SS_STATE, json_encode($s, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
}

function ssXrayPath(array $cfg): ?string
{
    foreach ([$cfg['xray'] ?? '', __DIR__ . '/storage/bin/xray', '/usr/local/bin/xray', '/usr/bin/xray'] as $p) {
        if ($p !== '' && is_file($p) && is_executable($p)) {
            return $p;
        }
    }
    $w = trim((string) @shell_exec('command -v xray 2>/dev/null'));
    return $w !== '' ? $w : null;
}

function ssB64(string $s): string
{
    $s = strtr(trim($s), '-_', '+/');
    return (string) base64_decode($s . str_repeat('=', (4 - strlen($s) % 4) % 4));
}

/** streamSettings for a transport + security, from share-link style parameters. */
function ssStream(string $net, string $sec, array $q, string $address): array
{
    $net = strtolower($net ?: 'tcp');
    $net = ['raw' => 'tcp', 'splithttp' => 'xhttp', 'http' => 'h2', 'h2' => 'h2'][$net] ?? $net;
    $host = (string) ($q['host'] ?? '');
    $path = (string) ($q['path'] ?? '');
    $s = ['network' => $net === 'h2' ? 'http' : $net];
    switch ($net) {
        case 'ws':
            $s['wsSettings'] = ['path' => $path ?: '/', 'headers' => $host !== '' ? ['Host' => $host] : (object) []];
            break;
        case 'grpc':
            $s['grpcSettings'] = ['serviceName' => (string) ($q['serviceName'] ?? $path), 'multiMode' => ($q['mode'] ?? '') === 'multi'];
            break;
        case 'httpupgrade':
            $s['httpupgradeSettings'] = ['path' => $path ?: '/', 'host' => $host];
            break;
        case 'xhttp':
            $s['xhttpSettings'] = array_filter(['path' => $path ?: '/', 'host' => $host, 'mode' => (string) ($q['mode'] ?? 'auto')], fn($v) => $v !== '');
            if (!empty($q['extra'])) {
                $extra = json_decode((string) $q['extra'], true);
                if (is_array($extra)) {
                    $s['xhttpSettings']['extra'] = $extra;
                }
            }
            break;
        case 'h2':
            $s['httpSettings'] = ['path' => $path ?: '/', 'host' => $host !== '' ? explode(',', $host) : []];
            break;
        case 'kcp':
        case 'quic':
            break;
        default: // tcp
            $s['network'] = 'tcp';
            if (($q['headerType'] ?? '') === 'http') {
                $s['tcpSettings'] = ['header' => ['type' => 'http', 'request' => ['path' => [$path ?: '/'], 'headers' => ['Host' => $host !== '' ? explode(',', $host) : [$address]]]]];
            }
    }
    $sec = strtolower($sec ?: 'none');
    $sni = (string) ($q['sni'] ?? ($q['peer'] ?? ''));
    if ($sec === 'tls') {
        $s['security'] = 'tls';
        $s['tlsSettings'] = array_filter([
            'serverName' => $sni !== '' ? $sni : ($host !== '' ? explode(',', $host)[0] : $address),
            'fingerprint' => (string) ($q['fp'] ?? ''),
            'alpn' => !empty($q['alpn']) ? explode(',', (string) $q['alpn']) : null,
            'allowInsecure' => !empty($q['allowInsecure']) || !empty($q['insecure']) ? true : null,
        ], fn($v) => $v !== '' && $v !== null);
    } elseif ($sec === 'reality') {
        $s['security'] = 'reality';
        $s['realitySettings'] = array_filter([
            'serverName' => $sni, 'fingerprint' => (string) ($q['fp'] ?? 'chrome') ?: 'chrome', 'publicKey' => (string) ($q['pbk'] ?? ''),
            'shortId' => (string) ($q['sid'] ?? ''), 'spiderX' => (string) ($q['spx'] ?? ''),
        ], fn($v) => $v !== '');
    }
    return $s;
}

/** A share link → ['name', 'outbound'] (Xray) or ['name', 'error']. */
function ssParseLink(string $link): ?array
{
    $link = trim($link);
    if (!preg_match('#^([a-z0-9]+)://#i', $link, $m)) {
        return null;
    }
    $proto = strtolower($m[1]);
    if ($proto === 'vmess') {
        $j = json_decode(ssB64(substr($link, 8)), true);
        if (!is_array($j) || empty($j['add'])) {
            return ['name' => 'vmess', 'error' => 'لینک vmess خراب'];
        }
        $q = ['host' => $j['host'] ?? '', 'path' => $j['path'] ?? '', 'sni' => $j['sni'] ?? '', 'alpn' => $j['alpn'] ?? '', 'fp' => $j['fp'] ?? '',
            'headerType' => $j['type'] ?? '', 'serviceName' => $j['path'] ?? '', 'allowInsecure' => $j['allowInsecure'] ?? '', 'mode' => $j['mode'] ?? ''];
        $tls = (string) ($j['tls'] ?? '');
        return ['name' => (string) ($j['ps'] ?? $j['add']), 'outbound' => ['protocol' => 'vmess',
            'settings' => ['vnext' => [['address' => $j['add'], 'port' => (int) $j['port'], 'users' => [['id' => $j['id'], 'alterId' => (int) ($j['aid'] ?? 0), 'security' => $j['scy'] ?? 'auto']]]]],
            'streamSettings' => ssStream((string) ($j['net'] ?? 'tcp'), $tls === '' ? 'none' : $tls, $q, (string) $j['add'])]];
    }
    $u = parse_url($link);
    $name = rawurldecode((string) ($u['fragment'] ?? ''));
    if (!$u || empty($u['host'])) {
        return ['name' => $name ?: $proto, 'error' => 'لینک خوانده نشد'];
    }
    parse_str((string) ($u['query'] ?? ''), $q);
    $address = trim($u['host'], '[]');
    $port = (int) ($u['port'] ?? 443);
    $name = $name !== '' ? $name : "$address:$port";
    $userinfo = rawurldecode((string) ($u['user'] ?? ''));
    switch ($proto) {
        case 'vless':
            return ['name' => $name, 'outbound' => ['protocol' => 'vless',
                'settings' => ['vnext' => [['address' => $address, 'port' => $port, 'users' => [array_filter(['id' => $userinfo, 'encryption' => (string) ($q['encryption'] ?? 'none') ?: 'none', 'flow' => (string) ($q['flow'] ?? '')], fn($v) => $v !== '')]]]],
                'streamSettings' => ssStream((string) ($q['type'] ?? 'tcp'), (string) ($q['security'] ?? 'none'), $q, $address)]];
        case 'trojan':
            return ['name' => $name, 'outbound' => ['protocol' => 'trojan',
                'settings' => ['servers' => [['address' => $address, 'port' => $port, 'password' => $userinfo]]],
                'streamSettings' => ssStream((string) ($q['type'] ?? 'tcp'), (string) ($q['security'] ?? 'tls'), $q, $address)]];
        case 'ss':
            $info = isset($u['pass']) ? $userinfo . ':' . rawurldecode((string) $u['pass']) : ssB64($userinfo);
            if (strpos($info, ':') === false) {
                return ['name' => $name, 'error' => 'لینک shadowsocks خوانده نشد'];
            }
            [$method, $password] = explode(':', $info, 2);
            return ['name' => $name, 'outbound' => ['protocol' => 'shadowsocks',
                'settings' => ['servers' => [['address' => $address, 'port' => $port, 'method' => $method, 'password' => $password]]],
                'streamSettings' => ssStream((string) ($q['type'] ?? 'tcp'), (string) ($q['security'] ?? 'none'), $q, $address)]];
    }
    return ['name' => $name, 'error' => "پروتکل $proto تست نمی‌شود"];
}

/** SHA-256 (hex) of the certificate a TLS server shows for $sni, or null. */
function ssCertSha256(string $host, int $port, string $sni): ?string
{
    $ctx = stream_context_create(['ssl' => ['peer_name' => $sni, 'SNI_enabled' => true, 'verify_peer' => false, 'verify_peer_name' => false, 'capture_peer_cert' => true]]);
    $s = @stream_socket_client("tls://$host:$port", $no, $err, 6, STREAM_CLIENT_CONNECT, $ctx);
    if (!$s) {
        return null;
    }
    $cert = stream_context_get_params($s)['options']['ssl']['peer_certificate'] ?? null;
    fclose($s);
    if (!$cert || !openssl_x509_export($cert, $pem)) {
        return null;
    }
    $der = base64_decode(preg_replace('/-----[^-]+-----|\s+/', '', $pem));
    return hash('sha256', $der);
}

/**
 * Newer Xray removed «allowInsecure» (self-signed / mismatched certificates): pin the certificate the server shows now
 * instead, so such a location is still tested the way the customers' apps (with allowInsecure) connect.
 */
function ssPinInsecure(array $outbound): array
{
    $tls = $outbound['streamSettings']['tlsSettings'] ?? null;
    if (!is_array($tls) || empty($tls['allowInsecure'])) {
        return $outbound;
    }
    $srv = $outbound['settings']['vnext'][0] ?? ($outbound['settings']['servers'][0] ?? null);
    unset($outbound['streamSettings']['tlsSettings']['allowInsecure']);
    $hash = $srv ? ssCertSha256((string) $srv['address'], (int) $srv['port'], (string) ($tls['serverName'] ?? $srv['address'])) : null;
    if ($hash) {
        $outbound['streamSettings']['tlsSettings']['pinnedPeerCertSha256'] = $hash;
    }
    return $outbound;
}

function ssFreePort(): int
{
    for ($i = 0; $i < 50; $i++) {
        $p = random_int(20000, 60000);
        $s = @stream_socket_server("tcp://127.0.0.1:$p");
        if ($s) {
            fclose($s);
            return $p;
        }
    }
    throw new RuntimeException('no free port');
}

/** Ping (median of 3 HTTP requests, ms) and download speed (Mbps) through a local socks port. */
function ssMeasure(int $port, array $cfg): array
{
    $proxy = "socks5h://127.0.0.1:$port";
    $pings = [];
    for ($i = 0; $i < 3; $i++) {
        $ch = curl_init($cfg['ping_url']);
        curl_setopt_array($ch, [CURLOPT_PROXY => $proxy, CURLOPT_NOPROXY => '', CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 6, CURLOPT_CONNECTTIMEOUT => 6, CURLOPT_NOBODY => false]);
        curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $t = curl_getinfo($ch, CURLINFO_TOTAL_TIME);
        curl_close($ch);
        if ($code >= 200 && $code < 400) {
            $pings[] = (int) round($t * 1000);
        }
    }
    if (!$pings) {
        return ['ok' => false, 'ping' => null, 'speed' => null];
    }
    sort($pings);
    $ping = $pings[intdiv(count($pings), 2)];
    $bytes = 0;
    $limit = max(2, (int) $cfg['seconds']);
    $ch = curl_init($cfg['download_url']);
    curl_setopt_array($ch, [CURLOPT_PROXY => $proxy, CURLOPT_NOPROXY => '', CURLOPT_TIMEOUT => $limit + 4, CURLOPT_CONNECTTIMEOUT => 6,
        CURLOPT_WRITEFUNCTION => function ($ch, $data) use (&$bytes) {
            $bytes += strlen($data);
            return strlen($data);
        },
        CURLOPT_NOPROGRESS => false,
        CURLOPT_XFERINFOFUNCTION => function ($ch, $dlTotal, $dlNow) use ($limit) {
            $start = curl_getinfo($ch, CURLINFO_STARTTRANSFER_TIME);
            return ($start > 0 && curl_getinfo($ch, CURLINFO_TOTAL_TIME) - $start > $limit) ? 1 : 0; // stop after N seconds of data
        }]);
    curl_exec($ch);
    $total = curl_getinfo($ch, CURLINFO_TOTAL_TIME);
    $start = curl_getinfo($ch, CURLINFO_STARTTRANSFER_TIME);
    curl_close($ch);
    $secs = max(0.05, $total - $start);
    $mbps = $bytes * 8 / $secs / 1e6;
    $speed = $bytes > 0 ? ($mbps >= 10 ? (int) round($mbps) : round($mbps, 1)) : null;
    return ['ok' => true, 'ping' => $ping, 'speed' => $speed];
}

/**
 * Checks every item with Xray (one bad link cannot stop the test) and builds one Xray config with a socks port per
 * location. Returns [results so far (the broken ones), testable items, xray config, ports]. $basePort: fixed ports
 * (the remote agent) instead of free local ones.
 */
function ssPrepare(array $items, array $cfg, ?int $basePort = null): array
{
    $xray = ssXrayPath($cfg);
    if (!$xray) {
        throw new RuntimeException('xray پیدا نشد؛ اول  php scripts/server_status.php install-xray  را بزنید');
    }
    $tmp = sys_get_temp_dir() . '/picha-ss-' . bin2hex(random_bytes(4));
    @mkdir($tmp, 0700);
    $results = [];
    $testable = [];
    try {
        foreach ($items as $i => $it) {
            if (isset($it['error'])) {
                $results[$i] = ['name' => $it['name'], 'ok' => false, 'error' => $it['error']];
                continue;
            }
            $one = ['log' => ['loglevel' => 'none'], 'inbounds' => [['port' => 1, 'listen' => '127.0.0.1', 'protocol' => 'socks', 'settings' => ['udp' => false]]], 'outbounds' => [$it['outbound']]];
            file_put_contents("$tmp/one.json", json_encode($one, JSON_UNESCAPED_SLASHES));
            $out = [];
            exec(escapeshellarg($xray) . ' run -test -c ' . escapeshellarg("$tmp/one.json") . ' 2>&1', $out, $rc);
            if ($rc !== 0 && stripos(implode("\n", $out), 'allowInsecure') !== false) {
                $it['outbound'] = ssPinInsecure($it['outbound']);
                $one['outbounds'] = [$it['outbound']];
                file_put_contents("$tmp/one.json", json_encode($one, JSON_UNESCAPED_SLASHES));
                $out = [];
                exec(escapeshellarg($xray) . ' run -test -c ' . escapeshellarg("$tmp/one.json") . ' 2>&1', $out, $rc);
            }
            if ($rc !== 0) {
                $results[$i] = ['name' => $it['name'], 'ok' => false, 'error' => 'کانفیگ برای Xray نامعتبر است'];
                continue;
            }
            $testable[$i] = $it;
        }
    } finally {
        array_map('unlink', glob("$tmp/*") ?: []);
        @rmdir($tmp);
    }
    $conf = ['log' => ['loglevel' => 'warning'], 'inbounds' => [], 'outbounds' => [], 'routing' => ['rules' => []]];
    $ports = [];
    $n = 0;
    foreach ($testable as $i => $it) {
        $ports[$i] = $basePort ? $basePort + $n++ : ssFreePort();
        $conf['inbounds'][] = ['tag' => "in$i", 'port' => $ports[$i], 'listen' => '127.0.0.1', 'protocol' => 'socks', 'settings' => ['udp' => false]];
        $conf['outbounds'][] = ['tag' => "out$i"] + $it['outbound'];
        $conf['routing']['rules'][] = ['type' => 'field', 'inboundTag' => ["in$i"], 'outboundTag' => "out$i"];
    }
    return [$results, $testable, $conf, $ports];
}

/** Tests every item from this server (one Xray process, a socks port per location). */
function ssRun(array $items, array $cfg, ?callable $progress = null): array
{
    [$results, $testable, $conf, $ports] = ssPrepare($items, $cfg);
    if ($testable) {
        $xray = ssXrayPath($cfg);
        $tmp = sys_get_temp_dir() . '/picha-ss-' . bin2hex(random_bytes(4));
        @mkdir($tmp, 0700);
        file_put_contents("$tmp/all.json", json_encode($conf, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
        $proc = proc_open([$xray, 'run', '-c', "$tmp/all.json"], [0 => ['pipe', 'r'], 1 => ['file', "$tmp/xray.log", 'a'], 2 => ['file', "$tmp/xray.log", 'a']], $pipes);
        if (!is_resource($proc)) {
            throw new RuntimeException('xray اجرا نشد');
        }
        try {
            $deadline = microtime(true) + 8;
            foreach ($ports as $p) { // wait until Xray listens
                while (!($s = @stream_socket_client("tcp://127.0.0.1:$p", $e1, $e2, 0.2)) && microtime(true) < $deadline) {
                    usleep(100000);
                }
                $s && fclose($s);
            }
            foreach ($testable as $i => $it) {
                $progress && $progress($it['name']);
                $results[$i] = ['name' => $it['name']] + ssMeasure($ports[$i], $cfg);
            }
        } finally {
            proc_terminate($proc);
            proc_close($proc);
            array_map('unlink', glob("$tmp/*") ?: []);
            @rmdir($tmp);
        }
    }
    ksort($results);
    return array_values($results);
}

// ---------- remote agent (a server inside Iran runs the test, this bot posts it) ----------

const SS_AGENT_PORT = 31100;

/** The job for the agent: Xray config, «index<TAB>port» list, and the names, kept until the result comes back. */
function ssAgentJob(array $cfg): array
{
    $items = ssItems($cfg);
    [$results, $testable, $conf, $ports] = ssPrepare($items, $cfg, SS_AGENT_PORT);
    $job = ['id' => bin2hex(random_bytes(6)), 'at' => time(), 'names' => array_map(fn($it) => $it['name'], $items), 'broken' => $results, 'ports' => $ports];
    ssSaveState(['agent_job' => $job] + ssState());
    return ['job' => $job, 'config' => $conf];
}

/** The agent's raw lines «index code1 t1 code2 t2 code3 t3 bytes total start» → results like ssMeasure(). */
function ssAgentResults(string $raw, array $job, array $cfg): array
{
    $results = [];
    foreach ($job['broken'] as $i => $r) {
        $results[(int) $i] = $r;
    }
    $seen = [];
    foreach (preg_split('/\R/', $raw) as $line) {
        $f = preg_split('/\s+/', trim($line));
        if (count($f) < 10 || !ctype_digit($f[0]) || !isset($job['ports'][(int) $f[0]])) {
            continue;
        }
        $i = (int) $f[0];
        $seen[$i] = true;
        $pings = [];
        for ($k = 1; $k <= 5; $k += 2) {
            $code = (int) $f[$k];
            if ($code >= 200 && $code < 400) {
                $pings[] = (int) round((float) $f[$k + 1] * 1000);
            }
        }
        $name = (string) ($job['names'][$i] ?? "#$i");
        if (!$pings) {
            $results[$i] = ['name' => $name, 'ok' => false, 'ping' => null, 'speed' => null];
            continue;
        }
        sort($pings);
        $bytes = (float) $f[7];
        $secs = max(0.05, (float) $f[8] - (float) $f[9]);
        $mbps = $bytes * 8 / $secs / 1e6;
        $results[$i] = ['name' => $name, 'ok' => true, 'ping' => $pings[intdiv(count($pings), 2)], 'speed' => $bytes > 0 ? ($mbps >= 10 ? (int) round($mbps) : round($mbps, 1)) : null];
    }
    foreach ($job['ports'] as $i => $p) { // a location the agent did not report is down
        if (!isset($seen[(int) $i])) {
            $results[(int) $i] = ['name' => (string) ($job['names'][$i] ?? "#$i"), 'ok' => false, 'ping' => null, 'speed' => null];
        }
    }
    ksort($results);
    return array_values($results);
}

/** The bash script the Iranian server runs (needs only bash + curl; Xray is fetched from this bot). */
function ssAgentScript(string $url, string $key, array $cfg): string
{
    $q = fn($s) => "'" . str_replace("'", "'\\''", (string) $s) . "'";
    $secs = max(2, (int) $cfg['seconds']);
    return <<<SH
#!/bin/bash
# Picha server-status agent: tests every location from THIS server and sends the numbers to the bot.
# Cron: 0 */3 * * * bash /opt/picha-agent/run.sh >/dev/null 2>&1
URL={$q($url)}
KEY={$q($key)}
PING_URL={$q($cfg['ping_url'])}
DL_URL={$q($cfg['download_url'])}
SECS=$secs
DIR=/opt/picha-agent
mkdir -p "\$DIR" && cd "\$DIR" || exit 1
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY all_proxy ALL_PROXY no_proxy NO_PROXY
exec 9>"\$DIR/lock"; flock -n 9 || exit 0
if [ ! -x ./xray ]; then
  echo "⬇️  downloading Xray from the bot (first run only, ~30 MB)…"
  curl -fS --progress-bar -m 600 "\$URL?a=xray&key=\$KEY" -o xray.tmp && chmod +x xray.tmp && mv xray.tmp xray || { echo "xray download failed"; exit 1; }
fi
echo "📥 getting the test job…"
curl -fsS -m 120 "\$URL?a=config&key=\$KEY" -o config.json || { echo "job download failed"; exit 1; }
curl -fsS -m 60 "\$URL?a=list&key=\$KEY" -o list.txt || exit 1
./xray run -c config.json > xray.log 2>&1 &
XP=\$!
sleep 3
TOTAL=\$(grep -c . list.txt); N=0
echo "🧪 testing \$TOTAL locations…"
: > result.txt
while IFS=\$'\t' read -r idx port; do
  [ -z "\$port" ] && continue
  line="\$idx"
  for n in 1 2 3; do
    r=\$(curl -s -o /dev/null -w '%{http_code} %{time_total}' --noproxy '' --socks5-hostname "127.0.0.1:\$port" -m 6 "\$PING_URL")
    line="\$line \${r:-000 0}"
  done
  r=\$(curl -s -o /dev/null -w '%{size_download} %{time_total} %{time_starttransfer}' --noproxy '' --socks5-hostname "127.0.0.1:\$port" -m \$((SECS+3)) "\$DL_URL")
  echo "\$line \${r:-0 0 0}" >> result.txt
  N=\$((N+1)); echo "   \$N/\$TOTAL  ping: \$(echo "\$line" | awk '{print \$2"/"\$3}')  download: \$(echo "\$r" | awk '{print \$1}') bytes"
done < list.txt
kill \$XP 2>/dev/null
echo "📤 sending the result to the bot…"
curl -fsS -m 120 -X POST --data-binary @result.txt "\$URL?a=result&key=\$KEY" && echo " ✅"
SH;
}

/** The monitor service's locations, with the names / hide list applied. */
function ssItems(array $cfg): array
{
    global $pdo;
    if ($cfg['panel'] === '' || $cfg['username'] === '') {
        throw new RuntimeException('اول پنل و سرویس مانیتور را تنظیم کنید: php scripts/server_status.php setup --panel="…" --user=…');
    }
    $mp = new ManagePanel();
    $d = $mp->DataUser($cfg['panel'], $cfg['username']);
    if (($d['status'] ?? '') === 'Unsuccessful') {
        throw new RuntimeException('سرویس مانیتور از پنل خوانده نشد: ' . ($d['msg'] ?? ''));
    }
    $links = $d['links'] ?? ($d['configs'] ?? []);
    $links = is_array($links) ? $links : explode("\n", (string) $links);
    $names = (array) $cfg['names'];
    $hide = array_map('strval', (array) $cfg['hide']);
    $items = [];
    foreach ($links as $l) {
        $it = ssParseLink((string) $l);
        if (!$it || in_array($it['name'], $hide, true)) {
            continue;
        }
        $it['raw_name'] = $it['name'];
        $it['name'] = (string) ($names[$it['name']] ?? $it['name']);
        $items[] = $it;
    }
    return $items;
}

function ssFa($s): string
{
    return strtr((string) $s, ['0' => '۰', '1' => '۱', '2' => '۲', '3' => '۳', '4' => '۴', '5' => '۵', '6' => '۶', '7' => '۷', '8' => '۸', '9' => '۹', '.' => '٫']);
}

/** 🟢 good / 🟡 slow / 🟠 very slow / 🔴 down, from ping (ms) and speed (Mbps). */
function ssDot(array $r): string
{
    if (empty($r['ok'])) {
        return '🔴';
    }
    $ping = (int) $r['ping'];
    $speed = $r['speed'];
    if ($ping > 1500 || ($speed !== null && $speed < 2)) {
        return '🟠';
    }
    return ($ping <= 600 && ($speed === null || $speed >= 10)) ? '🟢' : '🟡';
}

/** «🇹🇷 ☁️ ترکیه» → [flags «🇹🇷», text «ترکیه», tunnel?]. «🇹🇷 🇮🇷 تونل ترکیه» → [«🇹🇷🇮🇷», «تونل ترکیه», true]. */
function ssSplitName(string $name): array
{
    $tunnel = mb_strpos($name, 'تونل') !== false || mb_strpos($name, "🇮🇷") !== false;
    preg_match_all('/[\x{1F1E6}-\x{1F1FF}]{2}/u', $name, $m);
    $flags = implode('', array_unique($m[0]));
    $text = preg_replace('/[\x{1F1E6}-\x{1F1FF}]|\x{2601}\x{FE0F}?/u', '', $name);
    $text = trim(preg_replace('/\s+/u', ' ', (string) $text));
    return [$flags, $text, $tunnel];
}

/**
 * The status message (HTML, right-to-left): one line per location «🇹🇷🇮🇷 تونل ترکیه | پینگ ۵۹۵ms | 🟡», direct and tunnel
 * locations in two quoted blocks. Emoji become the premium pack's when they are mapped (premium_emoji layer).
 */
function ssMessage(array $results, array $cfg, ?int $now = null): string
{
    $now = $now ?? time();
    $rlm = "\u{200F}";
    // untestable protocols (hysteria, wireguard…) and info entries without a name (✅ ⌛ ∞ 📊) are left out
    $results = array_values(array_filter($results, fn($r) => (empty($r['error']) || strpos((string) $r['error'], 'تست نمی') === false)
        && preg_match('/\p{L}/u', ssSplitName((string) $r['name'])[1])));
    $groups = ['direct' => [], 'tunnel' => []];
    $up = 0;
    foreach ($results as $r) {
        [$flags, $text, $tunnel] = ssSplitName((string) $r['name']);
        $dot = ssDot($r);
        $up += empty($r['ok']) ? 0 : 1;
        $label = htmlspecialchars(trim($flags . ' ' . $text), ENT_QUOTES);
        $value = empty($r['ok']) ? 'قطع' : 'پینگ ' . ssFa((int) $r['ping']) . 'ms';
        $groups[$tunnel ? 'tunnel' : 'direct'][] = $rlm . $label . ' | ' . $value . ' | ' . $dot;
    }
    $total = count($results);
    $date = function_exists('jdate') ? jdate('j F — H:i', $now, '', 'Asia/Tehran') : date('m-d H:i', $now);
    $every = $cfg['every_minutes'] >= 60 && $cfg['every_minutes'] % 60 === 0 ? ssFa($cfg['every_minutes'] / 60) . ' ساعت' : ssFa($cfg['every_minutes']) . ' دقیقه';
    $L = [];
    $L[] = $rlm . '📡 <b>' . htmlspecialchars($cfg['title'], ENT_QUOTES) . '</b>';
    $from = (string) ($cfg['from_label'] ?? '');
    $L[] = $rlm . '🕒 ' . $date . ($from !== '' ? '  •  📍 تست از ' . htmlspecialchars($from, ENT_QUOTES) : '') . '  •  ' . ($up === $total ? '✅' : ($up === 0 ? '🚨' : '⚠️')) . ' <b>' . ssFa($up) . ' از ' . ssFa($total) . '</b> فعال';
    foreach (['direct' => '🌐 <b>مستقیم</b>', 'tunnel' => '🛡 <b>تونل</b>'] as $k => $title) {
        if ($groups[$k]) {
            $L[] = '';
            $L[] = $rlm . $title;
            $L[] = '<blockquote>' . implode("\n", $groups[$k]) . '</blockquote>';
        }
    }
    $L[] = '';
    $L[] = $rlm . '🟢 عالی  🟡 متوسط  🟠 کند  🔴 قطع  •  🔄 هر ' . $every;
    return implode("\n", $L);
}

/** Where to post: [chat_id, topic id or null]. «reports» = the report group, in its own topic (created once). */
function ssTarget(array $cfg): array
{
    if ($cfg['channel'] !== 'reports') {
        return [$cfg['channel'], null];
    }
    $setting = select("setting", "*");
    $chat = (string) ($setting['Channel_Report'] ?? '');
    if ($chat === '' || $chat === '0') {
        throw new RuntimeException('گروه گزارش‌های ربات تنظیم نشده');
    }
    $state = ssState();
    if (!empty($state['topic_id']) && ($state['topic_chat'] ?? '') === $chat && ($state['topic_name'] ?? '') === $cfg['topic']) {
        return [$chat, (int) $state['topic_id']];
    }
    $r = telegram('createForumTopic', ['chat_id' => $chat, 'name' => $cfg['topic'], 'icon_color' => 7322096]);
    if (empty($r['ok'])) {
        throw new RuntimeException('تاپیک ساخته نشد: ' . ($r['description'] ?? 'بدون پاسخ') . ' (ربات باید در گروه اجازه «مدیریت تاپیک‌ها» داشته باشد)');
    }
    $state = ['topic_id' => (int) $r['result']['message_thread_id'], 'topic_chat' => $chat, 'topic_name' => $cfg['topic']] + $state;
    unset($state['message_id']);
    ssSaveState($state);
    return [$chat, (int) $state['topic_id']];
}

/** Sends (or, in edit mode, updates) the status message. Returns the message id. */
function ssPost(string $html, array $cfg): int
{
    if ($cfg['channel'] === '') {
        throw new RuntimeException('مقصد تنظیم نشده (--channel=reports یا @channel)');
    }
    [$chat, $topic] = ssTarget($cfg);
    $state = ssState();
    $where = $chat . '#' . (string) $topic;
    if ($cfg['mode'] === 'edit' && !empty($state['message_id']) && ($state['where'] ?? '') === $where) {
        $r = telegram('editMessageText', ['chat_id' => $chat, 'message_id' => (int) $state['message_id'], 'text' => $html, 'parse_mode' => 'HTML', 'disable_web_page_preview' => true]);
        if (!empty($r['ok']) || stripos((string) ($r['description'] ?? ''), 'not modified') !== false) {
            return (int) $state['message_id'];
        }
    }
    $send = ['chat_id' => $chat, 'text' => $html, 'parse_mode' => 'HTML', 'disable_web_page_preview' => true];
    if ($topic) {
        $send['message_thread_id'] = $topic;
    }
    $r = telegram('sendMessage', $send);
    if (empty($r['ok'])) {
        throw new RuntimeException('ارسال نشد: ' . ($r['description'] ?? 'بدون پاسخ') . ' (ربات باید ادمین باشد)');
    }
    $id = (int) ($r['result']['message_id'] ?? 0);
    ssSaveState(['message_id' => $id, 'where' => $where] + ssState());
    return $id;
}
