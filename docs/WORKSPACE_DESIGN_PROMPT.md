# پرامپت طراحی: «فضای کار» پیچا (داشبورد + شرکتِ کارکنان هوشمند در چهار بخش)

برای ابزار طراحی (Stitch، Figma Make، Claude/ChatGPT با خروجی HTML و غیره). متن انگلیسی است چون ابزارها بهتر می‌فهمند؛ محتوای نمایشی فارسی خواسته شده. ماکت مرجع: `workspace-mock.png` (در گفتگو فرستاده شد؛ در آن هنوز «هفت عامل» است، ساختار درست همین سند است).

```
Design a high-fidelity, RTL, Persian-language admin WORKSPACE for "Picha" — a small VPN shop sold through a Telegram bot. The product is a Telegram Mini App (mobile first, also used on desktop). It merges two things that are usually separate: a full business DASHBOARD (orders, subscriptions, accounting, content calendar, events/discounts, partners, payment gateways) and a small COMPANY OF AI EMPLOYEES organised in four DEPARTMENTS that work on that same data and PROPOSE actions for the human owner (the CEO) to approve. The owner thinks in departments and employees, not in bots, so the UI speaks of departments and employees.

CORE IDEA
One sidebar on the RIGHT (the UI is RTL) is the navigation for BOTH dashboards and departments. The centre area shows DATA and/or CHAT for whatever is selected. A segmented switch at the top of the centre area toggles: «داده» (data) | «گفتگو» (chat) | «هر دو» (both, side by side on desktop). Selecting a department such as «مالی» shows that department's data lens (finance numbers, payments needing review) and its chat; chatting with a department routes the request to the right employee, and each employee can also be opened directly. Chat messages are live cards, not plain text: a tool-call chip, a Persian answer, a PROPOSAL card with Approve / Reject / "show in data", handoff chips between departments, and alert cards. "Show in data" jumps to and highlights the exact row in the data view.

USERS AND TONE
One owner/administrator (and a support person), Persian speakers, working fast, often on a phone. Calm, trustworthy, precise — a finance-grade tool with a little warmth. All visible text Persian; Persian digits; short labels. Customer-facing sample copy starts with «درود» (never «سلام»), thanks «سپاسگزارم». No childish humour, no hype, no fake urgency or fake scarcity anywhere. No religious/lunar-calendar content.

PRINCIPLES (design these into the UI)
1 Employees PROPOSE, the owner APPLIES. Anything touching money, prices, a customer's service, a payment gateway, code or servers is a pending proposal with a risk level (low/medium/high) and evidence (links to tool results). Never an auto-action.
2 SIMULATION is the default. A global mode badge «شبیه‌سازی» / «تست» / «زنده» is always visible; "live" is unmistakable and needs a confirmation.
3 Autonomy per department and per employee, three levels: «همیشه بپرس» (default; the only option for money, prices, services, gateways, code), «کم‌ریسک را خودکار انجام بده» (e.g. save drafts, never send), «فقط گزارش». Do NOT design a "bypass all" switch.
4 Everything is auditable: an audit drawer with time, actor (employee or human), result.
5 Rule-aware: the system refuses proposals that break house rules (fake urgency, discount above 20%, two offers within 30 days, price increase without 7 days' notice, margin below 10%). Design a "refused by rule" state with the reason and the employee's rewrite.
6 Sign-off chain: anything that changes money or prices needs the Finance department's sign-off AND the owner's approval; anything that changes code/servers needs the owner only after the Technical department shows a diff and a test result.

LAYOUT (desktop 1440×900, RTL)
• Right sidebar ~318 px, a floating soft panel (26 px radius). Top row: search pill, command (⌘) pill, primary "+" pill. Sections:
  – «داشبورد»: نمای کلی، سفارشات و کاربران، مالی، پرداخت‌های معلق، استودیو محتوا، رویدادها، همکاران، آمار، پشتیبانی.
  – «بخش‌ها»: four collapsible departments — فنی، مالی، پشتیبانی، محتوا. Each row shows its head's avatar, name, one-line latest report and a pending badge; expanded, it lists its employees (small avatar, role, status dot). Header text «۳ پیشنهاد منتظر شماست» is the inbox count.
  – Bottom: user card (name = «مدیرعامل», current mode), settings, help.
• Centre card: header with the selected item's avatar/icon, title, one-line description, and the segmented switch. Body = data, chat, or both (data ~55%, chat ~45%). Every department also has the tabs «کارکنان» and «وظایف» (a small task board: در انتظار / در جریان / منتظر تأیید / انجام‌شده).
• Data pane per department (realistic Persian content):
  – مالی (حسابداری): KPI cards (درآمد امروز ۳٫۸ م تومان, پرداخت‌شده ۲۴, حاشیهٔ سود خالص ۴۱٪), 7-day revenue bars, a table «پرداخت‌های نیازمند بررسی» (سفارش / درگاه / مبلغ / وضعیت ما / وضعیت درگاه) with status pills; plus the margin sign-off queue for events and a read-only table of partner tiers as computed by finance (the partners themselves are managed by Support).
  – پشتیبانی (جواب مشتری، دریافت و تحویل اشتراک، و مدیریت همکاران): a customer card — services with plan days and the panel's real end date, changes, payments; tickets list; receipts waiting for approval; renewals about to expire; and the PARTNERS section: partner cards (tier, 30-day GB, progress to the next tier, lock icon for manual prices), partner tickets and wallet questions, onboarding and tier-change notices.
  – محتوا (برنامه‌ریزی و تولید محتوا برای فروش و آموزش مشتری): a Jalali month calendar of occasions with draft/scheduled/sent chips, a Telegram-bubble post preview with CTA buttons, an events timeline (start→end) with an impact table per plan (old price, new price, margin %) and rule checks, and a research news strip with a "turn into a post" action.
  – فنی (مهندسی، کدنویسی، پشتیبانی سرورها و ربات): gateway status tiles (واریزا، تتراِمیناتور، رله) with health, last check and a hide/show timeline; a server list with health; a «تغییرهای پیشنهادی» list where code/config proposals appear as diffs with test results, never applied automatically.
• Chat pane: message bubbles (user violet-accent, employee white), tool-call chip in LTR monospace («tool: payments → 3 unpaid · 1 waiting»), proposal card with a violet border, title, risk badge, one-line payload, evidence line, buttons تأیید (green) / رد / مشاهده در داده / ویرایش, and a «امضای مالی» status line on money proposals. Composer: placeholder «از مالی بپرسید…», an autonomy chip «🛡 تأیید انسانی: همیشه», the mode chip, send button.
• Command palette (⌘K): jump to a dashboard, department or employee, or "ask <department>".
• Right-side drawers: «صندوق پیشنهادها» (all pending proposals across departments, grouped by risk) and «گزارش عملیات» (audit log).

MOBILE (Telegram Mini App, 390×844)
Sidebar becomes a slide-in drawer from the right plus a compact bottom bar (خانه، پیشنهادها، گفتگو، بیشتر). The centre shows ONE of data or chat, the switch under the header. Proposal cards are full width with large Approve/Reject (min 44 px). The pending badge is always visible. No horizontal scrolling; tables become stacked rows.

DEPARTMENTS AND EMPLOYEES (the company; the owner is the CEO)
Each department has a head who posts a short morning report («گزارش صبح»), and 2–4 employees:
 فنی — مهندسی و کدنویسی، پشتیبانی سرورها، ربات و نرم‌افزار. Employees: مهندس نرم‌افزار, مهندس زیرساخت, کنترل کیفیت. Highest-risk department: it only diagnoses and proposes changes (diffs); it never deploys or edits servers by itself.
 مالی — حسابداری. Employees: حسابدار, کارشناس پرداخت, تحلیلگر قیمت. Signs off the margin of any price/discount/event and computes partner tiers.
 پشتیبانی — جواب دادن به مشتری، دریافت و تحویل اشتراک، و مدیریت همکاران (نمایندگان). Employees: پاسخ‌گوی تیکت, تحویل و تمدید, مسئول رسید, مسئول همکاران (onboarding، اطلاع‌رسانی تغییر پله، پیگیری خرید عمده). Finance computes the tier numbers; Support owns the relationship.
 محتوا — برنامه‌ریزی و تولید محتوا برای اهداف مجموعه (فروش، آموزش مشتری). Employees: برنامه‌ریز, نویسنده, طراح بنر, پژوهشگر. Designs events (discounts, bonus GB, codes), which finance must sign.
Cross-department handoffs are first-class: chips in chat and arrows on the task board (e.g. پشتیبانی → فنی for a server problem; محتوا → مالی margin check before an offer; مالی → پشتیبانی "payment confirmed, deliver the subscription").
Avatars: every head and employee has a distinct cat-head avatar (rounded-square head, two pointed ears, two vertical-bar eyes; vary the face: bars, happy ^^, wide dots, sleepy lines, wink, heart, star; heads get a small accessory such as glasses or a tie) on a soft pastel tile; one pastel hue per department so departments read at a glance. The primary department (مالی) may use the brand gradient cyan #12f6ff → blue #78aaff. This is the Picha logo character; no stock mascots and no assets from the BoardUI template.
Employee states: idle, thinking (three dots + «در حال بررسی…»), waiting for approval, blocked (needs a setting from the human).

ORGANISATION AND GROWTH
These four are the MAIN departments and stay the stable top level (everything else — events, partners, receipts, research — lives inside one of them). When the workload grows, any department can later be split into SUB-TEAMS (e.g. پشتیبانی → مشتریان، همکاران، رسیدها؛ محتوا → برنامه‌ریزی، تولید، پژوهش) without changing the rest of the UI. Design the sidebar tree, the department header, the task board and the chat routing to support two levels (department → sub-team → employee): sub-teams appear as nested rows, have their own badge and head, and chatting with the department still routes automatically. Include an «سازمان» screen with an editable tree and a «افزودن زیرمجموعه» action; no sub-teams exist at launch.

SCREENS TO DELIVER (desktop unless stated)
 1 Workspace, مالی, «هر دو» (the hero).
 2 Data-only: محتوا (calendar + composer preview).
 2b Department overview for پشتیبانی: head's morning report, the employees tab (role, status, today's workload), the task board with a handoff arrow to فنی, a pending-proposals strip.
 2c Company overview (the CEO's home): four department cards with their morning reports, the proposals inbox, today's key numbers.
 3 Chat-only: پشتیبانی (the ticket-answering employee) answering a ticket («مدت بسته‌ام باید ده روز دیگر باشد اما ۳ روز شده»): a `customer` tool chip, finds a 30-day plan bought 28 days ago, concludes nothing was shortened, proposes a polite reply starting with «درود» (no apology, asks what extra credit was expected), with Approve/Edit/Reject.
 4 Proposal inbox drawer with 6 mixed proposals (post, event, partner tier, payment confirmation, gateway hide, code change) by risk; one rejected and one superseded greyed out.
 5 Event proposal detail: «بلک‌فرایدی» code 20%, impact table, rule checks (✓ margin, ✓ 30-day gap, ✓ one promotion), the «امضای مالی» status, and a "refused by rule" example (fake urgency) with the rewritten text.
 5b Technical proposal detail: a code/config diff with test results and the note «اعمال فقط توسط مدیرعامل».
 6 Autonomy & mode settings: three-level selector per department and employee, global mode switch with a live-confirmation dialog.
 7 Audit log drawer with filters (department, employee, result, date).
 8 States: empty chat, skeletons, an employee error, a failed application («ارسال به کانال ناموفق بود؛ ربات ادمین کانال نیست») with a fix action.
 9 Mobile: drawer with departments, chat with a proposal, data view, inbox.
 10 Dark theme of screen 1 and one mobile frame.
 10b Organisation screen: the tree of departments → sub-teams → employees, with an «افزودن زیرمجموعه» action, drag to move an employee, and each node's autonomy level (empty sub-teams shown as a dashed placeholder).
 11 Component sheet: sidebar item, department row (collapsed/expanded), employee row, segmented switch, KPI card, table row with pills, proposal card (3 risks + sign-off line), tool-call chip, handoff chip, task-board card, nested sub-team row, alert card, mode badge, autonomy selector, buttons, inputs, toasts.

VISUAL STYLE
Light neutral surfaces (#f6f7f9 on #eceef1), rounding 14–26 px, hairline borders, soft shadows only on floating elements. Accents: violet #6d3df5 for the user's bubbles and the primary "+", the Picha cyan→blue gradient for brand moments, green #16a34a for approve/healthy, amber for medium risk/waiting, red #e5484d for high risk/errors, one pastel per department. Vazirmatn (Persian digits everywhere except code/tool chips). Lucide icons, 1.75 px stroke. Body 13–14 px, meta 12 px, KPI 20 px. Motion 150–200 ms; thinking dots only. Contrast ≥ 4.5:1, focus rings, touch targets ≥ 44 px, never colour alone for status.

NOT TO DO
No "bypass all" or auto-apply for money/price/service/gateway/code actions. No countdowns, scarcity badges or fake urgency. No invented real customer data: fake ids like «۷۰۰۱۰۰۱», handles like «user_a1b2», no phone/card numbers, keys or hostnames. No assets copied from boardui.com. No horizontal scroll.

DELIVERABLE
Editable high-fidelity frames (Figma-style, auto-layout, RTL) plus the component sheet and design tokens (colours, radii, spacing, type scale), buildable with React + Tailwind + Radix + lucide-react.
```
