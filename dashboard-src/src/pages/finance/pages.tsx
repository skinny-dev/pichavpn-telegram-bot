import { useEffect, useState } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, ArrowLeftRight, CircleDot, Plus, RefreshCw, Search } from 'lucide-react'
import { fmtCompact, fmtNum } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useDebounced } from '@/lib/hooks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Empty, Field, KIND_LABEL, Loading, Money, Pager, RangeBar, Section, Stat, StateBadge, can, fmtClock, fmtDay, fmtMoney, rangeParams, rangeReady, useFin, useMeta, usePost, type RangeValue } from './shared'
import type { ActionKey, Preset } from './forms'

export interface Nav { action: (a: ActionKey, p?: Preset) => void; entry: (t: { txn?: number; entry?: number }) => void; go: (tab: string) => void }

const loadRange = (): RangeValue => { try { return JSON.parse(localStorage.getItem('fin-range') || '') } catch { return { range: 'month' } } }
export function useRangeState(): [RangeValue, (v: RangeValue) => void] {
  const [v, setV] = useState<RangeValue>(loadRange)
  return [v, (n) => { setV(n); try { localStorage.setItem('fin-range', JSON.stringify(n)) } catch { /* private mode */ } }]
}

// ------------------------------------------------------------------ overview

export function OverviewPage({ nav }: { nav: Nav }) {
  const [range, setRange] = useRangeState()
  const meta = useMeta()
  const q = useFin<any>('fin_overview', rangeParams(range), { enabled: rangeReady(range), refetch: 60_000 })
  const act = useFin<any>('fin_activity', { range: 'today', per: 8 }, { refetch: 60_000 })
  const recv = useFin<any>('fin_aging', { kind: 'sale' })
  const pay = useFin<any>('fin_aging', { kind: 'purchase' })
  const health = useFin<any>('fin_integrity', {}, { enabled: can(meta, 'reports.view') })
  const o = q.data?.overview
  const sync = usePost('fin_sync', undefined, 'همگام‌سازی انجام شد')
  const due = [...(recv.data?.docs ?? []).map((d: any) => ({ ...d, kind: 'sale' })), ...(pay.data?.docs ?? []).map((d: any) => ({ ...d, kind: 'purchase' }))]
    .filter((d) => ['overdue', 'due_today', 'due_soon'].includes(d.bucket)).sort((a, b) => (a.due_date ?? 0) - (b.due_date ?? 0)).slice(0, 6)
  return (
    <div className="grid gap-5">
      <RangeBar value={range} onChange={setRange} />
      {!o ? <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />)}</div> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="موجودی پول" value={<Money value={o.money_total} size="lg" />} hint={`نقد ${fmtCompact(o.cash)} · بانک ${fmtCompact(o.bank)}${o.other_money ? ` · سایر ${fmtCompact(o.other_money)}` : ''}`} onClick={() => nav.go('money')} />
            <Stat label="فروش" value={<Money value={o.sales} size="lg" />} hint={o.cogs ? `بهای تمام‌شده ${fmtCompact(o.cogs)}` : undefined} tone="success" />
            <Stat label="هزینه‌ها" value={<Money value={o.expenses} size="lg" />} tone={o.expenses ? 'danger' : undefined} />
            <Stat label="سود خالص" value={<Money value={o.net_profit} size="lg" sign />} hint={o.net_margin !== null ? `${fmtNum(o.net_margin)}٪ فروش` : undefined} onClick={() => nav.go('reports')} />
            <Stat label="طلب از مشتریان" value={<Money value={o.receivables} size="lg" />} hint={o.overdue_receivables ? <span className="text-destructive">سررسید گذشته {fmtCompact(o.overdue_receivables)}</span> : 'بدون معوقه'} onClick={() => nav.go('receivables')} />
            <Stat label="بدهی به تأمین‌کنندگان" value={<Money value={o.payables} size="lg" />} hint={o.overdue_payables ? <span className="text-destructive">سررسید گذشته {fmtCompact(o.overdue_payables)}</span> : 'بدون معوقه'} onClick={() => nav.go('payables')} />
            <Stat label="حقوق صاحبان سرمایه" value={<Money value={o.equity} size="lg" />} hint={`سرمایه‌ی ثبت‌شده ${fmtCompact(o.capital)}`} onClick={() => nav.go('partners')} />
            <Stat label="بدهی کیف پول مشتریان" value={<Money value={o.customer_wallets_info} size="lg" />} hint="اطلاعاتی · موجودی کیف پول‌های ربات" />
          </div>

          <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
            <Section title="فروش و هزینه در بازه">
              {o.series.length === 0 ? <Empty title="هنوز تراکنشی در این بازه نیست" hint="با دکمه‌ی + اولین فروش یا هزینه را ثبت کنید." /> : (
                <div className="h-64 rounded-xl border bg-card p-3" dir="ltr">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={o.series} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d: string) => d.slice(5)} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => fmtCompact(v)} width={56} />
                      <Tooltip formatter={(v) => fmtMoney(Number(v))} labelFormatter={(l) => String(l)} />
                      <Area type="monotone" dataKey="revenue" name="درآمد" stroke="hsl(var(--success))" fill="hsl(var(--success) / .15)" />
                      <Area type="monotone" dataKey="expense" name="هزینه" stroke="hsl(var(--destructive))" fill="hsl(var(--destructive) / .12)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Section>
            <Section title="سررسیدها" action={<Button variant="ghost" size="sm" onClick={() => nav.go('receivables')}>همه</Button>}>
              {due.length === 0 ? <Empty title="سررسید نزدیکی نیست" hint="فاکتورهای نسیه‌ی دارای سررسید اینجا یادآوری می‌شوند." /> : (
                <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
                  {due.map((d) => (
                    <li key={d.kind + d.id}>
                      <button className="flex w-full items-center justify-between gap-2 rounded-xl border bg-card p-3 text-start hover:bg-accent/40" onClick={() => nav.entry({ txn: d.id })}>
                        <span className="min-w-0"><span className="block truncate font-medium">{d.party_name ?? '—'}</span><span className="block text-xs text-muted-foreground">{d.kind === 'sale' ? 'طلب' : 'بدهی'} · {d.ref} · سررسید {fmtDay(d.due_date)}</span></span>
                        <span className="text-end"><Money value={d.outstanding} /><span className="block"><StateBadge state={d.state} /></span></span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>

          <Section title="امروز چه اتفاقی افتاد؟" action={<Button variant="ghost" size="sm" onClick={() => nav.go('activity')}>همه‌ی تراکنش‌ها</Button>}>
            {act.data?.rows?.length ? <ActivityList rows={act.data.rows} onOpen={nav.entry} /> : <Empty title="امروز هنوز تراکنشی ثبت نشده" hint="فروش‌ها، هزینه‌ها و پرداخت‌های امروز اینجا به‌ترتیب زمان دیده می‌شوند." action={<Button onClick={() => nav.action('sale')}><Plus />ثبت فروش</Button>} />}
          </Section>
        </>
      )}
      {(health.data?.problems?.length ?? 0) > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" /><div><b>ناهماهنگی در دفاتر</b><ul className="mt-1 list-disc ps-5">{health.data.problems.map((p: string) => <li key={p}>{p}</li>)}</ul></div></div>
      )}
      {(health.data?.last_stats?.issues?.length ?? 0) > 0 && (
        <details className="rounded-xl border p-3 text-sm"><summary className="cursor-pointer font-medium">{fmtNum(health.data.last_stats.issues.length)} رکورد قدیمی قابل ثبت نبود</summary><ul className="mt-2 list-disc ps-5 text-xs text-muted-foreground">{health.data.last_stats.issues.slice(0, 20).map((p: string) => <li key={p}>{p}</li>)}</ul></details>
      )}
      <div className="flex justify-end"><Button variant="ghost" size="sm" disabled={sync.isPending} onClick={() => sync.mutate({})}><RefreshCw className={cn(sync.isPending && 'animate-spin')} />همگام‌سازی با داده‌های ربات{q.data?.last_sync ? ` · آخرین: ${fmtClock(q.data.last_sync)}` : ''}</Button></div>
    </div>
  )
}

// ------------------------------------------------------------------ activity timeline

const DIR_ICON = { in: ArrowDownLeft, out: ArrowUpRight, none: CircleDot } as const

export function ActivityList({ rows, onOpen }: { rows: any[]; onOpen: (t: { txn?: number; entry?: number }) => void }) {
  let lastDay = ''
  return (
    <ul className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
      {rows.map((r) => {
        const day = fmtDay(r.entry_date)
        const head = day !== lastDay ? day : null
        lastDay = day
        const Icon = r.source_type === 'transfer' ? ArrowLeftRight : DIR_ICON[r.direction as 'in' | 'out' | 'none']
        const signed = r.direction === 'in' ? Number(r.money_effect) : r.direction === 'out' ? Number(r.money_effect) : Number(r.amount)
        return (
          <li key={r.id}>
            {head && <div className="px-1 pb-1 pt-3 text-xs font-medium text-muted-foreground">{head}</div>}
            <button onClick={() => onOpen(r.txn_id ? { txn: Number(r.txn_id) } : { entry: Number(r.id) })} className="flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-start hover:bg-accent/40">
              <span className={cn('grid size-9 shrink-0 place-items-center rounded-full', r.direction === 'in' ? 'bg-success/15 text-success' : r.direction === 'out' ? 'bg-destructive/15 text-destructive' : 'bg-muted text-muted-foreground')}><Icon className="size-4" /></span>
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-2"><span className="truncate font-medium">{r.title}{r.party_name ? ` · ${r.party_name}` : ''}</span>{r.status === 'reversed' && <Badge variant="secondary">ابطال</Badge>}{r.source_type === 'reversal' && <Badge variant="secondary">برگشت</Badge>}</span>
                <span className="block truncate text-xs text-muted-foreground">{fmtClock(r.entry_date)}{r.ref ? ` · ${r.ref}` : r.entry_no ? ` · ${r.entry_no}` : ''}{r.memo ? ` · ${r.memo}` : ''}</span>
              </span>
              <span className="shrink-0 text-end"><Money value={signed} sign={r.direction !== 'none'} />{r.direction === 'none' && <span className="block text-[10px] text-muted-foreground">بدون جابه‌جایی پول</span>}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

const TYPE_FILTERS: [string, string][] = [['', 'همه'], ['sale', 'فروش'], ['expense', 'هزینه'], ['receipt', 'دریافت'], ['payment', 'پرداخت'], ['transfer', 'انتقال'], ['purchase', 'خرید'], ['capital_in', 'سرمایه'], ['income', 'درآمد']]

export function ActivityPage({ nav }: { nav: Nav }) {
  const [range, setRange] = useRangeState()
  const [type, setType] = useState('')
  const [dir, setDir] = useState('')
  const [q, setQ] = useState('')
  const dq = useDebounced(q, 300)
  const [page, setPage] = useState(1)
  useEffect(() => setPage(1), [type, dir, dq, range])
  const list = useFin<any>('fin_activity', { ...rangeParams(range), type, direction: dir, q: dq, page, per: 40 }, { enabled: rangeReady(range) })
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1 md:max-w-sm"><Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="ps-9" placeholder="جستجو: نام، شماره‌ی سند، مبلغ، توضیح…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="flex gap-1.5">{[['', 'همه'], ['in', 'ورودی پول'], ['out', 'خروجی پول']].map(([k, l]) => <button key={k} data-on={dir === k} onClick={() => setDir(k)} className="rounded-full border px-3 py-1 text-sm hover:bg-accent data-[on=true]:border-primary data-[on=true]:bg-primary/10">{l}</button>)}</div>
      </div>
      <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0"><div className="flex gap-1.5">{TYPE_FILTERS.map(([k, l]) => <button key={k} data-on={type === k} onClick={() => setType(k)} className="whitespace-nowrap rounded-full border px-3 py-1 text-sm hover:bg-accent data-[on=true]:border-primary data-[on=true]:bg-primary/10 data-[on=true]:font-medium">{l}</button>)}</div></div>
      <RangeBar value={range} onChange={setRange} />
      {!list.data ? <Loading /> : list.data.rows.length === 0 ? (
        <Empty title="تراکنشی پیدا نشد" hint="فیلترها را عوض کنید یا یک تراکنش جدید ثبت کنید." action={<Button onClick={() => nav.action('sale')}><Plus />ثبت فروش</Button>} />
      ) : (
        <>
          <ActivityList rows={list.data.rows} onOpen={nav.entry} />
          <Pager page={list.data.page} per={list.data.per} total={list.data.total} onPage={setPage} />
        </>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ money (cash & banks)

export function MoneyPage({ nav }: { nav: Nav }) {
  const meta = useMeta()
  const q = useFin<{ accounts: any[] }>('fin_money')
  const [ledger, setLedger] = useState<{ id: number; name: string } | null>(null)
  const accts = (q.data?.accounts ?? []).filter((a) => !a.archived)
  const total = accts.reduce((a, m) => a + m.balance, 0)
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
        <div><div className="text-xs text-muted-foreground">مجموع پول در همه‌ی حساب‌ها</div><Money value={total} size="lg" /> <span className="text-sm text-muted-foreground">تومان</span></div>
        {can(meta, 'accounts.manage') && <Button onClick={() => nav.action('transfer')}><ArrowLeftRight />انتقال بین حساب‌ها</Button>}
      </div>
      {!q.data ? <Loading /> : accts.length === 0 ? <Empty title="هنوز حسابی ندارید" hint="در تنظیمات می‌توانید صندوق، بانک یا درگاه اضافه کنید." /> : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {accts.map((a) => (
            <li key={a.id}>
              <button onClick={() => setLedger(a)} className="grid w-full gap-2 rounded-xl border bg-card p-4 text-start hover:bg-accent/40">
                <div className="flex items-center justify-between gap-2"><span className="font-medium">{a.name}</span><Badge variant="secondary">{KIND_LABEL[a.kind] ?? a.kind}</Badge></div>
                <Money value={a.balance} size="lg" className={a.balance < 0 ? 'text-destructive' : ''} />
                <div className="flex justify-between text-xs text-muted-foreground"><span className="text-success">ورودی ۳۰ روز {fmtCompact(a.incoming_30d)}</span><span className="text-destructive">خروجی {fmtCompact(a.outgoing_30d)}</span></div>
                {a.last_activity && <div className="text-xs text-muted-foreground">آخرین گردش: {fmtDay(a.last_activity)}</div>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <LedgerDialog account={ledger} onClose={() => setLedger(null)} onOpen={nav.entry} />
    </div>
  )
}

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const MOVE_LABEL: Record<string, string> = { capital_in: '➕ ورود سرمایه (پول خودتان)', capital_out: '➖ برداشت صاحب سرمایه (برای خودتان)', distribution: '🤝 تقسیم سود', transfer: '🔁 انتقال بین حساب‌ها',
  expense: '🧾 هزینه‌ها', purchase: '🛒 خرید', payment: '💸 پرداخت به تأمین‌کننده', sale: '🛍 فروش', receipt: '📥 دریافت از مشتری', income: '💰 درآمد دیگر',
  refund_sale: '↩️ برگشت از فروش', loan_in: '🏦 دریافت وام', loan_out: '🏦 پرداخت وام', loan_payment: '🏦 قسط وام', asset_purchase: '🖥 خرید دارایی', reversal: '⛔ ابطال', opening: '📌 مانده‌ی اول' }

export function LedgerDialog({ account, onClose, onOpen }: { account: { id: number; name: string } | null; onClose: () => void; onOpen: (t: { txn?: number; entry?: number }) => void }) {
  const [page, setPage] = useState(1)
  useEffect(() => setPage(1), [account?.id])
  const q = useFin<any>('fin_ledger', { account: account?.id, range: 'all', page, per: 30 }, { enabled: !!account })
  return (
    <Dialog open={!!account} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="md:max-w-2xl">
        <DialogHeader><DialogTitle>{account?.name}</DialogTitle><DialogDescription>گردش حساب با مانده‌ی لحظه‌ای</DialogDescription></DialogHeader>
        {!q.data ? <Loading rows={3} /> : q.data.report.rows.length === 0 ? <Empty title="این حساب هنوز گردشی ندارد" /> : (
          <div className="grid gap-2">
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">مانده‌ی فعلی</span><Money value={q.data.report.closing} /></div>
            {(q.data.report.breakdown ?? []).length > 0 && (
              <div className="grid gap-1.5 rounded-xl border bg-muted/30 p-3 text-sm">
                <div className="text-xs text-muted-foreground">چقدر به این حساب آمده و از آن رفته</div>
                {q.data.report.breakdown.map((b: { kind: string; in: number; out: number }) => (
                  <div key={b.kind} className="flex items-center justify-between gap-2">
                    <span>{MOVE_LABEL[b.kind] ?? b.kind}</span>
                    <span className="flex gap-3 tabular">{b.in > 0 && <span className="text-success">+{fmtNum(b.in)}</span>}{b.out > 0 && <span className="text-destructive">−{fmtNum(b.out)}</span>}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t pt-1.5 text-xs text-muted-foreground">
                  <span>جمع ورودی <span className="text-success tabular">{fmtNum(q.data.report.breakdown.reduce((s: number, b: any) => s + b.in, 0))}</span></span>
                  <span>جمع خروجی <span className="text-destructive tabular">{fmtNum(q.data.report.breakdown.reduce((s: number, b: any) => s + b.out, 0))}</span></span>
                </div>
              </div>
            )}
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
              {q.data.report.rows.map((r: any, i: number) => (
                <li key={i}><button className="flex w-full items-center justify-between gap-2 rounded-lg border p-2.5 text-start text-sm hover:bg-accent/40" onClick={() => { onClose(); onOpen(r.txn_id ? { txn: Number(r.txn_id) } : { entry: Number(r.entry_id) }) }}>
                  <span className="min-w-0"><span className="block truncate">{r.memo || r.source_type}</span><span className="block text-xs text-muted-foreground">{fmtDay(r.entry_date)}{r.party_name ? ` · ${r.party_name}` : ''}</span></span>
                  <span className="text-end"><Money value={Number(r.debit) - Number(r.credit)} sign size="sm" /><span className="block text-[11px] text-muted-foreground tabular">مانده {fmtNum(r.balance)}</span></span>
                </button></li>
              ))}
            </ul>
            <Pager page={q.data.report.page} per={q.data.report.per} total={q.data.report.total} onPage={setPage} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export { Field }
