// (Events) Opens the real panel (serverless-bot/dist) in a browser with a Telegram.WebApp.Serverless stand-in that calls the panel endpoint
// running on the local SQLite bench; visits every page and reports console errors and failed calls.
//   node --no-warnings --import ../register.mjs ui_smoke.mjs <export-dir> [screenshot-dir]
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { seed } from '../seed.mjs'
import { calls as botCalls } from 'sdk'
import { handle } from './entry.mjs'

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
const iso = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10)
await page.goto(base + '#/events'); await page.waitForTimeout(1200)
check('the page says simulation is on and nothing is changed', (await page.innerText('body')).includes('شبیه‌سازی'))
await page.getByTestId('new').click(); await page.waitForTimeout(300)
await page.getByPlaceholder('بلک‌فرایدی').fill('بلک‌فرایدی')
const dates = page.locator('input[type=date]')
await dates.nth(0).fill(iso(3)); await dates.nth(1).fill(iso(4))
await page.getByRole('button', { name: /محاسبهٔ اثر/ }).click(); await page.waitForTimeout(800)
const imp = await page.getByTestId('impact').innerText()
check('the impact table shows the plans with their margin', imp.includes('حاشیهٔ سود') && /٪/.test(imp), imp.slice(0, 80))
if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, 'events_form.png'), fullPage: true }) }
// an over-limit discount is refused with the reason
await page.locator('input[inputmode=decimal]').first().fill('35')
await page.getByRole('button', { name: /محاسبهٔ اثر/ }).click(); await page.waitForTimeout(600)
check('a 35% discount is refused with the cap', (await page.getByTestId('impact').innerText()).includes('بین ۱ و 20'))
await page.locator('input[inputmode=decimal]').first().fill('20')
await page.getByRole('button', { name: 'تأیید و زمان‌بندی' }).click(); await page.waitForTimeout(900)
const card = await page.getByTestId('event').first().innerText()
check('the event is approved and listed with its schedule', card.includes('بلک‌فرایدی') && card.includes('تأییدشده'), card.slice(0, 80))
await page.getByRole('button', { name: 'ساخت پست‌ها در استودیو' }).click(); await page.waitForTimeout(700)
await page.goto(base + '#/studio'); await page.waitForTimeout(1000)
check('its posts are drafts in the Studio', (await page.innerText('body')).includes('بلک‌فرایدی'))
await page.goto(base + '#/events'); await page.waitForTimeout(700)
if (shots) await page.screenshot({ path: path.join(shots, 'events_list.png'), fullPage: true })
const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
check('no horizontal overflow', ov <= 0, String(ov))
console.log(errors.length ? '❌ errors:\n' + [...new Set(errors)].join('\n') : '✅ no console errors')
await browser.close(); server.close()
process.exit(errors.length ? 1 : 0)
