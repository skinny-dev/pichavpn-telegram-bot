<?php
// Custom service («سرویس دلخواه») pricing: shows the prices the bot will charge and changes the settings.
//
//   php scripts/custom_price.php                     # table for every panel: ready plans vs custom price + examples
//   php scripts/custom_price.php --step 10000        # round to 10,000 toman (default 5,000)
//   php scripts/custom_price.php --month-pct 10      # each extra month +10% (default: worked out from the plans)
//   php scripts/custom_price.php --month-pct auto
//   php scripts/custom_price.php --mode flat         # back to the old «per GB + per day» settings (--mode plans to undo)
//   php scripts/custom_price.php --agent n           # show the prices of another buyer group (default f)

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
$root = dirname(__DIR__);
require $root . '/config.php';
require_once $root . '/promo_lib.php';
require_once $root . '/custom_price.php';

$o = getopt('', ['step:', 'month-pct:', 'mode:', 'agent:', 'help']);
if (isset($o['help'])) {
    echo file_get_contents(__FILE__, false, null, 0, 900);
    exit(0);
}
$raw = is_file(CUSTOM_PRICE_FILE) ? (json_decode((string) file_get_contents(CUSTOM_PRICE_FILE), true) ?: []) : [];
$changed = false;
if (isset($o['step'])) {
    $raw['step'] = max(1, (int) $o['step']);
    $changed = true;
}
if (isset($o['month-pct'])) {
    $raw['month_pct'] = $o['month-pct'] === 'auto' ? null : (float) $o['month-pct'];
    $changed = true;
}
if (isset($o['mode'])) {
    if (!in_array($o['mode'], ['plans', 'flat'], true)) {
        fwrite(STDERR, "--mode must be plans or flat\n");
        exit(1);
    }
    $raw['mode'] = $o['mode'];
    $changed = true;
}
if ($changed) {
    @mkdir(dirname(CUSTOM_PRICE_FILE), 0775, true);
    file_put_contents(CUSTOM_PRICE_FILE, json_encode($raw, JSON_PRETTY_PRINT), LOCK_EX);
    echo "✅ تنظیمات ذخیره شد\n";
}
$cfg = customPriceConfig();
$agent = $o['agent'] ?? 'f';
echo "حالت: " . ($cfg['mode'] === 'plans' ? 'بر اساس پلن‌ها' : 'قدیمی (هر گیگ + هر روز)') . " | رند: " . number_format($cfg['step']) . " تومان | گروه خریدار: $agent\n";

foreach ($pdo->query("SELECT * FROM marzban_panel") as $panel) {
    echo "\n━━━━ " . $panel['name_panel'] . ($panel['status'] === 'disable' ? ' (غیرفعال)' : '') . "\n";
    $flatGb = customAgentValue($panel['pricecustomvolume'], $agent);
    $flatDay = customAgentValue($panel['pricecustomtime'], $agent);
    echo "تنظیم قدیمی: هر گیگ " . number_format($flatGb) . " + هر روز " . number_format($flatDay) . "\n";
    $model = customPanelModel($panel, $agent);
    if (!$model) {
        echo $cfg['mode'] === 'flat' ? "حالت قدیمی فعال است\n" : "پلن آماده‌ای ندارد → همان تنظیم قدیمی استفاده می‌شود\n";
        continue;
    }
    echo "پایه: " . $model['base'] . " روز | هر ماه بیشتر: +" . round($model['month'] * 100, 1) . "٪\n\n";
    echo "پلن آماده                 قیمت پلن     دلخواه جدید   دلخواه قدیم\n";
    $plans = $model['plans'];
    usort($plans, fn($a, $b) => [$a[1], $a[0]] <=> [$b[1], $b[0]]);
    foreach ($plans as [$gb, $days, $price]) {
        printf("  %-6s گیگ %-4s روز   %11s   %11s   %11s\n", promoNum($gb), $days, number_format($price), number_format(customPlanPrice($panel, $agent, $gb, $days)), number_format($gb * $flatGb + $days * $flatDay));
    }
    echo "\nنمونه‌ها (دلخواه جدید / قدیم):\n";
    foreach ([30, 60, 90] as $d) {
        $row = [];
        foreach ([5, 15, 25, 50, 75, 100, 150] as $g) {
            $row[] = "$g گیگ " . number_format(customPlanPrice($panel, $agent, $g, $d)) . ' / ' . number_format($g * $flatGb + $d * $flatDay);
        }
        echo "  $d روز: " . implode(' | ', $row) . "\n";
    }
}
