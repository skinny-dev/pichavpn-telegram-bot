<?php
// Customer-facing subscription page (opened in a browser). Pure functions: no database, no network.

/** Browsers get the page, VPN apps keep getting the raw subscription. ?raw=1 forces raw, ?view=1 forces the page. */
function subscriptionWantsHtml(string $accept, string $userAgent, array $query = []): bool
{
    if (!empty($query['raw'])) {
        return false;
    }
    if (!empty($query['view'])) {
        return true;
    }
    if (stripos($accept, 'text/html') === false) {
        return false;
    }
    return !preg_match('/v2ray|hiddify|streisand|shadowrocket|clash|sing-?box|nekobox|nekoray|happ|v2box|foxray|quantumult|surge|loon|stash|karing|flclash|mihomo|okhttp|dalvik|cfnetwork|curl|wget|python|go-http/i', $userAgent);
}

function subPageBytes($b): string
{
    $b = (float) $b;
    foreach (['بایت', 'کیلوبایت', 'مگابایت', 'گیگابایت', 'ترابایت'] as $i => $u) {
        if ($b < 1024 || $i === 4) {
            return rtrim(rtrim(number_format($b, $i >= 3 ? 2 : 0, '.', ''), '0'), '.') . ' ' . $u;
        }
        $b /= 1024;
    }
    return '';
}

/** @return array{state:string,label:string,days:?int,used:int,total:int,percent:?int,expire:int} */
function subscriptionView(array $data, ?int $now = null): array
{
    $now = $now ?? time();
    $used = max(0, (int) ($data['used_traffic'] ?? 0));
    $total = max(0, (int) ($data['data_limit'] ?? 0));
    $expire = max(0, (int) ($data['expire'] ?? 0));
    $status = strtolower((string) ($data['status'] ?? ''));
    $days = $expire > 0 ? (int) ceil(($expire - $now) / 86400) : null;
    $state = 'active';
    $label = 'فعال';
    if ($status === 'on_hold') {
        [$state, $label] = ['hold', 'در انتظار اولین اتصال'];
    } elseif ($status === 'disabled') {
        [$state, $label] = ['off', 'غیرفعال'];
    } elseif ($status === 'expired' || ($expire > 0 && $expire < $now && $status !== 'on_hold')) {
        [$state, $label] = ['end', 'منقضی‌شده'];
    } elseif ($status === 'limited' || ($total > 0 && $used >= $total)) {
        [$state, $label] = ['end', 'حجم تمام شده'];
    }
    return ['state' => $state, 'label' => $label, 'days' => $days, 'used' => $used, 'total' => $total,
        'percent' => $total > 0 ? min(100, (int) round($used / $total * 100)) : null, 'expire' => $expire];
}

function subscriptionPageHtml(array $data, array $invoice, string $subUrl, string $botUsername, string $supportId = '', ?int $now = null): string
{
    $v = subscriptionView($data, $now);
    $e = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    $name = (string) ($data['username'] ?? ($invoice['username'] ?? ''));
    $product = (string) ($invoice['name_product'] ?? '');
    $bot = ltrim($botUsername, '@');
    $botUrl = $bot !== '' && $bot[0] !== '{' ? "https://t.me/$bot" : '';
    $expireTxt = $v['expire'] > 0 ? (class_exists('IntlDateFormatter') ? $e(date('Y/m/d H:i', $v['expire'])) : $e(date('Y/m/d H:i', $v['expire']))) : 'نامحدود';
    $daysTxt = $v['days'] === null ? 'نامحدود' : ($v['days'] > 0 ? $v['days'] . ' روز' : 'تمام شده');
    $totalTxt = $v['total'] > 0 ? subPageBytes($v['total']) : 'نامحدود';
    $remainTxt = $v['total'] > 0 ? subPageBytes(max(0, $v['total'] - $v['used'])) : 'نامحدود';
    $bar = $v['percent'] === null ? '' : '<div class="bar" role="progressbar" aria-valuenow="' . $v['percent'] . '" aria-valuemin="0" aria-valuemax="100"><i style="width:' . $v['percent'] . '%"></i></div>';
    $buttons = '';
    if ($botUrl !== '') {
        $buttons .= '<a class="btn primary" href="' . $e($botUrl) . '">تمدید / خرید در ربات</a>';
    }
    if ($supportId !== '') {
        $buttons .= '<a class="btn" href="https://t.me/' . $e(ltrim($supportId, '@')) . '">پشتیبانی</a>';
    }
    $raw = $e($subUrl . (str_contains($subUrl, '?') ? '&' : '?') . 'raw=1');
    return '<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>اشتراک ' . $e($name) . '</title><style>
:root{--bg:#f4f6f8;--card:#fff;--fg:#14202b;--mut:#64748b;--line:#e2e8f0;--pri:#2563eb;--ok:#16a34a;--warn:#d97706;--bad:#dc2626}
@media (prefers-color-scheme:dark){:root{--bg:#0e141b;--card:#161f29;--fg:#e6edf3;--mut:#93a4b5;--line:#243040;--pri:#4c8dff;--ok:#3fb768;--warn:#e0a030;--bad:#ef5a5a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.7 Tahoma,Vazirmatn,system-ui,sans-serif;padding:16px}
main{max-width:480px;margin:0 auto}.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px;margin-bottom:12px}
h1{font-size:18px;margin:0 0 2px;word-break:break-all}.sub{color:var(--mut);font-size:13px}
.badge{display:inline-block;padding:2px 12px;border-radius:99px;font-size:13px;font-weight:600;margin-top:8px}
.active{background:color-mix(in srgb,var(--ok) 18%,transparent);color:var(--ok)}.hold{background:color-mix(in srgb,var(--warn) 18%,transparent);color:var(--warn)}
.end,.off{background:color-mix(in srgb,var(--bad) 16%,transparent);color:var(--bad)}
dl{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:14px 0 0}dl div{background:var(--bg);border-radius:12px;padding:10px;min-width:0}
dt{color:var(--mut);font-size:12px}dd{margin:0;font-weight:600;overflow-wrap:anywhere}
.bar{height:10px;background:var(--line);border-radius:99px;overflow:hidden;margin-top:14px}.bar i{display:block;height:100%;background:var(--pri);border-radius:99px}
.link{direction:ltr;text-align:left;background:var(--bg);border-radius:10px;padding:10px;font:12px/1.5 monospace;word-break:break-all;margin:8px 0}
.btn{display:block;text-align:center;padding:12px;border-radius:12px;border:1px solid var(--line);color:var(--fg);text-decoration:none;font-weight:600;margin-top:8px;background:var(--card);width:100%;font-family:inherit;font-size:15px;cursor:pointer}
.btn.primary{background:var(--pri);border-color:var(--pri);color:#fff}
</style></head><body><main>
<section class="card"><h1>' . $e($name) . '</h1>' . ($product !== '' ? '<div class="sub">' . $e($product) . '</div>' : '') . '<span class="badge ' . $v['state'] . '">' . $e($v['label']) . '</span>
<dl><div><dt>تاریخ انقضا</dt><dd>' . $expireTxt . '</dd></div><div><dt>مانده تا انقضا</dt><dd>' . $e($daysTxt) . '</dd></div>
<div><dt>حجم مصرف‌شده</dt><dd>' . $e(subPageBytes($v['used'])) . '</dd></div><div><dt>حجم باقی‌مانده</dt><dd>' . $e($remainTxt) . '</dd></div></dl>' . $bar .
'<div class="sub" style="margin-top:8px">حجم کل: ' . $e($totalTxt) . ($v['percent'] !== null ? ' — ' . $v['percent'] . '٪ مصرف شده' : '') . '</div></section>
<section class="card"><b>لینک اشتراک</b><div class="link" id="u">' . $e($subUrl) . '</div>
<button class="btn primary" type="button" id="c">کپی لینک</button><div class="sub" style="margin-top:8px">این لینک را در برنامه (v2rayNG، Hiddify، Streisand و …) به‌عنوان Subscription اضافه کنید.</div></section>
' . ($buttons !== '' ? '<section class="card">' . $buttons . '</section>' : '') . '
</main><script>document.getElementById("c").onclick=function(){var t=document.getElementById("u").textContent,b=this;(navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).catch(function(){var a=document.createElement("textarea");a.value=t;document.body.appendChild(a);a.select();document.execCommand("copy");a.remove()}).then(function(){b.textContent="کپی شد ✓";setTimeout(function(){b.textContent="کپی لینک"},1500)})}</script></body></html>';
}
