import { useEffect, useState } from "react"
import { Pencil } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DEFAULT_RENAME_PATTERN, expandTitlePattern } from "@/lib/titles"

/** How many rows the live preview spells out before summarising the rest. */
const PREVIEW_ROWS = 4

interface RenameDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * File names of the rows the pattern will be applied to, in the order the
   * positions are counted — the selection when there is one, else the queue.
   */
  targets: string[]
  /** True when `targets` is a selection rather than the whole queue. */
  selectionOnly: boolean
  /** Receives one title per entry in `targets`, index-aligned. */
  onApply: (titles: string[]) => void
}

/**
 * Bulk-renames queued chapters from a pattern. Shows what the first few rows
 * will actually be called, because `{n}` versus `{num}` is exactly the kind of
 * choice nobody gets right without seeing the result.
 */
export function RenameDialog({
  open,
  onOpenChange,
  targets,
  selectionOnly,
  onApply,
}: RenameDialogProps) {
  const [pattern, setPattern] = useState(DEFAULT_RENAME_PATTERN)

  // Every visit starts from the default rather than the last session's edit.
  useEffect(() => {
    if (open) setPattern(DEFAULT_RENAME_PATTERN)
  }, [open])

  const titles = targets.map((name, i) => expandTitlePattern(pattern, i + 1, name))
  const canApply = titles.some((t) => t.length > 0)

  const apply = () => {
    onApply(titles)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="size-4" />
            Rename chapters
          </DialogTitle>
          <DialogDescription>
            {selectionOnly
              ? `Applies to the ${targets.length} selected file${
                  targets.length === 1 ? "" : "s"
                } only.`
              : `Applies to all ${targets.length} file${
                  targets.length === 1 ? "" : "s"
                } in the queue.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 pb-1">
          <div className="space-y-1.5">
            <Label htmlFor="rename-pattern">Pattern</Label>
            <Input
              id="rename-pattern"
              autoFocus
              value={pattern}
              placeholder={DEFAULT_RENAME_PATTERN}
              onChange={(e) => setPattern(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canApply) {
                  e.preventDefault()
                  apply()
                }
              }}
            />
            <p className="text-xs text-muted-foreground">
              <code className="rounded bg-muted px-1 py-0.5">{"{n}"}</code>{" "}
              position in this list ·{" "}
              <code className="rounded bg-muted px-1 py-0.5">{"{num}"}</code>{" "}
              number found in the file name (falls back to the position).
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Preview</Label>
            <ul className="space-y-1 rounded-md border bg-muted/40 p-2 text-xs">
              {targets.slice(0, PREVIEW_ROWS).map((name, i) => (
                <li key={name + i} className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {name}
                  </span>
                  <span className="shrink-0">→</span>
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {titles[i] || <em className="opacity-60">(empty)</em>}
                  </span>
                </li>
              ))}
              {targets.length > PREVIEW_ROWS && (
                <li className="text-muted-foreground">
                  … and {targets.length - PREVIEW_ROWS} more
                </li>
              )}
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={apply} disabled={!canApply}>
            Rename {targets.length} file{targets.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
