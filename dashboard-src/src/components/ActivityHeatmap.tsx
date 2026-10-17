import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import { fmtCompact, fmtNum, fmtToman } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

type Key = 'revenue' | 'orders' | 'orders_sum' | 'renew' | 'new_users' | 'tests' | 'expenses' | 'support' | 'net'
interface Activity { year: number; month: number; title: string; days: { day: number; weekday: number; future: boolean }[]; series: Record<Key, number[]>; totals: Record<Key, number> }

// one hue per job: blue = activity/magnitude, orange = money going out, net = diverging blue/red around a gray zero
const BLUE = '42 120 214'
const ORANGE = '235 104 52'
const RED = '214 64 52'
const ROWS: { key: Key; label: string; money?: boolean; hue: string }[] = [
  { key: 'revenue', label: 'پول دریافتی', money: true, hue: BLUE },
  { key: 'orders', label: 'سفارش', hue: BLUE },
  { key: 'renew', label: 'تمدید', hue: BLUE },
  { key: 'new_users', label: 'کاربر جدید', hue: BLUE },
  { key: 'tests', label: 'اکانت تست', hue: BLUE },
  { key: 'support', label: 'پیام پشتیبانی', hue: BLUE },
  { key: 'expenses', label: 'هزینه', money: true, hue: ORANGE },
  { key: 'net', label: 'سود روز', money: true, hue: BLUE },
]
const LEVELS = [0.22, 0.45, 0.7, 1]
/** signed toman, minus sign kept in front for RTL text */
const fmtSigned = (v: number) => (v < 0 ? '− ' : '') + fmtToman(Math.abs(v))

/** 0 → empty cell; otherwise 4 steps of one hue, light → dark, scaled to the row's own maximum */
function cellColor(v: number, max: number, hue: string, signed: boolean): string | undefined {
  if (!v || !max) return undefined
  const lvl = LEVELS[Math.min(3, Math.max(0, Math.ceil((Math.abs(v) / max) * 4) - 1))]
  return `rgb(${signed && v < 0 ? RED : hue} / ${lvl})`
}

function jMonthShift(y: number, m: number, d: number) {
  const t = y * 12 + (m - 1) + d
  return { y: Math.floor(t / 12), m: (t % 12) + 1 }
}

export function ActivityHeatmap() {
  const [ym, setYm] = useState<{ y: number; m: number } | null>(null)
  const q = useQuery({
    queryKey: ['activity', ym?.y, ym?.m],
    queryFn: () => api<Activity>('activity', { query: ym ? { month: `${ym.y}/${ym.m}` } : {} }),
    refetchInterval: 120_000,
  })
  const d = q.data
  const todayIdx = useMemo(() => (d ? d.days.findIndex((x, i) => !x.future && (i === d.days.length - 1 || d.days[i + 1].future)) : -1), [d])
  const [sel, setSel] = useState<number | null>(null)
  const focus = sel ?? (todayIdx >= 0 ? todayIdx : null)
  const cur = d ? { y: d.year, m: d.month } : null
  const go = (delta: number) => { if (cur) { setSel(null); setYm(jMonthShift(cur.y, cur.m, delta)) } }
  const isCurrent = !!d && d.days.some((x) => !x.future) && d.days.some((x) => x.future)

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">فعالیت روزانه · {d?.title ?? '…'}</CardTitle>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" aria-label="ماه قبل" onClick={() => go(-1)}><ChevronRight /></Button>
          {!isCurrent && <Button variant="ghost" size="sm" onClick={() => { setSel(null); setYm(null) }}>این ماه</Button>}
          <Button variant="ghost" size="icon-sm" aria-label="ماه بعد" onClick={() => go(1)}><ChevronLeft /></Button>
          {q.isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-3">
        {!d ? <Skeleton className="h-64 w-full" /> : (
          <>
            <div className="grid min-w-0 gap-2.5" role="grid" aria-label={`فعالیت روزانه ${d.title}`}>
              {ROWS.map((r) => {
                const vals = d.series[r.key]
                const max = Math.max(...vals.map(Math.abs), 0)
                return (
                  <div key={r.key} className="grid min-w-0 gap-1 sm:grid-cols-[6.5rem_minmax(0,1fr)_5.5rem] sm:items-center sm:gap-2" role="row">
                    <div className="flex items-baseline justify-between gap-2 text-xs sm:contents">
                      <span className="text-muted-foreground">{r.label}</span>
                      <span className="tabular font-medium sm:order-last sm:text-end" dir="ltr">{r.money ? (d.totals[r.key] < 0 ? '− ' : '') + fmtCompact(Math.abs(d.totals[r.key])) : fmtNum(d.totals[r.key])}</span>
                    </div>
                    <div className="grid gap-[2px]" style={{ gridTemplateColumns: `repeat(${d.days.length}, minmax(0, 1fr))` }}>
                      {vals.map((v, i) => {
                        const day = d.days[i]
                        const bg = day.future ? undefined : cellColor(v, max, r.hue, r.key === 'net')
                        return (
                          <button
                            key={i}
                            type="button"
                            role="gridcell"
                            aria-label={`${day.day} ${d.title}: ${r.label} ${r.money ? fmtSigned(v) : fmtNum(v)}`}
                            onMouseEnter={() => setSel(i)}
                            onFocus={() => setSel(i)}
                            onClick={() => setSel(i)}
                            className={cn('aspect-square min-h-[9px] rounded-[3px] outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ring',
                              day.future ? 'bg-muted/30' : 'bg-muted', focus === i && 'ring-1 ring-foreground/60', day.weekday === 6 && !bg && !day.future && 'bg-muted/60')}
                            style={bg ? { background: bg } : undefined}
                          />
                        )
                      })}
                    </div>
                  </div>
                )
              })}
              {/* day axis */}
              <div className="grid min-w-0 gap-1 sm:grid-cols-[6.5rem_minmax(0,1fr)_5.5rem] sm:gap-2" aria-hidden>
                <span className="hidden sm:block" />
                <div className="grid gap-[2px] text-center text-[10px] text-muted-foreground" style={{ gridTemplateColumns: `repeat(${d.days.length}, minmax(0, 1fr))` }}>
                  {d.days.map((x) => <span key={x.day} className="tabular">{x.day === 1 || x.day % 5 === 0 ? x.day : ''}</span>)}
                </div>
              </div>
            </div>

            {focus !== null && d.days[focus] && (
              <div className="grid grid-cols-2 gap-2 rounded-xl border bg-muted/30 p-3 text-sm sm:grid-cols-4" aria-live="polite">
                <div className="col-span-2 font-medium sm:col-span-4">{d.days[focus].day} {d.title}{d.days[focus].future ? ' (هنوز نرسیده)' : ''}</div>
                {[
                  ['پول دریافتی', fmtToman(d.series.revenue[focus])],
                  ['سفارش', `${fmtNum(d.series.orders[focus])} · ${fmtToman(d.series.orders_sum[focus])}`],
                  ['تمدید', fmtNum(d.series.renew[focus])],
                  ['کاربر جدید', fmtNum(d.series.new_users[focus])],
                  ['اکانت تست', fmtNum(d.series.tests[focus])],
                  ['پیام پشتیبانی', fmtNum(d.series.support[focus])],
                  ['هزینه', fmtToman(d.series.expenses[focus])],
                  ['سود روز', fmtSigned(d.series.net[focus])],
                ].map(([k, v]) => <div key={k} className="min-w-0"><div className="text-xs text-muted-foreground">{k}</div><div className={cn('tabular truncate font-semibold', k === 'سود روز' && d.series.net[focus] < 0 && 'text-destructive')}>{v}</div></div>)}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">کم {LEVELS.map((l) => <i key={l} className="inline-block size-2.5 rounded-[3px]" style={{ background: `rgb(${BLUE} / ${l})` }} />)} زیاد</span>
              <span className="inline-flex items-center gap-1"><i className="inline-block size-2.5 rounded-[3px]" style={{ background: `rgb(${ORANGE} / 0.7)` }} />هزینه</span>
              <span className="inline-flex items-center gap-1"><i className="inline-block size-2.5 rounded-[3px]" style={{ background: `rgb(${RED} / 0.7)` }} />روز با ضرر</span>
              <span>هر ردیف نسبت به بیشترین روز همان ردیف رنگ می‌گیرد</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
