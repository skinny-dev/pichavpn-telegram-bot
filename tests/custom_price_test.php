<?php
require __DIR__ . '/../custom_price.php';
$f = 0;
function t($n, $ok, $x = '') { global $f; echo ($ok ? 'PASS ' : 'FAIL ') . $n . ($ok ? '' : " -> $x") . "\n"; $f += $ok ? 0 : 1; }
$plans = [[10, 30, 60000], [25, 30, 144000], [40, 30, 200000], [80, 30, 370000], [120, 30, 450000],
          [40, 60, 280000], [90, 60, 470000], [130, 60, 650000], [200, 60, 900000],
          [250, 90, 1152000], [300, 90, 1350000], [400, 90, 1700000]];
$m = customPriceModel($plans);
$P = fn($g, $d) => customModelPrice($m, $g, $d, 5000);
foreach ($plans as [$g, $d, $p]) {
    t("custom $g GB $d d never above the plan ($p)", $P($g, $d) <= $p, $P($g, $d));
}
t('25 GB 30 d = 144,000 (same as the plan)', $P(25, 30) === 144000, $P(25, 30));
t('rounded to 5,000', $P(33, 30) % 5000 === 0 && $P(7, 45) % 5000 === 0, $P(33, 30));
$prev = 0; $mono = true;
for ($g = 1; $g <= 400; $g++) { $x = $P($g, 30); $mono = $mono && $x >= $prev; $prev = $x; }
t('more GB never cheaper', $mono);
$mono = true;
foreach ([10, 25, 50, 100] as $g) { $prev = 0; for ($d = 7; $d <= 180; $d++) { $x = $P($g, $d); $mono = $mono && $x >= $prev; $prev = $x; } }
t('more days never cheaper', $mono);
t('per-GB cheaper for bigger volume', $P(100, 30) / 100 < $P(10, 30) / 10);
t('fixed month pct', customModelPrice(customPriceModel($plans, 20), 25, 60, 5000) >= 170000);
echo 'month% ', round($m['month'] * 100, 1), "\n";
foreach ([[25,30],[15,30],[20,30],[30,60],[50,30],[60,30],[25,60],[100,90]] as [$g,$d]) echo "$g/$d: ", number_format($P($g,$d)), "\n";
exit($f ? 1 : 0);
