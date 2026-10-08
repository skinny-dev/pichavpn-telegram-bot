<?php
/*
 * Admin notification test from the server:  php scripts/admin_test.php
 * Sends a test message to every admin and prints who received it (same as the bot command /admintest).
 */
if (PHP_SAPI !== 'cli') {
    exit;
}
chdir(__DIR__ . '/..');
require_once 'config.php';
require_once 'botapi.php';
require_once 'function.php';
$rows = adminTestNotify('تست از سرور');
foreach ($rows as $r) {
    echo strip_tags(adminTestLine($r)) . "\n";
}
echo $rows ? '' : "no admins in the admin table\n";
exit(count(array_filter($rows, fn($r) => !$r['ok'])) ? 1 : 0);
