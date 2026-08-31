import type { MouseEvent } from "react"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { FileText, GripVertical, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export interface PdfItem {
  id: string
  file: File
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

interface SortableFileItemProps {
  item: PdfItem
  index: number
  selected: boolean
  /** True for other members of the selection while their group is being dragged. */
  dimmed: boolean
  /** Number badge shown on the dragged row when it carries a group. */
  dragCount?: number
  onSelect: (e: MouseEvent) => void
  onRemove: (id: string) => void
  disabled?: boolean
}

export function SortableFileItem({
  item,
  index,
  selected,
  dimmed,
  dragCount,
  onSelect,
  onRemove,
  disabled,
}: SortableFileItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      onClick={onSelect}
      data-selected={selected || undefined}
      className={cn(
        "flex cursor-default items-center gap-2 p-3 transition-opacity",
        selected ? "bg-accent" : "bg-background",
        dimmed && "opacity-40",
        isDragging && "relative z-10 rounded-md shadow-lg ring-1 ring-border",
      )}
    >
      {isDragging && dragCount != null && dragCount > 1 && (
        <span className="absolute -top-2 -left-2 z-20 flex size-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground shadow">
          {dragCount}
        </span>
      )}
      <button
        type="button"
        className={cn(
          "touch-none rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          disabled ? "cursor-not-allowed opacity-50" : "cursor-grab active:cursor-grabbing",
        )}
        aria-label="Drag to reorder"
        disabled={disabled}
        onClick={(e) => e.stopPropagation()}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-5" />
      </button>

      <span className="w-6 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {index + 1}
      </span>

      <FileText className="size-5 shrink-0 text-muted-foreground" />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.file.name}</p>
        <p className="text-xs text-muted-foreground">{formatSize(item.file.size)}</p>
      </div>

      <Button
        variant="ghost"
        size="icon"
        className="shrink-0"
        onClick={(e) => {
          e.stopPropagation()
          onRemove(item.id)
        }}
        disabled={disabled}
        aria-label={`Remove ${item.file.name}`}
      >
        <Trash2 className="size-4" />
      </Button>
    </li>
  )
}
