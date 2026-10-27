<?php
// Delete services: from the panel and their orders (invoice rows). Without --apply it only shows what would go.
//
//   php scripts/remove_service.php pichavpn_4550 pichavpn_9d63            # show
//   php scripts/remove_service.php pichavpn_4550 pichavpn_9d63 --apply    # delete
//   ... --apply --refund       also put the order price back into the customer's wallet
//
// A copy of every deleted order is kept in storage/removed_services.jsonl. Payments (Payment_report) are not touched.

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
$root = dirname(__DIR__);
chdir($root);
require $root . '/config.php';
require_once $root . '/botapi.php';
require_once $root . '/function.php';
require_once $root . '/panels.php';

$apply = in_array('--apply', $argv, true);
$refund = in_array('--refund', $argv, true);
$names = array_values(array_filter(array_slice($argv, 1), fn($a) => !str_starts_with($a, '--')));
if (!$names) {
    fwrite(STDERR, "php scripts/remove_service.php USERNAME [USERNAME…] [--apply] [--refund]\n");
    exit(1);
}
$panel = new ManagePanel();
$st = $pdo->prepare("SELECT * FROM invoice WHERE username = ?");
foreach ($names as $name) {
    $st->execute([$name]);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    echo "━━ $name\n";
    if (!$rows) {
        echo "   سفارشی با این نام نیست\n";
        continue;
    }
    foreach ($rows as $r) {
        echo "   سفارش {$r['id_invoice']} | کاربر {$r['id_user']} | {$r['name_product']} | " . number_format((float) $r['price_product']) . " تومان | {$r['Status']} | " . date('Y-m-d H:i', (int) $r['time_sell']) . " | {$r['Service_location']}\n";
    }
    $loc = $rows[0]['Service_location'];
    $d = $panel->DataUser($loc, $name);
    $onPanel = is_array($d) && ($d['status'] ?? '') !== 'Unsuccessful' && ($d['msg'] ?? '') !== 'User not found';
    $gone = is_array($d) && in_array($d['msg'] ?? '', ['User not found', 'Panel Not Found'], true); // no such user / that location no longer exists in the bot
    echo "   روی پنل «{$loc}»: " . ($onPanel ? "هست ({$d['status']})" : ($gone ? 'نیست' : '⚠️ جواب نداد: ' . json_encode($d, JSON_UNESCAPED_UNICODE))) . "\n";
    if (!$onPanel && !$gone) { // panel unreachable: never delete the order while the service may still exist
        echo "   سفارش‌ها دست نخوردند (اول پنل باید جواب بدهد)\n";
        continue;
    }
    if (!$apply) {
        continue;
    }
    if ($onPanel) {
        $res = $panel->RemoveUser($loc, $name);
        $after = $panel->DataUser($loc, $name); // judged by the panel itself: the user must be gone
        $ok = is_array($after) && ($after['msg'] ?? '') === 'User not found';
        echo $ok ? "   ✅ از پنل پاک شد\n" : "   ❌ پاک کردن از پنل نشد: " . json_encode($res, JSON_UNESCAPED_UNICODE) . "\n";
        if (!$ok) {
            echo "   سفارش‌ها دست نخوردند\n";
            continue;
        }
    }
    foreach ($rows as $r) {
        file_put_contents($root . '/storage/removed_services.jsonl', json_encode(['at' => date('c'), 'invoice' => $r], JSON_UNESCAPED_UNICODE) . "\n", FILE_APPEND | LOCK_EX);
        $pdo->prepare("DELETE FROM invoice WHERE id_invoice = ?")->execute([$r['id_invoice']]);
        echo "   ✅ سفارش {$r['id_invoice']} پاک شد\n";
        if ($refund && (float) $r['price_product'] > 0) {
            $pdo->prepare("UPDATE user SET Balance = Balance + ? WHERE id = ?")->execute([(int) $r['price_product'], $r['id_user']]);
            echo "   💰 " . number_format((float) $r['price_product']) . " تومان به کیف پول {$r['id_user']} برگشت\n";
        }
    }
}
if (!$apply) {
    echo "\nفقط نمایش بود. برای پاک کردن: آخر دستور --apply بگذارید\n";
}
