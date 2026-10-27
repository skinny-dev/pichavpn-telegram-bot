// Shared by test accounts and purchases: generateUsername(), usernameMethodKey() and sendMessageService() of function.php
import { InputFile } from 'sdk'
import { one, sql } from './db.js'
import { telegram, sendmessage } from './tg.js'
import { checkActiveBtn, keyboardConfig } from './keyboards.js'
import { sendWireguardFiles } from './wg.js'
import { qrPng } from './qr.js'
import { randomHex } from './php.js'

const USERNAME_KEYS = ['usernameSequential', 'numericIdRandom', 'customUsername', 'customUsernameRandom', 'customTextRandom', 'customTextSequential', 'numericIdSequential', 'agentCustomTextSequential']
/** usernameMethodKey(): stored key, or its label in the texts */
export function usernameMethodKey(T, value, def = 'numericIdRandom') {
  value = typeof value === 'string' ? value.trim() : ''
  if (value === '') return def
  if (USERNAME_KEYS.includes(value)) return value
  const labels = {}
  for (const k of USERNAME_KEYS) {
    const cands = [T.keyboard[k], T.common.labels[k]]
    if (k === 'customUsername') cands.push(T.users.customusername)
    if (k === 'agentCustomTextSequential') cands.push(T.keyboard.usernameMethodAgentCustom)
    for (const l of cands) if (typeof l === 'string' && l.trim() !== '') labels[l.trim()] = k
  }
  return labels[value] ?? def
}

const rand7 = () => 1000000 + Math.floor(Math.random() * 9000000)
/** generateUsername($from_id, $Metode, $username, $randomString, $text, $namecustome, $usernamecustom) */
export async function generateUsername(T, fromId, method, username, randomString, text, namecustom, usernamecustom) {
  const setting = (await one(sql`SELECT * FROM setting LIMIT 1`)) || {}
  const user = (await one(sql`SELECT * FROM user WHERE id = ${String(fromId)}`)) || { number_username: '' }
  randomString = String(randomString ?? '').trim()
  if (randomString === '') randomString = randomHex(4)
  const fallback = `${fromId}_${randomString}`
  const s = (v) => (v === null || v === undefined ? '' : String(v))
  let g
  switch (usernameMethodKey(T, method)) {
    case 'usernameSequential':
      if (username === 'NOT_USERNAME' && /^\w{3,32}$/.test(s(namecustom))) username = namecustom
      g = `${s(username)}_${s(user.number_username)}`; break
    case 'customUsername': g = s(text); break
    case 'customUsernameRandom': g = `${s(text)}_${rand7()}`; break
    case 'customTextRandom': g = `${s(namecustom)}_${randomString}`; break
    case 'customTextSequential': g = `${s(namecustom)}_${s(setting.numbercount)}`; break
    case 'numericIdSequential': g = `${fromId}_${s(user.number_username)}`; break
    case 'agentCustomTextSequential': g = usernamecustom === 'none' ? `${s(namecustom)}_${s(setting.numbercount)}` : `${s(usernamecustom)}_${s(user.number_username)}`; break
    default: g = fallback
  }
  g = g.replace(/^[ _]+|[ _]+$/g, '')
  if (new TextEncoder().encode(g).length < 3) g = fallback
  return g
}

/** a QR photo with a caption; the caption alone when the QR cannot be made or the photo is refused */
export async function sendQrPhoto(chatId, data, caption, keyboard) {
  let pic = null
  try { pic = String(data ?? '') === '' ? null : new InputFile(qrPng(String(data)), 'qr.png', { type: 'image/png' }) } catch { pic = null }
  if (pic) {
    const r = await telegram('sendphoto', { chat_id: chatId, photo: pic, reply_markup: keyboard, caption, parse_mode: 'HTML' })
    if (r && r.ok) return r
  }
  return sendmessage(chatId, caption, keyboard, 'HTML')
}

/** sendMessageService($panel_info, $config, $sub_link, $username_service, $reply_markup, $caption, $invoice_id, $user_id, …, $wireguard) */
export async function sendMessageService(c, panel, configs, subLink, usernameService, replyMarkup, caption, invoiceId, userId = null, wireguard = []) {
  if (!checkActiveBtn(c.setting.keyboardmain, 'text_help')) replyMarkup = null
  userId = userId == null ? c.from_id : userId
  if (userId === '' || userId === '0' || userId === 0) return
  const photo = !(panel.config === 'onconfig' && (Array.isArray(configs) ? configs.length : 0) !== 1)
  let qr = ''
  if (panel.sublink === 'onsublink') qr = subLink
  else if (panel.config === 'onconfig') qr = Array.isArray(configs) ? configs[0] ?? '' : ''
  if (photo) {
    if (panel.type === 'WGDashboard') {
      await telegram('senddocument', { chat_id: userId, document: new InputFile(new TextEncoder().encode(String(subLink ?? '')), `${panel.inboundid}_${invoiceId}.conf`), reply_markup: replyMarkup, caption, parse_mode: 'HTML' })
    } else await sendQrPhoto(userId, qr, caption, replyMarkup)
  } else await sendmessage(userId, caption, replyMarkup, 'HTML')
  if (panel.config === 'onconfig' && String(c.setting.status_keyboard_config) === '1' && Array.isArray(configs)) {
    await sendmessage(userId, c.T.users.status.getConfigHint, await keyboardConfig(c.T, configs, invoiceId, false), 'HTML')
  }
  await sendWireguardFiles(c.T, userId, wireguard, usernameService)
}
