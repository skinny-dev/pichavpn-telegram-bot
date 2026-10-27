<?php
// Export the bot's data for the Serverless bot: one NDJSON file per table (same table and column names as
// serverless-bot/tgcloud/schema.js) plus the bot's texts (lang/fa.php + edits) as texts.ndjson.
//
//   php scripts/serverless_export.php                    # → /root/picha-export/ (folder is replaced)
//   php scripts/serverless_export.php --out=/path
//   php scripts/serverless_export.php --tables=user,invoice
// Then on the machine with the Serverless project:  node tools/import.mjs /path/to/export
// Reads only. The folder holds customers' data and panel passwords: keep it private and delete it after the import.

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
$root = dirname(__DIR__);
chdir($root);
require $root . '/config.php';
require_once $root . '/botapi.php';
require_once $root . '/function.php';

$out = '/root/picha-export';
$only = null;
foreach (array_slice($argv, 1) as $a) {
    if (str_starts_with($a, '--out=')) {
        $out = rtrim(substr($a, 6), '/');
    } elseif (str_starts_with($a, '--tables=')) {
        $only = array_filter(explode(',', substr($a, 9)));
    }
}

// the tables (and their columns) the Serverless bot declares
$schemaFile = $root . '/serverless-bot/tgcloud/schema.js';
$schema = (string) @file_get_contents($schemaFile);
preg_match_all("/export const \\w+ = table\\('([^']+)', \\{(.*?)\\n\\}/s", $schema, $m, PREG_SET_ORDER);
$declared = [];
foreach ($m as $t) {
    preg_match_all("/: (?:integer|text|real)\\('([^']+)'\\)/u", $t[2], $c);
    $declared[$t[1]] = $c[1];
}
if (!$declared) {
    fwrite(STDERR, "❌ $schemaFile پیدا نشد یا خالی است\n");
    exit(1);
}

if (is_dir($out)) {
    array_map('unlink', glob("$out/*.ndjson") ?: []);
}
@mkdir($out, 0700, true);
@chmod($out, 0700);
$have = $pdo->query("SHOW TABLES")->fetchAll(PDO::FETCH_COLUMN);
$total = 0;
$report = [];
foreach ($declared as $table => $cols) {
    if ($only && !in_array($table, $only, true)) {
        continue;
    }
    if (!in_array($table, $have, true)) {
        $report[] = "⏭ $table: در این دیتابیس نیست";
        continue;
    }
    $live = $pdo->query("SHOW COLUMNS FROM `$table`")->fetchAll(PDO::FETCH_COLUMN);
    $use = array_values(array_intersect($cols, $live));
    $extra = array_diff($live, $cols);
    $fh = fopen("$out/$table.ndjson", 'w');
    $n = 0;
    $st = $pdo->query("SELECT " . implode(', ', array_map(fn($c) => "`$c`", $use)) . " FROM `$table`");
    while ($row = $st->fetch(PDO::FETCH_ASSOC)) {
        fwrite($fh, json_encode($row, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE) . "\n");
        $n++;
    }
    fclose($fh);
    $total += $n;
    $report[] = "✅ $table: $n" . ($extra ? '  (ستون‌های بیرون از schema: ' . implode(', ', $extra) . ')' : '');
}

// texts: the same values the PHP bot uses (lang file + lang/override + texts edited from the admin menu)
if (!$only || in_array('texts', $only, true)) {
    $from_id = 0;
    $texts = languagechange();
    $flat = [];
    $walk = function ($a, $p) use (&$walk, &$flat) {
        foreach ($a as $k => $v) {
            $key = $p === '' ? (string) $k : "$p.$k";
            is_array($v) ? $walk($v, $key) : $flat[$key] = $v;
        }
    };
    $walk($texts, '');
    $fh = fopen("$out/texts.ndjson", 'w');
    foreach ($flat as $k => $v) {
        fwrite($fh, json_encode(['key' => $k, 'value' => is_scalar($v) || $v === null ? $v : json_encode($v)], JSON_UNESCAPED_UNICODE) . "\n");
    }
    fclose($fh);
    $report[] = "✅ texts: " . count($flat);
}
// the bot's settings files (storage/*.json) → kv rows 'storage:<name>' (no secrets: serverless.json etc. are not taken)
if (!$only || in_array('kv', $only, true)) {
    $fh = fopen("$out/kv.ndjson", 'w');
    $n = 0;
    foreach (['custom_price.json', 'premium_emoji.json', 'premium_reply_labels.json', 'promo.json', 'start_menu.json', 'dashboard_access.json', 'cron_status.json'] as $f) {
        if (is_file("$root/storage/$f")) {
            fwrite($fh, json_encode(['key' => "storage:$f", 'value' => (string) file_get_contents("$root/storage/$f"), 'updated_at' => time()], JSON_UNESCAPED_UNICODE) . "\n");
            $n++;
        }
    }
    fclose($fh);
    $report[] = "✅ settings files: $n";
}
echo implode("\n", $report) . "\n\nجمع: $total ردیف در $out\n⚠️ این پوشه اطلاعات مشتری‌ها و رمز پنل‌ها را دارد؛ بعد از import پاکش کنید.\n";
