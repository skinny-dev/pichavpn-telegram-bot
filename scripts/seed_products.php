<?php
// Seeds the Picha volume plans (3 categories, 12 products) into the bot's database.
//
//   php scripts/seed_products.php --panel "Picha-1"           # create/update everything
//   php scripts/seed_products.php --panel "Picha-1" --dry-run # show what would happen, change nothing
//
// Options:
//   --panel NAME     panel the products are sold from (name as shown in the bot). Optional when exactly one panel exists.
//   --agent f|n|n2|all   who can buy (default f = normal users)
//   --single-category    put all 12 plans in ONE category "📦 تعرفه سرویس‌های حجمی" instead of 3 (one per duration)
//   --insert-only    never touch products that already exist (default: re-apply prices/volumes from this file)
//   --dry-run        print the plan, write nothing
// Safe to run repeatedly: products are matched by name, categories by name.

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

$opts = getopt('', ['panel:', 'agent:', 'single-category', 'insert-only', 'dry-run', 'help']);
if (isset($opts['help'])) {
    echo file_get_contents(__FILE__, false, null, 0, 1400);
    exit(0);
}

const NOTE = '⚡️ تمام سرویس‌ها حجمی بوده و دارای تاریخ انقضا هستند.';
const SINGLE_CATEGORY = '📦 تعرفه سرویس‌های حجمی';

// [category title, days, [[GB, price in toman], ...]]
$PLANS = [
    ['🗓 ۱ ماهه | ۳۰ روز | حجمی', 30, [[10, 60000], [25, 150000], [40, 210000], [80, 390000], [120, 550000]]],
    ['🗓 ۲ ماهه | ۶۰ روز | حجمی', 60, [[40, 280000], [90, 470000], [130, 650000], [200, 900000]]],
    ['🗓 ۳ ماهه | ۹۰ روز | حجمی', 90, [[250, 1200000], [300, 1350000], [400, 1700000]]],
];

function fa_digits(int $n): string
{
    return strtr((string) $n, ['0' => '۰', '1' => '۱', '2' => '۲', '3' => '۳', '4' => '۴', '5' => '۵', '6' => '۶', '7' => '۷', '8' => '۸', '9' => '۹']);
}

function fail(string $msg): void
{
    fwrite(STDERR, "ERROR: $msg\n");
    exit(1);
}

$root = dirname(__DIR__);
if (!is_file($root . '/config.php')) {
    fail("config.php not found in $root (run this from the bot's folder)");
}
require $root . '/config.php';
if (!isset($pdo) || !($pdo instanceof PDO)) {
    fail('config.php did not create a database connection ($pdo)');
}

$agent = $opts['agent'] ?? 'f';
if (!in_array($agent, ['f', 'n', 'n2', 'all'], true)) {
    fail("--agent must be one of f, n, n2, all");
}
$dry = isset($opts['dry-run']);
$insertOnly = isset($opts['insert-only']);
$single = isset($opts['single-category']);

// resolve panel
$panels = $pdo->query('SELECT name_panel FROM marzban_panel')->fetchAll(PDO::FETCH_COLUMN);
$panel = $opts['panel'] ?? null;
if ($panel === null) {
    if (count($panels) === 1) {
        $panel = $panels[0];
    } else {
        fail($panels ? 'several panels exist, choose one with --panel. Available: ' . implode(' | ', $panels) : 'no panel exists yet. Add your PasarGuard panel in the bot first (🖥 اضافه کردن پنل).');
    }
}
if (!in_array($panel, $panels, true)) {
    fail("panel \"$panel\" not found. Available: " . ($panels ? implode(' | ', $panels) : '(none, add the panel in the bot first)'));
}

$hasSort = (bool) $pdo->query("SHOW COLUMNS FROM product LIKE 'sort_order'")->fetch();
$hasCatSort = (bool) $pdo->query("SHOW COLUMNS FROM category LIKE 'sort_order'")->fetch();
if (!$hasSort || !$hasCatSort) {
    fwrite(STDERR, "note: sort_order columns missing, run `php table.php` once to update the database. Continuing without ordering.\n");
}

$existingCats = $pdo->query('SELECT remark FROM category')->fetchAll(PDO::FETCH_COLUMN);
$existingProducts = $pdo->query('SELECT id, name_product FROM product')->fetchAll(PDO::FETCH_KEY_PAIR);
$byName = array_flip($existingProducts);

$plan = [];   // rows to write
$catOrder = 0;
$prodOrder = 0;
$cats = [];
foreach ($PLANS as [$title, $days, $items]) {
    $cat = $single ? SINGLE_CATEGORY : $title;
    if (!isset($cats[$cat])) {
        $cats[$cat] = ++$catOrder;
    }
    foreach ($items as [$gb, $price]) {
        $plan[] = [
            'name' => fa_digits($gb) . ' گیگ | ' . fa_digits($days) . ' روز',
            'price' => $price, 'gb' => $gb, 'days' => $days, 'category' => $cat, 'sort' => ++$prodOrder,
        ];
    }
}

$names = array_column($plan, 'name');
if (count($names) !== count(array_unique($names))) {
    fail('internal error: duplicate product names in the plan');
}

// ---- report
echo ($dry ? "DRY RUN (nothing is written)\n" : "Seeding\n");
echo "panel: $panel | buyers: $agent | categories: " . count($cats) . " | products: " . count($plan) . "\n\n";
$newCats = array_diff(array_keys($cats), $existingCats);
$counts = ['insert' => 0, 'update' => 0, 'same' => 0];
foreach ($plan as &$p) {
    $p['action'] = isset($byName[$p['name']]) ? ($insertOnly ? 'same' : 'update') : 'insert';
    $counts[$p['action']]++;
    printf("  %-7s %-34s %-34s %s toman\n", $p['action'], $p['category'], $p['name'], number_format($p['price']));
}
unset($p);
echo "\ncategories to create: " . ($newCats ? implode(', ', $newCats) : 'none') . "\n";
echo "products: {$counts['insert']} new, {$counts['update']} updated, {$counts['same']} untouched\n";
if ($dry) {
    exit(0);
}

// ---- write (all or nothing)
$pdo->beginTransaction();
try {
    $insCat = $pdo->prepare($hasCatSort ? 'INSERT INTO category (remark, sort_order) VALUES (?, ?)' : 'INSERT INTO category (remark) VALUES (?)');
    $updCat = $hasCatSort ? $pdo->prepare('UPDATE category SET sort_order = ? WHERE remark = ?') : null;
    foreach ($cats as $name => $order) {
        if (in_array($name, $existingCats, true)) {
            $updCat && $updCat->execute([$order, $name]);
        } else {
            $hasCatSort ? $insCat->execute([$name, $order]) : $insCat->execute([$name]);
        }
    }

    $used = $pdo->query('SELECT code_product FROM product')->fetchAll(PDO::FETCH_COLUMN);
    $newCode = function () use (&$used) {
        do {
            $c = bin2hex(random_bytes(2));
        } while (in_array($c, $used, true));
        $used[] = $c;
        return $c;
    };
    $ins = $pdo->prepare('INSERT INTO product (code_product, name_product, price_product, Volume_constraint, Location, Service_time, agent, note, data_limit_reset, one_buy_status, category, hide_panel' . ($hasSort ? ', sort_order' : '') . ") VALUES (?,?,?,?,?,?,?,?,'no_reset','0',?,'{}'" . ($hasSort ? ',?' : '') . ')');
    $upd = $pdo->prepare('UPDATE product SET price_product = ?, Volume_constraint = ?, Service_time = ?, Location = ?, agent = ?, note = ?, category = ?' . ($hasSort ? ', sort_order = ?' : '') . ' WHERE id = ?');
    foreach ($plan as $p) {
        if ($p['action'] === 'insert') {
            $args = [$newCode(), $p['name'], (string) $p['price'], (string) $p['gb'], $panel, (string) $p['days'], $agent, NOTE, $p['category']];
            if ($hasSort) {
                $args[] = $p['sort'];
            }
            $ins->execute($args);
        } elseif ($p['action'] === 'update') {
            $args = [(string) $p['price'], (string) $p['gb'], (string) $p['days'], $panel, $agent, NOTE, $p['category']];
            if ($hasSort) {
                $args[] = $p['sort'];
            }
            $args[] = $byName[$p['name']];
            $upd->execute($args);
        }
    }
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    fail('database error, nothing was changed: ' . $e->getMessage());
}
echo "\nDone.\n";
