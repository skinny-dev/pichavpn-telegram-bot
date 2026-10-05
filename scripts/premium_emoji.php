<?php
// Manage the premium (custom) emoji layer. Run on the bot server, from the bot folder:
//
//   php scripts/premium_emoji.php import https://t.me/addemoji/PACKNAME   # add every emoji of a pack (repeat for several packs)
//   php scripts/premium_emoji.php coverage                               # which emoji the bot uses, mapped or not
//   php scripts/premium_emoji.php preview "🔥 خرید سرویس"                 # see what a text becomes
//   php scripts/premium_emoji.php test 123456789                         # send a real test message + button to a chat id
//   php scripts/premium_emoji.php status | on | off | set 🔥 ID | unset 🔥 | export | clear
//
// Config lives in storage/premium_emoji.json. Turning it off or removing it returns the bot to plain emoji at once.

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require_once dirname(__DIR__) . '/premium_emoji.php';

$file = premiumEmojiFile();

function pe_load($file)
{
    $raw = is_file($file) ? json_decode((string) file_get_contents($file), true) : null;
    return is_array($raw) ? $raw + ['enabled' => false, 'map' => [], 'packs' => []] : ['enabled' => false, 'map' => [], 'packs' => []];
}

function pe_save($file, array $cfg)
{
    @mkdir(dirname($file), 0775, true);
    $tmp = $file . '.tmp';
    if (file_put_contents($tmp, json_encode($cfg, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX) === false || !rename($tmp, $file)) {
        fwrite(STDERR, "cannot write $file\n");
        exit(1);
    }
    @chmod($file, 0644);
}

function pe_token()
{
    $config = dirname(__DIR__) . '/config.php';
    if (!is_file($config)) {
        fwrite(STDERR, "config.php not found (run from the bot folder)\n");
        exit(1);
    }
    ob_start();
    require $config;
    ob_end_clean();
    if (empty($APIKEY) || strpos($APIKEY, '{') !== false) {
        fwrite(STDERR, "no bot token in config.php\n");
        exit(1);
    }
    return $APIKEY;
}

function pe_api($method, array $params = [])
{
    $ch = curl_init('https://api.telegram.org/bot' . pe_token() . '/' . $method);
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => json_encode($params), CURLOPT_HTTPHEADER => ['Content-Type: application/json'], CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20]);
    $out = curl_exec($ch);
    $err = curl_error($ch);
    curl_close($ch);
    if ($out === false) {
        return ['ok' => false, 'description' => 'network error: ' . $err];
    }
    return json_decode($out, true) ?: ['ok' => false, 'description' => 'invalid response'];
}

$cmd = $argv[1] ?? 'help';
$cfg = pe_load($file);

switch ($cmd) {
    case 'import':
        $arg = $argv[2] ?? '';
        if (!preg_match('#(?:addemoji/|^)([A-Za-z0-9_]{3,64})/?$#', trim($arg), $m)) {
            fwrite(STDERR, "give a pack link like https://t.me/addemoji/PackName (or just PackName)\n");
            exit(1);
        }
        $res = pe_api('getStickerSet', ['name' => $m[1]]);
        if (empty($res['ok'])) {
            fwrite(STDERR, 'Telegram: ' . ($res['description'] ?? 'error') . "\n");
            exit(1);
        }
        $set = $res['result'];
        if (($set['sticker_type'] ?? '') !== 'custom_emoji') {
            fwrite(STDERR, "\"{$set['title']}\" is a sticker pack, not a custom emoji pack. Use a link that contains /addemoji/.\n");
            exit(1);
        }
        $added = 0;
        $dupes = 0;
        foreach ($set['stickers'] as $st) {
            $e = premiumEmojiNormalize($st['emoji'] ?? '');
            $id = (string) ($st['custom_emoji_id'] ?? '');
            if ($e === '' || $id === '') {
                continue;
            }
            if (isset($cfg['map'][$e])) {
                $dupes++;
                continue;
            }
            $cfg['map'][$e] = $id;
            $added++;
        }
        $cfg['packs'][$m[1]] = $set['title'] ?? $m[1];
        $cfg['enabled'] = true;
        pe_save($file, $cfg);
        echo "pack \"{$set['title']}\": " . count($set['stickers']) . " emoji, $added new mappings added, $dupes skipped (that base emoji already had one)\n";
        echo 'total mapped emoji: ' . count($cfg['map']) . "\nenabled. Next: php scripts/premium_emoji.php coverage   and   test YOUR_CHAT_ID\n";
        break;

    case 'coverage':
        $mapped = premiumEmojiConfig(true)['map'];
        $counts = [];
        $files = glob(dirname(__DIR__) . '/lang/fa.php');
        foreach (array_merge($files, glob(dirname(__DIR__) . '/{keyboard,index,admin,function}.php', GLOB_BRACE)) as $f) {
            if (preg_match_all('/\p{Extended_Pictographic}(?:\x{FE0F})?(?:\x{200D}\p{Extended_Pictographic}\x{FE0F}?)*/u', (string) file_get_contents($f), $mm)) {
                foreach ($mm[0] as $emo) {
                    $k = premiumEmojiNormalize($emo);
                    $counts[$k] = ($counts[$k] ?? 0) + 1;
                }
            }
        }
        arsort($counts);
        $tot = array_sum($counts);
        $cov = 0;
        foreach ($counts as $k => $n) {
            if (isset($mapped[$k])) {
                $cov += $n;
            }
        }
        echo 'emoji used in the bot: ' . count($counts) . " kinds, $tot uses\n";
        printf("covered by your packs: %d uses (%.0f%%)\n\n", $cov, $tot ? $cov * 100 / $tot : 0);
        echo "most used WITHOUT a premium version (add a pack that has them):\n";
        $shown = 0;
        foreach ($counts as $k => $n) {
            if (!isset($mapped[$k]) && $shown++ < 25) {
                echo "  $k  ×$n\n";
            }
        }
        break;

    case 'preview':
        $text = $argv[2] ?? '';
        $out = premiumEmojiWrapHtml($text);
        echo $out . "\n";
        echo $out === $text ? "(unchanged: layer is off, or none of these emoji are mapped)\n" : '(as a button label it shows "' . premiumEmojiButtonText($text) . "\" with the first emoji as its icon)\n";
        break;

    case 'test':
        $chat = $argv[2] ?? '';
        $map = premiumEmojiConfig(true)['map'];
        if ($chat === '' || !$map) {
            fwrite(STDERR, "usage: test CHAT_ID (and import a pack first)\n");
            exit(1);
        }
        $ids = array_slice($map, 0, 2, true);
        $emo = array_keys($ids);
        $text = implode(' ', array_map(function ($e) {
            return $e;
        }, $emo)) . " این یک پیام آزمایشی ایموجی پریمیوم است";
        $payload = premiumEmojiApplyPayload([
            'chat_id' => $chat, 'parse_mode' => 'HTML', 'text' => $text,
            'reply_markup' => json_encode(['inline_keyboard' => [[['text' => $emo[0] . ' دکمه آزمایشی', 'callback_data' => 'noop']]]], JSON_UNESCAPED_UNICODE),
        ], 'sendMessage');
        // same conversion botapi.php does: first <tg-emoji> in a label becomes the button icon
        $markup = json_decode($payload['reply_markup'], true);
        foreach ($markup['inline_keyboard'] as $r => $row) {
            foreach ($row as $b => $btn) {
                if (preg_match('#<tg-emoji\b[^>]*emoji-id="(\d+)"[^>]*>.*?</tg-emoji>#isu', $btn['text'], $mm)) {
                    $markup['inline_keyboard'][$r][$b]['icon_custom_emoji_id'] = $mm[1];
                    $markup['inline_keyboard'][$r][$b]['text'] = trim(preg_replace('#<tg-emoji\b[^>]*>(.*?)</tg-emoji>#isu', '', $btn['text']));
                }
            }
        }
        $payload['reply_markup'] = $markup;
        echo "sending message with premium emoji in the text ...\n";
        $r1 = pe_api('sendMessage', ['chat_id' => $chat, 'parse_mode' => 'HTML', 'text' => $payload['text']]);
        echo $r1['ok'] ? "  text: OK. Check Telegram: the emoji should be animated/premium.\n" : '  text: REFUSED: ' . $r1['description'] . "\n";
        echo "sending a button with a premium icon ...\n";
        $r2 = pe_api('sendMessage', ['chat_id' => $chat, 'text' => 'دکمه با آیکون پریمیوم', 'reply_markup' => $payload['reply_markup']]);
        echo $r2['ok'] ? "  button: OK\n" : '  button: REFUSED: ' . $r2['description'] . "\n";
        if (!$r1['ok'] || !$r2['ok']) {
            echo "\nTelegram only lets some bots use custom emoji (e.g. the bot needs an extra username bought on Fragment, or its owner needs Telegram Premium).\n";
            echo "The bot already falls back to normal emoji automatically, so nothing breaks.\n";
        }
        break;

    case 'status':
        echo 'enabled: ' . (!empty($cfg['enabled']) ? 'yes' : 'no') . "\n";
        echo 'mapped emoji: ' . count($cfg['map']) . "\n";
        foreach ($cfg['packs'] as $n => $t) {
            echo "  pack $n ($t)\n";
        }
        break;

    case 'on':
    case 'off':
        $cfg['enabled'] = $cmd === 'on';
        pe_save($file, $cfg);
        echo 'premium emoji ' . $cmd . "\n";
        break;

    case 'set':
        if (empty($argv[3]) || !preg_match('/^\d{5,25}$/', $argv[3])) {
            fwrite(STDERR, "usage: set EMOJI CUSTOM_EMOJI_ID\n");
            exit(1);
        }
        $cfg['map'][premiumEmojiNormalize($argv[2])] = $argv[3];
        $cfg['enabled'] = true;
        pe_save($file, $cfg);
        echo "mapped {$argv[2]} -> {$argv[3]}\n";
        break;

    case 'unset':
        unset($cfg['map'][premiumEmojiNormalize($argv[2] ?? '')]);
        pe_save($file, $cfg);
        echo "removed\n";
        break;

    case 'export':
        foreach ($cfg['map'] as $e => $id) {
            echo "$e\t$id\n";
        }
        break;

    case 'clear':
        pe_save($file, ['enabled' => false, 'map' => [], 'packs' => []]);
        echo "cleared\n";
        break;

    default:
        echo file_get_contents(__FILE__, false, null, 0, 1100);
}
