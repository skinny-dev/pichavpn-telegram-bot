<?php
// php tests/product_order_test.php  (needs the local test DB for the integration part)
chdir(__DIR__ . '/..');
require 'config.php';
require 'premium_emoji.php';
require 'function.php';
$textbotlang = languagechange();
require 'keyboard.php';
$fail = 0;
function ok($c, $m) { global $fail; echo ($c ? 'ok   ' : 'FAIL ') . $m . "\n"; if (!$c) $fail++; }
$P = fn($id, $name, $gb, $price, $days = 30, $so = 0) => ['id' => $id, 'name_product' => $name, 'Volume_constraint' => (string) $gb, 'price_product' => (string) $price, 'Service_time' => (string) $days, 'sort_order' => $so];
$names = fn($rows) => array_column($rows, 'name_product');
// the order from the bot screenshot: 40, 80, 120, 25, 10 (+ an unlimited one)
$rows = [$P(1, '40', 40, 200000), $P(2, '80', 80, 370000), $P(3, '120', 120, 540000), $P(4, '25', 25, 144000), $P(5, '10', 10, 60000), $P(6, 'نامحدود', 0, 900000)];
ok($names(sortProductRows($rows, 'volume_asc')) === ['10', '25', '40', '80', '120', 'نامحدود'], 'volume ascending: 10 → 120, unlimited last');
ok($names(sortProductRows($rows, 'volume_desc')) === ['120', '80', '40', '25', '10', 'نامحدود'], 'volume descending, unlimited still last');
ok($names(sortProductRows($rows, 'price_asc')) === ['10', '25', '40', '80', '120', 'نامحدود'], 'price ascending');
ok($names(sortProductRows($rows, 'price_desc')) === ['نامحدود', '120', '80', '40', '25', '10'], 'price descending');
$m = $rows; $m[0]['sort_order'] = 2; $m[4]['sort_order'] = 1;   // "40" at position 2, "10" at position 1
ok(array_slice($names(sortProductRows($m, 'manual')), 0, 2) === ['10', '40'], 'manual: numbered products first, in their numbers');
ok($names(sortProductRows($m, 'manual')) === ['10', '40', '25', '80', '120', 'نامحدود'], 'manual: un-numbered products follow, by volume');
$same = [$P(1, 'a', 10, 5, 30), $P(2, 'b', 10, 5, 7)];
ok($names(sortProductRows($same, 'volume_asc')) === ['b', 'a'], 'same volume: shorter duration first');
ok(sortProductRows([], 'volume_asc') === [], 'empty list is fine');

// integration: the real customer keyboard
$pdo->exec("DELETE FROM product WHERE code_product LIKE 'ord%'");
$ins = $pdo->prepare("INSERT INTO product (code_product,name_product,price_product,Volume_constraint,Service_time,Location,agent,note,data_limit_reset,one_buy_status,category,hide_panel,sort_order,status_product) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
foreach ([['ord1', 'p40', '200000', '40'], ['ord2', 'p80', '370000', '80'], ['ord3', 'p25', '144000', '25'], ['ord4', 'p10', '60000', '10']] as [$c, $n, $pr, $gb]) {
    $ins->execute([$c, $n, $pr, $gb, '30', 'panelOrd', 'f', '', 'no_reset', '0', 'catOrd', '{}', 0, 'active']);
}
$pdo->exec("INSERT INTO shopSetting (Namevalue, value) VALUES ('product_sort', 'volume_asc') ON DUPLICATE KEY UPDATE value = 'volume_asc'");
$q = "SELECT * FROM product WHERE (Location = :loc OR Location = '/all') AND agent = :agent AND code_product LIKE 'ord%'";
$kb = fn() => json_decode(KeyboardProduct('panelOrd', $q, 0, 'prodcutservice_', false, 'backuser', null, 'customsellvolume', [':loc' => 'panelOrd', ':agent' => 'f']), true)['inline_keyboard'];
$codes = fn($k) => array_values(array_filter(array_map(fn($r) => $r[0]['callback_data'], $k), fn($c) => str_starts_with($c, 'prodcutservice_')));
ok($codes($kb()) === ['prodcutservice_ord4', 'prodcutservice_ord3', 'prodcutservice_ord1', 'prodcutservice_ord2'], 'customer list: 10, 25, 40, 80 GB');
$pdo->exec("UPDATE shopSetting SET value = 'price_desc' WHERE Namevalue = 'product_sort'");
ok($codes($kb()) === ['prodcutservice_ord2', 'prodcutservice_ord1', 'prodcutservice_ord3', 'prodcutservice_ord4'], 'switching the bot setting to price descending re-orders the list');
$pdo->exec("UPDATE shopSetting SET value = 'volume_asc' WHERE Namevalue = 'product_sort'");
$pdo->exec("DELETE FROM product WHERE code_product LIKE 'ord%'");
exit($fail ? 1 : 0);
