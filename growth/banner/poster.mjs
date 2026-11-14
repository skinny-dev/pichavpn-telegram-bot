// Poster-style cat banners (more playful than the HUD): three styles for the same content.
//   node poster.mjs  → cats/poster-a.png, poster-b.png, poster-c.png
// A = sticker (bright, flat, fun) · B = neon night (big glowing cat) · C = constellation (cat made of stars)
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire('/opt/pw-browsers/')
const { chromium } = (() => { try { return require('playwright') } catch { return createRequire(import.meta.url)('playwright') } })()
const here = path.dirname(new URL(import.meta.url).pathname)
const FONT = `
@font-face{font-family:V;src:url('file://${here}/fonts/vazirmatn-arabic.woff2') format('woff2');unicode-range:U+0600-06FF,U+200C-200D,U+FB50-FDFF,U+FE70-FEFF;font-weight:100 900}
@font-face{font-family:V;src:url('file://${here}/fonts/vazirmatn-latin.woff2') format('woff2');unicode-range:U+0000-00FF;font-weight:100 900}
@font-face{font-family:M;src:url('file://${here}/fonts/mono-700.woff2') format('woff2');font-weight:700}`
const LOGO = 'data:image/png;base64,' + fs.readFileSync(path.join(here, '../brand/picha-logo.png')).toString('base64')

// the mascot: big glossy eyes, pink inner ears, ω mouth, blush, whiskers. `fur` = [light, dark] of the brand cyan-blue.
const mascot = (fur = ['#5eead4', '#38bdf8'], line = '#0b1226', pink = '#fb7185', iris = ['#fde047', '#f97316']) => `
<svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
<defs>
<linearGradient id="fur" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${fur[0]}"/><stop offset="1" stop-color="${fur[1]}"/></linearGradient>
<radialGradient id="iris" cx=".5" cy=".4" r=".7"><stop offset="0" stop-color="${iris[0]}"/><stop offset="1" stop-color="${iris[1]}"/></radialGradient>
</defs>
<g stroke="${line}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">
<path d="M64 168L84 44Q88 28 104 38L186 96Z" fill="url(#fur)"/><path d="M336 168L316 44Q312 28 296 38L214 96Z" fill="url(#fur)"/>
<path d="M92 128L100 66L150 100Z" fill="${pink}" stroke="none"/><path d="M308 128L300 66L250 100Z" fill="${pink}" stroke="none"/>
<ellipse cx="200" cy="214" rx="152" ry="128" fill="url(#fur)"/>
<path d="M200 98v34M170 104l6 26M230 104l-6 26" fill="none" stroke="${fur[1]}" stroke-opacity=".7" stroke-width="9"/>
</g>
<g stroke="${line}" stroke-width="6">
<ellipse cx="142" cy="212" rx="34" ry="42" fill="${line}"/><ellipse cx="258" cy="212" rx="34" ry="42" fill="${line}"/>
</g>
<ellipse cx="142" cy="216" rx="25" ry="33" fill="url(#iris)"/><ellipse cx="258" cy="216" rx="25" ry="33" fill="url(#iris)"/>
<ellipse cx="142" cy="216" rx="7" ry="26" fill="${line}"/><ellipse cx="258" cy="216" rx="7" ry="26" fill="${line}"/>
<circle cx="130" cy="196" r="11" fill="#fff"/><circle cx="246" cy="196" r="11" fill="#fff"/><circle cx="153" cy="236" r="5" fill="#fff" fill-opacity=".85"/><circle cx="269" cy="236" r="5" fill="#fff" fill-opacity=".85"/>
<ellipse cx="96" cy="268" rx="26" ry="15" fill="${pink}" fill-opacity=".55"/><ellipse cx="304" cy="268" rx="26" ry="15" fill="${pink}" fill-opacity=".55"/>
<path d="M188 262Q200 252 212 262Q206 276 200 276Q194 276 188 262Z" fill="${pink}" stroke="${line}" stroke-width="5" stroke-linejoin="round"/>
<path d="M200 276Q200 298 176 296M200 276Q200 298 224 296" fill="none" stroke="${line}" stroke-width="6" stroke-linecap="round"/>
<g stroke="#fff" stroke-opacity=".9" stroke-width="4" stroke-linecap="round" fill="none"><path d="M70 246Q30 238 6 224M72 266Q30 270 4 282"/><path d="M330 246Q370 238 394 224M328 266Q370 270 396 282"/></g>
</svg>`

const LOGOBAR = (c = '#fff') => `<div class="brand"><img src="${LOGO}" width="54" height="54" style="border-radius:12px"><span style="color:${c}">پیچا</span></div>`
const paws = (c, n = 7) => Array.from({ length: n }, (_, i) => { const x = 40 + ((i * 197) % 1200), y = 40 + ((i * 331) % 640), r = (i * 47) % 60 - 30; return `<svg style="position:absolute;left:${x}px;top:${y}px;opacity:.13;transform:rotate(${r}deg)" width="54" height="54" viewBox="0 0 54 54" fill="${c}"><ellipse cx="27" cy="36" rx="13" ry="10"/><ellipse cx="9" cy="24" rx="5.5" ry="7.5"/><ellipse cx="21" cy="12" rx="5.5" ry="8"/><ellipse cx="33" cy="12" rx="5.5" ry="8"/><ellipse cx="45" cy="24" rx="5.5" ry="7.5"/></svg>` }).join('')

const STYLES = {
  // A — sticker: bright gradient, flat mascot with speech bubble, thick type
  a: (s) => `<style>
body{width:1280px;height:720px;margin:0;font-family:V,sans-serif;position:relative;overflow:hidden;background:linear-gradient(135deg,#ec4899 0%,#8b5cf6 52%,#3b82f6 100%);color:#fff;direction:rtl}
.blob{position:absolute;border-radius:50%;filter:blur(2px)} .brand{position:absolute;right:56px;top:40px;display:flex;align-items:center;gap:14px;font-weight:900;font-size:34px;z-index:3}
.cat{position:absolute;left:30px;bottom:-40px;width:600px;filter:drop-shadow(0 22px 0 rgba(11,18,38,.25))}
.bubble{position:absolute;left:470px;top:78px;background:#fff;color:#0b1226;font-weight:900;font-size:52px;padding:10px 34px 14px;border-radius:40px 40px 40px 8px;box-shadow:0 8px 0 rgba(11,18,38,.25);transform:rotate(6deg)}
.txt{position:absolute;right:56px;top:150px;width:600px;z-index:3}
h1{font-size:104px;line-height:1.15;margin:0;font-weight:900;text-shadow:0 6px 0 rgba(11,18,38,.3)} h1 em{font-style:normal;color:#fde047}
p{font-size:31px;line-height:1.7;margin:14px 0 0;font-weight:600;opacity:.96}
.chip{display:inline-block;background:#0b1226;color:#fde047;font:700 26px V;padding:8px 22px;border-radius:999px;margin-top:22px;margin-left:12px}
.cta{position:absolute;right:56px;bottom:46px;background:#fde047;color:#0b1226;font-weight:900;font-size:36px;padding:16px 44px;border-radius:18px;box-shadow:0 8px 0 rgba(11,18,38,.35);z-index:3}
.handle{position:absolute;left:56px;top:46px;font:700 24px M,monospace;direction:ltr;opacity:.85}
</style>
<div class="blob" style="width:520px;height:520px;right:-120px;top:-160px;background:#ffffff22"></div><div class="blob" style="width:380px;height:380px;left:380px;bottom:-190px;background:#00000022"></div>
${paws('#fff')}
${LOGOBAR()}<div class="handle">@pichanet_bot</div>
<div class="cat">${mascot()}</div><div class="bubble">${s.bubble || 'نیاو!'}</div>
<div class="txt"><h1>${s.title}</h1><p>${s.subtitle}</p>${s.chips.map((c) => `<span class="chip">${c}</span>`).join('')}</div>
<div class="cta">${s.cta} ←</div>`,

  // B — neon night: the cat huge on the left, glowing, cropped by the frame
  b: (s) => `<style>
body{width:1280px;height:720px;margin:0;font-family:V,sans-serif;position:relative;overflow:hidden;background:radial-gradient(ellipse at 28% 55%,#3b0b4a 0%,#12071f 55%,#06030c 100%);color:#fff;direction:ltr}
.txt,.cta,.brand{direction:rtl}
.glow{position:absolute;left:-60px;top:20px;width:760px;height:760px;border-radius:50%;background:radial-gradient(circle,#f472b655,#f472b600 65%)}
.cat{position:absolute;left:-90px;top:60px;width:720px;filter:drop-shadow(0 0 40px #f472b688) saturate(1.1)}
.brand{position:absolute;right:56px;top:40px;display:flex;align-items:center;gap:14px;font-weight:900;font-size:34px}
.txt{position:absolute;right:56px;top:160px;width:560px;text-align:right}
h1{font-size:96px;line-height:1.2;margin:0;font-weight:900} h1 em{font-style:normal;background:linear-gradient(90deg,#fde047,#f472b6);-webkit-background-clip:text;color:transparent;filter:drop-shadow(0 0 22px #f472b688)}
p{font-size:30px;line-height:1.7;margin:16px 0 0;color:#e9d5ff;font-weight:500}
.chips{margin-top:22px;display:flex;gap:10px;flex-wrap:wrap}.chips span{border:2px solid #f472b6;color:#fbcfe8;border-radius:999px;padding:6px 20px;font-size:24px;font-weight:700;background:#f472b61a}
.cta{position:absolute;right:56px;bottom:48px;background:linear-gradient(90deg,#f472b6,#a78bfa);color:#12071f;font-weight:900;font-size:34px;padding:16px 44px;border-radius:16px;box-shadow:0 0 34px #f472b688}
.stars i{position:absolute;width:6px;height:6px;border-radius:50%;background:#fff}
</style><div class="glow"></div>
<div class="stars">${Array.from({ length: 36 }, (_, i) => `<i style="left:${(i * 389) % 1260}px;top:${(i * 223) % 700}px;opacity:${0.2 + ((i * 17) % 7) / 10};width:${2 + (i % 4)}px;height:${2 + (i % 4)}px"></i>`).join('')}</div>
<div class="cat">${mascot(['#a78bfa', '#7c3aed'], '#12071f', '#f472b6', ['#fde047', '#fb923c'])}</div>
${LOGOBAR()}
<div class="txt"><h1>${s.title}</h1><p>${s.subtitle}</p><div class="chips">${s.chips.map((c) => `<span>${c}</span>`).join('')}</div></div><div class="cta">${s.cta} ←</div>`,

  // C — constellation: the cat drawn as connected stars on deep blue, calm and elegant
  c: (s) => {
    const P = [[-120, -20], [-96, -126], [-40, -70], [0, -84], [40, -70], [96, -126], [120, -20], [108, 46], [64, 90], [0, 108], [-64, 90], [-108, 46]]
    const E = [[-48, -8], [48, -8]]
    const X = 330, Y = 330, k = 2.1
    const pt = (p) => `${X + p[0] * k},${Y + p[1] * k}`
    const lines = P.map((p, i) => `<line x1="${X + p[0] * k}" y1="${Y + p[1] * k}" x2="${X + P[(i + 1) % P.length][0] * k}" y2="${Y + P[(i + 1) % P.length][1] * k}"/>`).join('')
    const nodes = P.map((p, i) => `<circle cx="${X + p[0] * k}" cy="${Y + p[1] * k}" r="${i % 3 === 0 ? 9 : 6}"/>`).join('')
    const eyes = E.map((p) => `<ellipse cx="${X + p[0] * k}" cy="${Y + p[1] * k}" rx="20" ry="30" fill="#fde047" fill-opacity=".95"/><ellipse cx="${X + p[0] * k}" cy="${Y + p[1] * k}" rx="5" ry="22" fill="#0b1226"/>`).join('')
    const stars = Array.from({ length: 60 }, (_, i) => `<circle cx="${(i * 233) % 1260 + 10}" cy="${(i * 149) % 700 + 10}" r="${1 + (i % 3) * 0.8}" fill="#fff" fill-opacity="${0.18 + ((i * 13) % 6) / 10}"/>`).join('')
    return `<style>
body{width:1280px;height:720px;margin:0;font-family:V,sans-serif;position:relative;overflow:hidden;background:radial-gradient(ellipse at 26% 50%,#12315e 0%,#0a1630 52%,#050a18 100%);color:#fff;direction:rtl}
svg.sky{position:absolute;inset:0}.brand{position:absolute;right:56px;top:40px;display:flex;align-items:center;gap:14px;font-weight:900;font-size:34px}
.txt{position:absolute;right:56px;top:170px;width:560px}h1{font-size:92px;line-height:1.22;margin:0;font-weight:900}h1 em{font-style:normal;color:#5eead4;text-shadow:0 0 26px #5eead488}
p{font-size:30px;line-height:1.75;margin:14px 0 0;color:#b6c8e6}.chips{margin-top:20px;display:flex;gap:10px}.chips span{border:1.5px solid #5eead4;color:#99f6e4;border-radius:10px;padding:6px 18px;font-size:23px;font-weight:700}
.cta{position:absolute;right:56px;bottom:48px;background:#5eead4;color:#06201c;font-weight:900;font-size:34px;padding:16px 44px;border-radius:14px;box-shadow:0 0 30px #5eead466}
</style><svg class="sky" viewBox="0 0 1280 720"><g>${stars}</g><g stroke="#5eead4" stroke-opacity=".8" stroke-width="2.5">${lines}</g><g fill="#5eead4" style="filter:drop-shadow(0 0 8px #5eead4)">${nodes}</g>${eyes}
<g stroke="#5eead4" stroke-opacity=".6" stroke-width="2"><line x1="${X - 30}" y1="${Y + 40}" x2="${X - 140}" y2="${Y + 30}"/><line x1="${X - 30}" y1="${Y + 52}" x2="${X - 140}" y2="${Y + 70}"/><line x1="${X + 30}" y1="${Y + 40}" x2="${X + 140}" y2="${Y + 30}"/><line x1="${X + 30}" y1="${Y + 52}" x2="${X + 140}" y2="${Y + 70}"/></g>
<polygon points="${pt([-8, 28])} ${pt([8, 28])} ${pt([0, 40])}" fill="#fb7185"/></svg>
${LOGOBAR()}<div class="txt"><h1>${s.title}</h1><p>${s.subtitle}</p><div class="chips">${s.chips.map((c) => `<span>${c}</span>`).join('')}</div></div><div class="cta">${s.cta} ←</div>`
  },
}

export async function renderPoster(style, spec, out) {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const f = path.join(here, `.tmp-poster-${process.pid}.html`)
  fs.writeFileSync(f, `<!doctype html><meta charset="utf-8"><style>${FONT}*{box-sizing:border-box}html{background:#05080d;overflow:hidden}</style>${STYLES[style](spec)}`)
  await page.goto('file://' + f); await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: out })
  fs.unlinkSync(f); await browser.close()
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  fs.mkdirSync(path.join(here, 'cats'), { recursive: true })
  const spec = { title: 'نیاو نیاو <em>نیاو!</em>', subtitle: '۲۲ فوریه، روز گربه‌هاست؛ پیچا امروز دلش خوش است.', chips: ['روز گربه', '۲/۲۲'], cta: 'تست رایگان', bubble: 'نیاو!' }
  for (const st of ['a', 'b', 'c']) await renderPoster(st, spec, path.join(here, 'cats', `poster-${st}.png`))
  console.log('done')
}
