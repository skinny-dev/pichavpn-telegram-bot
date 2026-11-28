// index.php lines 5918–6652: referral page and membership gift, agents (extra volume for a panel user, panel,
// custom name, request to become an agent), message to the admins, lucky wheel, price commands, renew list, apps, notes.
import { brandSettings, brandEligibility, brandSet } from '../partners.js'
import { reportText, customersPage, isPartner } from '../partnerhub.js'
import { sleep } from '../timer.js'
import { one, all, run, sql, kvGet, kvSet } from '../db.js'
import { sendmessage, deletemessage, Editmessagetext, telegram } from '../tg.js'
import { step, shop, tehranDate } from '../bot.js'
import { checkActiveBtn, backuserKb } from '../keyboards.js'
import { dataUser, extraVolume } from '../panel.js'
import { deductBalance, addBalance, stepPaymentKb } from '../catalog.js'
import { rateArze } from './pay.js'
import { extendRoutes } from './extend.js'
import { reportTs } from '../sms.js'
import { jdate } from '../fmt.js'
import { sprintf, numberFormat, intval, time, J, phpJson } from '../php.js'

const isNumeric = (v) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && /^\s*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?\s*$/.test(v))
const n = (v) => (isNumeric(v) ? Number(v) : 0)
const truthy = (s) => s !== '' && s !== '0' && s !== null && s !== undefined && s !== 0
const agentOf = (json, agent) => { try { const d = JSON.parse(json); return d && typeof d === 'object' ? d[agent] ?? null : null } catch { return null } }
const report = (c, thread, text) => (String(c.setting.Channel_Report ?? '').length > 0 ? telegram('sendmessage', { chat_id: c.setting.Channel_Report, message_thread_id: c.topics[thread], text, parse_mode: 'HTML' }) : null)
const LIVE = `(status = 'active' OR status = 'end_of_time' OR status = 'end_of_volume' OR status = 'sendedwarn' OR Status = 'send_on_hold')`

// the partner corner of the bot (report, customers, priority support): only partners (agent n / n2)
const HUB = { report: '📊 گزارش من', customers: '👥 مشتری‌های من', support: '🎧 پشتیبانی ویژه' }
const back = J({ inline_keyboard: [[{ text: '↩️ بازگشت', callback_data: 'agentpanel' }]] })
const send = (c, text, kb) => (c.datain && c.message_id ? Editmessagetext(c.from_id, c.message_id, text, kb, 'HTML') : sendmessage(c.from_id, text, kb, 'HTML'))

const hubRoutes = [
  async (c) => {
    if (!(c.text === HUB.report || c.datain === 'agentreport')) return false
    if (!isPartner(c.user)) { await sendmessage(c.from_id, 'این بخش مخصوص همکاران است.', null, 'HTML'); return true }
    await send(c, await reportText(c.user), J({ inline_keyboard: [[{ text: HUB.customers, callback_data: 'pcust_need_1' }], [{ text: '↩️ بازگشت', callback_data: 'agentpanel' }]] }))
    return true
  },
  async (c) => {
    const m = /^pcust_(need|all)_(\d+)$/.exec(c.datain || '')
    if (!(m || c.text === HUB.customers)) return false
    if (!isPartner(c.user)) { await sendmessage(c.from_id, 'این بخش مخصوص همکاران است.', null, 'HTML'); return true }
    const r = await customersPage(c.user, m ? m[1] : 'need', m ? Number(m[2]) : 1)
    await send(c, r.text, J(r.kb))
    return true
  },
  async (c) => {
    if (!(c.text === HUB.support || c.datain === 'agentsupport')) return false
    if (!isPartner(c.user)) { await sendmessage(c.from_id, 'این بخش مخصوص همکاران است.', null, 'HTML'); return true }
    const deps = await all(sql`SELECT * FROM departman`)
    const rows = deps.map((r) => [{ text: r.name_departman, callback_data: `departman_${r.id}` }])
    rows.push([{ text: '↩️ بازگشت', callback_data: 'agentpanel' }])
    await send(c, 'درود 🌿\n⭐ پیام‌های همکاران با <b>اولویت</b> بررسی می‌شود. بخش مورد نظر را انتخاب کنید و پیام را بنویسید.', J({ inline_keyboard: rows }))
    return true
  },
]

/** $keyboardagent of keyboard.php + the partner corner (report, customers, wallet, priority support) */
export async function keyboardAgent(c) {
  const T = c.T
  const named = Number((await one(sql`SELECT COUNT(*) AS n FROM marzban_panel WHERE MethodUsername = 'agentCustomTextSequential'`)).n) || (await brandSettings()).on
  if (c.setting.inlinebtnmain === 'oninline') {
    const row = [{ text: T.keyboard.bulkPurchase, callback_data: 'kharidanbuh' }]
    if (named) row.push({ text: T.keyboard.selectCustomName, callback_data: 'selectname' })
    return J({ inline_keyboard: [row, [{ text: HUB.report, callback_data: 'agentreport' }, { text: HUB.customers, callback_data: 'pcust_need_1' }], [{ text: T.textbot.accountWallet, callback_data: 'account' }, { text: HUB.support, callback_data: 'agentsupport' }], [{ text: T.users.backbtn, callback_data: 'backuser' }]], resize_keyboard: true })
  }
  const row = [{ text: T.keyboard.bulkPurchase }]
  if (named) row.push({ text: T.keyboard.selectCustomName })
  return J({ keyboard: [row, [{ text: HUB.report }, { text: HUB.customers }], [{ text: T.textbot.accountWallet }, { text: HUB.support }], [{ text: T.users.backbtn }]], resize_keyboard: true })
}
/** what we ask a shop owner who wants to become a partner (instead of the vague «توضیحات»): everything the administrator needs to decide, with an example */
export const AGENT_ASK = 'درود 🌿\nبرای ثبت درخواست همکاری، لطفاً در <b>یک پیام</b> بنویسید:\n\n۱) نام فروشگاه یا کسب‌وکار\n۲) شهر\n۳) نوع کار (موبایل‌فروشی، کانال، فروشگاه آنلاین …)\n۴) تقریباً ماهی چند مشتری VPN دارید یا فکر می‌کنید داشته باشید؟\n۵) آیدی تلگرام یا شماره برای تماس\n\nنمونه:\n«موبایل پارس، شیراز، موبایل‌فروشی، حدود ۳۰ مشتری در ماه، @name»'
export const AGENT_DONE = '✅ درخواست‌تون ثبت شد 🌿\nبررسی می‌شه و نتیجه رو همین‌جا خبر می‌دیم. تا اون موقع می‌تونید با «اکانت تست» کیفیت سرویس رو خودتون امتحان کنید.\nاگه سؤالی بود، از «پشتیبانی» بنویسید.'
/** the renew list (20 a page): every row says which service it is (name · plan), and «next/previous» exist only when there is another page */
const RENEW_PAGE = 20
const fun = async (k) => { try { const d = new Date(Date.now() + 12600000).toISOString().slice(0, 10).replace(/-/g, ''); const key = `funnel:${d}:${k}`; await kvSet(key, String((Number(await kvGet(key)) || 0) + 1)) } catch { /* counters never break a menu */ } }
const renewCount = async (c) => Number((await one(sql`SELECT COUNT(*) AS n FROM invoice WHERE id_user = ${c.from_id} AND ${sql.raw(LIVE)}`)).n)
const shortText = (s, n) => { const a = Array.from(String(s ?? '')); return a.length > n ? a.slice(0, n - 1).join('') + '…' : a.join('') }
async function renewList(c, page, count = null) {
  const T = c.T
  const total = count ?? await renewCount(c)
  const pages = Math.max(1, Math.ceil(total / RENEW_PAGE))
  const at = Math.min(Math.max(1, page), pages)
  const rows = await all(sql`SELECT * FROM invoice WHERE id_user = ${c.from_id} AND ${sql.raw(LIVE)} ORDER BY time_sell DESC LIMIT ${RENEW_PAGE} OFFSET ${(at - 1) * RENEW_PAGE}`)
  const kb = { inline_keyboard: rows.map((r) => [{ text: '✨' + r.username + (r.name_product ? ' · ' + shortText(r.name_product, 28) : '') + (c.statusnote ? ` | ${r.note ?? ''}` : '') + '✨', callback_data: 'extend_' + r.id_invoice }]) }
  const nav = []
  if (at > 1) nav.push({ text: T.users.page.previous, callback_data: 'previous_page_extends' })
  if (at < pages) nav.push({ text: T.users.page.next, callback_data: 'next_page_extends' })
  if (nav.length) kb.inline_keyboard.push(nav)
  kb.inline_keyboard.push([{ text: T.users.backbtn, callback_data: 'backuser' }])
  return { kb, page: at }
}
const sanitizeName = (s) => ["'", '"', '<', '>', '--', '#', ';', '\\', '%', '(', ')'].reduce((a, ch) => a.split(ch).join(''), String(s))

export const miscRoutes = [
  ...hubRoutes,
  // the answers to «سفارشتون براتون ارسال شده؟» (pending-order nudge, lib/cron.js pendingNudge)
  async (c) => {
    const m = /^nudge_(ok|no|help)_(.+)$/.exec(c.datain || '')
    if (!m) return false
    const [, what, orderId] = m
    const o = await one(sql`SELECT * FROM Payment_report WHERE id_order = ${orderId} AND id_user = ${c.from_id}`) // only the owner of the order can answer for it
    const done = async (text, kb = null) => { await telegram('answerCallbackQuery', { callback_query_id: c.callback_query_id }); await Editmessagetext(c.from_id, c.message_id, text, kb ?? J({ inline_keyboard: [] }), 'HTML') }
    const bumpN = async (k) => kvSet('care:n:nudge:' + k, String((Number(await kvGet('care:n:nudge:' + k)) || 0) + 1))
    if (!o) { await done('سپاسگزارم 🌿'); return true }
    if (what === 'ok') { await bumpN('ok'); await done('خوشحالیم 🌿 سپاسگزارم.'); return true }
    if (what === 'help') {
      await bumpN('help')
      await done('درود 🌿 پشتیبانی همین‌جاست؛ مشکل را بنویسید تا کمک کنیم.', J({ inline_keyboard: [[{ text: '💬 صحبت با پشتیبانی', callback_data: 'supportbtns' }]] }))
      return true
    }
    await bumpN('no') // «not arrived yet»: the customer is told it is being followed up, the administrators get the order
    await done('درود 🌿 پیگیری شد؛ همین الان سفارش‌تان را بررسی می‌کنیم و خبر می‌دهیم. سپاسگزارم از صبوری‌تان.')
    const text = `🔔 مشتری می‌گوید سفارشش نرسیده\nکاربر: <code>${c.from_id}</code> ${c.username ? '@' + String(c.username).replace(/[<>&]/g, '') : ''}\nسفارش: <code>${String(o.id_order).replace(/[<>&]/g, '')}</code>\nمبلغ: ${numberFormat(n(o.price))} تومان · روش: ${String(o.Payment_Method ?? '').replace(/[<>&]/g, '')} · وضعیت: ${String(o.payment_Status).replace(/[<>&]/g, '')}`
    const kb = J({ inline_keyboard: [[{ text: '👤 مدیریت کاربر', callback_data: 'manageuser_' + c.from_id }]] })
    for (const id of c.admin_ids) { const a = await one(sql`SELECT rule FROM admin WHERE id_admin = ${id}`); if (a && a.rule === 'Seller') continue; await sendmessage(id, text, kb, 'HTML') }
    return true
  },
  // /nudge — administrator: status, on/off (all), unpaid on/off
  async (c) => {
    if (c.adminRow?.rule !== 'administrator') return false
    const m = /^\/nudge(?:\s+(on|off|unpaid)(?:\s+(on|off))?)?\s*$/.exec(String(c.text ?? '').trim())
    if (!m) return false
    if (m[1] === 'on' || m[1] === 'off') await kvSet('nudge:on', m[1] === 'on' ? '1' : '0')
    if (m[1] === 'unpaid' && m[2]) await kvSet('nudge:unpaid', m[2] === 'on' ? '1' : '0')
    const sentN = async (k) => Number(await kvGet('care:n:nudge:' + k)) || 0
    const on = (await kvGet('nudge:on')) !== '0', un = (await kvGet('nudge:unpaid')) !== '0'
    await sendmessage(c.from_id, `🔔 <b>یادآوری سفارش‌های معلق</b>\n\nوضعیت: ${on ? '✅ روشن' : '⛔ خاموش'} · «پرداخت ناتمام»: ${un ? 'روشن' : 'خاموش'}\nارسال‌شده: نرسیده/تأییدنشده ${await sentN('undelivered') + await sentN('waiting') + await sentN('topup')} · پرداخت ناتمام ${await sentN('unpaid')}\nجواب‌ها: دریافت کردم ${await sentN('ok')} · نرسیده ${await sentN('no')} · کمک ${await sentN('help')}\n\n<code>/nudge off</code> · <code>/nudge on</code> · <code>/nudge unpaid off</code>`, null, 'HTML')
    return true
  },
  // the referral page
  async (c) => {
    const T = c.T, user = c.user
    if (!(c.text === T.textbot.affiliates || c.datain === 'affiliatesbtn')) return false
    if (!checkActiveBtn(c.setting.keyboardmain, 'text_affiliates')) { await sendmessage(c.from_id, T.users.buttonDisabled, null, 'HTML'); return true }
    const aff = (await one(sql`SELECT * FROM affiliates LIMIT 1`)) || {}
    const bot = (await kvGet('config:usernamebot')) || ''
    const intro = `${aff.description ?? ''}\n\n🔗 https://t.me/${bot}?start=${c.from_id}`
    if (String(aff.id_media ?? '').length >= 5) await telegram('sendphoto', { chat_id: c.from_id, photo: aff.id_media, caption: intro, parse_mode: 'HTML' })
    const info = (await one(sql`SELECT COUNT(*) AS orders, SUM(price_product) AS total_price FROM invoice WHERE Status IN ('active', 'end_of_time', 'sendedwarn', 'send_on_hold') AND refral = ${c.from_id} AND name_product != ${T.common.labels.testServiceName}`)) || {}
    const total = (n(info.total_price) * n(c.setting.affiliatespercentage)) / 100
    const kb = J({ inline_keyboard: [[{ text: T.keyboard.receiveMembershipGift, callback_data: 'get_gift_start' }, { text: T.keyboard.shareLink, url: `https://t.me/share/url?url=https://t.me/${bot}?start=${c.from_id}` }]] })
    const start = aff.Discount === 'onDiscountaffiliates' ? sprintf(T.users.affiliates.membershipGiftInfo, aff.price_Discount) : ''
    const porsant = aff.status_commission === 'oncommission' ? sprintf(T.users.affiliates.purchaseCommissionInfo, c.setting.affiliatespercentage) : ''
    await sendmessage(c.from_id, sprintf(T.users.affiliates.welcomeGiftInfo, start, porsant, user.affiliatescount, info.orders, numberFormat(total, 0)), kb, 'HTML')
    return true
  },
  // the membership gift (half to the user, half to who invited them)
  async (c) => {
    if (c.datain !== 'get_gift_start') return false
    const T = c.T, user = c.user, A = T.users.affiliates
    const aff = (await one(sql`SELECT * FROM affiliates LIMIT 1`)) || {}
    if (aff.Discount === 'offDiscountaffiliates') { await sendmessage(c.from_id, T.users.sectionDisabled, c.keyboard, 'HTML'); return true }
    if (!(await one(sql`SELECT 1 AS x FROM user WHERE id = ${user.affiliates ?? null} LIMIT 1`))) { await sendmessage(c.from_id, A.notReferral, c.keyboard, 'HTML'); return true }
    const rg = await one(sql`SELECT * FROM reagent_report WHERE user_id = ${c.from_id}`)
    if (!rg) { await sendmessage(c.from_id, A.notReferral, c.keyboard, 'HTML'); return true }
    // MySQL: '' = 0 is true
    const claim = await run(sql`UPDATE reagent_report SET get_gift = 1 WHERE user_id = ${c.from_id} AND (get_gift = 0 OR get_gift = '' OR get_gift = '0')`)
    if (Number(claim?.rowsAffected ?? 0) !== 1) { await sendmessage(c.from_id, A.membershipGiftClaimed, c.keyboard, 'HTML'); return true }
    const gift = intval(aff.price_Discount) / 2
    const ref = (await one(sql`SELECT * FROM user WHERE id = ${String(rg.reagent)}`)) || {}
    await addBalance(rg.reagent, gift)
    await addBalance(c.from_id, gift)
    await sendmessage(rg.reagent, A.joinedGift, null, 'html')
    await sendmessage(c.from_id, A.joinGiftActivated, null, 'html')
    await report(c, 'porsantreport', sprintf(T.Admin.reportgroup.membershipGiftPaid, c.from_id, c.username, rg.reagent, user.Balance, n(user.Balance) + gift, ref.Balance, n(ref.Balance) + gift))
    return true
  },
  // agents: extra volume for a panel user found by username
  async (c) => {
    const m = /Extra_volumes_(\w+)_(.*)/.exec(c.datain)
    if (!m) return false
    const T = c.T
    const inv = await one(sql`SELECT * FROM invoice WHERE username = ${m[1]}`)
    if (!inv || String(inv.id_user) !== c.from_id) return true
    const p = (await one(sql`SELECT * FROM marzban_panel WHERE code_panel = ${m[2]}`)) || {}
    await run(sql`UPDATE user SET Processing_value = ${m[1]}, Processing_value_one = ${p.name_panel ?? null} WHERE id = ${c.from_id}`)
    await sendmessage(c.from_id, sprintf(T.users.extraVolume.enterextravolume, agentOf(p.priceextravolume, c.user.agent)), backuserKb(c), 'HTML')
    await step(c, 'getvolumeextras')
    return true
  },
  async (c) => {
    if (c.user.step !== 'getvolumeextras') return false
    const T = c.T, backuser = backuserKb(c)
    if (!/^[0-9]+$/.test(c.text)) { await sendmessage(c.from_id, T.common.invalidVolume, backuser, 'HTML'); return true }
    if (Number(c.text) < 1) { await sendmessage(c.from_id, T.users.extraVolume.invalidprice, backuser, 'HTML'); return true }
    const p = (await one(sql`SELECT * FROM marzban_panel WHERE name_panel = ${c.user.Processing_value_one ?? null}`)) || {}
    const per = agentOf(p.priceextravolume, c.user.agent)
    const price = n(per) * Number(c.text)
    await sendmessage(c.from_id, sprintf(T.users.extraVolume.extravolumeinvoice, numberFormat(n(per), 0), numberFormat(price, 0), c.text), J({ inline_keyboard: [[{ text: T.users.extraVolume.extracheck, callback_data: 'confirmaextras_' + sprintf('%s', price) }]] }), 'HTML')
    await step(c, 'home')
    return true
  },
  async (c) => {
    const m = /confirmaextras_(\w+)/.exec(c.datain)
    if (!m) return false
    const T = c.T, user = c.user
    let price = m[1]
    const inv = await one(sql`SELECT * FROM invoice WHERE username = ${user.Processing_value ?? null}`)
    if (!inv || String(inv.id_user) !== c.from_id) return true
    if (n(user.Balance) < n(price) && user.agent !== 'n2') {
      if ((await shop('statusdirectpabuy')) === 'offdirectbuy') {
        const pay = async (k) => agentOf((await one(sql`SELECT ValuePay FROM PaySetting WHERE NamePay = ${k}`))?.ValuePay, user.agent)
        await Editmessagetext(c.from_id, c.message_id, sprintf(T.users.Balance.insufficientbalance, numberFormat(n(await pay('minbalance'))), numberFormat(n(await pay('maxbalance')))), J({ inline_keyboard: [[{ text: T.users.status.backinfo, callback_data: 'account' }]] }), 'HTML')
        await step(c, 'getprice')
        return true
      }
      if (intval(user.pricediscount) !== 0) { price = n(price) - (n(price) * n(user.pricediscount)) / 100; await sendmessage(c.from_id, sprintf(T.users.Discount.discountapplied, user.pricediscount), null, 'HTML') }
      await run(sql`UPDATE user SET Processing_value = ${sprintf('%s', n(price) - n(user.Balance))} WHERE id = ${c.from_id}`)
      await sendmessage(c.from_id, T.users.sell.noCredit, await stepPaymentKb(c), 'HTML')
      await step(c, 'get_step_payment')
      return true
    }
    const p = await one(sql`SELECT * FROM marzban_panel WHERE name_panel = ${user.Processing_value_one ?? null}`)
    if (!p) { await sendmessage(c.from_id, T.users.status.error, null, 'html'); return true }
    const per = agentOf(p.priceextravolume, user.agent)
    await deletemessage(c.from_id, c.message_id)
    if (intval(user.pricediscount) !== 0) { price = n(price) - (n(price) * n(user.pricediscount)) / 100; await sendmessage(c.from_id, sprintf(T.users.Discount.discountapplied, user.pricediscount), null, 'HTML') }
    if (!(await deductBalance(user, price))) { await sendmessage(c.from_id, T.users.Balance.notEnoughBalance, null, 'HTML'); return true }
    const d = await dataUser(user.Processing_value_one, user.Processing_value, c.domain)
    const gb = intval(price) / intval(per)
    const limit = n(d.data_limit) + gb * 1024 ** 3
    await run(sql`INSERT OR IGNORE INTO service_other (id_user, username, value, type, time, price) VALUES (${c.from_id}, ${user.Processing_value}, ${sprintf('%s', limit)}, 'extra_not_user', ${tehranDate()}, ${sprintf('%s', price)})`)
    const ex = await extraVolume(user.Processing_value, p.code_panel, gb)
    if (ex.status === false) {
      await addBalance(c.from_id, price)
      await sendmessage(c.from_id, T.users.extraVolume.serviceError, null, 'HTML')
      await report(c, 'errorreport', sprintf(T.Admin.reportgroup.errorExtraVolume2, user.Processing_value_one, user.Processing_value, phpJson(ex.msg)))
      return true
    }
    await sendmessage(c.from_id, T.users.extend.thanks, J({ inline_keyboard: [[{ text: T.users.backbtn, callback_data: 'backuser' }]] }), 'HTML')
    await report(c, 'otherservice', sprintf(T.Admin.reportgroup.volumePurchase, c.from_id, numberFormat(n(price) / n(per), 0), price, user.Balance, user.Processing_value))
    return true
  },
  async (c) => {
    if (c.datain !== 'searchservice') return false
    await sendmessage(c.from_id, c.T.users.search.usernamgeget, backuserKb(c), 'HTML')
    await step(c, 'getuseragnetservice')
    return true
  },
  // a message to the admins (answer to an admin message)
  async (c) => {
    if (c.datain !== 'Responseuser') return false
    await step(c, 'getmessageAsuser')
    await sendmessage(c.from_id, c.T.Admin.manageUser.getTextResponse, backuserKb(c), 'HTML')
    return true
  },
  async (c) => {
    if (c.user.step !== 'getmessageAsuser') return false
    const T = c.T
    await sendmessage(c.from_id, T.users.support.sendmessageadmin, c.keyboard, 'HTML')
    const kb = J({ inline_keyboard: [[{ text: T.users.support.answermessage, callback_data: 'Response_' + c.from_id }]] })
    for (const id of c.admin_ids) {
      const a = await one(sql`SELECT rule FROM admin WHERE id_admin = ${id}`)
      if (a && a.rule === 'Seller') continue
      if (truthy(c.text)) await sendmessage(id, sprintf(T.Admin.messageBulk.userMessage, c.from_id, c.username, c.caption + c.text), kb, 'HTML')
      if (c.photo) await telegram('sendphoto', { chat_id: id, photo: c.photoid, reply_markup: kb, caption: sprintf(T.Admin.messageBulk.userResponse, c.from_id, c.username, c.caption), parse_mode: 'HTML' })
    }
    await step(c, 'home')
    return true
  },
  // agent panel
  async (c) => {
    const T = c.T
    if (!((c.text === T.textbot.agentPanel || c.datain === 'agentpanel') && c.user.agent !== 'f')) return false
    if (c.setting.inlinebtnmain === 'oninline') await Editmessagetext(c.from_id, c.message_id, T.users.agent.welcome, await keyboardAgent(c), 'HTML')
    else await sendmessage(c.from_id, T.users.agent.welcome, await keyboardAgent(c), 'HTML')
    return true
  },
  async (c) => {
    if (!(c.text === c.T.users.agent.customnameusername || c.datain === 'selectname')) return false
    const st = await brandSettings()
    if (st.on) { // the brand name of a partner: only for partners who reached the level (or were allowed)
      const e = await brandEligibility(c.user)
      if (!e.ok) {
        const why = e.why === 'not_partner' ? 'این امکان مخصوص همکاران است.' : `این امکان وقتی برای شما فعال می‌شود که حجم خرید ۳۰ روز اخیرتان به سطح «${st.minName}» (${st.minGb} گیگ) برسد، یا با پشتیبانی هماهنگ کنید.`
        await sendmessage(c.from_id, `درود 🌿\n${why}`, backuserKb(c), 'HTML')
        return true
      }
      await sendmessage(c.from_id, `درود 🌿\nنام برند خود را به لاتین بنویسید (۳ تا ۱۶ حرف یا عدد، بدون فاصله؛ مثال: acmephone).\nنام کاربری سرویس‌هایی که می‌سازید به این شکل می‌شود: <code>acmephone_a1b2</code>${c.user.namecustom ? `\nنام فعلی شما: <code>${String(c.user.namecustom).replace(/[<>&]/g, '')}</code>` : ''}`, backuserKb(c), 'HTML')
    } else await sendmessage(c.from_id, c.T.users.selectusername, backuserKb(c), 'html')
    await step(c, 'selectusernamecustom')
    return true
  },
  async (c) => {
    if (c.user.step !== 'selectusernamecustom') return false
    const T = c.T
    if ((await brandSettings()).on) {
      if (!(await brandEligibility(c.user)).ok) { await step(c, 'home'); return true }
      const r = await brandSet(c.from_id, c.text)
      if (!r.ok) { await sendmessage(c.from_id, `${r.error}`, backuserKb(c), 'HTML'); return true }
      await sendmessage(c.from_id, `✅ نام برند شما ثبت شد: <code>${r.name}</code>\nاز این پس سرویس‌هایی که می‌سازید با <code>${r.name}_</code> شروع می‌شود. سپاسگزارم.`, await keyboardAgent(c), 'HTML')
      await step(c, 'home')
      return true
    }
    if (!/^(?!_)[a-z][a-z\d_]{2,32}(?<!_)$/i.test(c.text)) { await sendmessage(c.from_id, T.users.invalidusername, backuserKb(c), 'HTML'); return true }
    await sendmessage(c.from_id, T.users.agent.usernameSaved, await keyboardAgent(c), 'html')
    await run(sql`UPDATE user SET namecustom = ${c.text} WHERE id = ${c.from_id}`)
    await step(c, 'home')
    return true
  },
  // request to become an agent
  async (c) => {
    const T = c.T, user = c.user, A = T.users.agent
    if (!(c.text === T.textbot.requestAgent || c.datain === 'requestagent')) return false
    if (!checkActiveBtn(c.setting.keyboardmain, 'text_requestagent')) { await sendmessage(c.from_id, T.users.buttonDisabled, null, 'HTML'); return true }
    if (n(user.Balance) < n(c.setting.agentreqprice)) { await sendmessage(c.from_id, sprintf(A.insufficientbalanceagent, numberFormat(n(c.setting.agentreqprice))), backuserKb(c), 'HTML'); return true }
    if (Number((await one(sql`SELECT COUNT(*) AS n FROM Requestagent WHERE id = ${c.from_id}`)).n) !== 0) { await sendmessage(c.from_id, A.requestreport, null, 'html'); return true }
    if (user.agent !== 'f') { await sendmessage(c.from_id, A.isagent, null, 'html'); return true }
    if (c.datain === 'requestagent') await Editmessagetext(c.from_id, c.message_id, AGENT_ASK, backuserKb(c), 'HTML')
    else await sendmessage(c.from_id, AGENT_ASK, backuserKb(c), 'html')
    await step(c, 'getagentrequest')
    return true
  },
  async (c) => {
    if (!(c.user.step === 'getagentrequest' && truthy(c.text))) return false
    const T = c.T, A = T.users.agent
    if (!(await deductBalance(c.user, intval(c.setting.agentreqprice)))) { await sendmessage(c.from_id, T.users.Balance.notEnoughBalance, c.keyboard, 'HTML'); await step(c, 'home'); return true }
    await sendmessage(c.from_id, AGENT_DONE, c.keyboard, 'html')
    await step(c, 'home')
    await run(sql`INSERT INTO Requestagent (id, username, time, Description, status, type) VALUES (${c.from_id}, ${c.username}, ${time()}, ${c.text}, 'waiting', 'None')`)
    const kb = J({ inline_keyboard: [
      [{ text: A.acceptrequest, callback_data: 'addagentrequest_' + c.from_id }, { text: A.rejectrequest, callback_data: 'rejectrequesta_' + c.from_id }],
      [{ text: T.users.SendMessage, callback_data: 'Response_' + c.from_id }],
    ] })
    const marketer = await one(sql`SELECT l.name AS name, l.code AS code FROM referral_signups s JOIN referral_links l ON l.id = s.link_id WHERE s.user_id = ${c.from_id} ORDER BY s.created_at DESC LIMIT 1`) // the marketer who brought this person, if any
    const text = sprintf(A.agentRequest, c.from_id, c.username, c.first_name, c.text) + (marketer ? `\n\n📣 معرف: ${String(marketer.name ?? '').replace(/[<>&]/g, '')} (${String(marketer.code ?? '').replace(/[<>&]/g, '')})` : '')
    for (const id of c.admin_ids) await sendmessage(id, text, kb, 'HTML')
    return true
  },
  async (c) => {
    if (c.text !== '/privacy') return false
    await sendmessage(c.from_id, c.T.textbot.rules, null, 'HTML')
    return true
  },
  // lucky wheel (a dice)
  async (c) => {
    const T = c.T, user = c.user, S = c.setting, W = T.users.wheelLuck
    if (!(c.text === T.textbot.wheelLuck || c.datain === 'wheel_luck' || c.text === '/gift')) return false
    if (!checkActiveBtn(S.keyboardmain, 'text_wheel_luck')) { await sendmessage(c.from_id, T.users.buttonDisabled, null, 'HTML'); return true }
    if (String(S.wheelagent) === '0' && user.agent !== 'f') { await sendmessage(c.from_id, T.users.buttonDisabledForYou, null, 'HTML'); return true }
    const bought = Number((await one(sql`SELECT COUNT(*) AS n FROM invoice WHERE name_product != ${T.common.labels.testServiceName} AND id_user = ${c.from_id} AND status != 'Unpaid'`)).n)
    if (intval(S.statusfirstwheel) === 1 && bought !== 0) { await sendmessage(c.from_id, T.users.sell.noPurchaseUsersOnly, null, 'HTML'); return true }
    const recent = async () => {
      const last = await one(sql`SELECT * FROM wheel_list WHERE id_user = ${c.from_id} ORDER BY time DESC LIMIT 1`)
      const t = last ? reportTs(last) : 0
      return last && t > 0 && time() - t <= 86400
    }
    if (await recent()) { await sendmessage(c.from_id, W.alreadyParticipated, null, 'HTML'); return true }
    const dice = intval(S.Dice) === 1
    const r = await telegram('sendDice', { chat_id: c.from_id, emoji: dice ? '🎲' : '🎰' })
    await sleep(dice ? 4000 : 2000)
    const value = r && r.ok && r.result?.dice?.value !== undefined ? intval(r.result.dice.value) : null
    if (value === null) { await sendmessage(c.from_id, W.error || W.resultError, null, 'HTML'); return true }
    if (await recent()) { await sendmessage(c.from_id, W.alreadyParticipated, null, 'HTML'); return true }
    const won = dice ? value === 6 : [1, 43, 64, 22].includes(value)
    const prize = S['wheelـluck_price']
    let paid = 0
    if (won) {
      await addBalance(c.from_id, intval(prize))
      await sendmessage(c.from_id, sprintf(W.winnerCongratulations, numberFormat(n(prize))), null, 'HTML')
      paid = prize
      await report(c, 'otherreport', sprintf(W.wheelWinner, c.username, c.from_id))
    } else await sendmessage(c.from_id, W.notWinner, null, 'HTML')
    await run(sql`INSERT OR IGNORE INTO wheel_list (id_user, first_name, wheel_code, time, price) VALUES (${c.from_id}, ${c.first_name}, ${value}, ${tehranDate()}, ${paid})`)
    return true
  },
  async (c) => {
    if (c.text !== '/tron' && c.text !== '/usd') return false
    const P = c.T.users.priceArze
    const rates = await rateArze()
    if (!rates) { await sendmessage(c.from_id, P.fetchError, null, 'HTML'); return true }
    if (c.text === '/tron') await sendmessage(c.from_id, sprintf(P.tronPrice, rates.TRX), null, 'HTML')
    else await sendmessage(c.from_id, sprintf(P.tetherPrice, rates.USD), null, 'HTML')
    return true
  },
  // «renew»: the list of services (one live service: straight to its renewal options, no list to choose from)
  async (c) => {
    const T = c.T
    if (!(c.text === T.textbot.extend || c.datain === 'extendbtn')) return false
    const count = await renewCount(c)
    await fun('renew_open')
    if (count === 0) { await sendmessage(c.from_id, T.users.extend.emptyServiceforExtend, null, 'html'); return true }
    if (count === 1) {
      const only = await one(sql`SELECT id_invoice FROM invoice WHERE id_user = ${c.from_id} AND ${sql.raw(LIVE)} LIMIT 1`)
      c.datain = 'extend_' + only.id_invoice
      await fun('renew_skip_list')
      if (await extendRoutes[0](c)) return true
    }
    await run(sql`UPDATE user SET pagenumber = '1' WHERE id = ${c.from_id}`)
    await fun('renew_list')
    const { kb } = await renewList(c, 1, count)
    await sendmessage(c.from_id, T.users.extend.selectOrderDirect, J(kb), 'html')
    return true
  },
  async (c) => {
    if (c.datain !== 'next_page_extends' && c.datain !== 'previous_page_extends') return false
    const T = c.T
    const count = await renewCount(c)
    const want = intval(c.user.pagenumber) + (c.datain === 'next_page_extends' ? 1 : -1)
    await fun('renew_page')
    const { kb, page } = await renewList(c, want, count)
    await run(sql`UPDATE user SET pagenumber = ${page} WHERE id = ${c.from_id}`)
    await telegram('answerCallbackQuery', { callback_query_id: c.callback_query_id })
    await Editmessagetext(c.from_id, c.message_id, T.users.extend.selectOrderDirect, J(kb))
    return true
  },
  async (c) => {
    if (c.datain !== 'linkappdownlod') return false
    const apps = await all(sql`SELECT * FROM app`)
    const kb = J({ inline_keyboard: [...apps.map((a) => [{ text: a.name, url: a.link }]), [{ text: c.T.users.backbtn, callback_data: 'backuser' }]] })
    await sendmessage(c.from_id, apps.length === 0 ? c.T.users.app.appempty : c.T.users.app.selectapp, kb, 'html')
    return true
  },
  // a service's note
  async (c) => {
    const m = /changenote_(\w+)/.exec(c.datain)
    if (!m) return false
    const inv = await one(sql`SELECT * FROM invoice WHERE id_invoice = ${m[1]}`)
    if (!inv || String(inv.id_user) !== c.from_id) return true
    await run(sql`UPDATE user SET Processing_value = ${m[1]} WHERE id = ${c.from_id}`)
    await Editmessagetext(c.from_id, c.message_id, c.T.users.note.sendNote, J({ inline_keyboard: [[{ text: c.T.users.status.backinfo, callback_data: 'product_' + m[1] }]] }))
    await step(c, 'getnotedit')
    return true
  },
  async (c) => {
    if (c.user.step !== 'getnotedit') return false
    const T = c.T, id = c.user.Processing_value
    const inv = await one(sql`SELECT * FROM invoice WHERE id_invoice = ${id ?? null}`)
    if (!inv || String(inv.id_user) !== c.from_id) return true
    if (new TextEncoder().encode(c.text).length > 150) { await sendmessage(c.from_id, T.users.note.errorLongNote, c.keyboard, 'html'); return true }
    const note = sanitizeName(c.text)
    await run(sql`UPDATE invoice SET note = ${note} WHERE id_invoice = ${id}`)
    await sendmessage(c.from_id, T.users.note.changednote, J({ inline_keyboard: [[{ text: T.users.status.backinfo, callback_data: 'product_' + id }]] }), 'html')
    await step(c, 'home')
    await report(c, 'otherreport', sprintf(T.Admin.reportgroup.noteChanged, inv.username, inv.note, note, jdate('Y/m/d H:i:s')))
    return true
  },
]
