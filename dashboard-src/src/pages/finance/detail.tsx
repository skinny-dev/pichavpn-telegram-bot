import { useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, Ban, HandCoins, Undo2, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { fmtNum } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AccountSelect, AmountInput, Field, Loading, Money, StateBadge, can, fmtDateTime, fmtDay, fmtMoney, useFin, useMeta, usePost } from './shared'
import type { Preset, ActionKey } from './forms'

const TYPE_LABEL: Record<string, string> = { sale: 'فروش', purchase: 'خرید / فاکتور خرید', expense: 'هزینه', income: 'درآمد', receipt: 'دریافت پول', payment: 'پرداخت پول', transfer: 'انتقال', capital_in: 'ورود سرمایه', capital_out: 'برداشت صاحب سرمایه',
  distribution: 'تقسیم سود', loan_in: 'دریافت وام', loan_out: 'پرداخت وام', loan_payment: 'قسط وام', refund_sale: 'برگشت از فروش', asset_purchase: 'خرید دارایی' }

interface Line { id: number; code: string; account_name: string; debit: string; credit: string; party_name: string | null; memo: string | null }

export function EntryDrawer({ target, onClose, onAction }: { target: { txn?: number; entry?: number } | null; onClose: () => void; onAction: (a: ActionKey, p?: Preset) => void }) {
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="md:max-w-2xl">{target && <Body target={target} onClose={onClose} onAction={onAction} />}</DialogContent>
    </Dialog>
  )
}

function Body({ target, onClose, onAction }: { target: { txn?: number; entry?: number }; onClose: () => void; onAction: (a: ActionKey, p?: Preset) => void }) {
  const meta = useMeta()
  const txnQ = useFin<any>('fin_txn', { id: target.txn }, { enabled: !!target.txn })
  const entryQ = useFin<any>('fin_entry', { id: target.entry }, { enabled: !target.txn && !!target.entry })
  const [mode, setMode] = useState<'view' | 'cancel' | 'refund'>('view')
  const [reason, setReason] = useState('')
  const [amount, setAmount] = useState('')
  const [account, setAccount] = useState('')
  const q = target.txn ? txnQ : entryQ
  const txn = txnQ.data?.txn
  const journal = target.txn ? txnQ.data?.journal : entryQ.data
  const done = () => { setMode('view'); setReason(''); }
  const cancel = usePost('fin_cancel', () => { done(); onClose() }, 'ابطال شد (سند برگشتی ثبت شد)')
  const refund = usePost('fin_refund', () => { done(); onClose() }, 'برگشت از فروش ثبت شد')
  if (q.isLoading || !(txn || journal)) return <Loading rows={3} />
  const entry = journal?.entry
  const lines: Line[] = journal?.lines ?? []
  const title = txn ? TYPE_LABEL[txn.type] ?? txn.type : entry?.title
  const total = txn ? Number(txn.total) : lines.reduce((a, l) => a + Number(l.debit), 0)
  const reversed = (txn ? txn.status : entry?.status) === 'reversed'
  const isDoc = txn && ['sale', 'purchase'].includes(txn.type)
  const canCancel = txn && txn.status === 'posted' && can(meta, 'sale.cancel') && !['depreciation'].includes(txn.type)
  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-2">{title}{txn?.ref && <span className="text-sm font-normal text-muted-foreground" dir="ltr">{txn.ref}</span>}{reversed && <Badge variant="secondary">ابطال‌شده</Badge>}{txn?.state && <StateBadge state={txn.state} />}</DialogTitle>
        <DialogDescription>{fmtDateTime(txn?.txn_date ?? entry?.entry_date)}{journal?.entry?.entry_no ? ` · سند ${journal.entry.entry_no}` : ''}</DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-2 gap-3 rounded-xl bg-muted/40 p-4">
        <div><div className="text-xs text-muted-foreground">مبلغ</div><Money value={total} size="lg" /> <span className="text-xs text-muted-foreground">تومان</span></div>
        {isDoc && <div><div className="text-xs text-muted-foreground">مانده</div><Money value={txn.outstanding} size="lg" className={txn.outstanding > 0 ? 'text-destructive' : 'text-success'} /></div>}
        {txnQ.data?.party && <div className="col-span-2 text-sm">{txn.type === 'purchase' || txn.type === 'payment' ? 'تأمین‌کننده' : 'طرف حساب'}: <b>{txnQ.data.party.name}</b></div>}
        {(txn?.memo || entry?.memo) && <div className="col-span-2 text-sm text-muted-foreground">{txn?.memo || entry?.memo}</div>}
        {isDoc && (Number(txn.tax) > 0 || Number(txn.discount) > 0) && <div className="col-span-2 text-xs text-muted-foreground">جمع {fmtNum(txn.subtotal)} · تخفیف {fmtNum(txn.discount)} · مالیات {fmtNum(txn.tax)}{txn.due_date ? ` · سررسید ${fmtDay(txn.due_date)}` : ''}</div>}
      </div>

      {txn?.meta?.items?.length > 0 && (
        <div className="grid gap-1 text-sm">
          <h3 className="font-semibold">اقلام</h3>
          {txn.meta.items.map((it: any, i: number) => <div key={i} className="flex justify-between gap-2 border-b py-1.5 last:border-0"><span>{it.name || 'بدون شرح'} × {it.qty}</span><span className="tabular">{fmtNum(it.total)}</span></div>)}
        </div>
      )}

      {(txnQ.data?.links?.length ?? 0) > 0 && (
        <div className="grid gap-1 text-sm">
          <h3 className="font-semibold">{isDoc ? 'پرداخت‌های این سند' : 'سندهای تسویه‌شده'}</h3>
          {txnQ.data.links.map((l: any) => <div key={l.id} className="flex justify-between gap-2 border-b py-1.5 last:border-0"><span>{l.ref} · {fmtDay(l.txn_date)}{l.status !== 'posted' ? ' (ابطال‌شده)' : ''}</span><span className="tabular">{fmtNum(l.amount)}</span></div>)}
        </div>
      )}
      {(txnQ.data?.children?.length ?? 0) > 0 && (
        <div className="grid gap-1 text-sm">
          <h3 className="font-semibold">برگشتی‌ها</h3>
          {txnQ.data.children.map((c: any) => <div key={c.id} className="flex justify-between gap-2 border-b py-1.5 last:border-0"><span>{c.ref} · {fmtDay(c.txn_date)}</span><span className="tabular">{fmtNum(c.total)}</span></div>)}
        </div>
      )}

      <div className="grid gap-1.5">
        <h3 className="text-sm font-semibold">اثر مالی <span className="font-normal text-muted-foreground">(سند حسابداری)</span></h3>
        <div className="overflow-hidden rounded-lg border text-sm">
          <div className="grid grid-cols-[1fr_6rem_6rem] gap-2 bg-muted/50 px-3 py-2 text-xs text-muted-foreground"><span>حساب</span><span className="text-end">بدهکار</span><span className="text-end">بستانکار</span></div>
          {lines.map((l) => (
            <div key={l.id} className="grid grid-cols-[1fr_6rem_6rem] items-center gap-2 border-t px-3 py-2">
              <span className="min-w-0"><span className="block truncate">{l.account_name}</span>{l.party_name && <span className="block truncate text-xs text-muted-foreground">{l.party_name}</span>}</span>
              <span className="text-end tabular">{Number(l.debit) ? fmtNum(l.debit) : ''}</span><span className="text-end tabular">{Number(l.credit) ? fmtNum(l.credit) : ''}</span>
            </div>
          ))}
        </div>
      </div>

      {(journal?.audit?.length ?? 0) > 0 && (
        <details className="text-sm"><summary className="cursor-pointer font-semibold">تاریخچه و ممیزی</summary>
          <ul className="mt-2 grid gap-1 text-xs text-muted-foreground">{journal.audit.map((a: any) => <li key={a.id}>{fmtDateTime(a.at)} · {a.user || 'سیستم'} · {a.action}{a.detail ? ` · ${String(a.detail).slice(0, 80)}` : ''}</li>)}</ul>
        </details>
      )}
      {!txn && entry && <p className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">این سند از اطلاعات قدیمی ربات (هزینه/پرداخت ثبت‌شده در سیستم قبلی) وارد شده است. برای ویرایش، همان رکورد را در بخش «حسابداری ← داده‌های قدیمی» تغییر دهید؛ سند خودکار اصلاح می‌شود.</p>}

      {mode === 'view' && txn?.status === 'posted' && (
        <div className="sticky bottom-0 -mx-5 -mb-5 flex flex-wrap gap-2 border-t bg-background px-5 py-3 md:static md:m-0 md:border-0 md:p-0">
          {txn.type === 'sale' && txn.outstanding > 0 && can(meta, 'payment.manage') && <Button onClick={() => { onClose(); onAction('receipt', { party: txnQ.data.party, docId: txn.id, amount: txn.outstanding }) }}><HandCoins />ثبت دریافت</Button>}
          {txn.type === 'purchase' && txn.outstanding > 0 && can(meta, 'payment.manage') && <Button onClick={() => { onClose(); onAction('payment', { party: txnQ.data.party, docId: txn.id, amount: txn.outstanding }) }}><Wallet />ثبت پرداخت</Button>}
          {txn.type === 'sale' && Number(txn.total) > Number(txn.returned) && can(meta, 'sale.cancel') && <Button variant="outline" onClick={() => { setMode('refund'); setAmount(String(Number(txn.total) - Number(txn.returned))) }}><Undo2 />برگشت از فروش</Button>}
          {canCancel && <Button variant="outline" className="text-destructive" onClick={() => setMode('cancel')}><Ban />ابطال</Button>}
        </div>
      )}
      {mode === 'cancel' && (
        <form className="grid gap-3 rounded-xl border border-destructive/40 p-3" onSubmit={(e) => { e.preventDefault(); if (!reason.trim()) return toast.error('دلیل ابطال را بنویسید'); cancel.mutate({ id: txn.id, reason }) }}>
          <p className="text-sm">با ابطال، یک سند برگشتی ثبت می‌شود و سابقه‌ی اصلی حذف نمی‌شود.</p>
          <Field label="دلیل ابطال"><Input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
          <div className="flex gap-2"><Button type="submit" variant="destructive" disabled={cancel.isPending}>ابطال تراکنش</Button><Button type="button" variant="outline" onClick={done}>انصراف</Button></div>
        </form>
      )}
      {mode === 'refund' && (
        <form className="grid gap-3 rounded-xl border p-3" onSubmit={(e) => { e.preventDefault(); refund.mutate({ sale_id: txn.id, amount, reason, money_account: account || undefined }) }}>
          <Field label="مبلغ برگشتی" hint={`حداکثر ${fmtMoney(Number(txn.total) - Number(txn.returned))}. ابتدا از مانده‌ی طلب کم می‌شود، بقیه از حساب پس داده می‌شود.`}><AmountInput value={amount} onChange={setAmount} /></Field>
          {Number(amount) > Number(txn.outstanding) && <Field label="پرداخت از حساب"><AccountSelect value={account} onChange={setAccount} accounts={meta?.money_accounts} /></Field>}
          <Field label="دلیل"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <div className="flex gap-2"><Button type="submit" disabled={refund.isPending}>ثبت برگشت</Button><Button type="button" variant="outline" onClick={done}>انصراف</Button></div>
        </form>
      )}
      <span className="sr-only"><ArrowDownLeft /><ArrowUpRight /></span>
    </div>
  )
}
