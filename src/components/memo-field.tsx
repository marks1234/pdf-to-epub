import { X } from "lucide-react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface MemoFieldProps {
  id: string
  label: string
  value: string
  placeholder?: string
  onChange: (value: string) => void
  /** Remembered values for this field. */
  saved: string[]
  /** Remove a value from memory. */
  onForget: (value: string) => void
}

/**
 * A labelled text input with autocomplete from remembered values, plus a row of
 * chips for each saved value: click to reuse it, click the × to forget it.
 */
export function MemoField({
  id,
  label,
  value,
  placeholder,
  onChange,
  saved,
  onForget,
}: MemoFieldProps) {
  const listId = `${id}-saved`

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        list={listId}
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={listId}>
        {saved.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      {saved.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {saved.map((s) => (
            <span
              key={s}
              className="inline-flex items-center gap-1 rounded-full border bg-secondary py-0.5 pr-1 pl-2 text-xs"
            >
              <button
                type="button"
                className="max-w-[10rem] truncate hover:underline"
                onClick={() => onChange(s)}
                title={`Use "${s}"`}
              >
                {s}
              </button>
              <button
                type="button"
                className="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-destructive"
                onClick={() => onForget(s)}
                aria-label={`Forget "${s}"`}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
