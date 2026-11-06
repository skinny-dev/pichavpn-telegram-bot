<?php
/*
 * A gateway that refuses to create links because of ITS OWN limits (Variza: «به دلیل محدودیت اشتراک فعلی، امکان ساخت لینک …»,
 * HTTP 422) is hidden from the payment menu for a while, so customers are not sent into an error again and again.
 * The pause is kept in PaySetting as «<gateway>_pause_until» (unix time); it ends by itself, and the next customer after it
 * tries the gateway again (a new refusal starts a new pause).
 */
if (!function_exists('gatewayPaused')) {
    function gatewayPaused(string $gateway): bool
    {
        return (int) getPaySettingValue($gateway . '_pause_until', 0) > time();
    }

    function gatewayPause(PDO $pdo, string $gateway, int $seconds): void
    {
        $pdo->prepare("INSERT INTO PaySetting (NamePay,ValuePay) VALUES (?,?) ON DUPLICATE KEY UPDATE ValuePay = VALUES(ValuePay)")
            ->execute([$gateway . '_pause_until', (string) (time() + $seconds)]);
        if (function_exists('clearSelectCache')) {
            clearSelectCache('PaySetting');
        }
    }

    /**
     * How long to hide a gateway after a failed «create link» answer: 0 = do not (a request problem, e.g. a wrong amount).
     * The gateway being down (no answer, timeout, 5xx such as Cloudflare 522) = 10 minutes; refused key / disabled shop (401, 403) = 30 minutes,
     * because nothing works until an admin fixes it.
     */
    function gatewayOutageSeconds($res): int
    {
        $code = is_array($res) ? (int) ($res['http_code'] ?? 0) : 0;
        if (!is_array($res) || empty($res['error'])) {
            return 0;
        }
        if ($code === 401 || $code === 403) {
            return 1800;
        }
        return ($code === 0 || $code >= 500) ? 600 : 0;
    }

    /** the answer of createPayVariza(): did Variza refuse because the account's subscription limit is reached? */
    function varizaLimitReached($res): bool
    {
        if (!is_array($res) || (int) ($res['http_code'] ?? 0) !== 422) {
            return false;
        }
        $decoded = isset($res['decoded']) && is_array($res['decoded']) ? $res['decoded'] : json_decode((string) ($res['raw'] ?? ''), true);
        $msg = is_array($decoded) ? (string) ($decoded['message'] ?? '') : '';
        return $msg !== '' && mb_strpos($msg, 'محدودیت اشتراک') !== false;
    }
}
