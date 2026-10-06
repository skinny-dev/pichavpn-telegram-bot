<?php
// Manage the premium (custom) emoji layer. Run on the bot server, from the bot folder:
//
//   php scripts/premium_emoji.php import https://t.me/addemoji/PACKNAME   # add every emoji of a pack (repeat for several packs)
//   php scripts/premium_emoji.php coverage                               # which emoji the bot uses, mapped or not
//   php scripts/premium_emoji.php preview "🔥 خرید سرویس"                 # see what a text becomes
//   php scripts/premium_emoji.php test 123456789                         # send a real test message + button to a chat id
//   php scripts/premium_emoji.php buttons on|off                         # show premium ICONS on buttons (off = buttons keep a normal emoji; recommended until `test` proves it)
//   php scripts/premium_emoji.php reply on|off                           # premium icons on the BOTTOM menu (reply keyboard); try `replytest` first
//   php scripts/premium_emoji.php replytest 123456789                    # sends a real bottom keyboard with premium icons so you can SEE if your Telegram draws them
//   php scripts/premium_emoji.php catalog preview                        # how your products/categories look with emoji (reads the database)
//   php scripts/premium_emoji.php catalog on|off                         # show emoji on product and category buttons (display only)
//   php scripts/premium_emoji.php alias list | set ✅ ✔ | unset ✅ | defaults on|off   # borrow a close premium emoji when a pack lacks one
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
    $base = ['enabled' => false, 'map' => [], 'packs' => [], 'alias' => [], 'catalog' => false];
    return is_array($raw) ? $raw + $base : $base;
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
        $why = function ($r) {
            $d = (string) ($r['description'] ?? '');
            if (stripos($d, 'chat not found') !== false || stripos($d, 'bot was blocked') !== false || stripos($d, 'user not found') !== false) {
                return 'chat';
            }
            if (stripos($d, 'emoji') !== false || stripos($d, 'entit') !== false || stripos($d, 'icon') !== false || stripos($d, 'premium') !== false) {
                return 'emoji';
            }
            return $r['ok'] ? '' : 'other';
        };
        $kinds = array_filter([$why($r1), $why($r2)]);
        if (in_array('chat', $kinds, true)) {
            echo "\nThis is NOT an emoji problem: Telegram cannot find that chat. Use YOUR OWN numeric Telegram ID (ask @userinfobot) and press Start on this bot first.\n";
        } elseif (in_array('emoji', $kinds, true)) {
            echo "\nTelegram refused the custom emoji for this bot (it only allows some bots, e.g. one with an extra username bought on Fragment, or whose owner has Telegram Premium).\n";
            echo "The bot falls back to normal emoji automatically, so nothing breaks.\n";
        } elseif ($kinds) {
            echo "\nTelegram refused the message for another reason; see the text above.\n";
        } else {
            echo "\nBoth worked. Telegram accepts premium emoji for this bot.\nLOOK at the second message on your phone/desktop: if the button shows the emoji icon in front of its text, run: php scripts/premium_emoji.php buttons on\nIf the button has no emoji, leave buttons off (messages still get premium emoji).\n";
        }
        break;

    case 'catalog':
        $sub = $argv[2] ?? 'preview';
        if ($sub === 'on' || $sub === 'off') {
            $cfg['catalog'] = $sub === 'on';
            pe_save($file, $cfg);
            echo 'catalog emoji ' . $sub . ($sub === 'on' && empty($cfg['enabled']) ? " (premium layer itself is off: plain emoji will show)" : '') . "\n";
            break;
        }
        $config = dirname(__DIR__) . '/config.php';
        ob_start();
        require $config;
        ob_end_clean();
        $mapNow = premiumEmojiConfig(true)['map'];
        $show = function ($emoji, $label) use ($mapNow) {
            $has = $emoji !== '' && isset($mapNow[premiumEmojiNormalize($emoji)]);
            return sprintf("  %-3s %s%s\n", $emoji === '' ? '·' : $emoji, $label, $emoji === '' ? '' : ($has ? '   [premium]' : '   [plain emoji]'));
        };
        echo "categories:\n";
        foreach ($pdo->query('SELECT id, remark FROM category ORDER BY id')->fetchAll(PDO::FETCH_ASSOC) as $row) {
            echo premiumEmojiStartsWithEmoji($row['remark']) ? $show('', $row['remark'] . '   (already has an emoji)') : $show(premiumCatalogEmoji('category', $row), $row['remark']);
        }
        echo "products:\n";
        foreach ($pdo->query('SELECT id, name_product, Volume_constraint, Service_time, category FROM product ORDER BY CAST(Service_time AS UNSIGNED), CAST(Volume_constraint AS UNSIGNED)')->fetchAll(PDO::FETCH_ASSOC) as $row) {
            echo premiumEmojiStartsWithEmoji($row['name_product']) ? $show('', $row['name_product'] . '   (already has an emoji)') : $show(premiumCatalogEmoji('product', $row), $row['name_product']);
        }
        echo "\nNothing is stored. Turn it on with: php scripts/premium_emoji.php catalog on\n";
        echo "Change one item: add to storage/premium_emoji.json  \"catalog_override\": {\"product\": {\"13\": \"🔥\"}, \"category\": {\"1\": \"🗓\"}}\n";
        break;

    case 'alias':
        $sub = $argv[2] ?? 'list';
        if ($sub === 'set' && !empty($argv[3]) && !empty($argv[4])) {
            $cfg['alias'][premiumEmojiNormalize($argv[3])] = premiumEmojiNormalize($argv[4]);
            pe_save($file, $cfg);
            echo "alias {$argv[3]} -> {$argv[4]}\n";
        } elseif ($sub === 'unset') {
            unset($cfg['alias'][premiumEmojiNormalize($argv[3] ?? '')]);
            pe_save($file, $cfg);
            echo "removed\n";
        } elseif ($sub === 'defaults') {
            $cfg['use_default_aliases'] = ($argv[3] ?? 'on') !== 'off';
            pe_save($file, $cfg);
            echo 'default aliases ' . ($cfg['use_default_aliases'] ? 'on' : 'off') . "\n";
        } else {
            $direct = $cfg['map'];
            $all = (($cfg['use_default_aliases'] ?? true) ? premiumEmojiDefaultAliases() : []) + $cfg['alias'];
            foreach ($all as $from => $to) {
                $from = premiumEmojiNormalize($from);
                $to = premiumEmojiNormalize($to);
                $state = isset($direct[$from]) ? 'not needed (pack has it)' : (isset($direct[$to]) ? 'active' : 'inactive (pack has no ' . $to . ')');
                echo "  $from -> $to   $state\n";
            }
        }
        break;

    case 'buttons':
        $sub = $argv[2] ?? '';
        if ($sub !== 'on' && $sub !== 'off') {
            echo 'premium icons on buttons: ' . (!empty($cfg['buttons']) ? 'on' : 'off') . "\nuse: buttons on | buttons off\n";
            break;
        }
        $cfg['buttons'] = $sub === 'on';
        pe_save($file, $cfg);
        echo 'premium icons on buttons: ' . $sub . ($sub === 'on' ? "\nAfter this, buttons show the premium emoji as an icon in front of the text. If a button then looks wrong or has no emoji on your phone, run: buttons off\n" : "\nButtons now keep their normal emoji.\n") . "\n";
        break;

    case 'reply':
        $sub = $argv[2] ?? '';
        if ($sub !== 'on' && $sub !== 'off') {
            echo 'premium icons on the bottom menu: ' . (!empty($cfg['reply_buttons']) ? 'on' : 'off') . "\nuse: reply on | reply off\n";
            break;
        }
        $cfg['reply_buttons'] = $sub === 'on';
        pe_save($file, $cfg);
        echo 'premium icons on the bottom menu: ' . $sub . ($sub === 'on' ? "\nThe bottom menu buttons now carry the premium emoji as an icon, and labels you edit with a premium emoji apply too.\nTaps are matched back to the original labels automatically. If the menu looks wrong, run: reply off (instant)\n" : "\nThe bottom menu keeps normal emoji.\n");
        break;

    case 'replytest':
        $chat = $argv[2] ?? '';
        if (!preg_match('/^-?\d{5,}$/', $chat) || empty($cfg['map'])) {
            echo "usage: replytest YOUR_NUMERIC_TELEGRAM_ID   (press Start on the bot first; needs imported packs)\n";
            break;
        }
        $ids = $cfg['map'];
        $pairs = array_slice($ids, 0, 2, true);
        $kb = [[]];
        $n = 0;
        foreach ($pairs as $emo => $emoId) {
            $kb[0][] = ['text' => 'دکمه آزمایشی ' . (++$n), 'icon_custom_emoji_id' => (string) $emoId];
        }
        $r = pe_api('sendMessage', ['chat_id' => $chat, 'text' => "کیبورد آزمایشی پایین صفحه فرستاده شد.\nاگر جلوی متن دکمه‌ها ایموجی پریمیوم می‌بینید، دستور «reply on» را بزنید.\nبرای برگشت منوی اصلی، /start را بفرستید.", 'reply_markup' => json_encode(['keyboard' => $kb, 'resize_keyboard' => true], JSON_UNESCAPED_UNICODE)]);
        echo $r['ok'] ? "sent. Look at the bottom keyboard: do the two buttons show an emoji ICON in front of the text? If yes: reply on. Send /start to the bot to restore the normal menu.\n" : 'REFUSED: ' . ($r['description'] ?? '?') . "\nTelegram does not accept button icons for this bot; leave reply off.\n";
        break;

    case 'status':
        echo 'enabled: ' . (!empty($cfg['enabled']) ? 'yes' : 'no') . "\n";
        echo 'premium icons on buttons: ' . (!empty($cfg['buttons']) ? 'on' : 'off (buttons show a normal emoji)') . "\n";
        echo 'premium icons on the bottom menu: ' . (!empty($cfg['reply_buttons']) ? 'on' : 'off (normal emoji)') . "\n";
        echo 'catalog emoji on products/categories: ' . (!empty($cfg['catalog']) ? 'on' : 'off') . "\n";
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
        foreach (array_slice(file(__FILE__), 1) as $line) {
            if (strncmp($line, '//', 2) !== 0) {
                break;
            }
            echo ltrim(substr($line, 2), ' ') === "\n" ? "\n" : substr($line, 3);
        }
}
