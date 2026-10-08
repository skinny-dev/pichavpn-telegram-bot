import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import { fmtNum } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useDebounced } from '@/lib/hooks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Empty, Loading, can, fmtDay, fmtMoney, useFin, useMeta } from './shared'
import { ACTIONS, QuickSheet, type ActionKey, type Preset } from './forms'
import { EntryDrawer } from './detail'
import { ActivityPage, LedgerDialog, MoneyPage, OverviewPage, type Nav } from './pages'
import { AgingPage, AssetsPage, PartiesPage, PartnersPage, PartyDialog } from './people'
import { ReportsPage } from './reports'
import { SettingsPage } from './settings'

const TABS: { key: string; label: string; perm: string }[] = [
  { key: 'overview', label: 'بررسی کلی', perm: 'view' }, { key: 'activity', label: 'تراکنش‌ها', perm: 'view' }, { key: 'money', label: 'پول و بانک', perm: 'view' },
  { key: 'receivables', label: 'طلب‌ها', perm: 'view' }, { key: 'payables', label: 'بدهی‌ها', perm: 'view' }, { key: 'parties', label: 'طرف‌حساب‌ها', perm: 'view' },
  { key: 'partners', label: 'سرمایه و شرکا', perm: 'capital.manage' }, { key: 'assets', label: 'وام و دارایی', perm: 'view' }, { key: 'reports', label: 'گزارش‌ها', perm: 'reports.view' }, { key: 'settings', label: 'تنظیمات', perm: 'chart.manage' },
]

export default function Finance() {
  const meta = useMeta()
  const params = useParams()
  const navigate = useNavigate()
  const tab = params['*'] || 'overview'
  const [action, setAction] = useState<ActionKey | null>(null)
  const [preset, setPreset] = useState<Preset | undefined>()
  const [picker, setPicker] = useState(false)
  const [target, setTarget] = useState<{ txn?: number; entry?: number } | null>(null)
  const [party, setParty] = useState<number | null>(null)
  const [ledger, setLedger] = useState<{ id: number; name: string } | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const nav: Nav = {
    action: (a, p) => { setPreset(p); setAction(a); setPicker(false) },
    entry: (t) => setTarget(t),
    go: (t) => navigate(t === 'overview' ? '/finance' : `/finance/${t}`),
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus() }
      if (e.key.toLowerCase() === 'n') { e.preventDefault(); setPicker(true) }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  if (!meta) return <Loading />
  const tabs = TABS.filter((t) => can(meta, t.perm))
  const allowed = ACTIONS.filter((a) => can(meta, a.perm))
  if (!can(meta, 'view')) return <Empty title="دسترسی به بخش مالی برای شما فعال نیست" hint="از مدیر کل بخواهید در تنظیمات مالی ← دسترسی‌ها برای شما مجوز بدهد." />

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 pb-20 md:pb-0">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <GlobalSearch inputRef={searchRef} onParty={setParty} onEntry={(t) => setTarget(t)} onAccount={setLedger} />
        <Button className="hidden md:inline-flex" onClick={() => setPicker(true)}><Plus />ثبت سریع <kbd className="ms-1 rounded bg-primary-foreground/20 px-1 text-[10px]">N</kbd></Button>
      </div>
      <nav aria-label="بخش‌های مالی" className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0 print:hidden">
        <div className="flex w-max gap-1 border-b">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => nav.go(t.key)} aria-current={tab === t.key ? 'page' : undefined} className={cn('whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors', tab === t.key ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>{t.label}</button>
          ))}
        </div>
      </nav>

      {tab === 'overview' && <OverviewPage nav={nav} />}
      {tab === 'activity' && <ActivityPage nav={nav} />}
      {tab === 'money' && <MoneyPage nav={nav} />}
      {tab === 'receivables' && <AgingPage kind="sale" nav={nav} />}
      {tab === 'payables' && <AgingPage kind="purchase" nav={nav} />}
      {tab === 'parties' && <PartiesPage nav={nav} />}
      {tab === 'partners' && <PartnersPage nav={nav} />}
      {tab === 'assets' && <AssetsPage />}
      {tab === 'reports' && <ReportsPage nav={nav} />}
      {tab === 'settings' && <SettingsPage />}

      {/* quick action button: thumb-reachable above the mobile bottom bar */}
      <button onClick={() => setPicker(true)} aria-label="ثبت سریع" className="fixed bottom-20 end-4 z-40 grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg active:scale-95 md:hidden print:hidden"><Plus className="size-6" /></button>

      <Dialog open={picker} onOpenChange={setPicker}>
        <DialogContent className="md:max-w-xl">
          <DialogHeader><DialogTitle>ثبت سریع</DialogTitle><DialogDescription>چه اتفاقی افتاده؟</DialogDescription></DialogHeader>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {allowed.map((a) => (
              <button key={a.key} onClick={() => nav.action(a.key)} className="grid justify-items-start gap-1 rounded-xl border bg-card p-3 text-start transition-colors hover:bg-accent/50 active:bg-accent">
                <a.icon className="size-5 text-primary" /><span className="font-medium">{a.label}</span><span className="text-xs text-muted-foreground">{a.hint}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <QuickSheet action={action} preset={preset} onClose={() => { setAction(null); setPreset(undefined) }} />
      <EntryDrawer target={target} onClose={() => setTarget(null)} onAction={nav.action} />
      <PartyDialog id={party} onClose={() => setParty(null)} nav={nav} />
      <LedgerDialog account={ledger} onClose={() => setLedger(null)} onOpen={nav.entry} />
    </div>
  )
}

function GlobalSearch({ inputRef, onParty, onEntry, onAccount }: { inputRef: React.RefObject<HTMLInputElement>; onParty: (id: number) => void; onEntry: (t: { txn?: number; entry?: number }) => void; onAccount: (a: { id: number; name: string }) => void }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const dq = useDebounced(q, 250)
  const box = useRef<HTMLDivElement>(null)
  const r = useFin<any>('fin_search', { q: dq }, { enabled: dq.trim().length >= 1 })
  useEffect(() => {
    const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  const d = dq.trim() ? r.data : null
  const none = d && !d.parties.length && !d.transactions.length && !d.accounts.length && !d.entries.length
  const pick = (fn: () => void) => { fn(); setOpen(false); setQ('') }
  return (
    <div ref={box} className="relative min-w-[12rem] flex-1 md:max-w-lg">
      <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input ref={inputRef} value={q} onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true) }} placeholder="جستجو در مالی: علی، INV-12، ۲٬۵۰۰٬۰۰۰، تبلیغات، بانک…" className="ps-9" aria-label="جستجوی مالی" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} />
      {open && dq.trim() && (
        <div className="absolute z-50 mt-1 max-h-[70dvh] w-full overflow-y-auto rounded-xl border bg-popover p-2 shadow-lg">
          {!d ? <p className="p-3 text-sm text-muted-foreground">در حال جستجو…</p> : none ? <p className="p-3 text-sm text-muted-foreground">چیزی پیدا نشد</p> : (
            <>
              {d.parties.length > 0 && <Group title="طرف‌حساب‌ها">{d.parties.map((p: any) => <Hit key={p.id} onClick={() => pick(() => onParty(Number(p.id)))} title={p.name} sub={p.phone} />)}</Group>}
              {d.transactions.length > 0 && <Group title="تراکنش‌ها">{d.transactions.map((t: any) => <Hit key={t.id} onClick={() => pick(() => onEntry({ txn: Number(t.id) }))} title={`${t.ref} · ${t.party_name ?? ''}`} sub={`${fmtDay(t.txn_date)}${t.memo ? ' · ' + t.memo : ''}`} end={fmtMoney(t.total)} />)}</Group>}
              {d.accounts.length > 0 && <Group title="حساب‌ها">{d.accounts.map((a: any) => <Hit key={a.id} onClick={() => pick(() => onAccount({ id: Number(a.id), name: `${a.code} · ${a.name}` }))} title={a.name} sub={a.code} />)}</Group>}
              {d.entries.length > 0 && <Group title="اسناد">{d.entries.map((e: any) => <Hit key={e.id} onClick={() => pick(() => onEntry({ entry: Number(e.id) }))} title={`${e.entry_no} · ${e.memo ?? ''}`} sub={fmtDay(e.entry_date)} />)}</Group>}
            </>
          )}
        </div>
      )}
      <span className="sr-only">{fmtNum(0)}</span>
    </div>
  )
}
const Group = ({ title, children }: { title: string; children: React.ReactNode }) => <div className="mb-1"><div className="px-2 py-1 text-[11px] font-medium text-muted-foreground">{title}</div>{children}</div>
const Hit = ({ title, sub, end, onClick }: { title: string; sub?: string | null; end?: string; onClick: () => void }) => (
  <button type="button" onClick={onClick} className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-start text-sm hover:bg-accent">
    <span className="min-w-0"><span className="block truncate">{title}</span>{sub && <span className="block truncate text-xs text-muted-foreground">{sub}</span>}</span>{end && <span className="shrink-0 text-xs tabular">{end}</span>}
  </button>
)
