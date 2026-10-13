<?php
// Advertising / influencer referral links (price + "pays commission" flag). Shared by the bot and the panel API.

/** Codes that must never be taken by a campaign (existing /start keywords). */
function referralReservedCodes(): array
{
    return ['start', 'usertest', 'buy', 'help', 'admin', 'test'];
}

/** Normalises a user supplied code; returns '' if invalid. Letters, digits, _ and -, 3-40 chars, must start with a letter. */
function referralNormalizeCode($code): string
{
    $code = strtolower(trim((string) $code));
    if (!preg_match('/^[a-z][a-z0-9_-]{2,39}$/', $code) || in_array($code, referralReservedCodes(), true)) {
        return '';
    }
    return $code;
}

/** "۵۰۰,۰۰۰" / "500 000" -> 500000 (Persian and Arabic digits accepted). */
function referralMoneyInput($v): int
{
    $v = strtr((string) $v, ['۰' => '0', '۱' => '1', '۲' => '2', '۳' => '3', '۴' => '4', '۵' => '5', '۶' => '6', '۷' => '7', '۸' => '8', '۹' => '9',
        '٠' => '0', '١' => '1', '٢' => '2', '٣' => '3', '٤' => '4', '٥' => '5', '٦' => '6', '٧' => '7', '٨' => '8', '٩' => '9']);
    return (int) preg_replace('/\D/', '', $v);
}

/** Random free code like ad_k3x9q2 */
function referralGenerateCode(PDO $pdo): string
{
    $q = $pdo->prepare("SELECT COUNT(*) FROM referral_links WHERE code = ?");
    for ($i = 0; $i < 20; $i++) {
        $c = 'ad_' . substr(strtr(base64_encode(random_bytes(6)), ['+' => 'x', '/' => 'y', '=' => ''] ), 0, 6);
        $c = strtolower($c);
        $q->execute([$c]);
        if ((int) $q->fetchColumn() === 0) {
            return $c;
        }
    }
    return 'ad_' . time();
}

/**
 * Called by the bot on "/start <code>". Returns the link row when $code is an active campaign code, else null.
 * Attribution is first-touch: an already attributed user is never moved to another link.
 */
function referralCampaignAttach(PDO $pdo, $userId, $code, bool $isNewUser = true)
{
    $code = referralNormalizeCode($code);
    if ($code === '') {
        return null;
    }
    $q = $pdo->prepare("SELECT * FROM referral_links WHERE code = ? AND active = 1");
    $q->execute([$code]);
    $link = $q->fetch(PDO::FETCH_ASSOC);
    if (!$link) {
        return null;
    }
    $pdo->prepare("INSERT IGNORE INTO referral_signups (link_id, user_id, created_at) VALUES (?,?,?)")->execute([$link['id'], (string) $userId, time()]);
    return $link;
}

const REFERRAL_BAD_INVOICE = "('unpaid','expire','unsuccessful','reject')";

/** Commission percent that applies to a link row (own override, else the bot-wide affiliate percent). */
function referralPercent(array $link, $globalPercent): float
{
    if (!(int) $link['pays_commission']) {
        return 0.0;
    }
    $own = $link['commission_percent'];
    return (float) (($own !== null && $own !== '') ? $own : $globalPercent);
}

/** Pure money math for one link (all integers toman). */
function referralMoney(array $link, int $revenue, int $paidOut, $globalPercent): array
{
    $pct = referralPercent($link, $globalPercent);
    $commission = (int) round($revenue * $pct / 100);
    $cost = (int) $link['price'];
    return [
        'percent' => $pct,
        'commission' => $commission,
        'paid' => $paidOut,
        'due' => max(0, $commission - $paidOut),
        'cost' => $cost,
        'net' => $revenue - $cost - $commission,
        'roi' => ($cost + $commission) > 0 ? round(($revenue - $cost - $commission) / ($cost + $commission) * 100, 1) : null,
    ];
}

/** All links with funnel + money numbers. */
function referralOverview(PDO $pdo): array
{
    $global = (float) ($pdo->query("SELECT affiliatespercentage FROM setting LIMIT 1")->fetchColumn() ?: 0);
    $sale = "CAST(i.price_product AS SIGNED) > 0 AND LOWER(i.Status) NOT IN " . REFERRAL_BAD_INVOICE . " AND i.name_product NOT LIKE '%تست%'";
    $rows = $pdo->query("SELECT l.*,
            (SELECT COUNT(*) FROM referral_signups s WHERE s.link_id = l.id) AS signups,
            (SELECT COUNT(DISTINCT i.id_user) FROM referral_signups s JOIN invoice i ON CONVERT(i.id_user USING utf8mb4) COLLATE utf8mb4_unicode_ci = s.user_id WHERE s.link_id = l.id AND $sale) AS buyers,
            (SELECT COUNT(*) FROM referral_signups s JOIN invoice i ON CONVERT(i.id_user USING utf8mb4) COLLATE utf8mb4_unicode_ci = s.user_id WHERE s.link_id = l.id AND $sale) AS orders,
            (SELECT COALESCE(SUM(CAST(i.price_product AS SIGNED)),0) FROM referral_signups s JOIN invoice i ON CONVERT(i.id_user USING utf8mb4) COLLATE utf8mb4_unicode_ci = s.user_id WHERE s.link_id = l.id AND $sale) AS revenue,
            (SELECT COALESCE(SUM(p.amount),0) FROM referral_payouts p WHERE p.link_id = l.id) AS paid_out,
            (SELECT e.created_at FROM expenses e WHERE e.id = l.expense_id) AS expense_at
        FROM referral_links l ORDER BY l.active DESC, l.id DESC")->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as &$r) {
        $m = referralMoney($r, (int) $r['revenue'], (int) $r['paid_out'], $global);
        foreach (['id', 'signups', 'buyers', 'orders', 'revenue', 'price', 'pays_commission', 'active', 'created_at'] as $k) {
            $r[$k] = (int) $r[$k];
        }
        $r['expense_id'] = $r['expense_id'] === null ? null : (int) $r['expense_id'];
        $r['expense_at'] = $r['expense_at'] === null ? null : (int) $r['expense_at'];
        $r['ad_date'] = ($r['ad_date'] ?? null) === null ? null : (int) $r['ad_date'];
        $r['commission_percent'] = $r['commission_percent'] === null ? null : (int) $r['commission_percent'];
        $r += $m;
        unset($r['paid_out']);
    }
    return ['links' => $rows, 'global_percent' => $global];
}
