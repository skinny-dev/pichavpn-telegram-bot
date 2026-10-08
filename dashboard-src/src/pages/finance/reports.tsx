import { useMemo, useState } from 'react'
import Papa from 'papaparse'
import { Download, Printer } from 'lucide-react'
import { fmtNum } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Chips, Empty, Loading, Money, Pager, RangeBar, fmtDay, fmtMoney, rangeParams, rangeReady, useFin, type RangeValue } from './shared'
import { useRangeState, type Nav, LedgerDialog } from './pages'

type Tab = 'pl' | 'bs' | 'cf' | 'tb' | 'cats' | 'ledger' | 'tax'
const TABS: [Tab, string][] = [['pl', 'سود و زیان'], ['bs', 'ترازنامه'], ['cf', 'جریان نقد'], ['cats', 'فروش و هزینه به تفکیک'], ['tax', 'مالیات'], ['tb', 'تراز آزمایشی'], ['ledger', 'دفتر کل']]

function download(name: string, rows: (string | number)[][]) {
  const blob = new Blob(['﻿' + Papa.unparse(rows)], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

function Toolbar({ onCsv }: { onCsv: () => void }) {
  return (
    <div className="flex gap-2 print:hidden">
      <Button variant="outline" size="sm" onClick={onCsv}><Download />خروجی CSV</Button>
      <Button variant="outline" size="sm" onClick={() => window.print()}><Printer />چاپ / PDF</Button>
    </div>
  )
}

function Row({ label, value, bold, indent, tone, onClick }: { label: React.ReactNode; value: number; bold?: boolean; indent?: boolean; tone?: boolean; onClick?: () => void }) {
  return (
    <div onClick={onClick} className={cn('flex items-center justify-between gap-3 border-b px-3 py-2 text-sm last:border-0', bold && 'bg-muted/50 font-semibold', indent && 'ps-7 text-muted-foreground', onClick && 'cursor-pointer hover:bg-accent/40')}>
      <span className="min-w-0 truncate">{label}</span><Money value={value} size="sm" sign={tone} />
    </div>
  )
}
const Card = ({ title, children }: { title?: string; children: React.ReactNode }) => <div className="overflow-hidden rounded-xl border bg-card">{title && <div className="border-b bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground">{title}</div>}{children}</div>

export function ReportsPage({ nav }: { nav: Nav }) {
  const [tab, setTab] = useState<Tab>('pl')
  const [range, setRange] = useRangeState()
  const [asOf, setAsOf] = useState('')
  const useRange = ['pl', 'cf', 'cats', 'tax'].includes(tab)
  return (
    <div className="grid gap-4">
      <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0 print:hidden"><div className="w-max"><Chips value={tab} onChange={setTab} options={TABS} /></div></div>
      {useRange && <div className="print:hidden"><RangeBar value={range} onChange={setRange} /></div>}
      {(tab === 'bs' || tab === 'tb') && <div className="flex items-center gap-2 text-sm print:hidden"><span className="text-muted-foreground">تا تاریخ</span><Input dir="ltr" className="h-9 w-40" placeholder="خالی = امروز" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></div>}
      {tab === 'pl' && <PL range={range} />}
      {tab === 'bs' && <BS asOf={asOf} />}
      {tab === 'cf' && <CF range={range} />}
      {tab === 'tb' && <TB asOf={asOf} />}
      {tab === 'cats' && <Cats range={range} />}
      {tab === 'tax' && <Tax range={range} />}
      {tab === 'ledger' && <LedgerTab nav={nav} />}
    </div>
  )
}

function useReport(route: string, range: RangeValue | null, extra: Record<string, any> = {}) {
  return useFin<any>(route, { ...(range ? rangeParams(range) : {}), ...extra }, { enabled: range ? rangeReady(range) : true })
}

function PL({ range }: { range: RangeValue }) {
  const q = useReport('fin_pl', range)
  const r = q.data?.report
  if (!r) return <Loading />
  const g = r.groups
  const section = (title: string, key: string) => g[key].length > 0 && g[key].map((a: any) => <Row key={a.id} label={`${a.name}`} value={a.amount} indent />)
  const csv = () => download('profit-loss.csv', [['بخش', 'مبلغ'], ['فروش', r.totals.sales], ...g.sales.map((a: any) => ['  ' + a.name, a.amount]), ['بهای تمام‌شده', r.totals.cogs], ['سود ناخالص', r.gross_profit], ['هزینه‌های عملیاتی', r.totals.opex], ...g.opex.map((a: any) => ['  ' + a.name, a.amount]), ['سود عملیاتی', r.operating_profit], ['سایر درآمدها', r.totals.other_income], ['سایر هزینه‌ها', r.totals.other_expense], ['سود خالص', r.net_profit]])
  return (
    <div className="grid gap-3">
      <Toolbar onCsv={csv} />
      <Card title={`صورت سود و زیان · ${fmtDay(r.from || undefined)} تا ${fmtDay(r.to)}`}>
        <Row label="فروش خالص" value={r.totals.sales} bold />{section('', 'sales')}
        <Row label="− بهای تمام‌شده (خرید)" value={r.totals.cogs} />{section('', 'cogs')}
        <Row label={<>= سود ناخالص {r.gross_margin !== null && <span className="text-xs font-normal text-muted-foreground">({fmtNum(r.gross_margin)}٪)</span>}</>} value={r.gross_profit} bold tone />
        <Row label="− هزینه‌های عملیاتی" value={r.totals.opex} />{section('', 'opex')}
        <Row label="= سود عملیاتی" value={r.operating_profit} bold tone />
        <Row label="+ سایر درآمدها" value={r.totals.other_income} />{section('', 'other_income')}
        <Row label="− سایر هزینه‌ها (بهره و …)" value={r.totals.other_expense} />{section('', 'other_expense')}
        <Row label={<>= سود خالص {r.net_margin !== null && <span className="text-xs font-normal text-muted-foreground">({fmtNum(r.net_margin)}٪ فروش)</span>}</>} value={r.net_profit} bold tone />
      </Card>
    </div>
  )
}

function BS({ asOf }: { asOf: string }) {
  const q = useFin<any>('fin_bs', { as_of: asOf })
  const r = q.data?.report
  if (!r) return <Loading />
  const csv = () => download('balance-sheet.csv', [['بخش', 'حساب', 'مبلغ'], ...r.assets.map((a: any) => ['دارایی', a.name, a.amount]), ...r.liabilities.map((a: any) => ['بدهی', a.name, a.amount]), ...r.equity.map((a: any) => ['حقوق صاحبان سرمایه', a.name, a.amount]), ['حقوق صاحبان سرمایه', 'سود (زیان) دوره', r.current_earnings]])
  return (
    <div className="grid gap-3">
      <Toolbar onCsv={csv} />
      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="دارایی‌ها">{r.assets.map((a: any) => <Row key={a.id} label={a.name} value={a.amount} />)}<Row label="جمع دارایی‌ها" value={r.totals.assets} bold /></Card>
        <div className="grid content-start gap-3">
          <Card title="بدهی‌ها">{r.liabilities.length === 0 && <Row label="—" value={0} />}{r.liabilities.map((a: any) => <Row key={a.id} label={a.name} value={a.amount} />)}<Row label="جمع بدهی‌ها" value={r.totals.liabilities} bold /></Card>
          <Card title="حقوق صاحبان سرمایه">{r.equity.map((a: any) => <Row key={a.id} label={a.name} value={a.amount} />)}<Row label="سود (زیان) تا این تاریخ" value={r.current_earnings} tone /><Row label="جمع حقوق صاحبان سرمایه" value={r.totals.equity} bold /></Card>
        </div>
      </div>
      <div className={cn('rounded-xl border p-3 text-sm', r.balanced ? 'border-success/40 bg-success/5' : 'border-destructive/40 bg-destructive/5')}>
        دارایی‌ها ({fmtMoney(r.totals.assets)}) {r.balanced ? '=' : '≠'} بدهی‌ها + حقوق صاحبان سرمایه ({fmtMoney(r.totals.liabilities_and_equity)}) — {r.balanced ? 'ترازنامه متعادل است' : 'ترازنامه متعادل نیست!'}
      </div>
    </div>
  )
}

function CF({ range }: { range: RangeValue }) {
  const q = useReport('fin_cf', range)
  const r = q.data?.report
  if (!r) return <Loading />
  const names: Record<string, string> = { operating: 'فعالیت‌های عملیاتی', investing: 'فعالیت‌های سرمایه‌گذاری', financing: 'فعالیت‌های تأمین مالی' }
  const csv = () => download('cash-flow.csv', [['بخش', 'حساب', 'مبلغ'], ...Object.keys(names).flatMap((k) => r.sections[k].map((a: any) => [names[k], a.name, a.amount]))])
  return (
    <div className="grid gap-3">
      <Toolbar onCsv={csv} />
      <Card><Row label="موجودی ابتدای دوره" value={r.opening} bold /></Card>
      {Object.keys(names).map((k) => (
        <Card key={k} title={names[k]}>
          {r.sections[k].length === 0 && <Row label="—" value={0} />}
          {r.sections[k].map((a: any) => <Row key={a.code} label={a.name} value={a.amount} tone indent />)}
          <Row label={`خالص ${names[k]}`} value={r.totals[k]} bold tone />
        </Card>
      ))}
      <Card><Row label="تغییر خالص پول" value={r.net_change} bold tone /><Row label="موجودی پایان دوره" value={r.closing} bold /></Card>
      <p className={cn('text-xs', r.reconciled ? 'text-success' : 'text-destructive')}>{r.reconciled ? 'با موجودی حساب‌ها تطبیق دارد ✓' : 'با موجودی حساب‌ها نمی‌خواند!'}</p>
    </div>
  )
}

function TB({ asOf }: { asOf: string }) {
  const q = useFin<any>('fin_tb', { as_of: asOf })
  const r = q.data?.report
  if (!r) return <Loading />
  const csv = () => download('trial-balance.csv', [['کد', 'حساب', 'بدهکار', 'بستانکار'], ...r.rows.map((x: any) => [x.code, x.name, x.balance_debit, x.balance_credit])])
  return (
    <div className="grid gap-3">
      <Toolbar onCsv={csv} />
      <div className="overflow-x-auto rounded-xl border bg-card"><table className="w-full text-sm"><thead className="bg-muted/50 text-muted-foreground"><tr><th className="px-3 py-2 text-start">کد</th><th className="px-3 py-2 text-start">حساب</th><th className="px-3 py-2 text-end">بدهکار</th><th className="px-3 py-2 text-end">بستانکار</th></tr></thead>
        <tbody>{r.rows.map((x: any) => <tr key={x.id} className="border-t"><td className="px-3 py-2 tabular" dir="ltr">{x.code}</td><td className="px-3 py-2">{x.name}</td><td className="px-3 py-2 text-end tabular">{x.balance_debit ? fmtNum(x.balance_debit) : ''}</td><td className="px-3 py-2 text-end tabular">{x.balance_credit ? fmtNum(x.balance_credit) : ''}</td></tr>)}</tbody>
        <tfoot className="border-t bg-muted/50 font-semibold"><tr><td colSpan={2} className="px-3 py-2">جمع</td><td className="px-3 py-2 text-end tabular">{fmtNum(r.total_debit)}</td><td className="px-3 py-2 text-end tabular">{fmtNum(r.total_credit)}</td></tr></tfoot></table></div>
      <p className={cn('text-xs', r.balanced ? 'text-success' : 'text-destructive')}>{r.balanced ? 'جمع بدهکار = جمع بستانکار ✓' : 'تراز نیست!'}</p>
    </div>
  )
}

function Cats({ range }: { range: RangeValue }) {
  const q = useReport('fin_pl', range)
  const r = q.data?.report
  if (!r) return <Loading />
  const block = (title: string, rows: any[], total: number, tone: string) => (
    <Card title={title}>
      {rows.length === 0 ? <Row label="—" value={0} /> : [...rows].sort((a, b) => b.amount - a.amount).map((a) => (
        <div key={a.id} className="border-b px-3 py-2 text-sm last:border-0">
          <div className="flex justify-between gap-3"><span>{a.name}</span><span className="flex items-center gap-2"><span className="text-xs text-muted-foreground">{total ? fmtNum(Math.round((a.amount * 100) / total)) : 0}٪</span><Money value={a.amount} size="sm" /></span></div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn('h-full rounded-full', tone)} style={{ width: `${total ? Math.max(2, (a.amount * 100) / total) : 0}%` }} /></div>
        </div>
      ))}
      <Row label="جمع" value={total} bold />
    </Card>
  )
  const csv = () => download('by-category.csv', [['گروه', 'حساب', 'مبلغ'], ...(['sales', 'cogs', 'opex', 'other_income', 'other_expense'] as const).flatMap((k) => r.groups[k].map((a: any) => [k, a.name, a.amount]))])
  return (
    <div className="grid gap-3">
      <Toolbar onCsv={csv} />
      <div className="grid gap-3 lg:grid-cols-2">
        {block('فروش (پس از برگشتی‌ها)', r.groups.sales, r.totals.sales, 'bg-success')}
        {block('سایر درآمدها', r.groups.other_income, r.totals.other_income, 'bg-success/70')}
        {block('خرید و بهای تمام‌شده', r.groups.cogs, r.totals.cogs, 'bg-amber-500')}
        {block('هزینه‌ها', [...r.groups.opex, ...r.groups.other_expense], r.totals.opex + r.totals.other_expense, 'bg-destructive')}
      </div>
    </div>
  )
}

function Tax({ range }: { range: RangeValue }) {
  const accts = useFin<any>('fin_accounts')
  const led = (key: string) => accts.data?.accounts?.find((a: any) => a.system_key === key)
  const pay = led('tax_payable')
  const rec = led('tax_receivable')
  if (!accts.data) return <Loading />
  const net = (pay?.balance ?? 0) - (rec?.balance ?? 0)
  return (
    <div className="grid gap-3">
      <Card title="وضعیت مالیات (تا امروز)">
        <Row label="مالیات فروش دریافت‌شده از مشتریان (بدهی به دولت)" value={pay?.balance ?? 0} />
        <Row label="مالیات خرید پرداخت‌شده (قابل کسر)" value={rec?.balance ?? 0} />
        <Row label={net >= 0 ? 'خالص قابل پرداخت' : 'خالص قابل بازیافت'} value={Math.abs(net)} bold />
      </Card>
      <p className="text-xs text-muted-foreground">مالیات در درآمد و هزینه مخلوط نمی‌شود؛ جداگانه بدهی/دارایی نگه‌داری می‌شود. نرخ‌های مالیات را در تنظیمات مالی تعریف کنید. ({range.range})</p>
    </div>
  )
}

function LedgerTab({ nav }: { nav: Nav }) {
  const accts = useFin<any>('fin_accounts')
  const [sel, setSel] = useState<{ id: number; name: string } | null>(null)
  const [q, setQ] = useState('')
  const rows = useMemo(() => (accts.data?.accounts ?? []).filter((a: any) => Number(a.is_postable) === 1 && (!q || a.name.includes(q) || a.code.includes(q))), [accts.data, q])
  if (!accts.data) return <Loading />
  return (
    <div className="grid gap-3">
      <Input placeholder="جستجوی حساب…" value={q} onChange={(e) => setQ(e.target.value)} className="md:max-w-sm" />
      {rows.length === 0 ? <Empty title="حسابی پیدا نشد" /> : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-1.5 sm:grid-cols-2 xl:grid-cols-3">{rows.map((a: any) => <li key={a.id}><button onClick={() => setSel({ id: Number(a.id), name: `${a.code} · ${a.name}` })} className="flex w-full items-center justify-between gap-2 rounded-lg border bg-card p-3 text-start text-sm hover:bg-accent/40"><span className="min-w-0"><span className="block truncate">{a.name}</span><span className="text-xs text-muted-foreground" dir="ltr">{a.code}</span></span><Money value={a.balance} size="sm" /></button></li>)}</ul>
      )}
      <LedgerDialog account={sel} onClose={() => setSel(null)} onOpen={nav.entry} />
      <span className="sr-only"><Pager page={1} per={1} total={0} onPage={() => undefined} /></span>
    </div>
  )
}
