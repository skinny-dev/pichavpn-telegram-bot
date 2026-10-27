// Keyboards of keyboard.php that the customer side uses. Built once per update from the same inputs:
// the setting row, the user row as read BEFORE the new-user insert (keyboard.php runs first in PHP), and the admin row.
import { J } from './php.js'

const REPLACE_KEYS = {
  text_usertest: 'userTest', text_Purchased_services: 'purchasedServices', text_support: 'support', text_help: 'help',
  accountwallet: 'accountWallet', text_sell: 'sell', text_Tariff_list: 'tariffList', text_affiliates: 'affiliates',
  text_wheel_luck: 'wheelLuck', text_extend: 'extend', text_agentpanel: 'agentPanel', text_requestagent: 'requestAgent',
}
const INLINE_CB = {
  text_sell: 'buy', accountwallet: 'account', text_Tariff_list: 'Tariff_list', text_wheel_luck: 'wheel_luck', text_affiliates: 'affiliatesbtn',
  text_extend: 'extendbtn', text_support: 'supportbtns', text_Purchased_services: 'backorder', text_help: 'helpbtns', text_usertest: 'usertestbtn',
  text_agentpanel: 'agentpanel', text_requestagent: 'requestagent',
}

/** applyKeyboardLabels */
function applyLabels(rows, labels) {
  return (Array.isArray(rows) ? rows : Object.values(rows || {})).filter((r) => r && typeof r === 'object').map((row) =>
    (Array.isArray(row) ? row : Object.values(row)).map((b) => (b && typeof b.text === 'string' && labels[b.text] !== undefined ? { ...b, text: labels[b.text] } : b)))
}

export function buildKeyboards({ T, setting, users, adminRow }) {
  const replacements = Object.fromEntries(Object.entries(REPLACE_KEYS).map(([k, v]) => [k, T.textbot[v]]))
  let layout = null
  try { layout = JSON.parse(setting.keyboardmain ?? '') } catch { layout = null }
  let rows = layout && Array.isArray(layout.keyboard) ? layout.keyboard : layout && layout.keyboard && typeof layout.keyboard === 'object' ? Object.values(layout.keyboard) : []
  const agent = users ? users.agent ?? '' : ''
  const agentPanelAllowed = agent !== 'f'
  const agentRequestAllowed = agent === 'f'
  if (rows.length) {
    rows = rows
      .map((row) => (Array.isArray(row) ? row : Object.values(row || {})).filter((b) => b && typeof b === 'object').map((b) => {
        const nb = { ...b }
        if (nb.style !== undefined && !['primary', 'success', 'danger'].includes(nb.style)) delete nb.style
        return nb
      }).filter((b) => !((b.text === 'text_agentpanel' && !agentPanelAllowed) || (b.text === 'text_requestagent' && !agentRequestAllowed))))
      .filter((r) => r.length)
  }
  const admin = !!adminRow
  const extra = []
  let keyboard
  if (setting.inlinebtnmain === 'oninline' && rows.length) {
    const trace = rows.map((row) => row.map((b) => (INLINE_CB[b.text] ? { ...b, callback_data: INLINE_CB[b.text] } : b)))
    if (admin) extra.push({ text: T.Admin.panelAdmin, callback_data: 'admin' })
    const custom = applyLabels(trace, replacements)
    custom.push(extra)
    keyboard = J({ inline_keyboard: custom })
  } else {
    if (admin) extra.push({ text: T.Admin.panelAdmin })
    const custom = applyLabels(rows, replacements)
    custom.push(extra)
    keyboard = J({ keyboard: custom, resize_keyboard: true })
  }

  const confrimrolls = setting.inlinebtnmain === 'oninline'
    ? J({ inline_keyboard: [[{ text: T.keyboard.acceptRules, callback_data: 'acceptrule' }]] })
    : J({ keyboard: [[{ text: T.keyboard.acceptRules }]], resize_keyboard: true })

  const keyboardPanel = J({
    inline_keyboard: [
      [{ text: T.textbot.discount, callback_data: 'Discount' }, { text: T.textbot.addBalance, callback_data: 'Add_Balance' }],
      [{ text: T.language.changeButton, callback_data: 'ّchange_language' }],
      [{ text: T.users.backbtn, callback_data: 'backuser' }],
    ],
    resize_keyboard: true,
  })
  const request_contact = J({ keyboard: [[{ text: T.keyboard.sendPhoneNumber, request_contact: true }], [{ text: T.users.backbtn }]], resize_keyboard: true })
  return { keyboard, confrimrolls, keyboardPanel, request_contact }
}

/** check_active_btn: is a button (by its key) in the main keyboard layout */
export function checkActiveBtn(keyboardmain, key) {
  let k
  try { k = JSON.parse(keyboardmain).keyboard } catch { return false }
  for (const row of Array.isArray(k) ? k : Object.values(k || {})) for (const b of Array.isArray(row) ? row : Object.values(row || {})) if (b && b.text === key) return true
  return false
}

// ---- panel lists (keyboard.php, $allPanelRows) — need the update context
const hidden = (p, fromId) => {
  if (p.hide_user == null) return false
  try { const a = JSON.parse(p.hide_user); return Array.isArray(a) && a.map(String).includes(String(fromId)) } catch { return false }
}
export async function panelLists(c) {
  if (c._panelLists) return c._panelLists
  const { all, sql } = await import('./db.js')
  const T = c.T, users = c.usersBefore || { step: '', agent: '', Processing_value_four: '' }
  const allPanels = await all(sql`SELECT * FROM marzban_panel`)
  const active = allPanels.filter((p) => p.status === 'active' && [users.agent, 'all'].includes(p.agent))
  let msCounts = {}
  if (active.some((p) => p.type === 'Manualsale')) for (const r of await all(sql`SELECT codepanel, COUNT(*) AS c FROM manualsell WHERE status = 'active' GROUP BY codepanel`)) msCounts[r.codepanel] = Number(r.c)
  const panelcount = allPanels.filter((p) => p.status === 'active').length
  const cbFor = (p) => (users.step === 'getusernameinfo' ? `locationnotuser_${p.code_panel}` : `location_${p.code_panel}`)
  const user = { inline_keyboard: [] }
  if (panelcount > 10) {
    let row = []
    for (const p of active) {
      if (hidden(p, c.from_id)) continue
      if (p.type === 'Manualsale' && !msCounts[p.code_panel]) continue
      row.push({ text: p.name_panel, callback_data: cbFor(p) })
      if (row.length === 2) { user.inline_keyboard.push(row); row = [] }
    }
    if (row.length) user.inline_keyboard.push(row)
  } else {
    for (const p of active) {
      if (p.type === 'Manualsale' && !msCounts[p.code_panel]) continue
      if (hidden(p, c.from_id)) continue
      user.inline_keyboard.push([{ text: p.name_panel, callback_data: cbFor(p) }])
    }
  }
  let statusnote = c.setting.statusnamecustom === 'onnamecustom'
  if (String(c.setting.statusnoteforf) === '0' && users.agent === 'f') statusnote = false
  user.inline_keyboard.push([{ text: T.users.backbtn, callback_data: statusnote ? 'buyback' : 'backuser' }])

  const om = { inline_keyboard: [] }
  for (const p of active) { if (hidden(p, c.from_id)) continue; om.inline_keyboard.push([{ text: p.name_panel, callback_data: `locationom_${p.code_panel}` }]) }
  om.inline_keyboard.push([{ text: T.users.backbtn, callback_data: 'backuser' }])

  const ch = { inline_keyboard: [] }
  if (panelcount > 10) {
    let row = []
    for (const p of active) {
      if (p.name_panel === users.Processing_value_four || hidden(p, c.from_id)) continue
      row.push({ text: p.name_panel, callback_data: `changelocselectlo-${p.code_panel}` })
      if (row.length === 2) { ch.inline_keyboard.push(row); row = [] }
    }
    if (row.length) ch.inline_keyboard.push(row)
  } else {
    for (const p of active) {
      if (p.name_panel === users.Processing_value_four || hidden(p, c.from_id)) continue
      ch.inline_keyboard.push([{ text: p.name_panel, callback_data: `changelocselectlo-${p.code_panel}` }])
    }
  }
  ch.inline_keyboard.push([{ text: T.users.backbtn, callback_data: 'backorder' }])

  const test = { inline_keyboard: [] }
  for (const p of allPanels) {
    if (p.TestAccount !== 'ONTestAccount' || ![users.agent, 'all'].includes(p.agent)) continue
    if (hidden(p, c.from_id)) continue
    test.inline_keyboard.push([{ text: p.name_panel, callback_data: `locationtest_${p.code_panel}` }])
  }
  test.inline_keyboard.push([{ text: T.users.backbtn, callback_data: 'backuser' }])
  c._panelLists = { list_marzban_panel_user: J(user), list_marzban_panel_userom: J(om), list_marzban_panel_userschange: J(ch), list_marzban_usertest: J(test), allPanels }
  return c._panelLists
}

export function backuserKb(c) {
  return c.setting.inlinebtnmain === 'oninline'
    ? J({ inline_keyboard: [[{ text: c.T.users.backbtn, callback_data: 'backuser' }]] })
    : J({ keyboard: [[{ text: c.T.users.backbtn }]], resize_keyboard: true })
}
