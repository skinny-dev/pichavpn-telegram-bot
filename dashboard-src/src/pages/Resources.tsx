import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ManualPayment } from '@/components/ManualPayment'
import { ManualOrder } from '@/components/ManualOrder'
import { DataGrid } from '@/components/DataGrid'
import { TreeView } from '@/components/TreeView'
import { useState } from 'react'
import { useSession } from '@/lib/session'
import { fmtNum, fmtToman } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { useManage } from '@/components/manage'
import type { Row } from '@/lib/api'
import { fmtTs } from '@/lib/format'

const AGENT: Record<string, string> = { f: 'کاربر', n: 'نماینده', n2: 'نماینده پیشرفته' }
/** a round monogram: the same colour for the same name */
const HUES = [215, 150, 30, 340, 265, 190, 95, 15]
function Avatar({ name, size = 'size-7' }: { name: string; size?: string }) {
  const h = HUES[[...name].reduce((a, ch) => a + ch.charCodeAt(0), 0) % HUES.length]
  return <span className={cn('grid shrink-0 place-items-center rounded-full text-xs font-semibold text-white', size)} style={{ background: `hsl(${h} 45% 48%)` }}>{name.replace('@', '').slice(0, 1).toUpperCase() || '?'}</span>
}
/** dots filled in proportion, like the segment cards of a CRM table */
function DotMeter({ part, whole, tone }: { part: number; whole: number; tone: string }) {
  const n = 18, on = whole > 0 ? Math.round((part / whole) * n) : 0
  return <span className="flex flex-1 items-center gap-[3px]" aria-hidden>{Array.from({ length: n }, (_, i) => <span key={i} className={cn('size-1.5 rounded-full', i < on ? tone : 'bg-muted')} />)}</span>
}
const clean = (v: unknown) => (v === null || v === undefined || v === '' || v === 'none' || v === 'NOT_USERNAME' ? '' : String(v))

export function Users() {
  const { schema } = useSession()
  const { openUser } = useManage()
  const card = (r: Row) => {
    const name = clean(r.namecustom) || (clean(r.username) ? '@' + r.username : String(r.id))
    return (
      <div className="flex items-center gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 font-bold text-primary">{name.replace('@', '').slice(0, 1).toUpperCase()}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5"><span className="truncate font-medium">{name}</span>{r.User_Status === 'block' && <Badge variant="destructive">مسدود</Badge>}{r.agent !== 'f' && <Badge variant="secondary">{AGENT[String(r.agent)] ?? r.agent}</Badge>}</div>
          <div className="truncate text-xs text-muted-foreground" dir="ltr">{clean(r.username) && clean(r.namecustom) ? '@' + r.username + ' · ' : ''}{r.id}</div>
        </div>
        <div className="shrink-0 text-end"><div className="text-sm font-medium tabular">{fmtNum(r.Balance)}</div><div className="text-[11px] text-muted-foreground">موجودی</div></div>
      </div>
    )
  }
  const renderers = {
    id: (r: Row) => { const name = clean(r.namecustom) || (clean(r.username) ? '@' + r.username : String(r.id)); return <span className="flex items-center gap-2.5"><Avatar name={name} /><span className="grid leading-tight"><span className="truncate font-medium">{name}</span><span className="text-xs text-muted-foreground" dir="ltr">{r.id}</span></span></span> },
    Balance: (r: Row) => <span className="tabular font-medium" dir="ltr">{fmtNum(r.Balance)}</span>,
  }
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2"><div><p className="text-sm text-muted-foreground">همه‌ی کسانی که ربات را استارت کرده‌اند</p></div></div>
      <DataGrid rich resName="users" res={schema.users} filterCols={['agent', 'User_Status']} onOpen={(r) => openUser(String(r.id))} card={card} renderers={renderers} />
    </div>
  )
}

const SEGMENTS: [string, string, 'success' | 'warning' | 'destructive', string][] = [['active', 'فعال', 'success', 'bg-success'], ['onhold', 'در انتظار اتصال', 'warning', 'bg-warning'], ['expired', 'منقضی‌شده', 'destructive', 'bg-destructive']]
const RANGES: [string, string][] = [['', 'همه‌ی زمان‌ها'], ['today', 'امروز'], ['yesterday', 'دیروز'], ['7d', '۷ روز اخیر'], ['30d', '۳۰ روز اخیر'], ['month', 'ماه فعلی'], ['lastmonth', 'ماه قبل']]
interface OrdersSummary { sum: number; groups: Record<string, { count: number; sum: number }> }
const CHIP_TONE: Record<string, string> = { active: 'data-[on=true]:bg-success/15 data-[on=true]:text-success', onhold: 'data-[on=true]:bg-warning/15 data-[on=true]:text-warning', expired: 'data-[on=true]:bg-destructive/15 data-[on=true]:text-destructive', unpaid: 'data-[on=true]:bg-destructive/15 data-[on=true]:text-destructive' }

export function Orders() {
  const { schema } = useSession()
  const { openOrder } = useManage()
  const res = schema.orders
  const statusCol = res.cols.find((c) => c.key === 'Status')
  const card = (r: Row) => (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-2">
        <span className="truncate font-medium tabular" dir="ltr">{r.username}</span>
        <Badge variant={(statusCol?.tones?.[String(r.Status)] ?? 'secondary') as any}>{statusCol?.options?.[String(r.Status)] ?? r.Status}</Badge>
        <span className="ms-auto shrink-0 text-sm font-medium tabular">{fmtNum(r.price_product)}</span>
      </div>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="truncate">{r.name_product} · {clean(r.u_name) || r.id_user}</span>
        <span className="shrink-0" dir="ltr">{fmtTs(r.time_sell, true)}</span>
      </div>
    </div>
  )
  const renderers = {
    id_invoice: (r: Row) => <span className="flex items-center gap-2.5"><Avatar name={String(r.username)} /><span className="grid leading-tight"><span className="font-medium tabular" dir="ltr">{r.username}</span><span className="text-xs text-muted-foreground" dir="ltr">{r.id_invoice}</span></span></span>,
    u_name: (r: Row) => <span className="flex items-center gap-2"><Avatar name={clean(r.u_name) || String(r.id_user)} size="size-6" /><span>{clean(r.u_name) || r.id_user}</span></span>,
    price_product: (r: Row) => <span className="tabular font-medium" dir="ltr">{fmtNum(r.price_product)}</span>,
  }
  const [group, setGroup] = useState('')
  const [range, setRange] = useState('')
  const [sum, setSum] = useState<OrdersSummary | null>(null)
  const groups = res.cols.find((c) => c.key === 'sgrp')?.options ?? {}
  const totalCount = sum ? Object.values(sum.groups).reduce((a, g) => a + g.count, 0) : 0
  const chip = (key: string, label: string, count?: number) => (
    <button
      key={key}
      data-on={group === key}
      onClick={() => setGroup(key)}
      className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-sm transition-colors hover:bg-accent data-[on=true]:border-primary data-[on=true]:bg-primary/10 data-[on=true]:font-medium', CHIP_TONE[key])}
    >
      {label}{count !== undefined && <span className="tabular text-xs opacity-70">{fmtNum(count)}</span>}
    </button>
  )
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div><p className="text-sm text-muted-foreground">{sum ? `${fmtNum(totalCount)} سفارش · جمع ${fmtToman(sum.sum)}` : 'در حال بارگذاری…'}</p></div>
        <ManualOrder />
      </div>
      <div className="grid gap-2 md:grid-cols-3 md:gap-3">
        {SEGMENTS.map(([key, label, variant, tone]) => {
          const g = sum?.groups[key]
          const on = group === key
          return (
            <button key={key} onClick={() => setGroup(on ? '' : key)} data-on={on} className="grid gap-2 rounded-xl border bg-card p-3 text-start transition-colors hover:bg-accent/40 data-[on=true]:border-primary data-[on=true]:bg-primary/5">
              <span className="flex items-center justify-between gap-2"><Badge variant={variant} className="gap-1.5"><span className="size-1.5 rounded-full bg-current" />{label}</Badge><span className="text-xs text-muted-foreground tabular">{g ? fmtToman(g.sum) : ''}</span></span>
              <span className="flex items-center gap-3"><span className="text-2xl font-bold tabular">{sum ? fmtNum(g?.count ?? 0) : '—'}</span><DotMeter part={g?.count ?? 0} whole={totalCount} tone={tone} /><span className="text-xs text-muted-foreground tabular">{totalCount && g ? Math.round((g.count / totalCount) * 100) : 0}٪</span></span>
            </button>
          )
        })}
      </div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0" role="group" aria-label="دسته‌بندی وضعیت">
        {chip('', 'همه', sum ? totalCount : undefined)}
        {Object.entries(groups).filter(([k]) => (sum?.groups[k]?.count ?? 0) > 0 || group === k).map(([k, l]) => chip(k, l, sum?.groups[k]?.count ?? 0))}
      </div>
      <DataGrid
        resName="orders"
        res={res}
        hide={['sgrp', 'id_user']}
        filterCols={['otype', 'cat', 'agent', 'Service_location', 'Status']}
        forced={{ sgrp: group }}
        extra={{ range }}
        onSummary={setSum}
        onOpen={(r) => openOrder(String(r.id_invoice))}
        card={card}
        rich
        defaultHidden={['username', 'cat', 'otype', 'agent', 'note']}
        renderers={renderers}
        toolbar={<>
          <Select value={range || 'all'} onValueChange={(v) => setRange(v === 'all' ? '' : v)}>
            <SelectTrigger className="w-auto min-w-[8rem]" aria-label="بازه زمانی"><SelectValue /></SelectTrigger>
            <SelectContent>{RANGES.map(([k, l]) => <SelectItem key={k || 'all'} value={k || 'all'}>{l}</SelectItem>)}</SelectContent>
          </Select>
        </>}
      />
    </div>
  )
}

export function Products() {
  const { schema } = useSession()
  return (
    <Tabs defaultValue="tree">
      <TabsList><TabsTrigger value="tree">نمای درختی</TabsTrigger><TabsTrigger value="table">جدول محصولات</TabsTrigger><TabsTrigger value="cats">دسته‌بندی‌ها</TabsTrigger></TabsList>
      <TabsContent value="tree"><TreeView schema={schema} /></TabsContent>
      <TabsContent value="table"><DataGrid resName="products" res={schema.products} filterCols={['agent']} /></TabsContent>
      <TabsContent value="cats"><DataGrid resName="categories" res={schema.categories} /></TabsContent>
    </Tabs>
  )
}

export function Accounting() {
  const { schema } = useSession()
  return (
    <Tabs defaultValue="expenses">
      <TabsList><TabsTrigger value="expenses">هزینه‌ها</TabsTrigger><TabsTrigger value="capital">ورود سرمایه</TabsTrigger><TabsTrigger value="payments">پرداخت‌ها</TabsTrigger></TabsList>
      <TabsContent value="expenses"><DataGrid resName="expenses" res={schema.expenses} /></TabsContent>
      <TabsContent value="capital"><DataGrid resName="capital" res={schema.capital} /></TabsContent>
      <TabsContent value="payments"><DataGrid resName="payments" res={schema.payments} toolbar={<ManualPayment />} /></TabsContent>
    </Tabs>
  )
}
