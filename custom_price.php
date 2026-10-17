<?php
// Price of a «سرویس دلخواه» (custom volume + days), worked out from the ready plans instead of a flat
// «per GB + per day» rate. The flat rate made custom services 2-3x the price of the same ready plan.
//
//   1. The 30-day ready plans give a «GB → price» curve; longer plans (divided by the time factor below) extend it
//      past the biggest 30-day plan. Between two plans the price is interpolated; below the
//      smallest / above the largest plan the per-GB price of that plan is used (bigger = cheaper per GB, like the plans).
//   2. Time factor: how much more the longer ready plans cost than the 30-day curve, per extra month (median of the
//      plans, 0-100%). Fewer days than 30 are a little cheaper (never below 80%).
//   3. Rounded to CUSTOM_PRICE_STEP (default 5,000 toman), and never more than a ready plan that gives at least as
//      many GB and days.
// Promotions don't move it (the plans' original prices are used). storage/custom_price.json:
//   {"mode": "plans" | "flat", "step": 5000, "month_pct": null|number}  — `php scripts/custom_price.php` shows/sets it.
// "flat" (or a panel with no ready plans) falls back to the old pricecustomvolume / pricecustomtime settings.

const CUSTOM_PRICE_FILE = __DIR__ . '/storage/custom_price.json';

function customPriceConfig(): array
{
    $c = is_file(CUSTOM_PRICE_FILE) ? json_decode((string) @file_get_contents(CUSTOM_PRICE_FILE), true) : null;
    $c = is_array($c) ? $c : [];
    return [
        'mode' => ($c['mode'] ?? 'plans') === 'flat' ? 'flat' : 'plans',
        'step' => max(1, (int) ($c['step'] ?? 5000)),
        'month_pct' => isset($c['month_pct']) && is_numeric($c['month_pct']) ? max(0.0, (float) $c['month_pct']) : null,
    ];
}

function customAgentValue($json, string $agent): float
{
    $d = is_array($json) ? $json : json_decode((string) $json, true);
    return is_array($d) && isset($d[$agent]) && is_numeric($d[$agent]) ? (float) $d[$agent] : 0.0;
}

/** Ready plans [gb, days, price] of a panel for an agent (original prices during a promotion). */
function customPricePlans(PDO $pdo, string $panelName, string $agent): array
{
    $st = $pdo->prepare("SELECT id, price_product, Volume_constraint, Service_time FROM product WHERE (Location = ? OR Location = '/all') AND agent = ? AND one_buy_status = '0'");
    $st->execute([$panelName, $agent]);
    $orig = [];
    if (function_exists('promoState') && ($s = promoState())) {
        foreach ($s['items'] ?? [] as $it) {
            $orig[(int) $it['id']] = $it;
        }
    }
    $out = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $p) {
        $price = (float) $p['price_product'];
        $gb = (float) $p['Volume_constraint'];
        if (isset($orig[(int) $p['id']])) {
            $price = (float) $orig[(int) $p['id']]['old_price'];
            $gb = (float) $orig[(int) $p['id']]['old_gb'];
        }
        $days = (int) $p['Service_time'];
        if ($price > 0 && $gb > 0 && $days > 0) {
            $out[] = [$gb, $days, $price];
        }
    }
    return $out;
}

/** Piecewise-linear «GB → price» through sorted [gb, price] points; per-GB price of the end plans outside them. */
function customCurve(array $pts, float $gb): float
{
    $n = count($pts);
    if ($gb <= $pts[0][0]) {
        return $gb * $pts[0][1] / $pts[0][0];
    }
    if ($gb >= $pts[$n - 1][0]) {
        return $gb * $pts[$n - 1][1] / $pts[$n - 1][0];
    }
    for ($i = 1; $i < $n; $i++) {
        if ($gb <= $pts[$i][0]) {
            [$g0, $p0] = $pts[$i - 1];
            [$g1, $p1] = $pts[$i];
            return $p0 + ($p1 - $p0) * ($gb - $g0) / ($g1 - $g0);
        }
    }
    return $pts[$n - 1][1];
}

/** [gb, price] points, one per GB (average), sorted, price never going down as GB goes up. */
function customPoints(array $raw): array
{
    $by = [];
    foreach ($raw as [$gb, $price]) {
        $by[(string) $gb][] = $price;
    }
    $pts = [];
    foreach ($by as $gb => $ps) {
        $pts[] = [(float) $gb, array_sum($ps) / count($ps)];
    }
    usort($pts, fn($a, $b) => $a[0] <=> $b[0]);
    for ($i = 1; $i < count($pts); $i++) {
        $pts[$i][1] = max($pts[$i][1], $pts[$i - 1][1]);
    }
    return $pts;
}

function customMedian(array $v): float
{
    sort($v);
    $n = count($v);
    return $n % 2 ? $v[intdiv($n, 2)] : ($v[$n / 2 - 1] + $v[$n / 2]) / 2;
}

/** The model built from the plans: ['base' => days, 'month' => extra share per 30 days, 'points' => 30-day curve]. */
function customPriceModel(array $plans, ?float $monthPct = null): ?array
{
    if (!$plans) {
        return null;
    }
    $daysCount = array_count_values(array_map(fn($p) => $p[1], $plans));
    arsort($daysCount);
    $base = isset($daysCount[30]) ? 30 : (int) array_key_first($daysCount);
    $basePts = customPoints(array_map(fn($p) => [$p[0], $p[2]], array_filter($plans, fn($p) => $p[1] === $base)));
    if ($monthPct !== null) {
        $month = $monthPct / 100;
    } else {
        // learnt from longer plans whose volume lies inside the base plans' range (outside it the curve is a guess)
        $rates = $all = [];
        foreach ($plans as [$gb, $days, $price]) {
            if ($days > $base) {
                $r = ($price / customCurve($basePts, $gb) - 1) / (($days - $base) / 30);
                $all[] = $r;
                if ($gb >= $basePts[0][0] && $gb <= $basePts[count($basePts) - 1][0]) {
                    $rates[] = $r;
                }
            }
        }
        $rates = $rates ?: $all;
        $month = $rates ? min(1.0, max(0.0, customMedian($rates))) : 0.10; // no longer plans: +10% a month
    }
    $model = ['base' => $base, 'month' => $month, 'points' => []];
    // the base-duration plans are the curve; longer/shorter plans (turned into base-duration prices) only extend it
    // below the smallest / above the largest base plan
    $lo = $basePts[0][0];
    $hi = $basePts[count($basePts) - 1][0];
    $pts = array_map(fn($p) => [$p[0], $p[2]], array_filter($plans, fn($p) => $p[1] === $base));
    foreach ($plans as [$gb, $days, $price]) {
        if ($days !== $base && ($gb < $lo || $gb > $hi)) {
            $pts[] = [$gb, $price / customTimeFactor($model, $days)];
        }
    }
    $model['points'] = customPoints($pts);
    $model['plans'] = $plans;
    return $model;
}

function customTimeFactor(array $model, int $days): float
{
    return max(0.8, 1 + $model['month'] * ($days - $model['base']) / 30);
}

/** Final price from the model, rounded and capped by any ready plan that gives as much or more. */
function customModelPrice(array $model, float $gb, int $days, int $step): int
{
    $price = customCurve($model['points'], $gb) * customTimeFactor($model, $days);
    $price = (int) max($step, round($price / $step) * $step);
    foreach ($model['plans'] as [$pg, $pd, $pp]) {
        if ($pg >= $gb && $pd >= $days && $pp < $price) {
            $price = (int) $pp;
        }
    }
    return $price;
}

/** Cached model of a panel + agent (null: no ready plans / flat mode). */
function customPanelModel(array $panel, string $agent): ?array
{
    static $cache = [];
    global $pdo;
    $cfg = customPriceConfig();
    if ($cfg['mode'] === 'flat' || !($pdo instanceof PDO) || empty($panel['name_panel'])) {
        return null;
    }
    $k = $panel['name_panel'] . "\0" . $agent;
    if (!array_key_exists($k, $cache)) {
        try {
            $cache[$k] = customPriceModel(customPricePlans($pdo, (string) $panel['name_panel'], $agent), $cfg['month_pct']);
        } catch (Throwable $e) {
            error_log('custom price: ' . $e->getMessage());
            $cache[$k] = null;
        }
    }
    return $cache[$k];
}

/** Price of a custom service of $gb GB for $days days on $panel (a marzban_panel row) for $agent. */
function customPlanPrice($panel, $agent, $gb, $days): int
{
    $panel = is_array($panel) ? $panel : [];
    $agent = (string) ($agent ?: 'f');
    $gb = max(0.0, (float) $gb);
    $days = max(0, (int) $days);
    $model = customPanelModel($panel, $agent);
    if ($model) {
        return customModelPrice($model, $gb, $days, customPriceConfig()['step']);
    }
    return (int) round($gb * customAgentValue($panel['pricecustomvolume'] ?? null, $agent) + $days * customAgentValue($panel['pricecustomtime'] ?? null, $agent));
}

/**
 * Bot prompt text: in «plans» mode the line with the per-GB / per-day rate (the first %s) is replaced by a short
 * explanation with example prices; the other placeholders (min / max) stay. Flat mode: the text is unchanged.
 */
function customPricePrompt(string $fmt, $panel, $agent, string $kind, $flatValue, ...$rest): string
{
    $model = customPanelModel(is_array($panel) ? $panel : [], (string) ($agent ?: 'f'));
    if (!$model) {
        return vsprintf($fmt, array_merge([$flatValue], $rest));
    }
    $step = customPriceConfig()['step'];
    if ($kind === 'volume') {
        $ex = [];
        foreach ([10, 25, 50, 100] as $g) {
            $ex[] = $g . ' گیگ ' . number_format(customModelPrice($model, $g, $model['base'], $step));
        }
        $hint = 'قیمت مطابق تعرفه پلن‌ها (' . $model['base'] . ' روزه): ' . implode(' | ', $ex) . ' تومان';
    } else {
        $hint = $model['month'] > 0
            ? 'هر ماه بیشتر از ' . $model['base'] . ' روز، حدود ' . round($model['month'] * 100) . '٪ به قیمت اضافه می‌شود؛ قیمت نهایی در پیش‌فاکتور'
            : 'قیمت نهایی در پیش‌فاکتور نمایش داده می‌شود';
    }
    $lines = explode("\n", $fmt);
    foreach ($lines as $i => $line) {
        if (strpos($line, '%s') !== false) {
            preg_match('/^[^\p{L}\p{N}%]*/u', $line, $m);
            $lines[$i] = rtrim($m[0] ?? '') . ' ' . str_replace('%', '%%', $hint);
            break;
        }
    }
    return vsprintf(implode("\n", $lines), $rest);
}
