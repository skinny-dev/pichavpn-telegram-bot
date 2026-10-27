<?php
// Runs the whole bot (index.php) for an update a bot on Telegram Serverless received.
// The serverless bot posts the Telegram update as it is:  POST /serverless_relay.php   header X-Picha-Key: <key>
//
// Two bots can use it, each with its own key (storage/serverless.json, scripts/serverless_setup.php):
//   key       + bot_token  the dev bot  (relay on):      answers with the dev bot; groups/channels it is not in go
//                          through the main bot; files are moved between the two bots
//   main_key              the main bot (main_relay on): @pichanet_bot itself runs on Serverless; answers with its own token
// Serverless gets its answer at once; the bot's work (panels, payments …) carries on here afterwards.

$cfgFile = __DIR__ . '/storage/serverless.json';
$cfg = is_file($cfgFile) ? (json_decode((string) file_get_contents($cfgFile), true) ?: []) : [];
header('Content-Type: application/json; charset=utf-8');
if (($cfg['enabled'] ?? true) === false) {
    http_response_code(404);
    exit('{"ok":false,"error":"relay_off"}');
}
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405);
    exit('{"ok":false,"error":"method"}');
}
$given = (string) ($_SERVER['HTTP_X_PICHA_KEY'] ?? '');
$asMain = $given !== '' && !empty($cfg['main_key']) && hash_equals((string) $cfg['main_key'], $given);
$asDev = $given !== '' && !$asMain && !empty($cfg['key']) && hash_equals((string) $cfg['key'], $given);
if (!$asMain && !$asDev) {
    usleep(300000);
    http_response_code(401);
    exit('{"ok":false,"error":"key"}');
}
if (($asMain && empty($cfg['main_relay'])) || ($asDev && (empty($cfg['relay']) || empty($cfg['bot_token'])))) {
    http_response_code(404); // switched off: the serverless bot shows its own message
    exit('{"ok":false,"error":"relay_off"}');
}
$update = json_decode((string) file_get_contents('php://input'), true); // botapi.php reads the same body again
if (!is_array($update) || !isset($update['update_id'])) {
    http_response_code(400);
    exit('{"ok":false,"error":"update"}');
}

chdir(__DIR__);
require_once __DIR__ . '/config.php';
define('PICHA_RELAY_MAIN_KEY', $APIKEY);
define('PICHA_RELAY_DEV_KEY', $asMain ? $APIKEY : (string) $cfg['bot_token']); // same token = the main bot itself
$APIKEY = PICHA_RELAY_DEV_KEY; // function.php loads config.php again; index.php sets this back after its requires
unset($cfg, $given, $update, $asMain, $asDev);

// answer Serverless now, so a slow panel or gateway never makes it give up on the update
ignore_user_abort(true);
set_time_limit(120);
http_response_code(200);
header('Content-Length: 11');
header('Connection: close');
echo '{"ok":true}';
while (ob_get_level() > 0) {
    ob_end_flush();
}
flush();
if (function_exists('fastcgi_finish_request')) {
    fastcgi_finish_request();
}
ob_start(); // whatever index.php prints goes nowhere
register_shutdown_function(function () {
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
});
require __DIR__ . '/index.php';
