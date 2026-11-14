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
const assetUri = (file) => {
  const f = path.join(here, '../brand/assets', path.basename(String(file)))
  if (!fs.existsSync(f)) return ''
  const mime = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }[path.extname(f).toLowerCase().slice(1)]
  return mime ? `data:${mime};base64,${fs.readFileSync(f).toString('base64')}` : ''
}
import { LAYOUTS } from './layouts.mjs'
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


// ---- THE character: the Picha logo itself (traced from the logo, 640-unit space). Same silhouette everywhere; only the face changes.
//   eyes: bars (the logo) · happy (^ ^) · wide (big eyes with a shine) · sleepy · heart · wink · star
export const LOGO_PATH = 'M176 188V138Q176 120 195 122Q205 124 213 132L268 188H400L455 132Q463 124 473 122Q492 120 492 138V458Q492 496 454 496H198Q194 496 190 492L110.8 414.7A18 18 0 0 1 136.2 389.3L176 429Z'
const EYES = (kind, ink, pink = '#fb7185', gold = '#fde047') => ({
  bars: `<rect x="250" y="255" width="30" height="92" rx="9" fill="${ink}"/><rect x="390" y="255" width="30" height="92" rx="9" fill="${ink}"/>`,
  happy: `<path d="M243 330Q265 276 287 330M383 330Q405 276 427 330" fill="none" stroke="${ink}" stroke-width="17" stroke-linecap="round"/>`,
  wide: `<rect x="240" y="238" width="50" height="116" rx="22" fill="${ink}"/><rect x="380" y="238" width="50" height="116" rx="22" fill="${ink}"/><circle cx="256" cy="268" r="12" fill="#fff"/><circle cx="396" cy="268" r="12" fill="#fff"/><circle cx="272" cy="330" r="6" fill="#fff" fill-opacity=".8"/><circle cx="412" cy="330" r="6" fill="#fff" fill-opacity=".8"/>`,
  sleepy: `<path d="M240 318H290M380 318H430" stroke="${ink}" stroke-width="17" stroke-linecap="round"/>`,
  wink: `<rect x="250" y="255" width="30" height="92" rx="9" fill="${ink}"/><path d="M383 330Q405 276 427 330" fill="none" stroke="${ink}" stroke-width="17" stroke-linecap="round"/>`,
  heart: `<path d="M265 352C232 324 238 284 265 292C292 284 298 324 265 352Z" fill="${pink}"/><path d="M405 352C372 324 378 284 405 292C432 284 438 324 405 352Z" fill="${pink}"/>`,
  star: `<path d="M265 252l13 34 36 2-28 23 10 35-31-20-31 20 10-35-28-23 36-2z" fill="${gold}" transform="translate(0 -2) scale(.95) translate(13 14)"/><path d="M405 252l13 34 36 2-28 23 10 35-31-20-31 20 10-35-28-23 36-2z" fill="${gold}" transform="translate(0 -2) scale(.95) translate(-127 14)"/>`,
}[kind] || '')
const ACC = {
  hat: '<g stroke-linejoin="round"><path d="M296 190L334 92L372 190Z" fill="#fde047" stroke="#0b1226" stroke-width="6"/><path d="M309 160H359M320 132H348" stroke="#fb7185" stroke-width="10" stroke-linecap="round"/><circle cx="334" cy="90" r="14" fill="#fb7185" stroke="#0b1226" stroke-width="5"/></g>',
  crown: '<path d="M292 190L302 132L322 162L334 122L346 162L366 132L376 190Z" fill="#fde047" stroke="#b45309" stroke-width="6" stroke-linejoin="round"/>',
  bow: '<g><path d="M334 446L292 424V468Z M334 446L376 424V468Z" fill="#fb7185" stroke="#0b1226" stroke-width="5" stroke-linejoin="round"/><circle cx="334" cy="446" r="10" fill="#e11d48" stroke="#0b1226" stroke-width="4"/></g>',
  sunglasses: '<g><rect x="226" y="258" width="100" height="66" rx="18" fill="#0b1226"/><rect x="344" y="258" width="100" height="66" rx="18" fill="#0b1226"/><rect x="320" y="274" width="30" height="11" fill="#0b1226"/><path d="M242 276h42M360 276h42" stroke="#fff" stroke-opacity=".38" stroke-width="7" stroke-linecap="round"/></g>',
}
export const pichaCat = ({ eyes = 'bars', fur = ['#12f6ff', '#78aaff'], ink = '#01050f', blush = false, id = 'pc', acc = '' } = {}) => `
<svg viewBox="96 66 408 442" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${id}" x1="0" y1="121" x2="0" y2="497" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${fur[0]}"/><stop offset="1" stop-color="${fur[1]}"/></linearGradient></defs>
<path d="${LOGO_PATH}" fill="url(#${id})"/>${blush ? '<ellipse cx="226" cy="372" rx="26" ry="13" fill="#fb7185" fill-opacity=".55"/><ellipse cx="444" cy="372" rx="26" ry="13" fill="#fb7185" fill-opacity=".55"/>' : ''}${acc === 'sunglasses' ? '' : EYES(eyes, ink)}${ACC[acc] || ''}</svg>`

const LOGOBAR = (c = '#fff') => `<div class="brand"><img src="${LOGO}" width="54" height="54" style="border-radius:12px"><span style="color:${c}">پیچا</span></div>`
const paws = (c, n = 7) => Array.from({ length: n }, (_, i) => { const x = 40 + ((i * 197) % 1200), y = 40 + ((i * 331) % 640), r = (i * 47) % 60 - 30; return `<svg style="position:absolute;left:${x}px;top:${y}px;opacity:.13;transform:rotate(${r}deg)" width="54" height="54" viewBox="0 0 54 54" fill="${c}"><ellipse cx="27" cy="36" rx="13" ry="10"/><ellipse cx="9" cy="24" rx="5.5" ry="7.5"/><ellipse cx="21" cy="12" rx="5.5" ry="8"/><ellipse cx="33" cy="12" rx="5.5" ry="8"/><ellipse cx="45" cy="24" rx="5.5" ry="7.5"/></svg>` }).join('')

const STYLES = {
  // A — sticker: bright gradient, flat mascot with speech bubble, thick type
  a: (s) => `<style>
body{width:1280px;height:720px;margin:0;font-family:V,sans-serif;position:relative;overflow:hidden;background:linear-gradient(135deg,#ec4899 0%,#8b5cf6 52%,#3b82f6 100%);color:#fff;direction:rtl}
.blob{position:absolute;border-radius:50%;filter:blur(2px)} .brand{position:absolute;right:56px;top:40px;display:flex;align-items:center;gap:14px;font-weight:900;font-size:34px;z-index:3}
.cat{position:absolute;left:70px;bottom:36px;width:500px;filter:drop-shadow(0 20px 0 rgba(11,18,38,.28))}
.ground{position:absolute;left:60px;bottom:14px;width:540px;height:44px;border-radius:50%;background:rgba(11,18,38,.28);filter:blur(6px)}
.fish{position:absolute;font-size:70px;transform:rotate(-18deg);filter:drop-shadow(0 8px 0 rgba(11,18,38,.25))}
.bubble{position:absolute;left:400px;top:84px;background:#fff;color:#0b1226;font-weight:900;font-size:52px;padding:10px 34px 14px;border-radius:40px 40px 40px 8px;box-shadow:0 8px 0 rgba(11,18,38,.25);transform:rotate(6deg)}
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
<div class="ground"></div><div class="fish" style="left:520px;bottom:120px">🐟</div><div class="fish" style="left:36px;top:190px;font-size:54px;transform:rotate(20deg)">✨</div><div class="cat">${pichaCat({ eyes: s.eyes || 'happy', blush: true, id: 'pa', acc: s.acc || '' })}</div>${s.bubble ? `<div class="bubble">${s.bubble}</div>` : ''}
<div class="txt"><h1>${s.title}</h1><p>${s.subtitle}</p>${s.chips.map((c) => `<span class="chip">${c}</span>`).join('')}</div>
<div class="cta">${s.cta} ←</div>`,

  // B — neon night: the cat huge on the left, glowing, cropped by the frame
  b: (s) => `<style>
body{width:1280px;height:720px;margin:0;font-family:V,sans-serif;position:relative;overflow:hidden;background:radial-gradient(ellipse at 28% 55%,#3b0b4a 0%,#12071f 55%,#06030c 100%);color:#fff;direction:ltr}
.txt,.cta,.brand{direction:rtl}
.glow{position:absolute;left:-60px;top:20px;width:760px;height:760px;border-radius:50%;background:radial-gradient(circle,#22e5ff44,#22e5ff00 65%)}
.cat{position:absolute;left:-60px;top:70px;width:700px;filter:drop-shadow(0 0 46px #22e5ffaa)}
.brand{position:absolute;right:56px;top:40px;display:flex;align-items:center;gap:14px;font-weight:900;font-size:34px}
.txt{position:absolute;right:56px;top:160px;width:560px;text-align:right}
h1{font-size:96px;line-height:1.2;margin:0;font-weight:900} h1 em{font-style:normal;background:linear-gradient(90deg,#fde047,#f472b6);-webkit-background-clip:text;color:transparent;filter:drop-shadow(0 0 22px #f472b688)}
p{font-size:30px;line-height:1.7;margin:16px 0 0;color:#e9d5ff;font-weight:500}
.chips{margin-top:22px;display:flex;gap:10px;flex-wrap:wrap}.chips span{border:2px solid #f472b6;color:#fbcfe8;border-radius:999px;padding:6px 20px;font-size:24px;font-weight:700;background:#f472b61a}
.cta{position:absolute;right:56px;bottom:48px;background:linear-gradient(90deg,#f472b6,#a78bfa);color:#12071f;font-weight:900;font-size:34px;padding:16px 44px;border-radius:16px;box-shadow:0 0 34px #f472b688}
.stars i{position:absolute;width:6px;height:6px;border-radius:50%;background:#fff}
</style><div class="glow"></div>
<div class="stars">${Array.from({ length: 36 }, (_, i) => `<i style="left:${(i * 389) % 1260}px;top:${(i * 223) % 700}px;opacity:${0.2 + ((i * 17) % 7) / 10};width:${2 + (i % 4)}px;height:${2 + (i % 4)}px"></i>`).join('')}</div>
<div class="cat">${pichaCat({ eyes: s.eyes || 'wide', fur: ['#22e5ff', '#7aa6ff'], ink: '#12071f', id: 'pb' })}</div>
${LOGOBAR()}
<div class="txt"><h1>${s.title}</h1><p>${s.subtitle}</p><div class="chips">${s.chips.map((c) => `<span>${c}</span>`).join('')}</div></div><div class="cta">${s.cta} ←</div>`,


  // D — plate: an AI/stock scene (growth/brand/assets/<s.plate>) as the background, darkened; the exact logo cat and the Persian text are ours
  d: (s) => {
    const uri = s.plate ? assetUri(s.plate) : ''
    return `<style>
body{width:1280px;height:720px;margin:0;font-family:V,sans-serif;position:relative;overflow:hidden;background:#05080d;color:#fff;direction:ltr}
.bg{position:absolute;inset:0;background:${uri ? `url('${uri}') center/cover` : 'radial-gradient(ellipse at 30% 50%,#1b3a6b,#070d1c)'}}
.shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(5,8,13,.15) 0%,rgba(5,8,13,.55) 45%,rgba(5,8,13,.9) 100%)}
.cat{position:absolute;left:70px;bottom:40px;width:460px;filter:drop-shadow(0 18px 30px rgba(0,0,0,.55))}
.brand{position:absolute;right:56px;top:40px;display:flex;align-items:center;gap:14px;font-weight:900;font-size:34px;direction:rtl}
.txt{position:absolute;right:56px;top:170px;width:580px;direction:rtl;text-align:right}
h1{font-size:92px;line-height:1.2;margin:0;font-weight:900;text-shadow:0 4px 24px rgba(0,0,0,.6)}h1 em{font-style:normal;color:#5eead4}
p{font-size:30px;line-height:1.75;margin:14px 0 0;color:#dbe7f7;text-shadow:0 2px 12px rgba(0,0,0,.6)}
.chips{margin-top:20px;display:flex;gap:10px;direction:rtl}.chips span{border:1.5px solid #5eead4;color:#99f6e4;border-radius:10px;padding:6px 18px;font-size:23px;font-weight:700;background:rgba(5,8,13,.4)}
.cta{position:absolute;right:56px;bottom:48px;background:#5eead4;color:#06201c;font-weight:900;font-size:34px;padding:16px 44px;border-radius:14px;direction:rtl}
</style><div class="bg"></div><div class="shade"></div>
<div class="cat">${pichaCat({ eyes: s.eyes || 'happy', blush: !!s.blush, acc: s.acc || '', id: 'pd' })}</div>
${LOGOBAR()}<div class="txt"><h1>${s.title}</h1><p>${s.subtitle}</p><div class="chips">${(s.chips || []).map((c) => `<span>${c}</span>`).join('')}</div></div><div class="cta">${s.cta} ←</div>`
  },

  // E — your hero image: a PNG you designed (transparent cut-out or full picture) as the centrepiece, untouched (no tint); our frame, glow and Persian text around it
  e: (s) => {
    const uri = s.hero ? assetUri(s.hero) : ''
    const th = { cyan: ['#5eead4', '#0e7490'], pink: ['#f472b6', '#be185d'], amber: ['#fbbf24', '#b45309'], violet: ['#a78bfa', '#6d28d9'], green: ['#4ade80', '#15803d'], red: ['#fb7185', '#be123c'] }[s.theme || 'cyan']
    return `<style>
body{width:1280px;height:720px;margin:0;font-family:V,sans-serif;position:relative;overflow:hidden;color:#fff;direction:ltr;background:radial-gradient(ellipse at 28% 52%,${th[1]}cc 0%,#0a1020 58%,#04060c 100%)}
.glow{position:absolute;left:-40px;top:40px;width:640px;height:640px;border-radius:50%;background:radial-gradient(circle,${th[0]}55,${th[0]}00 66%)}
.hero{position:absolute;left:30px;top:40px;width:600px;height:640px;display:flex;align-items:center;justify-content:center}
.hero img{max-width:100%;max-height:100%;object-fit:contain;filter:drop-shadow(0 18px 34px rgba(0,0,0,.5))}
.brand{position:absolute;right:56px;top:40px;display:flex;align-items:center;gap:14px;font-weight:900;font-size:34px;direction:rtl}
.txt{position:absolute;right:56px;top:170px;width:580px;direction:rtl;text-align:right}
h1{font-size:92px;line-height:1.2;margin:0;font-weight:900}h1 em{font-style:normal;color:${th[0]};text-shadow:0 0 26px ${th[0]}88}
p{font-size:30px;line-height:1.75;margin:14px 0 0;color:#cdd9ee}
.chips{margin-top:20px;display:flex;gap:10px;direction:rtl}.chips span{border:1.5px solid ${th[0]};color:${th[0]};border-radius:10px;padding:6px 18px;font-size:23px;font-weight:700}
.cta{position:absolute;right:56px;bottom:48px;background:${th[0]};color:#06100f;font-weight:900;font-size:34px;padding:16px 44px;border-radius:14px;direction:rtl;box-shadow:0 0 30px ${th[0]}66}
</style><div class="glow"></div>${paws('#fff', 5)}<div class="hero">${uri ? `<img src="${uri}">` : ''}</div>
${LOGOBAR()}<div class="txt"><h1>${s.title}</h1><p>${s.subtitle}</p><div class="chips">${(s.chips || []).map((c) => `<span>${c}</span>`).join('')}</div></div><div class="cta">${s.cta} ←</div>`
  },

  // F — your background + fixed zones (layouts.mjs): the background is yours (ChatGPT/any); the zones for logo, title, subtitle, chips, button and hero are ours.
  //   spec: { style:'f', layout:'wide-r'|'story'|'square', bg:'file.png', hero?:'file.png', cat?:{eyes,acc}, theme, title, subtitle, chips, cta, handle }
  f: (s) => {
    const L = LAYOUTS[s.layout || 'wide-r'], uri = s.bg ? assetUri(s.bg) : '', hero = s.hero ? assetUri(s.hero) : ''
    const y2k = s.theme === 'y2k' // Y2K glossy palette: sky blue #42BCE8, pearl white #FAFCFD, lavender pink #E2A7E9 on pure black; hero objects are blended with «screen» (their black becomes transparent)
    const th = y2k ? ['#42BCE8', '#0a2a40'] : { cyan: ['#5eead4', '#0e7490'], pink: ['#f472b6', '#be185d'], amber: ['#fbbf24', '#b45309'], violet: ['#a78bfa', '#6d28d9'], green: ['#4ade80', '#15803d'], red: ['#fb7185', '#be123c'] }[s.theme || 'cyan']
    const k = L.w >= 1280 ? 1 : L.h > L.w ? 1.2 : 0.95 // type scale per layout
    const box = (z, extra = '') => { const r = L[z]; return r ? `position:absolute;left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;${extra}` : 'display:none' }
    const dir = L.h > L.w ? 'center' : 'right'
    return `<style>
body{width:${L.w}px;height:${L.h}px;margin:0;font-family:V,sans-serif;position:relative;overflow:hidden;color:#fff;direction:ltr;background:#05080d}
.bg{position:absolute;inset:0;background:${uri ? `url('${uri}') center/cover` : y2k ? '#000' : `radial-gradient(ellipse at 30% 45%,${th[1]},#060b18 70%)`}}
.glow{${box('hero', 'border-radius:50%;background:radial-gradient(circle,#42BCE833,#42BCE800 68%);transform:scale(1.35)')}}
.shade{position:absolute;inset:0;background:${y2k ? 'transparent' : L.h > L.w ? 'linear-gradient(180deg,rgba(5,8,13,.55),rgba(5,8,13,.25) 40%,rgba(5,8,13,.7) 100%)' : 'linear-gradient(90deg,rgba(5,8,13,.1),rgba(5,8,13,.5) 45%,rgba(5,8,13,.78))'}}
.logo{${box('logo', 'display:flex;align-items:center;justify-content:' + (dir === 'center' ? 'center' : 'flex-end') + ';direction:rtl;font-weight:900;font-size:' + 34 * k + 'px;gap:14px')}}
.handle{${box('handle', 'font:700 ' + 22 * k + 'px M,monospace;opacity:.85;direction:ltr;display:flex;align-items:center;justify-content:' + (dir === 'center' ? 'center' : 'flex-start'))}}
.title{${box('title', (y2k ? 'color:#FAFCFD;' : '') + 'direction:rtl;text-align:' + dir + ';font-size:' + 92 * k + 'px;line-height:1.2;font-weight:900;text-shadow:0 4px 24px rgba(0,0,0,.65);overflow:hidden')}} .title em{font-style:normal;color:${th[0]};text-shadow:0 0 26px ${th[0]}88}
.sub{${box('subtitle', 'direction:rtl;text-align:' + dir + ';font-size:' + 30 * k + 'px;line-height:1.7;color:#dbe7f7;text-shadow:0 2px 12px rgba(0,0,0,.65);overflow:hidden')}}
.chips{${box('chips', 'direction:rtl;display:flex;gap:10px;align-items:center;justify-content:' + (dir === 'center' ? 'center' : 'flex-start'))}} .chips span{border:1.5px solid ${y2k ? '#E2A7E9' : th[0]};color:${y2k ? '#E2A7E9' : th[0]};border-radius:10px;padding:5px 18px;font-size:${23 * k}px;font-weight:700;background:rgba(5,8,13,.45)}
.cta{${box('cta', 'display:flex;align-items:center;justify-content:center;background:' + th[0] + ';color:#06100f;font-weight:900;font-size:' + 34 * k + 'px;border-radius:16px;direction:rtl;box-shadow:0 0 30px ' + th[0] + '66' + (y2k ? ';background:linear-gradient(90deg,#42BCE8,#E2A7E9)' : ''))}}
.hero{${box('hero', 'display:flex;align-items:center;justify-content:center')}} .hero img,.hero svg{max-width:100%;max-height:100%;object-fit:contain;${y2k && s.blend !== false ? 'mix-blend-mode:screen;' : 'filter:drop-shadow(0 18px 34px rgba(0,0,0,.55));'}}
</style><div class="bg"></div><div class="shade"></div>${y2k ? '<div class="glow"></div>' : ''}
<div class="hero">${hero ? `<img src="${hero}">` : s.cat ? pichaCat({ eyes: s.cat.eyes || 'happy', acc: s.cat.acc || '', blush: !!s.cat.blush, id: 'pf' }) : ''}</div>
<div class="logo"><img src="${LOGO}" width="${54 * k}" height="${54 * k}" style="border-radius:12px"><span>پیچا</span></div><div class="handle">${s.handle === false ? '' : (s.handle || '@pichanet_bot')}</div>
<div class="title">${s.title}</div><div class="sub">${s.subtitle || ''}</div><div class="chips">${(s.chips || []).map((c) => `<span>${c}</span>`).join('')}</div><div class="cta">${s.cta} ←</div>`
  },
  // C — constellation: the cat drawn as connected stars on deep blue, calm and elegant
  c: (s) => {
    // the logo's own outline as stars (640-unit logo space → scaled into the left half)
    const V = [[176, 138], [195, 122], [213, 132], [268, 188], [400, 188], [455, 132], [473, 122], [492, 138], [492, 458], [454, 496], [198, 496], [111, 415], [124, 389], [176, 429]]
    const K = 1.15, OX = 20 - 96 * K, OY = 60 - 108 * K
    const at = (p) => [OX + p[0] * K, OY + p[1] * K]
    const lines = V.map((p, i) => { const [x1, y1] = at(p), [x2, y2] = at(V[(i + 1) % V.length]); return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>` }).join('')
    const nodes = V.map((p, i) => { const [x, y] = at(p); return `<circle cx="${x}" cy="${y}" r="${[1, 5, 8, 9].includes(i) ? 9 : 6}"/>` }).join('')
    const eyes = [[250, 255], [390, 255]].map(([x, y]) => { const [px, py] = at([x, y]); return `<rect x="${px}" y="${py}" width="${30 * K}" height="${92 * K}" rx="9" fill="#fde047"/>` }).join('')
    const pt = (p) => at(p).join(',')
    const stars = Array.from({ length: 60 }, (_, i) => `<circle cx="${(i * 233) % 1260 + 10}" cy="${(i * 149) % 700 + 10}" r="${1 + (i % 3) * 0.8}" fill="#fff" fill-opacity="${0.18 + ((i * 13) % 6) / 10}"/>`).join('')
    return `<style>
body{width:1280px;height:720px;margin:0;font-family:V,sans-serif;position:relative;overflow:hidden;background:radial-gradient(ellipse at 26% 50%,#12315e 0%,#0a1630 52%,#050a18 100%);color:#fff;direction:rtl}
svg.sky{position:absolute;inset:0}.brand{position:absolute;right:56px;top:40px;display:flex;align-items:center;gap:14px;font-weight:900;font-size:34px}
.txt{position:absolute;right:56px;top:170px;width:560px}h1{font-size:92px;line-height:1.22;margin:0;font-weight:900}h1 em{font-style:normal;color:#5eead4;text-shadow:0 0 26px #5eead488}
p{font-size:30px;line-height:1.75;margin:14px 0 0;color:#b6c8e6}.chips{margin-top:20px;display:flex;gap:10px}.chips span{border:1.5px solid #5eead4;color:#99f6e4;border-radius:10px;padding:6px 18px;font-size:23px;font-weight:700}
.cta{position:absolute;right:56px;bottom:48px;background:#5eead4;color:#06201c;font-weight:900;font-size:34px;padding:16px 44px;border-radius:14px;box-shadow:0 0 30px #5eead466}
</style><svg class="sky" viewBox="0 0 1280 720"><g>${stars}</g><g stroke="#5eead4" stroke-opacity=".8" stroke-width="2.5">${lines}</g><g fill="#5eead4" style="filter:drop-shadow(0 0 8px #5eead4)">${nodes}</g>${eyes}
</svg>
${LOGOBAR()}<div class="txt"><h1>${s.title}</h1><p>${s.subtitle}</p><div class="chips">${s.chips.map((c) => `<span>${c}</span>`).join('')}</div></div><div class="cta">${s.cta} ←</div>`
  },
}

export async function renderPoster(style, spec, out) {
  const browser = await chromium.launch()
  const dim = spec.layout && LAYOUTS[spec.layout] ? LAYOUTS[spec.layout] : { w: 1280, h: 720 }
  const page = await browser.newPage({ viewport: { width: dim.w, height: dim.h } })
  const f = path.join(here, `.tmp-poster-${process.pid}.html`)
  fs.writeFileSync(f, `<!doctype html><meta charset="utf-8"><style>${FONT}*{box-sizing:border-box}html{background:#05080d;overflow:hidden}</style>${STYLES[style](spec)}`)
  await page.goto('file://' + f); await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: out })
  fs.unlinkSync(f); await browser.close()
}

if (process.argv[1] === new URL(import.meta.url).pathname && process.argv[2] && /\.json$/.test(process.argv[2])) {
  const specs = [].concat(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')))
  const out = process.argv[3] || 'poster.png'
  for (const [i, sp] of specs.entries()) await renderPoster(sp.style || 'e', sp, specs.length > 1 ? out.replace(/(\.png)?$/, `-${i + 1}.png`) : out)
  console.log('done')
} else if (process.argv[1] === new URL(import.meta.url).pathname) {
  fs.mkdirSync(path.join(here, 'cats'), { recursive: true })
  const spec = { acc: 'hat', title: 'روز گربه‌ها <em>مبارک</em>', subtitle: '۲۲ فوریه؛ روز گربه‌ها. به همراهان چهارپای ما.', chips: ['روز گربه', '۲۲ فوریه'], cta: 'تست رایگان' }
  for (const st of ['a', 'b', 'c']) await renderPoster(st, spec, path.join(here, 'cats', `poster-${st}.png`))
  console.log('done')
}
