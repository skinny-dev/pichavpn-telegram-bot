import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

const Tabs = TabsPrimitive.Root
const TabsList = React.forwardRef<React.ElementRef<typeof TabsPrimitive.List>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>>(({ className, ...p }, ref) => (
  <TabsPrimitive.List ref={ref} className={cn('inline-flex h-10 items-center rounded-lg bg-muted p-1 text-muted-foreground', className)} {...p} />
))
TabsList.displayName = 'TabsList'
const TabsTrigger = React.forwardRef<React.ElementRef<typeof TabsPrimitive.Trigger>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>>(({ className, ...p }, ref) => (
  <TabsPrimitive.Trigger ref={ref} className={cn('inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-all data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm', className)} {...p} />
))
TabsTrigger.displayName = 'TabsTrigger'
const TabsContent = React.forwardRef<React.ElementRef<typeof TabsPrimitive.Content>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>>(({ className, ...p }, ref) => (
  <TabsPrimitive.Content ref={ref} className={cn('mt-4', className)} {...p} />
))
TabsContent.displayName = 'TabsContent'
export { Tabs, TabsList, TabsTrigger, TabsContent }
