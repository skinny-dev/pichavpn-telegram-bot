import { useEffect, useState } from 'react'
import { Building2, Calculator, HandCoins, Landmark, Pencil, Plus, Search, Trash2, UserPlus, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { fmtCompact, fmtNum } from '@/lib/format'
import { useDebounced } from '@/lib/hooks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AccountSelect, AmountInput, Chips, DateInput, Empty, Field, Loading, Money, Pager, PartyPicker, ResponsiveList, Section, Stat, StateBadge, can, fmtDay, fmtMoney, useFin, useMeta, usePost, type Col } from './shared'
import { PartyForm } from './forms'
import type { Nav } from './pages'

// ------------------------------------------------------------------ receivables / payables

export function AgingPage({ kind, nav }: { kind: 'sale' | 'purchase'; nav: Nav }) {
  const recv = kind === 'sale'
  const meta = useMeta()
  const q = useFin<any>('fin_aging', { kind })
  const [view, setView] = useState<'parties' | 'docs'>('parties')
  const [profile, setProfile] = useState<number | null>(null)
  if (!q.data) return <Loading />
  const s = q.data.summary
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label={recv ? 'کل طلب‌ها' : 'کل بدهی‌ها'} value={<Money value={s.total} size="lg" />} />
        <Stat label="سررسید گذشته" value={<Money value={s.overdue} size="lg" />} tone={s.overdue ? 'danger' : undefined} />
        <Stat label="سررسید امروز" value={<Money value={s.due_today} size="lg" />} tone={s.due_today ? 'warn' : undefined} />
        <Stat label="۷ روز آینده" value={<Money value={s.due_soon} size="lg" />} />
        <Stat label={recv ? 'وصول‌شده' : 'پرداخت‌شده'} value={<Money value={s.collected} size="lg" />} tone="success" />
      </div>
      <Chips value={view} onChange={setView} options={[['parties', recv ? 'به تفکیک مشتری' : 'به تفکیک تأمین‌کننده'], ['docs', 'فاکتورهای باز']]} />
      {view === 'parties' ? (
        <ResponsiveList
          rows={q.data.parties} rowKey={(r: any) => r.party_id} onOpen={(r: any) => setProfile(r.party_id)}
          empty={<Empty title={recv ? 'طلب بازی ندارید' : 'بدهی بازی ندارید'} hint={recv ? 'وقتی فروش نسیه ثبت کنید، مانده‌ی هر مشتری اینجا دیده می‌شود.' : 'خرید نسیه‌ی ثبت‌شده اینجا دیده می‌شود.'} action={<Button onClick={() => nav.action(recv ? 'sale' : 'purchase')}><Plus />{recv ? 'ثبت فروش' : 'ثبت خرید'}</Button>} />}
          cols={[
            { key: 'n', label: recv ? 'مشتری' : 'تأمین‌کننده', render: (r: any) => <b>{r.name}</b> },
            { key: 't', label: 'کل', render: (r: any) => <Money value={r.total} size="sm" /> },
            { key: 'p', label: 'پرداخت‌شده', render: (r: any) => <Money value={r.paid} size="sm" /> },
            { key: 'r', label: 'مانده', render: (r: any) => <Money value={r.remaining} size="sm" className="text-destructive" /> },
            { key: 'o', label: 'معوق', render: (r: any) => (r.overdue ? <Money value={r.overdue} size="sm" className="text-destructive" /> : '—') },
            { key: 'd', label: 'سررسید بعدی', render: (r: any) => fmtDay(r.next_due) },
            { key: 'l', label: 'آخرین پرداخت', render: (r: any) => fmtDay(r.last_payment) },
          ] as Col<any>[]}
          card={(r: any) => (
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between gap-2"><b className="truncate">{r.name}</b><Money value={r.remaining} className="text-destructive" /></div>
              <div className="flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground"><span>کل {fmtCompact(r.total)} · پرداخت {fmtCompact(r.paid)}</span>{r.overdue > 0 && <span className="text-destructive">معوق {fmtCompact(r.overdue)}</span>}</div>
              <div className="flex justify-between text-xs text-muted-foreground"><span>سررسید بعدی: {fmtDay(r.next_due)}</span><span>آخرین پرداخت: {fmtDay(r.last_payment)}</span></div>
            </div>
          )}
        />
      ) : (
        <ResponsiveList
          rows={q.data.docs} rowKey={(r: any) => r.id} onOpen={(r: any) => nav.entry({ txn: r.id })}
          empty={<Empty title="فاکتور بازی نیست" />}
          cols={[
            { key: 'ref', label: 'سند', render: (r: any) => <b dir="ltr">{r.ref}</b> },
            { key: 'p', label: 'طرف حساب', render: (r: any) => r.party_name },
            { key: 'd', label: 'تاریخ', render: (r: any) => fmtDay(r.date) },
            { key: 'due', label: 'سررسید', render: (r: any) => fmtDay(r.due_date) },
            { key: 't', label: 'مبلغ', render: (r: any) => <Money value={r.total} size="sm" /> },
            { key: 'o', label: 'مانده', render: (r: any) => <Money value={r.outstanding} size="sm" /> },
            { key: 's', label: 'وضعیت', render: (r: any) => <StateBadge state={r.state} /> },
          ] as Col<any>[]}
          card={(r: any) => (
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between gap-2"><b className="truncate">{r.party_name}</b><StateBadge state={r.state} /></div>
              <div className="flex items-center justify-between text-xs text-muted-foreground"><span dir="ltr">{r.ref} · {fmtDay(r.date)}</span><span>سررسید {fmtDay(r.due_date)}</span></div>
              <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">از {fmtCompact(r.total)}</span><Money value={r.outstanding} /></div>
            </div>
          )}
        />
      )}
      <PartyDialog id={profile} onClose={() => setProfile(null)} nav={nav} />
      <span className="sr-only">{can(meta, 'view') ? '' : ''}</span>
    </div>
  )
}

// ------------------------------------------------------------------ parties

export function PartiesPage({ nav }: { nav: Nav }) {
  const meta = useMeta()
  const [q, setQ] = useState('')
  const [role, setRole] = useState('')
  const [page, setPage] = useState(1)
  const dq = useDebounced(q, 250)
  useEffect(() => setPage(1), [dq, role])
  const list = useFin<any>('fin_parties', { q: dq, role, page, per: 40 })
  const [open, setOpen] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1 md:max-w-sm"><Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="ps-9" placeholder="نام، شماره، آیدی تلگرام…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 md:mx-0 md:px-0">{[['', 'همه'], ...Object.entries(meta?.roles ?? {})].map(([k, l]) => <button key={k} data-on={role === k} onClick={() => setRole(k)} className="whitespace-nowrap rounded-full border px-3 py-1 text-sm hover:bg-accent data-[on=true]:border-primary data-[on=true]:bg-primary/10">{l}</button>)}</div>
        {can(meta, 'payment.manage') && <Button className="ms-auto" onClick={() => setCreating(true)}><UserPlus />طرف حساب جدید</Button>}
      </div>
      {!list.data ? <Loading /> : (
        <>
          <ResponsiveList
            rows={list.data.rows} rowKey={(r: any) => r.id} onOpen={(r: any) => setOpen(Number(r.id))}
            empty={<Empty title="طرف حسابی پیدا نشد" hint="مشتری‌ها، تأمین‌کننده‌ها و شرکا اینجا یک‌جا نگهداری می‌شوند؛ یک نفر می‌تواند چند نقش داشته باشد." action={<Button onClick={() => setCreating(true)}><UserPlus />طرف حساب جدید</Button>} />}
            cols={[
              { key: 'n', label: 'نام', render: (r: any) => <b>{r.name}</b> },
              { key: 'r', label: 'نقش‌ها', render: (r: any) => <span className="flex flex-wrap gap-1">{String(r.roles).split(',').filter(Boolean).map((x) => <Badge key={x} variant="secondary">{meta?.roles[x] ?? x}</Badge>)}</span> },
              { key: 'ph', label: 'تماس', render: (r: any) => <span dir="ltr">{r.phone || '—'}</span> },
              { key: 'rec', label: 'طلب ما', render: (r: any) => (Number(r.receivable) ? <Money value={r.receivable} size="sm" className="text-success" /> : '—') },
              { key: 'pay', label: 'بدهی ما', render: (r: any) => (Number(r.payable) ? <Money value={r.payable} size="sm" className="text-destructive" /> : '—') },
            ] as Col<any>[]}
            card={(r: any) => (
              <div className="grid gap-1">
                <div className="flex items-center justify-between gap-2"><b className="truncate">{r.name}</b><span className="flex gap-1">{String(r.roles).split(',').filter(Boolean).slice(0, 2).map((x) => <Badge key={x} variant="secondary">{meta?.roles[x] ?? x}</Badge>)}</span></div>
                <div className="flex justify-between text-xs"><span className="text-muted-foreground" dir="ltr">{r.phone || ''}</span><span>{Number(r.receivable) > 0 && <span className="text-success">طلب {fmtCompact(r.receivable)} </span>}{Number(r.payable) > 0 && <span className="text-destructive">بدهی {fmtCompact(r.payable)}</span>}</span></div>
              </div>
            )}
          />
          <Pager page={list.data.page} per={list.data.per} total={list.data.total} onPage={setPage} />
        </>
      )}
      <PartyDialog id={open} onClose={() => setOpen(null)} nav={nav} />
      <Dialog open={creating} onOpenChange={setCreating}><DialogContent><DialogHeader><DialogTitle>طرف حساب جدید</DialogTitle></DialogHeader><PartyForm onClose={() => setCreating(false)} /></DialogContent></Dialog>
    </div>
  )
}

export function PartyDialog({ id, onClose, nav }: { id: number | null; onClose: () => void; nav: Nav }) {
  const meta = useMeta()
  const q = useFin<any>('fin_party', { id }, { enabled: !!id })
  const [edit, setEdit] = useState(false)
  const remind = usePost('fin_remind', undefined, 'یادآوری در تلگرام ارسال شد')
  const d = q.data
  return (
    <Dialog open={!!id} onOpenChange={(o) => { if (!o) { setEdit(false); onClose() } }}>
      <DialogContent className="md:max-w-2xl">
        {!d ? <Loading rows={3} /> : edit ? (
          <><DialogHeader><DialogTitle>ویرایش {d.party.name}</DialogTitle></DialogHeader><PartyForm onClose={() => setEdit(false)} initial={{ id: d.party.id, name: d.party.name, roles: d.party.roles_list, phone: d.party.phone ?? '', tg_user_id: d.party.tg_user_id ?? '', note: d.party.note ?? '' }} /></>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">{d.party.name}<Button variant="ghost" size="icon-sm" onClick={() => setEdit(true)} aria-label="ویرایش"><Pencil /></Button></DialogTitle>
              <DialogDescription className="flex flex-wrap gap-1">{d.party.roles_list.map((r: string) => <Badge key={r} variant="secondary">{meta?.roles[r] ?? r}</Badge>)}{d.party.phone && <span dir="ltr" className="ms-2">{d.party.phone}</span>}</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="طلب ما از او" value={<Money value={d.receivable.remaining} size="lg" />} hint={`${fmtNum(d.receivable.count)} فاکتور · کل ${fmtCompact(d.receivable.total)}`} tone={d.receivable.remaining ? 'success' : undefined} />
              <Stat label="بدهی ما به او" value={<Money value={d.payable.remaining} size="lg" />} hint={`${fmtNum(d.payable.count)} فاکتور · کل ${fmtCompact(d.payable.total)}`} tone={d.payable.remaining ? 'danger' : undefined} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 p-3 text-sm"><span>تراز نهایی</span><Money value={d.net_balance} sign /></div>
            {d.ownership !== null && <p className="text-sm">سهم مالکیت فعلی: <b>{fmtNum(d.ownership)}٪</b></p>}
            {d.party.note && <p className="rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">{d.party.note}</p>}
            <div className="flex flex-wrap gap-2">
              {can(meta, 'sale.create') && <Button onClick={() => { onClose(); nav.action('sale', { party: { id: d.party.id, name: d.party.name } }) }}>فروش</Button>}
              {d.receivable.remaining > 0 && can(meta, 'payment.manage') && <Button variant="outline" onClick={() => { onClose(); nav.action('receipt', { party: { id: d.party.id, name: d.party.name }, amount: d.receivable.remaining }) }}><HandCoins />دریافت</Button>}
              {d.receivable.remaining > 0 && d.party.tg_user_id && can(meta, 'payment.manage') && <Button variant="outline" disabled={remind.isPending} onClick={() => remind.mutate({ party_id: d.party.id })}>یادآوری در تلگرام</Button>}
              {d.payable.remaining > 0 && can(meta, 'payment.manage') && <Button variant="outline" onClick={() => { onClose(); nav.action('payment', { party: { id: d.party.id, name: d.party.name }, amount: d.payable.remaining }) }}><Wallet />پرداخت</Button>}
            </div>
            <Section title="تراکنش‌ها">
              {d.transactions.length === 0 ? <Empty title="هنوز تراکنشی با او ثبت نشده" /> : (
                <ul className="grid grid-cols-[minmax(0,1fr)] gap-1.5">{d.transactions.map((t: any) => <li key={t.id}><button className="flex w-full items-center justify-between gap-2 rounded-lg border p-2.5 text-start text-sm hover:bg-accent/40" onClick={() => { onClose(); nav.entry({ txn: t.id }) }}><span className="min-w-0"><span className="block" dir="ltr">{t.ref ?? t.type} {t.status === 'reversed' ? '· ابطال' : ''}</span><span className="block truncate text-xs text-muted-foreground">{fmtDay(t.txn_date)}{t.memo ? ` · ${t.memo}` : ''}</span></span><Money value={t.total} size="sm" /></button></li>)}</ul>
              )}
            </Section>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ------------------------------------------------------------------ partners & capital

export function PartnersPage({ nav }: { nav: Nav }) {
  const q = useFin<any>('fin_partners')
  const meta = useMeta()
  const [setup, setSetup] = useState(false)
  const [dist, setDist] = useState(false)
  if (!q.data) return <Loading />
  const d = q.data
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => nav.action('capital', { direction: 'in' })}><Landmark />ورود سرمایه</Button>
        <Button variant="outline" onClick={() => nav.action('capital', { direction: 'out' })}>برداشت</Button>
        <Button variant="outline" onClick={() => setDist(true)}><Calculator />تقسیم سود</Button>
        <Button variant="outline" onClick={() => setSetup(true)}><Building2 />تغییر درصد مالکیت</Button>
      </div>
      {d.partners.length === 0 ? <Empty title="هنوز شریکی ثبت نشده" hint="درصد مالکیت شرکا را ثبت کنید تا تقسیم سود خودکار و تاریخچه‌ی تغییر مالکیت داشته باشید." action={<Button onClick={() => setSetup(true)}>ثبت مالکیت</Button>} /> : (
        <ResponsiveList
          rows={d.partners} rowKey={(r: any) => r.party_id}
          cols={[
            { key: 'n', label: 'شریک', render: (r: any) => <b>{r.name}</b> },
            { key: 'p', label: 'سهم فعلی', render: (r: any) => <b>{fmtNum(r.percent)}٪</b> },
            { key: 'i', label: 'سرمایه‌ی واردشده', render: (r: any) => <Money value={r.invested} size="sm" /> },
            { key: 'w', label: 'برداشت‌ها', render: (r: any) => <Money value={r.withdrawn} size="sm" /> },
            { key: 's', label: 'سود دریافتی', render: (r: any) => <Money value={r.profit_share} size="sm" /> },
          ] as Col<any>[]}
          card={(r: any) => (
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between"><b>{r.name}</b><span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-sm font-bold text-primary">{fmtNum(r.percent)}٪</span></div>
              <div className="grid grid-cols-3 gap-2 text-xs"><span>سرمایه<br /><b className="tabular">{fmtCompact(r.invested)}</b></span><span>برداشت<br /><b className="tabular">{fmtCompact(r.withdrawn)}</b></span><span>سود دریافتی<br /><b className="tabular">{fmtCompact(r.profit_share)}</b></span></div>
            </div>
          )}
        />
      )}
      {d.history.length > 0 && (
        <Section title="تاریخچه‌ی مالکیت (هیچ‌وقت بازنویسی نمی‌شود)">
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-1 text-sm">{d.history.map((h: any) => <li key={h.id} className="flex justify-between gap-2 border-b py-1.5 last:border-0"><span>{fmtDay(h.effective_from)} · {h.name}{h.note ? ` · ${h.note}` : ''}</span><b>{fmtNum(h.percent)}٪</b></li>)}</ul>
        </Section>
      )}
      <OwnershipDialog open={setup} onClose={() => setSetup(false)} current={d.partners} />
      <DistributeDialog open={dist} onClose={() => setDist(false)} />
      <span className="sr-only">{can(meta, 'capital.manage') ? '' : ''}</span>
    </div>
  )
}

function OwnershipDialog({ open, onClose, current }: { open: boolean; onClose: () => void; current: any[] }) {
  type OwnRow = { party: { id: number; name: string } | null; percent: string }
  const [rows, setRows] = useState<OwnRow[]>([])
  const [date, setDate] = useState('')
  const [note, setNote] = useState('')
  useEffect(() => { if (open) { const own: OwnRow[] = current.filter((c) => c.percent > 0).map((c) => ({ party: { id: c.party_id, name: c.name }, percent: String(c.percent) })); setRows(own.length ? own : [{ party: null, percent: '' }]) } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const total = rows.reduce((a, r) => a + (parseFloat(r.percent) || 0), 0)
  const post = usePost('fin_ownership', onClose, 'مالکیت ثبت شد (تاریخچه حفظ شد)')
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>درصد مالکیت</DialogTitle><DialogDescription>از تاریخ انتخابی اعمال می‌شود؛ وضعیت‌های قبلی در تاریخچه می‌مانند.</DialogDescription></DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (Math.abs(total - 100) > 0.001) return toast.error('جمع درصدها باید ۱۰۰ باشد'); post.mutate({ shares: rows.filter((r) => r.party).map((r) => ({ party_id: r.party!.id, percent: r.percent })), date, note }) }}>
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_5.5rem_auto] items-center gap-2">
              <PartyPicker value={r.party} onChange={(p) => setRows(rows.map((x, j) => (j === i ? { ...x, party: p } : x)))} role="partner" defaultRole="partner" placeholder="شریک" />
              <Input dir="ltr" inputMode="decimal" placeholder="٪" value={r.percent} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, percent: e.target.value.replace(/[^\d.]/g, '') } : x)))} />
              <Button type="button" variant="ghost" size="icon" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="حذف"><Trash2 /></Button>
            </div>
          ))}
          <Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={() => setRows([...rows, { party: null, percent: '' }])}><Plus />شریک جدید</Button>
          <div className={`text-sm ${Math.abs(total - 100) > 0.001 ? 'text-destructive' : 'text-success'}`}>جمع: {fmtNum(total)}٪</div>
          <DateInput label="اعمال از تاریخ" value={date} onChange={setDate} />
          <Field label="یادداشت"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلاً ورود شریک جدید" /></Field>
          <DialogFooter><Button type="submit" disabled={post.isPending}>ثبت</Button><Button type="button" variant="outline" onClick={onClose}>انصراف</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DistributeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const meta = useMeta()
  const [amount, setAmount] = useState('')
  const [account, setAccount] = useState('')
  const [date, setDate] = useState('')
  const [memo, setMemo] = useState('')
  const post = usePost('fin_distribute', onClose, 'سود تقسیم شد')
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>تقسیم سود بین شرکا</DialogTitle><DialogDescription>طبق درصد مالکیتِ همان تاریخ بین شرکا تقسیم می‌شود. هزینه حساب نمی‌شود.</DialogDescription></DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (!amount) return toast.error('مبلغ را وارد کنید'); post.mutate({ amount, money_account: account || meta?.money_accounts[0]?.id, date, memo }) }}>
          <Field label="مبلغ کل"><AmountInput value={amount} onChange={setAmount} autoFocus /></Field>
          <Field label="پرداخت از حساب"><AccountSelect value={account} onChange={setAccount} accounts={meta?.money_accounts} /></Field>
          <DateInput value={date} onChange={setDate} />
          <Field label="توضیحات"><Input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="مثلاً سود فصل پاییز" /></Field>
          <DialogFooter><Button type="submit" disabled={post.isPending}>ثبت تقسیم سود</Button><Button type="button" variant="outline" onClick={onClose}>انصراف</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ------------------------------------------------------------------ loans & assets

export function AssetsPage() {
  const loans = useFin<any>('fin_loans')
  const assets = useFin<any>('fin_assets')
  const meta = useMeta()
  const [loanOpen, setLoanOpen] = useState(false)
  const [payLoan, setPayLoan] = useState<any>(null)
  const [assetOpen, setAssetOpen] = useState(false)
  const dep = usePost('fin_depreciate', (r) => toast.info(r.posted ? `${fmtNum(r.posted)} سند استهلاک ثبت شد` : 'استهلاک جدیدی برای ثبت نبود'), 'انجام شد')
  return (
    <div className="grid gap-6">
      <Section title="وام‌ها" action={<Button size="sm" onClick={() => setLoanOpen(true)}><Plus />وام جدید</Button>}>
        {!loans.data ? <Loading rows={2} /> : loans.data.loans.length === 0 ? <Empty title="وامی ثبت نشده" hint="وام دریافتی بدهی است و وام پرداختی طلب؛ هیچ‌کدام درآمد یا هزینه حساب نمی‌شوند. فقط سود قسط‌ها هزینه (یا درآمد) است." /> : (
          <ResponsiveList rows={loans.data.loans} rowKey={(r: any) => r.id} onOpen={(r: any) => r.status === 'active' && setPayLoan(r)}
            cols={[
              { key: 'p', label: 'طرف حساب', render: (r: any) => <b>{r.party_name}</b> },
              { key: 'd', label: 'نوع', render: (r: any) => (r.direction === 'borrowed' ? 'دریافتی (بدهی)' : 'پرداختی (طلب)') },
              { key: 'a', label: 'اصل وام', render: (r: any) => <Money value={r.principal} size="sm" /> },
              { key: 'pd', label: 'اصل پرداخت‌شده', render: (r: any) => <Money value={r.paid_principal} size="sm" /> },
              { key: 'r', label: 'مانده', render: (r: any) => <Money value={r.remaining} size="sm" /> },
              { key: 's', label: 'وضعیت', render: (r: any) => (r.status === 'active' ? <Badge variant="warning">جاری</Badge> : <Badge variant="success">تسویه</Badge>) },
            ] as Col<any>[]}
            card={(r: any) => <div className="grid gap-1"><div className="flex justify-between"><b>{r.party_name}</b><Money value={r.remaining} /></div><div className="text-xs text-muted-foreground">{r.direction === 'borrowed' ? 'دریافتی' : 'پرداختی'} · اصل {fmtCompact(r.principal)} · {fmtDay(r.start_date)}</div></div>}
          />
        )}
      </Section>
      <Section title="دارایی‌های ثابت" action={<div className="flex gap-2"><Button size="sm" variant="outline" disabled={dep.isPending} onClick={() => dep.mutate({})}>ثبت استهلاک</Button><Button size="sm" onClick={() => setAssetOpen(true)}><Plus />دارایی جدید</Button></div>}>
        {!assets.data ? <Loading rows={2} /> : assets.data.assets.length === 0 ? <Empty title="دارایی ثابتی ثبت نشده" hint="لپ‌تاپ، تجهیزات یا نرم‌افزارهای بلندمدت را به‌عنوان دارایی ثبت کنید تا ماهانه مستهلک شوند." /> : (
          <ResponsiveList rows={assets.data.assets} rowKey={(r: any) => r.id}
            cols={[
              { key: 'n', label: 'دارایی', render: (r: any) => <b>{r.name}</b> },
              { key: 'c', label: 'بهای خرید', render: (r: any) => <Money value={r.cost} size="sm" /> },
              { key: 'a', label: 'استهلاک انباشته', render: (r: any) => <Money value={r.accumulated_depreciation} size="sm" /> },
              { key: 'b', label: 'ارزش دفتری', render: (r: any) => <Money value={r.book_value} size="sm" /> },
              { key: 'l', label: 'عمر مفید', render: (r: any) => `${fmtNum(r.useful_life_months)} ماه` },
            ] as Col<any>[]}
            card={(r: any) => <div className="grid gap-1"><div className="flex justify-between"><b>{r.name}</b><Money value={r.book_value} /></div><div className="text-xs text-muted-foreground">خرید {fmtCompact(r.cost)} · استهلاک {fmtCompact(r.accumulated_depreciation)} · {fmtDay(r.purchase_date)}</div></div>}
          />
        )}
      </Section>
      <LoanDialog open={loanOpen} onClose={() => setLoanOpen(false)} />
      <LoanPayDialog loan={payLoan} onClose={() => setPayLoan(null)} />
      <AssetDialog open={assetOpen} onClose={() => setAssetOpen(false)} />
      <span className="sr-only">{can(meta, 'view') ? '' : ''}</span>
    </div>
  )
}

function LoanDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const meta = useMeta()
  const [dir, setDir] = useState<'borrowed' | 'lent'>('borrowed')
  const [party, setParty] = useState<{ id: number; name: string } | null>(null)
  const [amount, setAmount] = useState('')
  const [rate, setRate] = useState('')
  const [account, setAccount] = useState('')
  const [date, setDate] = useState('')
  const post = usePost('fin_loan', onClose, 'وام ثبت شد')
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent><DialogHeader><DialogTitle>وام جدید</DialogTitle></DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (!party || !amount) return toast.error('طرف حساب و مبلغ را وارد کنید'); post.mutate({ direction: dir, party_id: party.id, principal: amount, interest_rate: rate, money_account: account || meta?.money_accounts[0]?.id, date }) }}>
          <Chips value={dir} onChange={setDir} options={[['borrowed', 'وام گرفتم'], ['lent', 'وام دادم']]} />
          <Field label={dir === 'borrowed' ? 'وام‌دهنده' : 'وام‌گیرنده'}><PartyPicker value={party} onChange={setParty} role={dir === 'borrowed' ? 'lender' : 'borrower'} defaultRole={dir === 'borrowed' ? 'lender' : 'borrower'} /></Field>
          <Field label="اصل وام"><AmountInput value={amount} onChange={setAmount} /></Field>
          <div className="grid gap-3 sm:grid-cols-2"><Field label="نرخ سود سالانه (٪)"><Input dir="ltr" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ''))} /></Field><Field label={dir === 'borrowed' ? 'واریز به حساب' : 'پرداخت از حساب'}><AccountSelect value={account} onChange={setAccount} accounts={meta?.money_accounts} /></Field></div>
          <DateInput value={date} onChange={setDate} />
          <DialogFooter><Button type="submit" disabled={post.isPending}>ثبت وام</Button><Button type="button" variant="outline" onClick={onClose}>انصراف</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function LoanPayDialog({ loan, onClose }: { loan: any; onClose: () => void }) {
  const meta = useMeta()
  const [principal, setPrincipal] = useState('')
  const [interest, setInterest] = useState('')
  const [account, setAccount] = useState('')
  const [date, setDate] = useState('')
  const post = usePost('fin_loan_pay', onClose, 'قسط ثبت شد')
  return (
    <Dialog open={!!loan} onOpenChange={(o) => !o && onClose()}>
      <DialogContent><DialogHeader><DialogTitle>قسط وام {loan?.party_name}</DialogTitle><DialogDescription>مانده‌ی وام: {fmtMoney(loan?.remaining)}</DialogDescription></DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); post.mutate({ loan_id: loan.id, principal, interest, money_account: account || meta?.money_accounts[0]?.id, date }) }}>
          <Field label="اصل قسط" hint="از مانده‌ی وام کم می‌شود"><AmountInput value={principal} onChange={setPrincipal} autoFocus /></Field>
          <Field label="سود قسط" hint={loan?.direction === 'borrowed' ? 'هزینه‌ی بهره حساب می‌شود' : 'درآمد بهره حساب می‌شود'}><AmountInput value={interest} onChange={setInterest} /></Field>
          <Field label="حساب"><AccountSelect value={account} onChange={setAccount} accounts={meta?.money_accounts} /></Field>
          <DateInput value={date} onChange={setDate} />
          <DialogFooter><Button type="submit" disabled={post.isPending}>ثبت قسط</Button><Button type="button" variant="outline" onClick={onClose}>انصراف</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AssetDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const meta = useMeta()
  const [name, setName] = useState('')
  const [cost, setCost] = useState('')
  const [life, setLife] = useState('36')
  const [salvage, setSalvage] = useState('')
  const [cls, setCls] = useState('')
  const [account, setAccount] = useState('')
  const [date, setDate] = useState('')
  const post = usePost('fin_asset', onClose, 'دارایی ثبت شد')
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent><DialogHeader><DialogTitle>دارایی ثابت جدید</DialogTitle></DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (!name.trim() || !cost) return toast.error('نام و بهای خرید را وارد کنید'); post.mutate({ name, cost, salvage, useful_life_months: life, asset_account: cls || undefined, money_account: account || meta?.money_accounts[0]?.id, date }) }}>
          <Field label="نام دارایی"><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
          <Field label="بهای خرید"><AmountInput value={cost} onChange={setCost} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="دسته"><AccountSelect value={cls} onChange={setCls} accounts={meta?.asset_accounts} placeholder="تجهیزات" /></Field>
            <Field label="پرداخت از حساب"><AccountSelect value={account} onChange={setAccount} accounts={meta?.money_accounts} /></Field>
            <Field label="عمر مفید (ماه)"><Input dir="ltr" inputMode="numeric" value={life} onChange={(e) => setLife(e.target.value.replace(/\D/g, ''))} /></Field>
            <Field label="ارزش اسقاط"><AmountInput value={salvage} onChange={setSalvage} /></Field>
          </div>
          <DateInput value={date} onChange={setDate} />
          <DialogFooter><Button type="submit" disabled={post.isPending}>ثبت دارایی</Button><Button type="button" variant="outline" onClick={onClose}>انصراف</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
