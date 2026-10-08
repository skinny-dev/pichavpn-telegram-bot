import { useState } from 'react'
import { Archive, Pencil, Plus, RefreshCw, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { fmtNum } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Chips, Empty, Field, KIND_LABEL, Loading, Money, Pager, Section, fmtDateTime, useFin, usePost } from './shared'

const TYPE_LABEL: Record<string, string> = { asset: 'دارایی', liability: 'بدهی', equity: 'حقوق صاحبان سرمایه', revenue: 'درآمد', expense: 'هزینه' }
type Tab = 'chart' | 'taxes' | 'perms' | 'health'

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('chart')
  return (
    <div className="grid gap-4">
      <Chips value={tab} onChange={setTab} options={[['chart', 'سرفصل حساب‌ها و دسته‌ها'], ['taxes', 'مالیات'], ['perms', 'دسترسی‌ها'], ['health', 'سلامت دفاتر و ممیزی']]} />
      {tab === 'chart' && <ChartTab />}
      {tab === 'taxes' && <TaxTab />}
      {tab === 'perms' && <PermTab />}
      {tab === 'health' && <HealthTab />}
    </div>
  )
}

function ChartTab() {
  const q = useFin<any>('fin_settings')
  const [edit, setEdit] = useState<any | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  if (!q.data) return <Loading />
  const rows = q.data.accounts.filter((a: any) => showArchived || !Number(a.archived))
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">دسته‌های هزینه و درآمد، صندوق‌ها و بانک‌ها همگی از همین‌جا ساخته و بایگانی می‌شوند. هیچ حسابی در برنامه ثابت نیست.</p>
        <div className="flex items-center gap-3"><label className="flex items-center gap-2 text-sm"><Switch checked={showArchived} onCheckedChange={setShowArchived} />بایگانی‌شده‌ها</label><Button onClick={() => setEdit({ code: '', name: '', type: 'expense', parent_code: '', money_kind: '', allow_negative: 0, archived: 0, is_postable: 1 })}><Plus />حساب / دسته‌ی جدید</Button></div>
      </div>
      {(['asset', 'liability', 'equity', 'revenue', 'expense'] as const).map((t) => (
        <Section key={t} title={TYPE_LABEL[t]}>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
            {rows.filter((a: any) => a.type === t).map((a: any) => (
              <li key={a.id} className="flex items-center gap-3 rounded-lg border bg-card p-2.5 text-sm" style={{ opacity: Number(a.archived) ? 0.55 : 1 }}>
                <span className="w-14 shrink-0 text-xs text-muted-foreground tabular" dir="ltr">{a.code}</span>
                <span className="min-w-0 flex-1"><span className={Number(a.is_postable) ? '' : 'font-semibold'}>{a.name}</span> {a.money_kind && <Badge variant="secondary">{KIND_LABEL[a.money_kind] ?? a.money_kind}</Badge>} {Number(a.archived) === 1 && <Badge variant="secondary">بایگانی</Badge>}</span>
                {Number(a.is_postable) === 1 && <Money value={a.balance} size="sm" />}
                <Button variant="ghost" size="icon-sm" onClick={() => setEdit(a)} aria-label={`ویرایش ${a.name}`}><Pencil /></Button>
              </li>
            ))}
          </ul>
        </Section>
      ))}
      <AccountDialog account={edit} accounts={q.data.accounts} onClose={() => setEdit(null)} />
    </div>
  )
}

function AccountDialog({ account, accounts, onClose }: { account: any | null; accounts: any[]; onClose: () => void }) {
  const [f, setF] = useState<any>(null)
  const post = usePost('fin_account_save', onClose, 'ذخیره شد')
  const cur = f && account && f.__for === (account.id ?? 'new') ? f : account ? { ...account, __for: account.id ?? 'new' } : null
  const set = (p: any) => setF({ ...cur, ...p })
  const parents = accounts.filter((a: any) => Number(a.is_postable) === 0 && a.type === cur?.type)
  return (
    <Dialog open={!!account} onOpenChange={(o) => { if (!o) { setF(null); onClose() } }}>
      <DialogContent>
        {cur && (
          <>
            <DialogHeader><DialogTitle>{account.id ? 'ویرایش حساب' : 'حساب / دسته‌ی جدید'}</DialogTitle><DialogDescription>برای دسته‌ی هزینه‌ی جدید، نوع «هزینه» را بگذارید.</DialogDescription></DialogHeader>
            <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); post.mutate({ id: account.id, code: cur.code, name: cur.name, type: cur.type, parent_code: cur.parent_code || null, money_kind: cur.money_kind || '', allow_negative: !!Number(cur.allow_negative), archived: !!Number(cur.archived), is_postable: !!Number(cur.is_postable) }); setF(null) }}>
              <div className="grid grid-cols-[6rem_1fr] gap-3"><Field label="کد"><Input dir="ltr" inputMode="numeric" value={cur.code} onChange={(e) => set({ code: e.target.value.replace(/\D/g, '') })} /></Field><Field label="نام"><Input value={cur.name} onChange={(e) => set({ name: e.target.value })} autoFocus /></Field></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="نوع"><Select value={cur.type} onValueChange={(v) => set({ type: v, parent_code: '' })} disabled={!!account.id}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(TYPE_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></Field>
                <Field label="زیرمجموعه‌ی"><Select value={cur.parent_code || 'none'} onValueChange={(v) => set({ parent_code: v === 'none' ? '' : v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">بدون والد</SelectItem>{parents.map((p: any) => <SelectItem key={p.code} value={p.code}>{p.code} · {p.name}</SelectItem>)}</SelectContent></Select></Field>
              </div>
              {cur.type === 'asset' && (
                <Field label="این حساب پول نگه می‌دارد؟" hint="اگر صندوق/بانک/درگاه است نوعش را انتخاب کنید تا در «پول و بانک» بیاید">
                  <Select value={cur.money_kind || 'none'} onValueChange={(v) => set({ money_kind: v === 'none' ? '' : v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">خیر</SelectItem>{Object.entries(KIND_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select>
                </Field>
              )}
              <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm"><span>بایگانی (دیگر قابل انتخاب نیست، سابقه می‌ماند)</span><Switch checked={!!Number(cur.archived)} onCheckedChange={(v) => set({ archived: v ? 1 : 0 })} /></label>
              {cur.money_kind && <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm"><span>اجازه‌ی منفی شدن موجودی</span><Switch checked={!!Number(cur.allow_negative)} onCheckedChange={(v) => set({ allow_negative: v ? 1 : 0 })} /></label>}
              <DialogFooter><Button type="submit" disabled={post.isPending}>ذخیره</Button><Button type="button" variant="outline" onClick={() => { setF(null); onClose() }}>انصراف</Button></DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function TaxTab() {
  const q = useFin<any>('fin_settings')
  const [name, setName] = useState('')
  const [rate, setRate] = useState('')
  const [kind, setKind] = useState<'sales' | 'purchase'>('sales')
  const post = usePost('fin_tax_save', () => { setName(''); setRate('') }, 'ذخیره شد')
  if (!q.data) return <Loading />
  return (
    <div className="grid gap-3">
      {q.data.taxes.length === 0 ? <Empty title="مالیاتی تعریف نشده" hint="مثلاً «ارزش افزوده ۱۰٪» را اضافه کنید تا هنگام ثبت فروش و خرید قابل انتخاب باشد." /> : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-1.5">{q.data.taxes.map((t: any) => <li key={t.id} className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3 text-sm"><span>{t.name} <Badge variant="secondary">{t.kind === 'sales' ? 'فروش' : 'خرید'}</Badge> {Number(t.archived) === 1 && <Badge variant="secondary">بایگانی</Badge>}</span><span className="flex items-center gap-2"><b>{fmtNum(Number(t.rate))}٪</b><Button variant="ghost" size="icon-sm" aria-label="بایگانی/فعال" onClick={() => post.mutate({ id: t.id, name: t.name, rate: t.rate, kind: t.kind, archived: Number(t.archived) ? 0 : 1 })}><Archive /></Button></span></li>)}</ul>
      )}
      <form className="grid gap-3 rounded-xl border p-3 sm:grid-cols-[1fr_6rem_auto_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return toast.error('نام را وارد کنید'); post.mutate({ name, rate, kind }) }}>
        <Field label="نام مالیات"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ارزش افزوده" /></Field>
        <Field label="نرخ ٪"><Input dir="ltr" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ''))} /></Field>
        <Chips value={kind} onChange={setKind} options={[['sales', 'فروش'], ['purchase', 'خرید']]} />
        <Button type="submit" disabled={post.isPending}><Plus />افزودن</Button>
      </form>
    </div>
  )
}

function PermTab() {
  const q = useFin<any>('fin_settings')
  const post = usePost('fin_perm_save', undefined, 'دسترسی‌ها ذخیره شد')
  const [role, setRole] = useState<'Seller' | 'support'>('Seller')
  const [draft, setDraft] = useState<Record<string, string[]>>({})
  if (!q.data) return <Loading />
  const cur: string[] = draft[role] ?? q.data.perms[role] ?? []
  const toggle = (p: string) => setDraft({ ...draft, [role]: cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p] })
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">مدیر کل همه‌ی دسترسی‌ها را دارد. برای نقش‌های دیگر مشخص کنید چه بخش‌هایی از مالی را ببینند یا ثبت کنند (پیش‌فرض: هیچ). حساب‌های «پشتیبان» فعلاً فقط به چت پشتیبانی پنل وب دسترسی دارند.</p>
      <Chips value={role} onChange={setRole} options={[['Seller', 'فروشنده'], ['support', 'پشتیبان']]} />
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-1.5 sm:grid-cols-2">{Object.entries(q.data.catalog).map(([k, l]) => <li key={k}><label className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3 text-sm"><span>{l as string}</span><Switch checked={cur.includes(k)} onCheckedChange={() => toggle(k)} /></label></li>)}</ul>
      <div><Button disabled={post.isPending} onClick={() => post.mutate({ role, permissions: cur })}><ShieldCheck />ذخیره‌ی دسترسی‌های {role === 'Seller' ? 'فروشنده' : 'پشتیبان'}</Button></div>
    </div>
  )
}

function HealthTab() {
  const h = useFin<any>('fin_integrity')
  const [page, setPage] = useState(1)
  const audit = useFin<any>('fin_audit', { page })
  const sync = usePost('fin_sync', undefined, 'همگام‌سازی انجام شد')
  return (
    <div className="grid gap-4">
      <div className="rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><b>{h.data ? (h.data.problems.length ? 'ناهماهنگی پیدا شد' : 'همه‌ی دفاتر سالم و متعادل‌اند ✓') : '…'}</b><Button variant="outline" size="sm" disabled={sync.isPending} onClick={() => sync.mutate({})}><RefreshCw />همگام‌سازی با ربات</Button></div>
        {h.data?.problems.length > 0 && <ul className="mt-2 list-disc ps-5 text-sm text-destructive">{h.data.problems.map((p: string) => <li key={p}>{p}</li>)}</ul>}
        <p className="mt-2 text-xs text-muted-foreground">بررسی می‌کند: جمع بدهکار = بستانکار در هر سند، تراز آزمایشی، ترازنامه و تطبیق مانده‌ی طلب/بدهی با دفتر کل. آخرین همگام‌سازی با ربات: {h.data?.last_sync ? fmtDateTime(h.data.last_sync) : '—'}</p>
      </div>
      <Section title="سابقه‌ی تغییرات (ممیزی)">
        {!audit.data ? <Loading rows={3} /> : audit.data.rows.length === 0 ? <Empty title="هنوز رویدادی ثبت نشده" /> : (
          <>
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-1 text-sm">{audit.data.rows.map((a: any) => <li key={a.id} className="flex flex-wrap justify-between gap-2 border-b py-1.5 last:border-0"><span>{a.action} · {a.entity} #{a.entity_id}{a.detail ? <span className="text-xs text-muted-foreground"> · {String(a.detail).slice(0, 90)}</span> : null}</span><span className="text-xs text-muted-foreground">{a.user || 'سیستم'} · {fmtDateTime(a.at)}</span></li>)}</ul>
            <Pager page={page} per={50} total={audit.data.total} onPage={setPage} />
          </>
        )}
      </Section>
    </div>
  )
}
