# Picha Pay — an automatic card-to-card service, separate from the bot

Status: **proposal for approval**. Nothing in the running bot changes until you approve and the phases below are built and tested.

## 0. The idea in one paragraph
Today the «automatic card-to-card» lives inside the bot (`sms_pay.php`): the bot picks a card, adds a unique amount, reads the bank SMS and confirms. We move this into **its own small service** with a public API and signed webhooks — the same shape as Variza / Tetraminator. The bot (PHP now, Serverless later, `botsaz`, anything else) only does three things: **create an invoice, receive the «paid» webhook, inquire before delivering.** The service owns cards, deposit detection, matching, limits, alerts, and an admin screen. It runs on a real server with a real cron, so it does not suffer from the Serverless "no timer" limit, and it survives deleting the Netherlands VPS.

## 1. Decisions needed
| # | Decision | Recommendation |
|---|---|---|
| D1 | Where it runs | The PasarGuard server (Germany), next to the payment relay: it already has Apache, PHP, cron and a domain. A separate small VPS is cleaner if you want it isolated. |
| D2 | Stack | **PHP + SQLite (WAL)**: the parsers, matching and fingerprint code from `sms_pay.php` are reused, one codebase, one-command install like `pay_relay/install.sh`. |
| D3 | Name / domain | e.g. `pay.theownlypwcha.top` is the relay today; use `cc.theownlypwcha.top` for this service. |
| D4 | Only for your own bots, or also for other shops? | Own bots first. Offering it to third parties makes you a payment intermediary, which is a **legal/regulatory** question in Iran (and an account-blocking risk). I am not a lawyer; decide that before building multi-merchant features. |
| D5 | Sample texts | 2–3 masked bank notifications/SMS per source (Blu, Melli, Bale) — needed for the parsers and their tests. |

## 2. Architecture
```
 phone (SMS + notification forwarder) ──POST /ingest/{token}──►┐
 bank API (later: Jibit/Finnotech…)   ──poll───────────────────►│   PICHA PAY (one server, own DB)
 admin (manual match of a deposit)    ──panel────────────────────┤  ┌────────────────────────────────────┐
                                                                 ├─►│ ingest → parse → fingerprint/dedupe │
 your bot(s) ──POST /api/v1/invoices──────────────────────────────►│ cards pool + limits + unique amount │
            ◄──{pay_url, card, amount_to_pay, expires_at}───────────│ matcher → invoice paid             │
 customer ──opens pay_url (hosted page, polls status)───────────────│ webhook sender (retries, signed)   │
 your bot ◄──signed webhook "invoice.paid" ─────────────────────────│ alerts (silence, missed, limits)   │
 your bot ──GET /api/v1/invoices/{id} (inquiry before delivery)────►└────────────────────────────────────┘
```
- **Two ways to know «paid»**, like every good gateway: the signed webhook (fast) and the inquiry (the truth). The bot must inquire before delivering; the webhook only says *which* invoice to look at.
- **Sources are adapters.** SMS, bank-app notification, Bale bot message, a bank API: each produces the same internal `Deposit {bank, amount_rial, balance_rial, bank_time, source, raw}`. Adding a source never touches matching.
- **One engine, many callers.** Merchants (`merchant_id`) exist from day 1 even if there is only one (your bot), so a second bot or `botsaz` uses a second API key, not a second service.

## 3. API (v1)
Auth: `Authorization: Bearer <api_key>` (stored hashed). JSON in/out. Amounts are **toman** (integers), `amount_rial = toman × 10` only inside parsers.

### 3.1 Create invoice
```
POST /api/v1/invoices
{ "amount": 144000, "order_ref": "61c75db914",
  "callback_url": "https://pay.theownlypwcha.top/picha?order_id=61c75db914",   // optional; else the merchant default
  "expires_in": 3600, "description": "Wallet top-up" }
→ 201
{ "status": true, "invoice_id": "inv_8f3a1c9d2b", "order_ref": "61c75db914",
  "amount": 144000, "amount_to_pay": 144237,           // price + a unique suffix: the customer must pay exactly this
  "card": { "number": "6037-XXXX-XXXX-1234", "holder": "…", "bank": "melli" },
  "pay_url": "https://cc.theownlypwcha.top/pay/inv_8f3a1c9d2b",
  "expires_at": 1793103600 }
```
Errors: `400` bad amount (below/above limits), `401` bad key, `403` merchant disabled, `409` duplicate `order_ref` (returns the existing invoice), `429` rate limit, `503` no card has room today (the bot hides the button; see §6).

### 3.2 Inquiry (the truth)
```
GET /api/v1/invoices/inv_8f3a1c9d2b
→ { "status": true, "invoice_id": "inv_8f3a1c9d2b", "order_ref": "61c75db914",
    "payment_status": "paid",              // pending | paid | expired | review | cancelled
    "amount": 144000, "amount_to_pay": 144237, "amount_paid": 144237,
    "paid_at": 1793100123, "source": "sms" }   // sms | notification | api | manual
```
Deliver **only** when `status: true` and `payment_status: "paid"` and `amount_paid >= amount`.

### 3.3 Webhook (signed, retried)
```
POST <callback_url>
X-Picha-Timestamp: 1793100125
X-Picha-Signature: sha256=<hex of HMAC-SHA256(secret, timestamp + "." + raw_body)>
{ "event": "invoice.paid", "invoice_id": "inv_8f3a1c9d2b", "order_ref": "61c75db914",
  "amount": 144000, "amount_paid": 144237, "paid_at": 1793100123, "source": "sms", "attempt": 1 }
```
- Success = any 2xx. Retries: 1 min, 5 min, 30 min, 2 h, 12 h (then `webhook_failed` shows in the admin screen); the receiver must be idempotent (`order_ref` + `invoice_id`).
- The receiver checks the signature **and** `|now − timestamp| < 5 min`.
```php
$ok = hash_equals(hash_hmac('sha256', $ts . '.' . $raw, $secret), substr($sig, 7)) && abs(time() - (int)$ts) < 300;
```
```js
const ok = timingSafeEqual(createHmac('sha256', secret).update(ts + '.' + raw).digest(), Buffer.from(sig.slice(7), 'hex')) && Math.abs(Date.now()/1000 - ts) < 300
```

### 3.4 Ingest (from the phone / a bank adapter)
```
POST /ingest/{card_token}              // one token per card/phone; revocable
{ "source": "sms" | "notification", "app": "blu", "title": "...", "text": "..." }   // also accepts the raw forwarder body shapes the relay accepts today
→ 200 { "status": "matched" | "duplicate" | "unmatched" | "ignored" | "review" }
```

### 3.5 Admin API (admin key, also used by the screen)
`cards` (create/disable/limits/token), `deposits` (inbox: unmatched / review / matched, manual-match to an invoice), `invoices` (search, cancel), `merchants` (keys, webhook secret rotation), `health` (last deposit per source, last webhook failures).

## 4. Data model (SQLite)
```sql
merchants(id, name, api_key_hash, webhook_secret, default_callback, enabled, created_at)
cards(id, merchant_id, bank, number_masked, holder, token_hash, daily_limit, enabled,
      received_today, day, last_deposit_at, last_source)
invoices(id, public_id UNIQUE, merchant_id, order_ref, card_id, amount, amount_to_pay, status,
         expires_at, created_at, paid_at, amount_paid, source, deposit_id, callback_url,
         UNIQUE(merchant_id, order_ref))
deposits(id, fingerprint UNIQUE, card_id, bank, kind, amount_rial, balance_rial, bank_time,
         source, raw_text, status, invoice_id, received_at)        -- raw_text kept for audit, never shown to merchants
webhooks(id, invoice_id, attempt, next_at, state, http_code, error, created_at)
events(id, at, level, kind, detail_json)                           -- audit trail
```

## 5. Matching and safety rules
1. **Unique amount per card:** `amount_to_pay = amount + k`, `k` in 1..999, unique among that card's open invoices (the same idea as `smsUniqueAmount`).
2. **Match:** a deposit matches an open invoice when `amount_rial/10 == amount_to_pay`, card equal, deposit time ≥ invoice creation, invoice not expired. Exactly one candidate ⇒ paid; none ⇒ `unmatched` (kept; a later invoice created within the catch-up window can still claim it, once); more than one ⇒ impossible by rule 1, but defended anyway ⇒ `review`.
3. **Same deposit from two sources** (SMS + notification): same fingerprint `(kind, amount, balance, bank_time, bank)`; if the fingerprints differ because a source lacks balance/time, a **soft duplicate** rule applies: same card + same amount within 5 minutes of an existing deposit ⇒ `duplicate`.
4. **Balance continuity:** consecutive deposits/withdrawals on a card must satisfy `new_balance = old_balance ± amount`; a break means a transaction was missed ⇒ alert `missed_transaction` (the admin can add the missing deposit from the bank app).
5. **Silence alert:** no deposit/heartbeat from a source for N hours (default 6, only during the day) ⇒ alert «پیامک‌ها نمی‌رسد». The phone app can send a heartbeat ping every 15 minutes.
6. **Limits:** a card whose `received_today + amount_to_pay` would exceed `daily_limit` is skipped; no card with room ⇒ `503` (the bot hides the button for 10 minutes — the mechanism already exists in `gateway_pause`).
7. **Fake receipts do not exist here:** the customer never uploads anything; only a deposit seen by an ingest source (or an admin manual match, logged with the admin id) can mark an invoice paid.
8. **Replay/abuse:** ingest tokens per card, rate limits, body size limit, constant-time compares, API keys and ingest tokens stored hashed, no card number beyond the masked form in responses/logs.

## 6. How the bot uses it (integration, like Tetraminator)
- New gateway `picha_pay` in both bots: `create` → store `invoice_id` in `Payment_report.dec_not_confirmed`; callback arrives at the relay (`/picha`) and is verified by **inquiry**; the «پرداخت کردم» button inquires immediately; the lazy cron inquires the newest open orders (same pattern as `tetraReconcile`).
- Button label stays «کارت به کارت (خودکار)»; the in-bot SMS path is switched off once Picha Pay is live (the old code stays for one release as a fallback).
- `503 no card with room` → the existing `gatewayPause` hides the button for 10 minutes.

## 7. Hosted payment page (what the customer sees)
Card number (copy button), **the exact amount** (copy button, big), a countdown to `expires_at`, the bank name, a "I paid" button that just re-polls, and the status turning green by itself. Persian, RTL, mobile first, no login. After payment it shows «پرداخت ثبت شد، به ربات برگردید» with a button back to the bot.

## 8. Phases
| Phase | Content | Done when (tested) |
|---|---|---|
| 1 | Core: tables, merchants/cards, create/inquiry, ingest + parsers (Blu, Melli from your samples), matching, unique amount, webhook sender with retries, expiry cron, CLI admin (`picha-pay cards add …`) | tests: a real-format SMS pays the right invoice once; replay/duplicate/other-amount/expired cases; webhook signature + retry schedule verified against a mock bot |
| 2 | Bot integration (PHP + JS), hosted payment page | an order is paid end to end through the relay on a staging card |
| 3 | Hardening: notification source, soft-duplicate, balance continuity, silence alerts, card pool + limits | injected missed-SMS scenario raises the alert; limits skip a full card |
| 4 | Admin screen (deposit inbox, manual match, cards, health) and API docs | a deposit that matched nothing is matched by hand from the screen; logged |
| 5 | (only if D4 = yes) multi-merchant isolation tests, per-merchant limits, docs site | merchant A can never see merchant B's invoices or cards |

## 9. Risks I want you to see now
- **Banks:** daily receive limits and account blocking are real; the card pool and limits reduce the chance, they do not remove it. Keep one non-card gateway (Tetraminator or Variza) as the fallback.
- **Phone:** one weak point; silence alerts and balance continuity detect failure, they do not prevent it. A second phone with the same SIM is not possible; a second source (notification, bank API) is the real redundancy.
- **Legal:** see D4.
