# تولید تصویر برای بنرها (ChatGPT یا هر مولد دیگر)

**اصل:** شخصیت پیچا = **خودِ لوگو**. مولدهای تصویر شکل را کمی عوض می‌کنند (گوش، چشم، دم) و متن فارسی را خراب می‌نویسند. پس **صحنه را مولد می‌سازد، شخصیت و متن را ما** (از روی بردار دقیق لوگو) روی آن می‌گذاریم. فایل‌های مرجع در `growth/brand/`:
- `picha-cat.svg` (بردار)، `picha-cat-1024.png` (شفاف)، `picha-character-sheet.png` (برگهٔ چهره‌ها و لوازم)

## روش ۱ (پیشنهادی): فقط «صحنه» از ChatGPT
1. در ChatGPT یک چت تازه؛ **`picha-character-sheet.png` را ضمیمه کنید** (تا رنگ‌ها و حال‌وهوا را ببیند، حتی اگر شخصیت را نکشد).
2. این دستور را بدهید (نام صحنه را عوض کنید):
```
Create a wide 16:9 background scene (1536x1024) for a social media banner.
Scene: {SCENE}.
Style: modern flat-vector illustration with soft gradients and gentle glow, calm futuristic palette of deep navy, cyan (#12f6ff) and blue (#78aaff) with one warm accent.
Composition: keep the LEFT HALF and the BOTTOM-LEFT mostly empty and low-contrast (a character will be placed there later); put the interesting details on the right and in the background.
Do NOT include: any text, letters, logos, watermarks, people, or any cat/animal character.
```
3. فایل را در `growth/brand/assets/` بگذارید (در گیت نیست) و بگویید «plate: نام‌فایل». من با `poster.mjs` سبک D ترکیب می‌کنم: صحنه + لوگوی دقیق + متن فارسی.

### نمونهٔ `{SCENE}` برای مناسبت‌ها
| مناسبت | صحنه |
|---|---|
| روز گربه‌ها / روز بین‌المللی گربه | a cozy window at night with soft fairy lights and a few small stars, a fish-shaped paper lantern |
| روز گربهٔ سیاه / جمعهٔ گربهٔ سیاه | a moonlit rooftop skyline at night with a huge glowing crescent moon and floating sparkles |
| شب یلدا | a cozy winter night room with a sliced watermelon and pomegranates on a rug, warm lamp glow |
| نوروز | a Haft-sin table corner with sprouts (sabzeh), goldfish bowl, hyacinth and soft spring light |
| روز برنامه‌نویس | a dark desk with a glowing laptop showing abstract code lines, small neon plants and a coffee cup |
| روز طراحی گرافیک | a designer's desk with color swatches, a graphics tablet and floating geometric shapes |
| روز معمار | an architect's table with blueprints, a small building model and a drafting ruler, blue tones |
| روز مهندس | a workshop with gears, a circuit board glow and measuring tools, cool tones |
| آموزش اتصال | a phone floating above a glowing network of dots and lines, simple and clean |
| امنیت | a large soft glowing shield made of light over a calm dark landscape |

## روش ۲: ChatGPT خودش شخصیت را هم بکشد (برای تصویر «با گربه»)
فقط برای تصویرهای کم‌اهمیت. ضمیمه: `picha-cat-1024.png` و `picha-character-sheet.png`، و:
```
Use the attached cat logo as the exact character. Keep its silhouette EXACTLY: a rounded square
body, two pointed ears at the top corners with a flat top between them, two vertical rounded
rectangle eyes, a short diagonal tail at the lower left, rounded bottom-right corner, smooth
cyan-to-blue gradient. Do not redraw it as a realistic cat; no whiskers, no mouth, no fur.
Place it in: {SCENE}. Keep it flat-vector. No text.
```
بعد **خودتان بررسی کنید** که شکل عوض نشده؛ اگر شد، روش ۱ را بزنید.

## نکته‌ها
- **ابعاد:** 1536×1024 یا 16:9؛ من به ۱۲۸۰×۷۲۰ برش می‌دهم.
- **پس‌زمینه‌های روشن** سبک D را کم‌خوانا می‌کنند؛ «dark / moody» بخواهید.
- **مجوز:** شرایط فعلی OpenAI برای استفادهٔ تجاری خروجی را چک کنید؛ فایل‌های استوک (Magnific/Freepik) مجوز هر فایل را نگه دارید.
- متن فارسی را هرگز از مولد نخواهید.
