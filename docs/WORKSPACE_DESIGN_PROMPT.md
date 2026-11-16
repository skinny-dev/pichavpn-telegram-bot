# پرامپت طراحی: «فضای کار» پیچا (داشبورد + عامل‌ها در یک قاب)

برای ابزار طراحی (Stitch، Figma Make، Claude/ChatGPT با خروجی HTML و غیره). متن انگلیسی است چون ابزارها بهتر می‌فهمند؛ محتوای نمایشی فارسی خواسته شده. یک ماکت مرجع هم هست: `workspace-mock.png` (در گفتگو فرستاده شد).

```
Design a high-fidelity, RTL, Persian-language admin WORKSPACE for "Picha" — a small VPN shop sold through a Telegram bot. The product is a Telegram Mini App (mobile first, also used on desktop). It merges two things that are usually separate: a full business DASHBOARD (orders, subscriptions, accounting, content calendar, events/discounts, partners, payment gateways) and a team of AI AGENTS that work on that same data and PROPOSE actions for a human to approve.

CORE IDEA
One left-to-right-mirrored (i.e. RIGHT-side, because the UI is RTL) sidebar is the navigation for BOTH dashboards and agents. The centre area shows DATA and/or CHAT for whatever is selected. A segmented switch at the top of the centre area toggles: «داده» (data) | «گفتگو» (chat) | «هر دو» (both, side by side on desktop). Selecting an agent such as «حسابداری» shows that agent's data lens (finance numbers, payments needing review) and its chat. Chat messages are live cards, not plain text: they can contain a tool-call chip, a Persian answer, a PROPOSAL card with Approve / Reject / "show in data", handoff chips between agents, and alert cards. "Show in data" jumps to and highlights the exact row in the data view.

USERS AND TONE
One owner/administrator (and a support person), Persian speakers, working fast, often on a phone. Calm, trustworthy, precise — a finance-grade tool with a little warmth. All visible text Persian; Persian digits; short labels. Customer-facing text samples start with «درود» (never «سلام»), thanks «سپاسگزارم». No childish humour, no hype, no fake urgency or fake scarcity anywhere in the UI or in sample copy. No religious/lunar-calendar content.

PRINCIPLES (design these into the UI, they are the product's rules)
1 Agents PROPOSE, humans APPLY. Anything touching money, prices, a customer's service or a payment gateway is always a pending proposal with a risk level (low / medium / high) and evidence (links to the tool results). Never an auto-action.
2 SIMULATION is the default. A global mode badge «شبیه‌سازی» / «تست» / «زنده» is always visible; the colour and wording make "live" unmistakable. Switching to live needs a confirmation.
3 Autonomy per agent, three levels: «همیشه بپرس» (default and the only option for money/prices), «کم‌ریسک را خودکار انجام بده» (e.g. save drafts, never send), «فقط گزارش». Do NOT design a "bypass all" switch.
4 Everything is auditable: each agent action and each human decision appears in an audit drawer with time, actor, result.
5 Rule-aware: the system refuses proposals that break the house rules (fake urgency, discount above 20%, two offers within 30 days, price increase without 7 days' notice, margin below 10%). Show a "refused by rule" state with the reason and the agent's rewrite.

LAYOUT (desktop 1440×900, RTL)
• Right sidebar, ~318 px, soft light panel with rounded 26 px corners and 14 px gaps, like a floating card. Top row: search pill, command (⌘) pill, a primary "+" pill. Then two sections:
  – «داشبورد»: نمای کلی، سفارشات و کاربران، مالی، پرداخت‌های معلق، استودیو محتوا، رویدادها، همکاران، آمار، پشتیبانی.
  – «عامل‌ها»: seven agents, each a row with avatar, name, one-line last message, and an unread/pending badge. A small header text «۳ پیشنهاد منتظر شماست» is the inbox count.
  – Bottom: user card (name, current mode), settings, help.
• Centre card: header with the selected item's avatar/icon, title, one-line description, and the segmented switch on the opposite end. Body = data pane, chat pane, or both (data ~55%, chat ~45%).
• Data pane per selection (use real-looking Persian content):
  – حسابداری: KPI cards (درآمد امروز ۳٫۸ م تومان, پرداخت‌شده ۲۴, حاشیهٔ سود خالص ۴۱٪), a 7-day revenue bar chart, a table «پرداخت‌های نیازمند بررسی» with columns سفارش / درگاه / مبلغ / وضعیت ما / وضعیت درگاه and coloured status pills (paid، expired، waiting).
  – محتوا: a Jalali month calendar of occasions with draft/scheduled/sent chips, and a post composer preview in a Telegram-bubble style with CTA buttons.
  – اشتراک‌ها: a customer card — services with plan days and the panel's real end date, changes, payments.
  – نگهبان پرداخت: gateway status tiles (واریزا، تتراِمیناتور، رله) with green/red health, last check, and a hide/show history timeline.
  – رویدادها: an event timeline (start→end) plus an "impact table" per plan (old price, new price, margin %) and rule checks.
  – همکاران: partner cards with tier, 30-day GB, progress bar to the next tier, a lock icon for manual prices.
  – پژوهش: news cards with a "turn into a post" action.
• Chat pane: message bubbles (user violet-accent, agent white), tool-call chip in LTR monospace («tool: payments → 3 unpaid · 1 waiting»), proposal card with a violet border, title, risk badge, one-line payload, evidence line, buttons تأیید (green) / رد / مشاهده در داده / ویرایش. Composer at the bottom with placeholder «از حسابداری بپرسید…», an autonomy chip «🛡 تأیید انسانی: همیشه», the mode chip and a send button.
• Command palette (⌘K): jump to any dashboard or agent, or "ask <agent>".
• Right-side drawers: «صندوق پیشنهادها» (all pending proposals across agents, grouped by risk) and «گزارش عملیات» (audit log).

MOBILE (Telegram Mini App, 390×844)
The sidebar becomes a slide-in drawer from the right and a compact bottom bar (خانه، پیشنهادها، گفتگو، بیشتر). The centre shows ONE of data or chat; the segmented switch sits under the header. Proposal cards are full width with large Approve/Reject buttons (min 44 px). The pending-proposals badge is always visible. No horizontal scrolling anywhere; tables become stacked rows.

AGENTS (7) — each has a distinct small cat-head avatar (square-rounded head, two pointed ears, two vertical-bar eyes; vary the face: bars, happy ^^, wide dots, sleepy lines, wink, heart eyes, star eyes) on a soft pastel tile. Brand gradient for the primary agent: cyan #12f6ff → blue #78aaff. This is the Picha logo character; do not use stock mascots or any assets from the BoardUI template.
 1 حسابداری  2 محتوا  3 اشتراک‌ها  4 نگهبان پرداخت  5 رویدادها  6 همکاران  7 پژوهش
Agent states: idle, thinking (animated three dots + «در حال بررسی…»), waiting for approval (badge), blocked (needs a setting from the human).

SCREENS TO DELIVER (desktop unless stated)
 1 Workspace, حسابداری, view «هر دو» (the hero screen).
 2 Data-only: محتوا (calendar + composer preview).
 3 Chat-only: اشتراک‌ها answering a support ticket: the user pastes a ticket («مدت بسته‌ام باید ده روز دیگر باشد اما ۳ روز شده»); the agent calls a `customer` tool chip, finds a 30-day plan bought 28 days ago, concludes nothing was shortened, and proposes a polite reply starting with «درود» (no apology, asks what extra credit was expected). The proposal card has Approve/Edit/Reject.
 4 Proposal inbox drawer with 6 mixed proposals (post, event, partner tier, payment confirmation, gateway hide, price change) sorted by risk, one rejected and one superseded shown greyed.
 5 Event proposal detail: «بلک‌فرایدی» code 20%, impact table, rule checks (✓ margin, ✓ gap 30 days, ✓ one promotion) and a «refused by rule» example where the draft text contained fake urgency, showing the rewritten version.
 6 Autonomy & mode settings: per-agent three-level selector, global mode switch with live confirmation dialog.
 7 Audit log drawer with filters (agent, result, date).
 8 States: empty agent chat, loading skeletons, an agent error, a failed application («ارسال به کانال ناموفق بود؛ ربات ادمین کانال نیست») with a fix action.
 9 Mobile: drawer open, chat with proposal, data view, inbox (4 frames).
 10 Dark theme of screen 1 and of one mobile frame.
 11 A component sheet: sidebar item, agent row, segmented switch, KPI card, table row with status pills, proposal card (3 risks), tool-call chip, handoff chip, alert card, mode badge, autonomy selector, buttons, inputs, toasts.

VISUAL STYLE
Light neutral surfaces (#f6f7f9 panels on #eceef1), generous rounding (14–26 px), hairline borders, soft shadows only on floating elements. One accent: violet #6d3df5 for the user's own bubbles/primary "+", the Picha brand cyan→blue gradient for brand moments and the primary agent, green #16a34a for approve/healthy, amber for medium risk/waiting, red #e5484d for high risk/errors. Typography: Vazirmatn (Persian, variable weights), Latin digits only inside code/tool chips; Persian digits everywhere else. Icons: Lucide, 1.75 px stroke. Dense but breathable: 13–14 px body, 12 px meta, 20 px KPI numbers. Motion: 150–200 ms ease-out, subtle slide for the switch and drawers; thinking dots; no decorative animation. Accessibility: contrast ≥ 4.5:1, focus rings, touch targets ≥ 44 px, never colour alone for status.

NOT TO DO
No "bypass all" or auto-apply for money/price/service/gateway actions. No countdown timers, scarcity badges or fake urgency. No invented customer data: use fake ids like «۷۰۰۱۰۰۱» and handles like «user_a1b2»; no phone numbers, card numbers, keys or hostnames. No assets copied from boardui.com. No horizontal scroll.

DELIVERABLE
Editable high-fidelity frames (Figma-style, auto-layout, RTL) plus the component sheet and design tokens (colours, radii, spacing, type scale) so developers can build it with React + Tailwind + Radix + lucide-react.
```
