<?php
// Which parts of the bot are really used (last 90 days) — to decide what the Serverless rewrite must cover first.
//   php scripts/usage_report.php
// Reads only. Prints counts, never personal data.

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
$root = dirname(__DIR__);
require $root . '/config.php';

$since = time() - 90 * 86400;
$sinceStr = date('Y/m/d', $since);
$q = function (string $title, string $sql, array $p = []) use ($pdo) {
    try {
        $st = $pdo->prepare($sql);
        $st->execute($p);
        $rows = $st->fetchAll(PDO::FETCH_NUM);
        echo "\n━━ $title\n";
        if (!$rows) {
            echo "   (هیچ)\n";
        }
        foreach ($rows as $r) {
            echo '   ' . implode(' | ', array_map(fn($v) => $v === null ? '—' : (string) $v, $r)) . "\n";
        }
    } catch (Throwable $e) {
        echo "\n━━ $title\n   (جدول نیست: " . substr($e->getMessage(), 0, 60) . ")\n";
    }
};

$q('کاربران: کل | فعال در ۳۰ روز | نماینده‌ها', "SELECT COUNT(*), SUM(CAST(last_message_time AS SIGNED) > ?), SUM(agent <> 'f') FROM user", [time() - 30 * 86400]);
$q('سفارش‌ها در ۹۰ روز: وضعیت | تعداد', "SELECT Status, COUNT(*) FROM invoice WHERE CAST(time_sell AS SIGNED) > ? GROUP BY Status ORDER BY 2 DESC", [$since]);
$q('سفارش‌ها در ۹۰ روز به تفکیک پنل', "SELECT Service_location, COUNT(*) FROM invoice WHERE CAST(time_sell AS SIGNED) > ? GROUP BY 1 ORDER BY 2 DESC", [$since]);
$q('پنل‌ها: نوع | وضعیت | تعداد', "SELECT type, status, COUNT(*) FROM marzban_panel GROUP BY 1, 2");
$q('پرداخت‌ها در ۹۰ روز: روش | وضعیت | تعداد | جمع', "SELECT Payment_Method, payment_Status, COUNT(*), SUM(CAST(price AS SIGNED)) FROM Payment_report WHERE time >= ? GROUP BY 1, 2 ORDER BY 3 DESC", [$sinceStr]);
$q('کارهای دیگر روی سرویس در ۹۰ روز (تمدید، حجم، زمان …)', "SELECT type, COUNT(*) FROM service_other WHERE time >= ? GROUP BY 1 ORDER BY 2 DESC", [$sinceStr]);
$q('محصولات | دسته‌ها', "SELECT (SELECT COUNT(*) FROM product), (SELECT COUNT(*) FROM category)");
$q('ربات‌های نماینده (botsaz)', "SELECT COUNT(*) FROM botsaz");
$q('درخواست نمایندگی', "SELECT COUNT(*) FROM Requestagent");
$q('گردونه شانس', "SELECT COUNT(*) FROM wheel_list");
$q('کد هدیه مصرف‌شده | کد تخفیف فروش', "SELECT (SELECT COUNT(*) FROM Giftcodeconsumed), (SELECT COUNT(*) FROM DiscountSell)");
$q('فروش دستی (manualsell)', "SELECT status, COUNT(*) FROM manualsell GROUP BY 1");
$q('پشتیبانی: پیام‌ها | دپارتمان‌ها', "SELECT (SELECT COUNT(*) FROM support_message), (SELECT COUNT(*) FROM departman)");
$q('آموزش‌ها (help) | کانال‌های اجباری', "SELECT (SELECT COUNT(*) FROM help), (SELECT COUNT(*) FROM channels)");
$q('رفرال: لینک‌ها | ثبت‌نام‌ها', "SELECT (SELECT COUNT(*) FROM referral_links), (SELECT COUNT(*) FROM referral_signups)");
$q('پیامک‌های بانکی (sms_inbox)', "SELECT COUNT(*) FROM sms_inbox");
$q('درگاه‌ها و تنظیمات پرداخت روشن (PaySetting)', "SELECT NamePay, ValuePay FROM PaySetting WHERE ValuePay IN ('onpay','on','oncart','active','1') ORDER BY 1");
$q('حجم جدول‌های اصلی (ردیف)', "SELECT table_name, table_rows FROM information_schema.tables WHERE table_schema = DATABASE() AND table_rows > 0 ORDER BY table_rows DESC LIMIT 15");
echo "\n";
