// node build.mjs  → validates plan.mjs + occasions.mjs, renders every banner into out/ (git-ignored) + out/contact-sheet.png,
// and writes ../../docs/CONTENT_CALENDAR.md (generated: edit plan.mjs / occasions.mjs, not the doc).
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { html, THEMES } from '../banner/render.mjs'
import { j2g, g2j, WEEKDAY, MONTH, addDays, dow, fa, pad } from './jalali.mjs'
import occasions from './occasions.mjs'
import { START, WEEKLY, MAIN, NEWS_SLOT } from './plan.mjs'

const here = path.dirname(new URL(import.meta.url).pathname)
const OUT = path.join(here, 'out')
const DOC = path.join(here, '../../docs/CONTENT_CALENDAR.md')
fs.mkdirSync(OUT, { recursive: true })

// ---------- validation
const errors = []
const TAGS = { marketing: 'بازاریابی', acquisition: 'عضوگیری و جذب', ux: 'تجربه‌ی کاربری', satisfaction: 'رضایت مشتری', retention: 'نگهداشت و تمدید', trust: 'اعتماد', research: 'پژوهش و نظرخواهی', support: 'کاهش بار پشتیبانی' }
const AUTO = { A: 'خودکار', T: 'خودکار بعد از تأیید شما', M: 'نیازمند داده/تصمیم شما' }
const FORBIDDEN = /محرم|عاشورا|تاسوعا|اربعین|رمضان|فطر|قربان|غدیر|شعبان|مبعث|ولادت|شهادت|رحلت|امام|قمری|هجری قمری|صفر|ربیع|جمادی|رجب|شوال|ذی‌القعده|ذی‌الحجه/
const iconOk = (n) => !n || fs.existsSync(path.join(here, '../banner/icons', n + '.svg'))
const checkSpec = (id, s) => {
  if (!THEMES[s.theme]) errors.push(`${id}: unknown theme ${s.theme}`)
  for (const n of [s.icon, ...(s.extra || [])]) if (!iconOk(n)) errors.push(`${id}: missing icon ${n}`)
  if (!s.icon) errors.push(`${id}: no icon`)
}
const textOf = (o) => JSON.stringify(o)
const startG = j2g(...START)
const days = MAIN.map((e) => {
  const g = addDays(startG, e.day)
  const j = g2j(...g)
  return { ...e, g, j, wd: WEEKDAY[dow(g)] }
})
const seen = new Set()
for (const e of days) {
  const id = `day ${e.day} (${e.j.join('/')})`
  if (seen.has(e.day)) errors.push(`${id}: duplicate day`)
  seen.add(e.day)
  if (!e.why || e.why.length < 20) errors.push(`${id}: missing reason`)
  if (!e.tags?.length || e.tags.some((t) => !TAGS[t])) errors.push(`${id}: bad/missing tags`)
  if (!e.kpi) errors.push(`${id}: no KPI`)
  if (!AUTO[e.auto]) errors.push(`${id}: bad auto level`)
  if (!e.needs) errors.push(`${id}: no `+'needs')
  if (!e.text || !e.cta) errors.push(`${id}: no text/cta`)
  if (FORBIDDEN.test(textOf(e))) errors.push(`${id}: religious/lunar wording`)
  checkSpec(id, e.spec)
}
for (let i = 0; i < MAIN.length; i++) if (!seen.has(i)) errors.push(`day ${i} missing`)
const offType = days.filter((e) => e.type !== WEEKLY[e.wd] && !['جمعه‌ی سیاه', 'امنیت', 'نگهداشت'].includes(e.type) && !(e.wd === 'چهارشنبه' && ['پیشنهاد', 'نگهداشت'].includes(e.type)))
for (const e of offType) errors.push(`day ${e.day}: type «${e.type}» ≠ weekday rhythm «${WEEKLY[e.wd]}»`)
if (FORBIDDEN.test(textOf(occasions))) errors.push('occasions: religious/lunar wording')
for (const o of occasions) checkSpec('occasion ' + o.id, o.spec)
checkSpec('news', NEWS_SLOT.spec)

// ---------- occasion dates (1405 & 1406)
const nth = (y, m, wd, n) => { let c = 0; for (let d = 1; d <= 31; d++) { const t = new Date(Date.UTC(y, m - 1, d)); if (t.getUTCMonth() !== m - 1) break; if (t.getUTCDay() === wd && ++c === n) return [y, m, d] } }
const lastWedBefore = ([y, m, d]) => { let g = [y, m, d]; while (dow(g) !== 3) g = addDays(g, -1); return g }
const occDate = (o, jy) => {
  const gYear = jy + 621
  if (o.j) return j2g(jy, o.j[0], o.j[1])
  if (o.g) return [o.g[0] <= 2 ? gYear + 1 : gYear, o.g[0], o.g[1]]
  switch (o.rule) {
    case 'lastTuesdayEsfand': return addDays(lastWedBefore(addDays(j2g(jy + 1, 1, 1), -1)), -1)
    case 'secondTuesdayFeb': return nth(gYear + 1, 2, 2, 2)
    case 'firstThursdayMay': return nth(gYear, 5, 4, 1)
    case 'programmersDay': { const leap = gYear % 4 === 0 && (gYear % 100 !== 0 || gYear % 400 === 0); return [gYear, 9, leap ? 12 : 13] }
    case 'fourthFridayNov': return addDays(nth(gYear, 11, 4, 4), 1)
  }
}
const fmtG = (g) => `${g[0]}-${pad(g[1])}-${pad(g[2])} (${WEEKDAY[dow(g)]})`
const fmtJ = (j) => `${fa(j[0])}/${fa(pad(j[1]))}/${fa(pad(j[2]))}`
const occRows = occasions.flatMap((o) => [1405, 1406].map((jy) => { const g = occDate(o, jy); return { o, jy, g, j: g2j(...g) } }))
  .sort((a, b) => a.g[0] - b.g[0] || a.g[1] - b.g[1] || a.g[2] - b.g[2])

// ---------- banners
const require = createRequire('/opt/pw-browsers/')
const { chromium } = (() => { try { return require('playwright') } catch { return createRequire(import.meta.url)('playwright') } })()
const SUB = { celebration: 'از طرف تیم پیچا', culture: 'یادی از بزرگان فرهنگ ایران', tech: 'نکته‌ی امروز از پیچا', profession: 'تبریک به همکاران این حرفه', cat: 'از طرف گربه‌های پیچا 🐾' }
const jobs = [
  ...days.map((e) => ({ file: `d${pad(e.day + 1)}-${e.spec.tag}.png`, label: `${fa(pad(e.j[1]))}/${fa(pad(e.j[2]))} ${e.wd} · ${e.type}`, spec: { ...e.spec, title: e.title, cta: e.cta } })),
  ...occasions.map((o) => { const g = occDate(o, 1405), j = g2j(...g); return { file: `occ-${o.id}.png`, label: `مناسبت · ${o.title}`, spec: { ...o.spec, scene: 'calendar', date: [fa(j[2]), MONTH[j[1]]], title: o.title.replace(/^(.*?)(\s|$)/, '[[$1]]$2'), subtitle: o.cat || SUB[o.kind], badges: [o.kind === 'celebration' ? 'تبریک' : o.kind === 'culture' ? 'فرهنگ' : o.kind === 'cat' ? 'روز گربه' : o.kind === 'profession' ? 'روز حرفه' : 'فناوری'], handle: '@pichanet_bot' } } }),
  { file: 'news-template.png', label: 'خبر روز (قالب)', spec: { ...NEWS_SLOT.spec, title: '[[عنوان خبر]] از منبع تأییدشده', subtitle: 'خلاصه‌ی دو خطی با کلمات خودمان؛ لینک منبع زیر پست.', badges: ['منبع: ...'] } },
]
if (!errors.length) {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  for (const j of jobs) {
    const f = path.join(OUT, '.tmp.html')
    fs.writeFileSync(f, html(j.spec))
    await page.goto('file://' + f)
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: path.join(OUT, j.file) })
  }
  fs.rmSync(path.join(OUT, '.tmp.html'), { force: true })
  // contact sheet of the 30 daily banners
  const cells = jobs.slice(0, days.length).map((j) => `<figure><img src="file://${OUT}/${j.file}"><figcaption>${j.label}</figcaption></figure>`).join('')
  const sheet = `<!doctype html><html dir="rtl"><meta charset="utf-8"><style>body{margin:0;background:#05080d;color:#c9d6e6;font:600 15px sans-serif;padding:18px;width:1584px}
  .g{display:grid;grid-template-columns:repeat(5,300px);gap:12px 18px}figure{margin:0}img{width:300px;height:169px;border-radius:8px;display:block}figcaption{padding:6px 2px;font-size:14px}</style><body><div class="g">${cells}</div></body></html>`
  fs.writeFileSync(path.join(OUT, '.sheet.html'), sheet)
  await page.setViewportSize({ width: 1620, height: 900 })
  await page.goto('file://' + path.join(OUT, '.sheet.html'))
  await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(OUT, 'contact-sheet.png'), fullPage: true })
  fs.rmSync(path.join(OUT, '.sheet.html'), { force: true })
  await browser.close()
}

// ---------- document
const tagText = (tags) => tags.map((t) => TAGS[t]).join(' · ')
const L = []
L.push('# تقویم محتوا و برنامه‌ی انتشار', '', '> این سند از `growth/calendar/plan.mjs` و `occasions.mjs` ساخته می‌شود (`node growth/calendar/build.mjs`). ویرایش را در آن فایل‌ها انجام دهید، نه اینجا. بنرها در `growth/calendar/out/` ساخته می‌شوند.', '')
L.push('## ۱. اصل: هر پست یک دلیل دارد', '', 'هیچ پستی بدون «چرا» و «شاخص» منتشر نمی‌شود. دلیل‌ها فقط از این فهرست‌اند:', '', '| دلیل | یعنی |', '|---|---|')
for (const [k, v] of Object.entries(TAGS)) L.push(`| ${v} | ${{ marketing: 'فروش و تبدیل مستقیم', acquisition: 'عضو و مشتری تازه، ارزان', ux: 'مشتری راحت‌تر کار را پیش ببرد', satisfaction: 'حس شنیده‌شدن و رضایت', retention: 'ماندن و تمدید', trust: 'اعتماد و ضد کلاهبرداری', research: 'نظر مخاطب برای تصمیم‌ها', support: 'تیکت و سؤال تکراری کمتر' }[k]} |`)
L.push('', '**قاعده‌های ثابت:** پستِ دارای داده‌ی نامعلوم ساخته نمی‌شود (قیمت، تخفیف، سرعت، آپ‌تایم فقط با عدد واقعی). تخفیف فقط با کمپین واقعی. هیچ مناسبت قمری یا مذهبی نداریم؛ فقط شمسیِ فرهنگی و روزهای جهانی/فناوری.', '')
L.push('## ۲. ریتم هفتگی', '', '| روز | نوع پست اصلی (۲۰:۳۰) | چرا |', '|---|---|---|')
const WHY = { 'شنبه': 'آغاز هفته: مشتری وقت یاد گرفتن دارد؛ تیکت کم می‌شود (تجربه‌ی کاربری)', 'یکشنبه': 'نظرسنجی/پرسش: پژوهش ارزان و تعامل کانال', 'دوشنبه': 'اعتماد: پشتیبانی، امنیت و FAQ قبل از میانه‌ی هفته‌ی خرید', 'سه‌شنبه': 'محصول: قیمت و حجم شفاف؛ تبدیل بی‌فشار', 'چهارشنبه': 'پیشنهاد و تمدید: روز تصمیم‌گیری خرید', 'پنجشنبه': 'رفرال: پیش از آخر هفته که مردم با دوستان گفت‌وگو می‌کنند', 'جمعه': 'جامعه: سبک و صمیمی؛ رضایت و ماندن در کانال' }
for (const [d, t] of Object.entries(WEEKLY)) L.push(`| ${d} | ${t} | ${WHY[d]} |`)
L.push('', '## ۳. دو اسلات روزانه', '', `- **${NEWS_SLOT.time} — ${NEWS_SLOT.type}:** ${NEWS_SLOT.why}`, `  - دلیل‌ها: ${tagText(NEWS_SLOT.tags)} · شاخص: ${NEWS_SLOT.kpi} · ${AUTO[NEWS_SLOT.auto]} · وابسته: ${NEWS_SLOT.needs}`, '- **۲۰:۳۰ — پست اصلی:** طبق ریتم هفتگی بالا.', '- حداکثر ۲ پست در روز؛ فاصله‌ی حداقل ۶ ساعت؛ ساعت ۰۰ تا ۰۸ پست نمی‌رود.', '- جمعه‌ها پست خبر به «خلاصه‌ی هفته» (۵ تیتر) تبدیل می‌شود.', '')
L.push(`## ۴. برنامه‌ی ${fa(30)} روز: ${fmtJ(days[0].j)} تا ${fmtJ(days.at(-1).j)}`, '', '| تاریخ | روز | نوع | عنوان بنر | دلیل | شاخص | خودکار؟ |', '|---|---|---|---|---|---|---|')
for (const e of days) L.push(`| ${fmtJ(e.j)} | ${e.wd} | ${e.type} | ${e.title.replace(/\[\[|\]\]/g, '')} | ${tagText(e.tags)} | ${e.kpi} | ${AUTO[e.auto]} |`)
L.push('', '### جزئیات هر روز', '')
for (const e of days) {
  const b = jobs[e.day]
  L.push(`#### ${fmtJ(e.j)} ${e.wd} — ${e.type}: ${e.title.replace(/\[\[|\]\]/g, '')}`, '', `- **چرا:** ${e.why}`, `- **دلیل‌ها:** ${tagText(e.tags)}`, `- **متن پست:** ${e.text.replace(/\n/g, ' ⏎ ')}`, `- **دکمه‌ی زیر پست:** ${e.cta}`, `- **بنر:** \`${b.file}\` (رنگ ${e.spec.theme}، نماد ${e.spec.icon})`, `- **شاخص:** ${e.kpi} · **${AUTO[e.auto]}** · **وابسته به:** ${e.needs}`, `- **۱۲:۳۰:** خبر روز (قالب بنر خبر؛ عنوان از خبر واقعی)`, '')
}
L.push('## ۵. اخبار', '', '**هدف:** مرجع خبر اینترنت و فناوری برای مخاطب شویم (اعتبار و اشتراک‌گذاری ← عضو جدید)، و مشتری از تغییراتی که روی اتصالش اثر دارد زود خبردار شود (تجربه‌ی کاربری).', '',
  '**مسیر:** منبع تأییدشده ← دریافت ← حذف تکراری ← فیلتر موضوع (مجاز/ممنوع) ← انتخاب بهترین ← خلاصه با کلمات خودمان (با هوش مصنوعی یا فقط تیتر) ← بنر «خبر» ← تأیید شما ← انتشار ۱۲:۳۰.', '',
  '**قاعده‌ها:**', '- فقط از منبعی که `check-feeds.mjs` روی همان سرور خوانده و شما `ok` کرده‌اید.', '- همیشه نام منبع + لینک؛ حداکثر ۱۲ کلمه نقل مستقیم؛ کپی متن کامل ممنوع.', '- خبر سیاسی، امنیتی و حادثه‌ای خودکار منتشر نمی‌شود (فهرست ممنوع در `growth/news/filters.json`).', '- روزی یک خبر؛ جمعه‌ها خلاصه‌ی ۵ تیتر؛ اگر خبر مناسبی نبود، پستی ساخته نمی‌شود.', '- خبرهایی که به قطعی/فیلتر مربوط‌اند علاوه بر کانال، به شما هشدار می‌دهند تا پست وضعیت یا آموزش بسازید.', '',
  '**فایل‌ها:** `growth/news/sources.json` (منابع)، `filters.json` (موضوع)، `check-feeds.mjs` (تست دریافت). فعلاً فقط یک منبع **تأییدنشده** (زومیت) در فهرست است؛ کانال‌ها و سایت‌های مورد نظر را شما بدهید.', '')
L.push('## ۶. مناسبت‌ها (فقط شمسی/فرهنگی و روزهای جهانی)', '', 'تاریخ‌ها از تقویم شمسی ثابت‌اند؛ پیش از هر سال با تقویم رسمی تطبیق دهید. «جشن» با کمپین واقعی پیشنهاد می‌گیرد؛ «فرهنگ» هرگز پیشنهاد ندارد؛ «فناوری» محتوای مفید است.', '', '| شمسی ۱۴۰۵ | میلادی | شمسی ۱۴۰۶ | میلادی | مناسبت | نوع | یادداشت |', '|---|---|---|---|---|---|---|')
const kinds = { celebration: 'جشن', culture: 'فرهنگ', tech: 'فناوری/امنیت', profession: 'روز حرفه', cat: 'روز گربه' }
for (const o of occasions) {
  const a = occRows.find((r) => r.o === o && r.jy === 1405), b = occRows.find((r) => r.o === o && r.jy === 1406)
  L.push(`| ${fmtJ(a.j)} | ${fmtG(a.g)} | ${fmtJ(b.j)} | ${fmtG(b.g)} | ${o.title} | ${kinds[o.kind]} | ${o.note} |`)
}
L.push('', `## ۷. اعتبارسنجی ساخت`, '', errors.length ? errors.map((x) => `- ❌ ${x}`).join('\n') : `- ✅ ${days.length} پست اصلی، ${occasions.length} مناسبت و قالب خبر؛ همه دلیل، شاخص و بنر دارند؛ هیچ واژه‌ی مذهبی/قمری نیست؛ ${jobs.length} بنر ساخته شد.`, '')
fs.writeFileSync(DOC, L.join('\n'))
console.log(errors.length ? errors.join('\n') : `ok: ${days.length} days, ${occasions.length} occasions, ${jobs.length} banners → ${OUT}`)
process.exit(errors.length ? 1 : 0)
