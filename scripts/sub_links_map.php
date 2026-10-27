<?php
// Old subscription links (https://<bot domain>/sub/<order>) → each customer's own PasarGuard link (https://dmc…/sub/<token>).
// Writes a map for Apache (pasarguard/apache-sub-redirect.conf) so the old links keep working without the bot server.
//
//   php scripts/sub_links_map.php                       # writes /root/picha-sub-map.txt and prints a summary
//   php scripts/sub_links_map.php --out=/path/map.txt
// Reads only (the panels' user lists). Run it again right before moving the bot domain, so the newest orders are in it.

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
$root = dirname(__DIR__);
chdir($root);
require $root . '/config.php';
require_once $root . '/function.php';
require_once $root . '/panels/Api/Marzban.php';

$out = '/root/picha-sub-map.txt';
foreach ($argv as $a) {
    if (str_starts_with($a, '--out=')) {
        $out = substr($a, 6);
    }
}

/** username => absolute subscription link, for one Marzban-family panel (paged list, one request per 500 users) */
function panelSubLinks(array $panel): array
{
    $tok = token_panel($panel['code_panel']);
    if (empty($tok['access_token'])) {
        fwrite(STDERR, "⚠️ ورود به پنل «{$panel['name_panel']}» نشد\n");
        return [];
    }
    $links = [];
    for ($offset = 0; $offset < 200000; $offset += 500) {
        $ch = curl_init(rtrim($panel['url_panel'], '/') . "/api/users?offset=$offset&limit=500");
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60,
            CURLOPT_HTTPHEADER => ['Accept: application/json', 'Authorization: Bearer ' . $tok['access_token']]]);
        $body = json_decode((string) curl_exec($ch), true);
        $users = $body['users'] ?? [];
        foreach ($users as $u) {
            if (!empty($u['username']) && !empty($u['subscription_url'])) {
                $native = absoluteSubscriptionUrl($u['subscription_url'], $panel['url_panel']);
                $links[$u['username']] = panelNativeSubUrl($panel, $native); // the subscription domain when one is set (linksubx)
            }
        }
        if (count($users) < 500) {
            break;
        }
    }
    return $links;
}

$panels = $pdo->query("SELECT * FROM marzban_panel WHERE type IN ('marzban','marzneshin')")->fetchAll(PDO::FETCH_ASSOC);
$byPanel = [];
foreach ($panels as $p) {
    $byPanel[$p['name_panel']] = panelSubLinks($p);
    echo "پنل «{$p['name_panel']}»: " . count($byPanel[$p['name_panel']]) . " کاربر\n";
}
$rows = $pdo->query("SELECT id_invoice, username, Service_location FROM invoice")->fetchAll(PDO::FETCH_ASSOC);
$lines = [];
$miss = 0;
foreach ($rows as $r) {
    $url = $byPanel[$r['Service_location']][$r['username']] ?? null;
    if ($url && preg_match('/^[A-Za-z0-9_-]+$/', $r['id_invoice']) && !preg_match('/\s/', $url)) {
        $lines[] = $r['id_invoice'] . ' ' . $url;
    } else {
        $miss++;
    }
}
@mkdir(dirname($out), 0755, true);
file_put_contents($out, "# picha: old /sub/<order> → panel link (" . date('c') . ")\n" . implode("\n", $lines) . "\n");
echo "✅ " . count($lines) . " لینک در $out (" . $miss . " سفارش بدون سرویس روی پنل — حذف‌شده یا منقضی‌شده‌ی پاک‌شده)\n";
