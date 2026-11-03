<?php
/*
 * Tetraminator gateway (tetraminator.com). Run on the bot server, from the bot folder:
 *   php scripts/tetra_setup.php key          # the API key is typed into a HIDDEN prompt (or: TETRA_KEY=... php scripts/tetra_setup.php key)
 *   php scripts/tetra_setup.php on | off     # show / hide the button in the payment menu
 *   php scripts/tetra_setup.php limits MIN MAX   # toman; the gateway's own minimum is 50000
 *   php scripts/tetra_setup.php test         # makes one real 50,000 toman invoice (unpaid, harmless) and prints its pay link
 *   php scripts/tetra_setup.php status
 * The key lives only in the PaySetting table (never in the repository).
 */
if (PHP_SAPI !== 'cli') {
    exit;
}
chdir(__DIR__ . '/..');
require_once 'config.php';
require_once 'function.php';
require_once 'tetraminator.php';
$cmd = $argv[1] ?? 'status';
$set = fn(string $k, string $v) => $pdo->prepare("INSERT INTO PaySetting (NamePay,ValuePay) VALUES (?,?) ON DUPLICATE KEY UPDATE ValuePay = VALUES(ValuePay)")->execute([$k, $v]);
$get = function (string $k) use ($pdo) {
    $s = $pdo->prepare("SELECT ValuePay FROM PaySetting WHERE NamePay = ?");
    $s->execute([$k]);
    return $s->fetchColumn();
};
$hasKey = fn() => ($k = trim((string) $get('tetraminator_api_key'))) !== '' && $k !== '0';
switch ($cmd) {
    case 'key':
        $key = trim((string) getenv('TETRA_KEY'));
        if ($key === '') {
            fwrite(STDOUT, 'Tetraminator API key (hidden): ');
            @system('stty -echo 2>/dev/null');
            $key = trim((string) fgets(STDIN));
            @system('stty echo 2>/dev/null');
            echo "\n";
        }
        if (strlen($key) < 8 || preg_match('/\s/', $key)) {
            exit("❌ The key is empty or looks wrong; nothing was changed.\n");
        }
        $set('tetraminator_api_key', $key);
        echo "✅ Key saved (length " . strlen($key) . "). Next: php scripts/tetra_setup.php test, then  on\n";
        break;
    case 'on':
        if (!$hasKey()) {
            exit("❌ Set the key first: php scripts/tetra_setup.php key\n");
        }
        $set('tetraminator_status', 'ontetraminator');
        echo "✅ Tetraminator is shown in the payment menu.\n";
        break;
    case 'off':
        $set('tetraminator_status', 'offtetraminator');
        echo "⛔ Tetraminator is hidden.\n";
        break;
    case 'limits':
        $min = (int) ($argv[2] ?? 0);
        $max = (int) ($argv[3] ?? 0);
        if ($min < 50000 || $max < $min) {
            exit("Usage: php scripts/tetra_setup.php limits MIN MAX   (MIN >= 50000 toman, MAX >= MIN)\n");
        }
        $set('minbalancetetraminator', (string) $min);
        $set('maxbalancetetraminator', (string) $max);
        echo "✅ " . number_format($min) . " – " . number_format($max) . " toman\n";
        break;
    case 'test':
        if (!$hasKey()) {
            exit("❌ Set the key first: php scripts/tetra_setup.php key\n");
        }
        $r = createPayTetraminator(50000, 'test' . bin2hex(random_bytes(3)));
        if (!empty($r['pay_url'])) {
            echo "✅ The key works. Test invoice (50,000 toman, not paid, can be ignored):\n   pay_id  : {$r['pay_id']}\n   pay link: {$r['pay_url']}\n";
            $i = tetraminatorInquiry($r['pay_id']);
            echo "   inquiry : " . ($i['ok'] ? "ok, status «{$i['payment_status']}»" : "❌ {$i['error']}") . "\n";
        } else {
            echo "❌ " . ($r['error'] ?? '?') . (empty($r['message']) ? '' : " — {$r['message']}") . "\n   (401 = wrong key, 403 = shop disabled at Tetraminator, 400 = amount below 50,000)\n";
            exit(1);
        }
        break;
    default:
        echo "Tetraminator\n";
        echo "  status : " . ($get('tetraminator_status') === 'ontetraminator' ? '✅ on' : '⛔ off') . "\n";
        echo "  key    : " . ($hasKey() ? '✅ saved' : '— not set') . "\n";
        echo "  limits : " . number_format((int) $get('minbalancetetraminator')) . " – " . number_format((int) $get('maxbalancetetraminator')) . " toman\n";
        echo "  callback: https://$domainhosts/payment/tetraminator_webhook.php?order_id=<order>\n";
        $q = $pdo->query("SELECT payment_Status, COUNT(*) c FROM Payment_report WHERE Payment_Method = 'tetraminator' GROUP BY payment_Status");
        foreach ($q ? $q->fetchAll(PDO::FETCH_ASSOC) : [] as $r) {
            echo "  orders {$r['payment_Status']}: {$r['c']}\n";
        }
}
