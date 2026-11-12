// Channel post banner from a spec:  node render.mjs spec.json out.png      (spec: one object, or an array → out-<n>.png)
//   { "theme": "brand|night|mint|gold", "kicker": "…", "title": "…", "subtitle": "…", "badges": ["…","…"], "cta": "…", "handle": "@pichanet_bot" }
// Every word comes from the spec, which the content engine fills from approved text only — the banner never invents a claim.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire('/opt/pw-browsers/')
const { chromium } = (() => { try { return require('playwright') } catch { return createRequire(import.meta.url)('playwright') } })()

const here = path.dirname(new URL(import.meta.url).pathname)
const icon = (name) => {
  const f = path.join(here, 'icons', String(name).replace(/[^a-z0-9-]/g, '') + '.svg')
  return fs.existsSync(f) ? 'data:image/svg+xml;base64,' + fs.readFileSync(f).toString('base64') : ''
}
const SLOTS = [{ x: 60, y: 440, s: 170, r: -14 }, { x: 400, y: 70, s: 130, r: 16 }, { x: 410, y: 470, s: 120, r: 10 }]
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const THEMES = {
  brand: { a: '#0b1d4d', b: '#2563eb', c: '#7aa7ff', ink: '#ffffff', chip: 'rgba(255,255,255,.14)' },
  night: { a: '#070b14', b: '#16233f', c: '#4f8bff', ink: '#f3f6ff', chip: 'rgba(255,255,255,.10)' },
  mint: { a: '#052e2b', b: '#0f766e', c: '#5eead4', ink: '#f0fffd', chip: 'rgba(255,255,255,.14)' },
  gold: { a: '#2a1405', b: '#b45309', c: '#fcd34d', ink: '#fffaf0', chip: 'rgba(255,255,255,.14)' },
}

export function html(s) {
  const t = THEMES[s.theme] || THEMES.brand
  const hero = s.icon ? icon(s.icon) : ''
  const extras = (s.extra || []).slice(0, 3).map((n, i) => (icon(n) ? `<img class="ex" style="left:${SLOTS[i].x}px;top:${SLOTS[i].y}px;width:${SLOTS[i].s}px;transform:rotate(${SLOTS[i].r}deg)" src="${icon(n)}">` : '')).join('')
  const badges = (s.badges || []).slice(0, 4).map((b) => `<span class="chip">${esc(b)}</span>`).join('')
  return `<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><style>
@font-face{font-family:V;src:url('file://${here}/vazirmatn-arabic.woff2') format('woff2');unicode-range:U+0600-06FF,U+200C-200D,U+FB50-FDFF,U+FE70-FEFF;font-weight:100 900}
@font-face{font-family:V;src:url('file://${here}/vazirmatn-latin.woff2') format('woff2');unicode-range:U+0000-00FF;font-weight:100 900}
*{box-sizing:border-box;margin:0}
html{width:1280px;height:720px;overflow:hidden}
.bg{position:absolute;inset:0;overflow:hidden}
body{width:1280px;height:720px;font-family:V,sans-serif;color:${t.ink};overflow:hidden;position:relative;
 background:radial-gradient(900px 600px at 18% 12%,${t.b} 0%,transparent 60%),radial-gradient(700px 500px at 95% 100%,${t.c}55 0%,transparent 60%),linear-gradient(135deg,${t.a},${t.a})}
.grid{position:absolute;inset:0;background-image:linear-gradient(${t.c}14 1px,transparent 1px),linear-gradient(90deg,${t.c}14 1px,transparent 1px);background-size:64px 64px;mask-image:radial-gradient(600px 420px at 80% 30%,#000,transparent 75%)}
.orb{position:absolute;left:-90px;top:-90px;width:460px;height:460px;border-radius:50%;border:2px solid ${t.c}44;box-shadow:0 0 0 38px ${t.c}0d,0 0 0 90px ${t.c}08}
.art{position:absolute;left:40px;top:80px;width:540px;height:560px}
.glow{position:absolute;left:30px;top:60px;width:440px;height:440px;border-radius:50%;background:radial-gradient(circle,${t.c}66,transparent 68%)}
.hero{position:absolute;left:50px;top:90px;width:400px;filter:drop-shadow(0 28px 34px rgba(0,0,0,.45))}
.ex{position:absolute;filter:drop-shadow(0 14px 18px rgba(0,0,0,.4))}
.wrap.withart{padding-left:600px}
.wrap.withart h1{font-size:var(--h,76px)}
.wrap.withart p.sub{font-size:30px;line-height:1.55;margin-top:14px}
.wrap.withart .bottom{flex-direction:column;align-items:stretch;gap:18px}
.wrap.withart .chips{gap:10px;flex-wrap:nowrap}
.wrap.withart .chip{font-size:24px;padding:8px 18px;border-radius:14px}
.wrap.withart .cta{font-size:30px;padding:12px 30px}
.wrap.withart .handle{font-size:26px}
.wrap.withart .bottom .row{display:flex;justify-content:space-between;align-items:center}
.wrap{position:absolute;inset:0;padding:64px 80px;display:flex;flex-direction:column;justify-content:space-between}
.top{display:flex;justify-content:space-between;align-items:center}
.brand{display:flex;align-items:center;gap:14px;font-weight:800;font-size:34px;letter-spacing:.2px}
.logo{width:54px;height:54px;border-radius:15px;background:#fff;display:grid;place-items:center}
.kicker{font-size:26px;font-weight:600;color:${t.c};padding:8px 20px;border:1.5px solid ${t.c}66;border-radius:999px}
h1{font-size:92px;line-height:1.18;font-weight:900;max-width:1000px;text-wrap:balance}
p.sub{font-size:38px;line-height:1.6;font-weight:500;opacity:.92;max-width:920px;margin-top:20px}
.chips{display:flex;gap:14px;flex-wrap:wrap}
.chip{white-space:nowrap;background:${t.chip};border:1.5px solid ${t.c}55;border-radius:16px;padding:12px 24px;font-size:28px;font-weight:700}
.bottom{display:flex;justify-content:space-between;align-items:center}
.cta{white-space:nowrap;background:#fff;color:${t.a};font-weight:900;font-size:34px;border-radius:18px;padding:16px 38px}
.handle{font-size:30px;font-weight:600;opacity:.85;direction:ltr}
</style><body><div class="bg"><div class="grid"></div><div class="orb"></div></div>${hero ? `<div class="art"><div class="glow"></div><img class="hero" src="${hero}">${extras}</div>` : ''}<div class="wrap${hero ? ' withart' : ''}" style="--h:${String(s.title).length > 30 ? 58 : String(s.title).length > 20 ? 66 : 76}px">
<div class="top"><div class="brand"><div class="logo"><svg width="34" height="34" viewBox="0 0 32 32"><path d="M10 23V9h7a4.5 4.5 0 010 9h-7" stroke="${t.b}" stroke-width="3.4" fill="none" stroke-linecap="round"/></svg></div>پیچا</div>${s.kicker ? `<div class="kicker">${esc(s.kicker)}</div>` : ''}</div>
<div><h1>${esc(s.title)}</h1>${s.subtitle ? `<p class="sub">${esc(s.subtitle)}</p>` : ''}</div>
<div class="bottom"><div class="chips">${badges}</div><div class="row" style="display:flex;gap:28px;align-items:center;justify-content:space-between">${s.handle ? `<span class="handle">${esc(s.handle)}</span>` : '<span></span>'}${s.cta ? `<span class="cta">${esc(s.cta)}</span>` : ''}</div></div>
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
