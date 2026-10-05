import * as React from 'react'
import { cn } from '@/lib/utils'

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...p }, ref) => (
  <div ref={ref} className={cn('rounded-xl border bg-card text-card-foreground shadow-sm', className)} {...p} />
))
Card.displayName = 'Card'
const CardHeader = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('flex flex-col gap-1.5 p-4 md:p-6', className)} {...p} />
const CardTitle = ({ className, ...p }: React.HTMLAttributes<HTMLHeadingElement>) => <h3 className={cn('font-semibold leading-none tracking-tight', className)} {...p} />
const CardDescription = ({ className, ...p }: React.HTMLAttributes<HTMLParagraphElement>) => <p className={cn('text-sm text-muted-foreground', className)} {...p} />
const CardContent = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('p-4 pt-0 md:p-6 md:pt-0', className)} {...p} />
export { Card, CardHeader, CardTitle, CardDescription, CardContent }
