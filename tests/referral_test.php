<?php
// php tests/referral_test.php  (pure helpers, no DB)
require __DIR__ . '/../referral_links.php';
$f = 0;
function t($n, $c) { global $f; echo ($c ? 'PASS ' : 'FAIL ') . $n . "\n"; if (!$c) $f++; }

t('code normalised', referralNormalizeCode(' Ad_Ali-1 ') === 'ad_ali-1');
t('numeric id is not a campaign code', referralNormalizeCode('12345678') === '');
t('reserved word rejected', referralNormalizeCode('start') === '' && referralNormalizeCode('usertest') === '');
t('too short / bad chars rejected', referralNormalizeCode('ab') === '' && referralNormalizeCode('a b c') === '' && referralNormalizeCode('ali!') === '');

$noCom = ['price' => 500000, 'pays_commission' => 0, 'commission_percent' => null];
$m = referralMoney($noCom, 2000000, 0, 10);
t('no commission flag => 0 commission', $m['commission'] === 0 && $m['percent'] == 0 && $m['net'] === 1500000);

$com = ['price' => 100000, 'pays_commission' => 1, 'commission_percent' => null];
$m = referralMoney($com, 1000000, 30000, 10);
t('global percent used', $m['percent'] == 10 && $m['commission'] === 100000 && $m['due'] === 70000 && $m['net'] === 800000);

$own = ['price' => 0, 'pays_commission' => 1, 'commission_percent' => 25];
$m = referralMoney($own, 400000, 150000, 10);
t('own percent overrides, due never negative', $m['commission'] === 100000 && $m['due'] === 0 && $m['roi'] === 300.0);
t('roi null when nothing spent', referralMoney(['price' => 0, 'pays_commission' => 0, 'commission_percent' => null], 5, 0, 10)['roi'] === null);
t('persian digits + separators parsed', referralMoneyInput('۵۰۰,۰۰۰') === 500000 && referralMoneyInput('1 200') === 1200 && referralMoneyInput('') === 0);
exit($f ? 1 : 0);
