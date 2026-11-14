# پرامپت‌های سبک Y2K (برای ChatGPT) — پس‌زمینه و لایه‌ها

سه رنگ مجاز: آبی الکتریکی `#42BCE8` (غالب)، سفید صدفی `#FAFCFD`، صورتی-یاسی `#E2A7E9`. پس‌زمینه سیاه خالص `#000000`.

## روش پیشنهادی (ساده و مطمئن)

ChatGPT فقط **یک شیء وسط روی سیاه خالص** می‌سازد. چون پس‌زمینه سیاه خالص است، رندر ما (`theme:'y2k'`) سیاهی را با `mix-blend-mode: screen` شفاف می‌کند و شیء را در جای مخصوص خودش (zone «hero») می‌گذارد. لازم نیست ChatGPT جای متن و لوگو را رعایت کند، و یک تصویر برای هر سه اندازه (wide / story / square) کافی است.

اندازهٔ خروجی: `1024×1024` برای شیء (یا `1536×1024` اگر می‌خواهید فقط بنر افقی بسازید).

## ۱) پرامپت اصلی (قالب)

فقط `{OBJECT}` را عوض کنید.

```
Y2K futuristic glossy 3D icon. Subject: {OBJECT}.

Style: bold abstract geometric silhouette, smooth rounded inflated 3D form, high-gloss polished plastic / translucent resin, soft beveled edges, smooth gradients from electric sky blue to pearlescent white to soft lavender pink, strong white specular highlights, clean sculptural playful yet premium.

Palette (use ONLY these three colors): Electric Sky Blue #42BCE8 (dominant), Pearlescent White #FAFCFD, Soft Lavender Pink #E2A7E9. No other hues.

Composition: ONE isolated object, perfectly centered, on a pure black #000000 background (flat, no gradient, no floor, no shadow). Generous negative space around it (the object fills about 60% of the frame). Crisp high-quality 3D render, strong contrast. No text, no letters, no labels, no watermark, no logo.

Lighting and material: high-gloss translucent resin / acrylic, soft box lighting, white specular reflections, electric blue internal glow, delicate lavender-pink reflections on the edges.

Avoid: rainbow or iridescent colors, purple / green / yellow / orange / red additions, metallic industrial textures, photorealistic environments, excessive detail, noisy background, flat or cartoon outlines, unnecessary shadows, matte or rough materials.

Square image, 1024x1024.
```

## ۲) شیء برای هر مناسبت

| مناسبت | `{OBJECT}` |
|---|---|
| جمعهٔ گربهٔ سیاه (۶ آذر) / روز گربه | the attached cat-head logo silhouette (two pointed ears, two vertical bar eyes, a curled tail at the lower left), exactly that shape, inflated into glossy resin. Attach `growth/brand/picha-cat-1024.png` |
| یلدا (۳۰ آذر) | an abstract inflated watermelon slice, simple rounded shape |
| نوروز | an inflated sprout with two rounded leaves |
| روز برنامه‌نویس | a pair of inflated curly brackets `{ }` as a 3D sculpture (shapes only, no text) |
| روز طراح | an inflated pen-tool nib with a bezier curve handle |
| روز معمار | an inflated simple house made of an arch and a cube |
| روز مهندس | an inflated gear with soft rounded teeth |
| اتصال | three inflated concentric wifi arcs with a dot |
| امنیت | an inflated shield with a soft bevel |
| وضعیت سرویس | four inflated signal bars of rising height |
| هدیه (۱۰ گیگ) | an inflated gift box with a ribbon bow |
| روز کوروش | an inflated abstract winged disc, geometric and simple |

نکته: برای رنگ‌ها فقط همان سه رنگ؛ اگر چیز دیگری اضافه شد بنویسید: «recolor using only #42BCE8, #FAFCFD and #E2A7E9, keep everything else identical».

## ۳) پرامپت نسخهٔ لایه‌دار (اختیاری)

اگر می‌خواهید شیء از قبل در جای hero باشد (بدون نیاز به جابه‌جایی). بخش «Composition» را با یکی از اینها عوض کنید. باقی تصویر باید سیاه خالص بماند.

**بنر افقی `1536×1024`** (شیء در سمت چپ؛ سمت راست برای متن خالی):
```
Composition: ONE isolated object centered at 26% from the left edge and 55% from the top, occupying about 35% of the image width. The entire right half and the top and bottom edges stay pure black #000000. Nothing else in the frame.
```
(در رندر: ناحیهٔ hero بنر افقی x ۴ تا ۴۵٪، y ۱۹ تا ۹۴٪؛ سمت راست برای عنوان و دکمه و بالا برای لوگو.)

**استوری `1024×1536`** (شیء وسط، بالا و پایین برای متن):
```
Composition: ONE isolated object centered horizontally and at 52% from the top, occupying about 60% of the image width. The top 30% and the bottom 28% stay pure black #000000. Nothing else in the frame.
```
(hero استوری: x ۱۳ تا ۸۷٪، y ۳۵ تا ۶۹٪.)

**مربع `1024×1024`** (شیء در سمت چپ):
```
Composition: ONE isolated object centered at 24% from the left edge and 59% from the top, occupying about 38% of the image width. The right half and the top 20% stay pure black #000000. Nothing else in the frame.
```
(hero مربع: x ۴ تا ۴۳٪، y ۲۴ تا ۹۴٪.)

اگر ChatGPT مرزها را دقیق رعایت نکرد مشکلی نیست؛ با روش اصلی (بخش ۱) شیء را ما جابه‌جا می‌کنیم.

## ۴) بعد از ساخت

PNG را در `growth/brand/assets/` بگذارید (در گیت نمی‌رود)، سپس:

```json
[{ "style": "f", "layout": "wide-r", "theme": "y2k", "hero": "black-cat.png",
   "title": "جمعهٔ گربهٔ <em>سیاه</em>", "subtitle": "…", "chips": ["۶ آذر"], "cta": "مشاهده" }]
```
`layout` می‌تواند `wide-r` / `story` / `square` باشد. `"blend": false` اگر تصویرتان پس‌زمینهٔ سیاه خالص ندارد.

قانون‌ها: متن‌های تصویر را خودمان می‌گذاریم (فارسی در ChatGPT خراب می‌شود)؛ هیچ تخفیف یا فوریت ساختگی؛ لحن «درود».
