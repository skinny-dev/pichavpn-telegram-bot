<?php
/*
 * Compare what a customer gets from the panel's own subscription link and from the bot's link /sub/<invoice id>.
 *   php scripts/sub_check.php              # the newest active service
 *   php scripts/sub_check.php INVOICE_ID   # a specific service (the id at the end of https://<bot domain>/sub/<id>)
 * Prints the number of configs in each answer, the locations found in them, and says what is wrong if they differ.
 */
if (PHP_SAPI !== 'cli') {
    exit;
}
chdir(__DIR__ . '/..');
require_once 'config.php';
require_once 'function.php';

function subConfigs(string $body): array
{
    $t = trim($body);
    if ($t !== '' && strpos($t, '://') === false) {
        $d = base64_decode($t, true);
        if ($d !== false && strpos($d, '://') !== false) {
            $t = $d;
        }
    }
    $out = [];
    foreach (preg_split('/\s+/', $t) as $line) {
        if (preg_match('#^[a-z0-9]+://#i', $line)) {
            $out[] = $line;
        }
    }
    return $out;
}

function subNames(array $links): array
{
    return array_map(fn($l) => strpos($l, '#') !== false ? urldecode(substr($l, strrpos($l, '#') + 1)) : '(no name)', $links);
}

$id = $argv[1] ?? '';
if ($id === '') {
    $id = (string) $pdo->query("SELECT id_invoice FROM invoice WHERE Status IN ('active','send_on_hold','sendedwarn') ORDER BY CAST(time_sell AS UNSIGNED) DESC LIMIT 1")->fetchColumn();
}
$inv = select("invoice", "*", "id_invoice", $id, "select");
if (!is_array($inv)) {
    exit("invoice not found: $id\n");
}
$panel = select("marzban_panel", "*", "name_panel", $inv['Service_location'], "select");
echo "service: {$inv['username']} · panel: {$panel['name_panel']} ({$panel['type']}) · sub mode: " . (($panel['subproxy'] ?? 'onsubproxy') === 'offsubproxy' ? "panel's own link" : 'bot domain link') . "\n";

$raw = getuser($inv['username'], $panel['name_panel']);
$ud = is_array($raw) ? json_decode($raw['body'] ?? '', true) : null;
if (!is_array($ud) || empty($ud['subscription_url'])) {
    exit("cannot read the user from the panel (login/URL problem?): " . json_encode($raw, JSON_UNESCAPED_UNICODE) . "\n");
}
$native = panelNativeSubUrl($panel, absoluteSubscriptionUrl($ud['subscription_url'], $panel['url_panel']));
echo "native subscription URL: " . preg_replace('#/sub/.+#', '/sub/…', $native) . "\n";
$ua = 'v2rayN/6.0';
$rel = fetchNativeSubscription($native, $ua);
$nativeLinks = $rel ? subConfigs($rel['body']) : [];
echo $rel ? "A) panel's own link   : " . count($nativeLinks) . " configs · headers: " . implode(',', array_keys($rel['headers'])) . "\n" : "A) panel's own link   : FAILED to fetch from this server (firewall / port / domain?)\n";

$botUrl = 'https://' . $domainhosts . '/sub/' . $inv['id_invoice'];
$ch = curl_init($botUrl);
curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20, CURLOPT_USERAGENT => $ua, CURLOPT_SSL_VERIFYPEER => false, CURLOPT_FOLLOWLOCATION => true]);
$body = (string) curl_exec($ch);
$code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
curl_close($ch);
$botLinks = subConfigs($body);
echo "B) bot link /sub/<id>  : " . count($botLinks) . " configs (HTTP $code)\n\n";
echo "locations in A: " . implode(' | ', array_unique(subNames($nativeLinks))) . "\n";
echo "locations in B: " . implode(' | ', array_unique(subNames($botLinks))) . "\n\n";
if (!$rel) {
    echo "=> the bot cannot reach the panel's subscription URL, so /sub/<id> falls back to the old reduced list.\n   Fix: make sure this server can open that URL (curl -sk URL), or set the right domain: php scripts/sub_mode.php domain \"{$panel['name_panel']}\" https://dmc.example.com:8000\n";
} elseif (count($botLinks) === count($nativeLinks) && $botLinks) {
    echo "=> OK: both links give the same number of configs.\n";
} elseif (count($botLinks) < count($nativeLinks)) {
    echo "=> the bot link still gives fewer configs: the new code is probably not deployed on this server (or the web server caches/old opcache).\n";
} else {
    echo "=> the bot link gives MORE configs than the panel link: check the Hosts of the panel.\n";
}
if (count($nativeLinks) <= 1) {
    echo "NOTE: even the panel's own link has only " . count($nativeLinks) . " config(s) for this user; then the missing locations are not assigned to this user/group in PasarGuard (Hosts / Groups), not a bot problem.\n";
}
