import { Component, type ErrorInfo, type ReactNode } from "react"
import { RotateCw, TriangleAlert, Wrench } from "lucide-react"

import { Button } from "@/components/ui/button"

/** Every setting this app persists is namespaced under this prefix. */
const SETTINGS_PREFIX = "pdf2epub."

/**
 * Drop persisted settings (theme, remembered names, default style, style
 * profiles) and reload. Saved outputs live in IndexedDB and are untouched.
 */
function resetSettings(): void {
  try {
    const doomed: string[] = []
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (key?.startsWith(SETTINGS_PREFIX)) doomed.push(key)
    }
    for (const key of doomed) localStorage.removeItem(key)
  } catch {
    // Storage blocked — nothing to clear, just reload.
  }
  window.location.reload()
}

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Catches render/lifecycle crashes so a bad state reads as a recoverable error
 * instead of a white screen that looks like the saved outputs are gone.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Unhandled error:", error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex min-h-svh items-center justify-center bg-background p-4 text-foreground">
        <div
          role="alert"
          className="flex w-full max-w-md flex-col gap-4 rounded-xl border bg-card p-6 text-card-foreground shadow-sm"
        >
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-destructive/10 text-destructive">
              <TriangleAlert className="size-5" />
            </div>
            <div className="min-w-0 space-y-1">
              <h1 className="font-semibold leading-none">Something broke</h1>
              <p className="text-sm text-muted-foreground">
                The app hit an unexpected error. Your saved outputs are still on
                this device.
              </p>
            </div>
          </div>

          <p className="max-h-40 overflow-auto rounded-md bg-muted px-3 py-2 font-mono text-xs break-words text-muted-foreground">
            {error.message || String(error)}
          </p>

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={resetSettings}>
              <Wrench className="size-4" />
              Reset saved settings
            </Button>
            <Button onClick={() => window.location.reload()}>
              <RotateCw className="size-4" />
              Reload
            </Button>
          </div>
        </div>
      </div>
    )
  }
}
