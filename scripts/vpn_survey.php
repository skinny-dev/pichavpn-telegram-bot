<?php
// «۱۰٪ کاربرها وصل نمی‌شوند»: what do the active users who can't connect have in common?
//
//   php scripts/vpn_survey.php                 # every active user of every PasarGuard/Marzban panel
//   php scripts/vpn_survey.php --hours 48      # «connected» = online in the last 48 h (default 24)
//   php scripts/vpn_survey.php --list 50       # print up to 50 non-connecting users at the end (default 25)
//
// Active users are split in two: OK = online in the last N hours, BAD = active for over a day but not online in N hours
// (or never). For each feature — the app that last fetched the subscription, how long ago the subscription was
// fetched, group / inbounds, VLESS flow, creation month, traffic used — the share among BAD vs OK is shown, biggest
// difference first. A feature far more common in BAD is the cause to look at. Reads only, changes nothing.

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
$root = dirname(__DIR__);
chdir($root);
require $root . '/config.php';
require_once $root . '/function.php';
require_once $root . '/panels.php';

$o = getopt('', ['hours:', 'list:']);
$hours = max(1, (int) ($o['hours'] ?? 24));
$listN = max(0, (int) ($o['list'] ?? 25));

function vs_get(array $panel, string $token, string $path)
{
    $ch = curl_init(rtrim($panel['url_panel'], '/') . $path);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60, CURLOPT_SSL_VERIFYPEER => false, CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER => ['Accept: application/json', 'Authorization: Bearer ' . $token]]);
    $out = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return $code === 200 ? json_decode((string) $out, true) : null;
}

/** Last subscription fetch (time, app) per username, 20 requests at a time: the user list doesn't carry it. */
function vs_sub_updates(array $panel, string $token, array $names): array
{
    $out = [];
    foreach (array_chunk($names, 20) as $chunk) {
        $mh = curl_multi_init();
        $hs = [];
        foreach ($chunk as $n) {
            $ch = curl_init(rtrim($panel['url_panel'], '/') . '/api/user/' . rawurlencode($n) . '/sub_update?offset=0&limit=1');
            curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20, CURLOPT_SSL_VERIFYPEER => false, CURLOPT_SSL_VERIFYHOST => false,
                CURLOPT_HTTPHEADER => ['Accept: application/json', 'Authorization: Bearer ' . $token]]);
            curl_multi_add_handle($mh, $ch);
            $hs[$n] = $ch;
        }
        do {
            $st = curl_multi_exec($mh, $running);
            $running && curl_multi_select($mh, 1);
        } while ($running && $st === CURLM_OK);
        foreach ($hs as $n => $ch) {
            $j = json_decode((string) curl_multi_getcontent($ch), true);
            $u = $j['updates'][0] ?? null;
            $out[$n] = $u ? [$u['created_at'] ?? null, $u['user_agent'] ?? null] : [null, null];
            curl_multi_remove_handle($mh, $ch);
            curl_close($ch);
        }
        curl_multi_close($mh);
    }
    return $out;
}

function vs_time($v): ?int
{
    if ($v === null || $v === '') {
        return null;
    }
    if (is_numeric($v)) {
        return (int) $v;
    }
    $s = (string) $v;
    $t = strtotime(preg_match('/(Z|[+-]\d\d:?\d\d)$/', $s) ? $s : $s . 'Z'); // panel times are UTC
    return $t ?: null;
}

function vs_app(?string $ua): string
{
    if (!$ua) {
        return '(هیچ‌وقت ساب نگرفته)';
    }
    foreach (['Happ' => 'Happ', 'v2rayNG' => 'v2rayNG', 'v2rayN' => 'v2rayN', 'Streisand' => 'Streisand', 'Hiddify' => 'Hiddify', 'NekoBox' => 'NekoBox', 'Nekoray' => 'Nekoray',
        'V2Box' => 'V2Box', 'v2box' => 'V2Box', 'FoXray' => 'FoXray', 'Shadowrocket' => 'Shadowrocket', 'sing-box' => 'sing-box', 'SFA' => 'sing-box', 'SFI' => 'sing-box',
        'clash' => 'Clash', 'Clash' => 'Clash', 'mihomo' => 'Clash', 'Karing' => 'Karing', 'Npv' => 'NapsternetV', 'NapsternetV' => 'NapsternetV', 'Mozilla' => 'مرورگر', 'TelegramBot' => 'ربات', 'curl' => 'curl', 'Go-http' => 'Go'] as $k => $name) {
        if (stripos($ua, $k) !== false) {
            preg_match('#' . preg_quote($k, '#') . '[/ ]v?([\d.]+)#i', $ua, $m);
            return $name . (isset($m[1]) ? ' ' . preg_replace('/^(\d+\.\d+).*/', '$1', $m[1]) : '');
        }
    }
    return 'دیگر: ' . mb_substr($ua, 0, 25);
}

function vs_age(?int $t): string
{
    if (!$t) {
        return 'هرگز';
    }
    $d = (time() - $t) / 86400;
    return $d < 1 ? 'کمتر از ۱ روز' : ($d < 3 ? '۱ تا ۳ روز' : ($d < 7 ? '۳ تا ۷ روز' : ($d < 30 ? '۷ تا ۳۰ روز' : 'بیش از ۳۰ روز')));
}

$panels = $pdo->query("SELECT * FROM marzban_panel WHERE type = 'marzban' AND status != 'disable'")->fetchAll(PDO::FETCH_ASSOC); // PasarGuard uses the marzban driver
foreach ($panels as $panel) {
    echo "\n━━━━━━━━ پنل: {$panel['name_panel']}\n";
    $tok = token_panel($panel['code_panel'], false);
    if (empty($tok['access_token'])) {
        echo "❌ ورود به پنل ناموفق: " . ($tok['error'] ?? ($tok['detail'] ?? 'بدون پاسخ')) . "\n";
        continue;
    }
    $token = $tok['access_token'];
    $groups = [];
    foreach ((vs_get($panel, $token, '/api/groups')['groups'] ?? []) as $g) {
        $groups[$g['id']] = $g['name'] . (isset($g['inbound_tags']) ? ' [' . implode(',', $g['inbound_tags']) . ']' : '');
    }
    $users = [];
    for ($off = 0; ; $off += 200) {
        $r = vs_get($panel, $token, "/api/users?status=active&offset=$off&limit=200");
        $batch = $r['users'] ?? (is_array($r) && array_is_list($r) ? $r : []);
        $users = array_merge($users, $batch);
        if (count($batch) < 200 || $off > 50000) {
            break;
        }
    }
    if (!$users) {
        echo "کاربر فعالی برنگشت\n";
        continue;
    }
    if (!array_filter(array_column($users, 'sub_last_user_agent'))) {
        echo "در حال خواندن آخرین دریافت ساب " . count($users) . " کاربر...\n";
        $subs = vs_sub_updates($panel, $token, array_column($users, 'username'));
        foreach ($users as &$uu) {
            [$uu['sub_updated_at'], $uu['sub_last_user_agent']] = $subs[$uu['username']] ?? [null, null];
        }
        unset($uu);
    }
    $now = time();
    $rows = ['OK' => [], 'BAD' => []];
    $badList = [];
    $young = 0;
    foreach ($users as $u) {
        $created = vs_time($u['created_at'] ?? null);
        if ($created && $now - $created < 86400) {
            $young++;
            continue; // too new to judge
        }
        $online = vs_time($u['online_at'] ?? null);
        $subAt = vs_time($u['sub_updated_at'] ?? null);
        $cls = $online && $now - $online <= $hours * 3600 ? 'OK' : 'BAD';
        $ps = $u['proxy_settings'] ?? ($u['proxies'] ?? []);
        $f = [
            'اپ (آخرین دریافت ساب)' => vs_app($u['sub_last_user_agent'] ?? null),
            'آخرین دریافت ساب' => vs_age($subAt),
            'گروه' => isset($u['group_ids']) ? (implode(' + ', array_map(fn($id) => $groups[$id] ?? "#$id", (array) $u['group_ids'])) ?: '(بدون گروه)') : '-',
            'پروتکل‌ها' => implode('+', array_keys(array_filter((array) $ps))) ?: '-',
            'VLESS flow' => ($ps['vless']['flow'] ?? '') ?: '(خالی)',
            'ماه ساخت' => $created ? date('Y-m', $created) : '?',
            'مصرف دوره فعلی (بعد از خرید/تمدید)' => ((float) ($u['used_traffic'] ?? 0)) <= 0 ? (((float) ($u['lifetime_used_traffic'] ?? 0)) > 0 ? 'صفر — قبلاً مصرف داشته (بعد از تمدید وصل نشده)' : 'صفر') : 'مصرف دارد',
            'آخرین اتصال' => vs_age($online),
            'مصرف کل' => ((float) ($u['lifetime_used_traffic'] ?? $u['used_traffic'] ?? 0)) <= 0 ? 'هرگز مصرف نکرده' : 'مصرف داشته',
            'محدودیت حجم' => empty($u['data_limit']) ? 'نامحدود' : 'حجمی',
            'ریست حجم' => (string) ($u['data_limit_reset_strategy'] ?? '-'),
        ];
        $rows[$cls][] = $f;
        if ($cls === 'BAD') {
            $badList[] = [$u['username'], $online ? date('Y-m-d H:i', $online) : 'هرگز', $subAt ? date('Y-m-d H:i', $subAt) : 'هرگز', $f['اپ (آخرین دریافت ساب)'], $f['گروه']];
        }
    }
    $nOk = count($rows['OK']);
    $nBad = count($rows['BAD']);
    $tot = max(1, $nOk + $nBad);
    echo "کاربران فعال: " . count($users) . " | وصل در $hours ساعت اخیر: $nOk | وصل نشده: $nBad (" . round($nBad * 100 / $tot) . "٪) | تازه‌ساخت (کمتر از ۱ روز، حساب نشد): $young\n";
    if (!$nBad || !$nOk) {
        continue;
    }
    foreach (array_keys($rows['OK'][0]) as $feat) {
        $cnt = ['OK' => [], 'BAD' => []];
        foreach (['OK', 'BAD'] as $k) {
            foreach ($rows[$k] as $f) {
                $cnt[$k][$f[$feat]] = ($cnt[$k][$f[$feat]] ?? 0) + 1;
            }
        }
        $vals = array_unique(array_merge(array_keys($cnt['OK']), array_keys($cnt['BAD'])));
        $lines = [];
        foreach ($vals as $v) {
            $b = ($cnt['BAD'][$v] ?? 0);
            $g = ($cnt['OK'][$v] ?? 0);
            $failRate = $b / max(1, $b + $g);
            $lines[] = [$v, $b, $g, $failRate];
        }
        usort($lines, fn($x, $y) => $y[3] <=> $x[3] ?: $y[1] <=> $x[1]);
        echo "\n▪︎ $feat   (درصد وصل‌نشده در هر مقدار — میانگین کل " . round($nBad * 100 / $tot) . "٪)\n";
        foreach (array_slice($lines, 0, 12) as [$v, $b, $g, $fr]) {
            $flag = $fr >= 2 * $nBad / $tot && $b >= 5 ? '  ⬅️' : '';
            printf("   %3d٪ وصل‌نشده | %5d بد / %5d سالم | %s%s\n", round($fr * 100), $b, $g, $v, $flag);
        }
    }
    if ($listN) {
        echo "\nنمونه کاربران وصل‌نشده (نام | آخرین اتصال | آخرین ساب | اپ | گروه):\n";
        usort($badList, fn($a, $b) => strcmp($b[2], $a[2]));
        foreach (array_slice($badList, 0, $listN) as $r) {
            echo "   " . implode(' | ', $r) . "\n";
        }
        echo "یکی را با  php scripts/vpn_check.php NAME  بررسی کنید\n";
    }
}
echo "\n⬅️ = مقداری که درصد وصل‌نشده‌اش دست‌کم ۲ برابر میانگین است: علت احتمالی همین‌جاست\n";
