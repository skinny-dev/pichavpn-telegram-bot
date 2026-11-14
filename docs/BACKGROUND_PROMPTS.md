# پرامپت پس‌زمینه برای ChatGPT (سبک sci-fi کامل) + جای متن‌ها و لوگو

**تقسیم کار:** شما پس‌زمینه را از ChatGPT می‌گیرید؛ **من** لوگو، شخصیت پیچا، تیتر، زیرعنوان، نشان‌ها و دکمه را در جای ثابتشان (زیر) می‌گذارم. پس پس‌زمینه باید این جاها را **خالی و آرام** نگه دارد.

## روش کار (۴ قدم)
1. فایل راهنمای همان قالب را ضمیمه کنید: `growth/banner/layouts/guide-wide-r.png` (افقی)، `guide-story.png` (استوری)، `guide-square.png` (مربع). **فقط راهنمای چیدمان است؛ جعبه‌ها و برچسب‌ها نباید در تصویر کشیده شوند** (در پرامپت گفته شده).
2. «پرامپت اصلی sci-fi» + «چیدمان همان قالب» + «صحنه» را یکی کنید و بدهید.
3. خروجی را در `growth/brand/assets/` بگذارید (یا همین‌جا بفرستید؛ من ذخیره می‌کنم).
4. من با `{style:'f', layout:'wide-r', bg:'فایل.png', …}` ترکیب می‌کنم. یک سایهٔ تیره زیر متن هم می‌گذارم تا خوانایی تضمین شود.

**ابعاد خروجی ChatGPT و برش:** ChatGPT 1536×1024 (3:2)، 1024×1536 (2:3) یا 1024×1024 می‌دهد؛ من برش می‌دهم. افقی (16:9): **۸٪ بالا و پایین ممکن است بریده شود** (چیز مهم را در ۸۴٪ میانی بگذارید)؛ استوری (9:16) از 1024×1536 بخواهید و ۸٪ چپ و راست ممکن است بریده شود.

## پرامپت اصلی sci-fi (همیشه اول)
```
Create a full sci-fi background image for a social media banner.
Style: cinematic hard sci-fi / cyber-futuristic, holographic interfaces, neon light, volumetric
glow, glass and metal, orbital rings, data streams and circuit patterns, deep-space or futuristic
megacity atmosphere. Dark navy-black base (#05080d–#0a1630) with cyan (#12f6ff) and electric blue
(#78aaff) as the main light, plus ONE warm accent color: {ACCENT}.
Quality: sharp, high detail at the edges, soft and low-detail in the empty zones, moderate
contrast, no bright white areas, no lens-flare in the empty zones.
STRICT: no text, no letters, no numbers, no logos, no watermark, no people, no animals, no cats.
Do not draw the guide boxes or their labels.
```
`{ACCENT}`: صورتی (pink #f472b6) برای روز گربه · کهربایی (amber #fbbf24) یلدا/نوروز/جمعه · بنفش (violet #a78bfa) جمعهٔ گربهٔ سیاه · سبز (green #4ade80) آموزش/برنامه‌نویس.

## چیدمان هر قالب (به پرامپت اضافه کنید)
### افقی `wide-r` (۱۲۸۰×۷۲۰ → از 1536×1024 بخواهید)
```
Composition (use the attached guide image only as a layout map). Keep these areas EMPTY, calm,
dark and low-detail (smooth gradient, tiny stars or faint grid only):
- top-right small area x 78–96%, y 5–14% (for a logo)
- right block x 47–96%, y 21–77% (for a big title, subtitle and tags) — the largest calm area
- bottom-right x 69–96%, y 81–93% (for a button)
- top-left small area x 4–22%, y 6–11% (for a handle)
The main sci-fi scene lives in the LEFT 45% and the background edges; leave the lower-left
x 4–45%, y 19–94% calm enough for a character to stand there (a soft glow or platform is fine).
```
### استوری `story` (۱۰۸۰×۱۹۲۰ → از 1024×1536 بخواهید)
```
Composition (use the attached guide only as a layout map). Keep these areas EMPTY, calm, dark:
- top center x 31–69%, y 6–10% (logo) and the band x 8–92%, y 14–33% (a big title)
- the CENTER x 13–87%, y 35–69% is the focal area: put the hero scene here, but leave its middle
  calm for a character
- lower band x 8–92%, y 71–84% (subtitle and tags) and x 22–78%, y 86–92% (a button), bottom y 94–97% (handle)
```
### مربع `square` (۱۰۸۰×۱۰۸۰ → 1024×1024)
```
Composition (use the attached guide only as a layout map). Keep EMPTY, calm, dark:
- top-right x 70–95%, y 5–12% (logo); right block x 39–95%, y 17–66% (title, subtitle, tags);
  bottom-right x 59–95%, y 83–93% (button); top-left x 5–32%, y 6–10% (handle)
The sci-fi scene lives on the LEFT 40% and background edges; keep the lower-left x 4–43%, y 24–94%
calm for a character.
```

## صحنه‌ها (`Scene:` را به پرامپت اضافه کنید)
| مناسبت/پست | Scene (sci-fi) | ACCENT |
|---|---|---|
| روز گربه‌ها / روز بین‌المللی گربه | a neon rooftop terrace in a futuristic city at night, holographic koi-fish drones swimming in the air, a huge crescent moon and an orbital ring | pink |
| جمعهٔ گربهٔ سیاه / روز گربهٔ سیاه | a cyberpunk megacity at night under a giant glowing crescent moon, shining rain, a huge neon billboard made only of light shapes (no text) | violet |
| شب یلدا | a sci-fi space-station greenhouse on the longest winter night, glowing watermelon-shaped and pomegranate-shaped energy orbs floating, warm light against deep space | amber |
| نوروز | a futuristic spring garden under an orbital ring, holographic sprouts and seven glowing objects on a luminous table, goldfish-shaped light drones, soft dawn glow | amber |
| روز برنامه‌نویس | a neon terminal city with floating streams of code-like light (abstract, unreadable), holographic keyboards and glowing server towers | green |
| روز طراحی گرافیک | a zero-gravity design studio with floating color swatches, holographic geometric shapes and a drawing-tablet hologram | pink |
| روز معمار | a holographic blueprint city assembling itself over a dark grid, scale lines and glowing wireframe towers | cyan/blue |
| روز مهندس | a giant orbital machine workshop with glowing gears, circuit rivers and measuring beams | amber |
| آموزش اتصال | a glowing network of nodes forming a sphere around a floating phone hologram, data streams | green |
| امنیت | a huge translucent energy shield dome over a dark futuristic city, particles of light | cyan/red |
| وضعیت سرورها | a calm control room with soft holographic dashboards (abstract, unreadable), server racks fading into the distance | cyan |

## قواعد کیفیت
- **بدون متن** در عکس (فارسی را من می‌نویسم). اگر ChatGPT متن گذاشت، دوباره بخواهید با «no text, no letters».
- **جاهای خالی تمیز باشد:** سفید روشن یا جزئیات شلوغ پشت تیتر، خوانایی را می‌برد.
- **همه با یک سبک و یک پالت** تا کانال یک‌پارچه بماند.
- اگر شکل جاها رعایت نشد، همان تصویر قابل استفاده است: من شخصیت و متن را جابه‌جا می‌کنم یا سایهٔ تیره‌تری می‌گذارم.
- **مجوز:** شرایط فعلی OpenAI برای استفادهٔ تجاری را چک کنید.
