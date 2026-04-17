import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"

const Tabs = TabsPrimitive.Root

type TabsVariant = "default" | "page"

type TabsListProps = React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & {
  variant?: TabsVariant
}

type TabsTriggerProps = React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & {
  variant?: TabsVariant
}

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  TabsListProps
>(({ className, variant = "default", ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      variant === "page"
        ? "inline-flex items-center gap-6"
        : "inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground",
      className
    )}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  TabsTriggerProps
>(({ className, variant = "default", ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      variant === "page"
        ? "inline-flex items-center justify-center whitespace-nowrap border-b-2 border-transparent px-1 pb-3 pt-4 text-[14px] font-medium text-slate-400 ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:border-slate-300 hover:text-slate-600 data-[state=active]:border-sky-600 data-[state=active]:text-sky-700 dark:text-white/40 dark:hover:border-white/20 dark:hover:text-white/70 dark:data-[state=active]:border-sky-400 dark:data-[state=active]:text-sky-300"
        : "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
      className
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
