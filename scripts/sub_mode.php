<?php
/*
 * Which subscription link new/refreshed customer messages carry for Marzban-family panels (Marzban, PasarGuard, Marzneshin).
 *   php scripts/sub_mode.php                       # show every panel: mode, admin URL, subscription domain
 *   php scripts/sub_mode.php native [PANEL_NAME]   # use the panel's own link (e.g. https://dmc.example.com/sub/TOKEN)  [all panels if no name]
 *   php scripts/sub_mode.php bot [PANEL_NAME]      # use https://<bot domain>/sub/<invoice id> (original behaviour)
 *   php scripts/sub_mode.php domain PANEL_NAME https://dmc.example.com   # force the subscription domain of a panel
 * Old links keep working: the bot's /sub/<id> address stays online and returns the same configs.
 */
if (PHP_SAPI !== 'cli') {
    exit;
}
chdir(__DIR__ . '/..');
require_once 'config.php';
$cmd = $argv[1] ?? 'status';
$name = $argv[2] ?? null;
$panels = $pdo->query("SELECT code_panel, name_panel, type, url_panel, linksubx, COALESCE(NULLIF(subproxy,''),'onsubproxy') subproxy FROM marzban_panel ORDER BY code_panel")->fetchAll(PDO::FETCH_ASSOC);
if (in_array($cmd, ['native', 'bot'], true)) {
    $st = $pdo->prepare("UPDATE marzban_panel SET subproxy = ? WHERE type IN ('marzban','marzneshin')" . ($name ? " AND name_panel = ?" : ''));
    $st->execute(array_filter([$cmd === 'native' ? 'offsubproxy' : 'onsubproxy', $name], fn($v) => $v !== null));
    echo "updated {$st->rowCount()} panel(s) → " . ($cmd === 'native' ? "the panel's own link" : 'the bot domain link') . "\n\n";
} elseif ($cmd === 'domain') {
    $url = rtrim((string) ($argv[3] ?? ''), '/');
    if (!$name || !preg_match('#^https?://[^/\s]+$#', $url)) {
        fwrite(STDERR, "usage: php scripts/sub_mode.php domain PANEL_NAME https://sub.example.com\n");
        exit(1);
    }
    $st = $pdo->prepare("UPDATE marzban_panel SET linksubx = ? WHERE name_panel = ?");
    $st->execute([$url, $name]);
    echo "subscription domain of «{$name}» = $url (" . $st->rowCount() . " row)\n\n";
}
foreach ($pdo->query("SELECT name_panel, type, url_panel, linksubx, COALESCE(NULLIF(subproxy,''),'onsubproxy') subproxy FROM marzban_panel ORDER BY code_panel")->fetchAll(PDO::FETCH_ASSOC) as $p) {
    $fam = in_array($p['type'], ['marzban', 'marzneshin'], true);
    printf("%-22s %-10s mode: %-22s admin: %s  sub-domain: %s\n", $p['name_panel'], $p['type'], $fam ? ($p['subproxy'] === 'offsubproxy' ? "panel's own link" : 'bot domain link') : '(n/a for this type)', $p['url_panel'], $p['linksubx'] ?: '—');
}
