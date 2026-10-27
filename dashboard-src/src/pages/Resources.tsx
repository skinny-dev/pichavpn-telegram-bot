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
  return <DataGrid resName="users" res={schema.users} filterCols={['agent', 'User_Status']} onOpen={(r) => openUser(String(r.id))} card={card} />
}

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
      <div className="grid grid-cols-2 gap-2 md:gap-3 lg:grid-cols-4 [&>div]:p-2.5 md:[&>div]:p-3 [&_.text-xl]:text-base md:[&_.text-xl]:text-xl">
        <div className="rounded-xl border bg-card p-3"><div className="text-xs text-muted-foreground">سفارش‌های این انتخاب</div><div className="mt-1 text-xl font-bold tabular">{sum ? fmtNum(group ? sum.groups[group]?.count ?? 0 : totalCount) : '—'}</div></div>
        <div className="rounded-xl border bg-card p-3"><div className="text-xs text-muted-foreground">جمع مبلغ</div><div className="mt-1 text-xl font-bold tabular">{sum ? fmtToman(sum.sum) : '—'}</div></div>
        <div className="rounded-xl border bg-card p-3"><div className="text-xs text-muted-foreground">سرویس‌های فعال</div><div className="mt-1 text-xl font-bold tabular text-success">{sum ? fmtNum((sum.groups.active?.count ?? 0) + (sum.groups.onhold?.count ?? 0)) : '—'}</div></div>
        <div className="rounded-xl border bg-card p-3"><div className="text-xs text-muted-foreground">منقضی‌شده</div><div className="mt-1 text-xl font-bold tabular text-destructive">{sum ? fmtNum(sum.groups.expired?.count ?? 0) : '—'}</div></div>
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
        toolbar={<>
          <ManualOrder />
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
