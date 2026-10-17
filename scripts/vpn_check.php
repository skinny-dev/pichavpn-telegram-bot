<?php
// «پینگ میده ولی وصل نمیشه»: checks what a customer really gets from the panel and whether each config can work.
//
//   php scripts/vpn_check.php USERNAME [USERNAME ...]   # panel usernames (as in the bot's service info)
//   php scripts/vpn_check.php 118706554                  # a Telegram user id: every service of that customer
//   php scripts/vpn_check.php                            # the 3 newest active services
//
// For every user: panel status, used / total, expiry, last online, last subscription update + app.
// For every config: protocol, address, port, transport, security, SNI / host / path, and from THIS server:
//   DNS → TCP connect → TLS handshake with the config's SNI (certificate valid? expired? name matches?)
//   → for ws / httpupgrade a real WebSocket upgrade on the path. Reality: the handshake must show the dest site's cert.
// UUIDs / passwords are never printed. Tests run from this server (outside Iran): a config that passes here but
// fails for customers is being filtered inside Iran (port / SNI / IP), not broken on the server.

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
$root = dirname(__DIR__);
chdir($root);
require $root . '/config.php';
require_once $root . '/function.php';
require_once $root . '/panels.php';

$users = [];
foreach (array_slice($argv, 1) as $arg) {
    // a Telegram user id (numbers only) → all services of that customer, newest first
    if (ctype_digit($arg) && !select('invoice', 'username', 'username', $arg, 'select')) {
        $st = $pdo->prepare("SELECT username, Status FROM invoice WHERE id_user = ? ORDER BY CAST(time_sell AS UNSIGNED) DESC");
        $st->execute([$arg]);
        $rows = $st->fetchAll(PDO::FETCH_ASSOC);
        echo "آیدی تلگرام $arg: " . count($rows) . " سرویس" . ($rows ? ' — ' . implode('، ', array_map(fn($r) => $r['username'] . " ({$r['Status']})", $rows)) : '') . "\n";
        foreach ($rows as $r) {
            if (!in_array($r['Status'], ['Unpaid', 'removebyadmin', 'unpaid'], true)) {
                $users[] = $r['username'];
            }
        }
        continue;
    }
    $users[] = $arg;
}
$users = array_values(array_unique($users));
if (!$users && $argc < 2) {
    $users = $pdo->query("SELECT username FROM invoice WHERE Status = 'active' ORDER BY time_sell DESC LIMIT 3")->fetchAll(PDO::FETCH_COLUMN);
}
if (!$users) {
    fwrite(STDERR, "هیچ سرویسی پیدا نشد؛ نام کاربری را بدهید: php scripts/vpn_check.php USERNAME\n");
    exit(1);
}
$panel = new ManagePanel();
$problems = [];

function vc_mask(string $s): string
{
    return strlen($s) > 8 ? substr($s, 0, 4) . '…' : '…';
}

function vc_parse(string $link): ?array
{
    $link = trim($link);
    if ($link === '' || !preg_match('#^([a-z0-9]+)://#i', $link, $m)) {
        return null;
    }
    $proto = strtolower($m[1]);
    if ($proto === 'vmess') {
        $j = json_decode((string) base64_decode(substr($link, 8)), true);
        if (!is_array($j)) {
            return ['proto' => 'vmess', 'error' => 'لینک vmess خراب است'];
        }
        return ['proto' => 'vmess', 'name' => $j['ps'] ?? '', 'host' => $j['add'] ?? '', 'port' => (int) ($j['port'] ?? 0), 'net' => $j['net'] ?? 'tcp',
            'security' => ($j['tls'] ?? '') ?: 'none', 'sni' => $j['sni'] ?? '', 'hosthdr' => $j['host'] ?? '', 'path' => $j['path'] ?? '', 'alpn' => $j['alpn'] ?? '', 'fp' => $j['fp'] ?? '', 'insecure' => !empty($j['allowInsecure'])];
    }
    $u = parse_url($link);
    if (!$u || empty($u['host'])) {
        return ['proto' => $proto, 'error' => 'لینک خوانده نشد'];
    }
    parse_str($u['query'] ?? '', $q);
    $sec = $q['security'] ?? ($proto === 'trojan' ? 'tls' : 'none');
    return ['proto' => $proto, 'name' => rawurldecode($u['fragment'] ?? ''), 'host' => trim($u['host'], '[]'), 'port' => (int) ($u['port'] ?? 443), 'net' => $q['type'] ?? 'tcp',
        'security' => $sec ?: 'none', 'sni' => $q['sni'] ?? ($q['peer'] ?? ''), 'hosthdr' => $q['host'] ?? '', 'path' => $q['path'] ?? ($q['serviceName'] ?? ''), 'alpn' => $q['alpn'] ?? '',
        'fp' => $q['fp'] ?? '', 'pbk' => $q['pbk'] ?? '', 'insecure' => !empty($q['allowInsecure']) || !empty($q['insecure'])];
}

/** TCP connect time in ms, or the error. */
function vc_tcp(string $host, int $port): array
{
    $t = microtime(true);
    $s = @stream_socket_client("tcp://$host:$port", $no, $err, 6);
    if (!$s) {
        return [false, $err ?: 'timeout'];
    }
    fclose($s);
    return [true, (int) ((microtime(true) - $t) * 1000)];
}

/** TLS handshake with SNI: [ok, info, cert array|null, verify error|null, stream|null]. */
function vc_tls(string $host, int $port, string $sni, bool $verify, string $alpn = '')
{
    $opts = ['ssl' => ['peer_name' => $sni, 'SNI_enabled' => true, 'verify_peer' => $verify, 'verify_peer_name' => $verify, 'allow_self_signed' => !$verify, 'capture_peer_cert' => true]];
    if ($alpn !== '' && defined('OPENSSL_VERSION_NUMBER')) {
        $opts['ssl']['alpn_protocols'] = $alpn;
    }
    $ctx = stream_context_create($opts);
    $s = @stream_socket_client("tls://$host:$port", $no, $err, 8, STREAM_CLIENT_CONNECT, $ctx);
    if (!$s) {
        $e = error_get_last()['message'] ?? $err;
        return [false, $e ?: $err ?: 'handshake failed', null, null];
    }
    $p = stream_context_get_params($s);
    $cert = isset($p['options']['ssl']['peer_certificate']) ? openssl_x509_parse($p['options']['ssl']['peer_certificate']) : null;
    return [true, 'ok', $cert, $s];
}

function vc_cert_text(?array $c): string
{
    if (!$c) {
        return '?';
    }
    $cn = $c['subject']['CN'] ?? '?';
    $san = str_replace('DNS:', '', $c['extensions']['subjectAltName'] ?? '');
    $days = (int) floor(((int) $c['validTo_time_t'] - time()) / 86400);
    $iss = $c['issuer']['O'] ?? ($c['issuer']['CN'] ?? '?');
    return "CN=$cn | SAN=" . ($san ?: '-') . " | صادرکننده: $iss | " . ($days < 0 ? "❌ منقضی شده (" . (-$days) . " روز پیش)" : "انقضا: $days روز دیگر");
}

/** Why a certificate is rejected for $sni (in Persian). */
function vc_reason(?array $c, string $sni): string
{
    if (!$c) {
        return 'گواهی خوانده نشد';
    }
    $why = [];
    if ((int) $c['validTo_time_t'] < time()) {
        $why[] = 'منقضی شده';
    }
    $names = array_map(fn($x) => strtolower(trim(str_replace('DNS:', '', $x))), explode(',', $c['extensions']['subjectAltName'] ?? ''));
    $names[] = strtolower($c['subject']['CN'] ?? '');
    $match = false;
    foreach ($names as $nm) {
        if ($nm !== '' && ($nm === strtolower($sni) || (str_starts_with($nm, '*.') && preg_match('/^[^.]+' . preg_quote(substr($nm, 1), '/') . '$/', strtolower($sni))))) {
            $match = true;
        }
    }
    if (!$match) {
        $why[] = "برای «{$sni}» صادر نشده (نام گواهی با SNI یکی نیست)";
    }
    if (($c['issuer'] ?? null) == ($c['subject'] ?? null)) {
        $why[] = 'self-signed (خودامضا)';
    }
    return $why ? implode(' + ', $why) : 'زنجیره گواهی ناقص یا صادرکننده نامعتبر (fullchain نصب نشده؟)';
}

/** WebSocket upgrade on an open stream (TLS) or a new TCP one: HTTP status line. */
function vc_ws($stream, string $host, string $path): string
{
    $path = $path === '' ? '/' : (str_starts_with($path, '/') ? $path : '/' . $path);
    $req = "GET $path HTTP/1.1\r\nHost: $host\r\nUser-Agent: Mozilla/5.0\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: " . base64_encode(random_bytes(16)) . "\r\n\r\n";
    stream_set_timeout($stream, 6);
    fwrite($stream, $req);
    $line = trim((string) fgets($stream));
    $server = '';
    while (($h = fgets($stream)) !== false && trim($h) !== '') {
        if (stripos($h, 'server:') === 0) {
            $server = trim(substr($h, 7));
        }
    }
    return ($line ?: 'بدون پاسخ (اتصال بسته شد)') . ($server ? " | server: $server" : '');
}

foreach ($users as $username) {
    $inv = select('invoice', '*', 'username', $username, 'select');
    $d = null;
    if ($inv) {
        echo "\n━━━━ $username | پنل: {$inv['Service_location']} | محصول: {$inv['name_product']}\n";
        $d = $panel->DataUser($inv['Service_location'], $username);
    } else {
        // made in the panel, not through the bot: look it up on every active panel
        foreach ($pdo->query("SELECT name_panel FROM marzban_panel WHERE status != 'disable'")->fetchAll(PDO::FETCH_COLUMN) as $pn) {
            $try = $panel->DataUser($pn, $username);
            if (($try['status'] ?? 'Unsuccessful') !== 'Unsuccessful') {
                $d = $try;
                echo "\n━━━━ $username | پنل: $pn | (در ربات ثبت نشده، فقط در پنل)\n";
                break;
            }
        }
        if (!$d) {
            echo "\n━━━━ $username: نه در ربات پیدا شد نه در پنل‌ها\n";
            $problems[] = "$username: پیدا نشد";
            continue;
        }
    }
    if (($d['status'] ?? '') === 'Unsuccessful') {
        echo "❌ پنل جواب نداد: " . ($d['msg'] ?? '') . "\n";
        $problems[] = "$username: پنل جواب نمی‌دهد";
        continue;
    }
    $gb = fn($b) => $b === null ? '∞' : round($b / 1073741824, 2) . ' GB';
    $st = (string) ($d['status'] ?? '?');
    echo "وضعیت: $st | مصرف: " . $gb($d['used_traffic'] ?? 0) . " از " . (empty($d['data_limit']) ? 'نامحدود' : $gb($d['data_limit']))
        . " | انقضا: " . (empty($d['expire']) ? 'ندارد' : date('Y-m-d H:i', (int) $d['expire']) . ((int) $d['expire'] < time() ? ' ❌ گذشته' : ''))
        . "\nآخرین اتصال: " . ($d['online_at'] ?? 'هرگز') . " | آخرین آپدیت ساب: " . ($d['sub_updated_at'] ?? '-') . " | اپ: " . ($d['sub_last_user_agent'] ?? '-') . "\n";
    if ($st !== 'active') {
        echo "⚠️ کاربر فعال نیست ($st): اپ پینگ می‌گیرد ولی سرور اتصال را قبول نمی‌کند\n";
        $problems[] = "$username: وضعیت $st";
    }
    $subUrl = (string) ($d['subscription_url'] ?? '');
    if ($subUrl !== '') {
        $ch = curl_init($subUrl);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15, CURLOPT_FOLLOWLOCATION => true, CURLOPT_USERAGENT => 'Happ/3.0']);
        $body = (string) curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        $dec = base64_decode(trim($body), true);
        $n = preg_match_all('#^[a-z0-9]+://#mi', $dec !== false && $dec !== '' ? $dec : $body);
        $host = parse_url($subUrl, PHP_URL_HOST);
        echo "لینک ساب (دامنه $host): " . ($code === 200 && $n ? "✅ باز می‌شود، $n کانفیگ" : "❌ HTTP $code " . ($err ?: ($n ? '' : 'بدون کانفیگ'))) . "\n";
        if ($code !== 200 || !$n) {
            $problems[] = "$username: لینک ساب کار نمی‌کند";
        }
    }
    $links = $d['links'] ?? [];
    $links = is_array($links) ? $links : explode("\n", (string) $links);
    $links = array_values(array_filter(array_map('trim', $links)));
    if (!$links) {
        echo "❌ هیچ کانفیگی در ساب نیست (اینباند/هاست به کاربر وصل نیست)\n";
        $problems[] = "$username: ساب خالی";
        continue;
    }
    foreach ($links as $i => $link) {
        $c = vc_parse($link);
        if (!$c) {
            continue;
        }
        $n = $i + 1;
        if (isset($c['error'])) {
            echo "  [$n] {$c['proto']}: {$c['error']}\n";
            continue;
        }
        $sni = $c['sni'] ?: ($c['hosthdr'] ?: $c['host']);
        echo "\n  [$n] {$c['name']}\n      {$c['proto']} | {$c['host']}:{$c['port']} | {$c['net']} | {$c['security']} | sni={$c['sni']} host={$c['hosthdr']} path={$c['path']} fp={$c['fp']} alpn={$c['alpn']}" . ($c['insecure'] ? ' | allowInsecure' : '') . "\n";
        if (in_array($c['host'], ['127.0.0.1', '0.0.0.0', 'localhost', ''], true)) {
            echo "      ❌ آدرس کانفیگ «{$c['host']}» است: در تنظیمات هاست پنل آدرس درست را بگذارید\n";
            $problems[] = "$username: آدرس کانفیگ $n نامعتبر";
            continue;
        }
        $ips = filter_var($c['host'], FILTER_VALIDATE_IP) ? [$c['host']] : (gethostbynamel($c['host']) ?: []);
        if (!$ips) {
            echo "      ❌ DNS: دامنه {$c['host']} به هیچ IP نمی‌رسد\n";
            $problems[] = "$username: DNS {$c['host']}";
            continue;
        }
        echo "      DNS: " . implode(', ', $ips) . "\n";
        [$ok, $ms] = vc_tcp($c['host'], $c['port']);
        if (!$ok) {
            echo "      ❌ پورت {$c['port']} باز نیست / جواب نمی‌دهد: $ms\n";
            $problems[] = "$username: پورت {$c['host']}:{$c['port']} بسته";
            continue;
        }
        echo "      TCP: ✅ {$ms}ms\n";
        if (in_array($c['security'], ['tls', 'xtls'], true)) {
            [$ok, $info, $cert, $s] = vc_tls($c['host'], $c['port'], $sni, true, $c['alpn']);
            if ($ok) {
                echo "      TLS: ✅ گواهی معتبر | " . vc_cert_text($cert) . "\n";
            } else {
                [$ok2, $info2, $cert2, $s] = vc_tls($c['host'], $c['port'], $sni, false, $c['alpn']);
                if (!$ok2) {
                    echo "      ❌ TLS: دست‌دادن انجام نشد ($info2) — روی این پورت TLS نیست یا SNI «{$sni}» قبول نمی‌شود\n";
                    $problems[] = "$username: TLS ناموفق {$c['host']}:{$c['port']}";
                    continue;
                }
                echo "      ❌ TLS: گواهی نامعتبر برای «{$sni}» | " . vc_cert_text($cert2) . "\n         علت: " . vc_reason($cert2, $sni) . "\n";
                echo $c['insecure'] ? "         (allowInsecure روشن است؛ بعضی اپ‌ها مثل Happ آن را نادیده می‌گیرند)\n" : '';
                $problems[] = "$username: گواهی نامعتبر {$sni}";
            }
            if ($s && in_array($c['net'], ['ws', 'httpupgrade'], true)) {
                echo "      WS: " . vc_ws($s, $c['hosthdr'] ?: $sni, $c['path']) . "\n";
            }
            $s && fclose($s);
        } elseif ($c['security'] === 'reality') {
            [$ok, $info, $cert, $s] = vc_tls($c['host'], $c['port'], $sni, false);
            if ($ok) {
                echo "      Reality: ✅ دست‌دادن انجام شد | گواهی dest: " . vc_cert_text($cert) . "\n";
                $s && fclose($s);
            } else {
                echo "      ❌ Reality: دست‌دادن با SNI «{$sni}» انجام نشد ($info) — dest/serverNames اینباند را چک کنید\n";
                $problems[] = "$username: reality {$c['host']}:{$c['port']}";
            }
            if (empty($c['pbk'])) {
                echo "      ❌ Reality بدون pbk (کلید عمومی) در لینک\n";
                $problems[] = "$username: reality بدون pbk";
            }
        } elseif (in_array($c['net'], ['ws', 'httpupgrade'], true)) {
            $s = @stream_socket_client("tcp://{$c['host']}:{$c['port']}", $no, $err, 6);
            if ($s) {
                echo "      WS: " . vc_ws($s, $c['hosthdr'] ?: $c['host'], $c['path']) . "\n";
                fclose($s);
            }
        }
    }
}

echo "\n━━━━ خلاصه\n";
echo $problems ? implode("\n", array_map(fn($p) => "❌ $p", array_unique($problems))) . "\n" : "✅ از این سرور همه کانفیگ‌ها سالم‌اند. اگر مشتری وصل نمی‌شود، مشکل از فیلترینگ داخل ایران (پورت/SNI/IP) یا ساعت گوشی/اپ مشتری است.\n";
echo "راهنما: WS «101 Switching Protocols» = سالم | 404/400 = path یا host اشتباه | «بدون پاسخ» = پشت CDN/پورت اشتباه\n";
