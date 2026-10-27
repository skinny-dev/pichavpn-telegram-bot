import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'

export function StatCard({ icon: Icon, label, value, hint, tone }: { icon: LucideIcon; label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: 'default' | 'success' | 'warn' | 'danger' }) {
  return (
    <Card className="p-3 md:p-4">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground md:text-sm">
        <span className="truncate">{label}</span>
        <Icon className={cn('size-4 shrink-0', tone === 'success' && 'text-success', tone === 'danger' && 'text-destructive', tone === 'warn' && 'text-amber-500')} />
      </div>
      <div className="mt-1.5 break-words text-base font-bold md:mt-2 md:text-lg leading-tight tabular tracking-tight sm:text-2xl">{value}</div>
      {hint && <div className="mt-1 truncate text-[11px] text-muted-foreground md:text-xs">{hint}</div>}
    </Card>
  )
}
