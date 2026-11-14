// (Studio) Opens the real panel (serverless-bot/dist) in a browser with a Telegram.WebApp.Serverless stand-in that calls the panel endpoint
// running on the local SQLite bench; visits every page and reports console errors and failed calls.
//   node --no-warnings --import ../register.mjs ui_smoke.mjs <export-dir> [screenshot-dir]
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { seed } from '../seed.mjs'
import { calls as botCalls } from 'sdk'
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
if (process.env.THEME) await page.addInitScript((t) => { try { localStorage.setItem('picha-theme', t) } catch {} }, process.env.THEME)
await page.addInitScript((scheme) => {
  window.Telegram = { WebApp: { colorScheme: scheme, initData: 'x', ready() {}, expand() {}, disableVerticalSwipes() {}, isVersionAtLeast: () => true, BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} }, HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
    Serverless: { call(name, input, cb) { fetch('/api/' + name, { method: 'POST', body: JSON.stringify(input) }).then((r) => r.json()).then((x) => cb(null, x), (e) => cb(e)) } } } }
}, process.env.THEME || 'light')
await page.goto(`http://127.0.0.1:${port}/#tgWebAppData=x`)
await page.waitForTimeout(1500)

const base = `http://127.0.0.1:${port}/`
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) errors.push('check: ' + name) }
await handle('studio_seed', null, { from: '2026-11-01', to: '2027-03-31' }, TG).catch(() => {})
await page.goto(base + '#/studio'); await page.waitForTimeout(1200)
const rows = await page.getByTestId('row').count()
check('the calendar shows occasions as rows', rows >= 8, String(rows))
check('the calendar says it is a simulation', (await page.innerText('body')).includes('شبیه‌سازی'))
if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, 'studio_calendar.png'), fullPage: true }) }
await page.getByTestId('row').filter({ hasText: 'شب یلدا' }).first().click(); await page.waitForTimeout(500)
const prev = await page.getByTestId('preview').innerText()
check('the composer opens Yalda with the preview text', prev.includes('درود') && prev.includes('یلدا'))
check('the preview shows the CTA buttons', prev.includes('تست رایگان') && prev.includes('خرید اشتراک'))
check('the lint tells that the image is missing from the library', prev.includes('در کتابخانه نیست'))
if (shots) await page.screenshot({ path: path.join(shots, 'studio_composer.png'), fullPage: true })
// an invalid text shows the error live, and scheduling is refused
await page.getByTestId('text').fill('سلام دوستان')
await page.getByRole('button', { name: 'تأیید و زمان‌بندی' }).click(); await page.waitForTimeout(500)
check('scheduling a «سلام» post is refused', (await page.innerText('body')).includes('درود'))
// fix it, send a test to myself
await page.getByTestId('text').fill('درود 🌿\n\nبلندترین شب سال، با اینترنتی که قطع نمی‌شود.')
botCalls.length = 0
await page.getByRole('button', { name: /آزمایشی برای خودم/ }).click(); await page.waitForTimeout(700)
check('the test send reached only the composing administrator', botCalls.length === 1 && String(botCalls[0][1].chat_id) === TG && /شبیه‌سازی/.test(JSON.stringify(botCalls[0][1])), JSON.stringify(botCalls.map((c) => c[1].chat_id)))
await page.getByRole('button', { name: 'ذخیره پیش‌نویس' }).click(); await page.waitForTimeout(700)
await page.getByRole('tab', { name: 'تنظیمات' }).click(); await page.waitForTimeout(300)
check('settings show the simulation switch off', (await page.getByTestId('live').getAttribute('data-state')) === 'unchecked')
if (shots) await page.screenshot({ path: path.join(shots, 'studio_settings.png'), fullPage: true })
const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
check('no horizontal overflow', ov <= 0, String(ov))
console.log(errors.length ? '❌ errors:\n' + [...new Set(errors)].join('\n') : '✅ no console errors')
await browser.close(); server.close()
process.exit(errors.length ? 1 : 0)
