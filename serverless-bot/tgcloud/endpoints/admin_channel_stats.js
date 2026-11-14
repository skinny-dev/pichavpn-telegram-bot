// Channel health numbers from the CLI only (`npx tgcloud run endpoints/admin_channel_stats '{}'`): members of the forced channel(s) against bot users,
// how many bot users came in per period. Counts only — no user ids, names or channel links.
import { EndpointError } from 'sdk'
import { one, all, sql } from '../lib/db.js'
import { telegram } from '../lib/tg.js'

const num = async (q) => Number((await one(q))?.n ?? 0)

export default async function (input, ctx) {
  if (ctx && ctx.initData) throw new EndpointError('forbidden', { code: 'FORBIDDEN' })
  const now = Math.floor(Date.now() / 1000)
  const since = (d) => now - d * 86400
  const users = await num(sql`SELECT COUNT(*) AS n FROM user`)
  const joined = await num(sql`SELECT COUNT(*) AS n FROM user WHERE joinchannel = 'active'`)
  const reg = async (d) => num(sql`SELECT COUNT(*) AS n FROM user WHERE CAST(register AS INTEGER) >= ${since(d)}`)
  const buyers = await num(sql`SELECT COUNT(DISTINCT id_user) AS n FROM Payment_report WHERE payment_Status = 'paid'`)
  const chans = (await all(sql`SELECT link FROM channels`)).map((r) => r.link).filter((l) => l && String(l).trim() !== '' && String(l).trim() !== '0')
  const channels = []
  for (const link of chans) {
    const r = await telegram('getChatMemberCount', { chat_id: link }).catch(() => null)
    channels.push({ members: r && r.ok ? r.result : null })
  }
  const members = channels.reduce((a, c) => a + (c.members ?? 0), 0)
  return {
    bot_users: users, joined_forced_channel: joined, ever_paid: buyers,
    new_users: { d7: await reg(7), d30: await reg(30), d90: await reg(90) },
    forced_channels: channels,
    reading: channels.length === 1 && channels[0].members ? { channel_members: channels[0].members, bot_users_in_channel_est: joined, others_est: Math.max(0, channels[0].members - joined) } : null,
  }
}
