<?php
// php tests/sub_page_test.php
require __DIR__ . '/../sub_page.php';
$f = 0;
function t($n, $c) { global $f; echo ($c ? 'PASS ' : 'FAIL ') . $n . "\n"; if (!$c) $f++; }
$br = 'Mozilla/5.0 (Windows NT 10.0) Chrome/120';
t('browser gets page', subscriptionWantsHtml('text/html,application/xhtml+xml', $br));
t('v2rayNG gets raw', !subscriptionWantsHtml('*/*', 'v2rayNG/1.8'));
t('app with html accept still raw', !subscriptionWantsHtml('text/html', 'Hiddify/2.0 okhttp'));
t('raw=1 forces raw', !subscriptionWantsHtml('text/html', $br, ['raw' => '1']));
t('view=1 forces page', subscriptionWantsHtml('*/*', 'v2rayNG', ['view' => '1']));
t('no accept = raw', !subscriptionWantsHtml('', $br));
$now = 1_000_000;
$v = subscriptionView(['status' => 'active', 'expire' => $now + 3 * 86400 - 10, 'used_traffic' => 1 << 30, 'data_limit' => 4 << 30], $now);
t('active, 3 days, 25%', $v['state'] === 'active' && $v['days'] === 3 && $v['percent'] === 25);
t('expired by date', subscriptionView(['status' => 'active', 'expire' => $now - 5], $now)['state'] === 'end');
t('volume finished', subscriptionView(['status' => 'active', 'used_traffic' => 5, 'data_limit' => 5], $now)['label'] === 'حجم تمام شده');
t('on hold not expired', subscriptionView(['status' => 'on_hold', 'expire' => 0], $now)['state'] === 'hold');
t('unlimited has no percent', subscriptionView(['status' => 'active', 'data_limit' => 0, 'expire' => 0], $now)['percent'] === null);
$h = subscriptionPageHtml(['username' => '<b>x</b>', 'status' => 'active', 'expire' => $now + 86400, 'used_traffic' => 0, 'data_limit' => 0], ['name_product' => 'پلن'], 'https://h/sub/ab12', 'pichanet_bot', 'pichavpn_support', $now);
t('escapes username', strpos($h, '<b>x</b>') === false && strpos($h, '&lt;b&gt;') !== false);
t('has bot + support links', strpos($h, 'https://t.me/pichanet_bot') !== false && strpos($h, 'https://t.me/pichavpn_support') !== false);
t('placeholder bot name hides renew button', strpos(subscriptionPageHtml(['username' => 'u'], [], 'https://h/sub/a', '{username_bot}', ''), 't.me/{') === false);
exit($f ? 1 : 0);
