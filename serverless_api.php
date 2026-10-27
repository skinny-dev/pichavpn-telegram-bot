<?php
// Read-only data for the dev bot that runs on Telegram Serverless (folder serverless/).
// The serverless bot calls:  POST https://<domain>/serverless_api.php   header X-Picha-Key: <key>   body {"a": "...", ...}
// Off until `php scripts/serverless_setup.php key` makes a key (storage/serverless.json). Nothing here changes data.
//
//   a=ping                          → {"ok":true,"brand":...}
//   a=catalog                       → categories → products (normal customers), active locations, running promotion
//   a=user     tg_id               → balance + services of that Telegram user
//   a=service  tg_id, username     → live usage of one of that user's services (from the panel)
//   a=admin    tg_id               → is that Telegram user a panel admin

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function sapi_out(array $d, int $code = 200): void
{
    http_response_code($code);
    echo json_encode($d, JSON_UNESCAPED_UNICODE);
    exit;
}

$cfgFile = __DIR__ . '/storage/serverless.json';
$cfg = is_file($cfgFile) ? (json_decode((string) file_get_contents($cfgFile), true) ?: []) : [];
$key = (string) ($cfg['key'] ?? '');
$mainKey = (string) ($cfg['main_key'] ?? '');
if (($key === '' && $mainKey === '') || ($cfg['enabled'] ?? true) === false) {
    sapi_out(['ok' => false, 'error' => 'off'], 404);
}
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    sapi_out(['ok' => false, 'error' => 'method'], 405);
}
$given = (string) ($_SERVER['HTTP_X_PICHA_KEY'] ?? '');
if ($given === '' || !(($key !== '' && hash_equals($key, $given)) || ($mainKey !== '' && hash_equals($mainKey, $given)))) {
    usleep(300000);
    sapi_out(['ok' => false, 'error' => 'key'], 401);
}
$in = json_decode((string) file_get_contents('php://input'), true);
$in = is_array($in) ? $in : [];
$a = (string) ($in['a'] ?? '');

chdir(__DIR__);
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/function.php';
date_default_timezone_set('Asia/Tehran');

$tgId = isset($in['tg_id']) && preg_match('/^\d{1,20}$/', (string) $in['tg_id']) ? (string) $in['tg_id'] : '';
const SAPI_LIVE = "('active','end_of_time','end_of_volume','sendedwarn','send_on_hold')";

try {
    switch ($a) {
        case 'ping':
            sapi_out(['ok' => true, 'brand' => 'پیچا', 'time' => time()]);

        case 'catalog':
            $off = [];
            foreach ($pdo->query("SELECT remark FROM category WHERE status = 'disable'")->fetchAll(PDO::FETCH_COLUMN) as $r) {
                $off[mb_strtolower(trim((string) $r), 'UTF-8')] = true;
            }
            $panels = $pdo->query("SELECT name_panel FROM marzban_panel WHERE status = 'active' AND (agent IN ('f','all') OR agent IS NULL) AND type <> 'Manualsale'")->fetchAll(PDO::FETCH_COLUMN);
            $promo = is_file(__DIR__ . '/storage/promo.json') ? json_decode((string) file_get_contents(__DIR__ . '/storage/promo.json'), true) : null; // promo_lib.php PROMO_FILE
            $orig = [];
            foreach ((is_array($promo) ? ($promo['items'] ?? []) : []) as $it) {
                $orig[(string) $it['id']] = (int) $it['old_price'];
            }
            $products = $pdo->query("SELECT id, name_product, price_product, Volume_constraint, Service_time, Location, category FROM product
                WHERE agent = 'f' AND (status_product IS NULL OR status_product <> 'disable') ORDER BY CAST(sort_order AS SIGNED), id")->fetchAll(PDO::FETCH_ASSOC);
            $byCat = [];
            foreach ($products as $p) {
                $k = mb_strtolower(trim((string) $p['category']), 'UTF-8');
                if (isset($off[$k])) {
                    continue;
                }
                $byCat[$k][] = [
                    'id' => (int) $p['id'], 'name' => $p['name_product'], 'price' => (int) $p['price_product'],
                    'old_price' => isset($orig[(string) $p['id']]) && $orig[(string) $p['id']] > (int) $p['price_product'] ? $orig[(string) $p['id']] : null,
                    'gb' => (float) $p['Volume_constraint'], 'days' => (int) $p['Service_time'], 'location' => $p['Location'],
                ];
            }
            $cats = [];
            foreach ($pdo->query("SELECT id, remark FROM category ORDER BY (CAST(sort_order AS SIGNED) <= 0), CAST(sort_order AS SIGNED), id")->fetchAll(PDO::FETCH_ASSOC) as $c) {
                $k = mb_strtolower(trim((string) $c['remark']), 'UTF-8');
                if (!empty($byCat[$k])) {
                    $cats[] = ['id' => (int) $c['id'], 'name' => $c['remark'], 'products' => $byCat[$k]];
                }
            }
            sapi_out(['ok' => true, 'categories' => $cats, 'locations' => array_values($panels),
                'promo' => is_array($promo) && (int) ($promo['ends_at'] ?? 0) > time() ? ['title' => $promo['title'] ?? '', 'ends_at' => (int) $promo['ends_at']] : null]);

        case 'user':
            if ($tgId === '') {
                sapi_out(['ok' => false, 'error' => 'tg_id'], 400);
            }
            $st = $pdo->prepare("SELECT id, Balance, agent, User_Status, register FROM user WHERE id = ?");
            $st->execute([$tgId]);
            $u = $st->fetch(PDO::FETCH_ASSOC);
            if (!$u) {
                sapi_out(['ok' => true, 'exists' => false]);
            }
            $st = $pdo->prepare("SELECT username, name_product, Service_location, Status, time_sell, Volume, Service_time FROM invoice
                WHERE id_user = ? AND Status IN " . SAPI_LIVE . " ORDER BY time_sell DESC LIMIT 50");
            $st->execute([$tgId]);
            $services = array_map(fn($r) => ['username' => $r['username'], 'product' => $r['name_product'], 'location' => $r['Service_location'],
                'status' => $r['Status'], 'bought' => (int) $r['time_sell'], 'gb' => (float) $r['Volume'], 'days' => (int) $r['Service_time']], $st->fetchAll(PDO::FETCH_ASSOC));
            sapi_out(['ok' => true, 'exists' => true, 'balance' => (int) $u['Balance'], 'agent' => $u['agent'], 'blocked' => $u['User_Status'] === 'block',
                'services' => $services]);

        case 'service':
            $name = (string) ($in['username'] ?? '');
            if ($tgId === '' || $name === '' || strlen($name) > 64) {
                sapi_out(['ok' => false, 'error' => 'tg_id/username'], 400);
            }
            $st = $pdo->prepare("SELECT * FROM invoice WHERE id_user = ? AND username = ? AND Status IN " . SAPI_LIVE . " LIMIT 1");
            $st->execute([$tgId, $name]);
            $inv = $st->fetch(PDO::FETCH_ASSOC);
            if (!$inv) {
                sapi_out(['ok' => false, 'error' => 'not_found'], 404);
            }
            require_once __DIR__ . '/botapi.php';
            require_once __DIR__ . '/panels.php';
            $panel = select('marzban_panel', '*', 'name_panel', $inv['Service_location'], 'select');
            $d = (new ManagePanel())->DataUser($inv['Service_location'], $inv['username']);
            if (!is_array($d) || ($d['status'] ?? '') === 'Unsuccessful') {
                sapi_out(['ok' => true, 'live' => false, 'msg' => $d['msg'] ?? 'panel']);
            }
            sapi_out(['ok' => true, 'live' => true, 'username' => $inv['username'], 'product' => $inv['name_product'], 'location' => $inv['Service_location'],
                'status' => $d['status'] ?? 'Unknown', 'data_limit' => (int) ($d['data_limit'] ?? 0), 'used' => (int) ($d['used_traffic'] ?? 0),
                'expire' => (int) ($d['expire'] ?? 0), 'online_at' => $d['online_at'] ?? null,
                'sub' => is_array($panel) && ($panel['sublink'] ?? '') === 'onsublink' ? (string) ($d['subscription_url'] ?? '') : '']);

        case 'admin':
            if ($tgId === '') {
                sapi_out(['ok' => false, 'error' => 'tg_id'], 400);
            }
            $st = $pdo->prepare("SELECT rule FROM admin WHERE id_admin = ?");
            $st->execute([$tgId]);
            $rule = (string) ($st->fetchColumn() ?: '');
            sapi_out(['ok' => true, 'admin' => in_array($rule, ['administrator', 'support'], true), 'rule' => $rule,
                'panel_url' => 'https://' . $domainhosts . '/dashboard/']);
    }
    sapi_out(['ok' => false, 'error' => 'unknown'], 400);
} catch (Throwable $e) {
    error_log('serverless_api: ' . $e->getMessage());
    sapi_out(['ok' => false, 'error' => 'server'], 500);
}
