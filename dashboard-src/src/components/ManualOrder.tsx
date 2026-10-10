import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, Copy, Loader2, Plus } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { fmtNum, fmtToman, normalizeDigits } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface Options { panels: { name: string; type: string; active: boolean }[]; products: { id: number; name: string; price: number; volume: number; days: number; location: string; category: string }[] }
interface Created { id: string; username: string; sub_link: string; sub_page: string; configs: string[] }
const EMPTY = { panel: '', product_id: '', username: '', customer: '', contact: '', tg_user_id: '', price: '', note: '' }

/** «سفارش دستی»: creates the account on the VPN panel + the order, for customers with no Telegram account. */
export function ManualOrder() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [f, setF] = useState(EMPTY)
  const [done, setDone] = useState<Created | null>(null)
  const [copied, setCopied] = useState('')
  const opts = useQuery({ queryKey: ['order-options'], queryFn: () => api<Options>('order_options'), enabled: open })
  const set = (p: Partial<typeof EMPTY>) => setF((x) => ({ ...x, ...p }))
  const products = (opts.data?.products ?? []).filter((p) => !f.panel || p.location === f.panel || p.location === '/all')
  const product = products.find((p) => String(p.id) === f.product_id)

  const create = useMutation({
    mutationFn: () => api<Created>('order_create', { body: { ...f, price: f.price === '' ? undefined : f.price } }),
    onSuccess: (r) => { setDone(r); toast.success('سفارش ساخته شد'); qc.invalidateQueries({ queryKey: ['list'] }); qc.invalidateQueries({ queryKey: ['rows'] }) },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'ساخت سفارش ناموفق بود'),
  })
  async function copy(key: string, text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(''), 1500) } catch { toast.error('کپی نشد') }
  }
  const close = () => { setOpen(false); setDone(null); setF(EMPTY) }

  return (
    <>
      <Button onClick={() => setOpen(true)}><Plus />سفارش دستی</Button>
      <Dialog open={open} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{done ? 'سفارش ساخته شد' : 'سفارش دستی'}</DialogTitle>
            <DialogDescription>{done ? 'لینک را برای مشتری بفرستید.' : 'برای مشتری بیرون از تلگرام (اینستاگرام، تلفن، حضوری). آیدی تلگرام لازم نیست.'}</DialogDescription>
          </DialogHeader>
          {done ? (
            <div className="grid min-w-0 gap-3 text-sm">
              <div>نام سرویس: <b dir="ltr">{done.username}</b></div>
              {[['لینک اشتراک', done.sub_link], ['صفحهٔ وضعیت مشتری', done.sub_page]].map(([k, v]) => (
                <div key={k} className="grid min-w-0 gap-1">
                  <span className="text-xs text-muted-foreground">{k}</span>
                  <div className="flex min-w-0 items-center gap-1">
                    <code className="min-w-0 flex-1 break-all rounded bg-muted px-2 py-1 text-xs" dir="ltr">{v}</code>
                    <Button variant="ghost" size="icon-sm" aria-label="کپی" onClick={() => copy(k, v)}>{copied === k ? <Check /> : <Copy />}</Button>
                  </div>
                </div>
              ))}
              <DialogFooter><Button onClick={close}>بستن</Button></DialogFooter>
            </div>
          ) : (
            <form className="grid min-w-0 gap-4" onSubmit={(e) => { e.preventDefault(); create.mutate() }}>
              <div className="grid gap-2">
                <Label>پنل (سرور)</Label>
                <Select value={f.panel} onValueChange={(v) => set({ panel: v, product_id: '' })}>
                  <SelectTrigger><SelectValue placeholder="انتخاب پنل" /></SelectTrigger>
                  <SelectContent>{opts.data?.panels.filter((p) => p.active).map((p) => <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>محصول</Label>
                <Select value={f.product_id} onValueChange={(v) => set({ product_id: v, price: '' })} disabled={!f.panel}>
                  <SelectTrigger><SelectValue placeholder="انتخاب محصول" /></SelectTrigger>
                  <SelectContent>{products.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name} — {fmtNum(p.volume)}GB / {fmtNum(p.days)} روز</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid gap-2"><Label htmlFor="mo-price">مبلغ (تومان) — خالی = قیمت محصول{product ? ` (${fmtToman(product.price)})` : ''}</Label><Input id="mo-price" dir="ltr" inputMode="numeric" value={f.price} onChange={(e) => set({ price: normalizeDigits(e.target.value) })} /></div>
              <div className="grid gap-2"><Label htmlFor="mo-cus">نام مشتری</Label><Input id="mo-cus" value={f.customer} onChange={(e) => set({ customer: e.target.value })} placeholder="مثلاً علی (اینستاگرام)" /></div>
              <div className="grid gap-2"><Label htmlFor="mo-con">راه ارتباط (اختیاری)</Label><Input id="mo-con" dir="auto" value={f.contact} onChange={(e) => set({ contact: e.target.value })} /></div>
              <div className="grid gap-2"><Label htmlFor="mo-un">نام سرویس (خالی = خودکار)</Label><Input id="mo-un" dir="ltr" value={f.username} placeholder="ext1a2b3c" onChange={(e) => set({ username: e.target.value })} /></div>
              <div className="grid gap-2"><Label htmlFor="mo-tg">آیدی عددی تلگرام (اختیاری)</Label><Input id="mo-tg" dir="ltr" inputMode="numeric" value={f.tg_user_id} onChange={(e) => set({ tg_user_id: normalizeDigits(e.target.value) })} /></div>
              <div className="grid gap-2"><Label htmlFor="mo-note">یادداشت</Label><Input id="mo-note" value={f.note} onChange={(e) => set({ note: e.target.value })} /></div>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={close}>انصراف</Button>
                <Button type="submit" disabled={create.isPending || !f.panel || !f.product_id}>{create.isPending && <Loader2 className="animate-spin" />}ساخت سفارش</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
