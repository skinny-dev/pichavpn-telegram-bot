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
const page = await browser.newPage({ viewport: { width: +(process.env.VW || 390), height: 800 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|ERR_CERT|ERR_NAME|ERR_INTERNET|ERR_CONNECTION/.test(m.text())) errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
if (process.env.DEBUG_UI) { page.on('requestfailed', (r) => console.log('REQ FAILED', r.url().slice(0, 90), r.failure()?.errorText)); page.on('response', (r) => { if (r.status() >= 400) console.log('HTTP', r.status(), r.url().slice(0, 90)) }); page.on('console', (m) => console.log('console', m.type(), m.text().slice(0, 140))) }
await page.route("https://telegram.org/**", (r) => r.abort()) // keep the stand-in WebApp; the real script would replace it
await page.addInitScript(() => {
  window.Telegram = { WebApp: { initData: 'x', ready() {}, expand() {}, disableVerticalSwipes() {}, isVersionAtLeast: () => true, BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} }, HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
    Serverless: { call(name, input, cb) { fetch('/api/' + name, { method: 'POST', body: JSON.stringify(input) }).then((r) => r.json()).then((x) => cb(null, x), (e) => cb(e)) } } } }
})
await page.goto(`http://127.0.0.1:${port}/#tgWebAppData=x`)
await page.waitForTimeout(1500)
const routes = ['/', '/users', '/orders', '/products', '/categories', '/payments', '/expenses', '/capital', '/stats', '/support', '/promo', '/referrals', '/admins', '/activity', '/finance', '/pending', '/manual-order']
let nav = await page.$$eval('a[href^="#/"]', (as) => [...new Set(as.map((a) => a.getAttribute('href')))])
if (!nav.length) nav = ['#/', '#/finance', '#/support', '#/pending', '#/stats', '#/users', '#/orders', '#/products', '#/accounting', '#/promo', '#/referrals', '#/admins'] // wide layouts have no bottom-nav links
console.log('links:', nav.join(' '))
for (const h of nav) {
  await page.goto(`http://127.0.0.1:${port}/${h}`)
  await page.waitForTimeout(900)
  const text = (await page.innerText('body')).replace(/\s+/g, ' ').slice(0, 90)
  console.log(h.padEnd(18), text)
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  if (ov > 0) {
    const who = await page.evaluate(() => { const W = document.documentElement.clientWidth; return [...document.querySelectorAll('main *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > W + 1 || r.left < -1) && !e.closest('.overflow-x-auto,.overflow-auto') }).slice(0, 3).map((e) => e.tagName + '.' + String(e.className).slice(0, 70) + ' w=' + Math.round(e.getBoundingClientRect().width)) })
    errors.push(`horizontal overflow ${ov}px on ${h}: ${who.join(' | ')}`)
  }
  if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, h.replace(/[^a-z]/gi, '_') + '.png') }) }
}
// navigation: «بیشتر» closes on every choice (even the current page) and the page starts at the top
if (+(process.env.VW || 390) < 768) {
  await page.goto(`http://127.0.0.1:${port}/#/products`); await page.waitForTimeout(600)
  await page.getByRole('button', { name: 'بیشتر' }).click()
  await page.getByRole('dialog').getByRole('link', { name: 'محصولات' }).click(); await page.waitForTimeout(300)
  if (await page.getByRole('dialog').count()) errors.push('«بیشتر» stays open after choosing the current page')
  await page.getByRole('button', { name: 'بیشتر' }).click()
  await page.keyboard.press('Escape'); await page.waitForTimeout(200)
  if (await page.getByRole('dialog').count()) errors.push('Escape does not close «بیشتر»')
  await page.evaluate(() => window.scrollTo(0, 400))
  await page.getByRole('link', { name: 'کاربران' }).last().click(); await page.waitForTimeout(500)
  if (await page.evaluate(() => window.scrollY) > 0) errors.push('new page does not start at the top')
}
console.log('calls:', [...new Set(calls.map((c) => c.join(':')))].join(' '))
console.log(errors.length ? '❌ errors:\n' + [...new Set(errors)].join('\n') : '✅ no console errors')
await browser.close(); server.close()
process.exit(errors.length || calls.some((c) => c[1] >= 500) ? 1 : 0)
