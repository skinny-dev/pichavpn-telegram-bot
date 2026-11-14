// What we have already told each customer — one memory for every system (pulse, care, fit, broadcasts …), so that nobody gets the same lesson again,
// nobody gets pushed the same offer a hundred times, and a person who ignores a topic stops hearing it.  kv `mem:<uid>` (small JSON) + counters `mem:n:<topic>:…`.
//   topics[t] = {sent, last, clicks, ignored}   muted[t] = unix time until which the topic is off   pending = {topic, kind, at} (the last message, not yet answered)
//   kind: tip (a lesson) · action (a button that does something: fit, renew, vote) · offer (a sales prompt) · care (a one-time follow-up)
import { kvGet, kvSet } from './db.js'
import { intval } from './php.js'

const DAY = 86400
const now = () => Math.floor(Date.now() / 1000)
export const RULES = {
  maxPerTopic: 2,        // a lesson/prompt on one topic is told at most twice, ever
  minGapDays: 21,        // and not twice within 3 weeks
  ignoreWindowH: 48,     // a message without a tap for 48 h counts as «ignored»
  muteAfterIgnored: 2,   // two ignored messages on a topic with no tap ever → that topic is off …
  muteDays: 60,          // … for 60 days
  offerPauseAfter: 2,    // two ignored offers → no offers …
  offerPauseDays: 45,    // … for 45 days
  fatigueRun: 5,         // five messages in a row ignored → the daily pulse becomes weekly
}
const parse = (s) => { try { return JSON.parse(s) } catch { return null } }
const blank = () => ({ topics: {}, muted: {}, pending: null, run: 0, offerIgnored: 0, offerPausedUntil: 0 })

export async function memGet(uid) { return { ...blank(), ...(parse(await kvGet('mem:' + uid)) || {}) } }
const memSave = (uid, m) => kvSet('mem:' + uid, JSON.stringify(m))
const bump = async (k) => kvSet(k, String(intval(await kvGet(k)) + 1))

/** settle the previous message of this person: tapped (click recorded earlier) or ignored after 48 h → learn from it. Returns the memory. */
export async function memSettle(uid, at = now()) {
  const m = await memGet(uid)
  const p = m.pending
  if (!p || at - p.at < RULES.ignoreWindowH * 3600) return m
  m.pending = null
  const t = (m.topics[p.topic] ||= { sent: 0, last: 0, clicks: 0, ignored: 0 })
  t.ignored++
  m.run++
  await bump(`mem:n:${p.topic}:ignored`)
  if (p.kind === 'offer') { m.offerIgnored++; if (m.offerIgnored >= RULES.offerPauseAfter) { m.offerPausedUntil = at + RULES.offerPauseDays * DAY; m.offerIgnored = 0 } }
  if (t.clicks === 0 && t.ignored >= RULES.muteAfterIgnored) m.muted[p.topic] = at + RULES.muteDays * DAY
  await memSave(uid, m)
  return m
}

/** may this item be sent to this person now? → {ok:true} | {ok:false, why} */
export async function memAllow(uid, item, at = now()) {
  const m = await memSettle(uid, at)
  const t = m.topics[item.topic] || { sent: 0, last: 0, clicks: 0, ignored: 0 }
  if ((m.muted[item.topic] || 0) > at) return { ok: false, why: 'muted' }
  if (item.kind === 'offer' && m.offerPausedUntil > at) return { ok: false, why: 'offer_paused' }
  if (item.kind === 'tip' && t.clicks > 0) return { ok: false, why: 'learned' }          // they tapped it once: they know it
  if (t.sent >= RULES.maxPerTopic && item.kind !== 'action') return { ok: false, why: 'told_enough' }
  if (t.last && at - t.last < RULES.minGapDays * DAY) return { ok: false, why: 'too_soon' }
  return { ok: true }
}

export async function memSent(uid, item, at = now()) {
  const m = await memSettle(uid, at)
  const t = (m.topics[item.topic] ||= { sent: 0, last: 0, clicks: 0, ignored: 0 })
  t.sent++; t.last = at
  m.pending = { topic: item.topic, kind: item.kind || 'tip', at }
  await memSave(uid, m)
  await bump(`mem:n:${item.topic}:sent`)
}

/** the person tapped something of this topic */
export async function memClick(uid, topic, at = now()) {
  const m = await memGet(uid)
  const t = (m.topics[topic] ||= { sent: 0, last: 0, clicks: 0, ignored: 0 })
  t.clicks++
  if (m.pending && m.pending.topic === topic) m.pending = null
  m.run = 0 // an answer resets the fatigue run
  delete m.muted[topic]
  await memSave(uid, m)
  await bump(`mem:n:${topic}:click`)
}

/** how tired is this person: the run of ignored messages (the pulse becomes weekly at RULES.fatigueRun) */
export async function memTired(uid, at = now()) { const m = await memSettle(uid, at); return m.run >= RULES.fatigueRun }

/** aggregate numbers: which topics are told, tapped, ignored — a topic nobody taps is useless and should be retired */
export async function memStats(topics) {
  const out = []
  for (const t of topics) {
    const sent = intval(await kvGet(`mem:n:${t}:sent`)), click = intval(await kvGet(`mem:n:${t}:click`)), ignored = intval(await kvGet(`mem:n:${t}:ignored`))
    if (sent) out.push({ topic: t, sent, click, ignored, rate: sent ? Math.round((100 * click) / sent) : 0 })
  }
  return out.sort((a, b) => b.rate - a.rate)
}
