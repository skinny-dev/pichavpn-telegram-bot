// Picha channel banners — «Signal» design system (dark HUD / terminal look, one neon accent per category).
//   node render.mjs spec.json out.png     (spec: one object or an array → out-1.png, out-2.png …)
// spec: { theme, tag, title, subtitle, icon, extra[], badges[], cta, handle }
//   title may mark a keyword to glow: "اتصال [[پایدار]] برای هرچیزی"
// Every word comes from the spec (approved text); the banner never adds a claim. Icons: Lucide (+2 in the same style), see icons/README.md.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire('/opt/pw-browsers/')
const { chromium } = (() => { try { return require('playwright') } catch { return createRequire(import.meta.url)('playwright') } })()
const here = path.dirname(new URL(import.meta.url).pathname)

// one accent per content category (all pass contrast on #05080d)
export const THEMES = {
  cyan: { c: '#22d3ee', d: '#0e7490' },   // brand / acquisition / product
  green: { c: '#4ade80', d: '#15803d' },  // tutorials / how-to / good news
  amber: { c: '#fbbf24', d: '#b45309' },  // occasions / promotions
  pink: { c: '#f472b6', d: '#be185d' },   // referral / community
  red: { c: '#fb7185', d: '#be123c' },    // alerts / security / outage
  violet: { c: '#a78bfa', d: '#6d28d9' }, // news / analytics / education
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const iconBody = (name) => {
  const f = path.join(here, 'icons', String(name).replace(/[^a-z0-9-]/g, '') + '.svg')
  if (!fs.existsSync(f)) return ''
  const t = fs.readFileSync(f, 'utf8').replace(/<!--[\s\S]*?-->/g, '')
  return t.slice(t.indexOf('>', t.indexOf('<svg')) + 1, t.lastIndexOf('</svg>'))
}
const glyph = (name, cx, cy, size, sw, color, extra = '') =>
  `<g transform="translate(${cx - size / 2} ${cy - size / 2}) scale(${size / 24})" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" ${extra}>${iconBody(name)}</g>`
const LOGO = 'data:image/png;base64,' + fs.readFileSync(path.join(here, '../brand/picha-logo.png')).toString('base64')
const hash = (s) => [...String(s)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7)

// ---- surfaces shared with the panel (dashboard-src/src/index.css, dark): bg 222 32% 5%, card 222 28% 8%, border 215 20% 17%
const SURF = { bg: '#080b11', card: '#0d1118', border: '#232c3a', fg: '#eaf0f8', muted: '#97a6ba' }

// Yekan Bakh: drop its files into ../brand/fonts (any of woff2/ttf/otf with the weight in the name) and it is used automatically
const WEIGHTS = [[/black|heavy/i, 900], [/extra.?bold/i, 800], [/bold/i, 700], [/semi.?bold|demi/i, 600], [/medium/i, 500], [/light/i, 300], [/thin/i, 100], [/regular|normal|book/i, 400]]
const yekan = () => {
  const dir = path.join(here, '../brand/fonts')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((f) => /yekan/i.test(f) && /\.(woff2?|ttf|otf)$/i.test(f)).map((f) => ({ f, w: (WEIGHTS.find(([re]) => re.test(f)) || [0, 400])[1], fmt: /woff2$/i.test(f) ? 'woff2' : /woff$/i.test(f) ? 'woff' : /otf$/i.test(f) ? 'opentype' : 'truetype' }))
}
export const hasYekan = () => yekan().length > 0

export function html(s) {
  const th = THEMES[s.theme] || THEMES.cyan
  const len = String(s.title).replace(/\[\[|\]\]/g, '').length
  const h = len > 30 ? 54 : len > 20 ? 62 : 72
  const title = esc(s.title).replace(/\[\[(.+?)\]\]/g, '<em>$1</em>')
  const badges = (s.badges || []).slice(0, 3).map((b) => `<span class="chip">${esc(b)}</span>`).join('')
  const extras = (s.extra || []).slice(0, 3).map((n) => `<div class="cell sm"><svg width="64" height="64" viewBox="0 0 64 64">${glyph(n, 32, 32, 40, 1.7, th.c)}</svg></div>`).join('')
  const yf = yekan().map((x) => `@font-face{font-family:Y;src:url('file://${path.join(here, '../brand/fonts', x.f)}') format('${x.fmt}');font-weight:${x.w}}`).join('\n')
  return `<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><style>
${yf}
@font-face{font-family:V;src:url('file://${here}/fonts/vazirmatn-arabic.woff2') format('woff2');unicode-range:U+0600-06FF,U+200C-200D,U+FB50-FDFF,U+FE70-FEFF;font-weight:100 900}
@font-face{font-family:V;src:url('file://${here}/fonts/vazirmatn-latin.woff2') format('woff2');unicode-range:U+0000-00FF;font-weight:100 900}
@font-face{font-family:M;src:url('file://${here}/fonts/mono-500.woff2') format('woff2');font-weight:500}
@font-face{font-family:M;src:url('file://${here}/fonts/mono-700.woff2') format('woff2');font-weight:700}
*{box-sizing:border-box;margin:0}
html{width:1280px;height:720px;overflow:hidden}
body{width:1280px;height:720px;font-family:${yekan().length ? 'Y,' : ''}V,sans-serif;color:${SURF.fg};position:relative;overflow:hidden;background:${SURF.bg};
 background-image:linear-gradient(${th.c}09 1px,transparent 1px),linear-gradient(90deg,${th.c}09 1px,transparent 1px);background-size:40px 40px}
/* chamfered frame: the border is the outer shape, the surface the inner one (same idea as the panel's cards) */
.frame{position:absolute;left:36px;top:36px;right:36px;bottom:36px;background:${SURF.border};clip-path:polygon(28px 0,100% 0,100% calc(100% - 28px),calc(100% - 28px) 100%,0 100%,0 28px)}
.frame i{position:absolute;inset:1px;background:${SURF.card};clip-path:polygon(27.4px 0,100% 0,100% calc(100% - 27.4px),calc(100% - 27.4px) 100%,0 100%,0 27.4px)}
.cell{position:absolute;background:${SURF.border};clip-path:polygon(14px 0,100% 0,100% calc(100% - 14px),calc(100% - 14px) 100%,0 100%,0 14px)}
.cell::before{content:'';position:absolute;inset:1px;background:${SURF.bg};clip-path:polygon(13.4px 0,100% 0,100% calc(100% - 13.4px),calc(100% - 13.4px) 100%,0 100%,0 13.4px)}
.cell svg{position:absolute;inset:0;margin:auto}
.hero{left:84px;top:84px;width:440px;height:352px}
.hero::after{content:'';position:absolute;left:1px;top:1px;width:72px;height:3px;background:${th.c}}
.hero .lab{position:absolute;left:22px;bottom:16px;z-index:2;font:500 15px M,monospace;color:${SURF.muted};direction:ltr;letter-spacing:.06em;text-transform:uppercase}
.hero svg{z-index:1}
.row3{position:absolute;left:84px;top:456px;display:flex;gap:16px}
.cell.sm{position:relative;width:136px;height:136px}
.col{position:absolute;right:84px;top:84px;bottom:84px;width:600px;display:flex;flex-direction:column}
.top{display:flex;justify-content:space-between;align-items:center}
.brand{display:flex;align-items:center;gap:14px;font-weight:800;font-size:30px}
.mark{width:52px;height:52px;display:grid;place-items:center;background:${SURF.bg};border:1px solid ${SURF.border};border-radius:8px}
.tag{font:500 18px M,monospace;color:${th.c};direction:ltr;letter-spacing:.06em;text-transform:uppercase}
.mid{flex:1;display:flex;flex-direction:column;justify-content:center;gap:18px}
h1{font-size:${h}px;line-height:1.3;font-weight:800;text-wrap:balance}
h1 em{font-style:normal;color:${th.c}}
p.sub{text-wrap:balance;font-size:28px;line-height:1.7;font-weight:500;color:${SURF.muted}}
.chips{display:flex;gap:10px;flex-wrap:nowrap}
.chip{font-size:22px;font-weight:600;color:${SURF.fg};padding:7px 16px;border-radius:6px;border:1px solid ${SURF.border};background:${SURF.bg};white-space:nowrap}
.row{display:flex;justify-content:space-between;align-items:center;margin-top:20px}
.cta{white-space:nowrap;font-weight:800;font-size:28px;color:${SURF.bg};background:${th.c};padding:12px 30px;clip-path:polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)}
.handle{font:500 21px M,monospace;color:${SURF.muted};direction:ltr}
</style><body><div class="frame"><i></i></div>
<div class="cell hero"><svg width="352" height="352" viewBox="0 0 352 352">${glyph(s.icon, 176, 176, 232, 0.95, th.c)}</svg></div>
<div class="row3">${extras}</div>
<div class="col">
 <div class="top"><div class="brand"><div class="mark"><img src="${LOGO}" width="34" height="34"></div>پیچا</div><div class="tag">${esc(s.tag || 'picha')}</div></div>
 <div class="mid"><h1>${title}</h1>${s.subtitle ? `<p class="sub">${esc(s.subtitle)}</p>` : ''}</div>
 ${badges ? `<div class="chips">${badges}</div>` : ''}
 <div class="row"><span class="handle">${esc(s.handle || '@pichanet_bot')}</span>${s.cta ? `<span class="cta">${esc(s.cta)} ←</span>` : ''}</div>
</div></body></html>`
}

export async function render(specs, outBase) {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const list = Array.isArray(specs) ? specs : [specs]
  const outs = []
  for (const [i, s] of list.entries()) {
    const f = path.join(here, `.tmp-${process.pid}.html`)
    fs.writeFileSync(f, html(s))
    await page.goto('file://' + f)
    await page.evaluate(() => document.fonts.ready)
    const out = list.length > 1 ? outBase.replace(/(\.png)?$/, `-${i + 1}.png`) : outBase
    await page.screenshot({ path: out })
    fs.unlinkSync(f)
    outs.push(out)
  }
  await browser.close()
  return outs
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [spec, out] = process.argv.slice(2)
  if (!spec || !out) { console.error('usage: node render.mjs spec.json out.png'); process.exit(1) }
  console.log((await render(JSON.parse(fs.readFileSync(spec, 'utf8')), out)).join('\n'))
}
