<?php
// php tests/sub_link_test.php
chdir(__DIR__ . '/..');
$src = file_get_contents('function.php');
foreach (['panelNativeSubUrl', 'panelSubscriptionLink'] as $f) {
    preg_match('/function ' . $f . '\(.*?\n}\n/s', $src, $m);
    eval($m[0]);
}
$fail = 0;
function ok($c, $msg) { global $fail; echo ($c ? 'ok   ' : 'FAIL ') . $msg . "\n"; if (!$c) $fail++; }
$inv = ['id_invoice' => 'abc123'];
$native = 'https://dmc.example.com/sub/TOKEN?x=1';
$p = ['url_panel' => 'https://panel.example.com:8443', 'linksubx' => 'https://panel.example.com:8443', 'subproxy' => 'onsubproxy'];
ok(panelSubscriptionLink($p, $native, $inv, 'fa-bot.x.top') === 'https://fa-bot.x.top/sub/abc123', 'default = bot domain link');
ok(panelSubscriptionLink([] + $p, $native, $inv, 'fa-bot.x.top') === 'https://fa-bot.x.top/sub/abc123', 'missing subproxy = bot domain link');
$p['subproxy'] = 'offsubproxy';
ok(panelSubscriptionLink($p, $native, $inv, 'fa-bot.x.top') === $native, "native mode = the panel's own link (dmc domain)");
ok(panelSubscriptionLink($p, $native, false, 'fa-bot.x.top') === $native, 'no invoice = native');
ok(panelSubscriptionLink($p, '', $inv, 'fa-bot.x.top') === 'https://fa-bot.x.top/sub/abc123', 'empty native link falls back to the bot link');
$p['linksubx'] = 'https://dmc.example.com';
ok(panelSubscriptionLink($p, 'https://panel.example.com:8443/sub/TOKEN', $inv, 'fa-bot.x.top') === 'https://dmc.example.com/sub/TOKEN', 'forced subscription domain replaces the admin host');
ok(panelSubscriptionLink($p, 'https://panel.example.com:8443/sub/TOKEN?a=b', $inv, 'fa-bot.x.top') === 'https://dmc.example.com/sub/TOKEN?a=b', 'query string kept');
exit($fail ? 1 : 0);
