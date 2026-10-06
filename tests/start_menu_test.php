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
$rows = startGuideButtons();
ok(count($rows) === 1 && count($rows[0]) === 2, 'two buttons side by side in ONE row');
ok($rows[0][0]['text'] === '🛍 خرید اشتراک' && $rows[0][0]['callback_data'] === 'buy', 'first button: 🛍 خرید اشتراک opens the buy flow');
ok($rows[0][1]['text'] === '📚 آموزش' && $rows[0][1]['callback_data'] === 'helpbtn', 'second button: 📚 آموزش opens the guide list');
ok($textbotlang_start = (languagechange()['users']['text_start'] ?? ''), 'welcome text exists');
ok(str_starts_with(languagechange()['users']['text_start'], '🐈‍⬛ درود، خوش اومدی به پیچا!'), 'welcome starts with «درود» (not «سلام»)');
ok(!str_contains(languagechange()['users']['text_start'], 'سلام'), 'no «سلام» left in the welcome text');
$ins = $pdo->prepare("INSERT INTO help (name_os, Media_os, type_Media_os, category, Description_os) VALUES (?, '', '', ?, 'x')");
file_put_contents($tmp, json_encode(['enabled' => true, 'buttons' => [['text' => '🚀 شروع سریع', 'help' => 'شروع سریع'], ['text' => '📚 آموزش', 'callback' => 'helpbtn']]]));
$rows = startGuideButtons();
ok($rows[0][0]['callback_data'] === 'helpsoon', 'a help-category button with no articles says «coming soon»');
$ins->execute(['sm-test 1', 'شروع سریع']);
$cb = startGuideButtons()[0][0]['callback_data'];
ok($cb === 'helpctg_' . dechex(crc32('شروع سریع')) && strlen($cb) <= 64, '…and opens the articles once the category has some');
file_put_contents($tmp, json_encode(['enabled' => false]));
ok(startGuideButtons() === [], 'switched off -> no guide buttons (old single message)');
file_put_contents($tmp, json_encode(['enabled' => true, 'buttons' => [['text' => 'سایت', 'url' => 'https://example.com'], ['text' => 'بد', 'url' => 'javascript:alert(1)'], ['text' => 'نامعتبر', 'callback' => 'admin']]]));
$flat = array_merge(...(startGuideButtons() ?: [[]]));
ok(count($flat) === 1 && $flat[0]['url'] === 'https://example.com', 'only http(s) links and the allowed callbacks are accepted');
$pdo->exec("DELETE FROM help WHERE name_os LIKE 'sm-test%'");
@unlink($tmp);
exit($fail ? 1 : 0);
