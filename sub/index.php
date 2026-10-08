<?php
ini_set('error_log', 'error_log');

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../panels/Api/Marzban.php';
require_once __DIR__ . '/../function.php';
require_once __DIR__ . '/../panels.php';
$ManagePanel = new ManagePanel();
header('Content-Type: text/plain; charset=utf-8');
$url = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH);
$parts = explode("/sub/", (string) $url);
$token = trim($parts[1] ?? '');
if ($token === '' || !preg_match('/^[a-f0-9]{4,64}$/i', $token)) {
    echo "ERROR!";
    exit;
}
try {
    $nameloc = select("invoice", "*", "id_invoice", $token, "select");
    if (!is_array($nameloc)) {
        echo "ERROR!";
        exit;
    }
    // Marzban-family panels: relay the panel's OWN subscription (same app format, every host/location, real headers).
    $panelRow = select("marzban_panel", "*", "name_panel", $nameloc['Service_location'], "select");
    if (is_array($panelRow) && in_array($panelRow['type'], ['marzban', 'marzneshin'], true)) {
        $raw = getuser($nameloc['username'], $panelRow['name_panel']);
        $ud = is_array($raw) ? json_decode($raw['body'] ?? '', true) : null;
        if (is_array($ud) && !empty($ud['subscription_url'])) {
            $nativeUrl = panelNativeSubUrl($panelRow, absoluteSubscriptionUrl($ud['subscription_url'], $panelRow['url_panel']));
            $relay = fetchNativeSubscription($nativeUrl, (string) ($_SERVER['HTTP_USER_AGENT'] ?? ''));
            if ($relay !== null) {
                foreach ($relay['headers'] as $hk => $hv) {
                    header($hk . ': ' . $hv, true);
                }
                if (!isset($relay['headers']['content-type'])) {
                    header('Content-Type: text/plain; charset=utf-8');
                }
                echo $relay['body'];
                exit;
            }
        }
    }
    $DataUserOut = $ManagePanel->DataUser($nameloc['Service_location'], $nameloc['username']);
    $config = "";
    if (is_array($DataUserOut)) {
        $titleFile = __DIR__ . '/../storage/sub_title.txt';
        foreach (subscriptionHeaders($DataUserOut, $nameloc, is_file($titleFile) ? (string) @file_get_contents($titleFile) : null) as $headerLine) {
            header($headerLine);
        }
    }
    if (is_array($DataUserOut) && isset($DataUserOut['links']) && is_array($DataUserOut['links'])) {
        foreach ($DataUserOut['links'] as $Links) {
            $config .= $Links . "\r\r";
        }
    }
    echo $config;
} catch (Throwable $e) {
    error_log('sub endpoint error: ' . $e->getMessage());
    echo "Error!";
}
