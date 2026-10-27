// The bot's texts ($textbotlang): rows of the texts table (dotted keys) → nested object, plus the label map
// used to recognise reply-keyboard taps on labels that carry a premium emoji (customEmojiLabels in PHP).
import { all, sql } from './db.js'
import { splitLabel, stripTags } from './emoji.js'

let cache = null
export async function loadTexts() {
  if (cache) return cache
  const rows = await all(sql`SELECT key, value FROM texts`)
  const T = {}
  const labels = {}
  for (const { key, value } of rows) {
    const parts = key.split('.')
    let o = T
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]] = o[parts[i]] && typeof o[parts[i]] === 'object' ? o[parts[i]] : {}
    o[parts.at(-1)] = value
    if (typeof value === 'string' && /<tg-emoji/i.test(value)) {
      for (const plain of [splitLabel(value).text, stripTags(value)]) if (plain && plain !== value) labels[plain] = value
    }
  }
  cache = { T: deep(T), labels }
  return cache
}
export function resetTexts() { cache = null }

/** a missing key reads as '' — the same as PHP, where an unset key is null and null == '' */
function deep(o) {
  return new Proxy(o, {
    get(t, k) {
      if (typeof k === 'symbol') return t[k]
      const v = t[k]
      if (v && typeof v === 'object') return deep(v)
      return v ?? ''
    },
  })
}
