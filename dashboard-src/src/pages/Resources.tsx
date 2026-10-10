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

export function Users() {
  const { schema } = useSession()
  return <DataGrid resName="users" res={schema.users} filterCols={['agent', 'User_Status']} />
}

const RANGES: [string, string][] = [['', 'همه‌ی زمان‌ها'], ['today', 'امروز'], ['yesterday', 'دیروز'], ['7d', '۷ روز اخیر'], ['30d', '۳۰ روز اخیر'], ['month', 'ماه فعلی'], ['lastmonth', 'ماه قبل']]
interface OrdersSummary { sum: number; groups: Record<string, { count: number; sum: number }> }
const CHIP_TONE: Record<string, string> = { active: 'data-[on=true]:bg-success/15 data-[on=true]:text-success', onhold: 'data-[on=true]:bg-warning/15 data-[on=true]:text-warning', expired: 'data-[on=true]:bg-destructive/15 data-[on=true]:text-destructive', unpaid: 'data-[on=true]:bg-destructive/15 data-[on=true]:text-destructive' }

export function Orders() {
  const { schema } = useSession()
  const res = schema.orders
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
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
