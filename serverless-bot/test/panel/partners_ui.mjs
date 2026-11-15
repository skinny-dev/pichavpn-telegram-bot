// (Partners) Opens the real panel (serverless-bot/dist) in a browser with a Telegram.WebApp.Serverless stand-in that calls the panel endpoint
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
await page.goto(base + '#/partners'); await page.waitForTimeout(1500)
check('the page lists the partners and says simulation is on', (await page.getByTestId('partner').count()) >= 5 && (await page.innerText('body')).includes('شبیه‌سازی'), String(await page.getByTestId('partner').count()))
check('the tier table is there with five steps', (await page.getByTestId('tier').count()) === 5)
await page.getByTestId('preview').click(); await page.waitForTimeout(800)
check('the preview of the automatic changes is shown', (await page.getByTestId('plan').count()) === 1)
if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, 'partners.png'), fullPage: true }) }
const first = page.getByTestId('partner').first()
await first.locator('input').first().fill('18')
await first.getByRole('button', { name: /ثبت دستی/ }).click(); await page.waitForTimeout(900)
const txt = await page.getByTestId('partner').first().innerText()
check('a manual price is saved, locked and shown with the percent', txt.includes('۱۸') && txt.includes('دستی'), txt.slice(0, 120))
await first.locator('input').first().fill('70').catch(() => {})
const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
check('no horizontal overflow', ov <= 0, String(ov))
console.log(errors.length ? '❌ errors:\n' + [...new Set(errors)].join('\n') : '✅ no console errors')
await browser.close(); server.close()
process.exit(errors.length ? 1 : 0)
