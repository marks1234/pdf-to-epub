import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Minimal controlled tabs, styled like shadcn/ui's Tabs. The panels stay
 * mounted and are shown/hidden by the caller, so switching tabs never discards
 * queue or dropzone state.
 */
function TabsList({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="tabs-list"
      role="tablist"
      className={cn(
        "inline-flex h-9 w-full items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground",
        className,
      )}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  active = false,
  ...props
}: React.ComponentProps<"button"> & { active?: boolean }) {
  return (
    <button
      data-slot="tabs-trigger"
      type="button"
      role="tab"
      aria-selected={active}
      data-state={active ? "active" : "inactive"}
      className={cn(
        "inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  )
}

export { TabsList, TabsTrigger }
