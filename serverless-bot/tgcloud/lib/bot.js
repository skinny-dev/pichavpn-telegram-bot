// The bot — port of index.php (customer side), in the same order. Each route below is one `elseif` of index.php.
import { one, all, run, sql, update, insert } from './db.js'
import { loadTexts } from './texts.js'
import { buildKeyboards, checkActiveBtn } from './keyboards.js'
import { telegram, sendmessage, deletemessage, Editmessagetext } from './tg.js'
import { entitiesToTags, restoreLabel } from './emoji.js'
import { sprintf, strtr, numberFormat, convertPersianNumbers, crc32, dechex, time, intval, randomHex, J } from './php.js'
import { kvGet } from './db.js'
import { routes, adminRoutes } from './routes.js'
import { pullRelay } from './relay.js'
import { cronTick } from './cron.js'
import { promoAutoEnd } from './panelapi/promo.js'

/** one update, like one webhook request to index.php */
export async function handleUpdate(update) {
  const c = await context(update)
  if (!c) return
  try { await promoAutoEnd() } catch (e) { console.error('promo', e) }
  try {
    await main(c)
  } catch (e) {
    if (e !== STOP) throw e
  }
  // payments pushed to the relay (Variza, bank SMS): pulled now and then, on any update
  if (c.T && c.setting) {
    try { await pullRelay(c) } catch (e) { console.error('relay', e) }
    // the cron jobs of the PHP bot, one due job per update
    try { await cronTick(c) } catch (e) { console.error('cron', e) }
  }
}
export const STOP = Symbol('stop') // `return;` from deep inside a branch

async function context(update) {
  const m = update.message || {}
  const cq = update.callback_query || {}
  const c = { update }
  c.from_id = String(m.from?.id ?? cq.from?.id ?? update.inline_query?.from?.id ?? 0)
  c.is_bot = !!m.from?.is_bot
  c.Chat_type = m.chat?.type ?? cq.message?.chat?.type ?? ''
  let text = m.text ?? ''
  if (text !== '' && Array.isArray(m.entities)) text = entitiesToTags(text, m.entities)
  if (update.pre_checkout_query) { c.Chat_type = 'private'; c.from_id = String(update.pre_checkout_query.from.id) }
  c.text = convertPersianNumbers(text)
  c.text_inline = cq.message?.text ?? ''
  c.message_id = m.message_id ?? cq.message?.message_id ?? 0
  c.photo = m.photo ?? 0
  c.photoid = Array.isArray(m.photo) && m.photo.length ? m.photo.at(-1).file_id : ''
  c.document = m.document ?? 0
  c.fileid = m.document?.file_id ?? 0
  c.caption = m.caption ? entitiesToTags(m.caption, m.caption_entities) : ''
  c.video = m.video ?? 0
  c.videoid = m.video?.file_id ?? 0
  c.datain = cq.data ?? ''
  c.first_name = m.from?.first_name ?? cq.from?.first_name ?? update.inline_query?.from?.first_name ?? ''
  c.username = m.from?.username ?? cq.from?.username ?? 'NOT_USERNAME'
  c.user_phone = m.contact?.phone_number ?? 0
  c.contact_id = m.contact?.user_id ?? 0
  c.callback_query_id = cq.id ?? 0
  c.inline_query_id = update.inline_query?.id ?? 0
  c.query = update.inline_query?.query ?? 0
  return c
}

/** a context for work done outside a Telegram update (the panel, the relay): no sender, the customer keyboard, the same settings and report topics */
export async function systemContext() {
  const { T } = await loadTexts()
  const c = { update: {}, T, from_id: '', message_id: 0, text: '', datain: '', username: '', first_name: '' }
  c.setting = (await one(sql`SELECT * FROM setting LIMIT 1`)) || {}
  c.domain = (await kvGet('config:domainhosts')) || ''
  Object.assign(c, buildKeyboards({ T, setting: c.setting, users: null, adminRow: null }))
  const topics = Object.fromEntries((await all(sql`SELECT report, idreport FROM topicid`)).map((r) => [r.report, r.idreport]))
  c.topicsAll = topics
  c.topics = Object.fromEntries(Object.entries(topics).filter(([k]) => k !== 'otherreport'))
  c.admin_ids = (await all(sql`SELECT id_admin FROM admin`)).map((r) => String(r.id_admin))
  return c
}

/** index.php from the top to the routes */
async function main(c) {
  const { T, labels } = await loadTexts()
  c.T = T
  // restoreCustomEmojiLabel($text)
  if (c.text !== '' && !/<tg-emoji/i.test(c.text)) c.text = labels[c.text] ?? (await restoreName(c.text))
  if (c.is_bot) return
  if (c.update.chat_member) {
    const cm = c.update.chat_member
    c.from_id = String(cm.new_chat_member.user.id)
    if (['left', 'kicked', 'restricted'].includes(cm.new_chat_member.status)) {
      await sendmessage(c.from_id, T.users.channel.left_channel, J({ inline_keyboard: [[{ text: T.keyboard.rejoin, url: `https://t.me/${cm.chat.username}` }]] }), 'html')
      return
    }
  }
  if (!['private', 'supergroup'].includes(c.Chat_type)) return
  if (c.update.chat_member) return
  c.first_name = c.first_name.replace(/'|"|<|>|--|#|;|\\|%|\(|\)/g, '')
  c.setting = await one(sql`SELECT * FROM setting LIMIT 1`) || {}
  c.domain = (await kvGet('config:domainhosts')) || ''
  c.adminRow = await one(sql`SELECT * FROM admin WHERE id_admin = ${c.from_id}`)
  const usersBefore = await one(sql`SELECT * FROM user WHERE id = ${c.from_id}`)
  c.usersBefore = usersBefore
  Object.assign(c, buildKeyboards({ T, setting: c.setting, users: usersBefore, adminRow: c.adminRow }))
  // a Persian label in the stored main keyboard means an old format: reset it to the keys
  let kc = null
  try { kc = JSON.parse(c.setting.keyboardmain ?? '') } catch { kc = null }
  if (kc && kc.keyboard && /[؀-ۿﭐ-﷿]/u.test(String(kc.keyboard?.[0]?.[0]?.text ?? ''))) {
    const km = '{"keyboard":[[{"text":"text_sell"},{"text":"text_extend"}],[{"text":"text_usertest"},{"text":"text_wheel_luck"}],[{"text":"text_Purchased_services"},{"text":"accountwallet"}],[{"text":"text_affiliates"},{"text":"text_Tariff_list"}],[{"text":"text_support"},{"text":"text_help"}],[{"text":"text_agentpanel"},{"text":"text_requestagent"}]]}'
    await run(sql`UPDATE setting SET keyboardmain = ${km}`)
  }
  if (intval(c.from_id) === 0) return

  const topics = Object.fromEntries((await all(sql`SELECT report, idreport FROM topicid`)).map((r) => [r.report, r.idreport]))
  c.topicsAll = topics
  // index.php never sets $otherreport, so its «other» reports go to the group's main thread
  c.topics = Object.fromEntries(Object.entries(topics).filter(([k]) => k !== 'otherreport'))
  const S = c.setting
  if (S.statusnewuser === 'onnewuser' && !usersBefore) {
    const kb = J({ inline_keyboard: [[{ text: T.Admin.manageUser.manageUserBtn, callback_data: 'manageuser_' + c.from_id }]] })
    const txt = sprintf(T.Admin.reportgroup.newUser, c.first_name, c.username, `<a href = "tg://user?id=${c.from_id}">${c.from_id}</a>`)
    if (String(S.Channel_Report ?? '').length > 0) await telegram('sendmessage', { chat_id: S.Channel_Report, message_thread_id: topics.otherreport, text: txt, reply_markup: kb, parse_mode: 'HTML' })
  }
  // INSERT IGNORE INTO user …
  await run(sql`INSERT OR IGNORE INTO user (id, step, limit_usertest, User_Status, number, Balance, pagenumber, username, agent, message_count, last_message_time, affiliates,
      affiliatescount, cardpayment, number_username, namecustom, register, verify, codeInvitation, pricediscount, maxbuyagent, joinchannel, score, status_cron)
    VALUES (${c.from_id}, 'none', ${S.limit_usertest_all}, 'Active', 'none', '0', '1', ${c.username}, 'f', '0', '0', '0', '0', ${S.showcard}, '100', 'none',
      ${time()}, ${S.verifystart !== 'onverify' ? 1 : 0}, ${randomHex(6)}, '0', '0', '0', '0', '1')`)
  let user = await one(sql`SELECT * FROM user WHERE id = ${c.from_id}`)
  if (!user) user = { step: '', Processing_value: '', User_Status: '', agent: '', username: '', limit_usertest: '', message_count: '', affiliates: '', last_message_time: '', cardpayment: '', roll_Status: '', number_username: '', number: '', register: '', codeInvitation: '', pricediscount: '', joinchannel: '', score: '', limitchangeloc: '' }
  c.user = user
  // a button while the bot waits for typed input: the customer moved on
  const waiting = ['gettimecustomvol', 'getvolumecustomuser', 'getvolumecustomusername', 'gettimecustomvolom', 'getvolumecustomuserom', 'getvolumecustomusernameom', 'gettimecustomvolomforextend', 'getvolumecustomuserforextend', 'statusnamecustom', 'selectusernamecustom']
  if (c.datain !== '' && waiting.includes(user.step ?? '')) { await step(c, 'home'); user.step = 'home' }
  const numeric = ['gettimecustomvol', 'getvolumecustomuser', 'gettimecustomvolom', 'getvolumecustomuserom', 'gettimecustomvolomforextend', 'getvolumecustomuserforextend']
  if (c.datain === '' && numeric.includes(user.step ?? '')) {
    const mm = /^\D*?(\d+)\D*$/u.exec(c.text.trim())
    if (mm) c.text = mm[1]
  }
  c.admin_ids = (await all(sql`SELECT id_admin FROM admin`)).map((r) => String(r.id_admin))
  c.isAdmin = c.admin_ids.includes(c.from_id)
  c.channels_id = (await all(sql`SELECT link FROM channels`)).map((r) => r.link)
  c.statusnote = S.statusnamecustom === 'onnamecustom'
  if (String(S.statusnoteforf) === '0' && user.agent === 'f') c.statusnote = false
  if (user.username === 'none' || user.username == null || user.username !== c.username) await run(sql`UPDATE user SET username = ${c.username} WHERE id = ${c.from_id}`)
  if (!['fa', 'en', 'ru', 'zh'].includes(user.lang)) await run(sql`UPDATE user SET lang = 'fa' WHERE id = ${c.from_id}`)
  if (user.register === 'none') await run(sql`UPDATE user SET register = ${time()} WHERE id = ${c.from_id}`)
  if (!['n', 'n2', 'f'].includes(user.agent)) await run(sql`UPDATE user SET agent = 'f' WHERE id = ${c.from_id}`)

  // blocked
  if (user.User_Status === 'block' && !c.isAdmin) {
    await sendmessage(c.from_id, sprintf(T.users.block.descriptions, user.description_blocking), null, 'html')
    return
  }
  // anti spam
  const now = time()
  if (Math.floor((now - intval(user.last_message_time)) / 60) >= 1) {
    await run(sql`UPDATE user SET last_message_time = ${now}, message_count = '1' WHERE id = ${c.from_id}`)
  } else if (!c.isAdmin) {
    const add = intval(user.message_count) + 1
    await run(sql`UPDATE user SET message_count = ${add} WHERE id = ${c.from_id}`)
    if (add >= 35) {
      const kb = J({ inline_keyboard: [[{ text: T.Admin.manageUser.manageUserBtn, callback_data: 'manageuser_' + c.from_id }]] })
      if (String(S.Channel_Report ?? '').length > 0) await telegram('sendmessage', { chat_id: S.Channel_Report, message_thread_id: topics.otherservice, text: sprintf(T.users.spam.spamedReport, c.from_id), parse_mode: 'HTML', reply_markup: kb })
      await run(sql`UPDATE user SET User_Status = 'block', description_blocking = ${T.users.spam.spamed} WHERE id = ${c.from_id}`)
      await sendmessage(c.from_id, T.users.spam.spamedMessage, null, 'html')
      return
    }
  }

  // /start <code>
  if (c.text.includes('/start ') && user.step !== 'gettextSystemMessage') {
    const affiliatesid = c.text.split(' ')[1]
    if (!['start', 'usertest', '/start', 'buy', 'help'].includes(affiliatesid)) {
      if (!/^\d+$/.test(affiliatesid ?? '') && (await referralCampaignAttach(c.from_id, affiliatesid)) !== null) {
        await sendStartMessage(c, c.from_id, c.keyboard)
        await step(c, 'home')
        return
      }
      if (S.verifybucodeuser === 'onverify' && String(user.verify) !== '1') {
        await sendmessage(c.from_id, T.users.account.verified, null, 'html')
        await run(sql`UPDATE user SET verify = '1', cardpayment = '1' WHERE id = ${c.from_id}`)
      }
      if (!checkActiveBtn(S.keyboardmain, 'text_affiliates')) {
        await sendmessage(c.from_id, T.users.affiliates.offaffiliates, c.keyboard, 'HTML')
        return
      }
      if (/^\d+$/.test(affiliatesid ?? '') && (await one(sql`SELECT id FROM user WHERE id = ${affiliatesid}`))) {
        if (affiliatesid === c.from_id) { await sendmessage(c.from_id, T.users.affiliates.invalidaffiliates, null, 'html'); return }
        const u2 = await one(sql`SELECT * FROM user WHERE id = ${c.from_id}`)
        if (intval(u2.affiliates) !== 0) { await sendmessage(c.from_id, T.users.affiliates.affiliateedago, null, 'html'); return }
        await run(sql`UPDATE user SET affiliates = ${affiliatesid} WHERE id = ${c.from_id}`)
        const ua = await one(sql`SELECT * FROM user WHERE id = ${affiliatesid}`)
        await sendmessage(c.from_id, sprintf(T.users.affiliates.welcomeInvited, ua.username), c.keyboard, 'html')
        await sendmessage(affiliatesid, sprintf(T.users.affiliates.newReferralJoined, c.username), c.keyboard, 'html')
        await run(sql`UPDATE user SET affiliatescount = ${intval(ua.affiliatescount) + 1} WHERE id = ${affiliatesid}`)
        await run(sql`INSERT OR IGNORE INTO reagent_report (user_id, get_gift, time, reagent) VALUES (${c.from_id}, 0, ${tehranDate()}, ${affiliatesid})`)
      } else {
        await sendStartMessage(c, c.from_id, c.keyboard)
        await resetProcessing(c)
        await step(c, 'home')
      }
      return
    }
    c.text = affiliatesid
  }
  if (intval(user.verify) === 0 && !c.isAdmin && S.verifystart === 'onverify') {
    await sendmessage(c.from_id, sprintf(T.users.account.notVerifiedNotice, S.id_support), null, 'html')
    return
  }
  // rules
  if (S.roll_Status === 'rolleon' && intval(user.roll_Status) === 0 && c.text !== T.keyboard.acceptRulesButton && c.datain !== 'acceptrule' && !c.isAdmin) {
    await sendmessage(c.from_id, T.textbot.rules, c.confrimrolls, 'html')
    return
  }
  if (c.text === T.keyboard.acceptRules || c.datain === 'acceptrule') {
    await deletemessage(c.from_id, c.message_id)
    await sendmessage(c.from_id, T.users.Rules, c.keyboard, 'html')
    await run(sql`UPDATE user SET roll_Status = 1 WHERE id = ${c.from_id}`)
    return
  }
  if (S.Bot_Status === 'botstatusoff' && !c.isAdmin) {
    await sendmessage(c.from_id, T.textbot.botOff, null, 'html')
    return
  }
  // forced channels
  if (user.joinchannel !== 'active' && c.channels_id.length) {
    const channels = await notJoined(c, c.channels_id)
    if (c.datain === 'confirmchannel') {
      if (channels.length === 0) {
        await deletemessage(c.from_id, c.message_id)
        await sendStartMessage(c, c.from_id, c.keyboard)
        await telegram('answerCallbackQuery', { callback_query_id: c.callback_query_id, text: T.users.channel.confirmed, show_alert: false, cache_time: 5 })
        return
      }
      await Editmessagetext(c.from_id, c.message_id, T.textbot.channel, await channelKeyboard(c, channels))
      await telegram('answerCallbackQuery', { callback_query_id: c.callback_query_id, text: T.users.channel.notconfirmed, show_alert: true, cache_time: 5 })
      const parts = String(user.Processing_value_four ?? '').split('_')
      if (parts[0] === 'affiliates') {
        const aid = parts[1]
        if (!(await one(sql`SELECT id FROM user WHERE id = ${aid}`))) { await sendmessage(c.from_id, T.users.affiliates.affiliatesidyou, null, 'html'); return }
        if (aid === c.from_id) { await sendmessage(c.from_id, T.users.affiliates.invalidaffiliates, null, 'html'); return }
        const disc = await one(sql`SELECT * FROM affiliates LIMIT 1`)
        const ua = await one(sql`SELECT * FROM user WHERE id = ${aid}`)
        if (disc && disc.Discount === 'onDiscountaffiliates') {
          if (Number(disc.price_Discount) > 0) await run(sql`UPDATE user SET Balance = Balance + ${Number(disc.price_Discount)} WHERE id = ${aid}`)
          await sendmessage(aid, strtr(T.users.affiliates.balanceGift, { '{addbalancediscount}': numberFormat(disc.price_Discount, 0), '{from_id}': c.from_id }), null, 'html')
        }
        await sendStartMessage(c, c.from_id, c.keyboard)
        await run(sql`UPDATE user SET affiliates = ${aid}, Processing_value_four = 'none' WHERE id = ${c.from_id}`)
        await run(sql`UPDATE user SET affiliatescount = ${intval(ua.affiliatescount) + 1} WHERE id = ${aid}`)
      }
      return
    }
    if (channels.length && !c.isAdmin) {
      await sendmessage(c.from_id, T.textbot.channel, await channelKeyboard(c, channels), 'html')
      return
    }
  }

  let handled = false
  for (const r of routes) {
    if (await r(c)) { handled = true; break }
  }
  if (!handled && c.text !== '' && c.Chat_type === 'private' && !c.isAdmin) await sendmessage(c.from_id, T.users.invalidCommand, c.keyboard, 'HTML')
  // admin.php runs after the customer chain for admins
  if (c.isAdmin && !handled) {
    for (const r of adminRoutes) if (await r(c)) return
  }
}

// ---------------------------------------------------------------- helpers shared by the routes

export async function step(c, s, id = c.from_id) {
  await run(sql`UPDATE user SET step = ${s} WHERE id = ${id}`)
  if (id === c.from_id && c.user) c.user.step = s
}
export async function resetProcessing(c) {
  await run(sql`UPDATE user SET Processing_value = '0', Processing_value_one = '0', Processing_value_tow = '0', Processing_value_four = '0' WHERE id = ${c.from_id}`)
}
/** date('Y/m/d H:i:s') in Tehran */
export function tehranDate(ts = time()) {
  const d = new Date((ts + 12600) * 1000)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
}

/** premiumEmojiRestoreName: names stored with premium emoji (category / product / panel) as shown on a reply keyboard */
async function restoreName(text) {
  if (typeof text !== 'string' || text === '' || text.includes('<') || [...text].length > 120) return text
  const idx = {}
  const plainOf = (n) => n.replace(/<tg-emoji\b[^>]*>([\s\S]*?)<\/tg-emoji>/giu, '$1')
  const noIcon = (n) => n.replace(/<tg-emoji\b[^>]*>[\s\S]*?<\/tg-emoji>/iu, '').replace(/[ \t]+/gu, ' ').trim()
  for (const [t, col] of [['category', 'remark'], ['product', 'name_product'], ['marzban_panel', 'name_panel']]) {
    const rows = await all(sql`${sql.raw(`SELECT "${col}" AS n FROM "${t}" WHERE "${col}" LIKE '%<tg-emoji%'`)}`)
    for (const { n } of rows) for (const v of [convertPersianNumbers(plainOf(n)), convertPersianNumbers(noIcon(n))]) if (v !== '' && !(v in idx)) idx[v] = n
  }
  return idx[text] ?? (await restoreLabel(text))
}

/** channel(): the forced channels this user has not joined */
async function notJoined(c, ids) {
  const out = []
  for (const ch of ids) {
    if (ch === null || ch === undefined || String(ch).trim() === '' || String(ch).trim() === '0') continue
    const r = await telegram('getChatMember', { chat_id: ch, user_id: c.from_id })
    if (r.ok && !['member', 'creator', 'administrator'].includes(r.result.status)) out.push(ch)
  }
  return out
}
async function channelKeyboard(c, channels) {
  const rows = []
  for (const ch of channels) {
    const r = await one(sql`SELECT * FROM channels WHERE link = ${ch}`)
    if (!r || r.remark == null || r.linkjoin == null) continue
    rows.push([{ text: `${r.remark}`, url: r.linkjoin }])
  }
  rows.push([{ text: c.T.users.channel.confirmjoin, callback_data: 'confirmchannel' }])
  return J({ inline_keyboard: rows })
}

const RESERVED = ['start', 'usertest', 'buy', 'help', 'admin', 'test'] // referralReservedCodes()
async function referralCampaignAttach(userId, code) {
  code = String(code ?? '').trim().toLowerCase()
  if (!/^[a-z][a-z0-9_-]{2,39}$/.test(code) || RESERVED.includes(code)) return null
  const link = await one(sql`SELECT * FROM referral_links WHERE code = ${code} AND active = 1`)
  if (!link) return null
  await run(sql`INSERT OR IGNORE INTO referral_signups (link_id, user_id, created_at) VALUES (${link.id}, ${String(userId)}, ${time()})`)
  return link
}

/** sendStartMessage + startGuideButtons */
export async function sendStartMessage(c, chatId, keyboard) {
  const T = c.T
  const rows = await startGuideButtons()
  if (!rows.length) return sendmessage(chatId, T.users.text_start, keyboard, 'html')
  const sent = await sendmessage(chatId, T.users.text_start, J({ inline_keyboard: rows }), 'html')
  const u = await one(sql`SELECT menu_sent FROM user WHERE id = ${chatId}`)
  if (String(u?.menu_sent ?? '') !== '1') { // PHP: (string) of a missing/NULL value is ''
    await sendmessage(chatId, T.users.startMenuPrompt || '👇 از منوی پایین هم می‌تونی خرید، تمدید و پیگیری سرویس‌هات رو انجام بدی.', keyboard, 'html')
    await run(sql`UPDATE user SET menu_sent = '1' WHERE id = ${chatId}`)
  }
  return sent
}
async function startGuideButtons() {
  let cfg = { enabled: true, buttons: [{ text: '🛍 خرید اشتراک', callback: 'buy' }, { text: '📚 آموزش', callback: 'helpbtn' }] }
  try { const raw = JSON.parse((await kvGet('storage:start_menu.json')) || 'null'); if (raw && typeof raw === 'object') cfg = { ...cfg, ...raw } } catch { /* default */ }
  if (!cfg.enabled || !Array.isArray(cfg.buttons)) return []
  const cats = (await all(sql`SELECT DISTINCT category FROM help WHERE category IS NOT NULL AND category <> ''`)).map((r) => r.category)
  const buttons = []
  for (const b of cfg.buttons) {
    if (!b || typeof b !== 'object' || !b.text) continue
    if (b.url && /^https?:\/\//i.test(String(b.url))) buttons.push({ text: b.text, url: b.url })
    else if (b.callback && ['buy', 'helpbtn', 'supportbtns'].includes(b.callback)) buttons.push({ text: b.text, callback_data: b.callback })
    else if (b.help) buttons.push({ text: b.text, callback_data: cats.includes(b.help) ? 'helpctg_' + dechex(crc32(b.help)) : 'helpsoon' })
  }
  const out = []
  for (let i = 0; i < buttons.length; i += 2) out.push(buttons.slice(i, i + 2))
  return out
}

/** select("shopSetting", "*", "Namevalue", $name)['value'] */
export async function shop(name) {
  const r = await one(sql`SELECT value FROM shopSetting WHERE Namevalue = ${name}`)
  return r ? r.value : null
}
