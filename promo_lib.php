<?php
// Time-limited promotion on chosen products: a percent off the price, or bonus GB on the volume.
// The product rows really change (every bot path - buy, renew, invoice - uses the promo values) and the originals
// are kept in storage/promo.json. On end - from the panel, `php scripts/promo.php end`, or automatically on the first
// bot update after ends_at - every value the promotion set is put back. A value an admin changed during the
// promotion is left alone. Product NAMES are never changed (pending invoices find their product by name);
// the bot's buttons show the promotion through promoButtonLabel().

const PROMO_FILE = __DIR__ . '/storage/promo.json';

/**
 * New price after $pct % off, rounded to a round step (e.g. 1,000 / 5,000 / 10,000 toman).
 * $mode 'down' (default: never more expensive than the exact discount), 'nearest' or 'up'. Never below one step.
 */
function promoPrice(int $price, float $pct, int $step = 1000, string $mode = 'down'): int
{
    $step = max(1, $step);
    $raw = $price * (100 - $pct) / 100;
    $q = $raw / $step;
    $n = $mode === 'up' ? ceil($q) : ($mode === 'nearest' ? round($q) : floor($q));
    return (int) max($step, $n * $step);
}

/**
 * Items for the chosen products. $type 'percent' ($value = % off) or 'bonus_gb' ($value = extra GB).
 * Unlimited (0 GB) plans get no bonus; free plans get no percent.
 */
function promoBuild(PDO $pdo, array $productIds, string $type, float $value, int $roundStep = 1000, string $roundMode = 'down'): array
{
    $ids = array_values(array_unique(array_map('intval', $productIds)));
    if (!$ids || $value <= 0 || !in_array($type, ['percent', 'bonus_gb'], true) || ($type === 'percent' && $value >= 100)) {
        return [];
    }
    $st = $pdo->prepare("SELECT id, name_product, price_product, Volume_constraint, agent, category FROM product WHERE id IN (" . implode(',', array_fill(0, count($ids), '?')) . ") ORDER BY CAST(Volume_constraint AS DECIMAL(12,2)), id");
    $st->execute($ids);
    $out = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $p) {
        $price = (int) $p['price_product'];
        $gb = (float) $p['Volume_constraint'];
        $it = ['id' => (int) $p['id'], 'name' => (string) $p['name_product'], 'category' => (string) $p['category'], 'agent' => (string) ($p['agent'] ?: 'f'),
            'old_price' => $price, 'new_price' => $price, 'old_gb' => $gb, 'new_gb' => $gb];
        if ($type === 'percent') {
            if ($price <= 0) {
                continue;
            }
            $it['new_price'] = promoPrice($price, $value, $roundStep, $roundMode);
            if ($it['new_price'] >= $price) {
                continue;
            }
        } else {
            if ($gb <= 0) {
                continue;
            }
            $it['new_gb'] = $gb + $value;
        }
        $out[] = $it;
    }
    return $out;
}

function promoState(): ?array
{
    if (!is_file(PROMO_FILE)) {
        return null;
    }
    $s = json_decode((string) @file_get_contents(PROMO_FILE), true);
    return is_array($s) ? $s : null;
}

function promoNum($v): string
{
    return rtrim(rtrim(number_format((float) $v, 2, '.', ''), '0'), '.');
}

function promoStart(PDO $pdo, array $items, string $type, float $value, int $endsAt, string $title): array
{
    if (promoState()) {
        throw new RuntimeException('یک تخفیف در حال اجراست؛ اول آن را تمام کنید');
    }
    if (!$items) {
        throw new RuntimeException('هیچ محصولی انتخاب نشده یا تخفیف روی محصولات انتخابی اثری ندارد');
    }
    if ($endsAt <= time()) {
        throw new RuntimeException('زمان پایان باید در آینده باشد');
    }
    // saved first: if the update stops half way, ending the promotion still restores what was changed
    @mkdir(dirname(PROMO_FILE), 0775, true);
    file_put_contents(PROMO_FILE, json_encode(['title' => $title, 'type' => $type, 'value' => $value, 'started_at' => time(), 'ends_at' => $endsAt, 'items' => $items], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);
    $u = $pdo->prepare("UPDATE product SET price_product = ?, Volume_constraint = ? WHERE id = ?");
    foreach ($items as $it) {
        $u->execute([(string) $it['new_price'], promoNum($it['new_gb']), $it['id']]);
    }
    return $items;
}

/** Puts the original values back; returns [restored, skipped names]. */
function promoEnd(PDO $pdo): array
{
    $s = promoState();
    if (!$s) {
        return [0, []];
    }
    $restored = 0;
    $skipped = [];
    $u = $pdo->prepare("UPDATE product SET price_product = ?, Volume_constraint = ? WHERE id = ? AND CAST(price_product AS SIGNED) = ? AND CAST(Volume_constraint AS DECIMAL(12,2)) = ?");
    foreach ($s['items'] as $it) {
        $u->execute([(string) $it['old_price'], promoNum($it['old_gb']), $it['id'], (int) $it['new_price'], (float) $it['new_gb']]);
        if ($u->rowCount()) {
            $restored++;
        } else {
            $skipped[] = $it['name'];
        }
    }
    @rename(PROMO_FILE, PROMO_FILE . '.ended-' . date('Ymd-His'));
    return [$restored, $skipped];
}

/** Called on every bot update: ends an expired promotion (one is_file() when none is running). */
function promoAutoEnd(PDO $pdo): void
{
    if (!is_file(PROMO_FILE)) {
        return;
    }
    $s = promoState();
    if ($s && time() >= (int) ($s['ends_at'] ?? 0)) {
        try {
            promoEnd($pdo);
        } catch (Throwable $e) {
            error_log('promo auto end: ' . $e->getMessage());
        }
    }
}

/** Strike-through digits for a Telegram button (buttons have no formatting). */
function promoStrike(string $s): string
{
    return preg_replace('/(\S)/u', "$1\u{0336}", $s);
}

/**
 * The emoji shown on a promoted product's button. The first premium-pack emoji from the candidates wins (the premium
 * layer then turns it into the button's custom icon); plain emoji when no pack is configured.
 */
function promoEmoji(string $type): string
{
    $candidates = $type === 'percent' ? ['🏷', '🛍', '💸', '🤑', '🔖', '💰', '🔥'] : ['🎁', '🎉', '🎀', '🔥']; // /promoemoji in the bot sets 🏷 / 🎁 to the premium emoji you pick
    $map = function_exists('premiumEmojiConfig') ? (premiumEmojiConfig()['map'] ?? []) : [];
    foreach ($candidates as $e) {
        if (isset($map[$e])) {
            return $e;
        }
    }
    return $candidates[0];
}

/** A left-to-right isolate: keeps «200,000» readable inside a Persian (RTL) label. */
function promoLtr(string $s): string
{
    return "\u{2066}" . $s . "\u{2069}";
}

/** The running promotion's item for a product id (null when none / ended). Cached per request. */
function promoItem(int $productId): ?array
{
    static $byId = null;
    if ($byId === null) {
        $byId = [];
        $s = promoState();
        if ($s && time() < (int) ($s['ends_at'] ?? 0)) {
            foreach ($s['items'] as $it) {
                $byId[(int) $it['id']] = $it + ['type' => $s['type'], 'value' => $s['value']];
            }
        }
    }
    return $byId[$productId] ?? null;
}

/** Product name without a price written in it («40 گیگ — 200,000 تومان» → «40 گیگ»): during a promotion that price is wrong. */
function promoStripPrice(string $name): string
{
    $out = preg_replace('/\s*[—–\-|]?\s*[\d,٬۰-۹]{3,}\s*(?:هزار\s*)?(?:تومان|تومن)/u', '', $name);
    return trim((string) ($out ?? $name)) ?: $name;
}

/**
 * Button text of a product during a promotion, e.g. «🏷 40 گیگ — 2̶0̶0̶,̶0̶0̶0̶ 160,000 تومان» or «🎁 50 گیگ (+10 هدیه) — 144,000 تومان».
 * One emoji only (the catalog emoji is replaced), the price written in the name is replaced by the real old/new price.
 */
function promoButtonLabel(array $product, string $label): string
{
    $it = promoItem((int) ($product['id'] ?? 0));
    if (!$it) {
        return $label;
    }
    // drop the catalog emoji (⚡ ⭐ 💎 …) in front: the promotion emoji takes its place
    $label = preg_replace('/^\s*(?:(?:<tg-emoji\b[^>]*>.*?<\/tg-emoji>|\p{Extended_Pictographic}\x{FE0F}?)\s*)+/u', '', $label) ?? $label;
    $base = promoStripPrice($label);
    if ($it['type'] === 'percent') {
        return promoEmoji('percent') . ' ' . $base . ' — ' . promoLtr(promoStrike(number_format($it['old_price']))) . ' ' . promoLtr(number_format($it['new_price'])) . ' تومان';
    }
    $old = promoNum($it['old_gb']);
    $bonus = promoNum($it['new_gb'] - $it['old_gb']);
    $count = 0;
    $base = preg_replace('/(?<![\d.])' . preg_quote($old, '/') . '(\s*گیگ)/u', promoNum($it['new_gb']) . '$1 (+' . $bonus . ' هدیه)', $base, 1, $count) ?? $base;
    if (!$count) {
        $base .= ' (+' . $bonus . ' گیگ هدیه)';
    }
    return promoEmoji('bonus_gb') . ' ' . $base . ' — ' . promoLtr(number_format($it['new_price'])) . ' تومان';
}

/**
 * Pre-invoice values during a promotion: ['name' => clean name, 'price' => HTML «<s>200,000</s> 160,000»].
 * $finalPrice is what the customer will really pay (after any personal discount). null when the product is not promoted.
 */
function promoInvoiceParts(array $product, $finalPrice): ?array
{
    $it = promoItem((int) ($product['id'] ?? 0));
    if (!$it) {
        return null;
    }
    $name = promoStripPrice((string) ($product['name_product'] ?? ''));
    if ($it['type'] === 'percent') {
        return ['name' => promoEmoji('percent') . ' ' . $name, 'price' => '<s>' . number_format($it['old_price']) . '</s> ' . number_format((float) $finalPrice)];
    }
    return ['name' => promoEmoji('bonus_gb') . ' ' . $name . ' (+' . promoNum($it['new_gb'] - $it['old_gb']) . ' گیگ هدیه)', 'price' => number_format((float) $finalPrice)];
}

/**
 * Price quote: the invoice a customer saw during a promotion stays valid for PROMO_QUOTE_TTL seconds even if the
 * promotion ends before they press «تایید». Stored with the purchase/renewal state (savedata) and only ever LOWERS
 * the price / raises the volume to what the invoice showed — never the other way round.
 */
const PROMO_QUOTE_TTL = 3600;

function promoQuote(array $product): ?array
{
    $it = promoItem((int) ($product['id'] ?? 0));
    if (!$it) {
        return null;
    }
    return ['code' => (string) ($product['code_product'] ?? ''), 'price' => (int) $it['new_price'], 'gb' => (float) $it['new_gb'], 'at' => time()];
}

/** Applies a saved quote to the product row read again at confirmation time. */
function promoApplyQuote(array $product, $quote, ?int $now = null): array
{
    $now = $now ?? time();
    if (!is_array($quote) || ($quote['code'] ?? null) !== (string) ($product['code_product'] ?? '') || $now - (int) ($quote['at'] ?? 0) > PROMO_QUOTE_TTL) {
        return $product;
    }
    if ((int) $quote['price'] > 0 && (int) $quote['price'] < (int) $product['price_product']) {
        $product['price_product'] = (int) $quote['price'];
    }
    if ((float) $quote['gb'] > (float) $product['Volume_constraint']) {
        $product['Volume_constraint'] = $quote['gb'];
    }
    return $product;
}
