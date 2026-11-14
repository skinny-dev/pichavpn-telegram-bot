// Writes layouts/guide-<layout>.png: a labelled wireframe of the zones, to attach to ChatGPT as a COMPOSITION guide (not to be drawn).
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { LAYOUTS, ZONE_LABELS, ZONE_COLORS } from './layouts.mjs'
const require = createRequire('/opt/pw-browsers/')
const { chromium } = (() => { try { return require('playwright') } catch { return createRequire(import.meta.url)('playwright') } })()
const here = path.dirname(new URL(import.meta.url).pathname)
const browser = await chromium.launch()
for (const [name, L] of Object.entries(LAYOUTS)) {
  const page = await browser.newPage({ viewport: { width: L.w, height: L.h } })
  const boxes = Object.keys(ZONE_LABELS).filter((z) => L[z]).map((z) => { const r = L[z]; return `<div style="position:absolute;left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;border:4px dashed ${ZONE_COLORS[z]};background:${ZONE_COLORS[z]}22;box-sizing:border-box;color:${ZONE_COLORS[z]};font:700 ${Math.max(20, Math.min(34, r.h / 3))}px/1.2 system-ui;display:flex;align-items:center;justify-content:center;text-align:center">${ZONE_LABELS[z]}</div>` }).join('')
  await page.setContent(`<body style="margin:0;width:${L.w}px;height:${L.h}px;background:#2a2f3a;position:relative;overflow:hidden">${boxes}<div style="position:absolute;left:0;right:0;bottom:6px;text-align:center;color:#94a3b8;font:600 18px system-ui">layout guide — ${name} ${L.w}x${L.h} — areas to keep EMPTY (do not draw these boxes or labels)</div></body>`)
  await page.screenshot({ path: path.join(here, 'layouts', `guide-${name}.png`) })
  await page.close()
}
await browser.close()
console.log('guides written')
