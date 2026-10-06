<?php
// php tests/category_status_test.php   (needs the local test DB from config.php)
chdir(__DIR__ . '/..');
require 'config.php';
require 'premium_emoji.php';
require 'function.php';
$textbotlang = languagechange();
require 'keyboard.php';
$fail = 0;
function ok($c, $m) { global $fail; echo ($c ? 'ok   ' : 'FAIL ') . $m . "\n"; if (!$c) $fail++; }

$pdo->exec("SET NAMES utf8mb4");
$pdo->exec("DELETE FROM product WHERE code_product LIKE 'cst%'");
$pdo->exec("DELETE FROM category WHERE remark LIKE 'CST%'");
$pdo->exec("INSERT INTO category (remark, sort_order, status) VALUES ('CST اقتصادی', 91, 'active'), ('CST ویژه', 92, 'disable')");
$ins = $pdo->prepare("INSERT INTO product (code_product,name_product,price_product,Volume_constraint,Service_time,Location,agent,note,data_limit_reset,one_buy_status,category,hide_panel,sort_order,status_product) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
$ins->execute(['cst1', 'p-eco', '1000', '1', '30', 'panelX', 'f', '', 'no_reset', '0', 'CST اقتصادی', '{}', 1, 'active']);
$ins->execute(['cst2', 'p-vip', '2000', '1', '30', 'panelX', 'f', '', 'no_reset', '0', 'CST ویژه', '{}', 2, 'active']);
$ins->execute(['cst3', 'p-eco-off', '3000', '1', '30', 'panelX', 'f', '', 'no_reset', '0', 'CST اقتصادی', '{}', 3, 'disable']);

ok(in_array('cst ویژه', soldOutCategoryKeys(), true) && !in_array('cst اقتصادی', soldOutCategoryKeys(), true), 'only the disabled category is in the sold-out set');
ok(categoryIsSoldOut('  CST ویژه ') && !categoryIsSoldOut('CST اقتصادی'), 'sold-out check ignores case and surrounding spaces');
ok(productIsSoldOutByCode('cst2') === true, 'product in a sold-out category cannot be bought');
ok(productIsSoldOutByCode('cst3') === true, 'product marked sold out cannot be bought');
ok(productIsSoldOutByCode('cst1') === false, 'normal product in a normal category can be bought');
ok(productIsSoldOutByCode('does-not-exist') === false, 'unknown code is not reported as sold out');

$kb = json_decode(KeyboardCategory('panelX', 'f'), true)['inline_keyboard'];
$byText = [];
foreach ($kb as $row) { $byText[$row[0]['text']] = $row[0]['callback_data']; }
$eco = array_values(array_filter(array_keys($byText), fn($t) => str_contains($t, 'CST اقتصادی')))[0] ?? null;
$vip = array_values(array_filter(array_keys($byText), fn($t) => str_contains($t, 'CST ویژه')))[0] ?? null;
ok($eco && str_starts_with($byText[$eco], 'categorynames_'), 'available category opens normally');
ok($vip && $byText[$vip] === 'categorysoldout' && str_contains($vip, 'ناموجود'), 'sold-out category is labelled and not openable');

$q = "SELECT * FROM product WHERE (Location = :loc OR Location = '/all') AND agent = :agent AND code_product LIKE 'cst%' ORDER BY id";
$pk = json_decode(KeyboardProduct('panelX', $q, 0, 'prodcutservice_', false, 'backuser', null, 'customsellvolume', [':loc' => 'panelX', ':agent' => 'f']), true)['inline_keyboard'];
$cb = array_map(fn($r) => $r[0]['callback_data'], $pk);
ok($cb[0] === 'prodcutservice_cst1', 'available product is buyable');
ok($cb[1] === 'productsoldout' && $cb[2] === 'productsoldout', 'product in sold-out category and sold-out product both show sold out');

$pdo->exec("UPDATE category SET status='active' WHERE remark = 'CST ویژه'");
ok(productIsSoldOutByCode('cst2') === false, 'switching the category back to available makes its products buyable again');
$pdo->exec("DELETE FROM product WHERE code_product LIKE 'cst%'");
$pdo->exec("DELETE FROM category WHERE remark LIKE 'CST%'");
exit($fail ? 1 : 0);
