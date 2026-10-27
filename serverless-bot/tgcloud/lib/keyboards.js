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
