// node tests/finance_e2e.mjs   (needs the panel running with the seeded test DB, see tests/api_test.py)
import { chromium } from 'playwright-core'
import fs from 'node:fs'
const base = process.env.PANEL_URL || 'http://127.0.0.1:8099/dashboard/index.html'
const exe = process.env.CHROME_DIR || '/opt/pw-browsers/chromium-1194/chrome-linux'
const browser = await chromium.launch({ executablePath: fs.existsSync(exe + '/chrome') ? exe + '/chrome' : undefined, args: ['--no-sandbox'] })
const out = []
const ok = (n, c, x = '') => out.push((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + x))

async function run(tag, viewport) {
  const ctx = await browser.newContext({ viewport, locale: 'fa-IR', hasTouch: tag === 'mobile', isMobile: tag === 'mobile' })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && !/favicon/.test(m.text()) && errors.push(m.text()))
  await page.goto(base)
  await page.getByLabel('نام کاربری').fill('admin'); await page.getByLabel('رمز عبور').fill('testpass123'); await page.getByRole('button', { name: 'ورود' }).click()
  await page.getByText('درآمد امروز').waitFor({ timeout: 10000 })
  await page.goto(base + '#/finance')
  await page.getByText('موجودی پول').waitFor({ timeout: 10000 })
  ok(`${tag}: finance overview shows KPIs`, await page.getByText('سود خالص').first().isVisible())
  // overflow check: nothing may force horizontal page scroll
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  ok(`${tag}: no horizontal page scroll on overview`, overflow <= 1, String(overflow))
  const quick = async (label) => {
    await page.getByRole('button', { name: 'ثبت سریع' }).filter({ visible: true }).first().click()
    await page.getByRole('button', { name: new RegExp('^' + label) }).first().click()
  }
  const suffix = tag + Date.now().toString().slice(-5)
  // 1) partner puts capital in
  await quick('سرمایه')
  await page.getByPlaceholder('انتخاب شریک').fill('شریک ' + suffix)
  await page.getByRole('button', { name: /^ساخت/ }).click()
  await page.getByPlaceholder('0').first().fill('5000000')
  await page.getByRole('button', { name: 'ثبت ورود سرمایه' }).click()
  await page.getByText('ورود سرمایه ثبت شد').waitFor({ timeout: 8000 })
  ok(`${tag}: capital recorded`, true)
  // 2) expense
  await quick('هزینه')
  await page.getByPlaceholder('0').first().fill('200000')
  await page.getByPlaceholder('مثلاً کمپین اینستاگرام').fill('تست ' + suffix)
  await page.getByRole('button', { name: 'ثبت هزینه' }).click()
  await page.getByText('هزینه ثبت شد').waitFor({ timeout: 8000 })
  ok(`${tag}: expense recorded`, true)
  // 3) credit sale with part payment
  await quick('فروش')
  await page.getByPlaceholder(/مشتری/).fill('مشتری ' + suffix)
  await page.getByRole('button', { name: /^ساخت/ }).click()
  await page.getByPlaceholder('قیمت واحد').fill('1000000')
  await page.getByRole('radio', { name: 'بخشی' }).click()
  await page.getByPlaceholder('0').first().fill('400000')
  await page.getByRole('button', { name: 'ثبت فروش' }).click()
  await page.getByText('فروش ثبت شد').waitFor({ timeout: 8000 })
  ok(`${tag}: sale recorded`, true)
  // 4) receivables lists the customer with 600,000 left
  await page.goto(base + '#/finance/receivables')
  await page.getByText('مشتری ' + suffix).filter({ visible: true }).first().waitFor({ timeout: 8000 })
  ok(`${tag}: receivable listed for the new customer`, true)
  await page.screenshot({ path: `/tmp/claude-0/fin-${tag}-receivables.png` })
  await page.getByText('مشتری ' + suffix).filter({ visible: true }).first().click()
  await page.getByRole('button', { name: /^دریافت/ }).first().click()
  await page.getByRole('button', { name: 'ثبت دریافت' }).click()
  await page.getByText('دریافت ثبت شد').waitFor({ timeout: 8000 })
  ok(`${tag}: remaining balance collected (prefilled amount)`, true)
  // 5) activity + search
  await page.goto(base + '#/finance/activity')
  await page.getByText('فروش').first().waitFor({ timeout: 8000 })
  await page.getByPlaceholder(/جستجو: نام/).fill('تست ' + suffix)
  await page.getByText('تست ' + suffix).filter({ visible: true }).first().waitFor({ timeout: 8000 })
  ok(`${tag}: activity search finds the expense by memo`, true)
  await page.screenshot({ path: `/tmp/claude-0/fin-${tag}-activity.png` })
  await page.getByText('تست ' + suffix).filter({ visible: true }).first().click()
  await page.getByText('اثر مالی').waitFor({ timeout: 8000 })
  ok(`${tag}: transaction opens with journal effect`, await page.getByText('بدهکار').first().isVisible())
  await page.keyboard.press('Escape')
  // 6) reports
  await page.goto(base + '#/finance/reports')
  await page.getByText('صورت سود و زیان').waitFor({ timeout: 8000 })
  ok(`${tag}: P&L report renders`, await page.getByText('سود خالص').first().isVisible())
  await page.screenshot({ path: `/tmp/claude-0/fin-${tag}-reports.png` })
  await page.goto(base + '#/finance')
  await page.getByText('موجودی پول').waitFor()
  await page.waitForTimeout(600)
  await page.screenshot({ path: `/tmp/claude-0/fin-${tag}-overview.png` })
  const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  ok(`${tag}: no horizontal page scroll after use`, overflow2 <= 1, String(overflow2))
  ok(`${tag}: no console/page errors`, errors.length === 0, errors.join(' | ').slice(0, 300))
  await ctx.close()
}
if (!process.env.ONLY || process.env.ONLY === 'desktop') await run('desktop', { width: 1440, height: 900 })
if (!process.env.ONLY || process.env.ONLY === 'mobile') await run('mobile', { width: 390, height: 800 })
console.log(out.join('\n'))
await browser.close()
process.exit(out.some((l) => l.startsWith('FAIL')) ? 1 : 0)
