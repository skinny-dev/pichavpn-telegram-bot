<?php
// Variza through Iran: when variza.ir does not answer foreign servers, the bot's Variza requests go out through the
// server inside Iran over an SSH tunnel (a local SOCKS port on this server, kept up by systemd).
//
//   php scripts/variza_proxy.php test                 # can this server reach Variza directly / through the tunnel?
//   php scripts/variza_proxy.php tunnel IRAN_IP       # one time: SSH key + tunnel service to the Iranian server
//   php scripts/variza_proxy.php on                   # Variza requests use the tunnel
//   php scripts/variza_proxy.php off                  # back to direct
//
// Only Variza's «create payment link» call uses the tunnel. Variza's callback to the bot is unchanged.

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
$root = dirname(__DIR__);
chdir($root);
require $root . '/config.php';
require_once $root . '/botapi.php';
require_once $root . '/function.php';

const VP_PORT = 1080;
const VP_PROXY = 'socks5h://127.0.0.1:1080';
const VP_KEY = '/root/.ssh/picha_iran_tunnel';
const VP_UNIT = '/etc/systemd/system/picha-iran-tunnel.service';

function vpSet(PDO $pdo, string $value): void
{
    $st = $pdo->prepare("SELECT COUNT(*) FROM PaySetting WHERE NamePay = 'variza_proxy'");
    $st->execute();
    if ((int) $st->fetchColumn() > 0) {
        $pdo->prepare("UPDATE PaySetting SET ValuePay = ? WHERE NamePay = 'variza_proxy'")->execute([$value]);
    } else {
        $pdo->prepare("INSERT INTO PaySetting (NamePay, ValuePay) VALUES ('variza_proxy', ?)")->execute([$value]);
    }
    clearSelectCache('PaySetting');
}

function vpProbe(?string $proxy): string
{
    $ch = curl_init('https://variza.ir/');
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_NOBODY => true, CURLOPT_TIMEOUT => 15, CURLOPT_CONNECTTIMEOUT => 10]);
    if ($proxy) {
        curl_setopt($ch, CURLOPT_PROXY, $proxy);
        curl_setopt($ch, CURLOPT_NOPROXY, '');
    }
    curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    $t = round(curl_getinfo($ch, CURLINFO_TOTAL_TIME), 2);
    curl_close($ch);
    return $code > 0 ? "✅ HTTP $code ({$t}s)" : "❌ $err";
}

$cmd = $argv[1] ?? 'help';
switch ($cmd) {
    case 'test':
        echo "مستقیم از این سرور:      " . vpProbe(null) . "\n";
        $open = @fsockopen('127.0.0.1', VP_PORT, $e1, $e2, 2);
        if ($open) {
            fclose($open);
            echo "از طریق تونل ایران:      " . vpProbe(VP_PROXY) . "\n";
        } else {
            echo "از طریق تونل ایران:      (تونل راه‌اندازی نشده یا قطع است)\n";
        }
        $cur = trim((string) getPaySettingValue('variza_proxy', ''));
        echo "حالت فعلی ربات:          " . ($cur !== '' && $cur !== '0' ? "از طریق تونل ($cur)" : 'مستقیم') . "\n";
        $r = createPayVariza(10000, 'test' . time());
        echo "ساخت لینک آزمایشی:       " . (!empty($r['pay_url']) ? '✅ لینک ساخته شد' : '❌ ' . ($r['error'] ?? 'نامشخص') . (isset($r['http_code']) ? " (HTTP {$r['http_code']})" : '')) . "\n";
        break;

    case 'tunnel':
        $ip = (string) ($argv[2] ?? '');
        if (!filter_var($ip, FILTER_VALIDATE_IP)) {
            fwrite(STDERR, "usage: php scripts/variza_proxy.php tunnel IRAN_IP\n");
            exit(1);
        }
        if (!is_file(VP_KEY)) {
            passthru('ssh-keygen -q -t ed25519 -N "" -C picha-iran-tunnel -f ' . escapeshellarg(VP_KEY));
        }
        echo "🔑 کلید را روی سرور ایران نصب می‌کنم؛ یک بار رمز root سرور ایران را بپرسد:\n";
        passthru('ssh-copy-id -i ' . escapeshellarg(VP_KEY . '.pub') . ' -o StrictHostKeyChecking=accept-new root@' . escapeshellarg($ip), $rc);
        if ($rc !== 0) {
            fwrite(STDERR, "❌ نصب کلید نشد\n");
            exit(1);
        }
        file_put_contents(VP_UNIT, "[Unit]\nDescription=Picha SOCKS tunnel through the Iranian server (Variza)\nAfter=network-online.target\nWants=network-online.target\n\n"
            . "[Service]\nExecStart=/usr/bin/ssh -N -D 127.0.0.1:" . VP_PORT . " -i " . VP_KEY . " -o BatchMode=yes -o ServerAliveInterval=20 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -o StrictHostKeyChecking=accept-new root@$ip\n"
            . "Restart=always\nRestartSec=5\n\n[Install]\nWantedBy=multi-user.target\n");
        passthru('systemctl daemon-reload && systemctl enable --now picha-iran-tunnel && sleep 3 && systemctl is-active picha-iran-tunnel');
        echo "\nتست:\n";
        echo "از طریق تونل ایران: " . vpProbe(VP_PROXY) . "\n";
        echo "اگر ✅ بود:  php scripts/variza_proxy.php on\n";
        break;

    case 'on':
        vpSet($pdo, VP_PROXY);
        echo "✅ درخواست‌های واریزا از طریق تونل ایران می‌رود\n";
        break;

    case 'off':
        vpSet($pdo, '');
        echo "✅ درخواست‌های واریزا دوباره مستقیم است\n";
        break;

    default:
        echo file_get_contents(__FILE__, false, null, 0, 900);
}
