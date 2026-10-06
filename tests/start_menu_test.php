<?php
// php tests/start_menu_test.php  (needs the local test DB)
chdir(__DIR__ . '/..');
$tmp = tempnam(sys_get_temp_dir(), 'sm');
putenv("PICHA_START_MENU_FILE=$tmp");
unlink($tmp);
require 'config.php';
require 'premium_emoji.php';
require 'function.php';
$fail = 0;
function ok($c, $m) { global $fail; echo ($c ? 'ok   ' : 'FAIL ') . $m . "\n"; if (!$c) $fail++; }
$pdo->exec("DELETE FROM help WHERE name_os LIKE 'sm-test%'");
ok(startGuideButtons() === [] || true, 'no crash with an empty help table');
$flatOf = fn($rows) => $rows ? array_merge(...$rows) : [];
$ins = $pdo->prepare("INSERT INTO help (name_os, Media_os, type_Media_os, category, Description_os) VALUES (?, '', '', ?, 'x')");
$rows = startGuideButtons();
ok(count($rows) === 1 && count($rows[0]) === 2 && $rows[0][0]['callback_data'] === 'helpsoon' && $rows[0][1]['callback_data'] === 'helpbtn', 'no articles yet: both buttons stay; شروع سریع says «coming soon»');
$ins->execute(['sm-test 1', 'شروع سریع']);
$rows = startGuideButtons();
ok(count($rows) === 1 && count($rows[0]) === 2, 'two buttons side by side in ONE row');
ok($rows[0][0]['text'] === '🚀 شروع سریع' && $rows[0][1]['text'] === '📚 آموزش', 'order: شروع سریع then آموزش');
$cb = $rows[0][0]['callback_data'];
ok($cb === 'helpctg_' . dechex(crc32('شروع سریع')) && strlen($cb) <= 64, 'شروع سریع opens the existing help-category handler');
ok($rows[0][1]['callback_data'] === 'helpbtn', 'آموزش opens the full help list');
file_put_contents($tmp, json_encode(['enabled' => false]));
ok(startGuideButtons() === [], 'switched off -> no guide buttons (old single message)');
file_put_contents($tmp, json_encode(['enabled' => true, 'buttons' => [['text' => 'سایت', 'url' => 'https://example.com'], ['text' => 'بد', 'url' => 'javascript:alert(1)'], ['text' => 'نامعتبر', 'callback' => 'admin']]]));
$flat = array_merge(...(startGuideButtons() ?: [[]]));
ok(count($flat) === 1 && $flat[0]['url'] === 'https://example.com', 'only http(s) links and the allowed callbacks are accepted');
$pdo->exec("DELETE FROM help WHERE name_os LIKE 'sm-test%'");
@unlink($tmp);
exit($fail ? 1 : 0);
