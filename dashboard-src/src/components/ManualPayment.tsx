import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2, Plus } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { normalizeDigits } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const EMPTY = { price: '', method: 'کارت به کارت', id_user: '', note: '', add_balance: false }
const METHODS = ['کارت به کارت', 'نقد', 'درگاه بانکی', 'ارز دیجیتال', 'ثبت دستی']

/** Manual payment record; the customer may have no Telegram account. Optionally credits the wallet. */
export function ManualPayment() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [f, setF] = useState(EMPTY)
  const set = (p: Partial<typeof EMPTY>) => setF((x) => ({ ...x, ...p }))
  const save = useMutation({
    mutationFn: () => api('payment_create', { body: f }),
    onSuccess: () => { toast.success('پرداخت ثبت شد'); qc.invalidateQueries({ queryKey: ['list'] }); setOpen(false); setF(EMPTY) },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'ثبت ناموفق بود'),
  })
  return (
    <>
      <Button onClick={() => setOpen(true)}><Plus />ثبت پرداخت دستی</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ثبت پرداخت دستی</DialogTitle>
            <DialogDescription>آیدی تلگرام لازم نیست. فقط وقتی «شارژ کیف پول» روشن باشد موجودی کاربر تغییر می‌کند.</DialogDescription>
          </DialogHeader>
          <form className="grid min-w-0 gap-4" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
            <div className="grid gap-2"><Label htmlFor="mp-price">مبلغ (تومان)</Label><Input id="mp-price" dir="ltr" inputMode="numeric" value={f.price} onChange={(e) => set({ price: normalizeDigits(e.target.value) })} required /></div>
            <div className="grid gap-2">
              <Label htmlFor="mp-method">روش پرداخت</Label>
              <Input id="mp-method" value={f.method} onChange={(e) => set({ method: e.target.value })} list="mp-methods" />
              <datalist id="mp-methods">{METHODS.map((m) => <option key={m} value={m} />)}</datalist>
            </div>
            <div className="grid gap-2"><Label htmlFor="mp-user">آیدی عددی تلگرام (اختیاری)</Label><Input id="mp-user" dir="ltr" inputMode="numeric" value={f.id_user} onChange={(e) => set({ id_user: normalizeDigits(e.target.value) })} /></div>
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0"><div className="text-sm font-medium">شارژ کیف پول کاربر</div><div className="text-xs text-muted-foreground">نیاز به آیدی تلگرام دارد</div></div>
              <Switch checked={f.add_balance} onCheckedChange={(v) => set({ add_balance: v })} aria-label="شارژ کیف پول" />
            </div>
            <div className="grid gap-2"><Label htmlFor="mp-note">توضیح (نام مشتری، شماره پیگیری...)</Label><Input id="mp-note" value={f.note} onChange={(e) => set({ note: e.target.value })} /></div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>انصراف</Button>
              <Button type="submit" disabled={save.isPending || !f.price}>{save.isPending && <Loader2 className="animate-spin" />}ثبت</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
