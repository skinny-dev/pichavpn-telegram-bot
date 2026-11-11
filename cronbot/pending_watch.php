<?php
// every 3 minutes: settle Tetraminator orders the gateway says are paid, and tell the report group about anything stuck
chdir(__DIR__);
ini_set('error_log', 'error_log');
date_default_timezone_set('Asia/Tehran');
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../botapi.php';
require_once __DIR__ . '/../panels.php';
require_once __DIR__ . '/../function.php';
require_once __DIR__ . '/../pending_watch.php';
require __DIR__ . '/../vendor/autoload.php';
$textbotlang = languagechange();
if ((getPaySettingValue('tetraminator_status', '') ?? '') === '' && (getPaySettingValue('variza_status', '') ?? '') === '') {
    exit; // neither gateway configured
}
pendingWatchRun($pdo, ['hours' => 48, 'deliver' => true, 'alert' => true, 'wait' => 15, 'limit' => 25]);
