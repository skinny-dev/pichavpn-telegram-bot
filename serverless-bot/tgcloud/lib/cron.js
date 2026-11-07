// cronbot/*.php without a cron: Serverless has no timer, so a job runs when an update arrives and it is due.
// One job per update, the most overdue first, each on small batches so an update is never held up for long.
// Last run times are kept in kv (cron:<job>); the cron switches of the PHP bot (setting.cron_status) still apply.
import { one, all, run, sql, kvGet, kvSet } from './db.js'
import { sendmessage, deletemessage, telegram } from './tg.js'
import { dataUser, removeUser, getUsers } from './panel.js'
import { formatBytes } from './fmt.js'
import { broadcastTick } from './broadcast.js'
import { tetraReconcile } from './relay.js'
import { sprintf, numberFormat, intval, J } from './php.js'

const now = () => Math.floor(Date.now() / 1000)
const parse = (s) => { try { return JSON.parse(s) } catch { return null } }
/** Payment_report.time / wheel time: 'Y/m/d H:i:s' in Tehran */
const tehranStr = (t) => { const d = new Date((t + 12600) * 1000); const p = (n) => String(n).padStart(2, '0'); return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}` }

async function cronReport(c, text) {
  if (String(c.setting.Channel_Report ?? '').length === 0) return
  const topic = c.topicsAll?.reportcron ?? null
  await telegram('sendmessage', { chat_id: c.setting.Channel_Report, text, parse_mode: 'HTML', ...(topic ? { message_thread_id: topic } : {}) })
}
const statusText = (T, s) => ({ active: T.users.status.active, limited: T.users.status.limited, disabled: T.users.status.disabled, expired: T.users.status.expired, on_hold: T.users.status.on_hold, Unknown: T.users.status.unknown })[s]

/** NoticationsService.php: volume / time warnings and removing ended services, BATCH invoices a run */
async function notifications(c, BATCH = 8) {
  const T = c.T, S = c.setting
  const sw = parse(S.cron_status) || {}
  const rows = await all(sql`SELECT * FROM invoice WHERE (Status = 'active' OR Status = 'end_of_time' OR Status = 'end_of_volume' OR Status = 'sendedwarn' OR Status = 'send_on_hold')
    AND name_product != ${T.common.labels.testServiceName} AND (time_cron <= ${now() - 3600} OR time_cron IS NULL OR time_cron = '') ORDER BY CAST(COALESCE(time_cron, 0) AS INTEGER) LIMIT ${BATCH}`)
  const extendKb = (id) => J({ inline_keyboard: [[{ text: T.keyboard.renewService, callback_data: 'extend_' + id }]] })
  const tell = async (inv, user, msg, withKb) => { if (intval(user.status_cron ?? 1) === 0 && user.status_cron !== undefined && user.status_cron !== null) return; await sendmessage(inv.id_user, msg, withKb ? extendKb(inv.id_invoice) : null, 'HTML') }
  const mark = async (type, inv) => { const d = parse(inv.notifctions) || {}; d[type] = true; await run(sql`UPDATE invoice SET notifctions = ${JSON.stringify(d)} WHERE id_invoice = ${inv.id_invoice}`) }
  for (let inv of rows) {
    if (inv.time_cron != null && inv.time_cron !== '' && now() - intval(inv.time_cron) < 1600) continue
    await run(sql`UPDATE invoice SET time_cron = ${now()} WHERE id_invoice = ${inv.id_invoice}`)
    const sent = parse(inv.notifctions) || {}
    const panel = await one(sql`SELECT * FROM marzban_panel WHERE name_panel = ${inv.Service_location}`)
    if (!panel || panel.status === 'disabled') continue
    const user = await one(sql`SELECT * FROM user WHERE id = ${String(inv.id_user)}`)
    if (!user) continue
    const d = await dataUser(inv.Service_location, inv.username, c.domain)
    if (!d || d.status === 'Unsuccessful') continue
    const N = T.users.notify
    let warned = false
    if (!sent.volume && sw.volume) {
      const left = Number(d.data_limit || 0) - Number(d.used_traffic || 0)
      if (left <= Number(S.volumewarn || 0) * 1024 ** 3 && left > 0 && ['active', 'Unknown'].includes(d.status)) {
        const v = formatBytes(T, left)
        await tell(inv, user, N.greeting + sprintf(N.volumeRemaining, inv.username, v) + sprintf(N.volumeActionHint, T.textbot.purchasedServices), true)
        await cronReport(c, N.volumeTitle + sprintf(N.serviceUsername, inv.username) + sprintf(N.serviceStatus, d.status) + sprintf(N.remainingVolume, v))
        await mark('volume', inv)
        warned = true
      }
    }
    if (warned) inv = (await one(sql`SELECT * FROM invoice WHERE id_invoice = ${inv.id_invoice}`)) || inv
    if (!sent.time && sw.day && !['expired', 'on_hold', 'limited'].includes(d.status)) {
      const leftS = Number(d.expire || 0) - now()
      if (leftS <= intval(S.daywarn) * 86400 && leftS > 0) {
        const days = Math.trunc(leftS / 86400)
        await tell(inv, user, N.greeting2 + sprintf(N.timeRemaining, inv.username, days) + sprintf(N.timeActionHint, T.textbot.purchasedServices) + N.thanks, true)
        await cronReport(c, N.timeTitle + sprintf(N.serviceUsername2, inv.username) + sprintf(N.serviceStatus2, d.status) + sprintf(N.remainingDays, days))
        await mark('time', inv)
      }
    }
    if (sw.remove && ['limited', 'expired'].includes(d.status)) {
      const days = Math.trunc((Number(d.expire || 0) - now()) / 86400)
      if (days <= -intval(S.removedayc)) {
        await run(sql`UPDATE invoice SET status = 'removeTime' WHERE username = ${inv.username}`)
        await removeUser(inv.Service_location, inv.username)
        await tell(inv, user, sprintf(N.serviceDeleted, inv.username), false)
        await cronReport(c, sprintf(N.deleteInfo, inv.username, statusText(T, d.status), days, formatBytes(T, Number(d.data_limit || 0) - Number(d.used_traffic || 0))))
        continue
      }
    }
    // (remove_volume only acts on «limited» with a no-reset volume, never on these statuses; inbound switching is for old Marzban)
    if (sw.remove_volume && d.status === 'limited' && panel.type === 'marzban' && d.data_limit_reset === 'no_reset' && d.online_at) {
      const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(d.online_at) ? d.online_at : String(d.online_at).replace(' ', 'T') + '+03:30')
      const idle = Number.isFinite(t) ? (now() - t / 1000) / 86400 : 0
      if (idle !== 0 && idle >= intval(S.cronvolumere)) {
        const days = Math.trunc((Number(d.expire || 0) - now()) / 86400)
        await run(sql`UPDATE invoice SET status = 'removevolume' WHERE username = ${inv.username}`)
        await removeUser(inv.Service_location, inv.username)
        await tell(inv, user, sprintf(N.serviceDeleted2, inv.username), false)
        await cronReport(c, sprintf(N.volumeDeleteInfo, inv.username, statusText(T, d.status), days, formatBytes(T, Number(d.data_limit || 0) - Number(d.used_traffic || 0)), d.online_at))
      }
    }
  }
}

/** payment_expire.php: unpaid payments older than a day */
async function paymentExpire() {
  const rows = await all(sql`SELECT * FROM Payment_report WHERE time < ${tehranStr(now() - 86400)} AND payment_Status = 'Unpaid' LIMIT 50`)
  for (const r of rows) {
    if (r.message_id) await deletemessage(r.id_user, r.message_id)
    await run(sql`UPDATE Payment_report SET payment_Status = 'expire' WHERE id_order = ${r.id_order}`)
  }
}

/** configtest.php: ended test accounts are removed */
async function configTest(c, BATCH = 5) {
  const T = c.T
  const rows = await all(sql`SELECT * FROM invoice WHERE status != 'disabled' AND name_product = ${T.common.labels.testServiceName} ORDER BY RANDOM() LIMIT ${BATCH}`)
  for (const r of rows) {
    const name = String(r.username ?? '').trim()
    if (!(await one(sql`SELECT 1 AS x FROM marzban_panel WHERE name_panel = ${r.Service_location}`))) continue
    const user = (await one(sql`SELECT * FROM user WHERE id = ${String(r.id_user)}`)) || {}
    const d = await dataUser(r.Service_location, r.username, c.domain)
    if (['active', 'on_hold', 'Unsuccessful', 'disabled'].includes(d.status)) continue
    await removeUser(r.Service_location, name)
    await run(sql`UPDATE invoice SET status = 'disabled' WHERE username = ${name}`)
    if (intval(user.status_cron) !== 0) await sendmessage(r.id_user, T.textbot.testExpired.split('{username}').join(name), J({ inline_keyboard: [[{ text: T.keyboard.buyService, callback_data: 'buy' }]] }), 'HTML')
  }
}

/** on_hold.php: a reminder for services never connected after on_hold_day days */
async function onHold(c) {
  const T = c.T, S = c.setting
  for (const p of await all(sql`SELECT * FROM marzban_panel WHERE type = 'marzban' ORDER BY RANDOM() LIMIT 5`)) {
    for (const u of (await getUsers(p.name_panel, 'on_hold')).users) {
      const inv = await one(sql`SELECT * FROM invoice WHERE username = ${u.username}`)
      if (!inv || inv.Status === 'send_on_hold' || u.status !== 'on_hold') continue
      if ((now() - intval(inv.time_sell)) / 86400 < Number(S.on_hold_day || 0)) continue
      if (await one(sql`SELECT 1 AS x FROM service_other WHERE username = ${inv.username} AND type = 'change_location' LIMIT 1`)) continue
      await sendmessage(inv.id_user, sprintf(T.users.notify.onHoldReminder, inv.username, S.on_hold_day, S.id_support), null, 'HTML')
      await run(sql`UPDATE invoice SET Status = 'send_on_hold' WHERE username = ${inv.username}`)
    }
  }
}

/** optimize_order.php: forgotten unpaid invoices */
async function optimizeOrder(c) {
  const r = await run(sql`DELETE FROM invoice WHERE Status IN ('unpaid', 'Unsuccessful') AND CAST(time_sell AS INTEGER) < ${now() - 86400}`)
  const n = Number(r?.rowsAffected ?? 0)
  if (n > 0 && String(c.setting.Channel_Report ?? '').length > 0) {
    await telegram('sendmessage', { chat_id: c.setting.Channel_Report, message_thread_id: c.topicsAll?.otherreport, text: sprintf(c.T.Admin.report.autoCleanup, n, 0), parse_mode: 'HTML' })
  }
}

/** alert_balance.php */
async function alertBalance(c) {
  const S = c.setting
  if (String(S.alert_balance) !== '1' || S.Bot_Status === 'botstatusoff') return
  const t = intval(S.balance_value_alert)
  await run(sql`UPDATE user SET low_balance_alert_sent = 0 WHERE low_balance_alert_sent = 1 AND CAST(Balance AS REAL) > ${t} + 0`)
  for (const u of await all(sql`SELECT id, Balance FROM user WHERE CAST(Balance AS REAL) > 0 AND CAST(Balance AS REAL) <= ${t} + 0 AND (low_balance_alert_sent = 0 OR low_balance_alert_sent IS NULL OR low_balance_alert_sent = '') AND User_Status != 'block' LIMIT 20`)) {
    await run(sql`UPDATE user SET low_balance_alert_sent = '1' WHERE id = ${u.id}`)
    await sendmessage(u.id, sprintf(c.T.users.status.lowBalanceAlert, numberFormat(Number(u.Balance))), null, 'HTML')
  }
}

/** expireagent.php: an agent whose agency ended goes back to a normal user */
async function expireAgent(c) {
  for (const u of await all(sql`SELECT id, username FROM user WHERE expire IS NOT NULL AND expire != '' AND CAST(expire AS INTEGER) < ${now()} + 0 LIMIT 20`)) {
    await sendmessage(u.id, c.T.users.agent.expiredNotice, null, 'HTML')
    await run(sql`UPDATE user SET agent = 'f', expire = NULL WHERE id = ${u.id}`)
    if (String(c.setting.Channel_Report ?? '').length > 0) await telegram('sendmessage', { chat_id: c.setting.Channel_Report, message_thread_id: c.topicsAll?.otherreport, text: sprintf(c.T.Admin.reportgroup.agentExpiredGroupChanged, u.id, u.username), parse_mode: 'HTML' })
  }
}

/** statusday.php: the day's report at 23:45 Tehran (once a day) */
async function statusDay(c) {
  const T = c.T, R = T.Admin.report
  const t = new Date((now() + 12600) * 1000)
  if (t.getUTCHours() !== 23 || t.getUTCMinutes() < 45) return
  const day = `${t.getUTCFullYear()}-${t.getUTCMonth() + 1}-${t.getUTCDate()}`
  if ((await kvGet('cron:statusday:day')) === day) return
  await kvSet('cron:statusday:day', day)
  const start = Math.floor(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) / 1000) - 12600
  const end = start + 86399
  const live = `status IN ('active', 'end_of_time', 'sendedwarn', 'send_on_hold')`
  const sold = (await one(sql`SELECT COUNT(*) AS n, SUM(price_product) AS p, SUM(Volume) AS v FROM invoice WHERE CAST(time_sell AS INTEGER) BETWEEN ${start} AND ${end} AND ${sql.raw(live)} AND name_product != ${T.common.labels.testServiceName}`)) || {}
  const tests = Number((await one(sql`SELECT COUNT(*) AS n FROM invoice WHERE CAST(time_sell AS INTEGER) BETWEEN ${start} AND ${end} AND status IN ('active', 'end_of_time', 'sendedwarn') AND name_product = ${T.common.labels.testServiceName}`)).n)
  const users = Number((await one(sql`SELECT COUNT(*) AS n FROM user WHERE CAST(register AS INTEGER) BETWEEN ${start} AND ${end}`)).n)
  const ext = (await one(sql`SELECT COUNT(*) AS n, SUM(price) AS p FROM service_other WHERE time BETWEEN ${tehranStr(start)} AND ${tehranStr(end)} AND type = 'extend_user' AND status != 'unpaid'`)) || {}
  const agents = await all(sql`SELECT u.id, u.username, (SELECT SUM(i.price_product) FROM invoice i WHERE i.id_user = u.id AND CAST(i.time_sell AS INTEGER) BETWEEN ${start} AND ${end} AND i.${sql.raw(live)}) AS total
    FROM user u WHERE u.agent IN ('n', 'n2') AND EXISTS (SELECT 1 FROM invoice i WHERE i.id_user = u.id AND CAST(i.time_sell AS INTEGER) BETWEEN ${start} AND ${end} AND i.${sql.raw(live)}) ORDER BY total DESC LIMIT 3`)
  let ta = R.dailyTopAgentsTitle
  for (const a of agents) ta += sprintf(R.dailyTopAgentRow, a.id, a.username, a.total)
  let tp = R.dailyPanelsTitle
  for (const p of await all(sql`SELECT name_panel FROM marzban_panel`)) {
    const r = (await one(sql`SELECT COUNT(*) AS n, SUM(price_product) AS s, SUM(Volume) AS v FROM invoice WHERE CAST(time_sell AS INTEGER) BETWEEN ${start} AND ${end} AND ${sql.raw(live)} AND Service_location = ${p.name_panel} AND name_product != ${T.common.labels.testServiceName}`)) || {}
    tp += sprintf(R.dailyPanelRow, p.name_panel, r.n ?? 0, r.s ?? 0, r.v ?? 0)
  }
  const tr = sprintf(R.dailyBot, ext.n ?? 0, numberFormat(Number(ext.p || 0)), sold.n ?? 0, sold.p ?? 0, tests, sold.v ?? 0, users)
  if (String(c.setting.Channel_Report ?? '').length > 0) {
    for (const text of [ta, tr, tp]) await telegram('sendmessage', { chat_id: c.setting.Channel_Report, message_thread_id: c.topicsAll?.reportnight, text, parse_mode: 'HTML' })
  }
}

const JOBS = [
  ['broadcast', 20, (c) => broadcastTick(c)],
  ['tetraminator', 30, tetraReconcile],
  ['notifications', 60, notifications],
  ['configtest', 120, configTest],
  ['payment_expire', 300, paymentExpire],
  ['alert_balance', 120, alertBalance],
  ['on_hold', 900, onHold],
  ['statusday', 300, statusDay],
  ['optimize_order', 1800, optimizeOrder],
  ['expireagent', 1800, expireAgent],
]

/** run the most overdue job (at most one an update) */
export async function cronTick(c) {
  if (!c.T || !c.setting) return
  if ((await kvGet('cron:off')) === '1') return // switched off (the PHP side of the diff tests runs no cron)
  // a short lock: two updates at the same moment do not run the same job twice
  const lock = intval(await kvGet('cron:lock'))
  if (now() - lock < 30) return
  let pick = null, worst = 0
  for (const [name, every, fn] of JOBS) {
    const late = now() - intval(await kvGet('cron:' + name)) - every
    if (late >= 0 && late + every > worst) { worst = late + every; pick = [name, fn] }
  }
  if (!pick) return
  await kvSet('cron:lock', String(now()))
  await kvSet('cron:' + pick[0], String(now()))
  try {
    await pick[1](c)
  } catch (e) {
    console.error('cron ' + pick[0], e)
  } finally {
    await kvSet('cron:lock', '0')
  }
}
