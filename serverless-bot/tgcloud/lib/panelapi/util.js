// Shared bits of the panel API: the error type, number/date helpers.
export class PanelError extends Error {
  constructor(message, status = 400, extra = {}) { super(message); this.status = status; this.extra = extra }
}
export const fail = (msg, status = 400, extra = {}) => { throw new PanelError(msg, status, extra) }
export const FA_DIGITS = { '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9', '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' }
export const latinDigits = (s) => String(s).replace(/[۰-۹٠-٩]/g, (c) => FA_DIGITS[c])
export const now = () => Math.floor(Date.now() / 1000)
/** SQLite spells MySQL's CAST types differently */
export const sqlite = (s) => String(s).replace(/AS SIGNED\)/g, 'AS INTEGER)').replace(/AS UNSIGNED\)/g, 'AS INTEGER)')
/** addcslashes($q, '%_\\') for LIKE … ESCAPE '\' */
export const likeEscape = (q) => String(q).replace(/[%_\\]/g, (c) => '\\' + c)
export const str = (v) => (v === null || v === undefined ? '' : String(v))
export const randomHex12 = () => [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, '0')).join('')
