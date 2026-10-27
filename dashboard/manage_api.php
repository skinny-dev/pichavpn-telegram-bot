<?php
// Managing one order or one customer from the panel / Mini App (the same things the bot's admin menu does).
//
//   GET  mg_order?id=INVOICE              order + customer + live state on the panel + products it can be renewed with
//   POST mg_order_action {id, action, …}  renew | add_volume | add_time | toggle | reset_usage | revoke_sub | delete | purge | edit | message
//   GET  mg_user?id=TELEGRAM_ID            customer + orders + wallet history
//   POST mg_user_action {id, action, …}   wallet | block | unblock | message | edit
//
// Every change goes to storage/panel_actions.jsonl (who, when, what, before/after).

function mg_log(string $admin, string $what, array $data): void
{
    @file_put_contents(dirname(__DIR__) . '/storage/panel_actions.jsonl', json_encode(['at' => date('c'), 'admin' => $admin, 'what' => $what] + $data, JSON_UNESCAPED_UNICODE) . "\n", FILE_APPEND | LOCK_EX);
}

function mg_invoice(PDO $pdo, string $id): array
{
    $st = $pdo->prepare("SELECT * FROM invoice WHERE id_invoice = ?");
    $st->execute([$id]);
    $inv = $st->fetch(PDO::FETCH_ASSOC);
    if (!$inv) {
        throw new PichaError('سفارش پیدا نشد', 404);
    }
    return $inv;
}

function mg_panel(PDO $pdo, string $name): ?array
{
    $st = $pdo->prepare("SELECT * FROM marzban_panel WHERE name_panel = ?");
    $st->execute([$name]);
    return $st->fetch(PDO::FETCH_ASSOC) ?: null;
}

/** Live state of a service on its panel (never throws). */
function mg_live(array $inv): array
{
    global $ManagePanel;
    try {
        $d = $ManagePanel->DataUser($inv['Service_location'], $inv['username']);
    } catch (Throwable $e) {
        return ['ok' => false, 'error' => $e->getMessage()];
    }
    if (!is_array($d) || ($d['status'] ?? '') === 'Unsuccessful') {
        return ['ok' => false, 'error' => (string) ($d['msg'] ?? 'پنل جواب نداد'), 'not_found' => ($d['msg'] ?? '') === 'User not found'];
    }
    $configs = $d['links'] ?? $d['configs'] ?? [];
    return [
        'ok' => true, 'status' => (string) ($d['status'] ?? ''), 'data_limit' => (int) ($d['data_limit'] ?? 0), 'used' => (int) ($d['used_traffic'] ?? 0),
        'expire' => (int) ($d['expire'] ?? 0), 'online_at' => $d['online_at'] ?? null, 'sub' => (string) ($d['subscription_url'] ?? ''),
        'configs' => array_values(array_filter(is_array($configs) ? array_map('strval', $configs) : explode("\n", (string) $configs))),
    ];
}

function mg_user_row(PDO $pdo, string $id): ?array
{
    $st = $pdo->prepare("SELECT id, username, namecustom, number, Balance, agent, User_Status, register, pricediscount, affiliatescount, affiliates, score FROM user WHERE id = ?");
    $st->execute([$id]);
    return $st->fetch(PDO::FETCH_ASSOC) ?: null;
}

function mg_notify(string $chat, string $text): bool
{
    if (!ctype_digit($chat) || $chat === '0') {
        return false;
    }
    $r = telegram('sendMessage', ['chat_id' => $chat, 'text' => $text, 'parse_mode' => 'HTML']);
    return !empty($r['ok']);
}

function mg_ok($r): bool
{
    return is_array($r) && ($r['status'] ?? null) !== false && ($r['status'] ?? '') !== 'Unsuccessful';
}

function mg_err($r): string
{
    $m = is_array($r) ? ($r['msg'] ?? $r['error'] ?? 'خطای پنل') : 'خطای پنل';
    return is_string($m) ? $m : json_encode($m, JSON_UNESCAPED_UNICODE);
}

function picha_manage_route(string $route, PDO $pdo, string $admin): void
{
    global $domainhosts, $ManagePanel;
    picha_bot_layer();

    switch ($route) {
        case 'mg_order':
            $inv = mg_invoice($pdo, (string) ($_GET['id'] ?? ''));
            $panel = mg_panel($pdo, (string) $inv['Service_location']);
            $user = $inv['id_user'] !== '0' ? mg_user_row($pdo, (string) $inv['id_user']) : null;
            $agent = $user['agent'] ?? 'f';
            $products = [];
            if ($panel) {
                $st = $pdo->prepare("SELECT id, name_product, price_product, Volume_constraint, Service_time, category FROM product
                    WHERE (Location = ? OR Location = '/all') AND agent = ? AND COALESCE(NULLIF(status_product,''),'active') = 'active' ORDER BY CAST(sort_order AS SIGNED), id");
                $st->execute([$panel['name_panel'], $agent]);
                $products = array_map(fn($p) => ['id' => (int) $p['id'], 'name' => $p['name_product'], 'price' => (int) $p['price_product'], 'gb' => (float) $p['Volume_constraint'],
                    'days' => (int) $p['Service_time'], 'category' => $p['category']], $st->fetchAll(PDO::FETCH_ASSOC));
            }
            $hist = $pdo->prepare("SELECT type, value, time, price FROM service_other WHERE username = ? ORDER BY time DESC LIMIT 20");
            $hist->execute([$inv['username']]);
            out(['ok' => true,
                'order' => ['id' => $inv['id_invoice'], 'user_id' => (string) $inv['id_user'], 'username' => $inv['username'], 'product' => $inv['name_product'],
                    'price' => (int) $inv['price_product'], 'gb' => (float) $inv['Volume'], 'days' => (int) $inv['Service_time'], 'location' => $inv['Service_location'],
                    'status' => $inv['Status'], 'time' => (int) $inv['time_sell'], 'note' => (string) ($inv['note'] ?? ''), 'sub_page' => "https://$domainhosts/sub/{$inv['id_invoice']}"],
                'user' => $user ? ['id' => (string) $user['id'], 'name' => $user['namecustom'] ?: $user['username'], 'username' => $user['username'], 'balance' => (int) $user['Balance'],
                    'status' => $user['User_Status'], 'agent' => $user['agent']] : null,
                'panel' => $panel ? ['name' => $panel['name_panel'], 'type' => $panel['type'], 'active' => $panel['status'] !== 'disabled'] : null,
                'live' => $panel ? mg_live($inv) : ['ok' => false, 'error' => 'این پنل دیگر در ربات نیست'],
                'products' => $products, 'history' => $hist->fetchAll(PDO::FETCH_ASSOC)]);

        case 'mg_order_action':
            $b = body();
            $inv = mg_invoice($pdo, (string) ($b['id'] ?? ''));
            $act = (string) ($b['action'] ?? '');
            $panel = mg_panel($pdo, (string) $inv['Service_location']);
            $needPanel = !in_array($act, ['edit', 'message', 'purge', 'delete'], true);
            if ($needPanel && !$panel) {
                throw new PichaError('پنل این سرویس دیگر در ربات نیست', 409);
            }
            $msg = '';
            switch ($act) {
                case 'renew': // with a product, or custom {gb, days}
                    if (!empty($b['product_id'])) {
                        $st = $pdo->prepare("SELECT * FROM product WHERE id = ?");
                        $st->execute([(int) $b['product_id']]);
                        $p = $st->fetch(PDO::FETCH_ASSOC);
                        if (!$p) {
                            throw new PichaError('محصول پیدا نشد', 404);
                        }
                        $gb = (float) $p['Volume_constraint'];
                        $days = (int) $p['Service_time'];
                        $code = $p['code_product'];
                        $name = $p['name_product'];
                        $price = (int) $p['price_product'];
                    } else {
                        $gb = (float) ($b['gb'] ?? 0);
                        $days = (int) ($b['days'] ?? 0);
                        if ($gb < 0 || $days < 0 || ($gb == 0 && $days == 0) || $gb > 10000 || $days > 3650) {
                            throw new PichaError('حجم یا روز نامعتبر است', 422);
                        }
                        $code = 'custom_volume';
                        $name = $inv['name_product'];
                        $price = (int) ($b['price'] ?? 0);
                    }
                    $charge = !empty($b['charge']) && $price > 0;
                    if ($charge) {
                        $u = mg_user_row($pdo, (string) $inv['id_user']);
                        if (!$u || (int) $u['Balance'] < $price) {
                            throw new PichaError('موجودی کیف پول کاربر کافی نیست', 422);
                        }
                    }
                    $r = $ManagePanel->extend($panel['Methodextend'], $gb, $days, $inv['username'], $code, $panel['code_panel']);
                    if (!mg_ok($r)) {
                        throw new PichaError('تمدید روی پنل نشد: ' . mg_err($r), 502);
                    }
                    $pdo->prepare("INSERT IGNORE INTO service_other (id_user, username, value, type, time, price, output) VALUES (?,?,?,?,?,?,?)")
                        ->execute([$inv['id_user'], $inv['username'], $gb . '_' . $days, 'extend_user_by_admin', date('Y/m/d H:i:s'), $charge ? $price : 0, json_encode($r)]);
                    $pdo->prepare("UPDATE invoice SET Status = 'active' WHERE id_invoice = ?")->execute([$inv['id_invoice']]);
                    if ($charge) {
                        $pdo->prepare("UPDATE user SET Balance = Balance - ? WHERE id = ?")->execute([$price, $inv['id_user']]);
                        picha_log_balance($pdo, (string) $inv['id_user'], $price, 0);
                    }
                    $msg = "تمدید شد: {$gb} گیگ، {$days} روز" . ($charge ? '، ' . number_format($price) . ' تومان از کیف پول کم شد' : '');
                    if (!empty($b['notify'])) {
                        mg_notify((string) $inv['id_user'], "✅ سرویس <code>{$inv['username']}</code> تمدید شد ({$gb} گیگ، {$days} روز).");
                    }
                    break;

                case 'add_volume':
                    $gb = (float) ($b['gb'] ?? 0);
                    if ($gb <= 0 || $gb > 10000) {
                        throw new PichaError('حجم نامعتبر است', 422);
                    }
                    $r = $ManagePanel->extra_volume($inv['username'], $panel['code_panel'], $gb);
                    if (!mg_ok($r)) {
                        throw new PichaError('افزودن حجم نشد: ' . mg_err($r), 502);
                    }
                    $pdo->prepare("INSERT IGNORE INTO service_other (id_user, username, value, type, time, price, output) VALUES (?,?,?,?,?,?,?)")
                        ->execute([$inv['id_user'], $inv['username'], (string) $gb, 'extra_user', date('Y/m/d H:i:s'), 0, json_encode($r)]);
                    $msg = "{$gb} گیگ اضافه شد";
                    if (!empty($b['notify'])) {
                        mg_notify((string) $inv['id_user'], "🎁 {$gb} گیگ به سرویس <code>{$inv['username']}</code> اضافه شد.");
                    }
                    break;

                case 'add_time':
                    $days = (int) ($b['days'] ?? 0);
                    if ($days <= 0 || $days > 3650) {
                        throw new PichaError('تعداد روز نامعتبر است', 422);
                    }
                    $r = $ManagePanel->extra_time($inv['username'], $panel['code_panel'], $days);
                    if (!mg_ok($r)) {
                        throw new PichaError('افزودن زمان نشد: ' . mg_err($r), 502);
                    }
                    $pdo->prepare("INSERT IGNORE INTO service_other (id_user, username, value, type, time, price, output) VALUES (?,?,?,?,?,?,?)")
                        ->execute([$inv['id_user'], $inv['username'], (string) $days, 'extra_time_user', date('Y/m/d H:i:s'), 0, json_encode($r)]);
                    $msg = "{$days} روز اضافه شد";
                    if (!empty($b['notify'])) {
                        mg_notify((string) $inv['id_user'], "🎁 {$days} روز به سرویس <code>{$inv['username']}</code> اضافه شد.");
                    }
                    break;

                case 'toggle':
                    $r = $ManagePanel->Change_status($inv['username'], $inv['Service_location']);
                    if (!mg_ok($r)) {
                        throw new PichaError('تغییر وضعیت نشد: ' . mg_err($r), 502);
                    }
                    $live = mg_live($inv);
                    $msg = ($live['status'] ?? '') === 'disabled' ? 'سرویس غیرفعال شد' : 'سرویس فعال شد';
                    break;

                case 'reset_usage':
                    $r = $ManagePanel->ResetUserDataUsage($inv['username'], $inv['Service_location']);
                    if (!mg_ok($r)) {
                        throw new PichaError('صفر کردن مصرف نشد: ' . mg_err($r), 502);
                    }
                    $msg = 'مصرف صفر شد';
                    break;

                case 'revoke_sub':
                    $r = $ManagePanel->Revoke_sub($inv['Service_location'], $inv['username']);
                    if (!mg_ok($r)) {
                        throw new PichaError('تغییر لینک نشد: ' . mg_err($r), 502);
                    }
                    $pdo->prepare("UPDATE invoice SET user_info = NULL, uuid = NULL WHERE id_invoice = ?")->execute([$inv['id_invoice']]);
                    $msg = 'لینک اشتراک عوض شد (لینک قبلی دیگر کار نمی‌کند)';
                    break;

                case 'delete': // like the bot: off the panel, order marked removed (kept for statistics)
                case 'purge':  // … and the order row deleted too
                    if ($panel) {
                        $live = mg_live($inv);
                        if ($live['ok']) {
                            $ManagePanel->RemoveUser($inv['Service_location'], $inv['username']);
                            $after = mg_live($inv);
                            if ($after['ok']) {
                                throw new PichaError('سرویس از پنل پاک نشد؛ سفارش دست نخورد', 502);
                            }
                        } elseif (empty($live['not_found']) && empty($b['force'])) {
                            throw new PichaError('پنل جواب نداد: ' . $live['error'] . ' (برای پاک کردن فقط سفارش، «پاک کردن بدون پنل» را بزنید)', 502);
                        }
                    }
                    $refund = !empty($b['refund']) && (int) $inv['price_product'] > 0 && $inv['id_user'] !== '0';
                    if ($refund) {
                        $pdo->prepare("UPDATE user SET Balance = Balance + ? WHERE id = ?")->execute([(int) $inv['price_product'], $inv['id_user']]);
                        picha_log_balance($pdo, (string) $inv['id_user'], 0, (int) $inv['price_product']);
                    }
                    if ($act === 'purge') {
                        @file_put_contents(dirname(__DIR__) . '/storage/removed_services.jsonl', json_encode(['at' => date('c'), 'admin' => $admin, 'invoice' => $inv], JSON_UNESCAPED_UNICODE) . "\n", FILE_APPEND | LOCK_EX);
                        $pdo->prepare("DELETE FROM invoice WHERE id_invoice = ?")->execute([$inv['id_invoice']]);
                    } else {
                        $pdo->prepare("UPDATE invoice SET Status = 'removebyadmin' WHERE id_invoice = ?")->execute([$inv['id_invoice']]);
                    }
                    $msg = ($act === 'purge' ? 'سرویس و سفارش پاک شد' : 'سرویس حذف شد') . ($refund ? '، ' . number_format((int) $inv['price_product']) . ' تومان به کیف پول برگشت' : '');
                    if (!empty($b['notify']) && $refund) {
                        mg_notify((string) $inv['id_user'], "💰 مبلغ " . number_format((int) $inv['price_product']) . " تومان بابت سرویس <code>{$inv['username']}</code> به کیف پول شما برگشت.");
                    }
                    break;

                case 'edit':
                    $f = is_array($b['fields'] ?? null) ? $b['fields'] : [];
                    $allowed = ['name_product' => 'text', 'price_product' => 'int', 'note' => 'text', 'Status' => 'text', 'Volume' => 'num', 'Service_time' => 'int'];
                    $set = [];
                    foreach ($f as $k => $v) {
                        if (!isset($allowed[$k])) {
                            continue;
                        }
                        $v = $allowed[$k] === 'int' ? (string) (int) normalize_num($v) : ($allowed[$k] === 'num' ? (string) (float) normalize_num($v) : mb_substr(trim((string) $v), 0, 500));
                        if ($k === 'Status' && !array_key_exists($v, picha_order_statuses())) {
                            throw new PichaError('وضعیت نامعتبر است', 422);
                        }
                        $set[$k] = $v;
                    }
                    if (!$set) {
                        throw new PichaError('چیزی برای ذخیره نیست', 422);
                    }
                    $pdo->prepare("UPDATE invoice SET " . implode(', ', array_map(fn($k) => "`$k` = ?", array_keys($set))) . " WHERE id_invoice = ?")
                        ->execute([...array_values($set), $inv['id_invoice']]);
                    $msg = 'ذخیره شد';
                    break;

                case 'message':
                    $text = trim((string) ($b['text'] ?? ''));
                    if ($text === '' || mb_strlen($text) > 3500) {
                        throw new PichaError('متن پیام را بنویسید', 422);
                    }
                    if (!mg_notify((string) $inv['id_user'], htmlspecialchars($text, ENT_NOQUOTES))) {
                        throw new PichaError('پیام نرسید (کاربر ربات را بسته یا آیدی تلگرام ندارد)', 502);
                    }
                    $msg = 'پیام فرستاده شد';
                    break;

                default:
                    throw new PichaError('کار نامعتبر', 400);
            }
            mg_log($admin, "order.$act", ['order' => $inv['id_invoice'], 'service' => $inv['username'], 'input' => array_diff_key($b, ['id' => 1, 'action' => 1]), 'result' => $msg]);
            out(['ok' => true, 'message' => $msg]);

        case 'mg_user':
            $id = (string) ($_GET['id'] ?? '');
            $u = mg_user_row($pdo, $id);
            if (!$u) {
                throw new PichaError('کاربر پیدا نشد', 404);
            }
            $o = $pdo->prepare("SELECT id_invoice, username, name_product, price_product, Volume, Service_time, Service_location, Status, time_sell FROM invoice WHERE id_user = ? ORDER BY time_sell DESC LIMIT 200");
            $o->execute([$id]);
            $p = $pdo->prepare("SELECT id_order, time, price, payment_Status, Payment_Method, id_invoice FROM Payment_report WHERE id_user = ? ORDER BY id DESC LIMIT 50");
            $p->execute([$id]);
            $sum = $pdo->prepare("SELECT COALESCE(SUM(CAST(price_product AS SIGNED)),0) FROM invoice WHERE id_user = ? AND Status NOT IN ('unpaid','removebyadmin')");
            $sum->execute([$id]);
            out(['ok' => true, 'user' => [
                'id' => (string) $u['id'], 'username' => (string) $u['username'], 'name' => (string) $u['namecustom'], 'phone' => (string) $u['number'], 'balance' => (int) $u['Balance'],
                'agent' => $u['agent'], 'status' => $u['User_Status'], 'register' => (int) $u['register'], 'discount' => (int) $u['pricediscount'],
                'referrals' => (int) $u['affiliatescount'], 'referrer' => (string) $u['affiliates'], 'score' => (int) $u['score'], 'spent' => (int) $sum->fetchColumn()],
                'orders' => array_map(fn($r) => ['id' => $r['id_invoice'], 'username' => $r['username'], 'product' => $r['name_product'], 'price' => (int) $r['price_product'],
                    'gb' => (float) $r['Volume'], 'days' => (int) $r['Service_time'], 'location' => $r['Service_location'], 'status' => $r['Status'], 'time' => (int) $r['time_sell']], $o->fetchAll(PDO::FETCH_ASSOC)),
                'payments' => array_map(fn($r) => ['id' => $r['id_order'], 'time' => (string) $r['time'], 'price' => (int) $r['price'], 'status' => $r['payment_Status'],
                    'method' => $r['Payment_Method'], 'for' => (string) $r['id_invoice']], $p->fetchAll(PDO::FETCH_ASSOC))]);

        case 'mg_user_action':
            $b = body();
            $id = (string) ($b['id'] ?? '');
            $u = mg_user_row($pdo, $id);
            if (!$u) {
                throw new PichaError('کاربر پیدا نشد', 404);
            }
            $act = (string) ($b['action'] ?? '');
            $msg = '';
            switch ($act) {
                case 'wallet': // {amount (+ add / - take), reason?, notify?}
                    $amount = (int) normalize_num($b['amount'] ?? 0);
                    if ($amount === 0 || abs($amount) > 1000000000) {
                        throw new PichaError('مبلغ نامعتبر است', 422);
                    }
                    $old = (int) $u['Balance'];
                    $new = $old + $amount;
                    if ($new < 0 && empty($b['allow_negative'])) {
                        throw new PichaError('موجودی منفی می‌شود (' . number_format($new) . ')', 422);
                    }
                    $pdo->prepare("UPDATE user SET Balance = ? WHERE id = ?")->execute([$new, $id]);
                    picha_log_balance($pdo, $id, $old, $new);
                    $reason = trim((string) ($b['reason'] ?? ''));
                    $msg = ($amount > 0 ? number_format($amount) . ' تومان اضافه شد' : number_format(-$amount) . ' تومان کم شد') . '؛ موجودی: ' . number_format($new);
                    if (!empty($b['notify'])) {
                        mg_notify($id, ($amount > 0 ? '💰 ' . number_format($amount) . ' تومان به کیف پول شما اضافه شد.' : '💳 ' . number_format(-$amount) . ' تومان از کیف پول شما کم شد.')
                            . ($reason !== '' ? "\n" . htmlspecialchars($reason, ENT_NOQUOTES) : '') . "\nموجودی: " . number_format($new) . ' تومان');
                    }
                    break;

                case 'block':
                case 'unblock':
                    $pdo->prepare("UPDATE user SET User_Status = ?, description_blocking = ? WHERE id = ?")
                        ->execute([$act === 'block' ? 'block' : 'Active', $act === 'block' ? mb_substr(trim((string) ($b['reason'] ?? '')), 0, 500) : '', $id]);
                    $msg = $act === 'block' ? 'کاربر مسدود شد' : 'کاربر آزاد شد';
                    break;

                case 'message':
                    $text = trim((string) ($b['text'] ?? ''));
                    if ($text === '' || mb_strlen($text) > 3500) {
                        throw new PichaError('متن پیام را بنویسید', 422);
                    }
                    if (!mg_notify($id, htmlspecialchars($text, ENT_NOQUOTES))) {
                        throw new PichaError('پیام نرسید (کاربر ربات را بسته است)', 502);
                    }
                    $msg = 'پیام فرستاده شد';
                    break;

                case 'edit':
                    $f = is_array($b['fields'] ?? null) ? $b['fields'] : [];
                    $allowed = ['namecustom' => 'text', 'number' => 'text', 'agent' => ['f', 'n', 'n2'], 'pricediscount' => 'int', 'score' => 'int'];
                    $set = [];
                    foreach ($f as $k => $v) {
                        if (!isset($allowed[$k])) {
                            continue;
                        }
                        if (is_array($allowed[$k])) {
                            if (!in_array((string) $v, $allowed[$k], true)) {
                                throw new PichaError('نقش نامعتبر است', 422);
                            }
                            $set[$k] = (string) $v;
                        } else {
                            $set[$k] = $allowed[$k] === 'int' ? (string) (int) normalize_num($v) : mb_substr(trim((string) $v), 0, 200);
                        }
                    }
                    if (!$set) {
                        throw new PichaError('چیزی برای ذخیره نیست', 422);
                    }
                    $pdo->prepare("UPDATE user SET " . implode(', ', array_map(fn($k) => "`$k` = ?", array_keys($set))) . " WHERE id = ?")->execute([...array_values($set), $id]);
                    $msg = 'ذخیره شد';
                    break;

                default:
                    throw new PichaError('کار نامعتبر', 400);
            }
            mg_log($admin, "user.$act", ['user' => $id, 'input' => array_diff_key($b, ['id' => 1, 'action' => 1]), 'result' => $msg]);
            out(['ok' => true, 'message' => $msg]);
    }
    throw new PichaError('مسیر نامعتبر', 404);
}

function normalize_num($v): string
{
    $s = strtr((string) $v, ['۰' => '0', '۱' => '1', '۲' => '2', '۳' => '3', '۴' => '4', '۵' => '5', '۶' => '6', '۷' => '7', '۸' => '8', '۹' => '9',
        '٠' => '0', '١' => '1', '٢' => '2', '٣' => '3', '٤' => '4', '٥' => '5', '٦' => '6', '٧' => '7', '٨' => '8', '٩' => '9', ',' => '', '٬' => '', ' ' => '']);
    return preg_match('/^-?\d+(\.\d+)?$/', $s) ? $s : '0';
}
