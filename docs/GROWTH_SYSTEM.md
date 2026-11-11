# Picha Growth & Content Automation — design, schema, workflows, examples

Status: **proposal for approval** (nothing in the running bot is changed by this document).
Examples are illustrations: every `{placeholder}` is filled from real data at generation time, and a post whose facts cannot be filled is **not created**.

---

## 0. Summary and the decisions I need from you

A marketing system that keeps itself fed from the business's own data: it notices real events (a server added, a plan created, renewals falling, a campaign working), drafts the right post with an LLM from a **verified facts pack**, puts it in an approval queue, publishes on a schedule with safety limits, and measures what it brought (leads → purchases → revenue), not just views.

Default behaviour is **approval mode**: nothing is published until an administrator approves it, and automatic mode must be switched on explicitly, per category.

| # | Decision | My recommendation |
|---|---|---|
| D1 | Which bot runs it | The **new Serverless (JS) bot**, built right after the cutover. The PHP bot is being retired; building twice doubles the work and the panel API must stay identical in both. Until then I can build and test it locally. |
| D2 | LLM | Anthropic API (`claude-sonnet-5-5` for drafts, `claude-haiku-5-5` for cheap variations / rewrites). The key is stored only in the server-side settings, never in the repo, the panel or the export. |
| D3 | Publishing channels | Give me the channel(s) (public channel, support group, any topic ids). The bot must be an admin with «post messages». |
| D4 | Language | Persian first, English optional per channel. |
| D5 | Precise scheduling | The Serverless platform has no timer: a lazy cron runs when an update arrives (minutes of delay at night). For to-the-minute posts add a 1-minute cron on a server calling `npx tgcloud run endpoints/growth_tick` (the same CLI login the import tool uses). I recommend starting with the lazy cron only. |

---

## 1. What already exists (inspection result) and is reused

| Need | Existing piece | How the growth system uses it |
|---|---|---|
| Bot, users, orders | `user`, `invoice` (Status, time_sell, Service_time, Volume), `Payment_report` | read-only source of facts and attribution |
| Revenue, funnel numbers | `stats_report.php` / `panelapi/stats.js` (`statsCollect`, `statsOverall`) | performance triggers and campaign revenue (same definitions as «آمار») |
| Time-limited discounts | `promo_lib.php` + panel «Promo» (percent off or bonus GB on chosen products, auto-end, originals restored) | the **only** way a campaign changes prices — never a separate price table |
| Referral program | `affiliates`, `referral_signups`, `referral_payouts`, `codeInvitation` | referral campaigns reuse the existing reward mechanics |
| Ad / influencer links | `referral_links` (`?start=<code>`, cost, signups) + `referralCampaignAttach()` | the tracking-link mechanism for campaigns |
| Panels / servers | `marzban_panel` (name, status, type) | the facts for «new server / new location / maintenance» |
| Per-customer reminders | cron `NoticationsService` (volume / time warnings), `status_cron` flag | lifecycle messages reuse the same opt-out flag |
| Mass messaging | `broadcast.js` / `cronbot/sendmessage.php` (batches, cancel, buy button) | private campaign sends |
| Report group + topics | `setting.Channel_Report`, `topicid` | publishing log and approval notifications |
| Mini App panel | React `dashboard-src`, `panelapi/*` (JSON-identical PHP/JS API), Serverless transport | the dashboard (new pages) |
| Lazy cron | `lib/cron.js` JOBS (one due job per update) | scheduler and trigger evaluation |

Not existing: a channel-publishing facility (only the forced-join `channels` list and the report group), an event log, content storage, an LLM client, post analytics. Those are the new parts.

**Telegram limits that shape the design (be aware, not a bug):**
- The Bot API does **not** return a channel post's **view count** to a bot. Views need MTProto (a user session) or a stats service. So "views per post" is optional (Phase 6); the metrics that matter are measured **inside our own funnel**: link clicks (deep-link starts), bot starts, leads, purchases, revenue.
- A bot that is an admin of a channel can receive reaction counts (`message_reaction_count`) and poll updates for polls it sent; these are the engagement signals available without MTProto.
- Private messages must respect: users who blocked the bot, rate limits (~30 messages/second overall, 1/second per chat), and our own opt-out list.

---

## 2. Architecture

```
                 ┌────────────────────── Admin (Mini App panel) ──────────────────────┐
                 │ Overview · Calendar · Library · Campaigns · Queue · Triggers ·     │
                 │ Analytics · Audiences · Telegram · Settings                         │
                 └───────────────▲──────────────────────────────┬──────────────────────┘
                                 │ panel API (growth.*)          │ approve / edit / schedule / publish now
  ┌───────────── EVENT SOURCES ──┴──────┐   ┌──────────────── GROWTH CORE (lib/growth/*) ──────────────┐
  │ business: server added, plan        │   │  Event bus  ──►  Trigger evaluator ──►  Content Engine   │
  │   created, promo started, panel     │──►│  (growth_events)   (rules + guardrails)   │ facts pack     │
  │   down/up                           │   │                                            │ LLM draft     │
  │ metrics: sales/renewal/referral     │   │                                            │ validate      │
  │   trends (stats functions)          │   │                                            ▼ dedupe        │
  │ lifecycle: first purchase, expiring,│   │  Campaign Engine ◄───────────────  growth_content (draft / │
  │   expired, returned, milestone      │   │  (templates, rules, promo/referral)  pending / scheduled)   │
  │ time: daily/weekly/monthly/season   │   │        │                                   │               │
  └─────────────────────────────────────┘   │        ▼                                   ▼               │
                                            │  growth_campaigns ──links──►  Publishing Engine            │
                                            │        ▲                      (rules, queue, retries, log) │
                                            └────────┼──────────────┬──────────────────┬────────────────┘
                                                     │              │                  │
                                       attribution   │   channel posts (public)   private messages (lifecycle,
                                       (start params,│   sendMessage/sendPhoto/   campaigns; opt-out, rate
                                        Payment_report)   sendPoll, edit, delete    limits, blocked users)
```

Principles:
1. **Facts first.** Content is generated from a *facts pack* assembled by code from the database (server list, product table, active promo, verified event). The LLM may only use facts in the pack; a post that mentions a number, place or speed that is not in the pack is rejected by the validator (§5).
2. **Everything is a row.** Events, drafts, queue entries, publications, campaign stats are rows; every state change is logged. Nothing is only in memory.
3. **Two separate outbound paths.** Channel publishing (public, one message to many) and private customer messaging (individual, consent and rate limits) are different modules with different rules and never share a queue.
4. **Approval by default.** `mode = approval` until an administrator enables automatic publishing per category.
5. **Channels are adapters.** `growth_channels.type` = `telegram_channel | telegram_group | telegram_private`. A later `instagram`/`email` adapter implements the same two functions: `publish(content)` and `edit/delete(ref)`.
6. **Secrets stay server-side.** The LLM key and any channel credentials live in server settings that the data export and the panel API never return (same rule as the payment relay key today).

### Runtime and scheduling
- Jobs (added to the lazy cron): `growth_events` (30 s: turn new events/trends into drafts), `growth_publish` (30 s: publish due queue rows), `growth_stats` (10 min: campaign/post numbers), `growth_lifecycle` (5 min: private lifecycle sends).
- Locks: each queue row is claimed with one atomic `UPDATE … WHERE state='scheduled'` (the same pattern as the payment claim), so a post can never be published twice even if two updates run the job at once.
- Retries: failed publish → exponential backoff (1, 5, 15, 60 min), max 5 attempts, then `failed` + an alert in the report group.

---

## 3. Database schema

(New tables; the SQLite/JS schema is the same columns. All times are unix seconds; text is utf8mb4.)

```sql
-- where we can publish
CREATE TABLE growth_channels (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ckey VARCHAR(40) NOT NULL UNIQUE,           -- 'main_channel', 'support_group'
  type VARCHAR(30) NOT NULL,                   -- telegram_channel | telegram_group
  chat_id VARCHAR(40) NOT NULL, topic_id INT NULL,
  title VARCHAR(200), lang VARCHAR(5) DEFAULT 'fa',
  enabled TINYINT(1) DEFAULT 1,
  default_mode VARCHAR(12) DEFAULT 'approval'  -- approval | automatic | manual
);

-- one content item (a post draft / scheduled / published)
CREATE TABLE growth_content (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL, body MEDIUMTEXT NOT NULL, lang VARCHAR(5) DEFAULT 'fa',
  category VARCHAR(40) NOT NULL,               -- one of the 17 categories (§4.1)
  objective VARCHAR(40) NOT NULL,              -- acquire | convert | retain | refer | inform | engage | win_back
  audience VARCHAR(60) NOT NULL,               -- segment key, e.g. 'all_subscribers', 'expiring_7d'
  channel_key VARCHAR(40) NOT NULL,
  suggested_at INT NULL,                       -- suggested publication time
  cta_text VARCHAR(100), cta_kind VARCHAR(20), -- buy | renew | trial | referral | link | none
  cta_payload VARCHAR(300),
  campaign_id INT NULL, trigger_id INT NULL, event_id BIGINT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft', -- draft | pending_approval | scheduled | published | rejected
  source VARCHAR(12) NOT NULL,                 -- ai | manual | template | trigger
  facts_json MEDIUMTEXT,                       -- the verified facts the text was allowed to use
  norm_hash CHAR(40), variant_group VARCHAR(40), variant_no INT DEFAULT 1,
  media_json TEXT, buttons_json TEXT, poll_json TEXT,
  created_by VARCHAR(40), approved_by VARCHAR(40), approved_at INT NULL, reject_reason VARCHAR(300),
  created_at INT NOT NULL, updated_at INT NOT NULL,
  KEY (status), KEY (category), KEY (campaign_id), KEY (norm_hash)
);

-- what will be / was published and when
CREATE TABLE growth_queue (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  content_id BIGINT NOT NULL, channel_key VARCHAR(40) NOT NULL,
  scheduled_at INT NOT NULL,
  state VARCHAR(16) NOT NULL DEFAULT 'scheduled', -- scheduled | publishing | published | failed | cancelled
  attempts INT DEFAULT 0, next_attempt_at INT NULL, error VARCHAR(300),
  message_id BIGINT NULL, published_at INT NULL, priority INT DEFAULT 0, emergency TINYINT(1) DEFAULT 0,
  KEY (state, scheduled_at)
);

-- every publish / edit / delete (audit)
CREATE TABLE growth_publications (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  queue_id BIGINT, content_id BIGINT, channel_key VARCHAR(40), chat_id VARCHAR(40), message_id BIGINT,
  action VARCHAR(10), ok TINYINT(1), response_json TEXT, actor VARCHAR(40), created_at INT NOT NULL
);

-- facts the business produced (the only thing triggers may fire on)
CREATE TABLE growth_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  etype VARCHAR(40) NOT NULL,                  -- server_added | location_launched | plan_created | promo_started | maintenance | outage | recovery | metric_drop | ...
  entity VARCHAR(80), payload_json TEXT,
  dedupe_key VARCHAR(120) NOT NULL UNIQUE,     -- the same real event can never create two rows
  occurred_at INT NOT NULL, status VARCHAR(12) DEFAULT 'new', -- new | used | ignored
  created_at INT NOT NULL
);

CREATE TABLE growth_triggers (
  id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(120) NOT NULL,
  ttype VARCHAR(16) NOT NULL,                  -- time | event | performance | lifecycle
  config_json TEXT NOT NULL,                   -- schedule / event type / metric + threshold / lifecycle stage
  category VARCHAR(40) NOT NULL, template_key VARCHAR(60), audience VARCHAR(60), channel_key VARCHAR(40),
  mode VARCHAR(12) DEFAULT 'approval', enabled TINYINT(1) DEFAULT 1,
  cooldown_hours INT DEFAULT 24, max_per_day INT DEFAULT 1, last_fired_at INT NULL
);

CREATE TABLE growth_templates (               -- reusable text skeletons (also used as few-shot style examples)
  id INT AUTO_INCREMENT PRIMARY KEY, tkey VARCHAR(60) UNIQUE, category VARCHAR(40), lang VARCHAR(5),
  body_template MEDIUMTEXT, required_facts_json TEXT, default_cta VARCHAR(100), notes VARCHAR(300)
);

CREATE TABLE growth_campaigns (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(40) NOT NULL UNIQUE,            -- the start-parameter token
  name VARCHAR(200) NOT NULL, ctype VARCHAR(30) NOT NULL, -- acquisition | referral | retention | promotion | win_back | seasonal
  template_key VARCHAR(60),
  status VARCHAR(12) DEFAULT 'draft',          -- draft | scheduled | active | paused | ended
  starts_at INT NOT NULL, ends_at INT NOT NULL,
  audience VARCHAR(60) NOT NULL,
  rules_json TEXT NOT NULL,                    -- {"discount_pct":15,"product_ids":[..],"reward_gb":5,"per_user_limit":1}
  budget_toman BIGINT DEFAULT 0, max_reward_gb INT DEFAULT 0,
  promo_ref VARCHAR(60) NULL,                  -- promo module reference (price changes happen there)
  referral_link_id INT NULL, cooldown_hours INT DEFAULT 72,
  created_by VARCHAR(40), created_at INT NOT NULL
);

CREATE TABLE growth_attribution (             -- first touch: this customer came from this campaign / post
  user_id VARCHAR(40) NOT NULL, campaign_id INT NOT NULL, content_id BIGINT NULL,
  touched_at INT NOT NULL, PRIMARY KEY (user_id, campaign_id)
);

CREATE TABLE growth_campaign_stats (          -- daily snapshot (computed from real rows)
  campaign_id INT, day CHAR(10), clicks INT, starts INT, leads INT, purchases INT,
  renewals INT, revenue BIGINT, reward_cost BIGINT, PRIMARY KEY (campaign_id, day)
);

CREATE TABLE growth_segments (
  id INT AUTO_INCREMENT PRIMARY KEY, skey VARCHAR(60) UNIQUE, name VARCHAR(120),
  rule_json TEXT, size_cached INT, refreshed_at INT
);

CREATE TABLE growth_optout (user_id VARCHAR(40) PRIMARY KEY, scope VARCHAR(12) DEFAULT 'marketing', at INT);
CREATE TABLE growth_private_log (             -- private messages: dedupe + rate limiting + audit
  id BIGINT AUTO_INCREMENT PRIMARY KEY, user_id VARCHAR(40), kind VARCHAR(40), dedupe_key VARCHAR(120),
  campaign_id INT NULL, state VARCHAR(12), error VARCHAR(200), at INT, UNIQUE KEY (user_id, dedupe_key)
);

-- settings live in the existing kv store (key `growth:*`): mode, max_daily, min_gap_min, quiet_hours,
-- category_limits, dup_threshold, llm_model; the LLM key is `config:llm_key` (never exported, never returned by the API)
```

### 3.1 Content categories (17)
`acquisition, product_update, server_update, speed_update, promotion, referral, education, tutorial, troubleshooting, community, poll, testimonial, renewal, win_back, seasonal, brand, status`
Each has: allowed objectives, allowed triggers, the facts it requires (below), a default CTA, and a frequency limit.

| Category | Required facts (post is not created without them) |
|---|---|
| acquisition | trial enabled in settings / active promo or first-purchase rule |
| product_update | product row created/changed (event `plan_created` / `plan_changed`) |
| server_update | `marzban_panel` row added / status change (event) |
| speed_update | **a measured number you provide or a measurement we run** — never generated |
| promotion | an **active** campaign with `ends_at` and a real discount rule |
| referral | referral reward rules from settings |
| education / tutorial / troubleshooting | none (evergreen; reviewed text only; no technical claims beyond the tutorial text itself) |
| community / poll | none |
| testimonial | a testimonial **you** supply with permission (text + optional name) |
| renewal / win_back | an active renewal / win-back campaign |
| seasonal | a calendar date + an active campaign (a season alone creates no offer) |
| brand | none |
| status | a `maintenance` / `outage` / `recovery` event |

---

## 4. Trigger and event architecture

### 4.1 Flow
```
source code (hook / detector)  ──emit──►  growth_events (dedupe_key unique)
                                              │ every 30 s
                                              ▼
                         Trigger evaluator: for each enabled trigger whose type/config matches:
                           1. guardrails: cooldown, max_per_day, quiet hours, category limit
                           2. build the facts pack (code, from the database)
                           3. Content Engine → draft (status = pending_approval | scheduled by mode)
                                              ▼
                         Publishing Engine (queue) → channel   |   lifecycle → private path
```

### 4.2 Trigger types and their real data sources

| Type | Trigger | Detector / data source (no invented events) |
|---|---|---|
| time | daily content, weekly campaign, weekend promo, monthly offer, seasonal | the scheduler's clock + the Jalali/Gregorian calendar table; a *promo* post requires an active campaign |
| event | new server / new location | diff of `marzban_panel` rows (new name/location) at each tick |
| event | new plan | `product` row inserted (id not seen before) |
| event | new feature | an administrator **adds** it in Triggers → "announce a feature" (title + text); we never guess features |
| event | maintenance / outage / recovery | panel health (the existing uptime check) + manual «announce maintenance» action; recovery fires only after a real down→up transition |
| performance | sales decline | `statsCollect` for the last 7 days vs the previous 7: revenue down more than `X%` (configurable) |
| performance | conversion decline | starts → first purchase within 24 h (from `referral_signups`/`invoice`) vs baseline |
| performance | referral activity decline | `referral_signups` per week vs trailing average |
| performance | high expiration rate | share of services in `end_of_time` in the last 7 days |
| performance | low engagement | reactions/poll votes per post (if available) below a percentile of the last 30 posts |
| performance | successful campaign | campaign conversion above the account's median → suggestion to extend or repeat (never auto-extends) |
| lifecycle (private) | new customer / first purchase | `invoice` first row for the user |
| lifecycle (private) | approaching expiry / expired | invoice `Service_time` + panel data (the existing notifications job already knows these) |
| lifecycle (private) | returning customer | user buys after ≥ 30 days without an active service |
| lifecycle (private) | referral milestone | `referral_signups` count reaches 1 / 3 / 10 |

Rules that keep it honest:
- A performance trigger **proposes**; its draft is always `pending_approval` regardless of mode (a person decides whether to react).
- A "good news" post (speed, uptime, "most popular plan") is created only from a number present in the facts pack with its source; otherwise the draft is discarded and the admin is told which fact is missing.
- Lifecycle events produce **private** messages only; public posts never contain a customer identifier, username, balance, service name or exact purchase.

### 4.3 Event row example
```json
{ "etype": "server_added", "entity": "Picha-4",
  "payload": { "panel": "Picha-4", "type": "pasarguard", "added_at": 1793000000 },
  "dedupe_key": "server_added:Picha-4:1793000000" }
```

---

## 5. Content generation workflow

```
trigger / manual request
   → 1. FACTS PACK   (code builds it)            products + prices, active campaign (dates, rules), event payload,
                                                  brand voice sheet, last 30 published titles/openers (anti-repeat)
   → 2. PROMPT       (system + facts + task)      category, objective, audience, language, length, CTA, forbidden list
   → 3. LLM          N variations (1–3)           claude-sonnet-5-5; JSON output {title, body, cta_text, hashtags?}
   → 4. VALIDATE     (code, not the model)        a) every number/date/place/name in the text ∈ facts pack
                                                   b) no forbidden claims (guaranteed speed, "unlimited", "100% uptime",
                                                      fake scarcity words without a real end date)
                                                   c) language/length/emoji count (≤ 3 + brand emoji)
                                                   d) CTA present and the link is one of ours
   → 5. DEDUPE       normalized-text hash + trigram similarity vs last 60 days ≥ threshold ⇒ regenerate once, then drop
   → 6. SAVE         growth_content (draft | pending_approval | scheduled by mode) + facts_json for audit
```

**Brand voice sheet** (editable in Settings, passed in every prompt): friendly, direct, informal-polite Persian («شما»), short paragraphs, a single CTA, no hype words, no exclamation chains, emojis only as list markers/section accents.

**Prompt skeleton** (what the LLM receives; the facts are the only allowed source):
```
You write one Telegram post for Picha VPN, in {lang}. Voice: {voice_sheet}.
Task: category={category}, objective={objective}, audience={audience}, length ≤ {max_chars} chars.
FACTS (the only facts you may state; do not add any number, place, speed, date or claim that is not here):
{facts_json}
Do not repeat these recent openings: {recent_openers}
End with exactly one call to action: {cta_text}.
Return JSON: {"title": "...", "body": "...", "cta_text": "..."}
```

**Variations:** for promotion/acquisition posts generate 2–3 variants (`variant_group`); the queue publishes one and the stats engine later reports which variant converted better (A/B by time-separated posts, not by claims).

---

## 6. Campaign workflow

```
template ──create──► DRAFT (rules, dates, audience, limits) ──validate──► SCHEDULED
   ▲                                                    │ starts_at
   │ clone / repeat                                      ▼
 report ◄── ENDED ◄── (ends_at | budget used | max reward hit | admin stop) ◄── ACTIVE ◄── PAUSED
                                  │
                             at start: price changes via the promo module; referral reward rules switched on;
                             tracking link `t.me/<bot>?start=g_<code>` created; content for the campaign generated
                             at end: promo restored automatically; stats frozen; recommendation written
```
Validation before a campaign can start: end after start; discount ≤ configured maximum; budget/max reward set; audience not empty; no overlapping *same-type* campaign inside the cooldown; **a discount must change the real price through the promo module** (so what the post says is what the bot charges).

**Budget/limits:** `max_reward_gb` and `budget_toman` are checked at every reward grant; when exhausted the campaign flips to `ended` and its posts stop.

**Attribution:** `?start=g_<code>[_<contentId>]` → on `/start` a `growth_attribution` row (first touch). A later purchase/renewal by that user within the attribution window (default 30 days) is credited to the campaign; revenue uses the same «پول دریافتی» definition as the stats.

---

## 7. Telegram integration plan

| Function | Method | Notes |
|---|---|---|
| Channel post (text/photo) | `sendMessage` / `sendPhoto`, `parse_mode=HTML`, `reply_markup` inline buttons | bot is admin; one `growth_publications` row per call |
| Poll | `sendPoll` (anonymous for channels) | results via `poll` updates for polls the bot sent |
| Edit / delete | `editMessageText`, `deleteMessage` | allowed within Telegram's limits (48 h for deleting in groups if not admin; as channel admin it is allowed) |
| Private lifecycle | `sendMessage` to the user | only if not in `growth_optout`, not blocked, ≥ 1 s between sends, daily cap per user (default 1 marketing + lifecycle unlimited but deduped) |
| Campaign links | `https://t.me/<bot>?start=g_<code>` | deep link → attribution row |
| Button clicks | callback `gc_<contentId>` (counts clicks, then answers + opens the offer) | works inside channels because the bot owns the button |
| Reactions | `message_reaction_count` update | requires the bot as channel admin; engagement numbers |
| Rate limits | token bucket: 20 channel posts/min max (we use ≪), 25 private msgs per batch (same as `/sendall`) | 429 → respect `retry_after` |
| Opt-out | `/stop_marketing` and a «توقف پیام‌های تبلیغاتی» button under every private campaign message | sets `growth_optout`; lifecycle service notices (expiry warnings) are separate and use the existing `status_cron` switch |

Channel publishing and private messaging use **different tables, jobs, limits and logs**.

---

## 8. Dashboard (Mini App panel pages)

1. **Overview** — scheduled / published today / pending approvals / active campaigns; leads, referral conversions, purchases, renewal conversions (period selector); a "needs attention" list (failed posts, campaigns near budget, empty queue for tomorrow).
2. **Content Calendar** — month/week view of the queue **plus manual scheduling** (§8.1).
3. **Content Library** — all items; filter by category/status/campaign; edit, duplicate, reject, send to approval, create variants; "generate with AI".
4. **Campaign Manager** — templates, create from template, state machine buttons, rules editor, per-campaign performance card.
5. **Publishing Queue** — ordered list with Publish now / Pause / Reschedule / Cancel, retry failed, emergency announcement button.
6. **Trigger Management** — enable/disable, thresholds, cooldowns, mode per trigger, "dry run" (shows what it *would* create now from real data).
7. **Analytics** — per post and per campaign: clicks, starts, leads, purchases, revenue, renewal conversion; best categories/times; recommendations list.
8. **Audience Segmentation** — segments (new 7 d, active, expiring 7 d, expired 30 d, no purchase, high-volume, referrers); size and sample (no personal data shown beyond counts and ids).
9. **Telegram Integration** — channels list, test post, bot permission check, opt-out count, last errors.
10. **Settings** — publishing mode (global/per category), max daily posts, min gap, quiet hours, category limits, duplicate threshold, LLM model + key status (set/unset only), brand voice sheet.

### 8.1 The manual schedule (what you asked for)
A calendar + list where you can run everything by hand, with or without the AI:
- **New item → "Write it myself"**: title/body/category/CTA/channel/buttons/poll, preview exactly as Telegram will show it, **Save as draft / Send for approval / Schedule at (date-time) / Publish now**.
- **Drag a card** to another day/time to reschedule; **right-click**: edit, duplicate, pause, cancel, publish now, open the Telegram message (after it is published).
- **Slots**: define recurring slots (e.g. Sat/Wed 20:00 main channel, Tue 12:00 poll); the system fills open slots with approved content and shows empty slots in red.
- **Pending approvals tab**: approve / edit & approve / reject with reason (the reason is fed back to the generator as a "don't do this" note).
- Everything the AI creates appears here first; **manual edits are always allowed until the moment of publication**.

Panel API (same routes in the Serverless panel API; JSON like the existing ones): `growth.overview`, `growth.calendar?from&to`, `growth.content.{list,get,create,update,delete,generate,approve,reject,duplicate}`, `growth.queue.{list,schedule,reschedule,publishNow,pause,cancel,retry}`, `growth.campaigns.{list,create,update,state,stats}`, `growth.triggers.{list,update,dryRun}`, `growth.analytics.{posts,campaigns,recommendations}`, `growth.segments.{list,preview}`, `growth.channels.{list,test}`, `growth.settings.{get,set}`.

---

## 9. Publishing rules engine

Modes (global default + per category/trigger): **automatic** (approved-by-rule content publishes at its slot), **approval** (default; waits for a person), **manual** (generates, never publishes).

Checks run in this order for every queue row at its time; a failed check delays (not drops) the post unless stated:
1. quiet hours (default 00:00–08:00 Tehran) → move to the first allowed minute (emergency bypasses)
2. maximum posts per day (default 3) and per channel
3. minimum gap (default 90 min)
4. category frequency limit (e.g. promotion ≤ 2/week, poll ≤ 2/week, status unlimited)
5. campaign cooldown (the same campaign's posts ≥ 24 h apart unless it is the end reminder)
6. duplicate check against the last 60 days (hash + similarity) → blocked and reported
7. content still valid (campaign still active, promo still running, event not older than its freshness window) → otherwise `cancelled` with the reason
**Emergency announcement:** a button creating a `status` post that skips quiet hours/limits but still logs and needs a confirm click (even in automatic mode).

---

## 10. Analytics and optimization

Metrics per post/campaign: **clicks** (button callbacks + deep-link starts), **starts**, **leads** (new users attributed), **purchases** and **revenue** attributed (window 30 d), **renewals** after a renewal campaign, **referral conversions**, reward cost, ROI = (revenue − reward cost − discount given) / spend. Optional: views/reactions where Telegram exposes them.

Recommendations are rules over history, always shown with the numbers behind them, never auto-applied:
- "Promotion posts at 20:00 convert 2.1× better than at 12:00 (n=14 vs 9)" → shift slots.
- "Educational posts bring few leads but 3× fewer expirations among readers" → keep them for retention.
- "Campaign X reached 80 % of its reward budget in 3 of 10 days" → lower the reward or extend the budget.
- "Renewal reminders sent 3 days before expiry renew 18 % vs 11 % at 1 day" → move the reminder.
The optimizer ranks by **qualified leads → purchases → revenue → retention**; views are shown but never used as the objective.

---

## 11. Examples

### 11.1 One example per category (illustrative; `{}` = filled from data)
Format: **Category · objective · audience · channel · suggested time · CTA · campaign · status** then the text.

**1 Acquisition** · acquire · new_visitors · main_channel · Sat 20:00 · «🎁 دریافت اکانت تست» (trial) · `trial_welcome` · pending_approval
> 🎁 هنوز VPN پیچا را امتحان نکرده‌اید؟
> یک اکانت تست رایگان بگیرید، خودتان سرعت و پایداری را روی گوشی‌تان ببینید و اگر راضی بودید، سرویس را بخرید.
> 👇 دریافت اکانت تست از ربات

**2 Product update** · inform · all_subscribers · main_channel · on event · «🛍 مشاهده پلن‌ها» · — · pending_approval  *(event `plan_created`: {name}, {volume}, {days}, {price})*
> 🆕 پلن جدید اضافه شد: {name}
> 📦 {volume} گیگ · ⏳ {days} روز · 💰 {price} تومان
> برای دیدن همه پلن‌ها از ربات استفاده کنید.

**3 Server & infrastructure** · inform · all_subscribers · main_channel · on event · «🔄 به‌روزرسانی اشتراک» · — · pending_approval  *(event `server_added`: {location})*
> 🌍 سرور جدید اضافه شد: {location}
> اگر اشتراک دارید، با به‌روزرسانی لینک اشتراک در برنامه، لوکیشن جدید را می‌بینید.

**4 Speed & performance** · inform · all_subscribers · main_channel · after a real measurement · «📊 جزئیات» · — · pending_approval  *(needs `{measurement}`: value, method, date — supplied by you or by a scheduled test; otherwise not created)*
> ⚡️ نتیجهٔ تست {date}: {measurement.value} روی {location} ({measurement.method}).
> نتیجهٔ هر شبکه و ساعت متفاوت است؛ این عدد فقط همین تست را نشان می‌دهد.

**5 Promotion** · convert · active_users+expired · main_channel · campaign start · «🛍 خرید با تخفیف» · `weekend_15` · scheduled (approved)  *(real discount + real end)*
> 🔥 تخفیف آخر هفته: {discount_pct}٪ روی {plan_names}
> از {starts} تا {ends}؛ بعد از این زمان قیمت‌ها به حالت قبل برمی‌گردد.
> 👇 مشاهده قیمت‌ها

**6 Referral** · refer · all_subscribers · main_channel + private · weekly · «👥 لینک دعوت من» · `invite_friend` · pending_approval
> 👥 دوستتان را دعوت کنید، حجم هدیه بگیرید
> هر دوستی که با لینک شما ثبت‌نام و خرید کند، {reward_gb} گیگ برای شما.
> لینک اختصاصی‌تان در بخش «زیرمجموعه‌گیری» ربات است.

**7 Educational** · engage · all · main_channel · Tue 12:00 · «📖 راهنمای کامل» · — · scheduled
> ❓ چرا بعضی وقت‌ها اتصال کند می‌شود؟
> ۳ کار ساده قبل از هر چیز: ۱) برنامه را به‌روز کنید ۲) لینک اشتراک را دوباره بگیرید ۳) پروتکل/لوکیشن دیگری را امتحان کنید. *(متن آموزشی را شما یک‌بار تأیید می‌کنید؛ ادعای فنی خارج از همین متن ساخته نمی‌شود.)*

**8 VPN tutorial** · retain · new_customers · main_channel · Thu 19:00 · «📲 دانلود برنامه» · — · scheduled
> 📲 نصب و اتصال در اندروید، قدم‌به‌قدم  (۱) برنامه را نصب کنید (۲) روی «لینک اشتراک» بزنید (۳) به ربات برگردید و اتصال را بزنید.

**9 Troubleshooting & support** · retain · all_subscribers · main_channel · when tickets spike · «💬 پشتیبانی» · — · pending_approval  *(trigger: ≥ N tickets with the same keyword in 24 h — real data)*
> 🛠 اگر اینترنت وصل نمی‌شود: ۱) حجم و تاریخ سرویس را از «سرویس‌های من» ببینید ۲) لینک اشتراک را به‌روز کنید. اگر حل نشد، با پشتیبانی تماس بگیرید.

**10 Community engagement** · engage · all · main_channel · Fri 21:00 · «💬 نظر شما» · — · scheduled
> 🎯 شما بیشتر برای چه کاری از VPN استفاده می‌کنید؟ کار، دانشگاه، سرگرمی، یا همه‌چیز؟ نظرتان را بنویسید.

**11 Poll / survey** · engage · all_subscribers · main_channel · Sun 20:00 · poll · — · scheduled
> 📊 کدام برایتان مهم‌تر است؟  ▫️ سرعت  ▫️ پایداری  ▫️ قیمت  ▫️ پشتیبانی سریع  *(results feed the Analytics "what customers value")*

**12 Testimonial** · acquire · new_visitors · main_channel · on approval · «🛍 خرید» · — · pending_approval  *(only a real message you supply, with permission; nothing generated)*
> «{customer_quote}» — {display_name or «مشتری پیچا»}

**13 Subscription renewal** · retain · expiring_7d · private + channel reminder · 7 d before · «🔄 تمدید سرویس» · `renew_bonus` · scheduled
> ⏳ سرویس شما تا {days_left} روز دیگر تمام می‌شود. اگر تا {deadline} تمدید کنید، {bonus_gb} گیگ هدیه می‌گیرید. 🔄 تمدید  *(the bonus exists only if the campaign is active)*

**14 Win-back** · win_back · expired_30d · private · 14 d after expiry · «🛍 بازگشت با تخفیف» · `comeback_10` · scheduled
> 👋 مدتی است ندیده‌ایمتان. برای بازگشت، {discount_pct}٪ تخفیف روی اولین خرید تا {ends}. 

**15 Seasonal** · convert · all · main_channel · {date} · «🎁 مشاهده پیشنهاد» · `yalda_special` · pending_approval  *(season + active campaign)*
> 🍉 ویژهٔ شب یلدا: {offer} تا {ends}.

**16 Brand awareness** · acquire · all · main_channel · monthly · «🌐 چرا پیچا» · — · scheduled
> پیچا؛ ساده و بدون پیچیدگی. بخریدن از ربات، تحویل خودکار، و پشتیبانی که جواب می‌دهد. 

**17 Service status & maintenance** · inform · all_subscribers · main_channel + private · on event · — · —  *(emergency-capable; text uses only the event)*
> 🛠 از {from} تا {to} سرور {location} در حال به‌روزرسانی است. اتصال ممکن است کوتاه قطع شود. ما را در همین کانال دنبال کنید.  ·  بعد از بازگشت: ✅ سرور {location} دوباره برقرار شد.

### 11.2 Trigger examples
```json
{ "name": "Announce new plan", "ttype": "event",
  "config": { "etype": "plan_created" }, "category": "product_update",
  "template_key": "plan_created", "audience": "all_subscribers", "mode": "approval", "cooldown_hours": 6 }

{ "name": "Sales decline alert → proposal", "ttype": "performance",
  "config": { "metric": "revenue_7d_vs_prev_7d", "op": "<", "value": -0.20 },
  "category": "promotion", "mode": "approval", "cooldown_hours": 168,
  "note": "creates a PROPOSAL to run weekend_15; a person decides" }

{ "name": "Expiring in 7 days", "ttype": "lifecycle",
  "config": { "stage": "expiring", "days_before": 7 }, "category": "renewal",
  "audience": "expiring_7d", "channel": "private" }

{ "name": "Weekend promo", "ttype": "time",
  "config": { "cron": "THU 18:00", "requires_active_campaign": "weekend_*" }, "category": "promotion" }
```

### 11.3 Campaign templates (reusable)
| Template | Type | Audience | Rules (editable) | Limits |
|---|---|---|---|---|
| `trial_welcome` | acquisition | new visitors | free trial shown + welcome message after first start | 1 per user |
| `first_buy_10` | acquisition | users with trial, no purchase | `discount_pct: 10` on chosen plans via promo | `max_uses`, `ends_at` |
| `welcome_series` | acquisition | new customers | 3 private messages (day 0, 2, 7) | opt-out honored |
| `invite_friend` | referral | all subscribers | reward `reward_gb: 5` per paid referral | `max_reward_gb`, per-user cap |
| `invite_3` | referral | referrers | `after_n: 3` → `reward_gb: 20` | one-time |
| `give_and_get` | referral | all | friend `discount_pct: 10`, referrer `reward_gb: 5` | budget |
| `renew_bonus` | retention | expiring_7d | renew before expiry → `bonus_gb: 5` | `ends_at`, per-user 1 |
| `comeback_10` | retention | expired_30d | `discount_pct: 10`, first purchase back | 1 per user |
| `upgrade_bigger` | retention | users on the smallest plan | upgrade offer text, no price change unless promo set | — |
| `weekend_15` | promotion | all | Thu–Fri `discount_pct: 15` (promo module) | auto-ends |
| `monthly_special` | promotion | all | one featured plan | once per month |
| `seasonal_{name}` | promotion | all | calendar date + discount | auto-ends |

### 11.4 A sample week in the calendar (approval mode, schedule you can edit by hand)
| Day | 12:00 | 20:00 |
|---|---|---|
| Sat | — | Promotion `weekend_15` (scheduled) |
| Sun | — | Poll: what matters most (scheduled) |
| Mon | Tutorial (scheduled) | — |
| Tue | Education (pending approval) | — |
| Wed | — | Referral reminder (pending approval) |
| Thu | — | Brand post (draft) |
| Fri | Community (scheduled) | **empty slot** ← shown in red |
Event posts (new server, new plan, maintenance) are inserted on the day they happen; private lifecycle messages are not on the calendar (they have their own log).

### 11.5 Private lifecycle messages (never public)
- First purchase: «✅ سرویس شما فعال شد. راهنمای اتصال: … اگر مشکلی بود همین‌جا پیام بدهید.»
- 7 days before expiry: «⏳ {days_left} روز تا پایان سرویس {service_name}. 🔄 تمدید» + a button `🔕 توقف پیام‌های تبلیغاتی`.
- Referral milestone: «🎉 دوستان شما تا الان {n} نفر شدند؛ {reward_gb} گیگ هدیه به حساب شما اضافه شد.»  *(only when the reward was really granted)*

### 11.6 Dashboard wireframes
```
OVERVIEW
┌ Scheduled 12 ┐┌ Published today 2 ┐┌ Pending approval 5 ┐┌ Active campaigns 2 ┐
┌ Leads (7d) 38 ┐┌ Referral conv. 6 ┐┌ Purchases 14 ┐┌ Renewals 9 (64 %) ┐
Needs attention: ⚠ 1 failed post · ⚠ campaign weekend_15 at 78 % of budget · ⚠ no post queued for Friday

CALENDAR   [Week ▾] [+ New item]                       ‹ 8–14 Nov ›
 Sat 8  | 20:00  🔥 Weekend promo   [scheduled]   ⋮
 Sun 9  | 20:00  📊 Poll            [scheduled]   ⋮
 Fri 14 | 12:00  — empty slot (click to add) —

QUEUE      ID  When          Category   Channel   State       Actions
           41  Sat 20:00     promotion  main      scheduled   Edit · Publish now · Pause · Cancel
           43  Tue 12:00     education  main      pending     Approve · Edit · Reject
           39  Yesterday     server     main      failed (2)  Retry · Edit
```

### 11.7 LLM call example
Input facts: `{"event":"plan_created","name":"۸۰ گیگ","volume_gb":80,"days":30,"price_toman":370000}`
Output (JSON): `{"title":"پلن ۸۰ گیگ اضافه شد","body":"🆕 پلن جدید: ۸۰ گیگ\n⏳ ۳۰ روز · 💰 ۳۷۰٬۰۰۰ تومان\nبرای دیدن همه پلن‌ها از ربات استفاده کنید.","cta_text":"🛍 مشاهده پلن‌ها"}`
Validator: every number (80, 30, 370000) is in the facts pack ✓ · no forbidden words ✓ · one CTA ✓ · not similar to the last 60 days ✓ → saved as `pending_approval`.

---

## 12. Implementation roadmap

| Phase | Content | Done when (tested) |
|---|---|---|
| 0 | Finish the Serverless cutover (current work) | bot native, payments via relay |
| 1 | Foundation: tables, settings, channels, `growth_content`/`queue`/`publications`, publish engine with the rules (§9), **manual calendar + queue + approval pages** (works with no AI) | a hand-written post scheduled from the panel is published once, at the right time, logged; quiet hours/limits/duplicates covered by tests; double-publish impossible |
| 2 | Content Engine: facts pack, LLM client, validator, dedupe, library, brand voice, variations | validator rejects a draft with an invented number/place (test set of bad drafts) |
| 3 | Events + triggers: server/plan/promo/maintenance detectors, time triggers, dry-run | each detector fires once per real event; no event ⇒ no post |
| 4 | Campaign Engine: templates, state machine, promo-module integration, tracking links, attribution, stats snapshot | a campaign changes real prices through promo and restores them; revenue attributed matches the stats definition |
| 5 | Lifecycle private path + opt-out + audience segments + **customer care follow-ups (§14)** (5a our-fault cases, 5b payments/tests, 5c renewals + reasons page) | users in opt-out never get messages; rate limits respected |
| 6 | Analytics + recommendations; optional views via MTProto/stat service | recommendation shown with its numbers; optimizer never uses views as objective |

Every phase ships with node tests (like `tetraminator_test.mjs`) and is switched on in approval mode first.

---

## 13. What I need to start Phase 1
1. D1–D5 above (esp. the runtime and the channel ids).
2. Which categories you want enabled first (suggested: promotion, product_update, server_update, education, poll, status).
3. Your brand voice in 3–5 example posts you like (I will turn them into the voice sheet).
4. The LLM key will be entered later through a hidden prompt on the server, never in chat.

---

## 14. Customer care follow-ups («مراقبت از مشتری») — problem first, never pushy

Goal: when someone started something and did not finish it (cancelled/unpaid order, expired test, service that never connected …) we **ask what happened and fix it**. Selling is a side effect of solving the problem. This is the private lifecycle path (§4.2) with stricter rules; it is added to Phase 5 and uses only data the bot already has.

### 14.1 Cases (each = one trigger, one detector, one message, at most once)
| # | Case | Detector (real data) | When | Priority |
|---|---|---|---|---|
| C1 | **Our fault: payment link failed / gateway error** the customer saw | `paymentErrorReport` / `order_failures` log, gateway-pause events | when the gateway is back (or the same hour) | highest |
| C2 | **Paid but not delivered** | `pending_watch` result `paid_undelivered` / `delivery_failed` | immediately — not a "follow-up": a human is alerted and the customer is told it is being fixed | highest |
| C3 | **Receipt rejected** by an admin | `Payment_report.payment_Status = reject` | right after, with the reason and what to do next | high |
| C4 | **Abandoned / expired payment** | `Payment_report` Unpaid/expire for a purchase or renewal with no paid order from the same user after it | 2–3 h after expiry, daytime only | normal |
| C5 | **Sold but never connected** | invoice active with panel status `on_hold` (waiting for first connection) | 12–24 h after purchase | high (helps, no sales) |
| C6 | **Test account not converted** | test invoice ended/used, no paid order | 6–24 h after the test ended | normal |
| C7 | **Service expired, not renewed** | invoice `Service_time` passed, no renewal | 2–3 days after expiry | normal |
| C8 | **Cancelled a service** | `cancel_service` row | after the decision | normal |
| C9 | **Support ticket closed** | ticket closed | 1 day later: «حل شد؟» | normal |
| C10 | **Started, never tested/bought** | `/start` only, no test, no order | 24–48 h | low |

C1–C3 are our responsibility and always go out; C4–C10 follow the rules below.

### 14.2 Rules that keep it respectful
1. **Verify before writing:** for C4 first run the pending-watch inquiry — a customer whose payment actually arrived is never asked why they did not pay (they get the service instead).
2. **One message per case, one case per week per person** (global cap `care_max_per_user_week`, default 1; C1–C3 are exempt). No second reminder, ever, for the same case.
3. **Quiet hours** 22:00–09:00 Tehran; no messages while a ticket is open or in the last 24 h after a human conversation; never after a successful purchase from the same user.
4. **First message is never a discount.** Help first. A discount may be attached only to C4/C7 if an administrator enabled it for that case, as a *second* option shown after the person says "قیمت" is the problem — never pushed.
5. **Always an exit:** every message has «🔕 دیگر پیام نده» (the same opt-out flag as the reminders) and «✅ مشکلی نبود، ممنون». Choosing either ends the case and snoozes the user for 60 days.
6. **A reply is a conversation, not a form:** any free text goes to support as a ticket with the case context attached (order id, gateway, error, service) so the agent does not ask again.
7. **Tone:** polite, short (≤ 4 lines), one question, no guilt, no urgency tricks, no "آخرین فرصت". Admin approves each template once; the LLM may only vary the wording of an approved template (facts are filled from data, §5).
8. **Circuit breaker:** if opt-outs exceed 3% of a case's sends in a week, that case pauses itself and tells the admin.
9. Blocked users are skipped silently; sends use the shared rate-limited sender (§7).

### 14.3 Messages (templates; `{}` filled from data)
**C4 abandoned payment** (buttons below)
> سلام {name} 👋
> دیدم پرداخت سفارش {product} کامل نشد. اگر موقع پرداخت مشکلی پیش آمد یا سؤالی دارید بفرمایید تا همین‌جا حلش کنیم.

Buttons: `🔗 لینک پرداخت باز نشد / مشکل در پرداخت` · `💸 پرداخت کردم ولی فعال نشد` · `🤔 نمی‌دانم کدام پلن مناسب است` · `💰 قیمت برایم زیاد بود` · `✅ فعلاً نیاز ندارم` · `🔕 دیگر پیام نده`

What each button does:
- *لینک باز نشد / مشکل پرداخت* → the bot offers the **other** payment methods that are currently healthy (gateway pause aware) with a fresh link, and opens a care ticket with the gateway and error attached.
- *پرداخت کردم ولی فعال نشد* → immediate inquiry (Tetraminator) / check of the card-to-card SMS; if found it is delivered at once, otherwise a ticket marked **urgent** is opened and an admin is alerted in the report group.
- *نمی‌دانم کدام پلن* → a two-question advisor (what for: social/streaming/gaming/work; how many devices) that recommends one plan from real products; no pressure.
- *قیمت زیاد بود* → shows the cheapest plan and the active promo if one exists; if an admin enabled it, one discount option. Reason stored.
- *فعلاً نیاز ندارم* → «باشه، هر وقت نیاز داشتید اینجا هستیم 🌱», snooze 30 days.

**C5 never connected**
> سلام {name}، سرویس شما فعال شده ولی هنوز وصل نشده‌اید. راهنمای اتصال برای گوشی/ویندوز اینجاست. اگر وصل نشد بگویید کدام برنامه و چه خطایی می‌بینید تا کمک کنیم.

Buttons: `📱 آموزش اتصال` · `❌ وصل نمی‌شود` · `✅ وصل شدم`. («وصل نمی‌شود» → ticket with the service's panel status and last-online time.)

**C6 test not converted**
> سلام {name}، تست شما تمام شد. سرعت و اتصال چطور بود؟ اگر چیزی راضی‌تان نکرد بگویید تا درستش کنیم.

Buttons: `👍 خوب بود` (→ plan list) · `🐢 کند بود` · `❌ وصل نمی‌شد` · `📶 روی اینترنت من خوب نبود` · `🔕 دیگر پیام نده`. Answers go to the "reasons" report; «کند بود / وصل نمی‌شد» open a ticket.

**C7 expired, not renewed**
> سلام {name}، سرویس {service} چند روز پیش تمام شد. اگر تمدید مشکلی داشت یا می‌خواهید چیزی را تغییر دهید، پیام بدهید. تمدید یک دکمه است:

Buttons: `🔄 تمدید` · `🔁 تغییر پلن` · `🙋 مشکلی داشتم` · `✅ فعلاً نیاز ندارم` · `🔕`.

**C8 cancelled a service** — «متأسفیم که می‌روید. اگر مشکل فنی یا قیمت بود بگویید» + reasons: `کند بود` · `قطع می‌شد` · `گران بود` · `دیگر نیاز ندارم` · `سرویس بهتری پیدا کردم`.

**C9 ticket closed** — «مشکل شما حل شد؟» `✅ بله` / `❌ هنوز نه` (reopens the ticket).

**C1 / C3** are plain apologies/explanations with the next step (new link / why the receipt was rejected and how to resend).

### 14.4 Data (added to §3)
```sql
growth_care_cases(
  id INT AUTO_INCREMENT PRIMARY KEY, user_id BIGINT, case_type VARCHAR(8),   -- C1..C10
  ref VARCHAR(40),                      -- order id / invoice id / ticket id
  state VARCHAR(16),                    -- queued | sent | answered | resolved | snoozed | opted_out | skipped
  skip_reason VARCHAR(40),              -- paid_meanwhile | quiet | cap | blocked | optout ...
  reason VARCHAR(40), ticket_id INT NULL,
  sent_at INT, answered_at INT, resolved_at INT, purchased_within_48h TINYINT,
  UNIQUE KEY (user_id, case_type, ref)  -- one message per case, ever
)
```
Reuses: `Payment_report`, `invoice`, `cancel_service`, `support_message`, `pending_watch` results, the broadcast sender, the opt-out flag, gateway pause.

### 14.5 What you see (panel page «مراقبت از مشتری»)
- This week: cases found / sent / answered / resolved / opt-outs; per case.
- **Reasons ranking** («چرا پرداخت نکردند / چرا نرفتند»): e.g. link did not open 14, price 9, don't know the plan 6 — each with the people, so a repeated technical reason becomes a bug to fix (for example, one gateway failing).
- Open care tickets (urgent first) with the context attached.
- Recovered: purchases within 48 h of a message (counted, not used to push harder).
- Per-case switches (on/off), approval of templates, the weekly cap and quiet hours.

### 14.6 Phasing and tests
Runs on the Serverless bot's lazy cron (follow-ups are not minute-critical). Phase 5a: C1–C3 (our fault) + opt-out + cap; 5b: C4–C6; 5c: C7–C10 and the reasons page. Tests: no message to someone whose payment arrived; the cap and quiet hours hold; one message per case under repeated runs; opt-out/snooze respected; each button leads to the described action (ticket opened with context / inquiry run / other gateways offered); the circuit breaker pauses a case.
