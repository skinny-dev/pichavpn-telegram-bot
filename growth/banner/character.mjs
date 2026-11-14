// The Picha cat as a reusable character: the exact logo silhouette (vector) + expressions + accessories.
//   node character.mjs → ../brand/picha-cat.svg · ../brand/picha-cat-1024.png (transparent) · ../brand/picha-character-sheet.png (reference for image generators)
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pichaCat } from './poster.mjs'
const require = createRequire('/opt/pw-browsers/')
const { chromium } = (() => { try { return require('playwright') } catch { return createRequire(import.meta.url)('playwright') } })()
const here = path.dirname(new URL(import.meta.url).pathname)
const brand = path.join(here, '../brand')

fs.writeFileSync(path.join(brand, 'picha-cat.svg'), pichaCat({ id: 'logo' }).trim().replace('<svg ', '<svg width="640" height="672" '))

const browser = await chromium.launch()
// 1) the character alone, transparent, 1024 px wide
let page = await browser.newPage({ viewport: { width: 1024, height: 1100 } })
await page.setContent(`<body style="margin:0;background:transparent"><div style="width:1024px">${pichaCat({ id: 'one' })}</div></body>`)
await page.screenshot({ path: path.join(brand, 'picha-cat-1024.png'), omitBackground: true, clip: { x: 0, y: 0, width: 1024, height: Math.round(1024 * 442 / 408) } })
// 2) the character sheet: the same silhouette, six faces and four accessories, on the brand's near-black
const faces = [['bars', 'the logo (default)'], ['happy', 'happy'], ['wide', 'surprised'], ['sleepy', 'sleepy'], ['heart', 'love'], ['wink', 'wink']]
const accs = [['hat', 'party hat', 'happy'], ['crown', 'crown', 'bars'], ['sunglasses', 'sunglasses', 'bars'], ['bow', 'bow tie', 'happy']]
const cell = (svg, label) => `<div style="width:238px;text-align:center"><div style="width:206px;margin:0 auto">${svg}</div><div style="font:600 15px/1.6 system-ui;color:#8fa3bd;margin-top:6px">${label}</div></div>`
page = await browser.newPage({ viewport: { width: 1536, height: 760 } })
await page.setContent(`<body style="margin:0;background:#01050f;padding:28px 38px;width:1536px;height:760px;box-sizing:border-box;font-family:system-ui">
<div style="color:#e6f1ff;font:700 26px system-ui;margin-bottom:4px">Picha — the character is the logo</div>
<div style="color:#8fa3bd;font:500 16px system-ui;margin-bottom:18px">Keep the silhouette EXACT: rounded square body, two pointed ears at the top corners (flat top between them), two vertical rounded-rectangle eyes, a short diagonal tail at the lower left, bottom-right corner rounded. Cyan (#12f6ff) at the top to blue (#78aaff) at the bottom.</div>
<div style="display:flex;flex-wrap:wrap;gap:0">${faces.map(([e, l], i) => cell(pichaCat({ eyes: e, id: 'f' + i }), l)).join('')}${accs.map(([a, l, e], i) => cell(pichaCat({ eyes: e, acc: a, id: 'a' + i }), l)).join('')}</div></body>`)
await page.screenshot({ path: path.join(brand, 'picha-character-sheet.png') })
await browser.close()
console.log('character assets written')
