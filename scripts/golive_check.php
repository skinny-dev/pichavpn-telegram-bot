<?php
/*
 * Production readiness / health check for a Picha bot server. Read-only: it changes nothing.
 *
 *   php scripts/golive_check.php                       # full check on the server (needs internet)
 *   php scripts/golive_check.php --domain=fa-bot.example.com
 *   php scripts/golive_check.php --offline             # skip Telegram / panel / DNS / HTTPS checks
 *   php scripts/golive_check.php --json                # machine readable
 *
 * Exit code 0 = no FAIL (WARN are advice), 1 = at least one FAIL (do NOT go live).
 * Secrets (bot token, panel passwords) are never printed.
 */
chdir(__DIR__ . '/..');
$opts = getopt('', ['domain::', 'offline', 'json', 'app::']);
$offline = isset($opts['offline']);
$asJson = isset($opts['json']);
$expectDomain = $opts['domain'] ?? null;

$results = [];
function res(string $level, string $what, string $detail = ''): void
{
    global $results, $asJson;
    $results[] = [$level, $what, $detail];
    if (!$asJson) {
        $tag = ['PASS' => "\033[32mPASS\033[0m", 'WARN' => "\033[33mWARN\033[0m", 'FAIL' => "\033[31mFAIL\033[0m", 'INFO' => 'INFO'][$level];
        echo "  [$tag] $what" . ($detail !== '' ? " — $detail" : '') . "\n";
    }
}
function section(string $t): void
{
    global $asJson;
    if (!$asJson) {
        echo "\n== $t ==\n";
    }
}
function sh(string $cmd): string
{
    return trim((string) @shell_exec('( ' . $cmd . ' ) 2>/dev/null'));
}
function http(string $url, array $post = null, int $timeout = 12): array
{
    $ch = curl_init($url);
    $o = [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => $timeout, CURLOPT_CONNECTTIMEOUT => 8, CURLOPT_FOLLOWLOCATION => false];
    if ($post !== null) {
        $o[CURLOPT_POST] = true;
        $o[CURLOPT_POSTFIELDS] = is_array($post) ? http_build_query($post) : $post;
    }
    curl_setopt_array($ch, $o);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    return ['code' => $code, 'body' => (string) $body, 'err' => $err];
}

// ---------------------------------------------------------------- config
section('Configuration');
if (!is_file('config.php')) {
    res('FAIL', 'config.php exists', 'missing');
    finish();
}
$raw = file_get_contents('config.php');
if (preg_match('/\{[a-z_]+\}/i', $raw, $m)) {
    res('FAIL', 'config.php has no placeholders left', "found {$m[0]} — run the installer / set the value");
} else {
    res('PASS', 'config.php has no placeholders left');
}
error_reporting(0);
ob_start();
include 'config.php';
ob_end_clean();
error_reporting(E_ALL & ~E_NOTICE & ~E_DEPRECATED);
$domain = preg_replace('#/.*$#', '', (string) ($domainhosts ?? ''));
$token = (string) ($APIKEY ?? '');
$botUser = (string) ($usernamebot ?? '');
if (preg_match('/^\d{6,}:[A-Za-z0-9_-]{30,}$/', $token)) {
    res('PASS', 'bot token has the right shape (not shown)');
} else {
    res('FAIL', 'bot token has the right shape', 'APIKEY is empty or malformed');
}
if ($domain === '' || str_contains($domain, '{')) {
    res('FAIL', 'domain is set in config.php');
} elseif ($expectDomain && strcasecmp($domain, $expectDomain) !== 0) {
    res('FAIL', 'domain matches expected', "config has $domain, expected $expectDomain");
} else {
    res('PASS', 'domain', $domain);
}
if (is_dir('install')) {
    res('FAIL', 'web installer folder removed', 'install/ still exists: the bot answers 403 to Telegram while it exists');
} else {
    res('PASS', 'web installer folder removed');
}
if (is_file('.git') || is_dir('.git')) {
    res('WARN', 'no .git folder inside the web root', 'it would expose history over the web');
}
$perm = @fileperms('config.php');
if ($perm !== false && ($perm & 0004)) {
    res('WARN', 'config.php is not world-readable', 'run: chmod 640 config.php (owner root/www-data)');
} else {
    res('PASS', 'config.php permissions');
}
$phpv = PHP_VERSION;
version_compare($phpv, '8.0', '>=') ? res('PASS', 'PHP version', $phpv) : res('FAIL', 'PHP version >= 8.0', $phpv);
foreach (['mbstring', 'curl', 'pdo_mysql', 'json', 'zip', 'gd'] as $ext) {
    extension_loaded($ext) ? res('PASS', "PHP extension $ext") : res('FAIL', "PHP extension $ext", 'missing');
}

// ---------------------------------------------------------------- database
section('Database');
if (!isset($pdo) || !($pdo instanceof PDO)) {
    res('FAIL', 'database connection');
    finish();
}
res('PASS', 'database connection');
$need = ['user', 'invoice', 'Payment_report', 'product', 'category', 'marzban_panel', 'setting', 'PaySetting', 'admin', 'sms_inbox', 'card_number'];
$have = $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
$missing = array_values(array_diff($need, $have));
$missing ? res('FAIL', 'required tables exist', 'missing: ' . implode(', ', $missing) . ' — run: php table.php') : res('PASS', 'required tables exist');
$cnt = fn(string $sql) => (int) $pdo->query($sql)->fetchColumn();
$ps = function (string $k) use ($pdo) {
    $s = $pdo->prepare('SELECT ValuePay FROM PaySetting WHERE NamePay = ?');
    $s->execute([$k]);
    return $s->fetchColumn();
};
res('INFO', 'users', (string) $cnt('SELECT COUNT(*) FROM user') . ' (agents: ' . $cnt("SELECT COUNT(*) FROM user WHERE agent <> 'f'") . ')');
$admins = $cnt('SELECT COUNT(*) FROM admin');
$admins > 0 ? res('PASS', 'at least one bot admin', (string) $admins) : res('FAIL', 'at least one bot admin', 'nobody can approve payments');
$charset = $pdo->query("SELECT @@character_set_database")->fetchColumn();
res('INFO', 'database charset', (string) $charset);

// ---------------------------------------------------------------- payments / safety switches
section('Payment settings');
$auto = $ps('autoconfirmcart');
$auto === 'onauto'
    ? res('FAIL', 'blind auto-approve timer is OFF', 'autoconfirmcart=onauto approves receipts without checking the bank: turn it off')
    : res('PASS', 'blind auto-approve timer is OFF');
$ps('Cartstatus') === 'oncard' ? res('PASS', 'card-to-card enabled') : res('WARN', 'card-to-card enabled', 'customers cannot pay by card');
$cards = $cnt('SELECT COUNT(*) FROM card_number');
$cards > 0 ? res('PASS', 'at least one bank card configured', (string) $cards) : res('WARN', 'at least one bank card configured', 'card-to-card has no card number to show');
$sms = $ps('smsautoconfirm') === 'onsms';
$smsTok = strlen((string) $ps('sms_webhook_token')) > 0;
if ($sms && !$smsTok) {
    res('FAIL', 'SMS auto-approval has a token', 'enabled but no token: run scripts/sms_setup.php token');
} elseif (!$sms && $smsTok) {
    res('WARN', 'SMS webhook token is not left active while SMS approval is OFF', 'a live token with the feature off still accepts requests: clear it (UPDATE PaySetting SET ValuePay=\'\' WHERE NamePay=\'sms_webhook_token\')');
} else {
    res('PASS', 'SMS auto-approval state is consistent', $sms ? 'ON' : 'OFF');
}
$vz = $ps('variza_status') === 'onvariza';
if ($vz) {
    $sec = (string) $ps('variza_webhook_secret');
    $api = (string) $ps('variza_api_token');
    ($sec !== '' && $sec !== '0' && $api !== '' && $api !== '0')
        ? res('PASS', 'Variza enabled and configured')
        : res('FAIL', 'Variza enabled and configured', 'webhook secret or API token is missing');
} else {
    res('PASS', 'Variza is OFF', 'fine if you do not use it');
}
$stuck = $cnt("SELECT COUNT(*) FROM Payment_report WHERE payment_Status IN ('waiting') AND Payment_Method IN ('cart to cart','variza')");
$stuck > 0 ? res('WARN', 'pending receipts waiting for an admin', (string) $stuck) : res('PASS', 'no receipts waiting for an admin');

// ---------------------------------------------------------------- catalog
section('Catalog (what customers see)');
$panels = $pdo->query("SELECT * FROM marzban_panel WHERE status = 'active'")->fetchAll(PDO::FETCH_ASSOC);
if (!$panels) {
    res('FAIL', 'an active panel exists', 'customers cannot buy anything');
}
foreach ($panels as $p) {
    $q = $pdo->prepare("SELECT COUNT(*) FROM product WHERE (Location = ? OR Location = '/all') AND agent = 'f'");
    $q->execute([$p['name_panel']]);
    $n = (int) $q->fetchColumn();
    $n > 0 ? res('PASS', "products for normal customers on «{$p['name_panel']}»", (string) $n) : res('FAIL', "products for normal customers on «{$p['name_panel']}»", 'none: the buy screen would be empty');
    if (($p['inbounds'] ?? 'null') === null || ($p['inbounds'] ?? '') === 'null' || ($p['proxies'] ?? '') === '' || ($p['proxies'] ?? '{}') === '{}') {
        res('FAIL', "protocols/inbounds set on «{$p['name_panel']}»", 'use «⚙️ تنظیم پروتکل و اینباند» in the bot');
    } else {
        res('PASS', "protocols/inbounds set on «{$p['name_panel']}»");
    }
}
$orph = $cnt("SELECT COUNT(*) FROM product p WHERE p.agent='f' AND p.category <> '' AND NOT EXISTS (SELECT 1 FROM category c WHERE LOWER(TRIM(c.remark)) = LOWER(TRIM(p.category)))");
$orph === 0 ? res('PASS', 'every product category matches a category row') : res('WARN', 'products whose category matches no category row (hidden from customers)', (string) $orph);
$badLoc = $cnt("SELECT COUNT(*) FROM product p WHERE p.Location <> '/all' AND NOT EXISTS (SELECT 1 FROM marzban_panel m WHERE m.name_panel = p.Location)");
$badLoc === 0 ? res('PASS', 'every product points to an existing panel') : res('FAIL', 'products pointing to a panel that does not exist', (string) $badLoc);

// ---------------------------------------------------------------- network
if (!$offline) {
    section('Internet-facing checks');
    $ip = trim(http('https://api.ipify.org', null, 6)['body']);
    $dns = $domain !== '' ? array_unique(array_map(fn($r) => $r['ip'] ?? '', dns_get_record($domain, DNS_A) ?: [])) : [];
    if (!$dns) {
        res('FAIL', 'DNS A record exists', "$domain does not resolve");
    } elseif ($ip !== '' && !in_array($ip, $dns, true)) {
        res('FAIL', 'DNS points to this server', "$domain -> " . implode(',', $dns) . " but this server is $ip (a Cloudflare orange cloud also shows this: use DNS-only)");
    } else {
        res('PASS', 'DNS points to this server', implode(',', $dns));
    }
    $cert = sh("echo | openssl s_client -servername $domain -connect $domain:443 2>/dev/null | openssl x509 -noout -enddate");
    if (preg_match('/notAfter=(.+)/', $cert, $m)) {
        $days = (int) floor((strtotime($m[1]) - time()) / 86400);
        $days >= 14 ? res('PASS', 'SSL certificate valid', "$days days left") : res('FAIL', 'SSL certificate valid', "only $days days left");
    } else {
        res('FAIL', 'SSL certificate valid', 'cannot read a certificate on port 443');
    }
    $r = http("https://$domain/index.php", ['x' => 1]);
    in_array($r['code'], [200, 400, 401, 405], true)
        ? res('PASS', 'bot URL answers', "HTTP {$r['code']}")
        : res('FAIL', 'bot URL answers', "HTTP {$r['code']} {$r['err']} (403 = installer/.htaccess blocking)");

    section('Telegram');
    $me = json_decode(http("https://api.telegram.org/bot$token/getMe")['body'], true);
    if (!($me['ok'] ?? false)) {
        res('FAIL', 'Telegram accepts the bot token', $me['description'] ?? 'no answer');
    } else {
        res('PASS', 'Telegram accepts the bot token', '@' . $me['result']['username']);
        strcasecmp(ltrim($botUser, '@'), $me['result']['username']) === 0
            ? res('PASS', 'usernamebot matches the token')
            : res('WARN', 'usernamebot matches the token', "config says '$botUser'");
    }
    $wh = json_decode(http("https://api.telegram.org/bot$token/getWebhookInfo")['body'], true)['result'] ?? [];
    $url = $wh['url'] ?? '';
    if ($url === '') {
        res('FAIL', 'webhook is set', 'run: php table.php');
    } elseif (!str_contains($url, $domain)) {
        res('FAIL', 'webhook points to this domain', 'it points to ' . parse_url($url, PHP_URL_HOST));
    } else {
        res('PASS', 'webhook points to this domain');
    }
    !empty($wh['last_error_message']) ? res('FAIL', 'Telegram reports no delivery errors', $wh['last_error_message']) : res('PASS', 'Telegram reports no delivery errors');
    ($wh['pending_update_count'] ?? 0) > 100 ? res('WARN', 'few pending updates', (string) $wh['pending_update_count']) : res('PASS', 'pending updates', (string) ($wh['pending_update_count'] ?? 0));

    section('VPN panels');
    foreach ($panels as $p) {
        $r = http(rtrim($p['url_panel'], '/') . '/api/admin/token', ['username' => $p['username_panel'], 'password' => $p['password_panel']], 15);
        $r['code'] === 200
            ? res('PASS', "panel login «{$p['name_panel']}»", 'HTTP 200')
            : res('FAIL', "panel login «{$p['name_panel']}»", 'HTTP ' . $r['code'] . ' ' . $r['err'] . ' (wrong credentials/URL, or the panel blocks this server)');
    }
}

// ---------------------------------------------------------------- system
section('Server');
$cronOn = sh('systemctl is-active cron');
res('INFO', 'cron service', $cronOn ?: 'unknown');
$crontab = sh('crontab -l') . sh('cat /etc/cron.d/* /var/spool/cron/crontabs/* 2>/dev/null');
str_contains($crontab, 'picha-backup') || is_file('/etc/cron.d/picha-backup')
    ? res('PASS', 'daily backup is scheduled')
    : res('WARN', 'daily backup is scheduled', 'run: bash scripts/picha-backup.sh --install-cron');
$pass = '/root/.picha-backup-pass';
is_file($pass) ? res('PASS', 'backup password file exists', 'COPY IT OFF this server (a backup without its password is useless)') : res('WARN', 'backup password file exists');
$free = disk_free_space('/');
$tot = disk_total_space('/');
$pct = $tot ? round($free / $tot * 100) : 0;
$pct >= 15 ? res('PASS', 'free disk space', "$pct%") : res('WARN', 'free disk space', "$pct% left");
$timer = sh('systemctl list-timers --all | grep -i certbot') ?: sh('ls /etc/cron.d/certbot');
$timer !== '' ? res('PASS', 'SSL auto-renew scheduled') : res('WARN', 'SSL auto-renew scheduled', 'certbot timer not found');
$ssh = sh('grep -Ei "^\s*PasswordAuthentication" /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf');
(stripos($ssh, 'no') !== false) ? res('PASS', 'SSH password login disabled') : res('WARN', 'SSH password login disabled', 'use SSH keys, then set PasswordAuthentication no');
$ufw = sh('ufw status');
str_contains($ufw, 'active') ? res('PASS', 'firewall (ufw) active') : res('WARN', 'firewall (ufw) active', 'ports 22/80/443 only is enough');
$tz = date_default_timezone_get();
res('INFO', 'PHP timezone', $tz . ' (the bot sets Asia/Tehran itself where needed)');
is_writable('storage') ? res('PASS', 'storage/ is writable') : res('FAIL', 'storage/ is writable', 'chown -R www-data:www-data storage');

finish();

function finish(): void
{
    global $results, $asJson;
    $c = ['PASS' => 0, 'WARN' => 0, 'FAIL' => 0, 'INFO' => 0];
    foreach ($results as $r) {
        $c[$r[0]]++;
    }
    if ($asJson) {
        echo json_encode(['counts' => $c, 'results' => $results], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
    } else {
        echo "\n== Summary: {$c['PASS']} passed, {$c['WARN']} warnings, {$c['FAIL']} FAILED ==\n";
        echo $c['FAIL'] ? "NOT READY: fix every FAIL above before going live.\n" : "READY: no blocking problems" . ($c['WARN'] ? ' (read the warnings).' : '.') . "\n";
    }
    exit($c['FAIL'] ? 1 : 0);
}
