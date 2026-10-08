import { useEffect, useMemo, useState } from 'react'
import { ArrowLeftRight, BadgeDollarSign, Banknote, HandCoins, Landmark, Plus, Receipt, ShoppingBag, ShoppingCart, Trash2, UserPlus, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { fmtNum } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AccountSelect, AmountInput, Chips, DateInput, Field, PartyPicker, can, fmtDay, fmtMoney, useFin, useMeta, usePost, type Account, type Meta } from './shared'

export type ActionKey = 'sale' | 'expense' | 'income' | 'receipt' | 'payment' | 'transfer' | 'purchase' | 'capital' | 'party'
export interface Preset { party?: { id: number; name: string }; docId?: number; amount?: number; direction?: 'in' | 'out' }

export const ACTIONS: { key: ActionKey; label: string; perm: string; icon: typeof Receipt; hint: string }[] = [
  { key: 'sale', label: 'فروش', perm: 'sale.create', icon: ShoppingBag, hint: 'ثبت فروش و دریافت پول' },
  { key: 'expense', label: 'هزینه', perm: 'expense.create', icon: Receipt, hint: 'تبلیغات، سرور، حقوق، …' },
  { key: 'receipt', label: 'دریافت پول', perm: 'payment.manage', icon: HandCoins, hint: 'تسویه‌ی طلب از مشتری' },
  { key: 'payment', label: 'پرداخت پول', perm: 'payment.manage', icon: Wallet, hint: 'تسویه‌ی بدهی به تأمین‌کننده' },
  { key: 'transfer', label: 'انتقال', perm: 'accounts.manage', icon: ArrowLeftRight, hint: 'بین صندوق و بانک‌ها' },
  { key: 'income', label: 'درآمد', perm: 'expense.create', icon: BadgeDollarSign, hint: 'غیر از فروش (بهره، کمیسیون)' },
  { key: 'purchase', label: 'خرید', perm: 'purchase.create', icon: ShoppingCart, hint: 'خرید از تأمین‌کننده' },
  { key: 'capital', label: 'سرمایه', perm: 'capital.manage', icon: Landmark, hint: 'ورود سرمایه یا برداشت' },
  { key: 'party', label: 'طرف حساب', perm: 'payment.manage', icon: UserPlus, hint: 'مشتری، تأمین‌کننده، شریک' },
]

const TITLES: Record<ActionKey, string> = { sale: 'ثبت فروش', expense: 'ثبت هزینه', income: 'ثبت درآمد', receipt: 'دریافت پول از مشتری', payment: 'پرداخت پول به تأمین‌کننده', transfer: 'انتقال بین حساب‌ها', purchase: 'ثبت خرید', capital: 'سرمایه و برداشت', party: 'طرف حساب جدید' }

/** bottom sheet on phones, centered dialog on desktop (see ui/dialog) */
export function QuickSheet({ action, preset, onClose }: { action: ActionKey | null; preset?: Preset; onClose: () => void }) {
  return (
    <Dialog open={!!action} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="md:max-w-xl" onOpenAutoFocus={(e) => { if (window.matchMedia('(pointer: coarse)').matches) e.preventDefault() }}>
        {action && (
          <>
            <DialogHeader><DialogTitle>{TITLES[action]}</DialogTitle><DialogDescription>{ACTIONS.find((a) => a.key === action)?.hint}</DialogDescription></DialogHeader>
            {action === 'sale' && <SaleForm onClose={onClose} preset={preset} />}
            {action === 'purchase' && <PurchaseForm onClose={onClose} preset={preset} />}
            {action === 'expense' && <ExpenseForm onClose={onClose} />}
            {action === 'income' && <IncomeForm onClose={onClose} />}
            {(action === 'receipt' || action === 'payment') && <SettleForm kind={action} onClose={onClose} preset={preset} />}
            {action === 'transfer' && <TransferForm onClose={onClose} />}
            {action === 'capital' && <CapitalForm onClose={onClose} preset={preset} />}
            {action === 'party' && <PartyForm onClose={onClose} />}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Footer({ pending, label, onClose, disabled }: { pending: boolean; label: string; onClose: () => void; disabled?: boolean }) {
  return (
    <DialogFooter className="sticky bottom-0 -mx-5 -mb-5 border-t bg-background px-5 py-3 md:static md:m-0 md:border-0 md:p-0">
      <Button type="submit" size="lg" disabled={pending || disabled} className="flex-1 sm:flex-none">{pending ? 'در حال ثبت…' : label}</Button>
      <Button type="button" variant="outline" size="lg" onClick={onClose}>انصراف</Button>
    </DialogFooter>
  )
}

function useDefaultAccount(meta: Meta | undefined): [string, (v: string) => void] {
  const [v, setV] = useState('')
  useEffect(() => {
    if (!v && meta) setV(String(meta.last_money_account ?? meta.money_accounts.find((a) => a.system_key === 'cash')?.id ?? meta.money_accounts[0]?.id ?? ''))
  }, [meta, v])
  return [v, setV]
}

function Grid({ children }: { children: React.ReactNode }) { return <div className="grid gap-3 sm:grid-cols-2">{children}</div> }

// ------------------------------------------------------------------ sale / purchase

interface Item { name: string; qty: string; price: string }
const newItem = (): Item => ({ name: '', qty: '1', price: '' })

function ItemsEditor({ items, setItems, suggestions }: { items: Item[]; setItems: (i: Item[]) => void; suggestions?: { name: string; price: number }[] }) {
  const set = (i: number, p: Partial<Item>) => setItems(items.map((x, j) => (j === i ? { ...x, ...p } : x)))
  return (
    <div className="grid gap-2">
      {suggestions && suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <span className="text-xs text-muted-foreground">اخیراً:</span>
          {suggestions.map((s) => <button key={s.name} type="button" className="rounded-full border px-2.5 py-0.5 text-xs hover:bg-accent" onClick={() => setItems([...items.filter((x) => x.name || x.price), { name: s.name, qty: '1', price: String(s.price) }])}>{s.name}</button>)}
        </div>
      )}
      {items.map((it, i) => (
        <div key={i} className="grid grid-cols-[1fr_4.5rem] gap-2 rounded-lg border p-2 sm:grid-cols-[1fr_5rem_9rem_auto]">
          <Input placeholder="شرح (اختیاری)" value={it.name} onChange={(e) => set(i, { name: e.target.value })} aria-label="شرح" className="col-span-2 sm:col-span-1" />
          <Input dir="ltr" inputMode="decimal" value={it.qty} onChange={(e) => set(i, { qty: e.target.value.replace(/[^\d.]/g, '') })} aria-label="تعداد" placeholder="تعداد" />
          <AmountInput value={it.price} onChange={(v) => set(i, { price: v })} placeholder="قیمت واحد" />
          {items.length > 1 && <Button type="button" variant="ghost" size="icon" onClick={() => setItems(items.filter((_, j) => j !== i))} aria-label="حذف ردیف"><Trash2 /></Button>}
        </div>
      ))}
      <Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={() => setItems([...items, newItem()])}><Plus />ردیف جدید</Button>
    </div>
  )
}

function useTotals(items: Item[], discount: string, taxRate: string) {
  return useMemo(() => {
    const sub = items.reduce((a, i) => a + Math.round((parseFloat(i.qty) || 0) * (Number(i.price) || 0)), 0)
    const disc = Math.min(sub, Number(discount) || 0)
    const tax = Math.round(((sub - disc) * (parseFloat(taxRate) || 0)) / 100)
    return { sub, disc, tax, total: sub - disc + tax }
  }, [items, discount, taxRate])
}

function TotalsBox({ t, taxRate }: { t: { sub: number; disc: number; tax: number; total: number }; taxRate: string }) {
  return (
    <div className="grid gap-1 rounded-lg bg-muted/50 p-3 text-sm">
      {(t.disc > 0 || t.tax > 0) && <div className="flex justify-between text-muted-foreground"><span>جمع اقلام</span><span className="tabular">{fmtNum(t.sub)}</span></div>}
      {t.disc > 0 && <div className="flex justify-between text-muted-foreground"><span>تخفیف</span><span className="tabular">−{fmtNum(t.disc)}</span></div>}
      {t.tax > 0 && <div className="flex justify-between text-muted-foreground"><span>مالیات ({taxRate}٪)</span><span className="tabular">+{fmtNum(t.tax)}</span></div>}
      <div className="flex justify-between text-base font-bold"><span>مبلغ نهایی</span><span className="tabular">{fmtMoney(t.total)}</span></div>
    </div>
  )
}

function TradeForm({ kind, onClose, preset }: { kind: 'sale' | 'purchase'; onClose: () => void; preset?: Preset }) {
  const meta = useMeta()
  const sale = kind === 'sale'
  const [party, setParty] = useState<{ id: number; name: string } | null>(preset?.party ?? null)
  const [items, setItems] = useState<Item[]>([newItem()])
  const [discount, setDiscount] = useState('')
  const [taxRate, setTaxRate] = useState('')
  const [mode, setMode] = useState<'paid' | 'credit' | 'partial'>('paid')
  const [partial, setPartial] = useState('')
  const [account, setAccount] = useDefaultAccount(meta)
  const [category, setCategory] = useState('')
  const [due, setDue] = useState('')
  const [date, setDate] = useState('')
  const [memo, setMemo] = useState('')
  const t = useTotals(items, discount, taxRate)
  const defaults = useFin<any>('fin_defaults', { party: party?.id, kind }, { enabled: !!party })
  const post = usePost(sale ? 'fin_sale' : 'fin_purchase', onClose, sale ? 'فروش ثبت شد' : 'خرید ثبت شد')
  const cats: Account[] = sale ? (meta?.revenue_accounts ?? []) : [...(meta?.expense_accounts ?? []), ...(meta?.asset_accounts ?? [])]
  useEffect(() => { if (!category && cats.length) setCategory(String(cats.find((c) => c.system_key === (sale ? 'revenue_sales' : 'cogs'))?.id ?? cats[0].id)) }, [cats.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const paidNow = mode === 'paid' ? t.total : mode === 'partial' ? Number(partial) || 0 : 0
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (t.total <= 0) return toast.error('مبلغ را وارد کنید')
    if (mode !== 'paid' && !party) return toast.error(sale ? 'برای فروش نسیه یا بخشی، مشتری را انتخاب کنید' : 'برای خرید نسیه، تأمین‌کننده را انتخاب کنید')
    if (paidNow > t.total) return toast.error('مبلغ پرداختی از مبلغ نهایی بیشتر است')
    post.mutate({
      party_id: party?.id, items: items.filter((i) => i.price).map((i) => ({ name: i.name, qty: i.qty, price: i.price })), discount, tax_rate: taxRate, paid_now: paidNow || '',
      money_account: account, due_date: due, date, memo, ...(sale ? { revenue_account: category } : { category_account: category }),
    })
  }
  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field label={sale ? 'مشتری' : 'تأمین‌کننده'} hint={defaults.data?.outstanding ? `مانده‌ی فعلی: ${fmtMoney(defaults.data.outstanding)}` : undefined}>
        <PartyPicker value={party} onChange={setParty} role={sale ? 'customer' : 'supplier'} defaultRole={sale ? 'customer' : 'supplier'} placeholder={sale ? 'مشتری (برای فروش نقدی اختیاری)' : 'تأمین‌کننده'} />
      </Field>
      <Field label="اقلام / مبلغ"><ItemsEditor items={items} setItems={setItems} suggestions={sale ? defaults.data?.recent_items?.map((i: any) => ({ name: i.name, price: i.price })) : undefined} /></Field>
      <Grid>
        <Field label="تخفیف"><AmountInput value={discount} onChange={setDiscount} /></Field>
        <Field label="مالیات">
          <Select value={taxRate || 'none'} onValueChange={(v) => setTaxRate(v === 'none' ? '' : v)}>
            <SelectTrigger><SelectValue placeholder="بدون مالیات" /></SelectTrigger>
            <SelectContent><SelectItem value="none">بدون مالیات</SelectItem>{(meta?.taxes ?? []).map((x) => <SelectItem key={x.id} value={String(Number(x.rate))}>{x.name} ({Number(x.rate)}٪)</SelectItem>)}</SelectContent>
          </Select>
        </Field>
      </Grid>
      <TotalsBox t={t} taxRate={taxRate} />
      <Field label={sale ? 'وضعیت دریافت' : 'وضعیت پرداخت'}>
        <Chips value={mode} onChange={setMode} options={[['paid', sale ? 'کامل دریافت شد' : 'کامل پرداخت شد'], ['partial', 'بخشی'], ['credit', 'نسیه']]} />
      </Field>
      {mode === 'partial' && <Field label={sale ? 'مبلغ دریافتی' : 'مبلغ پرداختی'} hint={`باقی‌مانده: ${fmtMoney(Math.max(0, t.total - (Number(partial) || 0)))}`}><AmountInput value={partial} onChange={setPartial} /></Field>}
      <Grid>
        {mode !== 'credit' && <Field label={sale ? 'دریافت در حساب' : 'پرداخت از حساب'}><AccountSelect value={account} onChange={setAccount} accounts={meta?.money_accounts} /></Field>}
        {mode !== 'paid' && <DateInput label="سررسید" value={due} onChange={setDue} />}
        <Field label={sale ? 'حساب درآمد' : 'دسته‌ی خرید'}><AccountSelect value={category} onChange={setCategory} accounts={cats} /></Field>
        <DateInput value={date} onChange={setDate} />
      </Grid>
      <Field label="توضیحات"><Input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="اختیاری" /></Field>
      <Footer pending={post.isPending} label={sale ? 'ثبت فروش' : 'ثبت خرید'} onClose={onClose} />
    </form>
  )
}
const SaleForm = (p: { onClose: () => void; preset?: Preset }) => <TradeForm kind="sale" {...p} />
const PurchaseForm = (p: { onClose: () => void; preset?: Preset }) => <TradeForm kind="purchase" {...p} />

// ------------------------------------------------------------------ expense / income

function ExpenseForm({ onClose }: { onClose: () => void }) {
  const meta = useMeta()
  const [amount, setAmount] = useState('')
  const [cat, setCat] = useState('')
  const [account, setAccount] = useDefaultAccount(meta)
  const [date, setDate] = useState('')
  const [memo, setMemo] = useState('')
  const [credit, setCredit] = useState(false)
  const [party, setParty] = useState<{ id: number; name: string } | null>(null)
  const [due, setDue] = useState('')
  const post = usePost('fin_expense', onClose, 'هزینه ثبت شد')
  const recent = (meta?.recent_expense_accounts ?? []).map((id) => meta?.expense_accounts.find((a) => a.id === id)).filter(Boolean) as Account[]
  useEffect(() => { if (!cat && meta) setCat(String(recent[0]?.id ?? meta.expense_accounts.find((a) => a.system_key === 'exp_general')?.id ?? '')) }, [meta]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (!amount) return toast.error('مبلغ را وارد کنید'); post.mutate({ amount, category_account: cat, money_account: account, date, memo, on_credit: credit, party_id: party?.id, due_date: due }) }}>
      <Field label="مبلغ"><AmountInput value={amount} onChange={setAmount} autoFocus /></Field>
      <Field label="دسته‌ی هزینه">
        {recent.length > 0 && <div className="mb-1 flex flex-wrap gap-1.5">{recent.map((a) => <button key={a.id} type="button" onClick={() => setCat(String(a.id))} data-on={cat === String(a.id)} className="rounded-full border px-3 py-1 text-sm hover:bg-accent data-[on=true]:border-primary data-[on=true]:bg-primary/10">{a.name}</button>)}</div>}
        <AccountSelect value={cat} onChange={setCat} accounts={meta?.expense_accounts} placeholder="همه‌ی دسته‌ها…" />
      </Field>
      <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm"><span>نسیه (هنوز پرداخت نشده)</span><Switch checked={credit} onCheckedChange={setCredit} /></label>
      {credit ? (
        <Grid>
          <Field label="تأمین‌کننده"><PartyPicker value={party} onChange={setParty} role="supplier" defaultRole="supplier" /></Field>
          <DateInput label="سررسید" value={due} onChange={setDue} />
        </Grid>
      ) : <Field label="پرداخت از حساب"><AccountSelect value={account} onChange={setAccount} accounts={meta?.money_accounts} /></Field>}
      <DateInput value={date} onChange={setDate} />
      <Field label="توضیحات"><Input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="مثلاً کمپین اینستاگرام" /></Field>
      <Footer pending={post.isPending} label="ثبت هزینه" onClose={onClose} />
    </form>
  )
}

function IncomeForm({ onClose }: { onClose: () => void }) {
  const meta = useMeta()
  const [amount, setAmount] = useState('')
  const [inc, setInc] = useState('')
  const [account, setAccount] = useDefaultAccount(meta)
  const [date, setDate] = useState('')
  const [memo, setMemo] = useState('')
  const post = usePost('fin_income', onClose, 'درآمد ثبت شد')
  useEffect(() => { if (!inc && meta) setInc(String(meta.revenue_accounts.find((a) => a.system_key === 'revenue_other')?.id ?? '')) }, [meta]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (!amount) return toast.error('مبلغ را وارد کنید'); post.mutate({ amount, income_account: inc, money_account: account, date, memo }) }}>
      <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">فروش را در «فروش» ثبت کنید. سرمایه‌ی شرکا و وام درآمد حساب نمی‌شوند؛ از «سرمایه» و «وام» استفاده کنید.</p>
      <Field label="مبلغ"><AmountInput value={amount} onChange={setAmount} autoFocus /></Field>
      <Grid>
        <Field label="نوع درآمد"><AccountSelect value={inc} onChange={setInc} accounts={meta?.revenue_accounts.filter((a) => a.system_key !== 'sales_returns')} /></Field>
        <Field label="دریافت در حساب"><AccountSelect value={account} onChange={setAccount} accounts={meta?.money_accounts} /></Field>
      </Grid>
      <DateInput value={date} onChange={setDate} />
      <Field label="توضیحات"><Input value={memo} onChange={(e) => setMemo(e.target.value)} /></Field>
      <Footer pending={post.isPending} label="ثبت درآمد" onClose={onClose} />
    </form>
  )
}

// ------------------------------------------------------------------ receive / pay

function SettleForm({ kind, onClose, preset }: { kind: 'receipt' | 'payment'; onClose: () => void; preset?: Preset }) {
  const meta = useMeta()
  const recv = kind === 'receipt'
  const docKind = recv ? 'sale' : 'purchase'
  const [party, setParty] = useState<{ id: number; name: string } | null>(preset?.party ?? null)
  const [doc, setDoc] = useState<string>(preset?.docId ? String(preset.docId) : 'auto')
  const [amount, setAmount] = useState(preset?.amount ? String(preset.amount) : '')
  const [touched, setTouched] = useState(!!preset?.amount)
  const [account, setAccount] = useDefaultAccount(meta)
  const [date, setDate] = useState('')
  const [memo, setMemo] = useState('')
  const defaults = useFin<any>('fin_defaults', { party: party?.id, kind: docKind }, { enabled: !!party })
  const post = usePost(recv ? 'fin_receipt' : 'fin_payment', onClose, recv ? 'دریافت ثبت شد' : 'پرداخت ثبت شد')
  const docs: any[] = defaults.data?.open_docs ?? []
  const outstanding = doc === 'auto' ? defaults.data?.outstanding ?? 0 : docs.find((d) => String(d.id) === doc)?.outstanding ?? 0
  useEffect(() => { if (party && !touched && outstanding) setAmount(String(outstanding)) }, [party?.id, doc, outstanding]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const a = defaults.data?.last_payment?.money_account_id; if (a && !preset) setAccount(String(a)) }, [defaults.data?.last_payment?.money_account_id]) // eslint-disable-line react-hooks/exhaustive-deps
  const over = !!party && Number(amount) > outstanding
  return (
    <form className="grid gap-4" onSubmit={(e) => {
      e.preventDefault()
      if (!party) return toast.error('طرف حساب را انتخاب کنید')
      if (!amount) return toast.error('مبلغ را وارد کنید')
      if (over) return toast.error(recv ? 'بیشتر از مانده‌ی طلب نمی‌شود دریافت کرد' : 'بیشتر از مانده‌ی بدهی نمی‌شود پرداخت کرد')
      post.mutate({ party_id: party.id, amount, money_account: account, date, memo, allocations: doc === 'auto' ? {} : { [doc]: amount } })
    }}>
      <Field label={recv ? 'مشتری' : 'تأمین‌کننده'}><PartyPicker value={party} onChange={(p) => { setParty(p); setDoc('auto'); setTouched(false); setAmount('') }} role={recv ? 'customer' : 'supplier'} allowNew={false} /></Field>
      {party && (
        <div className="rounded-lg bg-muted/50 p-3 text-sm">
          {outstanding > 0 ? <>مانده‌ی {recv ? 'طلب' : 'بدهی'}: <b className="tabular">{fmtMoney(defaults.data?.outstanding ?? 0)}</b></> : <span className="text-muted-foreground">{recv ? 'این مشتری طلب بازی ندارد' : 'به این تأمین‌کننده بدهی بازی ندارید'}</span>}
        </div>
      )}
      {docs.length > 0 && (
        <Field label="تسویه‌ی کدام سند؟">
          <div className="grid gap-1.5">
            <button type="button" onClick={() => { setDoc('auto'); setTouched(false) }} data-on={doc === 'auto'} className="rounded-lg border p-2.5 text-start text-sm data-[on=true]:border-primary data-[on=true]:bg-primary/5">قدیمی‌ترین‌ها اول (خودکار)</button>
            {docs.map((d) => (
              <button key={d.id} type="button" onClick={() => { setDoc(String(d.id)); setTouched(false) }} data-on={doc === String(d.id)} className="flex items-center justify-between gap-2 rounded-lg border p-2.5 text-start text-sm data-[on=true]:border-primary data-[on=true]:bg-primary/5">
                <span><b>{d.ref}</b> · {fmtDay(d.txn_date)}{d.due_date ? ` · سررسید ${fmtDay(d.due_date)}` : ''}</span><span className="tabular">{fmtNum(d.outstanding)}</span>
              </button>
            ))}
          </div>
        </Field>
      )}
      <Field label="مبلغ" hint={over ? <span className="text-destructive">از مانده بیشتر است ({fmtMoney(outstanding)})</span> : undefined}><AmountInput value={amount} onChange={(v) => { setTouched(true); setAmount(v) }} autoFocus={!party} /></Field>
      <Grid>
        <Field label={recv ? 'دریافت در حساب' : 'پرداخت از حساب'}><AccountSelect value={account} onChange={setAccount} accounts={meta?.money_accounts} /></Field>
        <DateInput value={date} onChange={setDate} />
      </Grid>
      <Field label="توضیحات"><Input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="شماره‌ی فیش، …" /></Field>
      <Footer pending={post.isPending} label={recv ? 'ثبت دریافت' : 'ثبت پرداخت'} onClose={onClose} disabled={over} />
    </form>
  )
}

// ------------------------------------------------------------------ transfer

function TransferForm({ onClose }: { onClose: () => void }) {
  const meta = useMeta()
  const money = useFin<{ accounts: { id: number; name: string; balance: number }[] }>('fin_money').data?.accounts ?? []
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState('')
  const [ref, setRef] = useState('')
  const post = usePost('fin_transfer', onClose, 'انتقال ثبت شد')
  const bal = money.find((m) => String(m.id) === from)?.balance
  const over = bal !== undefined && Number(amount) > bal && !meta?.money_accounts.find((a) => String(a.id) === from && a.system_key === 'legacy_cash')
  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (!from || !to || !amount) return toast.error('حساب مبدأ، مقصد و مبلغ را وارد کنید'); if (from === to) return toast.error('حساب مبدأ و مقصد نباید یکی باشد'); post.mutate({ from_account: from, to_account: to, amount, date, reference: ref }) }}>
      <Grid>
        <Field label="از حساب" hint={bal !== undefined ? `موجودی: ${fmtMoney(bal)}` : undefined}><AccountSelect value={from} onChange={setFrom} accounts={meta?.money_accounts} /></Field>
        <Field label="به حساب"><AccountSelect value={to} onChange={setTo} accounts={meta?.money_accounts.filter((a) => String(a.id) !== from)} /></Field>
      </Grid>
      <Field label="مبلغ" hint={over ? <span className="text-destructive">از موجودی حساب بیشتر است</span> : 'انتقال هزینه یا درآمد حساب نمی‌شود'}><AmountInput value={amount} onChange={setAmount} autoFocus /></Field>
      <Grid><DateInput value={date} onChange={setDate} /><Field label="شماره‌ی پیگیری"><Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="اختیاری" /></Field></Grid>
      <Footer pending={post.isPending} label="ثبت انتقال" onClose={onClose} disabled={over} />
    </form>
  )
}

// ------------------------------------------------------------------ capital

function CapitalForm({ onClose, preset }: { onClose: () => void; preset?: Preset }) {
  const meta = useMeta()
  const [dir, setDir] = useState<'in' | 'out'>(preset?.direction ?? 'in')
  const [party, setParty] = useState<{ id: number; name: string } | null>(preset?.party ?? null)
  const [amount, setAmount] = useState('')
  const [account, setAccount] = useDefaultAccount(meta)
  const [date, setDate] = useState('')
  const [memo, setMemo] = useState('')
  const post = usePost('fin_capital', onClose, dir === 'in' ? 'ورود سرمایه ثبت شد' : 'برداشت ثبت شد')
  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (!amount) return toast.error('مبلغ را وارد کنید'); post.mutate({ direction: dir, party_id: party?.id, amount, money_account: account, date, memo }) }}>
      <Chips value={dir} onChange={setDir} options={[['in', 'ورود سرمایه / سرمایه‌گذاری'], ['out', 'برداشت صاحب سرمایه']]} />
      <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">{dir === 'in' ? 'سرمایه درآمد حساب نمی‌شود و در سود تأثیری ندارد؛ جدا در بخش سرمایه ثبت می‌شود.' : 'برداشت صاحب سرمایه هزینه نیست؛ از حقوق صاحبان سرمایه کم می‌شود.'}</p>
      <Field label="شریک / صاحب سرمایه"><PartyPicker value={party} onChange={setParty} role="partner" defaultRole="partner" placeholder="انتخاب شریک" /></Field>
      <Field label="مبلغ"><AmountInput value={amount} onChange={setAmount} autoFocus /></Field>
      <Grid><Field label={dir === 'in' ? 'واریز به حساب' : 'برداشت از حساب'}><AccountSelect value={account} onChange={setAccount} accounts={meta?.money_accounts} /></Field><DateInput value={date} onChange={setDate} /></Grid>
      <Field label="توضیحات"><Input value={memo} onChange={(e) => setMemo(e.target.value)} /></Field>
      <Footer pending={post.isPending} label={dir === 'in' ? 'ثبت ورود سرمایه' : 'ثبت برداشت'} onClose={onClose} />
    </form>
  )
}

// ------------------------------------------------------------------ party

export function PartyForm({ onClose, initial }: { onClose: () => void; initial?: { id?: number; name: string; roles: string[]; phone?: string; tg_user_id?: string; note?: string } }) {
  const meta = useMeta()
  const [name, setName] = useState(initial?.name ?? '')
  const [roles, setRoles] = useState<string[]>(initial?.roles ?? ['customer'])
  const [phone, setPhone] = useState(initial?.phone ?? '')
  const [tg, setTg] = useState(initial?.tg_user_id ?? '')
  const [note, setNote] = useState(initial?.note ?? '')
  const post = usePost('fin_party_save', onClose, 'ذخیره شد')
  const toggle = (r: string) => setRoles((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]))
  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return toast.error('نام را وارد کنید'); post.mutate({ id: initial?.id, name, roles, phone, tg_user_id: tg, note }) }}>
      <Field label="نام"><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
      <Field label="نقش‌ها" hint="یک نفر می‌تواند هم مشتری باشد، هم تأمین‌کننده، هم شریک">
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(meta?.roles ?? {}).map(([k, l]) => <button key={k} type="button" onClick={() => toggle(k)} data-on={roles.includes(k)} className={cn('rounded-full border px-3 py-1.5 text-sm hover:bg-accent data-[on=true]:border-primary data-[on=true]:bg-primary/10 data-[on=true]:font-medium')}>{l}</button>)}
        </div>
      </Field>
      <Grid>
        <Field label="شماره تماس"><Input dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <Field label="آیدی عددی تلگرام" hint="برای اتصال به مشتری ربات"><Input dir="ltr" inputMode="numeric" value={tg} onChange={(e) => setTg(e.target.value.replace(/\D/g, ''))} /></Field>
      </Grid>
      <Field label="یادداشت"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <Footer pending={post.isPending} label="ذخیره" onClose={onClose} />
    </form>
  )
}

export { Banknote, can }
