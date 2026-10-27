import { seed } from './seed.mjs'
import * as P from '../tgcloud/lib/panel.js'
import { one, sql, run } from '../tgcloud/lib/db.js'
await seed(process.argv[2])
await run(sql`UPDATE marzban_panel SET url_panel = 'http://127.0.0.1:8111', code_panel = 'P1'`)
const pan = await one(sql`SELECT name_panel, version_panel, code_panel, conecton FROM marzban_panel`)
console.log('panel', pan)
const t = await P.tokenPanel(await P.panelByName(pan.name_panel)); console.log('token', t.access_token, '| cached:', !!(await one(sql`SELECT datelogin FROM marzban_panel`)).datelogin)
const d = await P.dataUser(pan.name_panel, 'u5', 'fa-bot.example'); console.log('dataUser', JSON.stringify(d).slice(0, 200))
console.log('notfound', JSON.stringify(await P.dataUser(pan.name_panel, 'zzz')).slice(0, 100))
console.log('modify', JSON.stringify(await P.modifyUser(pan.name_panel, 'u5', { status: 'disabled' })).slice(0, 80))
console.log('extraVolume', JSON.stringify(await P.extraVolume('u5', 'P1', 5)).slice(0, 60))
console.log('extend', JSON.stringify(await P.extend('addTimeVolumeNextMonth', 30, 30, 'u5', 'custom_volume', 'P1')).slice(0, 60))
console.log('nopanel', JSON.stringify(await P.dataUser('nope', 'u5')))
