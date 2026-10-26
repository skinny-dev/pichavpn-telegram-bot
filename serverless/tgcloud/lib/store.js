// Settings and visitor log in the dev bot's database.
import { db } from 'sdk'
import { eq, sql } from 'sdk/db'
import { settings, visitors } from '../schema.js'

export async function getSetting(key) {
  const row = await db.select().from(settings).where(eq(settings.key, key)).get()
  return row ? row.value : null
}

export async function setSetting(key, value) {
  await db.insert(settings).values({ key, value: String(value) })
    .onConflictDoUpdate({ target: settings.key, set: { value: String(value) } }).run()
}

export async function touchVisitor(user) {
  if (!user || !user.id) return
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ').slice(0, 64)
  await db.insert(visitors).values({ tgId: user.id, name })
    .onConflictDoUpdate({ target: visitors.tgId, set: { name, lastAt: sql`(unixepoch())`, hits: sql`hits + 1` } }).run()
}

export async function visitorStats() {
  const row = await db.get(sql`SELECT count(*) AS n, sum(CASE WHEN last_at > unixepoch() - 86400 THEN 1 ELSE 0 END) AS day FROM visitors`)
  return { total: row ? row.n : 0, day: row ? (row.day || 0) : 0 }
}
