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
const BG = '#05080d'
const mix = (a, b, t) => { const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); const [x, y] = [p(a), p(b)]; return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('') }
// one corner language: big shapes are cut (chamfered) at top-left and bottom-right, exactly like the panel's cards
const cut = (x, y, w, h, c) => `M${x + c} ${y}H${x + w}V${y + h - c}L${x + w - c} ${y + h}H${x}V${y + c}Z`
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
    <rect x="${cx - 66}" y="${cy - 118}" width="132" height="236" rx="24" fill="${th.p}" stroke="${th.c}" stroke-width="3.5"/>
    <rect x="${cx - 22}" y="${cy - 106}" width="44" height="7" rx="3.5" fill="${th.c}" fill-opacity=".5"/>
    <circle cx="${cx}" cy="${cy - 26}" r="36" fill="${th.c}" fill-opacity=".12" stroke="${th.c}" stroke-width="3.5"/>
    <path d="M${cx} ${cy - 46}v18M${cx - 14} ${cy - 40}a22 22 0 1 0 28 0" fill="none" stroke="${th.c}" stroke-width="4" stroke-linecap="round"/>
    <path d="${cut(cx - 40, cy + 28, 80, 22, 7)}" fill="${th.c}" fill-opacity=".22" stroke="${th.c}" stroke-opacity=".8" stroke-width="1.5" stroke-linejoin="round"/>
    <circle cx="${cx + 26}" cy="${cy + 39}" r="5" fill="${th.c}"/>
    <rect x="${cx - 44}" y="${cy + 66}" width="88" height="7" rx="3.5" fill="${th.c}" fill-opacity=".35"/>
    <rect x="${cx - 30}" y="${cy + 82}" width="60" height="7" rx="3.5" fill="${th.c}" fill-opacity=".2"/>`,
  shield: (th, s, cx, cy) => `
    <path d="M${cx} ${cy - 124}L${cx + 92} ${cy - 88}V${cy - 8}C${cx + 92} ${cy + 62} ${cx + 46} ${cy + 104} ${cx} ${cy + 124}C${cx - 46} ${cy + 104} ${cx - 92} ${cy + 62} ${cx - 92} ${cy - 8}V${cy - 88}Z" fill="${th.p}" stroke="${th.c}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M${cx} ${cy - 96}L${cx + 68} ${cy - 70}V${cy - 6}C${cx + 68} ${cy + 48} ${cx + 34} ${cy + 80} ${cx} ${cy + 96}C${cx - 34} ${cy + 80} ${cx - 68} ${cy + 48} ${cx - 68} ${cy - 6}V${cy - 70}Z" fill="none" stroke="${th.c}" stroke-opacity=".4" stroke-width="1.5"/>
    <path d="M${cx - 36} ${cy + 2}L${cx - 8} ${cy + 30}L${cx + 40} ${cy - 28}" fill="none" stroke="${th.c}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>
    <g stroke="${th.c}" stroke-opacity=".35" stroke-width="2" stroke-linecap="round"><path d="M${cx - 50} ${cy + 58}h100"/><path d="M${cx - 34} ${cy + 72}h68"/></g>`,
  // poll: option rows only (no numbers — a poll banner must never show made-up results); pass `values: [52, 28, 20]` (real results) to draw result bars
  poll: (th, s, cx, cy) => {
    const vals = Array.isArray(s.values) ? s.values.slice(0, 3) : null
    const top = Math.max(...(vals || [1]), 1)
    return [0, 1, 2].map((i) => {
      const y = cy - 92 + i * 66, x0 = cx - 100, W = 212
      if (!vals) return `<path d="${cut(x0, y, W, 46, 12)}" fill="${th.p}" stroke="${th.c}" stroke-opacity=".6" stroke-width="2" stroke-linejoin="round"/>
        <circle cx="${x0 + W - 28}" cy="${y + 23}" r="11" fill="none" stroke="${th.c}" stroke-width="3"/>
        <rect x="${x0 + 20}" y="${y + 19}" width="${[96, 74, 118][i]}" height="8" rx="4" fill="${th.c}" fill-opacity=".55"/>`
      const w = Math.max(60, (W * vals[i]) / top), x = x0 + W - w, on = vals[i] === top
      return `<path d="${cut(x, y, w, 46, 12)}" fill="${on ? th.c : th.p}" stroke="${th.c}" stroke-opacity="${on ? 1 : 0.6}" stroke-width="2" stroke-linejoin="round"/>
        <text x="${x + 16}" y="${y + 31}" font-family="V,M,sans-serif" font-size="24" font-weight="800" fill="${on ? BG : '#eef6ff'}" direction="ltr">${esc(String(vals[i]).replace(/\d/g, (c) => '۰۱۲۳۴۵۶۷۸۹'[c]))}٪</text>`
    }).join('')
  },
  chat: (th, s, cx, cy) => `
    <path d="M${cx - 20} ${cy - 106}h104a18 18 0 0 1 18 18v36a18 18 0 0 1-18 18h-80l-22 20v-20h-2a18 18 0 0 1-18-18v-36a18 18 0 0 1 18-18Z" fill="${th.p}" stroke="${th.c}" stroke-width="3"/>
    <rect x="${cx - 20}" y="${cy - 88}" width="78" height="7" rx="3.5" fill="${th.c}" fill-opacity=".8"/><rect x="${cx - 20}" y="${cy - 72}" width="56" height="7" rx="3.5" fill="${th.c}" fill-opacity=".5"/>
    <path d="M${cx - 102} ${cy - 10}h104a18 18 0 0 1 18 18v38a18 18 0 0 1-18 18h-70l-20 18v-18h-14a18 18 0 0 1-18-18v-38a18 18 0 0 1 18-18Z" fill="${th.p}" stroke="${th.c}" stroke-opacity=".75" stroke-width="3"/>
    <path d="M${cx - 76} ${cy + 26}l11 11 22-24" fill="none" stroke="${th.c}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="${cx - 40}" y="${cy + 18}" width="40" height="7" rx="3.5" fill="${th.c}" fill-opacity=".5"/>
    <g fill="${th.c}"><circle cx="${cx + 52}" cy="${cy + 100}" r="6"/><circle cx="${cx + 72}" cy="${cy + 100}" r="6" fill-opacity=".6"/><circle cx="${cx + 92}" cy="${cy + 100}" r="6" fill-opacity=".3"/></g>`,
  calendar: (th, s, cx, cy) => `
    <path d="${cut(cx - 112, cy - 118, 224, 244, 24)}" fill="${th.p}" stroke="${th.c}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M${cx - 88} ${cy - 118}H${cx + 112}V${cy - 62}H${cx - 112}V${cy - 94}Z" fill="${th.c}"/>
    <rect x="${cx - 64}" y="${cy - 136}" width="12" height="38" rx="6" fill="${th.p}" stroke="${th.c}" stroke-width="3"/><rect x="${cx + 52}" y="${cy - 136}" width="12" height="38" rx="6" fill="${th.p}" stroke="${th.c}" stroke-width="3"/>
    <text x="${cx}" y="${cy - 80}" text-anchor="middle" font-family="V,sans-serif" font-size="34" font-weight="900" fill="${BG}">${esc((s.date || [])[1] || '')}</text>
    <text x="${cx}" y="${cy + 66}" text-anchor="middle" font-family="V,sans-serif" font-size="128" font-weight="900" fill="#eef6ff">${esc((s.date || [])[0] || '')}</text>
    ${glyph(s.icon, cx + 78, cy + 96, 38, 1.7, th.c)}`,
  gift: (th, s, cx, cy) => {
    const bits = Array.from({ length: 14 }, (_, i) => { const h = hash(s.title + i), a = ((h % 360) * Math.PI) / 180, r = 128 + (h % 26), x = cx + r * Math.cos(a), y = cy + r * Math.sin(a), rot = h % 90, k = h % 3
      return k === 0 ? `<rect x="${x - 6}" y="${y - 3}" width="12" height="6" rx="1.5" transform="rotate(${rot} ${x} ${y})" fill="${th.c}" fill-opacity="${0.5 + (h % 5) / 10}"/>` : k === 1 ? `<circle cx="${x}" cy="${y}" r="4.5" fill="${th.c}" fill-opacity=".7"/>` : `<path d="M${x} ${y - 7}l6 11h-12Z" transform="rotate(${rot} ${x} ${y})" fill="#eef6ff" fill-opacity=".6"/>` }).join('')
    return bits + glyph('gift', cx, cy, 150, 1.25, th.c)
  },
}

function art(s, th0) {
  const th = th0.p ? th0 : { ...th0, p: mix(BG, th0.c, 0.1), p2: mix(BG, th0.c, 0.045), p3: mix(BG, th0.c, 0.075) }
  const W = 540, cx = 270, cy = 280
  const ticks = Array.from({ length: 72 }, (_, i) => {
    const a = (i * 5 * Math.PI) / 180, r1 = 236, r2 = i % 6 === 0 ? 252 : 244
    return `<line x1="${cx + r1 * Math.cos(a)}" y1="${cy + r1 * Math.sin(a)}" x2="${cx + r2 * Math.cos(a)}" y2="${cy + r2 * Math.sin(a)}" stroke="${th.c}" stroke-opacity="${i % 6 === 0 ? 0.7 : 0.28}" stroke-width="${i % 6 === 0 ? 2 : 1.5}"/>`
  }).join('')
  const hex = (r) => Array.from({ length: 6 }, (_, i) => { const a = (Math.PI / 3) * i - Math.PI / 2; return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}` }).join(' ')
  const angles = [-38, 38, 150]
  const orbit = (s.extra || []).slice(0, 3).map((n, i) => {
    const a = (angles[i] * Math.PI) / 180, x = cx + 232 * Math.cos(a), y = cy + 232 * Math.sin(a)
    return `<circle cx="${x}" cy="${y}" r="40" fill="${th.p}" stroke="${th.c}" stroke-opacity=".9" stroke-width="2"/><circle cx="${x}" cy="${y}" r="48" fill="none" stroke="${th.c}" stroke-opacity=".25"/>${glyph(n, x, y, 38, 1.8, th.c)}`
  }).join('')
  return `<svg class="art" width="${W}" height="560" viewBox="0 0 ${W} 560" xmlns="http://www.w3.org/2000/svg">
<defs><radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${th.c}" stop-opacity=".30"/><stop offset="1" stop-color="${th.c}" stop-opacity="0"/></radialGradient>
<filter id="neon" filterUnits="userSpaceOnUse" x="0" y="0" width="540" height="560"><feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
<circle cx="${cx}" cy="${cy}" r="262" fill="url(#g)"/>
<circle cx="${cx}" cy="${cy}" r="226" fill="none" stroke="${th.c}" stroke-opacity=".30" stroke-dasharray="3 9" stroke-width="2"/>
${ticks}
<circle cx="${cx}" cy="${cy}" r="176" fill="none" stroke="${th.c}" stroke-opacity=".18" stroke-width="1.5"/>
${s.scene === 'calendar' ? '' : `<polygon points="${hex(158)}" fill="${th.p3}" stroke="${th.c}" stroke-opacity=".75" stroke-width="2.5" stroke-linejoin="round"/>
<polygon points="${hex(128)}" fill="none" stroke="${th.c}" stroke-opacity=".28" stroke-width="1.5" stroke-linejoin="round"/>`}
<g filter="url(#neon)">${SC[s.scene] ? SC[s.scene](th, s, cx, cy) : glyph(s.icon, cx, cy, 168, 1.15, th.c)}</g>
${orbit}
<g font-family="M,monospace" font-size="15" fill="${th.c}" fill-opacity=".7" direction="ltr"><text x="${cx - 232}" y="${cy + 262}">SIG // ${esc(String(s.tag || 'PICHA').toUpperCase())}</text><text x="${cx + 92}" y="${cy + 262}">${String(hash(s.title) % 9000 + 1000)}</text></g>
</svg>`
}

export function html(s) {
  const base = THEMES[s.theme] || THEMES.cyan
  const th = { ...base, p: mix(BG, base.c, 0.1), p2: mix(BG, base.c, 0.045), p3: mix(BG, base.c, 0.075) }
  const len = String(s.title).replace(/\[\[|\]\]/g, '').length
  const h = len > 34 ? 56 : len > 24 ? 64 : 74
  const title = esc(s.title).replace(/\[\[(.+?)\]\]/g, '<em>$1</em>')
  const badges = (s.badges || []).slice(0, 3).map((b) => `<span class="cb"><span class="chip"><i>[</i>${esc(b)}<i>]</i></span></span>`).join('')
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
.fr{position:absolute;left:0;top:0}
/* chamfered boxes (border = outer shape, fill = inner shape) so every edge is cut the same way as the frame */
.cb{display:inline-block;padding:1.5px;background:${th.c}77;clip-path:polygon(8px 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%,0 8px)}
.cb>*{display:block;background:${th.p3};clip-path:polygon(7.1px 0,100% 0,100% calc(100% - 7.1px),calc(100% - 7.1px) 100%,0 100%,0 7.1px)}
.cb.mk{padding:2px;background:${th.c};clip-path:polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)}
.cb.mk>*{background:${th.p};clip-path:polygon(10.8px 0,100% 0,100% calc(100% - 10.8px),calc(100% - 10.8px) 100%,0 100%,0 10.8px)}
.art{position:absolute;left:56px;top:80px}
.col{position:absolute;right:72px;top:66px;bottom:64px;width:590px;display:flex;flex-direction:column}
.top{display:flex;justify-content:space-between;align-items:center}
.brand{display:flex;align-items:center;gap:14px;font-weight:800;font-size:32px}
.mark{width:58px;height:58px;display:grid!important;place-items:center}
.tag{font:700 20px M,monospace;color:${th.c};direction:ltr;letter-spacing:1px;padding:7px 14px;white-space:nowrap}
.tag b{opacity:.6}
.mid{flex:1;display:flex;flex-direction:column;justify-content:center;gap:16px}
h1{font-size:${h}px;line-height:1.28;font-weight:900;letter-spacing:-.2px}
h1 em{font-style:normal;color:${th.c};text-shadow:0 0 28px ${th.c}99,0 0 6px ${th.c}66}
p.sub{text-wrap:balance;font-size:28px;line-height:1.7;font-weight:500;color:#c9d6e6}
.chips{display:flex;gap:12px;flex-wrap:nowrap}
.chip{font-size:23px;font-weight:700;color:#eef6ff;padding:8px 16px;white-space:nowrap}
.chip i{font:700 22px M,monospace;color:${th.c};font-style:normal;margin:0 5px;opacity:.9}
.row{display:flex;justify-content:space-between;align-items:center;margin-top:18px;padding-top:16px;border-top:1px dashed ${th.c}44}
.ctaw{filter:drop-shadow(0 0 14px ${th.c}66)}
.cta{display:block;white-space:nowrap;font-weight:900;font-size:29px;color:#05080d;background:${th.c};padding:12px 28px;clip-path:polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)}
.status{font:700 21px M,monospace;color:#9fb3c8;direction:ltr;display:flex;align-items:center;gap:10px}
.status u{width:11px;height:11px;border-radius:50%;background:#4ade80;box-shadow:0 0 12px #4ade80;display:inline-block}
</style><body><div class="bg"><div class="grid"></div><div class="scan"></div></div>
<svg class="fr" width="1280" height="720" viewBox="0 0 1280 720"><path d="M58 26H1254V662L1222 694H26V58Z" fill="${th.c}" fill-opacity=".035" stroke="${th.c}" stroke-opacity=".4" stroke-width="1.5"/><g fill="none" stroke="${th.c}" stroke-width="4" stroke-linecap="square" stroke-linejoin="miter"><path d="M26 100V58L58 26H100"/><path d="M1254 620V662L1222 694H1180"/><path d="M1180 26H1254V100"/><path d="M26 620V694H100"/></g></svg>
${art(s, th)}
<div class="col">
 <div class="top"><div class="brand"><span class="cb mk"><span class="mark"><img src="${LOGO}" width="42" height="42"></span></span>پیچا</div><span class="cb"><span class="tag"><b>&gt;</b> ${esc(s.tag || 'picha')}</span></span></div>
 <div class="mid"><h1>${title}</h1>${s.subtitle ? `<p class="sub">${esc(s.subtitle)}</p>` : ''}</div>
 ${badges ? `<div class="chips">${badges}</div>` : ''}
 <div class="row"><div class="status"><u></u>${esc(s.handle || '@pichanet_bot')}</div>${s.cta ? `<span class="ctaw"><span class="cta">${esc(s.cta)} ←</span></span>` : ''}</div>
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
