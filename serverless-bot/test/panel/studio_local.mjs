// The Studio on localhost: the real panel (dist/) + the real Studio code on a throwaway SQLite database and a FAKE Telegram.
// Nothing leaves your machine: every «sent» message is printed here instead. Needs no export, token or server.
//   cd serverless-bot && node --no-warnings --import ./test/register.mjs test/panel/studio_local.mjs      → http://localhost:8787
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import * as schema from '../../tgcloud/schema.js'
import { migrate, sql } from 'sdk/db'
import { db, replies } from 'sdk'
import { handle } from '../../tgcloud/lib/panelapi/index.js'
import '../../tgcloud/lib/panelapi/modules.js'
import { seedDrafts } from '../../tgcloud/lib/studio.js'

migrate(schema)
const ME = '1'
await db.run(sql`INSERT INTO admin (id_admin, username, password, rule) VALUES (${ME}, 'local', 'x', 'administrator')`)
await db.run(sql`INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES ('config:usernamebot', '@pichanet_bot', 0)`)
const iso = (t) => new Date(t).toISOString().slice(0, 10)
console.log('drafts created:', await seedDrafts(iso(Date.now() - 14 * 864e5), iso(Date.now() + 200 * 864e5)))
for (const m of ['sendmessage', 'sendphoto']) replies[m] = (p) => {
  console.log(`\n── FAKE TELEGRAM ${m} → ${p.chat_id}\n${p.text || p.caption}\n${p.reply_markup ? JSON.stringify(JSON.parse(p.reply_markup).inline_keyboard.flat().map((b) => b.text + ' → ' + (b.url || 'copy'))) : ''}`)
  return { message_id: 1, chat: { id: Number(p.chat_id) }, date: Math.floor(Date.now() / 1000) }
}
const DIST = path.resolve(new URL('../../dist', import.meta.url).pathname)
const STANDIN = `<script>window.Telegram={WebApp:{colorScheme:'light',initData:'x',ready(){},expand(){},disableVerticalSwipes(){},isVersionAtLeast:()=>true,BackButton:{show(){},hide(){},onClick(){},offClick(){}},HapticFeedback:{impactOccurred(){},notificationOccurred(){}},Serverless:{call(n,i,cb){fetch('/api/'+n,{method:'POST',body:JSON.stringify(i)}).then(r=>r.json()).then(x=>cb(null,x),e=>cb(e))}}}}</script>`
const port = +(process.env.PORT || 8787)
http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/panel') {
    let b = ''
    for await (const c of req) b += c
    const { r, query, body } = JSON.parse(b)
    const out = await handle(r, query, body, ME)
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(out)); return
  }
  let f = path.join(DIST, req.url.split('?')[0])
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html')
  const ext = path.extname(f)
  res.setHeader('content-type', { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' }[ext] || 'application/octet-stream')
  res.end(ext === '.html' ? fs.readFileSync(f, 'utf8').replace('<head>', '<head>' + STANDIN) : fs.readFileSync(f))
}).listen(port, () => console.log(`\nStudio: http://localhost:${port}/#/studio   (Ctrl+C to stop)`))
