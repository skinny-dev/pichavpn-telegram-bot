import { chromium } from 'playwright-core'
const base = process.env.PANEL_URL || 'http://127.0.0.1:8099/dashboard/index.html'
const exe = process.env.CHROME_DIR || '/opt/pw-browsers/chromium-1194/chrome-linux'
import fs from 'node:fs'
const exePath = fs.existsSync(exe + '/chrome') ? exe + '/chrome' : undefined
const browser = await chromium.launch({ executablePath: exePath, args: ['--no-sandbox'] })
const out = []
const ok = (n, c, x = '') => { out.push((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + x)) }

async function session(viewport, tag) {
  const ctx = await browser.newContext({ viewport, hasTouch: tag === 'mobile', isMobile: tag === 'mobile', locale: 'fa-IR' })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.goto(base)
  await page.getByLabel('نام کاربری').fill('admin')
  await page.getByLabel('رمز عبور').fill('testpass123')
  await page.getByRole('button', { name: 'ورود' }).click()
  await page.getByText('درآمد امروز').waitFor({ timeout: 10000 })
  return { ctx, page, errors }
}

// ---------- desktop
{
  const { ctx, page, errors } = await session({ width: 1366, height: 800 }, 'desktop')
  ok('desktop: overview loads', await page.getByText('فروش ۳۰ روز اخیر').isVisible())
  ok('desktop: html is rtl', (await page.getAttribute('html', 'dir')) === 'rtl')
  await page.screenshot({ path: '/tmp/shot-desktop-overview.png' })

  await page.goto(base + '#/users')
  await page.getByRole('grid').waitFor()
  await page.getByText('Sara', { exact: true }).waitFor()
  ok('users grid shows 3 rows', (await page.locator('tbody tr').count()) === 3)

  // inline edit: select cell, press Enter, type, Enter
  const row = page.locator('tbody tr', { hasText: 'Ali' })
  const scoreCol = await page.locator('th', { hasText: 'امتیاز' }).evaluate((th) => [...th.parentElement.children].indexOf(th))
  const cell = row.locator('td').nth(scoreCol)
  await cell.click()
  await page.keyboard.press('Enter')
  await page.keyboard.type('42')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(600)
  ok('inline edit saved (score 42)', (await cell.innerText()).includes('۴۲'), await cell.innerText())
  await page.reload(); await page.getByText('Sara', { exact: true }).waitFor()
  ok('inline edit persisted after reload', (await page.locator('tbody tr', { hasText: 'Ali' }).locator('td').nth(scoreCol).innerText()).includes('۴۲'))

  // invalid number rejected + rolled back
  const c2 = page.locator('tbody tr', { hasText: 'Ali' }).locator('td').nth(scoreCol)
  await c2.click(); await page.keyboard.press('Enter'); await page.keyboard.type('abc'); await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
  ok('invalid number rolled back', (await c2.innerText()).includes('۴۲'), await c2.innerText())

  // search
  await page.getByLabel('جستجو').fill('reza'); await page.waitForTimeout(700)
  ok('search narrows to 1 row', (await page.locator('tbody tr').count()) === 1)
  await page.getByLabel('جستجو').fill(''); await page.waitForTimeout(900)

  // export csv
  await page.getByRole('button', { name: /خروجی/ }).click()
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /CSV/ }).click()])
  const p = await dl.path(); const csv = fs.readFileSync(p, 'utf8')
  ok('csv export has BOM + header + 3 rows', csv.startsWith('﻿id,') && csv.trim().split('\n').length === 4, csv.slice(0, 120))

  // import: edit csv, re-import
  const edited = csv.replace(/^(.*)$/m, '$1').split('\n')
  const header = edited[0].replace('﻿', '').split(',')
  const idxScore = header.indexOf('score'), idxId = header.indexOf('id')
  const lines = [header.join(',')]
  lines.push(edited[1].split(',').map((v, i) => (i === idxScore ? '7' : v)).join(','))
  fs.writeFileSync('/tmp/import.csv', lines.join('\n'))
  await page.getByRole('button', { name: /درون‌ریزی/ }).click()
  await page.locator('input[type=file]').setInputFiles('/tmp/import.csv')
  await page.getByText('فایل معتبر است').waitFor({ timeout: 8000 })
  ok('import dry-run says valid', true)
  await page.getByRole('button', { name: 'اعمال تغییرات' }).click()
  await page.waitForTimeout(800)
  await page.getByText('Sara', { exact: true }).waitFor()
  await page.screenshot({ path: '/tmp/shot-desktop-users.png' })

  // products tree
  await page.goto(base + '#/products')
  await page.getByText('اقتصادی').first().waitFor()
  ok('tree shows categories', (await page.getByText('ویژه').count()) > 0)
  ok('tree shows product', (await page.getByText('۳۰ گیگ یک ماهه').count()) > 0)
  await page.screenshot({ path: '/tmp/shot-desktop-tree.png' })

  // drag product 'بدون دسته' (uncategorized) into first category using mouse
  const src = page.locator('li', { hasText: 'بدون دسته' }).first().getByLabel('جابجایی محصول')
  const dst = page.locator('section', { hasText: 'اقتصادی' }).first().locator('li').first()
  const sb = await src.boundingBox(), db = await dst.boundingBox()
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2)
  await page.mouse.down()
  await page.mouse.move(sb.x + 5, sb.y - 20, { steps: 5 })
  await page.mouse.move(db.x + db.width / 2, db.y + 5, { steps: 20 })
  await page.mouse.up()
  await page.waitForTimeout(1000)
  const r = await page.evaluate(async () => (await fetch('api.php?r=tree', { credentials: 'same-origin' })).json())
  const inFirst = r.categories.find((c) => c.remark === 'اقتصادی').products.some((p) => p.name_product === 'بدون دسته')
  ok('drag moved product into category (persisted)', inFirst, JSON.stringify(r.uncategorized.map((p) => p.name_product)))

  // stats page
  await page.goto(base + '#/stats')
  await page.getByText('درآمد خالص').first().waitFor()
  await page.getByRole('tab', { name: 'ماه قبل' }).click()
  await page.getByText('بازه').waitFor()
  ok('stats period switch works', true)
  await page.screenshot({ path: '/tmp/shot-desktop-stats.png' })
  ok('desktop: no console errors', errors.length === 0, errors.join(' | ').slice(0, 300))
  await ctx.close()
}

// ---------- mobile
{
  const { ctx, page, errors } = await session({ width: 390, height: 844 }, 'mobile')
  ok('mobile: bottom nav visible', await page.getByRole('navigation', { name: 'منوی موبایل' }).isVisible())
  ok('mobile: sidebar hidden', !(await page.getByRole('navigation', { name: 'منوی اصلی' }).isVisible()))
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
  ok('mobile: no horizontal page scroll (overview)', !overflow)
  await page.screenshot({ path: '/tmp/shot-mobile-overview.png' })
  await page.goto(base + '#/users'); await page.getByText('Sara', { exact: true }).waitFor()
  const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
  ok('mobile: no horizontal page scroll (users)', !overflow2)
  // tap editable cell -> dialog
  const scoreCol = await page.locator('th', { hasText: 'امتیاز' }).evaluate((th) => [...th.parentElement.children].indexOf(th))
  await page.locator('tbody tr', { hasText: 'Sara' }).locator('td').nth(scoreCol).tap()
  await page.getByRole('dialog').waitFor()
  ok('mobile: tapping editable cell opens edit sheet', true)
  await page.screenshot({ path: '/tmp/shot-mobile-edit.png' })
  await page.keyboard.press('Escape')
  await page.goto(base + '#/products'); await page.getByText('اقتصادی').first().waitFor()
  await page.screenshot({ path: '/tmp/shot-mobile-tree.png' })
  await page.goto(base + '#/stats'); await page.getByText('درآمد خالص').first().waitFor()
  const overflow3 = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
  ok('mobile: no horizontal page scroll (stats)', !overflow3)
  await page.screenshot({ path: '/tmp/shot-mobile-stats.png' })
  ok('mobile: no console errors', errors.length === 0, errors.join(' | ').slice(0, 300))
  await ctx.close()
}
await browser.close()
console.log(out.join('\n'))
process.exit(out.some((l) => l.startsWith('FAIL')) ? 1 : 0)
