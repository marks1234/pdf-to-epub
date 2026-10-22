import { Monitor, Moon, Sun } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { Theme } from "@/hooks/use-theme"

const ICON: Record<Theme, typeof Sun> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
}

const LABEL: Record<Theme, string> = {
  system: "System theme",
  light: "Light theme",
  dark: "Dark theme",
}

const NEXT: Record<Theme, Theme> = {
  system: "light",
  light: "dark",
  dark: "system",
}

interface ThemeToggleProps {
  theme: Theme
  onCycle: () => void
  className?: string
}

/** Compact header button cycling system → light → dark. */
export function ThemeToggle({ theme, onCycle, className }: ThemeToggleProps) {
  const Icon = ICON[theme]
  const label = `${LABEL[theme]} — switch to ${LABEL[NEXT[theme]].toLowerCase()}`

  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      className={className}
      onClick={onCycle}
      aria-label={label}
      title={label}
    >
      <Icon className="size-4" />
    </Button>
  )
}
