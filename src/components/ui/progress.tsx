import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Determinate progress bar, styled like shadcn/ui's Progress but without the
 * Radix dependency — the app only ever needs a filled track.
 *
 * `value` is a percentage; anything outside 0–100 is clamped. An indeterminate
 * bar is deliberately not supported: the point of this component is to replace
 * the spinner that told the user nothing.
 */
function Progress({
  value,
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & { value: number }) {
  const pct = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0))
  return (
    <div
      data-slot="progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className={cn(
        "h-2 w-full overflow-hidden rounded-full bg-primary/20",
        className,
      )}
      {...props}
    >
      <div
        data-slot="progress-indicator"
        className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export { Progress }
