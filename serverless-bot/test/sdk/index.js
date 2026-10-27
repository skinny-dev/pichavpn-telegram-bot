// Local stand-in for `sdk`: api calls are recorded (and can be scripted), fetch is the real one.
export { db } from './db.js'
export class BotApiError extends Error { constructor(code, description, method) { super(description); this.code = code; this.description = description; this.method = method } }
export class EndpointError extends Error { constructor(d, p) { super(d); this.parameters = p } }
export class InputFile { constructor(bytes, name, o) { this.bytes = bytes; this.name = name; this.type = o?.type } }
export const calls = []
export const replies = {} // method -> function(params) returning result or throwing
let mid = 1000
export const api = new Proxy({}, { get: (_, m) => async (p = {}) => {
  calls.push([m, p])
  if (replies[m]) return replies[m](p)
  if (/^(send|copy|forward)/.test(m)) return { message_id: ++mid, chat: { id: p.chat_id } }
  if (m === 'getChatMember') return { status: 'member' }
  return true
} })
const realFetch = globalThis.fetch
export async function fetch(url, opts = {}) { return realFetch(url, opts) }
fetch.body = {
  json: (o) => JSON.stringify(o),
  form: (o) => new URLSearchParams(o).toString(),
  text: (s) => s,
}
export default { api, db: (await import('./db.js')).db, fetch, BotApiError, EndpointError, InputFile }
