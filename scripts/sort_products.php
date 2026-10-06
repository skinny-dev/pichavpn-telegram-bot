<?php
/*
 * Write a clean "order number" (sort_order) for products, so the web panel's manual order starts tidy.
 *   php scripts/sort_products.php --by=volume --dir=asc            # DRY RUN: shows the new order per category
 *   php scripts/sort_products.php --by=volume --dir=asc --apply    # saves it (numbers 1..n inside each category)
 *   --by=volume|price   --dir=asc|desc
 * Customers see this order only when the bot's «🔃 ترتیب نمایش محصولات» is on «دستی»; the automatic modes sort by themselves.
 */
if (PHP_SAPI !== 'cli') {
    exit;
}
chdir(__DIR__ . '/..');
require_once 'config.php';
require_once 'function.php';
$o = getopt('', ['by:', 'dir:', 'apply']);
$by = $o['by'] ?? '';
$dir = $o['dir'] ?? 'asc';
if (!in_array($by, ['volume', 'price'], true) || !in_array($dir, ['asc', 'desc'], true)) {
    exit("usage: php scripts/sort_products.php --by=volume|price --dir=asc|desc [--apply]\n");
}
$mode = $by . '_' . $dir;
$rows = $pdo->query("SELECT * FROM product")->fetchAll(PDO::FETCH_ASSOC);
$groups = [];
foreach ($rows as $r) {
    $groups[(string) $r['category']][] = $r;
}
$upd = $pdo->prepare("UPDATE product SET sort_order = ? WHERE id = ?");
$total = 0;
foreach ($groups as $cat => $items) {
    echo ($cat === '' ? '(بدون دسته)' : strip_tags($cat)) . "\n";
    foreach (sortProductRows($items, $mode) as $i => $p) {
        echo sprintf("  %2d. %-32s %6s GB  %9s toman  %s days\n", $i + 1, mb_substr(strip_tags($p['name_product']), 0, 30), $p['Volume_constraint'], number_format((int) $p['price_product']), $p['Service_time']);
        if (isset($o['apply'])) {
            $upd->execute([$i + 1, $p['id']]);
            $total++;
        }
    }
}
echo isset($o['apply']) ? "\nSaved $total product positions.\n" : "\nDRY RUN: nothing changed. Add --apply to save.\n";
