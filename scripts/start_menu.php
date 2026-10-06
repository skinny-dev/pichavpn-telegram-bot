<?php
/*
 * Welcome-message guide buttons (🚀 شروع سریع | 📥 نصب و اتصال | 🔄 تمدید | 🛠 رفع مشکل).
 *   php scripts/start_menu.php status        # what is configured and which buttons are live
 *   php scripts/start_menu.php seed          # create the 4 help categories with starter articles (skips categories that already exist)
 *   php scripts/start_menu.php on | off      # show / hide the guide buttons under the welcome message
 *   php scripts/start_menu.php set "TEXT" "HELP CATEGORY"   # add or change a button (TEXT may start with a premium-mapped emoji)
 *   php scripts/start_menu.php url "TEXT" https://...         # a button that opens a link
 *   php scripts/start_menu.php remove "TEXT"
 *   php scripts/start_menu.php reset         # back to the default two buttons: 🚀 شروع سریع | 📚 آموزش
 * Articles are edited in the bot (آموزش management); the welcome text itself in the bot's text editor (users.text_start).
 */
if (PHP_SAPI !== 'cli') {
    exit;
}
chdir(__DIR__ . '/..');
require_once 'config.php';
require_once 'function.php';

$file = getenv('PICHA_START_MENU_FILE') ?: __DIR__ . '/../storage/start_menu.json';
$cfg = startMenuConfig();
$save = function () use ($file, &$cfg) {
    @mkdir(dirname($file), 0775, true);
    file_put_contents($file, json_encode($cfg, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);
};
$cmd = $argv[1] ?? 'status';

$articles = [
    'شروع سریع' => [
        ['۱) خرید اشتراک', "🛒 <b>خرید اشتراک در ۳ مرحله</b>\n\n۱. از منوی پایین «خرید اشتراک» رو بزن.\n۲. دسته‌بندی و پلن موردنظرت رو انتخاب کن.\n۳. پرداخت رو انجام بده؛ بعد از تأیید، لینک اشتراک و کانفیگ برات ارسال میشه.\n\nاگه موجودی کیف پولت کافیه، خرید همون لحظه انجام میشه."],
        ['۲) شارژ کیف پول', "💳 <b>شارژ کیف پول</b>\n\nاز منوی پایین «کیف پول + شارژ» رو بزن، مبلغ رو وارد کن و روش پرداخت (کارت‌به‌کارت یا درگاه) رو انتخاب کن.\n\nدر کارت‌به‌کارت، بعد از واریز دکمه «ارسال رسید» رو بزن و عکس رسید رو بفرست؛ بعد از تأیید، موجودی‌ات شارژ میشه."],
    ],
    'نصب و اتصال' => [
        ['اندروید', "🤖 <b>اتصال در اندروید</b>\n\n۱. یکی از برنامه‌های v2rayNG یا Hiddify رو نصب کن.\n۲. لینک اشتراکت رو از ربات کپی کن (روش «سرویس‌های من»).\n۳. در برنامه گزینه افزودن اشتراک / وارد کردن از کلیپ‌بورد رو بزن.\n۴. سرور رو انتخاب کن و دکمه اتصال رو بزن."],
        ['آیفون (iOS)', "🍎 <b>اتصال در آیفون</b>\n\n۱. یکی از برنامه‌های Streisand یا V2Box رو از اپ‌استور نصب کن.\n۲. لینک اشتراکت رو از ربات کپی کن.\n۳. در برنامه گزینه افزودن اشتراک / وارد کردن از کلیپ‌بورد رو بزن.\n۴. اتصال رو روشن کن و اجازه افزودن VPN رو بده."],
        ['ویندوز و مک', "💻 <b>اتصال در ویندوز و مک</b>\n\n۱. برنامه Hiddify یا v2rayN (ویندوز) رو نصب کن.\n۲. لینک اشتراکت رو کپی کن و در برنامه به‌عنوان اشتراک جدید اضافه کن.\n۳. اتصال رو روشن کن."],
    ],
    'تمدید' => [
        ['تمدید سرویس', "🔄 <b>تمدید سرویس</b>\n\n۱. از منوی پایین «تمدید سرویس» رو بزن.\n۲. سرویسی که میخوای تمدید بشه رو انتخاب کن.\n۳. پلن تمدید رو انتخاب و پرداخت کن.\n\nتمدید روی همون لینک قبلی انجام میشه و نیازی به نصب دوباره نیست."],
    ],
    'رفع مشکل' => [
        ['وصل نمیشه یا کنده', "🛠 <b>اگه وصل نمیشه یا سرعت پایینه</b>\n\n۱. اشتراکت رو در برنامه به‌روزرسانی (Update) کن.\n۲. یه کانفیگ یا سرور دیگه از لیست رو امتحان کن.\n۳. بین وای‌فای و اینترنت همراه جابه‌جا شو.\n۴. ساعت و تاریخ گوشی روی «خودکار» باشه.\n۵. برنامه رو کامل ببند و دوباره باز کن.\n\nاگه حل نشد، به پشتیبانی پیام بده: @pichanet_support"],
        ['حجم یا زمان تموم شده', "⏳ <b>حجم یا زمان تموم شده</b>\n\nاز «سرویس‌های من» وضعیت سرویس رو ببین و با دکمه تمدید، همون سرویس رو دوباره فعال کن. اگه مطمئنی هنوز حجم یا زمان داری ولی وصل نمیشه، با پشتیبانی در ارتباط باش: @pichanet_support"],
    ],
];

switch ($cmd) {
    case 'seed':
        $have = $pdo->query("SELECT DISTINCT category FROM help WHERE category IS NOT NULL AND category <> ''")->fetchAll(PDO::FETCH_COLUMN);
        $ins = $pdo->prepare("INSERT INTO help (name_os, Media_os, type_Media_os, category, Description_os) VALUES (?, '', '', ?, ?)");
        $added = 0;
        foreach ($articles as $cat => $items) {
            if (in_array($cat, $have, true)) {
                echo "skip «{$cat}» (already has articles)\n";
                continue;
            }
            foreach ($items as [$title, $body]) {
                $ins->execute([$title, $cat, $body]);
                $added++;
            }
            echo "added «{$cat}» (" . count($items) . " articles)\n";
        }
        // the guide buttons open a category; with categories on, the 📚 آموزش button shows the same categories
        $pdo->exec("UPDATE setting SET categoryhelp = '1'");
        echo "help categories mode: on. $added articles added. Edit them in the bot: آموزش management.\n";
        break;
    case 'on':
    case 'off':
        $cfg['enabled'] = $cmd === 'on';
        $save();
        echo "guide buttons under the welcome message: $cmd\n";
        break;
    case 'set':
        $text = $argv[2] ?? '';
        $help = $argv[3] ?? '';
        if ($text === '' || $help === '') {
            exit("usage: set \"TEXT\" \"HELP CATEGORY\"\n");
        }
        $cfg['buttons'] = array_values(array_filter($cfg['buttons'], fn($b) => ($b['text'] ?? '') !== $text));
        $cfg['buttons'][] = ['text' => $text, 'help' => $help];
        $save();
        echo "saved\n";
        break;
    case 'url':
        $text = $argv[2] ?? '';
        $url = $argv[3] ?? '';
        if ($text === '' || !preg_match('#^https?://#i', $url)) {
            exit("usage: url \"TEXT\" https://...\n");
        }
        $cfg['buttons'] = array_values(array_filter($cfg['buttons'], fn($b) => ($b['text'] ?? '') !== $text));
        $cfg['buttons'][] = ['text' => $text, 'url' => $url];
        $save();
        echo "saved\n";
        break;
    case 'reset':
        @unlink($file);
        echo "back to the default buttons (🚀 شروع سریع | 📚 آموزش)\n";
        break;
    case 'remove':
        $text = $argv[2] ?? '';
        $cfg['buttons'] = array_values(array_filter($cfg['buttons'], fn($b) => ($b['text'] ?? '') !== $text));
        $save();
        echo "removed (if it existed)\n";
        break;
    default:
        echo 'guide buttons: ' . (!empty($cfg['enabled']) ? 'ON' : 'OFF') . "\n";
        $live = [];
        foreach (startGuideButtons() as $row) {
            foreach ($row as $b) {
                $live[$b['text']] = ($b['callback_data'] ?? '') === 'helpsoon' ? 'soon' : true;
            }
        }
        foreach ($cfg['buttons'] as $b) {
            $t = $b['text'] ?? '?';
            $target = isset($b['url']) ? 'link ' . $b['url'] : (isset($b['callback']) ? 'opens ' . $b['callback'] : 'help category «' . ($b['help'] ?? '?') . '»');
            echo '  ' . (isset($live[$t]) ? '[shown]  ' : '[hidden] ') . "$t -> $target" . (($live[$t] ?? null) === 'soon' ? '   (no articles yet: shows «coming soon»)' : '') . "\n";
        }
}
