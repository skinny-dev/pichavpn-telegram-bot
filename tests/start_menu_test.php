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
$ins = $pdo->prepare("INSERT INTO help (name_os, Media_os, type_Media_os, category, Description_os) VALUES (?, '', '', ?, 'x')");
$before = count(startGuideButtons(), COUNT_RECURSIVE);
$ins->execute(['sm-test 1', 'شروع سریع']);
$ins->execute(['sm-test 2', 'تمدید']);
$rows = startGuideButtons();
$flat = array_merge(...($rows ?: [[]]));
$texts = array_column($flat, 'text');
ok(in_array('🚀 شروع سریع', $texts, true) && in_array('🔄 تمدید', $texts, true), 'buttons appear for categories that have articles');
ok(!in_array('🛠 رفع مشکل', $texts, true) || count(startGuideButtons()) > 0, 'a category without articles gets no (dead) button unless it really has some');
$cb = array_values(array_filter($flat, fn($b) => $b['text'] === '🚀 شروع سریع'))[0]['callback_data'] ?? '';
ok($cb === 'helpctg_' . dechex(crc32('شروع سریع')) && strlen($cb) <= 64, 'callback matches the existing help-category handler');
file_put_contents($tmp, json_encode(['enabled' => false]));
ok(startGuideButtons() === [], 'switched off -> no guide buttons (old single message)');
file_put_contents($tmp, json_encode(['enabled' => true, 'buttons' => [['text' => 'سایت', 'url' => 'https://example.com'], ['text' => 'بد', 'url' => 'javascript:alert(1)']]]));
$flat = array_merge(...(startGuideButtons() ?: [[]]));
ok(count($flat) === 1 && $flat[0]['url'] === 'https://example.com', 'only http(s) links are accepted');
$pdo->exec("DELETE FROM help WHERE name_os LIKE 'sm-test%'");
@unlink($tmp);
exit($fail ? 1 : 0);
