// Opens the real panel (serverless-bot/dist) in a browser with a Telegram.WebApp.Serverless stand-in that calls the panel endpoint
// running on the local SQLite bench; visits every page and reports console errors and failed calls.
//   node --no-warnings --import ../register.mjs ui_smoke.mjs <export-dir> [screenshot-dir]
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { seed } from '../seed.mjs'
import { handle } from '../../tgcloud/lib/panelapi/index.js'
import '../../tgcloud/lib/panelapi/modules.js'

const require = createRequire('/opt/pw-browsers/')
const { chromium } = (() => { try { return require('playwright') } catch { return createRequire(import.meta.url)('playwright') } })()
await seed(process.argv[2])
const shots = process.argv[3]
const DIST = path.resolve(new URL('../../dist', import.meta.url).pathname)
const TG = process.env.PANEL_TG || '99001'
const calls = []
const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/panel') {
    let b = ''
    for await (const c of req) b += c
    const { r, query, body } = JSON.parse(b)
    const out = await handle(r, query, body, TG)
    calls.push([r, out.status])
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(out)); return
  }
  let f = path.join(DIST, req.url.split('?')[0])
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html')
  const ext = path.extname(f)
  res.setHeader('content-type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' }[ext] || 'application/octet-stream')
  res.end(fs.readFileSync(f))
}).listen(0)
const port = server.address().port
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 800 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CERT|ERR_NAME|ERR_INTERNET|ERR_CONNECTION/.test(m.text())) errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
await page.addInitScript(() => {
  window.Telegram = { WebApp: { initData: 'x', ready() {}, expand() {}, disableVerticalSwipes() {}, isVersionAtLeast: () => true, BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} }, HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
    Serverless: { call(name, input, cb) { fetch('/api/' + name, { method: 'POST', body: JSON.stringify(input) }).then((r) => r.json()).then((x) => cb(null, x), (e) => cb(e)) } } } }
})
await page.goto(`http://127.0.0.1:${port}/#tgWebAppData=x`)
await page.waitForTimeout(1500)
const routes = ['/', '/users', '/orders', '/products', '/categories', '/payments', '/expenses', '/capital', '/stats', '/support', '/promo', '/referrals', '/admins', '/activity', '/finance', '/pending', '/manual-order']
const nav = await page.$$eval('a[href^="#/"]', (as) => [...new Set(as.map((a) => a.getAttribute('href')))])
console.log('links:', nav.join(' '))
for (const h of nav) {
  await page.goto(`http://127.0.0.1:${port}/${h}`)
  await page.waitForTimeout(900)
  const text = (await page.innerText('body')).replace(/\s+/g, ' ').slice(0, 90)
  console.log(h.padEnd(18), text)
  if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, h.replace(/[^a-z]/gi, '_') + '.png') }) }
}
console.log('calls:', [...new Set(calls.map((c) => c.join(':')))].join(' '))
console.log(errors.length ? '❌ errors:\n' + [...new Set(errors)].join('\n') : '✅ no console errors')
await browser.close(); server.close()
process.exit(errors.length || calls.some((c) => c[1] >= 500) ? 1 : 0)
