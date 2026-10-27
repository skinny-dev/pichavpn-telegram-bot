<?php
// Runs the whole bot (index.php) for an update the dev bot on Telegram Serverless received, and answers with the dev bot.
// The serverless bot posts the Telegram update as it is:  POST /serverless_relay.php   header X-Picha-Key: <key>
// Same database, same customers, same texts/buttons/purchases as the main bot. Off until
// `php scripts/serverless_setup.php relay on` (and a key + the dev bot's token are set).
// Messages to groups/channels (reports, channel-join checks) fall back to the main bot when the dev bot is not there.

$cfgFile = __DIR__ . '/storage/serverless.json';
$cfg = is_file($cfgFile) ? (json_decode((string) file_get_contents($cfgFile), true) ?: []) : [];
$key = (string) ($cfg['key'] ?? '');
header('Content-Type: application/json; charset=utf-8');
if ($key === '' || ($cfg['enabled'] ?? true) === false || empty($cfg['relay']) || empty($cfg['bot_token'])) {
    http_response_code(404);
    exit('{"ok":false,"error":"relay_off"}');
}
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405);
    exit('{"ok":false,"error":"method"}');
}
$given = (string) ($_SERVER['HTTP_X_PICHA_KEY'] ?? '');
if ($given === '' || !hash_equals($key, $given)) {
    usleep(300000);
    http_response_code(401);
    exit('{"ok":false,"error":"key"}');
}
$update = json_decode((string) file_get_contents('php://input'), true); // botapi.php reads the same body again
if (!is_array($update) || !isset($update['update_id'])) {
    http_response_code(400);
    exit('{"ok":false,"error":"update"}');
}

chdir(__DIR__);
require_once __DIR__ . '/config.php';
define('PICHA_RELAY_MAIN_KEY', $APIKEY);
define('PICHA_RELAY_DEV_KEY', (string) $cfg['bot_token']);
$APIKEY = PICHA_RELAY_DEV_KEY; // function.php loads config.php again; index.php sets this back after its requires
unset($cfg, $key, $given, $update);
ignore_user_abort(true);
ob_start();
register_shutdown_function(function () {
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
    http_response_code(200);
    echo '{"ok":true}';
});
require __DIR__ . '/index.php';
