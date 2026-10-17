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
t('strike adds combining stroke', promoStrike('60') === "6\u{0336}0\u{0336}");
t('number trimming', promoNum(40.0) === '40' && promoNum(10.5) === '10.5');
exit($f ? 1 : 0);
