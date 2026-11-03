<?php
/*
 * Tetraminator payment gateway (tetraminator.com, API v1).
 *
 *   POST {base}/invoice/create          {"price": toman (>= 50000), "callback_url": "..."}  -> {status, pay_id, payment_link}   (201)
 *   GET  {callback_url}                 sent by Tetraminator after a payment, with NO body and NO signature
 *   GET  {base}/payment/inquiry/{pay_id}                                                     -> {status, payment_status, pay_id, amount}
 *
 * The callback cannot be authenticated, so it is only a hint: the customer's order is looked up by OUR order id and the
 * money is credited only when the inquiry (made with our API key, for the pay_id WE stored) says status=true,
 * payment_status=paid and amount >= the billed price. A forged callback can at most trigger one inquiry.
 *
 * Settings (PaySetting): tetraminator_status (ontetraminator/offtetraminator), tetraminator_api_key, minbalancetetraminator,
 * maxbalancetetraminator, chashbacktetraminator, helptetraminator; tetraminator_base_url overrides the API address (tests).
 * Set them with  php scripts/tetra_setup.php  (the key is typed into a hidden prompt, never stored in the repository).
 */
if (!function_exists('tetraminatorBaseUrl')) {
    function tetraminatorBaseUrl(): string
    {
        $o = trim((string) getPaySettingValue('tetraminator_base_url', ''));
        return rtrim($o !== '' && $o !== '0' ? $o : 'https://api.tetraminator.com/v1', '/');
    }

    function tetraminatorApiKey(): string
    {
        $k = trim((string) getPaySettingValue('tetraminator_api_key', ''));
        return $k === '0' ? '' : $k;
    }

    /** one HTTP call; never throws. ['http' => int (0 = no answer), 'data' => array|null, 'error' => string] */
    function tetraminatorCall(string $method, string $path, ?array $json = null): array
    {
        $key = tetraminatorApiKey();
        if ($key === '') {
            return ['http' => 0, 'data' => null, 'error' => 'tetraminator_api_key not set'];
        }
        $headers = ['Accept: application/json', 'X-API-KEY: ' . $key];
        $opts = [
            CURLOPT_URL => tetraminatorBaseUrl() . $path,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => 25,
            CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1,
            CURLOPT_CUSTOMREQUEST => $method,
        ];
        if ($json !== null) {
            $headers[] = 'Content-Type: application/json';
            $opts[CURLOPT_POSTFIELDS] = json_encode($json, JSON_UNESCAPED_UNICODE);
        }
        $opts[CURLOPT_HTTPHEADER] = $headers;
        $curl = curl_init();
        curl_setopt_array($curl, $opts);
        $res = curl_exec($curl);
        if ($res === false) {
            $err = curl_error($curl);
            curl_close($curl);
            return ['http' => 0, 'data' => null, 'error' => 'curl: ' . $err];
        }
        $http = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
        curl_close($curl);
        $data = json_decode((string) $res, true);
        return ['http' => $http, 'data' => is_array($data) ? $data : null, 'error' => is_array($data) ? '' : 'invalid json'];
    }

    function tetraminatorPause(int $seconds): void
    {
        if (!defined('TETRAMINATOR_NO_SLEEP')) {
            sleep($seconds);
        }
    }

    /**
     * New invoice for the order $order_id. On success ['pay_id' => ..., 'pay_url' => ...], otherwise ['error' => ..., 'http_code' => ...].
     * A short hiccup (timeout, 5xx, 429) is tried up to 3 times; 400 / 401 / 403 are final.
     */
    function createPayTetraminator($price, $order_id): array
    {
        global $domainhosts;
        $callback = 'https://' . $domainhosts . '/payment/tetraminator_webhook.php?order_id=' . rawurlencode((string) $order_id);
        $res = [];
        for ($try = 1; $try <= 3; $try++) {
            $r = tetraminatorCall('POST', '/invoice/create', ['price' => (int) $price, 'callback_url' => $callback]);
            $d = $r['data'] ?? [];
            if ($r['http'] >= 200 && $r['http'] < 300 && !empty($d['status']) && !empty($d['pay_id']) && !empty($d['payment_link'])) {
                return ['pay_id' => (string) $d['pay_id'], 'pay_url' => (string) $d['payment_link']];
            }
            $res = ['error' => $r['error'] !== '' ? $r['error'] : 'http ' . $r['http'], 'http_code' => $r['http'], 'message' => (string) ($d['message'] ?? '')];
            if (in_array($r['http'], [400, 401, 403], true) || $r['error'] === 'tetraminator_api_key not set') {
                break;
            }
            if ($try < 3) {
                error_log("createPayTetraminator try $try failed: " . $res['error']);
                tetraminatorPause($try);
            }
        }
        return $res;
    }

    /** ['ok' => answered properly, 'paid' => really paid, 'amount' => toman, 'payment_status' => string, 'error' => string] */
    function tetraminatorInquiry(string $payId): array
    {
        $r = tetraminatorCall('GET', '/payment/inquiry/' . rawurlencode($payId));
        $d = $r['data'];
        if ($r['http'] !== 200 || !is_array($d)) {
            return ['ok' => false, 'paid' => false, 'amount' => 0, 'payment_status' => '', 'error' => $r['error'] !== '' ? $r['error'] : 'http ' . $r['http'], 'http_code' => $r['http']];
        }
        $sameId = !isset($d['pay_id']) || (string) $d['pay_id'] === $payId; // an answer about another payment is never accepted
        $status = (string) ($d['payment_status'] ?? '');
        return ['ok' => true, 'paid' => $sameId && !empty($d['status']) && $status === 'paid', 'amount' => (int) ($d['amount'] ?? 0), 'payment_status' => $status, 'error' => ''];
    }

    /**
     * Credit one Tetraminator order if (and only if) the gateway confirms it. $deliver($order_id) hands over the product
     * (DirectPayment). Safe to call any number of times and from several places at once: the paid-flag is claimed with a
     * single UPDATE, so the product is delivered once. Result keys: paid | already | unpaid | amount_mismatch | error | delivery_failed.
     */
    function tetraminatorSettle(PDO $pdo, array $payment, callable $deliver): array
    {
        if (($payment['Payment_Method'] ?? '') !== 'tetraminator') {
            return ['result' => 'error', 'error' => 'not a tetraminator order'];
        }
        $orderId = (string) $payment['id_order'];
        if (($payment['payment_Status'] ?? '') === 'paid') {
            return ['result' => 'already'];
        }
        $payId = trim((string) ($payment['dec_not_confirmed'] ?? ''));
        if ($payId === '') {
            return ['result' => 'error', 'error' => 'order has no pay_id'];
        }
        $inq = tetraminatorInquiry($payId);
        if (!$inq['ok']) {
            return ['result' => 'error', 'error' => $inq['error']];
        }
        if (!$inq['paid']) {
            return ['result' => 'unpaid', 'payment_status' => $inq['payment_status']];
        }
        $billed = (int) $payment['price'];
        if ($inq['amount'] < $billed) {
            return ['result' => 'amount_mismatch', 'amount' => $inq['amount'], 'billed' => $billed];
        }
        $before = (string) ($payment['payment_Status'] ?? '');
        $claim = $pdo->prepare("UPDATE Payment_report SET payment_Status = 'paid' WHERE id_order = ? AND payment_Status <> 'paid'");
        $claim->execute([$orderId]);
        if (function_exists('clearSelectCache')) {
            clearSelectCache('Payment_report');
        }
        if ($claim->rowCount() < 1) {
            return ['result' => 'already'];
        }
        $info = ['before' => $before, 'billed' => $billed, 'pay_id' => $payId, 'order_id' => $orderId];
        try {
            $deliver($orderId);
        } catch (Throwable $e) {
            error_log("tetraminator: delivery failed for {$orderId}: " . $e->getMessage());
            return ['result' => 'delivery_failed', 'error' => $e->getMessage()] + $info;
        }
        return ['result' => 'paid'] + $info;
    }

    /** cashback and the report-group notice after a successful settle (needs the bot's helpers: select, update, sendmessage, telegram) */
    function tetraminatorAfterPaid(array $payment, array $res, array $textbotlang): void
    {
        $billed = (int) $res['billed'];
        $cashback = intval(getPaySettingValue('chashbacktetraminator', '0'));
        $buyer = select("user", "*", "id", $payment['id_user'], "select");
        if ($cashback > 0 && $buyer) {
            $reward = intval($billed * $cashback / 100);
            if ($reward > 0) {
                update("user", "Balance", intval($buyer['Balance']) + $reward, "id", $payment['id_user']);
                sendmessage($payment['id_user'], sprintf($textbotlang['paymentGateway']['giftReport'], $reward), null, 'HTML');
            }
        }
        $setting = select("setting", "*");
        $topic = select("topicid", "idreport", "report", "paymentreport", "select")['idreport'] ?? null;
        if (empty($setting['Channel_Report']) || !$topic) {
            return;
        }
        $tpl = $textbotlang['paymentGateway']['reportTetraminator'] ?? "💵 پرداخت جدید\n- 👤 نام کاربری کاربر : @%s\n- 🆔 آیدی عددی کاربر : %s\n- 💸 مبلغ تراکنش %s\n- 🧾 شماره سفارش : %s\n- 🔗 شناسه پرداخت : %s\n- 💳 روش پرداخت : تترامینیتور";
        $send = function (string $text) use ($setting, $topic) {
            telegram('sendmessage', ['chat_id' => $setting['Channel_Report'], 'message_thread_id' => $topic, 'text' => $text, 'parse_mode' => 'HTML']);
        };
        $send(sprintf($tpl, $buyer['username'] ?? '-', $payment['id_user'], number_format($billed), $res['order_id'], $res['pay_id']));
        if ($res['before'] === 'waiting') {
            $send("✅ تترامینیتور خودکار تأیید کرد؛ رسید دستی سفارش <code>{$res['order_id']}</code> دیگر نیاز به بررسی ندارد (سرویس فعال شد).");
        } elseif ($res['before'] === 'reject') {
            $send("⚠️ تترامینیتور پرداختی را تأیید کرد که قبلاً رد شده بود؛ مبلغ " . number_format($billed) . " تومان برای کاربر <code>{$payment['id_user']}</code> اعمال شد.\n🧾 سفارش: <code>{$res['order_id']}</code>");
        }
    }
}
