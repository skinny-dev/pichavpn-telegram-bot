<?php
// Standalone "bot is updating" responder. No database needed.
// Token: put it in maintenance/token.txt (git-ignored) or set the BOT_TOKEN env var.

$token = getenv('BOT_TOKEN') ?: trim((string) @file_get_contents(__DIR__ . '/token.txt'));
if ($token === '') {
    http_response_code(500);
    exit('missing token');
}

$text = "درود وقتتون بخیر، ربات درحال بروزرسانی  میباشد.\n"
      . "لطفا برای خرید، تمدید و پیگیری سرویس ها به پشتیبانی پیام بدید :\n"
      . "@pichanet_support";

$update = json_decode(file_get_contents('php://input'), true);
$chatId = $update['message']['chat']['id']
    ?? $update['callback_query']['message']['chat']['id']
    ?? null;

if ($chatId !== null) {
    if (isset($update['callback_query']['id'])) {
        tg($token, 'answerCallbackQuery', ['callback_query_id' => $update['callback_query']['id']]);
    }
    tg($token, 'sendMessage', ['chat_id' => $chatId, 'text' => $text]);
}
http_response_code(200);

function tg($token, $method, $params)
{
    $ch = curl_init("https://api.telegram.org/bot$token/$method");
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $params,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 10,
    ]);
    $res = curl_exec($ch);
    curl_close($ch);
    return $res;
}
