<?php
// Starts the server-status test in the background when it is due (the test takes minutes; the cron dispatcher must not wait).
$ssFile = dirname(__DIR__) . '/storage/server_status.json';
$ssCfg = is_file($ssFile) ? json_decode((string) file_get_contents($ssFile), true) : null;
if (!empty($ssCfg['enabled'])) {
    $php = function_exists('mirza_cron_php_binary') ? mirza_cron_php_binary() : 'php';
    exec(escapeshellarg($php) . ' ' . escapeshellarg(dirname(__DIR__) . '/scripts/server_status.php') . ' auto > /dev/null 2>&1 &');
}
