// Run on the server that will fetch the news:   node check-feeds.mjs [sources.json]
// For each source: HTTP status, how many items, newest title/date, whether items carry a link. Tells you what to mark status "ok".
import fs from 'node:fs'
const file = process.argv[2] || new URL('./sources.json', import.meta.url).pathname
const { sources } = JSON.parse(fs.readFileSync(file, 'utf8'))
const tag = (x, t) => (x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i')) || [])[1]?.replace(/<!\[CDATA\[|\]\]>/g, '').trim()
const items = (xml) => {
  const rss = [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)].map((m) => m[0])
  const atom = rss.length ? [] : [...xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi)].map((m) => m[0])
  return [...rss, ...atom].map((x) => ({ title: tag(x, 'title'), link: tag(x, 'link') || (x.match(/<link[^>]*href="([^"]+)"/i) || [])[1], date: tag(x, 'pubDate') || tag(x, 'updated') || tag(x, 'published') }))
}
const tmeItems = (html) => [...html.matchAll(/data-post="([^"]+)"[\s\S]*?tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/gi)].map((m) => ({ title: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90), link: 'https://t.me/' + m[1], date: '' }))
let bad = 0
for (const s of sources) {
  try {
    const url = s.type === 'tme' ? `https://t.me/s/${s.url.replace(/^@|^https?:\/\/t\.me\/(s\/)?/, '')}` : s.url
    const ctl = AbortSignal.timeout(15000)
    const r = await fetch(url, { signal: ctl, headers: { 'user-agent': 'Mozilla/5.0 (compatible; PichaNewsCheck/1.0)' } })
    const body = await r.text()
    const list = s.type === 'tme' ? tmeItems(body) : items(body)
    const ok = r.ok && list.length > 0
    if (!ok) bad++
    console.log(`${ok ? '✅' : '❌'} ${s.id}  HTTP ${r.status}  ${r.headers.get('content-type') || ''}  items=${list.length}  withLink=${list.filter((x) => x.link).length}`)
    if (list[0]) console.log(`     newest: ${list[0].title?.slice(0, 80)}  ${list[0].date || ''}`)
  } catch (e) { bad++; console.log(`❌ ${s.id}  ${e.message}`) }
}
console.log(bad ? `\n${bad} source(s) failed — do not mark them ok.` : '\nall sources fetched — you may mark them status "ok".')
process.exit(bad ? 1 : 0)
