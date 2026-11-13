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
const WEIGHTS = [[/black|heavy/i, 900], [/extra.?bold/i, 800], [/bold/i, 700], [/semi.?bold|demi/i, 600], [/medium/i, 500], [/light/i, 300], [/thin/i, 100], [/regular|normal|book/i, 400]]
const yekan = () => {
  const dir = path.join(here, '../brand/fonts')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((f) => /yekan/i.test(f) && /\.(woff2?|ttf|otf)$/i.test(f)).map((f) => ({ f, w: (WEIGHTS.find(([re]) => re.test(f)) || [0, 400])[1], fmt: /woff2$/i.test(f) ? 'woff2' : /woff$/i.test(f) ? 'woff' : /otf$/i.test(f) ? 'opentype' : 'truetype' }))
}
export const hasYekan = () => yekan().length > 0
const hash = (s) => [...String(s)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7)


// ---- content-matched illustrations (drawn in the accent colour; each sits inside the hexagon, around (cx, cy))
const SC = {
  phone: (th, s, cx, cy) => `
    <rect x="${cx - 66}" y="${cy - 118}" width="132" height="236" rx="26" fill="#060a10" stroke="${th.c}" stroke-width="3.5"/>
    <rect x="${cx - 22}" y="${cy - 106}" width="44" height="7" rx="3.5" fill="${th.c}" fill-opacity=".5"/>
    <circle cx="${cx}" cy="${cy - 26}" r="36" fill="${th.c}" fill-opacity=".12" stroke="${th.c}" stroke-width="3.5"/>
    <path d="M${cx} ${cy - 46}v18M${cx - 14} ${cy - 40}a22 22 0 1 0 28 0" fill="none" stroke="${th.c}" stroke-width="4" stroke-linecap="round"/>
    <rect x="${cx - 40}" y="${cy + 28}" width="80" height="22" rx="11" fill="${th.c}" fill-opacity=".22" stroke="${th.c}" stroke-opacity=".8" stroke-width="1.5"/>
    <circle cx="${cx + 26}" cy="${cy + 39}" r="5" fill="${th.c}"/>
    <rect x="${cx - 44}" y="${cy + 66}" width="88" height="7" rx="3.5" fill="${th.c}" fill-opacity=".35"/>
    <rect x="${cx - 30}" y="${cy + 82}" width="60" height="7" rx="3.5" fill="${th.c}" fill-opacity=".2"/>`,
  shield: (th, s, cx, cy) => `
    <path d="M${cx} ${cy - 124}L${cx + 92} ${cy - 88}V${cy - 8}C${cx + 92} ${cy + 62} ${cx + 46} ${cy + 104} ${cx} ${cy + 124}C${cx - 46} ${cy + 104} ${cx - 92} ${cy + 62} ${cx - 92} ${cy - 8}V${cy - 88}Z" fill="${th.c}" fill-opacity=".08" stroke="${th.c}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M${cx} ${cy - 96}L${cx + 68} ${cy - 70}V${cy - 6}C${cx + 68} ${cy + 48} ${cx + 34} ${cy + 80} ${cx} ${cy + 96}C${cx - 34} ${cy + 80} ${cx - 68} ${cy + 48} ${cx - 68} ${cy - 6}V${cy - 70}Z" fill="none" stroke="${th.c}" stroke-opacity=".4" stroke-width="1.5"/>
    <path d="M${cx - 36} ${cy + 2}L${cx - 8} ${cy + 30}L${cx + 40} ${cy - 28}" fill="none" stroke="${th.c}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>
    <g stroke="${th.c}" stroke-opacity=".35" stroke-width="2" stroke-linecap="round"><path d="M${cx - 50} ${cy + 58}h100"/><path d="M${cx - 34} ${cy + 72}h68"/></g>`,
  // poll: option rows only (no numbers — a poll banner must never show made-up results); pass `values: [52, 28, 20]` (real results) to draw result bars
  poll: (th, s, cx, cy) => {
    const vals = Array.isArray(s.values) ? s.values.slice(0, 3) : null
    const top = Math.max(...(vals || [1]), 1)
    return [0, 1, 2].map((i) => {
      const y = cy - 92 + i * 66, x0 = cx - 100, W = 212
      if (!vals) return `<rect x="${x0}" y="${y}" width="${W}" height="46" rx="10" fill="${th.c}" fill-opacity=".10" stroke="${th.c}" stroke-opacity=".6" stroke-width="2"/>
        <circle cx="${x0 + W - 26}" cy="${y + 23}" r="11" fill="none" stroke="${th.c}" stroke-width="3"/>
        <rect x="${x0 + 20}" y="${y + 19}" width="${[96, 74, 118][i]}" height="8" rx="4" fill="${th.c}" fill-opacity=".55"/>`
      const w = Math.max(60, (W * vals[i]) / top), x = x0 + W - w, on = vals[i] === top
      return `<rect x="${x}" y="${y}" width="${w}" height="46" rx="10" fill="${th.c}" fill-opacity="${on ? 0.9 : 0.16}" stroke="${th.c}" stroke-opacity="${on ? 1 : 0.55}" stroke-width="2"/>
        <text x="${x + 14}" y="${y + 31}" font-family="V,M,sans-serif" font-size="24" font-weight="800" fill="${on ? '#05080d' : '#eef6ff'}" direction="ltr">${esc(String(vals[i]).replace(/\d/g, (c) => '۰۱۲۳۴۵۶۷۸۹'[c]))}٪</text>`
    }).join('')
  },
  chat: (th, s, cx, cy) => `
    <path d="M${cx - 6} ${cy - 106}h104a18 18 0 0 1 18 18v36a18 18 0 0 1-18 18h-80l-22 20v-20h-2a18 18 0 0 1-18-18v-36a18 18 0 0 1 18-18Z" transform="translate(-14 0)" fill="${th.c}" fill-opacity=".2" stroke="${th.c}" stroke-width="3"/>
    <rect x="${cx - 14}" y="${cy - 88}" width="78" height="7" rx="3.5" fill="${th.c}" fill-opacity=".8"/><rect x="${cx - 14}" y="${cy - 72}" width="56" height="7" rx="3.5" fill="${th.c}" fill-opacity=".5"/>
    <path d="M${cx - 96} ${cy - 10}h104a18 18 0 0 1 18 18v38a18 18 0 0 1-18 18h-70l-20 18v-18h-14a18 18 0 0 1-18-18v-38a18 18 0 0 1 18-18Z" transform="translate(-6 0)" fill="#060a10" stroke="${th.c}" stroke-opacity=".75" stroke-width="3"/>
    <path d="M${cx - 70} ${cy + 26}l11 11 22-24" fill="none" stroke="${th.c}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="${cx - 34}" y="${cy + 18}" width="40" height="7" rx="3.5" fill="${th.c}" fill-opacity=".5"/>
    <g fill="${th.c}"><circle cx="${cx + 52}" cy="${cy + 100}" r="6"/><circle cx="${cx + 72}" cy="${cy + 100}" r="6" fill-opacity=".6"/><circle cx="${cx + 92}" cy="${cy + 100}" r="6" fill-opacity=".3"/></g>`,
  calendar: (th, s, cx, cy) => `
    <rect x="${cx - 112}" y="${cy - 118}" width="224" height="244" rx="20" fill="#060a10" stroke="${th.c}" stroke-width="3.5"/>
    <path d="M${cx - 112} ${cy - 62}V${cy - 98}a20 20 0 0 1 20-20h184a20 20 0 0 1 20 20v36Z" fill="${th.c}"/>
    <rect x="${cx - 64}" y="${cy - 136}" width="12" height="38" rx="6" fill="#060a10" stroke="${th.c}" stroke-width="3"/><rect x="${cx + 52}" y="${cy - 136}" width="12" height="38" rx="6" fill="#060a10" stroke="${th.c}" stroke-width="3"/>
    <text x="${cx}" y="${cy - 80}" text-anchor="middle" font-family="V,sans-serif" font-size="34" font-weight="900" fill="#05080d">${esc((s.date || [])[1] || '')}</text>
    <text x="${cx}" y="${cy + 66}" text-anchor="middle" font-family="V,sans-serif" font-size="128" font-weight="900" fill="#eef6ff">${esc((s.date || [])[0] || '')}</text>
    ${glyph(s.icon, cx + 78, cy + 96, 38, 1.7, th.c)}`,
  gift: (th, s, cx, cy) => {
    const bits = Array.from({ length: 14 }, (_, i) => { const h = hash(s.title + i), a = ((h % 360) * Math.PI) / 180, r = 128 + (h % 26), x = cx + r * Math.cos(a), y = cy + r * Math.sin(a), rot = h % 90, k = h % 3
      return k === 0 ? `<rect x="${x - 6}" y="${y - 3}" width="12" height="6" rx="1.5" transform="rotate(${rot} ${x} ${y})" fill="${th.c}" fill-opacity="${0.5 + (h % 5) / 10}"/>` : k === 1 ? `<circle cx="${x}" cy="${y}" r="4.5" fill="${th.c}" fill-opacity=".7"/>` : `<path d="M${x} ${y - 7}l6 11h-12Z" transform="rotate(${rot} ${x} ${y})" fill="#eef6ff" fill-opacity=".6"/>` }).join('')
    return bits + glyph('gift', cx, cy, 150, 1.25, th.c)
  },
}

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
<g filter="url(#neon)">${SC[s.scene] ? SC[s.scene](th, s, cx, cy) : glyph(s.icon, cx, cy, 168, 1.15, th.c)}</g>
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
${yekan().map((x) => `@font-face{font-family:Y;src:url('file://${path.join(here, '../brand/fonts', x.f)}') format('${x.fmt}');font-weight:${x.w}}`).join('\n')}
@font-face{font-family:V;src:url('file://${here}/fonts/vazirmatn-arabic.woff2') format('woff2');unicode-range:U+0600-06FF,U+200C-200D,U+FB50-FDFF,U+FE70-FEFF;font-weight:100 900}
@font-face{font-family:V;src:url('file://${here}/fonts/vazirmatn-latin.woff2') format('woff2');unicode-range:U+0000-00FF;font-weight:100 900}
@font-face{font-family:M;src:url('file://${here}/fonts/mono-500.woff2') format('woff2');font-weight:500}
@font-face{font-family:M;src:url('file://${here}/fonts/mono-700.woff2') format('woff2');font-weight:700}
*{box-sizing:border-box;margin:0}
html{width:1280px;height:720px;overflow:hidden}
body{width:1280px;height:720px;font-family:${yekan().length ? 'Y,' : ''}V,sans-serif;color:#eef6ff;position:relative;overflow:hidden;background:#05080d}
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
