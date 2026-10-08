<?php
// php tests/sub_lines_test.php
chdir(__DIR__ . '/..');
$src = file_get_contents('function.php');
preg_match('/function subscriptionLines\(.*?\n}\n/s', $src, $m);
eval($m[0]);
$fail = 0;
function ok($c, $msg) { global $fail; echo ($c ? 'ok   ' : 'FAIL ') . $msg . "\n"; if (!$c) $fail++; }
$links = ["vless://a#Germany\r\r", "  vless://b#Netherlands\n", "vless://c#Turkey\r\nvless://d#Poland", '', "\r\n", ['vless://e#USA']];
$lines = subscriptionLines($links);
ok($lines === ['vless://a#Germany', 'vless://b#Netherlands', 'vless://c#Turkey', 'vless://d#Poland', 'vless://e#USA'], 'every config on its own trimmed line, blanks dropped, nested lists flattened');
$body = implode('', array_map(fn($l) => $l . "\n", $lines));
ok(substr_count($body, "\n") === 5 && strpos($body, "\r") === false, 'body uses LF only: a strict client that splits on newline sees all 5 configs');
ok(count(explode("\n", trim("vless://a\r\rvless://b\r\r"))) === 1, 'the old "\\r\\r" body is ONE line for such a client (the bug)');
ok(subscriptionLines(null) === [] && subscriptionLines('') === [], 'empty input');
exit($fail ? 1 : 0);
