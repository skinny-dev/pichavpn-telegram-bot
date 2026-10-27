// Free test account — index.php lines 2900–3081
import { one, run, sql } from '../db.js'
import { sendmessage, deletemessage, telegram } from '../tg.js'
import { step } from '../bot.js'
import { checkActiveBtn, backuserKb, panelLists } from '../keyboards.js'
import { dataUser, createUserFor } from '../panel.js'
import { generateUsername, usernameMethodKey, sendMessageService } from '../service.js'
import { jdate } from '../fmt.js'
import { sprintf, intval, randomHex, J, phpJson } from '../php.js'

export const usertestRoutes = [
  async (c) => {
    const T = c.T, user = c.user
    const m = /locationtest_(.*)/.exec(c.datain)
    if (!(user.step === 'createusertest' || m || c.text === T.textbot.userTest || c.datain === 'usertestbtn' || c.text === 'usertest' || c.text === '/free')) return false
    if (!checkActiveBtn(c.setting.keyboardmain, 'text_usertest')) { await sendmessage(c.from_id, T.users.usertest.unavailable, null, 'HTML'); return true }
    const fresh = (await one(sql`SELECT * FROM user WHERE id = ${c.from_id}`)) || {}
    if (Number(fresh.limit_usertest ?? 0) <= 0 && !c.isAdmin) {
      await sendmessage(c.from_id, T.users.usertest.limitwarning, J({ inline_keyboard: [[{ text: T.keyboard.buySubscription, callback_data: 'buy' }]] }), 'html')
      return true
    }
    const phoneOn = c.setting.get_number === 'onAuthenticationphone'
    if (phoneOn && user.step !== 'get_number' && user.number === 'none') {
      await sendmessage(c.from_id, T.users.number.confirming, c.request_contact, 'HTML')
      await step(c, 'get_number')
    }
    if (user.number === 'none' && phoneOn) return true
    const count = Number((await one(sql`SELECT COUNT(*) AS n FROM marzban_panel WHERE TestAccount = 'ONTestAccount'`)).n)
    if (count === 0) { await sendmessage(c.from_id, T.users.sell.nullPanel, null, 'HTML'); return true }
    let location
    if (count === 1) {
      const p = await one(sql`SELECT * FROM marzban_panel WHERE TestAccount = 'ONTestAccount'`)
      if (p.hide_user != null) {
        let list = null
        try { list = JSON.parse(p.hide_user) } catch { list = null }
        if (Array.isArray(list) && list.map(String).includes(c.from_id)) { await sendmessage(c.from_id, T.users.sell.nullPanel, null, 'HTML'); return true }
      }
      location = p.code_panel
    } else if (m) location = m[1]
    else if (user.step === 'createusertest') location = user.Processing_value_one
    else { await sendmessage(c.from_id, T.textbot.selectLocation, (await panelLists(c)).list_marzban_usertest, 'html'); return true }
    let panel = (await one(sql`SELECT * FROM marzban_panel WHERE code_panel = ${location ?? null}`)) || {}
    let namePanel
    if (['customUsername', 'customUsernameRandom'].includes(usernameMethodKey(T, panel.MethodUsername))) {
      if (user.step !== 'createusertest') {
        await step(c, 'createusertest')
        await run(sql`UPDATE user SET Processing_value_one = ${location} WHERE id = ${c.from_id}`)
        await sendmessage(c.from_id, T.users.selectusername, backuserKb(c), 'html')
        return true
      }
    } else namePanel = location
    if (user.step === 'createusertest') {
      namePanel = user.Processing_value_one
      if (!/^(?!_)[a-z][a-z\d_]{2,32}(?<!_)$/i.test(c.text)) { await sendmessage(c.from_id, T.users.invalidusername, backuserKb(c), 'HTML'); return true }
    } else await deletemessage(c.from_id, c.message_id)
    if (panel.type === 'Manualsale') {
      const n = Number((await one(sql`SELECT COUNT(*) AS n FROM manualsell WHERE codepanel = ${panel.code_panel} AND codeproduct = 'usertest' AND status = 'active'`)).n)
      if (n === 0) { await sendmessage(c.from_id, T.users.sell.stockFinished, null, 'HTML'); return true }
    }
    await run(sql`UPDATE user SET limit_usertest = ${Number(fresh.limit_usertest ?? 0) - 1} WHERE id = ${c.from_id}`)
    const randomString = randomHex(4)
    const text = c.text.toLowerCase()
    panel = (await one(sql`SELECT * FROM marzban_panel WHERE code_panel = ${namePanel ?? null}`)) || {}
    let username = (await generateUsername(T, c.from_id, panel.MethodUsername, user.username, randomString, text, panel.namecustom, user.namecustom)).toLowerCase()
    const d = await dataUser(panel.name_panel ?? null, username, c.domain)
    if (d.username !== undefined || (await one(sql`SELECT 1 AS x FROM invoice WHERE username = ${username} LIMIT 1`))) username = `${1000000 + Math.floor(Math.random() * 9000000)}_${username}`
    const cfg = { expire: Math.floor(Date.now() / 1000) + Math.round(Number(panel.time_usertest || 0) * 3600), data_limit: Number(panel.val_usertest || 0) * 1048576, from_id: c.from_id, username: c.username, type: 'usertest' }
    const notif = JSON.stringify({ volume: false, time: false })
    await run(sql`INSERT OR IGNORE INTO invoice (id_user, id_invoice, username, time_sell, Service_location, name_product, price_product, Volume, Service_time, Status, notifctions)
      VALUES (${c.from_id}, ${randomString}, ${username}, ${Math.floor(Date.now() / 1000)}, ${panel.name_panel ?? null}, ${T.common.labels.testService5}, '0', ${panel.val_usertest ?? null}, ${panel.time_usertest ?? null}, 'active', ${notif})`)
    const out = await createUserFor(panel.name_panel ?? null, 'usertest', username, cfg, { domain: c.domain, customLabel: T.users.customSellVolume.btnVolume })
    if (!out || !out.username) {
      await sendmessage(c.from_id, T.users.usertest.errorcreat, c.keyboard, 'html')
      if (String(c.setting.Channel_Report ?? '').length > 0) {
        await telegram('sendmessage', { chat_id: c.setting.Channel_Report, message_thread_id: c.topics.errorreport, text: sprintf(T.Admin.reportgroup.errorTestAccountCreate, phpJson(out?.msg ?? out ?? 'unknown error'), c.from_id, c.username, panel.name_panel), parse_mode: 'HTML' })
      }
      await step(c, 'home')
      await run(sql`UPDATE invoice SET Status = 'Unsuccessful' WHERE id_invoice = ${randomString}`)
      return true
    }
    let links = panel.sublink === 'onsublink' ? out.subscription_url : ''
    if (panel.config === 'onconfig' && Array.isArray(out.configs)) for (const l of out.configs) links += '\n' + l
    const kb = J({ inline_keyboard: [[{ text: T.users.help.btninlinebuy, callback_data: 'helpbtn' }]] })
    let after = T.textbot.afterText
    if (panel.type === 'WGDashboard') after = T.users.sell.created
    if (panel.type === 'ibsng' || panel.type === 'mikrotik') after = T.textbot.afterPayIbsng
    let msg = after.split('{username}').join(out.username).split('{name_service}').join(T.common.labels.test).split('{location}').join(panel.name_panel ?? '')
      .split('{day}').join(String(panel.time_usertest ?? '')).split('{volume}').join(String(panel.val_usertest ?? '')).split('{config}').join(`<code>${links}</code>`)
      .split('{links}').join('').split('{links2}').join(links)
    if (panel.type === 'ibsng' || panel.type === 'mikrotik') {
      msg = msg.split('{password}').join(out.subscription_url)
      await run(sql`UPDATE invoice SET user_info = ${out.subscription_url} WHERE id_invoice = ${randomString}`)
    }
    await sendMessageService(c, panel, out.configs, links, out.username, kb, msg, randomString, null, out.wireguard ?? [])
    await sendmessage(c.from_id, T.users.selectoption, c.keyboard, 'HTML')
    await step(c, 'home')
    const method = usernameMethodKey(T, panel.MethodUsername)
    if (['customTextSequential', 'usernameSequential', 'numericIdSequential', 'agentCustomTextSequential'].includes(method)) {
      await run(sql`UPDATE user SET number_username = ${intval(user.number_username) + 1} WHERE id = ${c.from_id}`)
      if (['customTextSequential', 'agentCustomTextSequential'].includes(method)) await run(sql`UPDATE setting SET numbercount = ${intval(c.setting.numbercount) + 1}`)
    }
    if (String(c.setting.Channel_Report ?? '').length > 0) {
      const rk = J({ inline_keyboard: [[{ text: T.Admin.manageUser.manageUserBtn, callback_data: 'manageuser_' + c.from_id }]] })
      await telegram('sendmessage', { chat_id: c.setting.Channel_Report, message_thread_id: c.topics.reporttest, text: sprintf(T.Admin.reportgroup.testAccountCreated, c.from_id, c.username, username, c.first_name, panel.name_panel, panel.time_usertest, panel.val_usertest, randomString, user.agent, user.number, jdate('Y/m/d H:i:s')), parse_mode: 'HTML', reply_markup: rk })
    }
    return true
  },
]
