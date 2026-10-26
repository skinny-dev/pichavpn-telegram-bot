<?php
// Picha Panel JSON API. Session auth (admin table), CSRF header on every write.
// Every table is described once in picha_resources(); the UI builds itself from ?r=schema.

declare(strict_types=1);

if (session_status() === PHP_SESSION_NONE) {
    // Telegram Mini App: the session travels in a header (inside Telegram Web the page is a frame and cookies are not sent).
    // Support attachments open as plain links, so only that route also accepts it in the URL.
    $pichaSid = (string) ($_SERVER['HTTP_X_PICHA_SESSION'] ?? ((($_GET['r'] ?? '') === 'support_file') ? ($_GET['sid'] ?? '') : ''));
    if ($pichaSid !== '' && preg_match('/^[A-Za-z0-9,-]{22,128}$/', $pichaSid)) {
        session_id($pichaSid);
    }
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    session_start();
}
date_default_timezone_set('Asia/Tehran');
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../stats_report.php';
require_once __DIR__ . '/../support_files.php';
require_once __DIR__ . '/../referral_links.php';
require_once __DIR__ . '/manual_order.php';
require_once __DIR__ . '/payments_admin.php';
require_once __DIR__ . '/activity.php';
require_once __DIR__ . '/promo_api.php';
/** @var PDO $pdo */

const PICHA_BRAND = 'پنل مدیریت پیچا';

/** storage/dashboard_access.json {"web_login": false} turns the password login off (the Mini App still works). */
function picha_web_login_off(): bool
{
    $f = __DIR__ . '/../storage/dashboard_access.json';
    $c = is_file($f) ? json_decode((string) @file_get_contents($f), true) : null;
    return is_array($c) && array_key_exists('web_login', $c) && $c['web_login'] === false;
}
const PICHA_MAX_EXPORT = 200000;
const PICHA_MAX_IMPORT = 5000;

function out($data, int $code = 200): void
{
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR);
    exit;
}

function fail(string $msg, int $code = 400, array $extra = []): void
{
    out(['ok' => false, 'error' => $msg] + $extra, $code);
}

function picha_admin_roles(): array
{
    return [
        'administrator' => 'مدیر کل (همه‌ی بخش‌ها + پنل وب)',
        'Seller' => 'فروشنده (دسترسی محدود در ربات)',
        'support' => 'پشتیبان (چت پشتیبانی در پنل وب، بدون رسید پرداخت‌ها)',
    ];
}

function picha_admin_count(PDO $pdo): int
{
    return (int) $pdo->query("SELECT COUNT(*) FROM admin WHERE rule = 'administrator'")->fetchColumn();
}

/**
 * Send a support reply to the customer through the bot (same text and "reply" button as a reply typed in Telegram), optionally with
 * an attachment ($file = ['path','name','mime','size']). Returns ['ok'=>bool, 'error'=>..., 'file'=>['type','id','name']|null].
 */
function picha_support_send(string $uid, string $text, string $tracking, ?array $file = null): array
{
    global $from_id, $pdo, $setting, $APIKEY;
    $cwd = getcwd();
    chdir(dirname(__DIR__)); // function.php loads vendor/autoload.php relative to the bot root
    require_once __DIR__ . '/../botapi.php';
    require_once __DIR__ . '/../function.php';
    $from_id = $uid; // languagechange() reads the customer's language from this
    $lang = languagechange(dirname(__DIR__));
    $msg = sprintf($lang['users']['support']['messageFromAdmin'], htmlspecialchars($text === '' ? '📎' : $text, ENT_NOQUOTES, 'UTF-8'));
    $kb = json_encode(['inline_keyboard' => [[['text' => $lang['users']['support']['answermessage'], 'callback_data' => 'Responsesusera_' . $tracking]]]]);
    if ($file === null) {
        $res = sendmessage($uid, $msg, $kb, 'HTML');
        chdir($cwd);
        return !empty($res['ok']) ? ['ok' => true, 'file' => null] : ['ok' => false, 'error' => (string) ($res['description'] ?? 'unknown')];
    }
    $mime = (string) $file['mime'];
    $fits = mb_strlen($msg) <= 1000; // a caption holds 1024 characters; longer text goes as its own message
    $attempts = [];
    if (str_starts_with($mime, 'image/') && in_array($mime, ['image/jpeg', 'image/png', 'image/webp'], true) && $file['size'] <= 10 * 1024 * 1024) {
        $attempts[] = ['sendPhoto', 'photo', 'photo'];
    } elseif (str_starts_with($mime, 'video/') && $file['size'] <= 50 * 1024 * 1024) {
        $attempts[] = ['sendVideo', 'video', 'video'];
    } elseif (in_array($mime, ['audio/mpeg', 'audio/mp4', 'audio/x-m4a'], true)) {
        $attempts[] = ['sendAudio', 'audio', 'audio'];
    }
    $attempts[] = ['sendDocument', 'document', 'document'];
    $res = ['ok' => false];
    $sentType = 'document';
    foreach ($attempts as [$method, $field, $type]) {
        $data = ['chat_id' => $uid, $field => new CURLFile($file['path'], $mime, $file['name'])];
        if ($fits) {
            $data['caption'] = $msg;
            $data['parse_mode'] = 'HTML';
            $data['reply_markup'] = $kb;
        }
        $res = telegram($method, $data);
        if (!empty($res['ok'])) {
            $sentType = $type;
            break;
        }
    }
    if (empty($res['ok'])) {
        chdir($cwd);
        return ['ok' => false, 'error' => (string) ($res['description'] ?? 'unknown')];
    }
    if (!$fits) {
        sendmessage($uid, $msg, $kb, 'HTML');
    }
    $r = $res['result'] ?? [];
    $fid = $sentType === 'photo' ? (string) (end($r['photo'])['file_id'] ?? '') : (string) ($r[$sentType]['file_id'] ?? '');
    chdir($cwd);
    return ['ok' => true, 'file' => $fid !== '' ? ['type' => $sentType, 'id' => $fid, 'name' => $file['name']] : null];
}

function body(): array
{
    static $b = null;
    if ($b === null) {
        $b = json_decode((string) file_get_contents('php://input'), true);
        $b = is_array($b) ? $b : [];
    }
    return $b;
}

/** Status groups of an order (service lifecycle), in the order they are shown as chips. */
function picha_order_groups(): array
{
    return ['active' => 'فعال', 'onhold' => 'در انتظار اولین اتصال', 'expired' => 'منقضی‌شده', 'disabled' => 'غیرفعال', 'removed' => 'حذف‌شده', 'unpaid' => 'پرداخت‌نشده / ناموفق', 'other' => 'سایر'];
}

/** raw invoice.Status value => [group, label] */
function picha_order_status_map(): array
{
    return [
        'active' => ['active', 'فعال'], 'sendedwarn' => ['active', 'فعال (هشدار ارسال شد)'], 'send_on_hold' => ['onhold', 'در انتظار اولین اتصال'],
        'end_of_time' => ['expired', 'پایان زمان'], 'end_of_volume' => ['expired', 'پایان حجم'],
        'disabledn' => ['disabled', 'غیرفعال'], 'disablebyadmin' => ['disabled', 'غیرفعال توسط ادمین'], 'disabled' => ['disabled', 'غیرفعال'],
        'removebyuser' => ['removed', 'حذف توسط کاربر'], 'removebyadmin' => ['removed', 'حذف توسط ادمین'], 'removeTime' => ['removed', 'حذف خودکار (انقضا)'],
        'unpaid' => ['unpaid', 'پرداخت‌نشده'], 'Unpaid' => ['unpaid', 'پرداخت‌نشده'], 'Unsuccessful' => ['unpaid', 'ناموفق'], 'expire' => ['unpaid', 'منقضی‌شده (پرداخت‌نشده)'], 'reject' => ['unpaid', 'رد شده'],
    ];
}

function picha_order_statuses(): array
{
    return array_map(fn($v) => $v[1], picha_order_status_map());
}

function picha_order_status_tones(): array
{
    $tone = ['active' => 'success', 'onhold' => 'warning', 'expired' => 'destructive', 'disabled' => 'secondary', 'removed' => 'secondary', 'unpaid' => 'destructive', 'other' => 'secondary'];
    return array_map(fn($v) => $tone[$v[0]], picha_order_status_map());
}

function picha_order_group_expr(): string
{
    $by = [];
    foreach (picha_order_status_map() as $raw => [$g]) {
        $by[$g][] = "'" . strtolower($raw) . "'";
    }
    $when = '';
    foreach ($by as $g => $list) {
        $when .= " WHEN LOWER(i.Status) IN (" . implode(',', $list) . ") THEN '$g'";
    }
    return "CASE$when ELSE 'other' END";
}

/** product categories and panels that appear in orders (filter dropdowns) */
function picha_order_categories(): array
{
    global $pdo;
    $o = [];
    try {
        foreach ($pdo->query("SELECT remark FROM category ORDER BY CAST(sort_order AS SIGNED), id")->fetchAll(PDO::FETCH_COLUMN) as $c) {
            $o[(string) $c] = (string) $c;
        }
    } catch (Throwable $e) {
    }
    return $o;
}

function picha_order_panels(): array
{
    global $pdo;
    $o = [];
    try {
        foreach ($pdo->query("SELECT DISTINCT Service_location FROM invoice WHERE Service_location IS NOT NULL AND Service_location != '' ORDER BY 1")->fetchAll(PDO::FETCH_COLUMN) as $c) {
            $o[(string) $c] = (string) $c;
        }
    } catch (Throwable $e) {
    }
    return $o;
}

/**
 * Column types: int | text | ts (unix seconds) | str (date string) | enum
 * 'edit' => editable inline; 'req' => required on create.
 */
function picha_resources(): array
{
    return [
        'users' => [
            'table' => 'user', 'pk' => 'id', 'title' => 'کاربران', 'create' => false, 'delete' => false, 'import' => true,
            'search' => ['id', 'username', 'namecustom', 'number'], 'order' => 'register', 'dir' => 'DESC',
            'cols' => [
                ['id', 'آیدی عددی', 'text'],
                ['username', 'نام کاربری', 'text'],
                ['namecustom', 'نام نمایشی', 'text', 'edit' => true],
                ['number', 'شماره', 'text', 'edit' => true],
                ['Balance', 'موجودی (تومان)', 'int', 'edit' => true],
                ['agent', 'نقش', 'enum', 'edit' => true, 'options' => ['f' => 'کاربر عادی', 'n' => 'نماینده عادی', 'n2' => 'نماینده پیشرفته']],
                ['User_Status', 'وضعیت', 'enum', 'edit' => true, 'options' => ['Active' => 'فعال', 'block' => 'مسدود']],
                ['pricediscount', 'درصد تخفیف', 'int', 'edit' => true],
                ['maxbuyagent', 'سقف خرید نماینده', 'int', 'edit' => true],
                ['score', 'امتیاز', 'int', 'edit' => true],
                ['limit_usertest', 'محدودیت تست', 'int', 'edit' => true],
                ['affiliatescount', 'تعداد زیرمجموعه', 'int'],
                ['register', 'تاریخ عضویت', 'ts'],
            ],
        ],
        'orders' => [
            'table' => 'invoice', 'pk' => 'id_invoice', 'title' => 'سفارشات', 'create' => false, 'delete' => false, 'import' => true,
            'from' => '`invoice` i LEFT JOIN `user` u ON u.id = i.id_user', 'alias' => 'i', 'datecol' => 'time_sell', 'summary' => true,
            'search' => ['id_invoice', 'username', 'id_user', 'name_product', 'u_name'], 'order' => 'time_sell', 'dir' => 'DESC',
            'cols' => [
                ['id_invoice', 'شماره سفارش', 'text'],
                ['time_sell', 'زمان', 'ts'],
                ['u_name', 'نام کاربر', 'text', 'expr' => "COALESCE(NULLIF(u.namecustom,''), NULLIF(NULLIF(u.username,''),'none'), i.id_user)"],
                ['id_user', 'آیدی کاربر', 'text'],
                ['username', 'نام سرویس', 'text'],
                ['name_product', 'محصول', 'text'],
                ['cat', 'دسته‌بندی محصول', 'enum', 'options' => picha_order_categories(), 'expr' => "(SELECT p.category FROM product p WHERE p.name_product = i.name_product LIMIT 1)"],
                ['otype', 'نوع سفارش', 'enum', 'options' => ['paid' => 'خرید', 'free' => 'رایگان / هدیه', 'test' => 'تست'], 'tones' => ['paid' => 'default', 'free' => 'secondary', 'test' => 'warning'],
                    'expr' => "CASE WHEN i.name_product LIKE '%تست%' THEN 'test' WHEN CAST(i.price_product AS SIGNED) = 0 THEN 'free' ELSE 'paid' END"],
                ['agent', 'نوع خریدار', 'enum', 'options' => ['f' => 'کاربر عادی', 'n' => 'نماینده عادی', 'n2' => 'نماینده پیشرفته'], 'expr' => "COALESCE(NULLIF(u.agent,''),'f')"],
                ['price_product', 'مبلغ (تومان)', 'int', 'edit' => true],
                ['Volume', 'حجم (GB)', 'int', 'edit' => true],
                ['Service_time', 'مدت (روز)', 'int', 'edit' => true],
                ['Service_location', 'پنل', 'enum', 'options' => picha_order_panels()],
                ['Status', 'وضعیت', 'enum', 'edit' => true, 'options' => picha_order_statuses(), 'tones' => picha_order_status_tones()],
                ['sgrp', 'گروه وضعیت', 'enum', 'options' => picha_order_groups(), 'tones' => ['active' => 'success', 'onhold' => 'warning', 'expired' => 'destructive', 'disabled' => 'secondary', 'removed' => 'secondary', 'unpaid' => 'destructive', 'other' => 'secondary'],
                    'expr' => picha_order_group_expr()],
                ['note', 'یادداشت', 'text', 'edit' => true],
            ],
        ],
        'products' => [
            'table' => 'product', 'pk' => 'id', 'title' => 'محصولات', 'create' => true, 'delete' => true, 'import' => true,
            'search' => ['name_product', 'code_product', 'category'], 'order' => 'sort_order', 'dir' => 'ASC',
            'cols' => [
                ['id', 'شناسه', 'int'],
                ['name_product', 'نام محصول', 'text', 'edit' => true, 'req' => true],
                ['price_product', 'قیمت (تومان)', 'int', 'edit' => true],
                ['Volume_constraint', 'حجم (GB)', 'int', 'edit' => true],
                ['Service_time', 'مدت (روز)', 'int', 'edit' => true],
                ['Location', 'پنل', 'text', 'edit' => true],
                ['category', 'دسته‌بندی', 'text', 'edit' => true],
                ['agent', 'قابل خرید برای', 'enum', 'edit' => true, 'options' => ['f' => 'کاربر عادی', 'n' => 'نماینده عادی', 'n2' => 'نماینده پیشرفته', 'all' => 'همه']],
                ['note', 'توضیحات', 'text', 'edit' => true],
                ['sort_order', 'ترتیب', 'int', 'edit' => true],
                ['status_product', 'وضعیت فروش', 'enum', 'edit' => true, 'options' => ['active' => 'موجود', 'disable' => 'ناموجود']],
            ],
            'defaults' => ['status_product' => 'active', 'agent' => 'f', 'data_limit_reset' => 'no_reset', 'one_buy_status' => '0', 'hide_panel' => '{}', 'note' => '', 'price_product' => '0', 'Volume_constraint' => '0', 'Service_time' => '0'],
        ],
        'categories' => [
            'table' => 'category', 'pk' => 'id', 'title' => 'دسته‌بندی‌ها', 'create' => true, 'delete' => true, 'import' => true,
            'search' => ['remark'], 'order' => 'sort_order', 'dir' => 'ASC',
            'cols' => [
                ['id', 'شناسه', 'int'],
                ['remark', 'نام دسته', 'text', 'edit' => true, 'req' => true],
                ['sort_order', 'ترتیب', 'int', 'edit' => true],
                ['status', 'وضعیت فروش', 'enum', 'edit' => true, 'options' => ['active' => 'موجود', 'disable' => 'ناموجود']],
            ],
            'defaults' => ['status' => 'active'],
        ],
        'payments' => [
            'table' => 'Payment_report', 'pk' => 'id', 'title' => 'پرداخت‌ها', 'create' => false, 'delete' => false, 'import' => false,
            'search' => ['id_user', 'id_order', 'Payment_Method'], 'order' => 'id', 'dir' => 'DESC',
            'cols' => [
                ['id', 'شناسه', 'int'],
                ['time', 'زمان', 'str'],
                ['id_user', 'کاربر', 'text'],
                ['price', 'مبلغ (تومان)', 'int'],
                ['Payment_Method', 'روش پرداخت', 'text'],
                ['payment_Status', 'وضعیت', 'text'],
                ['id_order', 'کد پیگیری', 'text'],
            ],
        ],
        'expenses' => [
            'table' => 'expenses', 'pk' => 'id', 'title' => 'هزینه‌ها', 'create' => true, 'delete' => true, 'import' => true,
            'search' => ['description', 'payer', 'payee'], 'order' => 'created_at', 'dir' => 'DESC', 'autots' => 'created_at',
            'cols' => [
                ['id', 'شناسه', 'int'],
                ['created_at', 'تاریخ و ساعت (خالی = همین الان)', 'dt', 'edit' => true],
                ['kind', 'نوع هزینه', 'enum', 'edit' => true, 'options' => accExpenseKinds()],
                ['description', 'نام / توضیحات', 'text', 'edit' => true, 'req' => true],
                ['payer', 'پرداخت‌کننده', 'text', 'edit' => true],
                ['payee', 'مقصد / دریافت‌کننده', 'text', 'edit' => true],
                ['amount', 'مبلغ (تومان)', 'int', 'edit' => true, 'req' => true],
            ],
            'defaults' => ['kind' => 'general'],
        ],
        'capital' => [
            'table' => 'capital_entries', 'pk' => 'id', 'title' => 'ورود سرمایه', 'create' => true, 'delete' => true, 'import' => true,
            'search' => ['description'], 'order' => 'created_at', 'dir' => 'DESC', 'autots' => 'created_at',
            'cols' => [
                ['id', 'شناسه', 'int'],
                ['created_at', 'تاریخ و ساعت (خالی = همین الان)', 'dt', 'edit' => true],
                ['amount', 'مبلغ (تومان)', 'int', 'edit' => true, 'req' => true],
                ['description', 'توضیحات', 'text', 'edit' => true],
            ],
        ],
    ];
}

function picha_res(string $name): array
{
    $all = picha_resources();
    if (!isset($all[$name])) {
        fail('منبع نامعتبر است', 404);
    }
    return $all[$name] + ['name' => $name];
}

/** Editable date/time columns ('dt') are shown as Jalali text «1405/07/14 15:30» and parsed back on save. */
function picha_format_dt(array $res, array $rows): array
{
    $dtCols = [];
    foreach ($res['cols'] as $c) {
        if ($c[2] === 'dt') {
            $dtCols[] = $c[0];
        }
    }
    foreach ($rows as &$r) {
        foreach ($dtCols as $k) {
            if (isset($r[$k]) && $r[$k] !== '') {
                $r[$k] = accFormatDateTime((int) $r[$k]);
            }
        }
    }
    unset($r);
    return $rows;
}

function picha_col(array $res, string $key): ?array
{
    foreach ($res['cols'] as $c) {
        if ($c[0] === $key) {
            return ['key' => $c[0], 'label' => $c[1], 'type' => $c[2]] + array_slice($c, 3, null, true);
        }
    }
    return null;
}

/** SQL for a column: virtual columns use their expression, base columns are qualified with the resource alias if there is one. */
function picha_cx(array $res, array $col): string
{
    if (isset($col['expr'])) {
        return '(' . $col['expr'] . ')';
    }
    return isset($res['alias']) ? "`{$res['alias']}`.`{$col['key']}`" : "`{$col['key']}`";
}

/** Validate/normalise a value for a column. Throws InvalidArgumentException. */
function picha_value(array $col, $value)
{
    $label = $col['label'];
    if ($value === null) {
        $value = '';
    }
    switch ($col['type']) {
        case 'int':
            $s = trim((string) $value);
            $s = str_replace([',', '٬', ' '], '', strtr($s, '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'));
            if ($s === '' ) {
                return 0;
            }
            if (!preg_match('/^-?\d{1,15}$/', $s)) {
                throw new InvalidArgumentException("«{$label}» باید عدد باشد");
            }
            return (int) $s;
        case 'dt':
            $ts = accParseDateTime($value);
            if ($ts === null) {
                throw new InvalidArgumentException("«{$label}» را به‌صورت 1405/07/14 15:30 (یا خالی = الان) بنویسید");
            }
            return $ts;
        case 'enum':
            $v = (string) $value;
            if (!array_key_exists($v, $col['options'] ?? [])) {
                throw new InvalidArgumentException("مقدار «{$label}» نامعتبر است");
            }
            return $v;
        default:
            $v = (string) $value;
            if (mb_strlen($v) > 2000) {
                throw new InvalidArgumentException("«{$label}» بیش از حد طولانی است");
            }
            return $v;
    }
}

function picha_log_balance(PDO $pdo, string $userId, int $old, int $new): void
{
    $diff = $new - $old;
    if ($diff === 0) {
        return;
    }
    $stmt = $pdo->prepare("INSERT INTO Payment_report (id_user,id_order,time,price,payment_Status,Payment_Method,id_invoice) VALUES (?,?,?,?,?,?,?)");
    $stmt->execute([$userId, bin2hex(random_bytes(6)), date('Y/m/d H:i:s'), abs($diff), 'paid', $diff > 0 ? 'add balance by admin' : 'low balance by admin', 'none']);
}

class PichaError extends RuntimeException
{
}

function picha_update(PDO $pdo, array $res, string $id, string $field, $value): void
{
    $col = picha_col($res, $field);
    if (!$col || empty($col['edit'])) {
        throw new PichaError('این ستون قابل ویرایش نیست', 403);
    }
    try {
        $v = picha_value($col, $value);
    } catch (InvalidArgumentException $e) {
        throw new PichaError($e->getMessage(), 422);
    }
    $table = $res['table'];
    $pk = $res['pk'];

    $own = !$pdo->inTransaction();
    if ($own) {
        $pdo->beginTransaction();
    }
    try {
        $st = $pdo->prepare("SELECT * FROM `$table` WHERE `$pk` = ? FOR UPDATE");
        $st->execute([$id]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            throw new PichaError('ردیف پیدا نشد', 404);
        }
        if ($res['name'] === 'users' && $field === 'Balance') {
            picha_log_balance($pdo, $id, (int) $row['Balance'], (int) $v);
        }
        if ($res['name'] === 'categories' && $field === 'remark') {
            $v = trim((string) $v);
            if ($v === '') {
                throw new PichaError('نام دسته نمی‌تواند خالی باشد', 422);
            }
            $dup = $pdo->prepare("SELECT COUNT(*) FROM category WHERE remark = ? AND id != ?");
            $dup->execute([$v, $id]);
            if ((int) $dup->fetchColumn() > 0) {
                throw new PichaError('دسته‌ای با این نام وجود دارد', 422);
            }
            $pdo->prepare("UPDATE product SET category = ? WHERE category = ?")->execute([$v, $row['remark']]);
        }
        if ($res['name'] === 'products' && $field === 'name_product') {
            $v = trim((string) $v);
            if ($v === '') {
                throw new PichaError('نام محصول نمی‌تواند خالی باشد', 422);
            }
        }
        $pdo->prepare("UPDATE `$table` SET `$field` = ? WHERE `$pk` = ?")->execute([$v, $id]);
        if ($own) {
            $pdo->commit();
        }
    } catch (Throwable $e) {
        if ($own && $pdo->inTransaction()) {
            $pdo->rollBack();
        }
        if ($e instanceof PichaError) {
            throw $e;
        }
        error_log('picha update: ' . $e->getMessage());
        throw new PichaError('خطا در ذخیره‌سازی', 500);
    }
}

/** Insert one row. Returns new pk. Throws InvalidArgumentException on bad data. */
function picha_insert(PDO $pdo, array $res, array $row): string
{
    $data = $res['defaults'] ?? [];
    foreach ($res['cols'] as $c) {
        $col = picha_col($res, $c[0]);
        if (empty($col['edit']) || !array_key_exists($col['key'], $row)) {
            if (!empty($col['req']) && !array_key_exists($col['key'], $row)) {
                throw new InvalidArgumentException("«{$col['label']}» الزامی است");
            }
            continue;
        }
        $data[$col['key']] = picha_value($col, $row[$col['key']]);
        if (!empty($col['req']) && trim((string) $data[$col['key']]) === '') {
            throw new InvalidArgumentException("«{$col['label']}» الزامی است");
        }
    }
    if (!empty($res['autots']) && !isset($data[$res['autots']])) {
        $data[$res['autots']] = time();
    }
    if ($res['name'] === 'products') {
        $dup = $pdo->prepare("SELECT COUNT(*) FROM product WHERE name_product = ?");
        $dup->execute([trim((string) $data['name_product'])]);
        if ((int) $dup->fetchColumn() > 0) {
            throw new InvalidArgumentException('محصولی با این نام وجود دارد');
        }
        $data['name_product'] = trim((string) $data['name_product']);
        $data['code_product'] = bin2hex(random_bytes(2));
    }
    if ($res['name'] === 'categories') {
        $data['remark'] = trim((string) $data['remark']);
        $dup = $pdo->prepare("SELECT COUNT(*) FROM category WHERE remark = ?");
        $dup->execute([$data['remark']]);
        if ((int) $dup->fetchColumn() > 0) {
            throw new InvalidArgumentException('دسته‌ای با این نام وجود دارد');
        }
    }
    if (in_array($res['name'], ['products', 'categories'], true) && !array_key_exists('sort_order', $row)) {
        $data['sort_order'] = (int) $pdo->query('SELECT COALESCE(MAX(CAST(sort_order AS SIGNED)), 0) + 1 FROM `' . $res['table'] . '`')->fetchColumn();
    }
    $names = array_keys($data);
    $sql = 'INSERT INTO `' . $res['table'] . '` (`' . implode('`,`', $names) . '`) VALUES (' . implode(',', array_fill(0, count($names), '?')) . ')';
    $pdo->prepare($sql)->execute(array_values($data));
    return (string) $pdo->lastInsertId();
}

// ---------------------------------------------------------------- auth

$route = (string) ($_GET['r'] ?? '');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

function picha_csrf(): string
{
    if (empty($_SESSION['picha_csrf'])) {
        $_SESSION['picha_csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['picha_csrf'];
}

function picha_throttle(string $ip, bool $record): bool
{
    $file = sys_get_temp_dir() . '/picha_login_' . md5($ip);
    $data = json_decode((string) @file_get_contents($file), true) ?: [];
    $now = time();
    $data = array_values(array_filter($data, fn($t) => ($now - $t) < 900));
    if (count($data) >= 10) {
        return false;
    }
    if ($record) {
        $data[] = $now;
        @file_put_contents($file, json_encode($data), LOCK_EX);
    }
    return true;
}

/** Telegram Mini App data (initData) checked with the bot token; the Telegram user or null. https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app */
function picha_tg_user(string $initData, string $botToken, int $maxAge = 86400): ?array
{
    parse_str($initData, $d);
    $hash = (string) ($d['hash'] ?? '');
    if ($hash === '' || $botToken === '') {
        return null;
    }
    unset($d['hash']);
    ksort($d);
    $check = implode("\n", array_map(fn($k, $v) => $k . '=' . $v, array_keys($d), $d));
    $secret = hash_hmac('sha256', $botToken, 'WebAppData', true);
    if (!hash_equals(hash_hmac('sha256', $check, $secret), $hash) || time() - (int) ($d['auth_date'] ?? 0) > $maxAge) {
        return null;
    }
    $u = json_decode((string) ($d['user'] ?? ''), true);
    return is_array($u) && !empty($u['id']) ? $u : null;
}

if ($route === 'tg_login') { // the same panel opened as a Telegram Mini App: the admin is recognised by their Telegram account
    if ($method !== 'POST') {
        fail('method', 405);
    }
    $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    if (!picha_throttle($ip, false)) {
        fail('تعداد تلاش‌ها زیاد است. ۱۵ دقیقه بعد دوباره امتحان کنید', 429);
    }
    $tgUser = picha_tg_user((string) (body()['init_data'] ?? ''), (string) ($APIKEY ?? ''));
    if (!$tgUser) {
        picha_throttle($ip, true);
        fail('اطلاعات ورود تلگرام معتبر نیست؛ مینی‌اپ را ببندید و دوباره باز کنید', 401);
    }
    $st = $pdo->prepare("SELECT * FROM admin WHERE id_admin = ?");
    $st->execute([(string) $tgUser['id']]);
    $admin = $st->fetch(PDO::FETCH_ASSOC);
    if (!$admin || !in_array($admin['rule'], ['administrator', 'support'], true)) {
        fail('این حساب تلگرام ادمین پنل نیست', 403);
    }
    session_regenerate_id(true);
    $_SESSION['admin_user'] = $admin['username'];
    $_SESSION['login_time'] = time();
    $_SESSION['via'] = 'telegram';
    out(['ok' => true, 'user' => $admin['username'], 'csrf' => picha_csrf(), 'brand' => PICHA_BRAND, 'session' => session_id()]);
}

if ($route === 'login') {
    if (picha_web_login_off()) {
        fail('ورود با رمز خاموش است؛ پنل را از مینی‌اپ ربات در تلگرام باز کنید', 403);
    }
    if ($method !== 'POST') {
        fail('method', 405);
    }
    $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    if (!picha_throttle($ip, false)) {
        fail('تعداد تلاش‌ها زیاد است. ۱۵ دقیقه بعد دوباره امتحان کنید', 429);
    }
    $u = trim((string) (body()['username'] ?? ''));
    $p = (string) (body()['password'] ?? '');
    $st = $pdo->prepare("SELECT * FROM admin WHERE username = ?");
    $st->execute([$u]);
    $admin = $st->fetch(PDO::FETCH_ASSOC);
    $stored = $admin ? (string) $admin['password'] : '$2y$10$dummy.hash.for.timing.attack.prevention.xxxxxxxxxxxxxxxx';
    $isHash = str_starts_with($stored, '$2') || str_starts_with($stored, '$argon2');
    $ok = $isHash ? password_verify($p, $stored) : ($admin && hash_equals($stored, $p));
    if ($ok && $admin && in_array($admin['rule'], ['administrator', 'support'], true)) {
        if (!$isHash) {
            $pdo->prepare("UPDATE admin SET password = ? WHERE username = ?")->execute([password_hash($p, PASSWORD_BCRYPT, ['cost' => 12]), $u]);
        }
        session_regenerate_id(true);
        $_SESSION['admin_user'] = $admin['username'];
        $_SESSION['login_time'] = time();
        @unlink(sys_get_temp_dir() . '/picha_login_' . md5($ip));
        out(['ok' => true, 'user' => $admin['username'], 'csrf' => picha_csrf(), 'brand' => PICHA_BRAND]);
    }
    picha_throttle($ip, true);
    fail('نام کاربری یا رمز عبور اشتباه است', 401);
}

$authed = false;
$role = '';
if (!empty($_SESSION['admin_user'])) {
    $st = $pdo->prepare("SELECT rule FROM admin WHERE username = ?");
    $st->execute([$_SESSION['admin_user']]);
    $role = (string) $st->fetchColumn();
    // support staff may use the live-chat inbox only; everything else needs a full administrator
    $authed = in_array($role, ['administrator', 'support'], true) && (time() - (int) ($_SESSION['login_time'] ?? 0) < 86400)
        && (($_SESSION['via'] ?? '') === 'telegram' || !picha_web_login_off()); // web panel switched off: only Mini App sessions
}

if ($route === 'me') {
    out(['ok' => true, 'authed' => $authed, 'user' => $authed ? $_SESSION['admin_user'] : null, 'role' => $authed ? $role : null, 'csrf' => $authed ? picha_csrf() : null, 'brand' => PICHA_BRAND,
        'web_login' => !picha_web_login_off()]);
}
if (!$authed) {
    fail('ورود لازم است', 401);
}
if ($method !== 'GET') {
    $sent = (string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? '');
    if (!hash_equals(picha_csrf(), $sent)) {
        fail('نشست نامعتبر است. صفحه را دوباره بارگذاری کنید', 403);
    }
}
if ($role === 'support' && !in_array($route, ['logout', 'support_unread', 'support_threads', 'support_thread', 'support_reply', 'support_close', 'support_file'], true)) {
    fail('دسترسی این حساب فقط به بخش پشتیبانی است', 403);
}

// ---------------------------------------------------------------- routes

try {
    if (strncmp($route, 'promo_', 6) === 0) {
        picha_promo_route($route, $pdo);
    }
    if (strncmp($route, 'fin_', 4) === 0) {
        require_once __DIR__ . '/finance_api.php';
        picha_finance_route($route, $pdo, $role, (string) $_SESSION['admin_user']);
    }
    switch ($route) {
        case 'logout':
            $_SESSION = [];
            session_destroy();
            out(['ok' => true]);

        case 'schema':
            $res = [];
            foreach (picha_resources() as $name => $r) {
                $res[$name] = [
                    'title' => $r['title'], 'pk' => $r['pk'], 'create' => $r['create'], 'delete' => $r['delete'], 'import' => $r['import'],
                    'cols' => array_map(function ($c) use ($r) {
                        $col = picha_col($r, $c[0]);
                        unset($col['expr']);
                        return $col;
                    }, $r['cols']),
                ];
            }
            out(['ok' => true, 'resources' => $res]);

        case 'list':
        case 'export':
            $res = picha_res((string) ($_GET['res'] ?? ''));
            $table = $res['table'];
            $from = $res['from'] ?? "`$table`";
            $pkSql = isset($res['alias']) ? "`{$res['alias']}`.`{$res['pk']}`" : "`{$res['pk']}`";
            $where = [];
            $params = [];
            $q = trim((string) ($_GET['q'] ?? ''));
            if ($q !== '') {
                $like = [];
                foreach ($res['search'] as $s) {
                    $sc = picha_col($res, $s);
                    $like[] = ($sc ? picha_cx($res, $sc) : "`$s`") . " LIKE ?";
                    $params[] = '%' . addcslashes($q, '%_\\') . '%';
                }
                $where[] = '(' . implode(' OR ', $like) . ')';
            }
            // date window on the resource's date column: ?range=today|yesterday|7d|30d|month|lastmonth
            if (!empty($res['datecol']) && !empty($_GET['range'])) {
                $r = (string) $_GET['range'];
                if (in_array($r, ['today', 'yesterday', 'month', 'lastmonth'], true)) {
                    $pr = statsPeriod($r);
                } elseif ($r === '7d' || $r === '30d') {
                    $pr = ['start' => time() - ($r === '7d' ? 7 : 30) * 86400, 'end' => time()];
                } else {
                    fail('بازه نامعتبر است', 422);
                }
                $dcol = picha_col($res, $res['datecol']);
                $where[] = 'CAST(' . picha_cx($res, $dcol) . ' AS UNSIGNED) BETWEEN ? AND ?';
                $params[] = (int) $pr['start'];
                $params[] = (int) $pr['end'];
            }
            $groupKey = $res['summary'] ?? false ? 'sgrp' : null; // chips are counted without their own filter
            $whereNoGroup = $where;
            $paramsNoGroup = $params;
            foreach ((array) ($_GET['f'] ?? []) as $fk => $fv) {
                $col = picha_col($res, (string) $fk);
                if ($col && $fv !== '') {
                    $cx = picha_cx($res, $col);
                    $isSaleStatus = in_array($col['key'], ['status', 'status_product'], true) && isset($col['options']['active']);
                    $where[] = $isSaleStatus ? "COALESCE(NULLIF($cx,''),'active') = ?" : "$cx = ?";
                    $params[] = (string) $fv;
                    if ($col['key'] !== $groupKey) {
                        $whereNoGroup[] = end($where);
                        $paramsNoGroup[] = (string) $fv;
                    }
                }
            }
            $sortKey = (string) ($_GET['sort'] ?? $res['order']);
            $sortCol = picha_col($res, $sortKey);
            if (!$sortCol) {
                $sortKey = $res['order'];
                $sortCol = picha_col($res, $sortKey);
            }
            $dir = strtoupper((string) ($_GET['dir'] ?? $res['dir'])) === 'ASC' ? 'ASC' : 'DESC';
            $sortSql = picha_cx($res, $sortCol);
            $orderExpr = in_array($sortCol['type'] ?? '', ['int', 'ts', 'dt'], true) ? "CAST($sortSql AS SIGNED)" : $sortSql;
            // rows created before the sale-status column existed (or by the bot's own add flows) have an empty status = available
            $names = implode(',', array_map(function ($c) use ($res) {
                $col = picha_col($res, $c[0]);
                $cx = picha_cx($res, $col);
                $isSaleStatus = in_array($c[0], ['status', 'status_product'], true) && isset($c['options']['active']);
                return $isSaleStatus ? "COALESCE(NULLIF($cx,''),'active') AS `{$c[0]}`" : "$cx AS `{$c[0]}`";
            }, $res['cols']));
            $wsql = $where ? ' WHERE ' . implode(' AND ', $where) : '';
            if ($route === 'export') {
                $st = $pdo->prepare("SELECT $names FROM $from$wsql ORDER BY $orderExpr $dir, $pkSql LIMIT " . PICHA_MAX_EXPORT);
                $st->execute($params);
                out(['ok' => true, 'rows' => picha_format_dt($res, $st->fetchAll(PDO::FETCH_ASSOC))]);
            }
            $per = max(1, min(200, (int) ($_GET['per'] ?? 50)));
            $page = max(1, (int) ($_GET['page'] ?? 1));
            $cnt = $pdo->prepare("SELECT COUNT(*) FROM $from$wsql");
            $cnt->execute($params);
            $total = (int) $cnt->fetchColumn();
            $st = $pdo->prepare("SELECT $names FROM $from$wsql ORDER BY $orderExpr $dir, $pkSql LIMIT $per OFFSET " . (($page - 1) * $per));
            $st->execute($params);
            $outData = ['ok' => true, 'rows' => picha_format_dt($res, $st->fetchAll(PDO::FETCH_ASSOC)), 'total' => $total, 'page' => $page, 'per' => $per];
            if (!empty($res['summary'])) {
                // orders: revenue of the shown selection + counts per status group (other filters applied, the group filter itself not)
                $priceSql = picha_cx($res, picha_col($res, 'price_product'));
                $sum = $pdo->prepare("SELECT COALESCE(SUM(CAST($priceSql AS SIGNED)),0) FROM $from$wsql");
                $sum->execute($params);
                $groupSql = picha_cx($res, picha_col($res, 'sgrp'));
                $gst = $pdo->prepare("SELECT $groupSql AS g, COUNT(*) AS c, COALESCE(SUM(CAST($priceSql AS SIGNED)),0) AS s FROM $from" . ($whereNoGroup ? ' WHERE ' . implode(' AND ', $whereNoGroup) : '') . " GROUP BY g");
                $gst->execute($paramsNoGroup);
                $byGroup = [];
                foreach ($gst->fetchAll(PDO::FETCH_ASSOC) as $g) {
                    $byGroup[$g['g']] = ['count' => (int) $g['c'], 'sum' => (int) $g['s']];
                }
                $outData['summary'] = ['sum' => (int) $sum->fetchColumn(), 'groups' => $byGroup];
            }
            out($outData);

        case 'update':
            $b = body();
            $res = picha_res((string) ($b['res'] ?? ''));
            picha_update($pdo, $res, (string) ($b['id'] ?? ''), (string) ($b['field'] ?? ''), $b['value'] ?? '');
            $st = $pdo->prepare("SELECT `" . (string) $b['field'] . "` FROM `{$res['table']}` WHERE `{$res['pk']}` = ?");
            $st->execute([(string) $b['id']]);
            out(['ok' => true, 'value' => $st->fetchColumn()]);

        case 'create':
            $b = body();
            $res = picha_res((string) ($b['res'] ?? ''));
            if (!$res['create']) {
                fail('افزودن مجاز نیست', 403);
            }
            try {
                $id = picha_insert($pdo, $res, (array) ($b['row'] ?? []));
            } catch (InvalidArgumentException $e) {
                fail($e->getMessage(), 422);
            }
            out(['ok' => true, 'id' => $id]);

        case 'delete':
            $b = body();
            $res = picha_res((string) ($b['res'] ?? ''));
            if (!$res['delete']) {
                fail('حذف مجاز نیست', 403);
            }
            $id = (string) ($b['id'] ?? '');
            if ($res['name'] === 'categories') {
                $r = $pdo->prepare("SELECT remark FROM category WHERE id = ?");
                $r->execute([$id]);
                $remark = $r->fetchColumn();
                $c = $pdo->prepare("SELECT COUNT(*) FROM product WHERE category = ?");
                $c->execute([$remark]);
                if ($remark !== false && (int) $c->fetchColumn() > 0) {
                    fail('ابتدا محصولات این دسته را به دسته دیگری منتقل کنید', 409);
                }
            }
            $pdo->prepare("DELETE FROM `{$res['table']}` WHERE `{$res['pk']}` = ?")->execute([$id]);
            out(['ok' => true]);

        case 'import':
            // rows: array of objects keyed by column key. mode=upsert updates existing rows by pk, inserts the rest.
            $b = body();
            $res = picha_res((string) ($b['res'] ?? ''));
            if (empty($res['import'])) {
                fail('درون‌ریزی برای این بخش مجاز نیست', 403);
            }
            $rows = (array) ($b['rows'] ?? []);
            if (count($rows) > PICHA_MAX_IMPORT) {
                fail('حداکثر ' . PICHA_MAX_IMPORT . ' ردیف در هر بار قابل درون‌ریزی است', 413);
            }
            $dry = !empty($b['dry']);
            $stats = ['inserted' => 0, 'updated' => 0, 'skipped' => 0];
            $errors = [];
            $pdo->beginTransaction();
            foreach ($rows as $i => $row) {
                $line = $i + 1;
                $row = is_array($row) ? $row : [];
                try {
                    $pkv = isset($row[$res['pk']]) ? trim((string) $row[$res['pk']]) : '';
                    $exists = false;
                    if ($pkv !== '') {
                        $e = $pdo->prepare("SELECT COUNT(*) FROM `{$res['table']}` WHERE `{$res['pk']}` = ?");
                        $e->execute([$pkv]);
                        $exists = (int) $e->fetchColumn() > 0;
                    }
                    if ($exists) {
                        $n = 0;
                        foreach ($row as $k => $v) {
                            $col = picha_col($res, (string) $k);
                            if ($col && !empty($col['edit'])) {
                                $cur = $pdo->prepare("SELECT `$k` FROM `{$res['table']}` WHERE `{$res['pk']}` = ?");
                                $cur->execute([$pkv]);
                                if ((string) $cur->fetchColumn() !== (string) picha_value($col, $v)) {
                                    picha_update($pdo, $res, $pkv, (string) $k, $v);
                                    $n++;
                                }
                            }
                        }
                        $stats[$n ? 'updated' : 'skipped']++;
                    } elseif ($res['create']) {
                        picha_insert($pdo, $res, $row);
                        $stats['inserted']++;
                    } else {
                        $stats['skipped']++;
                        $errors[] = ['line' => $line, 'error' => 'ردیف در پایگاه داده وجود ندارد'];
                    }
                } catch (InvalidArgumentException | PichaError $e) {
                    $errors[] = ['line' => $line, 'error' => $e->getMessage()];
                    $stats['skipped']++;
                }
            }
            if ($dry || ($errors && empty($b['partial']))) {
                $pdo->rollBack();
                out(['ok' => !$errors, 'applied' => false, 'dry' => $dry] + $stats + ['errors' => array_slice($errors, 0, 50)], $errors && !$dry ? 422 : 200);
            }
            $pdo->commit();
            out(['ok' => true, 'applied' => true] + $stats + ['errors' => array_slice($errors, 0, 50)]);

        case 'tree':
            $cats = $pdo->query("SELECT id, remark, CAST(sort_order AS SIGNED) AS sort_order FROM category ORDER BY CAST(sort_order AS SIGNED), id")->fetchAll(PDO::FETCH_ASSOC);
            $prods = $pdo->query("SELECT id, name_product, price_product, Volume_constraint, Service_time, Location, category, agent, CAST(sort_order AS SIGNED) AS sort_order FROM product ORDER BY CAST(sort_order AS SIGNED), id")->fetchAll(PDO::FETCH_ASSOC);
            $byCat = [];
            foreach ($prods as $p) {
                $byCat[(string) $p['category']][] = $p;
            }
            $tree = [];
            foreach ($cats as $c) {
                $tree[] = $c + ['products' => $byCat[$c['remark']] ?? []];
                unset($byCat[$c['remark']]);
            }
            $uncat = [];
            foreach ($byCat as $list) {
                $uncat = array_merge($uncat, $list);
            }
            out(['ok' => true, 'categories' => $tree, 'uncategorized' => $uncat]);

        case 'tree_save':
            // body: {categories:[{id, products:[productId,...]}], uncategorized:[productId,...]}
            $b = body();
            $pdo->beginTransaction();
            $nameOf = $pdo->prepare("SELECT remark FROM category WHERE id = ?");
            $setCat = $pdo->prepare("UPDATE category SET sort_order = ? WHERE id = ?");
            $setProd = $pdo->prepare("UPDATE product SET category = ?, sort_order = ? WHERE id = ?");
            $pos = 0;
            foreach ((array) ($b['categories'] ?? []) as $ci => $c) {
                $cid = (int) ($c['id'] ?? 0);
                $nameOf->execute([$cid]);
                $remark = $nameOf->fetchColumn();
                if ($remark === false) {
                    $pdo->rollBack();
                    fail('دسته نامعتبر است', 422);
                }
                $setCat->execute([$ci + 1, $cid]);
                foreach ((array) ($c['products'] ?? []) as $pid) {
                    $setProd->execute([$remark, ++$pos, (int) $pid]);
                }
            }
            foreach ((array) ($b['uncategorized'] ?? []) as $pid) {
                $setProd->execute(['', ++$pos, (int) $pid]);
            }
            $pdo->commit();
            out(['ok' => true]);

        case 'stats':
            $period = (string) ($_GET['period'] ?? 'today');
            if (!in_array($period, ['all', 'hour', 'today', 'yesterday', 'month', 'lastmonth'], true)) {
                fail('بازه نامعتبر است', 422);
            }
            $p = statsPeriod($period);
            $d = statsCollect($pdo, $p['start'], $p['end']);
            $all = $period === 'all' ? $d : statsCollect($pdo, 0, time());
            out(['ok' => true, 'period' => $period, 'title' => $p['title'], 'start' => $p['start'], 'end' => $p['end'], 'data' => $d, 'all' => $all, 'overall' => $period === 'all' ? statsOverall($pdo) : null, 'kinds' => array_map(fn($k, $l) => ['key' => $k, 'label' => $l, 'group' => accKindGroup($k)], array_keys(accExpenseKinds()), accExpenseKinds()), 'text' => strip_tags(statsReport($pdo, $period))]);

        case 'activity':
            // ?month=1405/07 (Jalali); default = current month
            if (!function_exists('jalali_to_gregorian')) {
                require_once __DIR__ . '/../jdf.php';
            }
            $ym = (string) ($_GET['month'] ?? '');
            if (preg_match('#^(\d{4})[/-](\d{1,2})$#', strtr($ym, ['۰' => '0', '۱' => '1', '۲' => '2', '۳' => '3', '۴' => '4', '۵' => '5', '۶' => '6', '۷' => '7', '۸' => '8', '۹' => '9']), $m) && (int) $m[2] >= 1 && (int) $m[2] <= 12) {
                [$jy, $jm] = [(int) $m[1], (int) $m[2]];
            } else {
                [$jy, $jm] = array_map('intval', explode('/', jdate('Y/n', time(), '', 'Asia/Tehran', 'en')));
            }
            out(['ok' => true] + picha_activity($pdo, $jy, $jm));

        case 'overview':
            $today = statsCollect($pdo, statsPeriod('today')['start'], time());
            $month = statsCollect($pdo, statsPeriod('month')['start'], time());
            $users = (int) $pdo->query("SELECT COUNT(*) FROM user")->fetchColumn();
            $balance = (int) $pdo->query("SELECT COALESCE(SUM(Balance),0) FROM user")->fetchColumn();
            $active = (int) $pdo->query("SELECT COUNT(*) FROM invoice WHERE Status IN ('active','send_on_hold','sendedwarn')")->fetchColumn();
            $pending = (int) $pdo->query("SELECT COUNT(*) FROM Payment_report WHERE payment_Status = 'waiting'")->fetchColumn();
            // last 30 days revenue (orders only, by Tehran day)
            $since = strtotime('today -29 days');
            $st = $pdo->prepare("SELECT time_sell, price_product FROM invoice WHERE CAST(time_sell AS UNSIGNED) >= ? AND Status != 'Unpaid' AND name_product != 'سرویس تست'");
            $st->execute([$since]);
            $days = [];
            for ($i = 0; $i < 30; $i++) {
                $days[date('Y-m-d', $since + $i * 86400)] = ['orders' => 0, 'revenue' => 0];
            }
            foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
                $k = date('Y-m-d', (int) $r['time_sell']);
                if (isset($days[$k])) {
                    $days[$k]['orders']++;
                    $days[$k]['revenue'] += (int) $r['price_product'];
                }
            }
            $series = [];
            foreach ($days as $k => $v) {
                $series[] = ['date' => $k, 'jdate' => jdate('m/d', strtotime($k), '', 'Asia/Tehran', 'en')] + $v;
            }
            $recent = $pdo->query("SELECT id_invoice, username, name_product, price_product, time_sell, Status FROM invoice ORDER BY CAST(time_sell AS UNSIGNED) DESC LIMIT 8")->fetchAll(PDO::FETCH_ASSOC);
            out(['ok' => true, 'today' => $today, 'month' => $month, 'users' => $users, 'balance' => $balance, 'active_services' => $active, 'pending_payments' => $pending, 'series' => $series, 'recent' => $recent]);

        case 'support_unread':
            out(['ok' => true, 'unread' => (int) $pdo->query("SELECT COUNT(DISTINCT iduser) FROM support_message WHERE status IN ('Unseen','Customerresponse')")->fetchColumn()]);

        case 'support_threads':
            $filter = (string) ($_GET['f'] ?? 'open');
            $q = trim((string) ($_GET['q'] ?? ''));
            $params = [];
            $having = $filter === 'closed' ? 'HAVING open_rows = 0' : ($filter === 'all' ? '' : 'HAVING open_rows > 0');
            $where = '';
            if ($q !== '') {
                $where = "WHERE s.iduser LIKE ? OR u.username LIKE ? OR u.namecustom LIKE ?";
                $like = '%' . addcslashes($q, '%_\\') . '%';
                $params = [$like, $like, $like];
            }
            $st = $pdo->prepare("SELECT s.iduser, MAX(s.id) AS last_id, COUNT(*) AS n, SUM(s.status IN ('Unseen','Customerresponse')) AS unread, SUM(s.status != 'close') AS open_rows, u.username AS tg_username, u.namecustom AS name FROM support_message s LEFT JOIN user u ON u.id = s.iduser $where GROUP BY s.iduser, u.username, u.namecustom $having ORDER BY (SUM(s.status IN ('Unseen','Customerresponse')) > 0) DESC, last_id DESC LIMIT 200");
            $st->execute($params);
            $threads = $st->fetchAll(PDO::FETCH_ASSOC);
            $lastRow = $pdo->prepare("SELECT name_departman, text, result, time, result_time, file_id, result_file_id FROM support_message WHERE id = ?");
            foreach ($threads as &$t) {
                $lastRow->execute([$t['last_id']]);
                $l = $lastRow->fetch(PDO::FETCH_ASSOC) ?: [];
                $hasReply = ($l['result'] ?? '') !== '' && ($l['result'] ?? '') !== '0';
                $hasReply = $hasReply || ($l['result_file_id'] ?? '') !== '';
                $snipText = $hasReply ? 'شما: ' . ($l['result'] === '0' ? '' : $l['result']) : (string) ($l['text'] ?? '');
                $hasFile = $hasReply ? ($l['result_file_id'] ?? '') !== '' : ($l['file_id'] ?? '') !== '';
                $t['snippet'] = mb_substr(trim($snipText . ($hasFile ? ' 📎' : '')), 0, 80);
                $t['department'] = (string) ($l['name_departman'] ?? '');
                $t['time'] = $hasReply && ($l['result_time'] ?? '') !== '' ? $l['result_time'] : (string) ($l['time'] ?? '');
                $t['unread'] = (int) $t['unread'];
                $t['open'] = (int) $t['open_rows'] > 0;
                unset($t['open_rows'], $t['last_id']);
            }
            unset($t);
            out(['ok' => true, 'threads' => $threads]);

        case 'support_thread':
            $uid = trim((string) ($_GET['uid'] ?? ''));
            $st = $pdo->prepare("SELECT id, Tracking, name_departman, text, result, time, result_time, result_by, status, file_id, file_type, file_name, result_file_id, result_file_type, result_file_name FROM support_message WHERE iduser = ? ORDER BY id");
            $st->execute([$uid]);
            $rows = $st->fetchAll(PDO::FETCH_ASSOC);
            if (!$rows) {
                fail('گفتگو پیدا نشد', 404);
            }
            $msgs = [];
            $fileInfo = function (string $type, string $name, int $row, string $side) {
                [$mime, $inline] = supportFileDelivery($type, $name);
                $kind = !$inline ? 'file' : (str_starts_with($mime, 'image/') ? 'image' : (str_starts_with($mime, 'video/') ? 'video' : 'audio'));
                return ['row' => $row, 'side' => $side, 'kind' => $kind, 'name' => $name !== '' ? $name : ($type === 'photo' ? 'photo.jpg' : $type)];
            };
            foreach ($rows as $r) {
                if ($r['text'] !== '' || $r['file_id'] !== '') {
                    $m = ['id' => $r['id'] . 'c', 'from' => 'customer', 'text' => $r['text'], 'time' => $r['time'], 'dept' => $r['name_departman']];
                    if ($r['file_id'] !== '') {
                        $m['file'] = $fileInfo((string) $r['file_type'], (string) $r['file_name'], (int) $r['id'], 'c');
                    }
                    $msgs[] = $m;
                }
                if (($r['result'] !== '' && $r['result'] !== '0') || $r['result_file_id'] !== '') {
                    $m = ['id' => $r['id'] . 's', 'from' => 'support', 'text' => $r['result'] === '0' ? '' : $r['result'], 'time' => $r['result_time'] !== '' ? $r['result_time'] : $r['time'], 'by' => (string) $r['result_by']];
                    if ($r['result_file_id'] !== '') {
                        $m['file'] = $fileInfo((string) $r['result_file_type'], (string) $r['result_file_name'], (int) $r['id'], 's');
                    }
                    $msgs[] = $m;
                }
            }
            // opening the chat marks the customer's messages as seen (bot status "Pending" = seen, not yet answered)
            $pdo->prepare("UPDATE support_message SET status = 'Pending' WHERE iduser = ? AND status IN ('Unseen','Customerresponse')")->execute([$uid]);
            $u = $pdo->prepare("SELECT username, namecustom, Balance, number FROM user WHERE id = ?");
            $u->execute([$uid]);
            out(['ok' => true, 'uid' => $uid, 'user' => $u->fetch(PDO::FETCH_ASSOC) ?: null, 'messages' => $msgs, 'open' => (bool) array_filter($rows, fn($r) => $r['status'] !== 'close')]);

        case 'support_reply':
            // JSON {uid, text} or multipart form (uid, text, file)
            if (!$_POST && !$_FILES && (int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 0 && stripos((string) ($_SERVER['CONTENT_TYPE'] ?? ''), 'multipart/') === 0) {
                // PHP drops the whole body when it is larger than post_max_size
                fail('حجم فایل از حد مجاز سرور بیشتر است (upload_max_filesize = ' . ini_get('upload_max_filesize') . '، post_max_size = ' . ini_get('post_max_size') . ')', 413);
            }
            $b = $_POST ? $_POST : body();
            $uid = trim((string) ($b['uid'] ?? ''));
            $text = trim((string) ($b['text'] ?? ''));
            $up = $_FILES['file'] ?? null;
            $file = null;
            if (is_array($up) && ($up['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_NO_FILE) {
                if ($up['error'] === UPLOAD_ERR_INI_SIZE || $up['error'] === UPLOAD_ERR_FORM_SIZE) {
                    fail('حجم فایل از حد مجاز سرور بیشتر است (upload_max_filesize = ' . ini_get('upload_max_filesize') . '، post_max_size = ' . ini_get('post_max_size') . ')', 413);
                }
                if ($up['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($up['tmp_name'])) {
                    fail('آپلود فایل ناموفق بود', 422);
                }
                if ($up['size'] > 20 * 1024 * 1024) {
                    fail('حداکثر حجم فایل ۲۰ مگابایت است', 413);
                }
                $name = trim((string) preg_replace('/[\x00-\x1f\x7f\/\\\\]+/u', '_', (string) $up['name']));
                $name = mb_substr($name !== '' ? $name : 'file', 0, 120);
                $mime = (new finfo(FILEINFO_MIME_TYPE))->file($up['tmp_name']) ?: 'application/octet-stream';
                $file = ['path' => $up['tmp_name'], 'name' => $name, 'mime' => $mime, 'size' => (int) $up['size']];
            }
            if (($text === '' && $file === null) || mb_strlen($text) > 3500) {
                fail('متن پیام خالی یا بیش از حد طولانی است', 422);
            }
            $st = $pdo->prepare("SELECT * FROM support_message WHERE iduser = ? ORDER BY id DESC");
            $st->execute([$uid]);
            $rows = $st->fetchAll(PDO::FETCH_ASSOC);
            if (!$rows) {
                fail('گفتگو پیدا نشد', 404);
            }
            $pending = array_values(array_filter($rows, fn($r) => in_array($r['status'], ['Unseen', 'Customerresponse', 'Pending'], true)));
            $adminRow = $pdo->prepare("SELECT id_admin FROM admin WHERE username = ?");
            $adminRow->execute([$_SESSION['admin_user']]);
            $by = (string) ($adminRow->fetchColumn() ?: $_SESSION['admin_user']);
            $now = date('Y/m/d H:i:s');
            $trk = $pending ? (string) $pending[0]['Tracking'] : bin2hex(random_bytes(4));
            // deliver first: a customer who blocked the bot must not leave a "sent" reply behind
            $delivery = picha_support_send($uid, $text, $trk, $file);
            if (!$delivery['ok']) {
                fail('ارسال به تلگرام ناموفق بود: ' . $delivery['error'] . ' (شاید مشتری ربات را مسدود کرده است)', 502);
            }
            $sent = $delivery['file'] ?? null;
            $pdo->beginTransaction();
            if ($pending) {
                $pdo->prepare("UPDATE support_message SET status = 'Answered' WHERE iduser = ? AND status IN ('Unseen','Customerresponse','Pending')")->execute([$uid]);
                $pdo->prepare("UPDATE support_message SET result = ?, result_time = ?, result_by = ?, result_file_id = ?, result_file_type = ?, result_file_name = ? WHERE Tracking = ?")
                    ->execute([$text, $now, $by, $sent['id'] ?? '', $sent['type'] ?? '', $sent['name'] ?? '', $trk]);
            } else {
                $pdo->prepare("INSERT INTO support_message (Tracking,idsupport,iduser,name_departman,text,result,result_time,result_by,time,status,result_file_id,result_file_type,result_file_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
                    ->execute([$trk, $rows[0]['idsupport'], $uid, $rows[0]['name_departman'], '', $text, $now, $by, $now, 'Answered', $sent['id'] ?? '', $sent['type'] ?? '', $sent['name'] ?? '']);
            }
            $pdo->commit();
            out(['ok' => true]);

        case 'support_file':
            // streams an attachment from Telegram (file ids never leave the server, the bot token is never exposed)
            $st = $pdo->prepare("SELECT file_id, file_type, file_name, result_file_id, result_file_type, result_file_name FROM support_message WHERE id = ?");
            $st->execute([(int) ($_GET['row'] ?? 0)]);
            $r = $st->fetch(PDO::FETCH_ASSOC);
            $s = ($_GET['side'] ?? 'c') === 's' ? 'result_' : '';
            $fid = (string) ($r[$s . 'file_id'] ?? '');
            if ($fid === '') {
                fail('فایل پیدا نشد', 404);
            }
            $ftype = (string) $r[$s . 'file_type'];
            $fname = (string) $r[$s . 'file_name'];
            $ask = curl_init('https://api.telegram.org/bot' . $APIKEY . '/getFile?file_id=' . urlencode($fid));
            curl_setopt_array($ask, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15]);
            $info = json_decode((string) curl_exec($ask), true);
            curl_close($ask);
            if (empty($info['ok']) || empty($info['result']['file_path'])) {
                $big = stripos((string) ($info['description'] ?? ''), 'too big') !== false;
                fail($big ? 'فایل بزرگ‌تر از ۲۰ مگابایت است و از طریق ربات قابل دانلود نیست؛ در تلگرام ببینید' : 'دریافت فایل از تلگرام ناموفق بود', $big ? 413 : 502);
            }
            [$mime, $inline] = supportFileDelivery($ftype, $fname);
            $dl = $fname !== '' ? $fname : basename($info['result']['file_path']);
            header('Content-Type: ' . $mime);
            header('Content-Disposition: ' . ($inline ? 'inline' : 'attachment') . '; filename="' . preg_replace('/[^A-Za-z0-9._-]/', '_', $dl) . '"');
            header("Content-Security-Policy: default-src 'none'; sandbox");
            header('Cache-Control: private, max-age=3600');
            if (!empty($info['result']['file_size'])) {
                header('Content-Length: ' . (int) $info['result']['file_size']);
            }
            $dlc = curl_init('https://api.telegram.org/file/bot' . $APIKEY . '/' . $info['result']['file_path']);
            curl_setopt_array($dlc, [CURLOPT_TIMEOUT => 120, CURLOPT_WRITEFUNCTION => function ($c, $chunk) {
                echo $chunk;
                return strlen($chunk);
            }]);
            curl_exec($dlc);
            curl_close($dlc);
            exit;

        case 'support_close':
            $uid = trim((string) (body()['uid'] ?? ''));
            $pdo->prepare("UPDATE support_message SET status = 'close' WHERE iduser = ? AND status != 'close'")->execute([$uid]);
            out(['ok' => true]);

        case 'pay_pending':
            out(['ok' => true] + picha_pay_pending($pdo, (int) ($_GET['days'] ?? 7)));

        case 'pay_confirm':
            $b = body();
            out(picha_pay_confirm($pdo, trim((string) ($b['order'] ?? '')), !empty($b['allow_rejected'])));

        case 'payment_create':
            // manual payment record (cash / card to card / outside Telegram). Optionally credits the user's wallet.
            $b = body();
            $amount = referralMoneyInput($b['price'] ?? 0);
            if ($amount <= 0) {
                fail('مبلغ نامعتبر است', 422);
            }
            $uid = trim((string) ($b['id_user'] ?? ''));
            $credit = !empty($b['add_balance']);
            if ($uid !== '' && !preg_match('/^\d{1,15}$/', $uid)) {
                fail('آیدی عددی تلگرام نامعتبر است (برای مشتری بدون تلگرام خالی بگذارید)', 422);
            }
            if ($credit && $uid === '') {
                fail('برای شارژ کیف پول، آیدی عددی کاربر لازم است', 422);
            }
            $method = mb_substr(trim((string) ($b['method'] ?? '')), 0, 190);
            $method = $method === '' ? 'ثبت دستی' : $method;
            $pdo->beginTransaction();
            if ($uid !== '') {
                $uq = $pdo->prepare("SELECT Balance FROM user WHERE id = ? FOR UPDATE");
                $uq->execute([$uid]);
                $bal = $uq->fetchColumn();
                if ($bal === false) {
                    $pdo->rollBack();
                    fail('این کاربر در ربات ثبت نشده است', 404);
                }
                if ($credit) {
                    $pdo->prepare("UPDATE user SET Balance = ? WHERE id = ?")->execute([(int) $bal + $amount, $uid]);
                }
            }
            $pdo->prepare("INSERT INTO Payment_report (id_user, id_order, time, price, dec_not_confirmed, Payment_Method, payment_Status, id_invoice) VALUES (?,?,?,?,?,?,?,?)")
                ->execute([$uid === '' ? '0' : $uid, bin2hex(random_bytes(6)), date('Y/m/d H:i:s'), $amount, mb_substr(trim((string) ($b['note'] ?? '')) . ' | ثبت دستی توسط ' . $_SESSION['admin_user'], 0, 1000), $method, 'paid', 'none']);
            $pdo->commit();
            out(['ok' => true, 'credited' => $credit]);

        case 'order_options':
            out(['ok' => true] + picha_order_options($pdo));

        case 'order_create':
            // creates the VPN account + invoice for a customer that may have no Telegram account at all
            out(['ok' => true] + picha_order_create($pdo, body(), (string) $_SESSION['admin_user']));

        case 'referrals':
            $o = referralOverview($pdo);
            $tgRef = $pdo->query("SELECT u.id, u.username, u.affiliatescount FROM user u WHERE CAST(u.affiliatescount AS SIGNED) > 0 ORDER BY CAST(u.affiliatescount AS SIGNED) DESC LIMIT 50")->fetchAll(PDO::FETCH_ASSOC);
            out(['ok' => true, 'links' => $o['links'], 'global_percent' => $o['global_percent'], 'bot' => ltrim((string) ($usernamebot ?? ''), '@'),
                 'tg_referrers' => array_map(fn($r) => ['id' => (string) $r['id'], 'username' => (string) $r['username'], 'count' => (int) $r['affiliatescount']], $tgRef)]);

        case 'referral_save':
            // body: {id?, name, platform, code?, tg_user_id?, contact?, price, pays_commission, commission_percent?, active, notes?}
            $b = body();
            $name = trim((string) ($b['name'] ?? ''));
            if ($name === '' || mb_strlen($name) > 200) {
                fail('نام تبلیغ‌دهنده/کمپین را وارد کنید', 422);
            }
            $platform = in_array((string) ($b['platform'] ?? ''), ['instagram', 'telegram', 'youtube', 'tiktok', 'website', 'other'], true) ? (string) $b['platform'] : 'other';
            $price = referralMoneyInput($b['price'] ?? '0');
            $pays = !empty($b['pays_commission']) ? 1 : 0;
            $pct = ($b['commission_percent'] ?? '') === '' || $b['commission_percent'] === null ? null : (int) $b['commission_percent'];
            if ($pct !== null && ($pct < 0 || $pct > 100)) {
                fail('درصد پورسانت باید بین ۰ تا ۱۰۰ باشد', 422);
            }
            $tg = trim((string) ($b['tg_user_id'] ?? ''));
            if ($tg !== '' && !preg_match('/^\d{5,15}$/', $tg)) {
                fail('آیدی عددی تلگرام نامعتبر است (برای اینستاگرام/خارج از تلگرام خالی بگذارید)', 422);
            }
            $contact = mb_substr(trim((string) ($b['contact'] ?? '')), 0, 200);
            $notes = mb_substr(trim((string) ($b['notes'] ?? '')), 0, 1000);
            $active = array_key_exists('active', $b) && empty($b['active']) ? 0 : 1;
            // campaign date: when the ad ran / was paid (Jalali or Gregorian); empty = unknown
            $adDate = null;
            if (trim((string) ($b['ad_date'] ?? '')) !== '') {
                $adDate = accParseDateTime((string) $b['ad_date']);
                if ($adDate === null) {
                    fail('تاریخ تبلیغ را به‌صورت 1405/07/14 یا 1405/07/14 15:30 بنویسید', 422);
                }
            }
            $editId = (int) ($b['id'] ?? 0);
            $code = trim((string) ($b['code'] ?? ''));
            if ($code !== '') {
                $code = referralNormalizeCode($code);
                if ($code === '') {
                    fail('کد لینک: فقط حروف انگلیسی، عدد، _ و - (۳ تا ۴۰ کاراکتر، شروع با حرف)', 422);
                }
            }
            if ($editId === 0) {
                $code = $code !== '' ? $code : referralGenerateCode($pdo);
                $dup = $pdo->prepare("SELECT COUNT(*) FROM referral_links WHERE code = ?");
                $dup->execute([$code]);
                if ((int) $dup->fetchColumn() > 0) {
                    fail('این کد قبلاً استفاده شده است', 409);
                }
                $pdo->prepare("INSERT INTO referral_links (name, platform, code, tg_user_id, contact, price, pays_commission, commission_percent, active, notes, ad_date, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
                    ->execute([$name, $platform, $code, $tg === '' ? null : $tg, $contact, $price, $pays, $pct, $active, $notes, $adDate, time()]);
                out(['ok' => true, 'id' => (int) $pdo->lastInsertId(), 'code' => $code]);
            }
            $cur = $pdo->prepare("SELECT code, expense_id FROM referral_links WHERE id = ?");
            $cur->execute([$editId]);
            $curRow = $cur->fetch(PDO::FETCH_ASSOC);
            if (!$curRow) {
                fail('لینک پیدا نشد', 404);
            }
            $oldCode = $curRow['code'];
            $pdo->beginTransaction();
            // the code is what is printed in public links: it never changes after creation
            $pdo->prepare("UPDATE referral_links SET name=?, platform=?, tg_user_id=?, contact=?, price=?, pays_commission=?, commission_percent=?, active=?, notes=?, ad_date=? WHERE id=?")
                ->execute([$name, $platform, $tg === '' ? null : $tg, $contact, $price, $pays, $pct, $active, $notes, $adDate, $editId]);
            // an already booked cost follows the link: same amount, and the campaign date when one is given
            if ($curRow['expense_id'] !== null) {
                $pdo->prepare("UPDATE expenses SET amount = ?, created_at = COALESCE(?, created_at) WHERE id = ?")->execute([$price, $adDate, (int) $curRow['expense_id']]);
            }
            $pdo->commit();
            out(['ok' => true, 'id' => $editId, 'code' => $oldCode]);

        case 'referral_delete':
            $id = (int) (body()['id'] ?? 0);
            $n = $pdo->prepare("SELECT COUNT(*) FROM referral_signups WHERE link_id = ?");
            $n->execute([$id]);
            if ((int) $n->fetchColumn() > 0) {
                fail('این لینک کاربر ثبت‌شده دارد؛ به‌جای حذف، غیرفعالش کنید', 409);
            }
            $pdo->prepare("DELETE FROM referral_payouts WHERE link_id = ?")->execute([$id]);
            $pdo->prepare("DELETE FROM referral_links WHERE id = ?")->execute([$id]);
            out(['ok' => true]);

        case 'referral_payout':
            $b = body();
            $id = (int) ($b['id'] ?? 0);
            $amount = referralMoneyInput($b['amount'] ?? '0');
            if ($amount <= 0) {
                fail('مبلغ پرداخت نامعتبر است', 422);
            }
            $ex = $pdo->prepare("SELECT COUNT(*) FROM referral_links WHERE id = ?");
            $ex->execute([$id]);
            if (!(int) $ex->fetchColumn()) {
                fail('لینک پیدا نشد', 404);
            }
            $pdo->prepare("INSERT INTO referral_payouts (link_id, amount, note, created_at) VALUES (?,?,?,?)")->execute([$id, $amount, mb_substr(trim((string) ($b['note'] ?? '')), 0, 300), time()]);
            out(['ok' => true]);

        case 'referral_book_cost':
            // books the campaign price once as an "advertising" expense (bridges into the finance ledger via fin_sync)
            $bb = body();
            $id = (int) ($bb['id'] ?? 0);
            $bookAt = null;
            if (trim((string) ($bb['date'] ?? '')) !== '') {
                $bookAt = accParseDateTime((string) $bb['date']);
                if ($bookAt === null) {
                    fail('تاریخ را به‌صورت 1405/07/14 یا 1405/07/14 15:30 بنویسید', 422);
                }
            }
            $pdo->beginTransaction();
            $q = $pdo->prepare("SELECT * FROM referral_links WHERE id = ? FOR UPDATE");
            $q->execute([$id]);
            $l = $q->fetch(PDO::FETCH_ASSOC);
            if (!$l) {
                $pdo->rollBack();
                fail('لینک پیدا نشد', 404);
            }
            if ($l['expense_id'] !== null) {
                $pdo->rollBack();
                fail('هزینهٔ این کمپین قبلاً ثبت شده است', 409);
            }
            if ((int) $l['price'] <= 0) {
                $pdo->rollBack();
                fail('قیمت کمپین صفر است', 422);
            }
            $pdo->prepare("INSERT INTO expenses (amount, description, created_at, admin_id, kind) VALUES (?,?,?,?,'advertising')")
                // dated when the ad ran (chosen date > campaign date > the day the link was made), never silently "today"
                ->execute([(int) $l['price'], 'تبلیغات: ' . $l['name'], $bookAt ?? ($l['ad_date'] !== null ? (int) $l['ad_date'] : (int) $l['created_at']), (string) $_SESSION['admin_user']]);
            $eid = (int) $pdo->lastInsertId();
            $pdo->prepare("UPDATE referral_links SET expense_id = ? WHERE id = ?")->execute([$eid, $id]);
            $pdo->commit();
            out(['ok' => true, 'expense_id' => $eid]);

        case 'referral_payouts':
            $q = $pdo->prepare("SELECT id, amount, note, created_at FROM referral_payouts WHERE link_id = ? ORDER BY id DESC LIMIT 200");
            $q->execute([(int) ($_GET['id'] ?? 0)]);
            out(['ok' => true, 'rows' => array_map(fn($r) => ['id' => (int) $r['id'], 'amount' => (int) $r['amount'], 'note' => (string) $r['note'], 'created_at' => (int) $r['created_at']], $q->fetchAll(PDO::FETCH_ASSOC))]);


        case 'admins':
            $rows = $pdo->query("SELECT a.id_admin, a.username, a.rule, (a.password LIKE '\$2%' OR a.password LIKE '\$argon2%') AS hp, u.username AS tg_username, u.namecustom FROM admin a LEFT JOIN user u ON u.id = a.id_admin ORDER BY FIELD(a.rule,'administrator','Seller','support'), a.id_admin")->fetchAll(PDO::FETCH_ASSOC);
            $selfName = (string) $_SESSION['admin_user'];
            $list = array_map(fn($r) => [
                'id_admin' => (string) $r['id_admin'], 'username' => (string) $r['username'], 'rule' => (string) $r['rule'],
                'tg_username' => (string) ($r['tg_username'] ?? ''), 'name' => (string) ($r['namecustom'] ?? ''),
                // "bot-only" admins carry a random unusable hash; only the web login name differs from the id
                'web_login' => in_array((string) $r['rule'], ['administrator', 'support'], true) && (string) $r['username'] !== (string) $r['id_admin'],
                'self' => (string) $r['username'] === $selfName,
            ], $rows);
            out(['ok' => true, 'rows' => $list, 'roles' => picha_admin_roles()]);

        case 'admin_save':
            // body: {id?: existing id_admin, id_admin?: telegram id (create), username, rule, password?}
            $b = body();
            $rule = (string) ($b['rule'] ?? '');
            if (!isset(picha_admin_roles()[$rule])) {
                fail('نقش نامعتبر است', 422);
            }
            $username = trim((string) ($b['username'] ?? ''));
            $password = (string) ($b['password'] ?? '');
            $editId = trim((string) ($b['id'] ?? ''));
            if ($password !== '' && strlen($password) < 8) {
                fail('رمز عبور باید حداقل ۸ کاراکتر باشد', 422);
            }
            $pdo->beginTransaction();
            if ($editId === '') {
                $newId = trim((string) ($b['id_admin'] ?? ''));
                if (!preg_match('/^\d{5,15}$/', $newId)) {
                    fail('آیدی عددی تلگرام نامعتبر است', 422);
                }
                $ex = $pdo->prepare("SELECT COUNT(*) FROM admin WHERE id_admin = ?");
                $ex->execute([$newId]);
                if ((int) $ex->fetchColumn() > 0) {
                    fail('این آیدی قبلاً ادمین است', 409);
                }
                $username = $username === '' ? $newId : $username;
            } else {
                $cur = $pdo->prepare("SELECT * FROM admin WHERE id_admin = ? FOR UPDATE");
                $cur->execute([$editId]);
                $row = $cur->fetch(PDO::FETCH_ASSOC);
                if (!$row) {
                    fail('ادمین پیدا نشد', 404);
                }
                $newId = $editId;
                $username = $username === '' ? (string) $row['username'] : $username;
                $isSelf = (string) $row['username'] === (string) $_SESSION['admin_user'];
                if ($isSelf && $rule !== 'administrator') {
                    fail('نقش حساب خودتان را نمی‌توانید کاهش دهید', 409);
                }
                if ($row['rule'] === 'administrator' && $rule !== 'administrator' && picha_admin_count($pdo) <= 1) {
                    fail('حداقل یک مدیر کل باید بماند', 409);
                }
            }
            if (!preg_match('/^[A-Za-z0-9_.@-]{3,64}$/', $username)) {
                fail('نام کاربری فقط حروف انگلیسی، عدد و _ . - @ (۳ تا ۶۴ کاراکتر)', 422);
            }
            $dup = $pdo->prepare("SELECT COUNT(*) FROM admin WHERE username = ? AND id_admin != ?");
            $dup->execute([$username, $newId]);
            if ((int) $dup->fetchColumn() > 0) {
                fail('این نام کاربری قبلاً استفاده شده است', 409);
            }
            if ($editId === '') {
                $hash = password_hash($password !== '' ? $password : bin2hex(random_bytes(16)), PASSWORD_BCRYPT, ['cost' => 12]);
                $pdo->prepare("INSERT INTO admin (id_admin, username, password, rule) VALUES (?,?,?,?)")->execute([$newId, $username, $hash, $rule]);
            } else {
                $pdo->prepare("UPDATE admin SET username = ?, rule = ? WHERE id_admin = ?")->execute([$username, $rule, $newId]);
                if ($password !== '') {
                    $pdo->prepare("UPDATE admin SET password = ? WHERE id_admin = ?")->execute([password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]), $newId]);
                }
                if (!empty($isSelf)) {
                    $_SESSION['admin_user'] = $username;
                }
            }
            $pdo->commit();
            out(['ok' => true, 'id' => $newId]);

        case 'admin_delete':
            $id = trim((string) (body()['id'] ?? ''));
            $cur = $pdo->prepare("SELECT * FROM admin WHERE id_admin = ?");
            $cur->execute([$id]);
            $row = $cur->fetch(PDO::FETCH_ASSOC);
            if (!$row) {
                fail('ادمین پیدا نشد', 404);
            }
            if ((string) $row['username'] === (string) $_SESSION['admin_user']) {
                fail('حساب خودتان را نمی‌توانید حذف کنید', 409);
            }
            if ($row['rule'] === 'administrator' && picha_admin_count($pdo) <= 1) {
                fail('حداقل یک مدیر کل باید بماند', 409);
            }
            $pdo->prepare("DELETE FROM admin WHERE id_admin = ?")->execute([$id]);
            out(['ok' => true]);

        default:
            fail('مسیر پیدا نشد', 404);
    }
} catch (FinError $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    fail($e->getMessage(), $e->http);
} catch (PichaError $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    fail($e->getMessage(), $e->getCode() ?: 400);
} catch (Throwable $e) {
    error_log('picha api: ' . $e->getMessage() . ' @' . $e->getFile() . ':' . $e->getLine());
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    fail('خطای داخلی سرور', 500);
}
