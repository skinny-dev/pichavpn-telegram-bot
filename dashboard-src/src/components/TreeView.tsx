import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { closestCorners, DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, useDroppable, useSensor, useSensors, type DragEndEvent, type DragOverEvent, type DragStartEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { toast } from 'sonner'
import { Check, ChevronDown, FolderPlus, GripVertical, Loader2, Package, Pencil, Plus, Trash2, X } from 'lucide-react'
import { api, ApiError, type Resource } from '@/lib/api'
import { fmtNum } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FieldInput } from '@/components/CellEditor'
import { CreateDialog } from '@/components/DataGrid'

interface P { id: number; name_product: string; price_product: string; Volume_constraint: string; Service_time: string; Location: string | null; category: string; agent: string }
interface C { id: number; remark: string; products: P[] }
interface TreeData { categories: C[]; uncategorized: P[] }

const UNCAT = 'c-uncat'
const cid = (id: number) => `c-${id}`
const pid = (id: number) => `p-${id}`

export function TreeView({ schema }: { schema: Record<string, Resource> }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['tree'], queryFn: () => api<TreeData & { ok: boolean }>('tree') })
  const [cats, setCats] = useState<C[]>([])
  const [uncat, setUncat] = useState<P[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [addCat, setAddCat] = useState(false)
  const [addProd, setAddProd] = useState<string | null>(null)
  const [editProd, setEditProd] = useState<P | null>(null)
  const dragging = useRef(false)

  useEffect(() => {
    if (q.data && !dragging.current) { setCats(q.data.categories); setUncat(q.data.uncategorized) }
  }, [q.data])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const lists = useMemo(() => {
    const m: Record<string, P[]> = { [UNCAT]: uncat }
    cats.forEach((c) => (m[cid(c.id)] = c.products))
    return m
  }, [cats, uncat])

  const setList = (container: string, next: P[]) => {
    if (container === UNCAT) setUncat(next)
    else setCats((cs) => cs.map((c) => (cid(c.id) === container ? { ...c, products: next } : c)))
  }
  const containerOf = (id: string): string | null => {
    if (id === UNCAT || id.startsWith('c-')) return id
    return Object.keys(lists).find((k) => lists[k].some((p) => pid(p.id) === id)) ?? null
  }

  const save = useMutation({
    mutationFn: (state: { cats: C[]; uncat: P[] }) =>
      api('tree_save', { body: { categories: state.cats.map((c) => ({ id: c.id, products: c.products.map((p) => p.id) })), uncategorized: state.uncat.map((p) => p.id) } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['list', 'products'] }); qc.invalidateQueries({ queryKey: ['list', 'categories'] }) },
    onError: (e) => { toast.error(e instanceof ApiError ? e.message : 'ترتیب ذخیره نشد'); qc.invalidateQueries({ queryKey: ['tree'] }) },
  })

  function onDragStart(e: DragStartEvent) { dragging.current = true; setActive(String(e.active.id)) }

  function onDragOver(e: DragOverEvent) {
    const a = String(e.active.id)
    const o = e.over ? String(e.over.id) : null
    if (!o || a.startsWith('c-')) return
    const from = containerOf(a), to = containerOf(o)
    if (!from || !to || from === to) return
    const item = lists[from].find((p) => pid(p.id) === a)!
    const target = lists[to]
    const idx = o.startsWith('c-') ? target.length : target.findIndex((p) => pid(p.id) === o)
    setList(from, lists[from].filter((p) => pid(p.id) !== a))
    setList(to, [...target.slice(0, idx < 0 ? target.length : idx), item, ...target.slice(idx < 0 ? target.length : idx)])
  }

  function onDragEnd(e: DragEndEvent) {
    dragging.current = false
    setActive(null)
    const a = String(e.active.id)
    const o = e.over ? String(e.over.id) : null
    if (!o) { qc.invalidateQueries({ queryKey: ['tree'] }); return }
    let nextCats = cats, nextUncat = uncat
    if (a.startsWith('c-')) {
      const target = o.startsWith('c-') ? o : containerOf(o)
      const from = cats.findIndex((c) => cid(c.id) === a), to = cats.findIndex((c) => cid(c.id) === target)
      if (from < 0 || to < 0 || from === to) return
      nextCats = arrayMove(cats, from, to)
      setCats(nextCats)
    } else {
      const container = containerOf(a)
      if (container && !o.startsWith('c-')) {
        const list = lists[container]
        const from = list.findIndex((p) => pid(p.id) === a), to = list.findIndex((p) => pid(p.id) === o)
        if (from >= 0 && to >= 0 && from !== to) {
          const moved = arrayMove(list, from, to)
          if (container === UNCAT) { nextUncat = moved; setUncat(moved) }
          else { nextCats = cats.map((c) => (cid(c.id) === container ? { ...c, products: moved } : c)); setCats(nextCats) }
        }
      }
    }
    save.mutate({ cats: nextCats, uncat: nextUncat })
  }

  const activeItem = active
    ? active.startsWith('c-') ? { kind: 'cat' as const, c: cats.find((c) => cid(c.id) === active)! } : { kind: 'prod' as const, p: Object.values(lists).flat().find((p) => pid(p.id) === active)! }
    : null

  if (q.isLoading) return <div className="grid gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
  if (q.isError) return <p className="text-destructive">بارگذاری ناموفق بود</p>

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">برای جابجایی، دسته یا محصول را با دستگیره بکشید (در موبایل چند لحظه نگه دارید). تغییرات خودکار ذخیره می‌شود.</p>
        <div className="flex items-center gap-2">
          {save.isPending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          <Button onClick={() => setAddCat(true)}><FolderPlus />دسته جدید</Button>
        </div>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => { dragging.current = false; setActive(null); qc.invalidateQueries({ queryKey: ['tree'] }) }}>
        <SortableContext items={cats.map((c) => cid(c.id))} strategy={verticalListSortingStrategy}>
          {cats.map((c) => (
            <CategoryNode
              key={c.id}
              cat={c}
              collapsed={!!collapsed[c.id]}
              onToggle={() => setCollapsed((s) => ({ ...s, [c.id]: !s[c.id] }))}
              onAdd={() => setAddProd(c.remark)}
              onEditProduct={setEditProd}
              invalidate={() => qc.invalidateQueries({ queryKey: ['tree'] })}
            />
          ))}
        </SortableContext>
        <ProductList containerId={UNCAT} title="بدون دسته‌بندی" products={uncat} onEditProduct={setEditProd} onAdd={() => setAddProd('')} muted invalidate={() => qc.invalidateQueries({ queryKey: ['tree'] })} />
        <DragOverlay>
          {activeItem?.kind === 'prod' && activeItem.p && <ProductRow p={activeItem.p} overlay />}
          {activeItem?.kind === 'cat' && activeItem.c && <div className="rounded-xl border bg-card p-3 font-medium shadow-lg">{activeItem.c.remark}</div>}
        </DragOverlay>
      </DndContext>

      <CreateDialog open={addCat} onOpenChange={setAddCat} resName="categories" res={schema.categories} />
      <CreateDialog open={addProd !== null} onOpenChange={(o) => !o && setAddProd(null)} resName="products" res={schema.products} initial={{ category: addProd ?? '' }} />
      <ProductEditDialog p={editProd} res={schema.products} onClose={() => setEditProd(null)} onSaved={() => qc.invalidateQueries({ queryKey: ['tree'] })} />
    </div>
  )
}

function CategoryNode({ cat, collapsed, onToggle, onAdd, onEditProduct, invalidate }: { cat: C; collapsed: boolean; onToggle: () => void; onAdd: () => void; onEditProduct: (p: P) => void; invalidate: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: cid(cat.id) })
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(cat.remark)
  const qc = useQueryClient()
  useEffect(() => setName(cat.remark), [cat.remark])
  const rename = useMutation({
    mutationFn: () => api('update', { body: { res: 'categories', id: String(cat.id), field: 'remark', value: name } }),
    onSuccess: () => { setRenaming(false); invalidate(); qc.invalidateQueries({ queryKey: ['list'] }) },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'تغییر نام ناموفق بود'),
  })
  const del = useMutation({
    mutationFn: () => api('delete', { body: { res: 'categories', id: String(cat.id) } }),
    onSuccess: () => { toast.success('دسته حذف شد'); invalidate() },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'حذف ناموفق بود'),
  })
  return (
    <section ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn('rounded-xl border bg-card', isDragging && 'opacity-40')}>
      <header className="flex items-center gap-1.5 p-2 ps-1">
        <button className="touch-none cursor-grab rounded p-2 text-muted-foreground hover:bg-accent active:cursor-grabbing" aria-label="جابجایی دسته" {...attributes} {...listeners}><GripVertical className="size-4" /></button>
        <button onClick={onToggle} className="rounded p-1.5 text-muted-foreground hover:bg-accent" aria-label={collapsed ? 'باز کردن' : 'بستن'} aria-expanded={!collapsed}><ChevronDown className={cn('size-4 transition-transform', collapsed && 'rotate-90')} /></button>
        {renaming ? (
          <form className="flex flex-1 items-center gap-1" onSubmit={(e) => { e.preventDefault(); rename.mutate() }}>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && (setRenaming(false), setName(cat.remark))} className="h-9 min-w-0 flex-1 rounded-md border border-ring bg-background px-2 text-sm" aria-label="نام دسته" />
            <Button size="icon-sm" type="submit" disabled={rename.isPending} aria-label="ذخیره"><Check /></Button>
            <Button size="icon-sm" type="button" variant="ghost" onClick={() => { setRenaming(false); setName(cat.remark) }} aria-label="انصراف"><X /></Button>
          </form>
        ) : (
          <>
            <h3 className="min-w-0 flex-1 truncate font-semibold">{cat.remark}</h3>
            <Badge variant="secondary">{fmtNum(cat.products.length)} محصول</Badge>
            <Button variant="ghost" size="icon-sm" onClick={() => setRenaming(true)} aria-label="تغییر نام"><Pencil /></Button>
            <Button variant="ghost" size="icon-sm" onClick={onAdd} aria-label="افزودن محصول"><Plus /></Button>
            <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" disabled={cat.products.length > 0 || del.isPending} title={cat.products.length ? 'ابتدا محصولات را منتقل کنید' : 'حذف دسته'} onClick={() => confirm(`دسته «${cat.remark}» حذف شود؟`) && del.mutate()} aria-label="حذف دسته"><Trash2 /></Button>
          </>
        )}
      </header>
      {!collapsed && <ProductList containerId={cid(cat.id)} products={cat.products} onEditProduct={onEditProduct} invalidate={invalidate} bare />}
    </section>
  )
}

function ProductList({ containerId, products, onEditProduct, onAdd, title, muted, bare, invalidate }: { containerId: string; products: P[]; onEditProduct: (p: P) => void; onAdd?: () => void; title?: string; muted?: boolean; bare?: boolean; invalidate: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: containerId })
  const body = (
    <SortableContext items={products.map((p) => pid(p.id))} strategy={verticalListSortingStrategy}>
      <ul ref={setNodeRef} className={cn('grid min-h-12 gap-1.5 p-2 pt-0', isOver && 'rounded-lg bg-primary/5')}>
        {products.map((p) => <SortableProduct key={p.id} p={p} onEdit={() => onEditProduct(p)} invalidate={invalidate} />)}
        {products.length === 0 && <li className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">محصولی نیست — اینجا رها کنید</li>}
      </ul>
    </SortableContext>
  )
  if (bare) return body
  if (muted && products.length === 0) return null
  return (
    <section className={cn('rounded-xl border bg-card', muted && 'border-dashed')}>
      <header className="flex items-center justify-between gap-2 p-3"><h3 className="font-semibold text-muted-foreground">{title}</h3>{onAdd && <Button variant="ghost" size="icon-sm" onClick={onAdd} aria-label="افزودن محصول"><Plus /></Button>}</header>
      {body}
    </section>
  )
}

function SortableProduct({ p, onEdit, invalidate }: { p: P; onEdit: () => void; invalidate: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: pid(p.id) })
  const del = useMutation({
    mutationFn: () => api('delete', { body: { res: 'products', id: String(p.id) } }),
    onSuccess: () => { toast.success('محصول حذف شد'); invalidate() },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'حذف ناموفق بود'),
  })
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn(isDragging && 'opacity-30')}>
      <ProductRow p={p} handle={{ ...attributes, ...listeners }} onEdit={onEdit} onDelete={() => confirm(`محصول «${p.name_product}» حذف شود؟`) && del.mutate()} />
    </li>
  )
}

function ProductRow({ p, handle, onEdit, onDelete, overlay }: { p: P; handle?: Record<string, unknown>; onEdit?: () => void; onDelete?: () => void; overlay?: boolean }) {
  return (
    <div className={cn('flex items-center gap-1.5 rounded-lg border bg-background p-1.5 ps-1', overlay && 'shadow-lg ring-2 ring-primary')}>
      <button className="touch-none cursor-grab rounded p-2 text-muted-foreground hover:bg-accent active:cursor-grabbing" aria-label="جابجایی محصول" {...handle}><GripVertical className="size-4" /></button>
      <Package className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{p.name_product}</p>
        <p className="truncate text-xs text-muted-foreground tabular">{fmtNum(p.Volume_constraint)} گیگ · {fmtNum(p.Service_time)} روز · {fmtNum(p.price_product)} تومان</p>
      </div>
      {onEdit && <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label="ویرایش محصول"><Pencil /></Button>}
      {onDelete && <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" onClick={onDelete} aria-label="حذف محصول"><Trash2 /></Button>}
    </div>
  )
}

function ProductEditDialog({ p, res, onClose, onSaved }: { p: P | null; res: Resource; onClose: () => void; onSaved: () => void }) {
  const fields = res.cols.filter((c) => c.edit && c.key !== 'category' && c.key !== 'sort_order')
  const [v, setV] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (p) setV(Object.fromEntries(fields.map((c) => [c.key, String((p as any)[c.key] ?? '')]))) }, [p]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!p) return null
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      for (const c of fields) {
        const cur = String((p as any)[c.key] ?? '')
        if (v[c.key] !== undefined && v[c.key] !== cur) await api('update', { body: { res: 'products', id: String(p!.id), field: c.key, value: v[c.key] } })
      }
      toast.success('ذخیره شد')
      onSaved(); onClose()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'ذخیره ناموفق بود')
    } finally { setBusy(false) }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>ویرایش محصول</DialogTitle></DialogHeader>
        <form className="grid gap-3" onSubmit={submit}>
          {fields.map((c) => (
            <label key={c.key} className="grid gap-1.5 text-sm"><span className="font-medium">{c.label}</span><FieldInput col={c} value={v[c.key] ?? ''} onChange={(x) => setV((s) => ({ ...s, [c.key]: x }))} /></label>
          ))}
          <DialogFooter className="mt-2"><Button type="submit" disabled={busy}>{busy && <Loader2 className="animate-spin" />}ذخیره</Button><Button type="button" variant="outline" onClick={onClose}>انصراف</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
