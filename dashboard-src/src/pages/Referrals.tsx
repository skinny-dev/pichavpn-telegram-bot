import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, Copy, Coins, Loader2, Megaphone, Pencil, Plus, Receipt, Trash2 } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { fmtNum, fmtToman, fmtTs, latinDigits, normalizeDigits } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface Link {
  id: number; name: string; platform: string; code: string; tg_user_id: string | null; contact: string | null
  price: number; pays_commission: number; commission_percent: number | null; active: number; notes: string | null; expense_id: number | null; expense_at: number | null; ad_date: number | null; created_at: number
  signups: number; buyers: number; orders: number; revenue: number; percent: number; commission: number; paid: number; due: number; cost: number; net: number; roi: number | null
}
interface Data { links: Link[]; global_percent: number; bot: string; tg_referrers: { id: string; username: string; count: number }[] }
interface Form { id: number; name: string; platform: string; code: string; tg_user_id: string; contact: string; price: string; pays_commission: boolean; commission_percent: string; active: boolean; notes: string; ad_date: string }
const EMPTY: Form = { id: 0, name: '', platform: 'instagram', code: '', tg_user_id: '', contact: '', price: '', pays_commission: false, commission_percent: '', active: true, notes: '', ad_date: '' }
const jDate = (ts: number | null | undefined) => (ts ? latinDigits(fmtTs(ts, true)) : '')
const PLATFORMS: Record<string, string> = { instagram: 'اینستاگرام', telegram: 'تلگرام', youtube: 'یوتیوب', tiktok: 'تیک‌تاک', website: 'سایت/وبلاگ', other: 'سایر' }

export default function Referrals() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['referrals'], queryFn: () => api<Data>('referrals') })
  const [form, setForm] = useState<Form | null>(null)
  const [pay, setPay] = useState<{ link: Link; amount: string; note: string } | null>(null)
  const [copied, setCopied] = useState('')
  const [bookFor, setBookFor] = useState<{ link: Link; date: string } | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['referrals'] })
  const err = (fallback: string) => (e: unknown) => toast.error(e instanceof ApiError ? e.message : fallback)
  const linkOf = (l: Link) => `https://t.me/${data?.bot ?? ''}?start=${l.code}`

  const save = useMutation({
    mutationFn: (f: Form) => api('referral_save', { body: { ...f, id: f.id || undefined } }),
    onSuccess: () => { toast.success('ذخیره شد'); setForm(null); refresh() },
    onError: err('ذخیره ناموفق بود'),
  })
  const del = useMutation({ mutationFn: (id: number) => api('referral_delete', { body: { id } }), onSuccess: () => { toast.success('حذف شد'); refresh() }, onError: err('حذف ناموفق بود') })
  const book = useMutation({ mutationFn: (b: { id: number; date: string }) => api('referral_book_cost', { body: b }), onSuccess: () => { toast.success('هزینه در حسابداری ثبت شد'); setBookFor(null); refresh() }, onError: err('ثبت هزینه ناموفق بود') })
  const payout = useMutation({
    mutationFn: (p: { id: number; amount: string; note: string }) => api('referral_payout', { body: p }),
    onSuccess: () => { toast.success('پرداخت پورسانت ثبت شد'); setPay(null); refresh() },
    onError: err('ثبت پرداخت ناموفق بود'),
  })

  async function copy(l: Link) {
    try { await navigator.clipboard.writeText(linkOf(l)); setCopied(l.code); setTimeout(() => setCopied(''), 1500) } catch { toast.error('کپی نشد') }
  }
  const set = (p: Partial<Form>) => setForm((f) => (f ? { ...f, ...p } : f))
  const total = (k: 'signups' | 'buyers' | 'revenue' | 'cost' | 'commission') => (data?.links ?? []).reduce((s, l) => s + l[k], 0)

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          برای هر اینفلوئنسر/تبلیغ یک لینک اختصاصی بسازید؛ نیازی به یوزرنیم یا اکانت تلگرام نیست (اینستاگرام و بیرون از تلگرام هم می‌شود).
          قیمت = هزینه‌ای که بابت تبلیغ می‌دهید. اگر «پورسانت دارد» روشن باشد، درصدی از فروش کاربرانی که از این لینک آمده‌اند برای او محاسبه می‌شود.
        </p>
        <Button onClick={() => setForm(EMPTY)}><Plus />لینک جدید</Button>
      </div>

      {data && data.links.length > 0 && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {[['ورودی‌ها', fmtNum(total('signups'))], ['خریداران', fmtNum(total('buyers'))], ['فروش', fmtToman(total('revenue'))], ['هزینهٔ تبلیغ', fmtToman(total('cost'))], ['پورسانت', fmtToman(total('commission'))]].map(([k, v]) => (
            <div key={k} className="min-w-0 rounded-xl border bg-card p-3"><div className="text-xs text-muted-foreground">{k}</div><div className="tabular truncate font-semibold">{v}</div></div>
          ))}
        </div>
      )}

      {isLoading ? <Skeleton className="h-40 w-full" /> : data?.links.length === 0 ? (
        <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground"><Megaphone className="mx-auto mb-2 size-8" />هنوز لینکی نساخته‌اید.</div>
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
          {data?.links.map((l) => (
            <li key={l.id} className={`min-w-0 rounded-xl border bg-card p-3 ${l.active ? '' : 'opacity-60'}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">{l.name}</span>
                <Badge variant="secondary">{PLATFORMS[l.platform] ?? l.platform}</Badge>
                {l.pays_commission ? <Badge>پورسانت {fmtNum(l.percent)}٪</Badge> : <Badge variant="outline">بدون پورسانت</Badge>}
                {!l.active && <Badge variant="outline">غیرفعال</Badge>}
              </div>
              <div className="mt-2 flex min-w-0 items-center gap-1">
                <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs" dir="ltr">{linkOf(l)}</code>
                <Button variant="ghost" size="icon-sm" aria-label="کپی لینک" onClick={() => copy(l)}>{copied === l.code ? <Check /> : <Copy />}</Button>
              </div>
              {l.ad_date ? <div className="mt-1 text-xs text-muted-foreground">تاریخ تبلیغ: <span dir="ltr">{jDate(l.ad_date)}</span></div> : null}
              {(l.contact || l.tg_user_id) && <div className="mt-1 text-xs text-muted-foreground" dir="auto">{l.contact}{l.tg_user_id ? ` · tg ${l.tg_user_id}` : ''}</div>}
              <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                {[['ورودی', fmtNum(l.signups)], ['خریدار', fmtNum(l.buyers)], ['سفارش', fmtNum(l.orders)], ['فروش', fmtToman(l.revenue)], ['هزینه', fmtToman(l.cost)], ['سود خالص', fmtToman(l.net)]].map(([k, v]) => (
                  <div key={k} className="min-w-0 rounded-lg bg-muted/50 p-2"><dt className="text-muted-foreground">{k}</dt><dd className="tabular truncate font-medium">{v}</dd></div>
                ))}
              </dl>
              {l.pays_commission ? (
                <div className="mt-2 text-xs text-muted-foreground">پورسانت: <b className="tabular">{fmtToman(l.commission)}</b> · پرداخت‌شده: <b className="tabular">{fmtToman(l.paid)}</b> · مانده: <b className="tabular">{fmtToman(l.due)}</b></div>
              ) : null}
              {l.roi !== null && <div className="mt-1 text-xs text-muted-foreground">بازده: <b className="tabular" dir="ltr">{fmtNum(l.roi)}٪</b></div>}
              <div className="mt-3 flex flex-wrap gap-1">
                <Button variant="outline" size="sm" onClick={() => setForm({ id: l.id, name: l.name, platform: l.platform, code: l.code, tg_user_id: l.tg_user_id ?? '', contact: l.contact ?? '', price: String(l.price), pays_commission: !!l.pays_commission, commission_percent: l.commission_percent === null ? '' : String(l.commission_percent), active: !!l.active, notes: l.notes ?? '', ad_date: jDate(l.ad_date) })}><Pencil />ویرایش</Button>
                {l.pays_commission && l.due > 0 ? <Button variant="outline" size="sm" onClick={() => setPay({ link: l, amount: String(l.due), note: '' })}><Coins />پرداخت پورسانت</Button> : null}
                {l.price > 0 && l.expense_id === null ? <Button variant="outline" size="sm" onClick={() => setBookFor({ link: l, date: jDate(l.ad_date ?? l.created_at) })}><Receipt />ثبت هزینه در حسابداری</Button> : null}
                {l.expense_id !== null && <Badge variant="outline" title="برای تغییر تاریخ، «ویرایش» و «تاریخ تبلیغ» را عوض کنید">هزینه ثبت شده · {jDate(l.expense_at)}</Badge>}
                <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" aria-label="حذف" onClick={() => confirm('این لینک حذف شود؟') && del.mutate(l.id)}><Trash2 /></Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {data && data.tg_referrers.length > 0 && (
        <div className="min-w-0 rounded-xl border bg-card p-3">
          <h3 className="mb-2 text-sm font-medium">دعوت‌کنندگان تلگرامی (رفرال عادی ربات، پورسانت {fmtNum(data.global_percent)}٪)</h3>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-1 text-sm sm:grid-cols-2">
            {data.tg_referrers.map((r) => <li key={r.id} className="flex min-w-0 justify-between gap-2"><span className="truncate" dir="ltr">{r.username ? `@${r.username}` : r.id}</span><span className="tabular">{fmtNum(r.count)} نفر</span></li>)}
          </ul>
        </div>
      )}

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form?.id ? 'ویرایش لینک' : 'لینک تبلیغاتی جدید'}</DialogTitle>
            <DialogDescription>فقط نام لازم است. آیدی تلگرام اختیاری است؛ برای اینستاگرام و سایر جاها خالی بگذارید.</DialogDescription>
          </DialogHeader>
          {form && (
            <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); save.mutate(form) }}>
              <div className="grid gap-2"><Label htmlFor="rn">نام (مثلاً پیج اینستاگرام علی)</Label><Input id="rn" value={form.name} onChange={(e) => set({ name: e.target.value })} required /></div>
              <div className="grid gap-2">
                <Label>پلتفرم</Label>
                <Select value={form.platform} onValueChange={(v) => set({ platform: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(PLATFORMS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid gap-2"><Label htmlFor="rc">راه ارتباط (اختیاری: آیدی اینستاگرام، شماره...)</Label><Input id="rc" dir="auto" value={form.contact} onChange={(e) => set({ contact: e.target.value })} /></div>
              <div className="grid gap-2"><Label htmlFor="rp">قیمت تبلیغ (تومان)</Label><Input id="rp" dir="ltr" inputMode="numeric" value={form.price} placeholder="۰" onChange={(e) => set({ price: normalizeDigits(e.target.value) })} /></div>
              <div className="grid gap-2"><Label htmlFor="rad">تاریخ تبلیغ (اختیاری، مثال 1405/07/14) — هزینه با همین تاریخ در حسابداری ثبت می‌شود</Label><Input id="rad" dir="ltr" inputMode="numeric" placeholder="1405/07/14" value={form.ad_date} onChange={(e) => set({ ad_date: latinDigits(e.target.value) })} /></div>
              <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0"><div className="text-sm font-medium">پورسانت دارد</div><div className="text-xs text-muted-foreground">درصدی از فروش کاربران این لینک</div></div>
                <Switch checked={form.pays_commission} onCheckedChange={(v) => set({ pays_commission: v })} aria-label="پورسانت دارد" />
              </div>
              {form.pays_commission && (
                <div className="grid gap-2"><Label htmlFor="rpc">درصد پورسانت (خالی = پیش‌فرض ربات: {fmtNum(data?.global_percent ?? 0)}٪)</Label><Input id="rpc" dir="ltr" inputMode="numeric" value={form.commission_percent} onChange={(e) => set({ commission_percent: normalizeDigits(e.target.value) })} /></div>
              )}
              <div className="grid gap-2"><Label htmlFor="rcode">کد لینک (خالی = خودکار؛ بعد از ساخت قابل تغییر نیست)</Label><Input id="rcode" dir="ltr" value={form.code} disabled={!!form.id} placeholder="ad_ali" onChange={(e) => set({ code: e.target.value })} /></div>
              <div className="grid gap-2"><Label htmlFor="rt">آیدی عددی تلگرام (اختیاری)</Label><Input id="rt" dir="ltr" inputMode="numeric" value={form.tg_user_id} onChange={(e) => set({ tg_user_id: normalizeDigits(e.target.value) })} /></div>
              <div className="grid gap-2"><Label htmlFor="rno">یادداشت</Label><Input id="rno" value={form.notes} onChange={(e) => set({ notes: e.target.value })} /></div>
              <div className="flex items-center justify-between gap-3"><Label>فعال</Label><Switch checked={form.active} onCheckedChange={(v) => set({ active: v })} aria-label="فعال" /></div>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setForm(null)}>انصراف</Button>
                <Button type="submit" disabled={save.isPending || !form.name.trim()}>{save.isPending && <Loader2 className="animate-spin" />}ذخیره</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!bookFor} onOpenChange={(o) => !o && setBookFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>ثبت هزینهٔ تبلیغ</DialogTitle><DialogDescription>{bookFor?.link.name} — {fmtToman(bookFor?.link.price)} در دستهٔ «تبلیغات»</DialogDescription></DialogHeader>
          {bookFor && (
            <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); book.mutate({ id: bookFor.link.id, date: bookFor.date }) }}>
              <div className="grid gap-2"><Label htmlFor="bd">تاریخ هزینه (مثال 1405/07/14 یا 1405/07/14 15:30)</Label><Input id="bd" dir="ltr" inputMode="numeric" value={bookFor.date} onChange={(e) => setBookFor({ ...bookFor, date: latinDigits(e.target.value) })} required /></div>
              <DialogFooter><Button type="button" variant="ghost" onClick={() => setBookFor(null)}>انصراف</Button><Button type="submit" disabled={book.isPending || !bookFor.date}>{book.isPending && <Loader2 className="animate-spin" />}ثبت هزینه</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!pay} onOpenChange={(o) => !o && setPay(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>پرداخت پورسانت</DialogTitle><DialogDescription>{pay?.link.name} — مانده: {fmtToman(pay?.link.due)}</DialogDescription></DialogHeader>
          {pay && (
            <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); payout.mutate({ id: pay.link.id, amount: pay.amount, note: pay.note }) }}>
              <div className="grid gap-2"><Label htmlFor="pa">مبلغ (تومان)</Label><Input id="pa" dir="ltr" inputMode="numeric" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: normalizeDigits(e.target.value) })} required /></div>
              <div className="grid gap-2"><Label htmlFor="pn">توضیح</Label><Input id="pn" value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} /></div>
              <DialogFooter><Button type="button" variant="ghost" onClick={() => setPay(null)}>انصراف</Button><Button type="submit" disabled={payout.isPending}>{payout.isPending && <Loader2 className="animate-spin" />}ثبت پرداخت</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
