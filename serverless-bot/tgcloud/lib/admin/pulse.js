// /pulse and /today — the administrator's switch, rollout, test and the day's inputs for the daily pulse (pulse.js)
import { kvGet, kvSet, kvDel } from '../db.js'
import { sendmessage } from '../tg.js'
import { pulseStats, pulseTest, SLOT_WINDOWS, PULSE_LIBRARY } from '../pulse.js'
import { memStats } from '../memory.js'

const dayKey = (at) => Math.floor((at + 12600) / 86400)

export const adminPulseRoutes = [
  async (c) => {
    if (c.adminRow?.rule !== 'administrator') return false
    const t = String(c.text ?? '').trim()
    let m
    if ((m = /^\/pulse (on|off)$/.exec(t))) { await kvSet('pulse:on', m[1] === 'on' ? '1' : '0'); await sendmessage(c.from_id, m[1] === 'on' ? '🟢 نبض روزانه روشن شد. (حالت فعلی را با /pulse ببینید؛ پیش‌فرض فقط ادمین‌هاست)' : '⚫️ نبض روزانه خاموش شد.', null, 'HTML'); return true }
    if (t === '/memory') {
      const topics = [...new Set([...PULSE_LIBRARY.map((i) => i.topic), 'update_sub', 'best_today', 'status_today', 'test_followup', 'test_invite', 'test_ending'])]
      const st = await memStats(topics)
      const lines = st.map((x) => `${x.topic}: ارسال ${x.sent} · لمس ${x.click} (${x.rate}٪) · نادیده ${x.ignored}`)
      const weak = st.filter((x) => x.sent >= 30 && x.rate < 3).map((x) => x.topic)
      await sendmessage(c.from_id, ['🧠 <b>حافظهٔ پیام‌ها</b> (چه چیزی را چند بار گفته‌ایم و چه کسی لمس کرده)', lines.join('\n') || 'هنوز دادهٔ کافی نیست.', weak.length ? `\n⚠️ موضوع‌های کم‌اثر (≥۳۰ ارسال و لمس < ۳٪): ${weak.join('، ')} — بازنویسی یا حذف شوند.` : '', '\nقواعد: هر موضوع آموزشی حداکثر ۲ بار و نه زودتر از ۱ ماه؛ لمس‌شده = یاد گرفته؛ ۲ بار نادیده = ۶۰ روز خاموش؛ ۲ پیشنهاد نادیده = ۴۵ روز بدون پیشنهاد؛ ۵ پیام نادیده پیاپی = نبض هفتگی.'].filter(Boolean).join('\n'), null, 'HTML')
      return true
    }
    if (t === '/pulse resume') { await kvDel('pulse:paused'); await sendmessage(c.from_id, '✅ ترمز برداشته شد.', null, 'HTML'); return true }
    if ((m = /^\/pulse mode (admins|sample|all)(?: (\d{1,3}))?$/.exec(t))) {
      await kvSet('pulse:mode', m[1]); if (m[1] === 'sample') await kvSet('pulse:pct', String(Math.min(Math.max(Number(m[2] || 5), 1), 100)))
      await sendmessage(c.from_id, `✅ حالت: ${m[1]}${m[1] === 'sample' ? ' ' + (m[2] || 5) + '٪' : ''}`, null, 'HTML'); return true
    }
    if ((m = /^\/pulse test (morning|noon|night)$/.exec(t))) { await pulseTest(c, m[1]); return true }
    if (t === '/pulse') {
      const s = await pulseStats()
      const items = s.items.map((i) => `${i.id}: ارسال ${i.sent} · لمس ${i.clicks}`).join('\n') || '—'
      await sendmessage(c.from_id, [
        `🔔 <b>نبض روزانه</b>  ${s.on ? '🟢 روشن' : '⚫️ خاموش'}  · حالت: ${s.mode}${s.mode === 'sample' ? ' ' + s.pct + '٪' : ''}`,
        s.paused ? `⛔️ ترمز خودکار: ${s.paused}  (/pulse resume)` : '',
        `امروز: ارسال ${s.today.sent} · بلاک ${s.today.blocked}   |   ۷ روز: ارسال ${s.week.sent} · بلاک ${s.week.blocked}`,
        `فرکانس کاربران: ${Object.entries(s.freq).map(([k, v]) => `${k} ${v}`).join('، ') || '—'}   · نظر: 👍 ${s.votes.good} · 🙂 ${s.votes.ok} · 👎 ${s.votes.bad}`,
        `ورودی امروز: ${s.todayInputs ? JSON.stringify(s.todayInputs) : '—'}`,
        '', items, '',
        `بازه‌ها: ${Object.entries(SLOT_WINDOWS).map(([k, [a, b]]) => `${k} ${a}–${b}`).join(' · ')}`,
        '/pulse on|off · /pulse mode admins|sample 5|all · /pulse test morning|noon|night · /today status … · /today best … · /today update on|off · /today clear',
      ].filter(Boolean).join('\n'), null, 'HTML')
      return true
    }
    // /today status <text> | best <text> | update on|off | clear   — what the morning message says today (only what is true)
    if ((m = /^\/today (status|best) ([\s\S]+)$/.exec(t)) || (m = /^\/today (update) (on|off)$/.exec(t)) || (m = /^\/today (clear)$/.exec(t))) {
      const k = 'pulse:today:' + dayKey(Math.floor(Date.now() / 1000))
      let cur = {}; try { cur = JSON.parse((await kvGet(k)) || '{}') } catch { cur = {} }
      if (m[1] === 'clear') cur = {}
      else if (m[1] === 'update') cur.update = m[2] === 'on'
      else cur[m[1]] = m[2].trim().slice(0, 300)
      await kvSet(k, JSON.stringify(cur))
      await sendmessage(c.from_id, '✅ ثبت شد: ' + JSON.stringify(cur), null, 'HTML')
      return true
    }
    return false
  },
]
