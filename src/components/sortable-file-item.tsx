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
  onRemove: (id: string) => void
  disabled?: boolean
}

export function SortableFileItem({
  item,
  index,
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
      className={cn(
        "flex items-center gap-2 bg-background p-3",
        isDragging && "relative z-10 rounded-md shadow-lg ring-1 ring-border",
      )}
    >
      <button
        type="button"
        className={cn(
          "touch-none rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          disabled ? "cursor-not-allowed opacity-50" : "cursor-grab active:cursor-grabbing",
        )}
        aria-label="Drag to reorder"
        disabled={disabled}
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
        onClick={() => onRemove(item.id)}
        disabled={disabled}
        aria-label={`Remove ${item.file.name}`}
      >
        <Trash2 className="size-4" />
      </Button>
    </li>
  )
}
