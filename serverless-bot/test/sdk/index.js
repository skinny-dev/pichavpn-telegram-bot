// Local stand-in for `sdk`: api calls are recorded (and can be scripted), fetch is the real one.
export { db } from './db.js'
export class BotApiError extends Error { constructor(code, description, method) { super(description); this.code = code; this.description = description; this.method = method } }
export class EndpointError extends Error { constructor(d, p) { super(d); this.parameters = p } }
export class InputFile { constructor(bytes, name, o) { this.bytes = bytes; this.name = name; this.type = o?.type } }
export const calls = []
export const replies = {} // method -> function(params) returning result or throwing
// every call counts (like the PHP side's fake Telegram), so message ids line up between the two bots
let n = 0, base = 5000
export const setNextMessageId = (b) => { base = b; n = 0 }
export const api = new Proxy({}, { get: (_, m) => async (p = {}) => {
  calls.push([m, p])
  n++
  if (replies[m]) return replies[m](p)
  const lm = m.toLowerCase()
  if (lm === 'getchatmember') return { status: 'member', user: { id: Number(p.user_id) } }
  if (lm === 'getme') return { id: 1, is_bot: true, username: 'pichanet_bot', first_name: 'Picha' }
  return { message_id: base + n, chat: { id: Number(p.chat_id) }, date: Math.floor(Date.now() / 1000) }
} })
const realFetch = globalThis.fetch
export async function fetch(url, opts = {}) { return realFetch(url, opts) }
fetch.body = {
  json: (o) => JSON.stringify(o),
  form: (o) => new URLSearchParams(o).toString(),
  text: (s) => s,
}
export default { api, db: (await import('./db.js')).db, fetch, BotApiError, EndpointError, InputFile }
