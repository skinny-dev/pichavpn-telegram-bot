<?php
// Picha Panel JSON API. Session auth (admin table), CSRF header on every write.
// Every table is described once in picha_resources(); the UI builds itself from ?r=schema.

declare(strict_types=1);

if (session_status() === PHP_SESSION_NONE) {
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
/** @var PDO $pdo */

const PICHA_BRAND = 'پنل مدیریت پیچا';
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

function body(): array
{
    static $b = null;
    if ($b === null) {
        $b = json_decode((string) file_get_contents('php://input'), true);
        $b = is_array($b) ? $b : [];
    }
    return $b;
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
            'search' => ['id_invoice', 'username', 'id_user', 'name_product'], 'order' => 'time_sell', 'dir' => 'DESC',
            'cols' => [
                ['id_invoice', 'شماره سفارش', 'text'],
                ['time_sell', 'زمان', 'ts'],
                ['id_user', 'کاربر', 'text'],
                ['username', 'نام سرویس', 'text'],
                ['name_product', 'محصول', 'text'],
                ['price_product', 'مبلغ (تومان)', 'int', 'edit' => true],
                ['Volume', 'حجم (GB)', 'int', 'edit' => true],
                ['Service_time', 'مدت (روز)', 'int', 'edit' => true],
                ['Service_location', 'پنل', 'text'],
                ['Status', 'وضعیت', 'text', 'edit' => true],
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
            'search' => ['description'], 'order' => 'created_at', 'dir' => 'DESC', 'autots' => 'created_at',
            'cols' => [
                ['id', 'شناسه', 'int'],
                ['created_at', 'تاریخ و ساعت (خالی = همین الان)', 'dt', 'edit' => true],
                ['kind', 'نوع هزینه', 'enum', 'edit' => true, 'options' => accExpenseKinds()],
                ['description', 'نام / توضیحات', 'text', 'edit' => true, 'req' => true],
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

if ($route === 'login') {
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
    if ($ok && $admin && $admin['rule'] === 'administrator') {
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
if (!empty($_SESSION['admin_user'])) {
    $st = $pdo->prepare("SELECT rule FROM admin WHERE username = ?");
    $st->execute([$_SESSION['admin_user']]);
    $rule = $st->fetchColumn();
    $authed = ($rule === 'administrator') && (time() - (int) ($_SESSION['login_time'] ?? 0) < 86400);
}

if ($route === 'me') {
    out(['ok' => true, 'authed' => $authed, 'user' => $authed ? $_SESSION['admin_user'] : null, 'csrf' => $authed ? picha_csrf() : null, 'brand' => PICHA_BRAND]);
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

// ---------------------------------------------------------------- routes

try {
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
                    'cols' => array_map(fn($c) => picha_col($r, $c[0]), $r['cols']),
                ];
            }
            out(['ok' => true, 'resources' => $res]);

        case 'list':
        case 'export':
            $res = picha_res((string) ($_GET['res'] ?? ''));
            $table = $res['table'];
            $where = [];
            $params = [];
            $q = trim((string) ($_GET['q'] ?? ''));
            if ($q !== '') {
                $like = [];
                foreach ($res['search'] as $s) {
                    $like[] = "`$s` LIKE ?";
                    $params[] = '%' . addcslashes($q, '%_\\') . '%';
                }
                $where[] = '(' . implode(' OR ', $like) . ')';
            }
            foreach ((array) ($_GET['f'] ?? []) as $fk => $fv) {
                $col = picha_col($res, (string) $fk);
                if ($col && $fv !== '') {
                    $isSaleStatus = in_array($col['key'], ['status', 'status_product'], true) && isset($col['options']['active']);
                    $where[] = $isSaleStatus ? "COALESCE(NULLIF(`{$col['key']}`,''),'active') = ?" : "`{$col['key']}` = ?";
                    $params[] = (string) $fv;
                }
            }
            $sortKey = (string) ($_GET['sort'] ?? $res['order']);
            $sortCol = picha_col($res, $sortKey);
            if (!$sortCol) {
                $sortKey = $res['order'];
                $sortCol = picha_col($res, $sortKey);
            }
            $dir = strtoupper((string) ($_GET['dir'] ?? $res['dir'])) === 'ASC' ? 'ASC' : 'DESC';
            $orderExpr = in_array($sortCol['type'] ?? '', ['int', 'ts', 'dt'], true) ? "CAST(`$sortKey` AS SIGNED)" : "`$sortKey`";
            // rows created before the sale-status column existed (or by the bot's own add flows) have an empty status = available
            $names = implode(',', array_map(function ($c) {
                $isSaleStatus = in_array($c[0], ['status', 'status_product'], true) && isset($c['options']['active']);
                return $isSaleStatus ? "COALESCE(NULLIF(`{$c[0]}`,''),'active') AS `{$c[0]}`" : "`{$c[0]}`";
            }, $res['cols']));
            $wsql = $where ? ' WHERE ' . implode(' AND ', $where) : '';
            if ($route === 'export') {
                $st = $pdo->prepare("SELECT $names FROM `$table`$wsql ORDER BY $orderExpr $dir, `{$res['pk']}` LIMIT " . PICHA_MAX_EXPORT);
                $st->execute($params);
                out(['ok' => true, 'rows' => picha_format_dt($res, $st->fetchAll(PDO::FETCH_ASSOC))]);
            }
            $per = max(1, min(200, (int) ($_GET['per'] ?? 50)));
            $page = max(1, (int) ($_GET['page'] ?? 1));
            $cnt = $pdo->prepare("SELECT COUNT(*) FROM `$table`$wsql");
            $cnt->execute($params);
            $total = (int) $cnt->fetchColumn();
            $st = $pdo->prepare("SELECT $names FROM `$table`$wsql ORDER BY $orderExpr $dir, `{$res['pk']}` LIMIT $per OFFSET " . (($page - 1) * $per));
            $st->execute($params);
            out(['ok' => true, 'rows' => picha_format_dt($res, $st->fetchAll(PDO::FETCH_ASSOC)), 'total' => $total, 'page' => $page, 'per' => $per]);

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
            out(['ok' => true, 'period' => $period, 'title' => $p['title'], 'start' => $p['start'], 'end' => $p['end'], 'data' => $d, 'all' => $all, 'overall' => $period === 'all' ? statsOverall($pdo) : null, 'text' => strip_tags(statsReport($pdo, $period))]);

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

        default:
            fail('مسیر پیدا نشد', 404);
    }
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
