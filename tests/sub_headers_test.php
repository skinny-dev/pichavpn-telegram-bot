<?php
// php tests/sub_headers_test.php
chdir(__DIR__ . '/..');
$src = file_get_contents('function.php');
preg_match('/function subscriptionHeaders\(.*?\n}\n/s', $src, $m);
eval($m[0]);
$fail = 0;
function ok($c, $msg) { global $fail; echo ($c ? 'ok   ' : 'FAIL ') . $msg . "\n"; if (!$c) $fail++; }
$h = subscriptionHeaders(['username' => 'pichavpn_ali', 'used_traffic' => 1000, 'data_limit' => 5000, 'expire' => 1800000000], ['name_product' => '۳۰ گیگ', 'username' => 'pichavpn_ali']);
ok(in_array('Profile-Title: base64:' . base64_encode('pichavpn_ali'), $h, true), 'default title = service username');
ok(in_array('Subscription-Userinfo: upload=0; download=1000; total=5000; expire=1800000000', $h, true), 'traffic + expiry header');
ok(in_array('Profile-Update-Interval: 12', $h, true), 'update interval');
$h = subscriptionHeaders(['username' => 'u1'], ['name_product' => 'Pro'], "Picha | {username} | {product}");
ok(in_array('Profile-Title: base64:' . base64_encode('Picha | u1 | Pro'), $h, true), 'template with {username} and {product}');
$h = subscriptionHeaders(['username' => 'u2', 'data_limit' => null, 'used_traffic' => null, 'expire' => null], false);
ok(!array_filter($h, fn($x) => str_starts_with($x, 'Subscription-Userinfo')), 'no traffic data = no userinfo header');
ok(!array_filter($h, fn($x) => preg_match('/[\r\n]/', $x)), 'no header injection characters');
$h = subscriptionHeaders(['username' => "x\r\nSet-Cookie: a=b"], false);
ok(!array_filter($h, fn($x) => substr_count($x, "\n") || substr_count($x, "\r")), 'newline in username cannot inject a header');
exit($fail ? 1 : 0);
