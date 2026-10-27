import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { KeyRound, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { api, ApiError, isServerless } from '@/lib/api'
import { normalizeDigits } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface Admin { id_admin: string; username: string; rule: string; tg_username: string; name: string; web_login: boolean; self: boolean }
interface Data { rows: Admin[]; roles: Record<string, string> }
interface Form { id: string; id_admin: string; username: string; rule: string; password: string }
const EMPTY: Form = { id: '', id_admin: '', username: '', rule: 'support', password: '' }

export default function Admins() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['admins'], queryFn: () => api<Data>('admins') })
  const [form, setForm] = useState<Form | null>(null)
  const roles = data?.roles ?? {}
  const err = (fallback: string) => (e: unknown) => toast.error(e instanceof ApiError ? e.message : fallback)

  const save = useMutation({
    mutationFn: (f: Form) => api('admin_save', { body: f }),
    onSuccess: () => { toast.success('ذخیره شد'); setForm(null); qc.invalidateQueries({ queryKey: ['admins'] }) },
    onError: err('ذخیره ناموفق بود'),
  })
  const del = useMutation({
    mutationFn: (id: string) => api('admin_delete', { body: { id } }),
    onSuccess: () => { toast.success('ادمین حذف شد'); qc.invalidateQueries({ queryKey: ['admins'] }) },
    onError: err('حذف ناموفق بود'),
  })

  const editing = !!form?.id
  const set = (p: Partial<Form>) => setForm((f) => (f ? { ...f, ...p } : f))

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 text-sm text-muted-foreground">
          «مدیر کل» به همه‌ی بخش‌های ربات و این پنل دسترسی دارد. «پشتیبان» با نام کاربری و رمز فقط به بخش «پشتیبانی» پنل وب دسترسی دارد (چت زنده با مشتری‌ها). «فروشنده» فقط در ربات کار می‌کند.
          ادمین جدید باید یک‌بار در ربات /start بزند تا پیام‌ها به او برسد.
        </p>
        <Button onClick={() => setForm(EMPTY)}><Plus />افزودن ادمین</Button>
      </div>

      {isLoading ? <Skeleton className="h-40 w-full" /> : (
        <div className="grid gap-2">
          {data?.rows.map((a) => (
            <div key={a.id_admin} className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tabular font-medium" dir="ltr">{a.id_admin}</span>
                  {a.name && <span className="text-sm">{a.name}</span>}
                  {a.tg_username && <span className="text-xs text-muted-foreground" dir="ltr">@{a.tg_username}</span>}
                  {a.self && <Badge>شما</Badge>}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant={a.rule === 'administrator' ? 'default' : 'secondary'}>{roles[a.rule]?.split(' (')[0] ?? a.rule}</Badge>
                  {a.web_login ? <span className="inline-flex items-center gap-1"><KeyRound className="size-3" /><span dir="ltr">{a.username}</span></span> : <span>فقط ربات</span>}
                </div>
              </div>
              <Button variant="ghost" size="icon-sm" aria-label="ویرایش" onClick={() => setForm({ id: a.id_admin, id_admin: a.id_admin, username: a.web_login ? a.username : '', rule: a.rule, password: '' })}><Pencil /></Button>
              <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" disabled={a.self || del.isPending} aria-label="حذف" title={a.self ? 'حساب خودتان قابل حذف نیست' : 'حذف'} onClick={() => confirm(`ادمین ${a.id_admin} حذف شود؟`) && del.mutate(a.id_admin)}><Trash2 /></Button>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'ویرایش ادمین' : 'افزودن ادمین'}</DialogTitle>
            <DialogDescription>نام کاربری و رمز فقط برای ورود به پنل وب لازم است (مدیر کل و پشتیبان).</DialogDescription>
          </DialogHeader>
          {form && (
            <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); save.mutate(form) }}>
              <div className="grid gap-2">
                <Label htmlFor="aid">آیدی عددی تلگرام</Label>
                <Input id="aid" dir="ltr" inputMode="numeric" value={form.id_admin} disabled={editing} onChange={(e) => set({ id_admin: normalizeDigits(e.target.value) })} required />
              </div>
              <div className="grid gap-2">
                <Label>نقش</Label>
                <Select value={form.rule} onValueChange={(v) => set({ rule: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(roles).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {!isServerless() && (form.rule === 'administrator' || form.rule === 'support') && (
                <>
                  <div className="grid gap-2">
                    <Label htmlFor="aun">نام کاربری پنل وب</Label>
                    <Input id="aun" dir="ltr" autoComplete="off" value={form.username} placeholder="مثلاً ali" onChange={(e) => set({ username: e.target.value })} />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="apw">{editing ? 'رمز جدید (خالی = بدون تغییر)' : 'رمز عبور'}</Label>
                    <Input id="apw" type="password" dir="ltr" autoComplete="new-password" minLength={8} value={form.password} placeholder="حداقل ۸ کاراکتر" onChange={(e) => set({ password: e.target.value })} />
                  </div>
                </>
              )}
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setForm(null)}>انصراف</Button>
                <Button type="submit" disabled={save.isPending || !form.id_admin}>{save.isPending && <Loader2 className="animate-spin" />}ذخیره</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
