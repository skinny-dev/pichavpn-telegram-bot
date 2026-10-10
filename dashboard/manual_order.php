<?php
// Manual orders from the web panel: customers who are not in Telegram (Instagram, phone, in person...).
// Creates the VPN account on the chosen panel and an invoice with id_user = 0 (or a real Telegram id when given).
// The finance module and statistics count it like any bot sale; cron reminders skip it (no Telegram user).

/** Loads the bot's panel layer lazily (only these routes need it). */
function picha_bot_layer(): void
{
    global $textbotlang, $from_id, $domainhosts, $pdo, $ManagePanel;
    if ($ManagePanel instanceof ManagePanel) {
        return;
    }
    $from_id = 0;
    require_once __DIR__ . '/../function.php';
    require_once __DIR__ . '/../panels.php';
    $textbotlang = languagechange();
    $ManagePanel = new ManagePanel();
}

function picha_order_options(PDO $pdo): array
{
    $panels = $pdo->query("SELECT name_panel, type, status FROM marzban_panel ORDER BY name_panel")->fetchAll(PDO::FETCH_ASSOC);
    $products = $pdo->query("SELECT id, name_product, code_product, price_product, Volume_constraint, Service_time, Location, category FROM product WHERE COALESCE(NULLIF(status_product,''),'active') = 'active' ORDER BY sort_order, id")->fetchAll(PDO::FETCH_ASSOC);
    return [
        'panels' => array_map(fn($p) => ['name' => (string) $p['name_panel'], 'type' => (string) $p['type'], 'active' => $p['status'] !== 'disabled'], $panels),
        'products' => array_map(fn($p) => [
            'id' => (int) $p['id'], 'name' => (string) $p['name_product'], 'price' => (int) $p['price_product'], 'volume' => (int) $p['Volume_constraint'],
            'days' => (int) $p['Service_time'], 'location' => (string) $p['Location'], 'category' => (string) $p['category'],
        ], $products),
    ];
}

/** Pure: a valid lowercase service name or ''. */
function picha_order_username($v): string
{
    $v = strtolower(trim((string) $v));
    return preg_match('/^[a-z0-9_]{3,32}$/', $v) ? $v : '';
}

/**
 * body: {panel, product_id, username?, customer?, contact?, tg_user_id?, price?, note?}
 * @return array{id:string,username:string,sub_link:string,sub_page:string,configs:array}
 */
function picha_order_create(PDO $pdo, array $b, string $adminName): array
{
    global $domainhosts, $ManagePanel;
    $panelName = trim((string) ($b['panel'] ?? ''));
    $panel = $pdo->prepare("SELECT * FROM marzban_panel WHERE name_panel = ?");
    $panel->execute([$panelName]);
    $panel = $panel->fetch(PDO::FETCH_ASSOC);
    if (!$panel) {
        throw new PichaError('پنل پیدا نشد', 404);
    }
    if ($panel['type'] === 'Manualsale') {
        throw new PichaError('برای پنل «فروش دستی» ساخت از اینجا پشتیبانی نمی‌شود', 422);
    }
    $pq = $pdo->prepare("SELECT * FROM product WHERE id = ?");
    $pq->execute([(int) ($b['product_id'] ?? 0)]);
    $product = $pq->fetch(PDO::FETCH_ASSOC);
    if (!$product) {
        throw new PichaError('محصول پیدا نشد', 404);
    }
    if (!in_array((string) $product['Location'], [$panelName, '/all'], true)) {
        throw new PichaError('این محصول برای این پنل نیست', 422);
    }
    $tg = trim((string) ($b['tg_user_id'] ?? ''));
    if ($tg !== '') {
        if (!preg_match('/^\d{1,15}$/', $tg)) {
            throw new PichaError('آیدی عددی تلگرام نامعتبر است (برای مشتری خارج از تلگرام خالی بگذارید)', 422);
        }
        $ex = $pdo->prepare("SELECT COUNT(*) FROM user WHERE id = ?");
        $ex->execute([$tg]);
        if (!(int) $ex->fetchColumn()) {
            throw new PichaError('این کاربر در ربات ثبت نشده است (باید یک‌بار ربات را استارت کرده باشد)؛ برای مشتری بدون تلگرام خالی بگذارید', 422);
        }
    }
    $username = trim((string) ($b['username'] ?? '')) === '' ? 'ext' . bin2hex(random_bytes(3)) : picha_order_username($b['username']);
    if ($username === '') {
        throw new PichaError('نام سرویس: فقط حروف انگلیسی کوچک، عدد و _ (۳ تا ۳۲ کاراکتر)', 422);
    }
    $price = referralMoneyInput($b['price'] ?? $product['price_product']);
    if (!array_key_exists('price', $b) || $b['price'] === '' || $b['price'] === null) {
        $price = (int) $product['price_product'];
    }
    $customer = mb_substr(trim((string) ($b['customer'] ?? '')), 0, 120);
    $contact = mb_substr(trim((string) ($b['contact'] ?? '')), 0, 120);
    $noteParts = array_filter(['مشتری: ' . $customer, $contact !== '' ? 'تماس: ' . $contact : '', trim((string) ($b['note'] ?? '')) !== '' ? trim((string) $b['note']) : '', 'ثبت دستی توسط ' . $adminName]);
    $note = mb_substr(implode(' | ', $customer === '' ? array_slice($noteParts, 1) : $noteParts), 0, 480);

    picha_bot_layer();
    $ManagePanel = $GLOBALS['ManagePanel'];
    $exists = $pdo->prepare("SELECT COUNT(*) FROM invoice WHERE username = ?");
    $exists->execute([$username]);
    $onPanel = $ManagePanel->DataUser($panelName, $username);
    if ((int) $exists->fetchColumn() > 0 || isset($onPanel['username'])) {
        throw new PichaError('این نام سرویس قبلاً وجود دارد؛ نام دیگری انتخاب کنید یا خالی بگذارید', 409);
    }
    $id = bin2hex(random_bytes(4));
    $now = time();
    $days = (int) $product['Service_time'];
    $volume = (int) $product['Volume_constraint'];
    $pdo->prepare("INSERT INTO invoice (id_user, id_invoice, username, time_sell, Service_location, name_product, price_product, Volume, Service_time, Status, note, notifctions) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
        ->execute([$tg === '' ? '0' : $tg, $id, $username, $now, $panelName, $product['name_product'], $price, $volume, $days, 'unpaid', $note, json_encode(['volume' => false, 'time' => false])]);
    $out = $ManagePanel->createUser($panelName, $product['code_product'], $username, [
        'expire' => $days === 0 ? 0 : strtotime("+{$days} days"),
        'data_limit' => $volume * pow(1024, 3),
        'from_id' => $tg === '' ? '0' : $tg,
        'username' => 'panel',
        'type' => 'buy',
    ]);
    if (!isset($out['username']) || $out['username'] === '' || $out['username'] === null) {
        $pdo->prepare("UPDATE invoice SET Status = 'Unsuccessful' WHERE id_invoice = ?")->execute([$id]);
        $msg = $out['msg'] ?? 'unknown error';
        throw new PichaError('ساخت سرویس روی پنل ناموفق بود: ' . (is_scalar($msg) ? $msg : json_encode($msg, JSON_UNESCAPED_UNICODE)), 502);
    }
    $pdo->prepare("UPDATE invoice SET Status = 'active' WHERE id_invoice = ?")->execute([$id]);
    $inv = ['id_invoice' => $id, 'username' => $username];
    $sub = panelSubscriptionLink($panel, (string) ($out['subscription_url'] ?? ''), $inv, $domainhosts);
    return ['id' => $id, 'username' => $username, 'sub_link' => $sub, 'sub_page' => "https://$domainhosts/sub/$id", 'configs' => array_values((array) ($out['configs'] ?? []))];
}
