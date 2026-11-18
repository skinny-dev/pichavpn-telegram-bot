# Content Studio — specification (current behaviour)

The Studio is the page of the Mini App where posts for the Telegram **channel** and for the **bot's users** are written, checked, scheduled and sent.
Code: `serverless-bot/tgcloud/lib/studio.js` (logic) · `lib/panelapi/studio.js` (routes `studio_*`) · `dashboard-src/src/pages/Studio.tsx` (UI) · CLI: `endpoints/admin_report.js` tool `studio`.
Older Persian notes: `docs/STUDIO.md` (parts are outdated; this file is the reference).

## 1. Principles
1. **Nothing leaves without a person.** Everything imported or generated is a *draft*. Only a confirmed click («تأیید و زمان‌بندی», «ارسال همین الان», «تأیید و زمان‌بندی همه») or the CLI `approve` flag makes it go.
2. **Simulation is the default.** Until the mode is *live*, nothing reaches the channel or customers.
3. **The bot's users are reached only in live mode** and never in test mode.
4. **Tone and honesty rules are enforced in code** (lint, §7). A post that breaks them cannot be scheduled.
5. Every failure is shown, never swallowed: the post returns to *draft* with a note carrying Telegram's reason.

## 2. Access
Mini App user must be a row in `admin` with rule `administrator`. A `support` admin only reaches the support routes (403 on `studio_*`); anyone else gets 401.

## 3. The post
| Field | Meaning |
|---|---|
| `id` | unique string (generated if empty) |
| `title` | internal name, max 80 |
| `kind` | `greeting · tip · status · offer · product · news · trust · engage · cat` (decides the default buttons) |
| `occasion` | calendar occasion id (calendar drafts only) |
| `text` | Telegram **HTML**: `b i u s code pre blockquote blockquote expandable tg-spoiler a`; emoji become premium automatically (§11) |
| `image` | a Telegram `file_id` (what the upload button stores), a https link, or an old library name |
| `cta` | 1–4 buttons: `{key, label?, url?, code?, style?}` |
| `toChannel`, `toBot` | the two audience ticks. `audience` is derived: `both · channel · bot · admins` (neither ticked = admins only). Old posts with only `audience` still work |
| `when` | unix seconds (shown in Tehran time, UTC+3:30) |
| `status` | `draft · scheduled · sent · tested · simulated · cancelled` |
| `offerEnds` | real end of an offer (required by the rule for kind `offer`) |
| `auto` | created by the calendar seed / import |
| `note` | why a post went back to draft, or a calendar hint |
| `created`, `sentAt` | timestamps |

Storage: one kv row `studio:posts` (JSON list). Settings: `studio:mode` (`sim|test|live`), `studio:channel`, `studio:test_channel`, `config:usernamebot` (the bot name for deep links), legacy `studio:lib`.

## 4. Lifecycle
```
draft ──(approve & schedule / approve-all)──▶ scheduled ──(cron or «send now»)──▶ sent | tested | simulated
  ▲                                              │
  └────────── failure or broken rule ◀───────────┘  (note explains)           cancelled (from scheduled)
```
- Scheduling needs: no lint error and a time (`save`, `status`, and `approve_all` all enforce it; `approve_all` also refuses past times).
- The scheduled job (`studio`, every 60 s in the **lazy cron**) takes the **earliest due** scheduled post, **re-checks the rules**, and publishes **one post per run**. The lazy cron runs when the bot handles updates, so a post can be minutes late; «send now» does not wait.
- «Send now» works on a *scheduled or draft* post (never on sent/cancelled). In the composer it first saves the post as it is on screen.

## 5. Where a post goes (mode × audience)
| Mode | Channel tick | Bot tick | Neither |
|---|---|---|---|
| **sim** (default) | preview to the administrators (marked 🧪) | preview to the administrators | preview to the administrators |
| **test** | the **test channel** (`tested`) | preview to administrators — **users never** | preview |
| **live** | the **main channel** (`sent`) | broadcast to **every non-blocked user** (`sent`) | preview |

Failures: a channel send error → `draft` + a note with Telegram's reason (the bot part still runs in live mode). A bot part while another broadcast is running → `draft` + the note «ارسال همگانی هنوز در حال انجام است» (the channel part has already gone; sending again repeats it).

## 6. The message
- **Photo present:** `sendPhoto` with the text as **caption (≤ 1024 chars)**; otherwise `sendMessage` (≤ 4096), link previews off. HTML parse mode with a plain-text fallback if Telegram rejects the markup.
- **Buttons** (two per row, in the order chosen):
  - the **first button is Telegram's main colour (`primary`)** unless a colour is chosen; every button can be `primary` (blue), `success` (green), `danger` (red) or `default` (plain). `default` on the first button turns the automatic blue off;
  - label = the catalog label, or your own `label`.
- **Premium emoji** are applied by the common sender to text, captions and (if on) button icons.

## 7. Rules (lint) — errors block scheduling
Errors: empty text · starts with «سلام» (use «درود») · religious/lunar occasion words · fake urgency («فقط تا امشب», «آخرین فرصت», «فرصت محدود», «عجله کنید», «از دست ندهید», …) · childish tone · a discount number outside kind `offer` · no button · more than 4 buttons · unknown button · custom link not `https://`/`tg://` · text longer than the cap (1024 with a picture, 4096 without).
Warnings (shown, not blocking): offer without `offerEnds` · a button whose action the bot does not fully implement · a greeting for the channel without a picture.

## 8. Buttons and what they do
Channel/bot buttons are **deep links** `https://t.me/<bot>?start=ch_<post>_<key>` (≤ 64 chars). The bot maps the word to **exactly the action of typing that command**, and counts the click (`care:n:ch:<post>:<key>` in kv).
| Key | Opens | Key | Opens |
|---|---|---|---|
| `buy` · `plan` | buy menu | `extend` | renew list |
| `test` | free test | `services` | my services |
| `help` | connection guide | `wheel` | lucky wheel |
| `tariff` | price list | `ref` | referral page |
| `wallet` | wallet | `fit` · `status`* | «best server for my use» menu |
| `support` | support menu | `agent` | partnership request («درخواست همکاری») |
| `code` | copies the real code (needs `code`) | `share` | share-the-bot link |
| `link` | your https link | | |
\* `status` (server status) is not built; it opens the use-case menu and is flagged.
The plain words also work as `?start=buy`, `usertest`, `test`, `help`, `tariff`, … and are reserved so a referral campaign cannot reuse them.

## 9. Calendar and drafts
- Occasions come from `growth/calendar/` (Iranian civil, professional, tech, cat days; **no religious/lunar**). «ساخت پیش‌نویس برای مناسبت‌های ۴ ماه آینده» creates one **draft** per occasion: «درود», one sentence, default buttons of its kind, a suggested time (evening for celebrations, late morning for culture/profession; Thursday evening and Friday are moved), and a note when a real campaign decision is needed.
- Calendar drafts are listed under the calendar; the **Queue tab lists everything else** (imported or hand-written drafts, scheduled, sent) — scheduled first by time, then drafts.

## 10. Mini App
Tabs: **Calendar · Post · Queue & drafts · Settings**.
- **Composer:** title, kind (loads the kind's default buttons), audience ticks (channel / bot users), HTML text, **image picker** (upload goes to Telegram; ≤ 5 MB PNG/JPG/WEBP; the post keeps the `file_id`), buttons with a **colour picker per button**, live preview (blue/green/red shown), date and time (Tehran), live rule messages. Buttons: *Save draft · Test to myself · Approve & schedule · Send now · Delete*.
- **Queue:** per post status badge, planned time, failure note, *Send now*, *Cancel*.
- **Settings:** *Premium emoji* card («همه‌چیز را پرمیوم کن», on/off, unblock, test message) · *Import posts (JSON)* with start date/time, audience override and **approve-all** · *Send mode* (sim/test/live), channel and test channel, **channel check** (exists / bot is admin / may post).

## 11. Premium emoji
Applied centrally to every send (including the Studio's): on by default (NewsEmoji pack imported once when nothing was set up); panel button re-imports and turns on text, button icons, bottom menu and catalog labels. Telegram may silently ignore them for a bot that is not allowed; the test message says which.

## 12. Bulk import, approve-all and the CLI
- `studio_import` (≤ 50 posts): always **drafts**. Options: `startDate` + `time` (one post per day at that Tehran time, in order), `toChannel` / `toBot` override, `replace: [ids]` (overwrites **named drafts only**; scheduled or sent posts are never touched). Existing ids are skipped.
- `studio_approve_all {ids, confirm}`: schedules the listed drafts that have a **future time** and pass the rules; the rest are reported.
- CLI (no Mini App): `npx tgcloud run endpoints/admin_report '{"tool":"studio", …}'` → state (mode, channel, posts with status/time/audience, running broadcast); `import`, `startDate`, `time`, `replace`, `approve`, `toBot`/`toChannel`; `pump_broadcast`; `cancel_broadcast`.
- Ready content: `growth/content/daily_7.json` (seven daily posts), `growth/content/partner_launch.json` (partnership announcement).

## 13. Sending to the bot's users (broadcast)
One job in kv `broadcast:job` (**one at a time**): text or photo caption, the post's buttons, total of non-blocked users, `last_id`, `sent`, `failed`. The `broadcast` cron job (20 s) sends **batches of 25 users repeatedly for ~8 s per run** (thousands of users ≈ minutes). `pump_broadcast` runs ~25 s at once; `cancel_broadcast` removes a stuck job. Blocked users are skipped; failures are counted; the administrator gets a summary when it ends.

## 14. Routes (`studio_*`)
`state · save · status · delete · upload · send_now · channel_check · test · seed · settings · import · approve_all · emoji_state · emoji_apply · emoji_set · emoji_probe` (+ legacy `lib_set · lib_delete`).

## 15. Known limits
- Lazy cron: scheduled posts may be a few minutes late; use *Send now* for time-critical ones.
- All posts live in **one kv row**: two administrators saving at the same moment can overwrite each other (last write wins).
- One picture per post (no albums/video); a sent post cannot be edited or recalled from the Studio.
- No recurring posts and no click dashboard yet (clicks are counted in kv; read them with the CLI or a later report).
- `status` button is not implemented; the legacy image library is kept only for old posts.
- Times are Tehran (fixed UTC+3:30).

## 16. Tests
`test/studio_test.mjs` (rules, schedule, modes, audience, broadcast, upload, import, approve-all, CLI), `test/cta_test.mjs` (every button = its typed command), `test/emoji_test.mjs`, `test/broadcast_test.mjs`, UI: `test/panel/studio_ui.mjs`.
