<?php
/*
 * php scripts/sms_setup.php token      -> create/rotate the forwarder token (printed once)
 * php scripts/sms_setup.php on|off     -> enable/disable SMS auto-approval
 * php scripts/sms_setup.php status     -> show state + recent SMS
 */
chdir(__DIR__ . '/..');
require_once 'config.php';
$cmd = $argv[1] ?? 'status';
$set = fn(string $k, string $v) => $pdo->prepare("INSERT INTO PaySetting (NamePay,ValuePay) VALUES (?,?) ON DUPLICATE KEY UPDATE ValuePay = VALUES(ValuePay)")->execute([$k, $v]);
$get = function (string $k) use ($pdo) {
    $s = $pdo->prepare("SELECT ValuePay FROM PaySetting WHERE NamePay = ?");
    $s->execute([$k]);
    return $s->fetchColumn();
};
switch ($cmd) {
    case 'token':
        $t = bin2hex(random_bytes(24));
        $set('sms_webhook_token', $t);
        echo "New forwarder token (shown once, paste into the app's \"Admin token\"):\n$t\n";
        echo "Webhook URL: https://$domainhosts/payment/sms_webhook.php\n";
        break;
    case 'on':
        if ($get('sms_webhook_token') === '' || $get('sms_webhook_token') === false) {
            exit("Create a token first: php scripts/sms_setup.php token\n");
        }
        $set('smsautoconfirm', 'onsms');
        echo "SMS auto-approval ON\n";
        break;
    case 'off':
        $set('smsautoconfirm', 'offsms');
        echo "SMS auto-approval OFF\n";
        break;
    default:
        echo 'enabled: ' . ($get('smsautoconfirm') === 'onsms' ? 'yes' : 'no') . "\n";
        echo 'token set: ' . (strlen((string) $get('sms_webhook_token')) > 0 ? 'yes' : 'no') . "\n";
        foreach ($pdo->query("SELECT FROM_UNIXTIME(received_at) t,kind,amount_rial,status,id_order FROM sms_inbox ORDER BY id DESC LIMIT 15") as $r) {
            echo "$r[t]  $r[kind]  $r[amount_rial]  $r[status]  $r[id_order]\n";
        }
}
