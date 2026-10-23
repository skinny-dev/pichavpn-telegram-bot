<?php
// Gift volume to every customer (e.g. an apology for an outage) and tell them in the bot.
//
//   php scripts/gift_volume.php --gb=2                       # PREVIEW: who would get it, changes nothing
//   php scripts/gift_volume.php --gb=2 --apply               # add the volume on the panel
//   php scripts/gift_volume.php --gb=2 --apply --message     # … and send the message to the customers who got it
//   php scripts/gift_volume.php --message-only               # only (re)send the message to those who got it
//   php scripts/gift_volume.php --test-message=TELEGRAM_ID   # send the message to one account (yours) to see it
//
// Options: --tag=NAME (default: today; a service gets the gift once per tag, so re-running is safe)
//          --status=active,limited,on_hold   which services (limited = volume ran out; the gift reconnects them)
//          --text=FILE   message text (HTML) from a file; {gb} is replaced by the amount
// Unlimited services (no volume limit) and expired / disabled ones are skipped.

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
$root = dirname(__DIR__);
chdir($root);
require $root . '/config.php';
require_once $root . '/botapi.php';
require_once $root . '/jdf.php';
require_once $root . '/function.php';
require_once $root . '/panels.php';

$o = [];
foreach (array_slice($argv, 1) as $a) {
    if (preg_match('/^--([a-z-]+)(?:=(.*))?$/s', $a, $m)) {
        $o[$m[1]] = $m[2] ?? true;
    }
}
$gb = (float) ($o['gb'] ?? 2);
$tag = preg_replace('/[^\w-]/', '', (string) ($o['tag'] ?? date('Y-m-d')));
$statuses = array_filter(explode(',', (string) ($o['status'] ?? 'active,limited,on_hold')));
$apply = isset($o['apply']);
$ledgerFile = $root . "/storage/gift_volume_$tag.json";
$ledger = is_file($ledgerFile) ? (json_decode((string) file_get_contents($ledgerFile), true) ?: []) : [];
$ledger += ['gb' => $gb, 'users' => [], 'messaged' => []];
$saveLedger = function () use (&$ledger, $ledgerFile) {
    @mkdir(dirname($ledgerFile), 0775, true);
    file_put_contents($ledgerFile, json_encode($ledger, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
};

$faNum = fn($n) => strtr((string) $n, ['0' => '۰', '1' => '۱', '2' => '۲', '3' => '۳', '4' => '۴', '5' => '۵', '6' => '۶', '7' => '۷', '8' => '۸', '9' => '۹', '.' => '٫']);
$text = isset($o['text']) && is_file((string) $o['text']) ? (string) file_get_contents((string) $o['text']) : <<<TXT
🌟 <b>از صبوری‌تون ممنونیم</b>

کاربر عزیز پیچا 🐈‍⬛
بابت اختلال‌ها و قطعی‌های چند روز اخیر صمیمانه عذرخواهی می‌کنیم 🙏
به جبران این مدت، <b>{gb} گیگ حجم هدیه</b> به سرویس شما اضافه شد 🎁

✅ نیازی به انجام کاری نیست؛ حجم هدیه همین الان روی سرویستون فعاله.
🔄 اگر اتصال مشکل داشت، یک‌بار اشتراک رو در اپ آپدیت (Update) کنید.

💬 پشتیبانی: @pichavpn_support
با تشکر، تیم پیچا 💜
TXT;
$text = str_replace('{gb}', $faNum(rtrim(rtrim(number_format($gb, 2, '.', ''), '0'), '.')), $text);

$send = function ($chatId) use ($text) {
    for ($try = 0; $try < 3; $try++) {
        $r = telegram('sendMessage', ['chat_id' => $chatId, 'text' => $text, 'parse_mode' => 'HTML', 'disable_web_page_preview' => true]);
        if (!empty($r['ok'])) {
            return true;
        }
        $wait = (int) ($r['parameters']['retry_after'] ?? 0);
        if ($wait > 0) { // Telegram asks to slow down
            sleep($wait + 1);
            continue;
        }
        return false; // blocked the bot, deleted account…
    }
    return false;
};

if (isset($o['test-message'])) {
    echo $send((string) $o['test-message']) ? "✅ پیام آزمایشی فرستاده شد\n" : "❌ ارسال نشد\n";
    exit;
}

// ---------- 1. add the volume ----------
if (!isset($o['message-only'])) {
    $panels = $pdo->query("SELECT * FROM marzban_panel WHERE type = 'marzban' AND status != 'disable'")->fetchAll(PDO::FETCH_ASSOC);
    $mp = new ManagePanel();
    $plan = [];
    foreach ($panels as $panel) {
        $tok = token_panel($panel['code_panel'], false);
        if (empty($tok['access_token'])) {
            echo "❌ ورود به پنل {$panel['name_panel']} نشد\n";
            continue;
        }
        foreach ($statuses as $st) {
            for ($off = 0; ; $off += 200) {
                $ch = curl_init(rtrim($panel['url_panel'], '/') . "/api/users?status=$st&offset=$off&limit=200");
                curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60, CURLOPT_SSL_VERIFYPEER => false, CURLOPT_SSL_VERIFYHOST => false,
                    CURLOPT_HTTPHEADER => ['Accept: application/json', 'Authorization: Bearer ' . $tok['access_token']]]);
                $r = json_decode((string) curl_exec($ch), true);
                curl_close($ch);
                $batch = $r['users'] ?? [];
                foreach ($batch as $u) {
                    if ((int) ($u['data_limit'] ?? 0) <= 0) {
                        continue; // unlimited
                    }
                    $plan[] = ['panel' => $panel['name_panel'], 'username' => $u['username'], 'status' => $u['status'] ?? $st, 'limit' => (int) $u['data_limit']];
                }
                if (count($batch) < 200) {
                    break;
                }
            }
        }
    }
    $todo = array_values(array_filter($plan, fn($p) => !isset($ledger['users'][$p['panel'] . '|' . $p['username']])));
    $byStatus = array_count_values(array_column($todo, 'status'));
    echo "سرویس‌هایی که " . $gb . " گیگ می‌گیرند: " . count($todo) . "  (" . implode('، ', array_map(fn($k, $v) => "$k: $v", array_keys($byStatus), $byStatus)) . ")\n";
    echo "قبلاً با برچسب «{$tag}» گرفته‌اند: " . (count($plan) - count($todo)) . "\n";
    foreach (array_slice($todo, 0, 8) as $p) {
        echo "  • {$p['username']} ({$p['status']}): " . round($p['limit'] / 1073741824, 2) . " → " . round($p['limit'] / 1073741824 + $gb, 2) . " GB\n";
    }
    if (!$apply) {
        echo "\nپیش‌نمایش بود؛ هیچ تغییری داده نشد. برای اعمال:  --apply  (و برای پیام هم  --message)\n";
        exit;
    }
    $ok = $fail = 0;
    foreach ($todo as $n => $p) {
        $cfg = ['data_limit' => $p['limit'] + (int) round($gb * 1073741824)];
        if ($p['status'] === 'limited') {
            $cfg['status'] = 'active'; // volume ran out: the gift reconnects it
        }
        $res = $mp->Modifyuser($p['username'], $p['panel'], $cfg);
        if (!empty($res['status'])) {
            $ok++;
            $ledger['users'][$p['panel'] . '|' . $p['username']] = ['at' => time(), 'from' => $p['limit'], 'to' => $cfg['data_limit']];
        } else {
            $fail++;
            echo "  ❌ {$p['username']}: " . ($res['msg'] ?? 'خطا') . "\n";
        }
        if ($n % 20 === 19) {
            $saveLedger();
            echo "  … " . ($n + 1) . '/' . count($todo) . "\n";
        }
    }
    $saveLedger();
    echo "\n✅ حجم اضافه شد: $ok سرویس" . ($fail ? "   ❌ ناموفق: $fail (دوباره اجرا کنید؛ فقط همین‌ها تکرار می‌شوند)" : '') . "\n";
}

// ---------- 2. tell the customers ----------
if (isset($o['message']) || isset($o['message-only'])) {
    $names = array_map(fn($k) => explode('|', $k, 2)[1], array_keys($ledger['users']));
    if (!$names) {
        echo "کسی هدیه نگرفته که پیام بگیرد\n";
        exit;
    }
    $ids = [];
    $q = $pdo->prepare("SELECT DISTINCT id_user FROM invoice WHERE username = ?");
    foreach ($names as $u) {
        $q->execute([$u]);
        foreach ($q->fetchAll(PDO::FETCH_COLUMN) as $id) {
            if (ctype_digit((string) $id) && (int) $id > 0) {
                $ids[(string) $id] = true; // one message per customer, even with several services
            }
        }
    }
    $ids = array_keys(array_diff_key($ids, $ledger['messaged']));
    echo "ارسال پیام به " . count($ids) . " مشتری…\n";
    $sent = $failed = 0;
    foreach ($ids as $n => $id) {
        if ($send($id)) {
            $sent++;
            $ledger['messaged'][$id] = time();
        } else {
            $failed++;
        }
        usleep(60000); // ~16 messages a second, under Telegram's limit
        if ($n % 50 === 49) {
            $saveLedger();
            echo "  … " . ($n + 1) . '/' . count($ids) . "\n";
        }
    }
    $saveLedger();
    echo "✅ پیام فرستاده شد: $sent" . ($failed ? "   (نرسید: $failed — معمولاً ربات را بلاک کرده‌اند)" : '') . "\n";
}
