import * as React from 'react'
import * as M from '@radix-ui/react-dropdown-menu'
import { cn } from '@/lib/utils'

const DropdownMenu = M.Root
const DropdownMenuTrigger = M.Trigger
const DropdownMenuContent = React.forwardRef<React.ElementRef<typeof M.Content>, React.ComponentPropsWithoutRef<typeof M.Content>>(({ className, sideOffset = 6, ...p }, ref) => (
  <M.Portal>
    <M.Content ref={ref} sideOffset={sideOffset} className={cn('z-[60] min-w-[10rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md', className)} {...p} />
  </M.Portal>
))
DropdownMenuContent.displayName = 'DropdownMenuContent'
const DropdownMenuItem = React.forwardRef<React.ElementRef<typeof M.Item>, React.ComponentPropsWithoutRef<typeof M.Item>>(({ className, ...p }, ref) => (
  <M.Item ref={ref} className={cn('relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-2 text-sm outline-none data-[highlighted]:bg-accent [&_svg]:size-4', className)} {...p} />
))
DropdownMenuItem.displayName = 'DropdownMenuItem'
const DropdownMenuLabel = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('px-2 py-1.5 text-xs font-semibold text-muted-foreground', className)} {...p} />
const DropdownMenuSeparator = (p: React.ComponentPropsWithoutRef<typeof M.Separator>) => <M.Separator className="-mx-1 my-1 h-px bg-border" {...p} />
export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator }
