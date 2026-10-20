<?php
// Server status post: real ping + download speed through every location, posted to the report group (own topic)
// or a channel, updated automatically.
//
//   php scripts/server_status.php install-xray                 # once: downloads Xray into storage/bin
//   php scripts/server_status.php setup --panel="اینترنت معمولی (شرایط عادی)" --user=monitor_user
//          [--channel=reports|@channel] [--topic="وضعیت سرور ها"] [--every=180] [--mode=edit|new] [--seconds=5]
//   php scripts/server_status.php test                         # run the test, print the result, send nothing
//   php scripts/server_status.php post                         # run the test and post it now
//   php scripts/server_status.php on | off                     # automatic posting every --every minutes
//   php scripts/server_status.php name "config name" "نام نمایشی"   |   hide "config name"   |   unhide "config name"
//   php scripts/server_status.php show                         # current settings
//   php scripts/server_status.php auto                         # what cron runs (posts only when due)
//   php scripts/server_status.php agent-setup [--label="🇮🇷 ایران"]   # test from a server inside Iran instead (prints its install commands)
//   php scripts/server_status.php local                         # back to testing from this server

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
require_once $root . '/premium_emoji.php';
require_once $root . '/server_status.php';

$cmd = $argv[1] ?? 'help';
$opt = []; // --key=value anywhere on the line (getopt stops at the first plain word)
foreach (array_slice($argv, 2) as $a) {
    if (preg_match('/^--([a-z]+)=(.*)$/s', $a, $m)) {
        $opt[$m[1]] = $m[2];
    }
}
$cfg = ssConfig();

function out($s)
{
    echo $s . "\n";
}

function ssRunAndBuild(array $cfg, bool $verbose): array
{
    $items = ssItems($cfg);
    if (!$items) {
        throw new RuntimeException('سرویس مانیتور هیچ کانفیگی ندارد');
    }
    $verbose && out('تست ' . count($items) . ' لوکیشن…');
    $results = ssRun($items, $cfg, $verbose ? function ($n) { echo "  • $n\n"; } : null);
    return [$results, ssMessage($results, $cfg)];
}

try {
    switch ($cmd) {
        case 'install-xray':
            $dir = $root . '/storage/bin';
            @mkdir($dir, 0755, true);
            $arch = php_uname('m');
            $file = in_array($arch, ['aarch64', 'arm64'], true) ? 'Xray-linux-arm64-v8a.zip' : 'Xray-linux-64.zip';
            $zip = "$dir/xray.zip";
            $ch = curl_init("https://github.com/XTLS/Xray-core/releases/latest/download/$file");
            $fh = fopen($zip, 'w');
            curl_setopt_array($ch, [CURLOPT_FILE => $fh, CURLOPT_FOLLOWLOCATION => true, CURLOPT_TIMEOUT => 300]);
            $ok = curl_exec($ch) && curl_getinfo($ch, CURLINFO_HTTP_CODE) === 200;
            curl_close($ch);
            fclose($fh);
            if (!$ok) {
                throw new RuntimeException('دانلود Xray نشد');
            }
            $z = new ZipArchive();
            if ($z->open($zip) !== true || !$z->extractTo($dir, ['xray'])) {
                throw new RuntimeException('فایل Xray باز نشد');
            }
            $z->close();
            @unlink($zip);
            chmod("$dir/xray", 0755);
            out('✅ ' . trim((string) shell_exec(escapeshellarg("$dir/xray") . ' version | head -1')));
            break;

        case 'setup':
            foreach (['panel' => 'panel', 'user' => 'username', 'channel' => 'channel', 'topic' => 'topic', 'mode' => 'mode', 'title' => 'title'] as $o => $k) {
                if (isset($opt[$o])) {
                    $cfg[$k] = (string) $opt[$o];
                }
            }
            foreach (['every' => 'every_minutes', 'seconds' => 'seconds'] as $o => $k) {
                if (isset($opt[$o])) {
                    $cfg[$k] = max(1, (int) $opt[$o]);
                }
            }
            $cfg['every_minutes'] = max(15, (int) $cfg['every_minutes']);
            ssSaveConfig($cfg);
            out('✅ ذخیره شد');
            // fall through to show
        case 'show':
            out(json_encode(ssConfig(), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
            out('xray: ' . (ssXrayPath($cfg) ?: 'نصب نیست → php scripts/server_status.php install-xray'));
            break;

        case 'test':
            [$results, $html] = ssRunAndBuild($cfg, true);
            out('');
            foreach ($results as $r) {
                out(sprintf('%-40s %s', $r['name'], empty($r['ok']) ? '❌ ' . ($r['error'] ?? 'قطع') : "ping {$r['ping']}ms  speed " . ($r['speed'] ?? '—') . ' Mbps'));
            }
            out("\n--- پیش‌نمایش پیام ---\n" . strip_tags($html));
            break;

        case 'post':
        case 'auto':
            if ($cmd === 'auto' && $cfg['source'] === 'agent') {
                exit(0); // the server inside Iran runs the test on its own schedule
            }
            if ($cmd === 'auto') {
                $state = ssState();
                if (empty($cfg['enabled']) || time() - (int) ($state['last_run'] ?? 0) < $cfg['every_minutes'] * 60 - 60) {
                    exit(0);
                }
            }
            $lock = fopen(SS_LOCK, 'c');
            if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) {
                out('یک تست دیگر در حال اجراست');
                exit(0);
            }
            ssSaveState(['last_run' => time()] + ssState());
            [$results, $html] = ssRunAndBuild($cfg, $cmd === 'post');
            $id = ssPost($html, $cfg);
            ssSaveState(['last_results' => $results, 'last_ok' => time()] + ssState());
            out("✅ ارسال شد (پیام $id)");
            break;

        case 'agent-setup':
            if ($cfg['agent_key'] === '') {
                $cfg['agent_key'] = bin2hex(random_bytes(16));
            }
            $cfg['source'] = 'agent';
            if (isset($opt['label'])) {
                $cfg['agent_label'] = (string) $opt['label'];
            }
            ssSaveConfig($cfg);
            if (!ssXrayPath($cfg)) {
                out('⚠️ اول روی همین سرور  php scripts/server_status.php install-xray  را بزنید (سرور ایران Xray را از اینجا می‌گیرد)');
            }
            $u = 'https://' . $domainhosts . '/status_agent.php?a=script&key=' . $cfg['agent_key'];
            out("✅ حالت تست از ایران روشن شد. روی سرور ایران این سه خط را بزنید:\n");
            out("mkdir -p /opt/picha-agent && curl -fsS '$u' -o /opt/picha-agent/run.sh && bash /opt/picha-agent/run.sh");
            out("(crontab -l 2>/dev/null | grep -v picha-agent; echo '7 */" . max(1, (int) round($cfg['every_minutes'] / 60)) . " * * * bash /opt/picha-agent/run.sh >/dev/null 2>&1') | crontab -");
            out("\nخط اول یک بار تست می‌کند و پست را می‌فرستد؛ خط دوم آن را خودکار می‌کند.");
            break;

        case 'local':
            $cfg['source'] = 'local';
            ssSaveConfig($cfg);
            out('✅ تست دوباره از همین سرور انجام می‌شود');
            break;

        case 'on':
        case 'off':
            $cfg['enabled'] = $cmd === 'on';
            ssSaveConfig($cfg);
            out($cmd === 'on' ? "✅ ارسال خودکار روشن شد (هر {$cfg['every_minutes']} دقیقه)" : '⏸ ارسال خودکار خاموش شد');
            break;

        case 'name':
            $names = (array) $cfg['names'];
            if (($argv[3] ?? '') === '') {
                unset($names[$argv[2] ?? '']);
            } else {
                $names[$argv[2]] = $argv[3];
            }
            $cfg['names'] = (object) $names;
            ssSaveConfig($cfg);
            out('✅');
            break;

        case 'hide':
        case 'unhide':
            $hide = array_values(array_diff((array) $cfg['hide'], [$argv[2] ?? '']));
            if ($cmd === 'hide') {
                $hide[] = (string) ($argv[2] ?? '');
            }
            $cfg['hide'] = $hide;
            ssSaveConfig($cfg);
            out('✅');
            break;

        default:
            echo file_get_contents(__FILE__, false, null, 0, 1500);
    }
} catch (Throwable $e) {
    fwrite(STDERR, '❌ ' . $e->getMessage() . "\n");
    exit(1);
}
