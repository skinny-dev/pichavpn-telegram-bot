// Database of the dev bot (SQLite on Telegram Serverless).
import { table, integer, text, sql } from 'sdk/db'

// api_url, api_key (from `php scripts/serverless_setup.php key` on the bot server), owner_id, main_bot
export const settings = table('settings', {
  key:   text('key').primaryKey(),
  value: text('value'),
})

// who has used the dev bot (only for the /stats command)
export const visitors = table('visitors', {
  tgId:     integer('tg_id').primaryKey(),
  name:     text('name'),
  firstAt:  integer('first_at').default(sql`(unixepoch())`),
  lastAt:   integer('last_at').default(sql`(unixepoch())`),
  hits:     integer('hits').default(1),
})
