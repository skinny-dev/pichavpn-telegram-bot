<?php
// Panel routes for «تخفیف‌ها» (promo_lib.php does the work).
require_once __DIR__ . '/../promo_lib.php';

function picha_promo_products(PDO $pdo): array
{
    return array_map(fn($p) => [
        'id' => (int) $p['id'], 'name' => (string) $p['name_product'], 'category' => (string) ($p['category'] ?: 'بدون دسته'),
        'gb' => (float) $p['Volume_constraint'], 'days' => (int) $p['Service_time'], 'price' => (int) $p['price_product'],
        'agent' => (string) ($p['agent'] ?: 'f'), 'active' => ($p['status_product'] ?: 'active') === 'active',
    ], $pdo->query("SELECT id, name_product, category, Volume_constraint, Service_time, price_product, agent, status_product FROM product ORDER BY category, CAST(Volume_constraint AS DECIMAL(12,2)), id")->fetchAll(PDO::FETCH_ASSOC));
}

/** body: {ids[], type: percent|bonus_gb, value, round, round_mode} */
function picha_promo_items(PDO $pdo, array $b): array
{
    $round = (int) ($b['round'] ?? 1000);
    if (!in_array($round, [1, 1000, 5000, 10000, 50000], true)) {
        throw new PichaError('رند کردن نامعتبر است', 422);
    }
    $mode = in_array($b['round_mode'] ?? 'down', ['down', 'nearest', 'up'], true) ? (string) ($b['round_mode'] ?? 'down') : 'down';
    $type = ($b['type'] ?? '') === 'bonus_gb' ? 'bonus_gb' : 'percent';
    $value = (float) str_replace(['٫', '/'], '.', strtr((string) ($b['value'] ?? 0), ['۰' => '0', '۱' => '1', '۲' => '2', '۳' => '3', '۴' => '4', '۵' => '5', '۶' => '6', '۷' => '7', '۸' => '8', '۹' => '9']));
    if ($value <= 0 || ($type === 'percent' && $value >= 90)) {
        throw new PichaError($type === 'percent' ? 'درصد تخفیف باید بین ۱ تا ۸۹ باشد' : 'مقدار گیگ هدیه نامعتبر است', 422);
    }
    return [promoBuild($pdo, (array) ($b['ids'] ?? []), $type, $value, $round, $mode), $type, $value];
}

function picha_promo_route(string $route, PDO $pdo): void
{
    switch ($route) {
        case 'promo_state':
            $s = promoState();
            out(['ok' => true, 'products' => picha_promo_products($pdo), 'active' => $s && time() < (int) $s['ends_at'] ? $s : null, 'bot' => ltrim((string) ($GLOBALS['usernamebot'] ?? ''), '@')]);
        case 'promo_preview':
            [$items] = picha_promo_items($pdo, body());
            out(['ok' => true, 'items' => $items]);
        case 'promo_start':
            $b = body();
            [$items, $type, $value] = picha_promo_items($pdo, $b);
            $hours = (int) ($b['hours'] ?? 0);
            if ($hours < 1 || $hours > 24 * 31) {
                throw new PichaError('مدت تخفیف باید بین ۱ ساعت تا ۳۱ روز باشد', 422);
            }
            promoAutoEnd($pdo); // an expired one is cleared first
            try {
                promoStart($pdo, $items, $type, $value, time() + $hours * 3600, mb_substr(trim((string) ($b['title'] ?? 'تخفیف ویژه')), 0, 80) ?: 'تخفیف ویژه');
            } catch (RuntimeException $e) {
                throw new PichaError($e->getMessage(), 409);
            }
            out(['ok' => true, 'active' => promoState()]);
        case 'promo_end':
            [$n, $skipped] = promoEnd($pdo);
            out(['ok' => true, 'restored' => $n, 'skipped' => $skipped]);
    }
}
