<?php
// php tests/promo_test.php  (pure parts)
require __DIR__ . '/../promo_lib.php';
$f = 0;
function t($n, $c, $x = '') { global $f; echo ($c ? 'PASS ' : 'FAIL ') . $n . ($c ? '' : "  -> $x") . "\n"; if (!$c) $f++; }
t('20% of 144,000 rounds down to 115,000', promoPrice(144000, 20) === 115000);
t('never below 1,000', promoPrice(1000, 90) === 1000);
t('round to 5,000 down: 144,000 -20% = 115,200 -> 115,000', promoPrice(144000, 20, 5000) === 115000);
t('round to 10,000 nearest: 115,200 -> 120,000', promoPrice(144000, 20, 10000, 'nearest') === 120000);
t('round to 10,000 down: 110,000', promoPrice(144000, 20, 10000) === 110000);
t('round up to 5,000: 120,000', promoPrice(144000, 20, 5000, 'up') === 120000);
t('price stripped from name', promoStripPrice('40 گیگ — 200,000 تومان') === '40 گیگ' && promoStripPrice('نامحدود') === 'نامحدود');
t('strike adds combining stroke', promoStrike('60') === "6\u{0336}0\u{0336}");
t('number trimming', promoNum(40.0) === '40' && promoNum(10.5) === '10.5');
// labels (each in its own process because the promotion is cached per request)
$run = function (array $state, string $label): string {
    $dir = sys_get_temp_dir() . '/promo' . getmypid() . rand();
    @mkdir($dir . '/storage', 0777, true);
    copy(__DIR__ . '/../promo_lib.php', $dir . '/promo_lib.php');
    file_put_contents($dir . '/storage/promo.json', json_encode($state + ['title' => 't', 'ends_at' => time() + 60]));
    $out = shell_exec('php -r ' . escapeshellarg('require "' . $dir . '/promo_lib.php"; echo promoButtonLabel(["id"=>7], ' . var_export($label, true) . ');'));
    shell_exec('rm -rf ' . escapeshellarg($dir));
    return (string) $out;
};
$pct = $run(['type' => 'percent', 'value' => 20, 'items' => [['id' => 7, 'name' => 'x', 'old_price' => 200000, 'new_price' => 160000, 'old_gb' => 40, 'new_gb' => 40]]], '⭐ 40 گیگ — 200,000 تومان');
t('percent label: one promo emoji, catalog emoji gone, no «% تخفیف» words', strpos($pct, '⭐') === false && strpos($pct, 'تخفیف') === false && preg_match('/^🏷 40 گیگ/u', $pct) === 1, $pct);
t('old price struck and isolated LTR, new price shown', strpos($pct, "\u{2066}" . promoStrike('200,000') . "\u{2069} \u{2066}160,000\u{2069} تومان") !== false, $pct);
$gb = $run(['type' => 'bonus_gb', 'value' => 10, 'items' => [['id' => 7, 'name' => 'x', 'old_price' => 144000, 'new_price' => 144000, 'old_gb' => 40, 'new_gb' => 50]]], '⭐ 40 گیگ — 144,000 تومان');
t('bonus label: 50 گیگ (+10 هدیه)', $gb === "🎁 50 گیگ (+10 هدیه) — \u{2066}144,000\u{2069} تومان", $gb);
$odd = $run(['type' => 'percent', 'value' => 20, 'items' => [['id' => 7, 'name' => 'x', 'old_price' => 450000, 'new_price' => 360000, 'old_gb' => 120, 'new_gb' => 120]]], '💎 120 گیگ — 540,000 تومان');
t('a wrong price written in the name is replaced, not shown twice', strpos($odd, '540,000') === false && substr_count($odd, 'تومان') === 1 && strpos($odd, '360,000') !== false, $odd);
t('product without promotion unchanged', $run(['type' => 'percent', 'value' => 20, 'items' => []], '⚡ 10 گیگ — 60,000 تومان') === '⚡ 10 گیگ — 60,000 تومان');
exit($f ? 1 : 0);
