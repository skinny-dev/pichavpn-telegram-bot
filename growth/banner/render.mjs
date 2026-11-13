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

function art(s, th) {
  const W = 540, cx = 270, cy = 280
  const ticks = Array.from({ length: 72 }, (_, i) => {
    const a = (i * 5 * Math.PI) / 180, r1 = 236, r2 = i % 6 === 0 ? 252 : 244
    return `<line x1="${cx + r1 * Math.cos(a)}" y1="${cy + r1 * Math.sin(a)}" x2="${cx + r2 * Math.cos(a)}" y2="${cy + r2 * Math.sin(a)}" stroke="${th.c}" stroke-opacity="${i % 6 === 0 ? 0.7 : 0.28}" stroke-width="${i % 6 === 0 ? 2 : 1.5}"/>`
  }).join('')
  const hex = (r) => Array.from({ length: 6 }, (_, i) => { const a = (Math.PI / 3) * i - Math.PI / 2; return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}` }).join(' ')
  const angles = [-38, 38, 150]
  const orbit = (s.extra || []).slice(0, 3).map((n, i) => {
    const a = (angles[i] * Math.PI) / 180, x = cx + 232 * Math.cos(a), y = cy + 232 * Math.sin(a)
    return `<circle cx="${x}" cy="${y}" r="40" fill="#05080d" stroke="${th.c}" stroke-opacity=".9" stroke-width="2"/><circle cx="${x}" cy="${y}" r="48" fill="none" stroke="${th.c}" stroke-opacity=".25"/>${glyph(n, x, y, 38, 1.8, th.c)}`
  }).join('')
  return `<svg class="art" width="${W}" height="560" viewBox="0 0 ${W} 560" xmlns="http://www.w3.org/2000/svg">
<defs><radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${th.c}" stop-opacity=".30"/><stop offset="1" stop-color="${th.c}" stop-opacity="0"/></radialGradient>
<filter id="neon" filterUnits="userSpaceOnUse" x="0" y="0" width="540" height="560"><feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
<circle cx="${cx}" cy="${cy}" r="262" fill="url(#g)"/>
<circle cx="${cx}" cy="${cy}" r="226" fill="none" stroke="${th.c}" stroke-opacity=".30" stroke-dasharray="3 9" stroke-width="2"/>
${ticks}
<circle cx="${cx}" cy="${cy}" r="176" fill="none" stroke="${th.c}" stroke-opacity=".18" stroke-width="1.5"/>
<polygon points="${hex(158)}" fill="${th.c}" fill-opacity=".07" stroke="${th.c}" stroke-opacity=".75" stroke-width="2.5" stroke-linejoin="round"/>
<polygon points="${hex(128)}" fill="none" stroke="${th.c}" stroke-opacity=".28" stroke-width="1.5" stroke-linejoin="round"/>
<g filter="url(#neon)">${glyph(s.icon, cx, cy, 168, 1.15, th.c)}</g>
${orbit}
<g font-family="M,monospace" font-size="15" fill="${th.c}" fill-opacity=".7" direction="ltr"><text x="${cx - 232}" y="${cy + 262}">SIG // ${esc(String(s.tag || 'PICHA').toUpperCase())}</text><text x="${cx + 92}" y="${cy + 262}">${String(hash(s.title) % 9000 + 1000)}</text></g>
</svg>`
}

export function html(s) {
  const th = THEMES[s.theme] || THEMES.cyan
  const len = String(s.title).replace(/\[\[|\]\]/g, '').length
  const h = len > 34 ? 56 : len > 24 ? 64 : 74
  const title = esc(s.title).replace(/\[\[(.+?)\]\]/g, '<em>$1</em>')
  const bits = Array.from({ length: 3 }, (_, i) => Array.from({ length: 26 }, (_, j) => ((hash(s.title) >> ((i * 7 + j) % 24)) & 1)).join(' ')).map((t) => `<div>${t}</div>`).join('')
  const badges = (s.badges || []).slice(0, 3).map((b) => `<span class="chip"><i>[</i>${esc(b)}<i>]</i></span>`).join('')
  return `<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><style>
@font-face{font-family:V;src:url('file://${here}/fonts/vazirmatn-arabic.woff2') format('woff2');unicode-range:U+0600-06FF,U+200C-200D,U+FB50-FDFF,U+FE70-FEFF;font-weight:100 900}
@font-face{font-family:V;src:url('file://${here}/fonts/vazirmatn-latin.woff2') format('woff2');unicode-range:U+0000-00FF;font-weight:100 900}
@font-face{font-family:M;src:url('file://${here}/fonts/mono-500.woff2') format('woff2');font-weight:500}
@font-face{font-family:M;src:url('file://${here}/fonts/mono-700.woff2') format('woff2');font-weight:700}
*{box-sizing:border-box;margin:0}
html{width:1280px;height:720px;overflow:hidden}
body{width:1280px;height:720px;font-family:V,sans-serif;color:#eef6ff;position:relative;overflow:hidden;background:#05080d}
.bg{position:absolute;inset:0;overflow:hidden;
 background:radial-gradient(620px 520px at 22% 50%,${th.c}2e,transparent 70%),radial-gradient(500px 360px at 100% 100%,${th.d}40,transparent 70%)}
.grid{position:absolute;inset:0;background-image:linear-gradient(${th.c}12 1px,transparent 1px),linear-gradient(90deg,${th.c}12 1px,transparent 1px);background-size:48px 48px;mask-image:radial-gradient(900px 600px at 40% 50%,#000 20%,transparent 80%)}
.scan{position:absolute;inset:0;background:repeating-linear-gradient(0deg,rgba(0,0,0,.20) 0 1px,transparent 1px 4px);mix-blend-mode:multiply}
.bits{position:absolute;left:34px;top:46px;font:500 15px/1.9 M,monospace;color:${th.c};opacity:.10;direction:ltr;letter-spacing:3px}
.frame{position:absolute;inset:26px;border:1px solid ${th.c}44;border-radius:22px}
.cn{position:absolute;width:34px;height:34px;border:3px solid ${th.c}}
.cn.a{left:20px;top:20px;border-right:0;border-bottom:0;border-radius:14px 0 0 0}.cn.b{right:20px;top:20px;border-left:0;border-bottom:0;border-radius:0 14px 0 0}
.cn.c{left:20px;bottom:20px;border-right:0;border-top:0;border-radius:0 0 0 14px}.cn.d{right:20px;bottom:20px;border-left:0;border-top:0;border-radius:0 0 14px 0}
.art{position:absolute;left:40px;top:70px}
.col{position:absolute;right:76px;top:66px;bottom:64px;width:600px;display:flex;flex-direction:column}
.top{display:flex;justify-content:space-between;align-items:center}
.brand{display:flex;align-items:center;gap:14px;font-weight:800;font-size:32px}
.mark{width:58px;height:58px;border:2.5px solid ${th.c};border-radius:14px;display:grid;place-items:center;box-shadow:0 0 22px ${th.c}55 inset,0 0 18px ${th.c}33}
.tag{font:700 20px M,monospace;color:${th.c};direction:ltr;letter-spacing:1px;padding:7px 14px;border:1.5px solid ${th.c}66;border-radius:8px;background:${th.c}12}
.tag b{opacity:.6}
.mid{flex:1;display:flex;flex-direction:column;justify-content:center;gap:16px}
h1{font-size:${h}px;line-height:1.28;font-weight:900;letter-spacing:-.2px}
h1 em{font-style:normal;color:${th.c};text-shadow:0 0 28px ${th.c}99,0 0 6px ${th.c}66}
p.sub{text-wrap:balance;font-size:28px;line-height:1.7;font-weight:500;color:#c9d6e6}
.chips{display:flex;gap:12px;flex-wrap:nowrap}
.chip{font-size:23px;font-weight:700;color:#eef6ff;padding:8px 16px;border-radius:10px;background:${th.c}14;border:1.5px solid ${th.c}55;white-space:nowrap}
.chip i{font:700 22px M,monospace;color:${th.c};font-style:normal;margin:0 5px;opacity:.9}
.row{display:flex;justify-content:space-between;align-items:center;margin-top:18px;padding-top:16px;border-top:1px dashed ${th.c}44}
.cta{white-space:nowrap;font-weight:900;font-size:29px;color:#05080d;background:${th.c};border-radius:12px;padding:11px 26px;box-shadow:0 0 30px ${th.c}77}
.status{font:700 21px M,monospace;color:#9fb3c8;direction:ltr;display:flex;align-items:center;gap:10px}
.status u{width:11px;height:11px;border-radius:50%;background:#4ade80;box-shadow:0 0 12px #4ade80;display:inline-block}
</style><body><div class="bg"><div class="grid"></div><div class="bits">${bits}</div><div class="scan"></div></div>
<div class="frame"></div><div class="cn a"></div><div class="cn b"></div><div class="cn c"></div><div class="cn d"></div>
${art(s, th)}
<div class="col">
 <div class="top"><div class="brand"><div class="mark"><img src="${LOGO}" width="42" height="42"></div>پیچا</div><div class="tag"><b>&gt;</b> ${esc(s.tag || 'picha')}</div></div>
 <div class="mid"><h1>${title}</h1>${s.subtitle ? `<p class="sub">${esc(s.subtitle)}</p>` : ''}</div>
 ${badges ? `<div class="chips">${badges}</div>` : ''}
 <div class="row"><div class="status"><u></u>${esc(s.handle || '@pichanet_bot')}</div>${s.cta ? `<span class="cta">${esc(s.cta)} ←</span>` : ''}</div>
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
