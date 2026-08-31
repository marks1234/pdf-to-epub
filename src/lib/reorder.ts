/**
 * Reorder a list by dragging one item, optionally carrying a selected group.
 *
 * When `activeId` belongs to `selectedIds` and the selection has more than one
 * member, every selected item moves together (keeping their relative order) to
 * the drop position. Otherwise it's a plain single-item move.
 *
 * Returns the same array reference when nothing changes.
 */
export function moveGroup<T extends { id: string }>(
  list: readonly T[],
  selectedIds: ReadonlySet<string>,
  activeId: string,
  overId: string,
): readonly T[] {
  const activeIndex = list.findIndex((i) => i.id === activeId)
  const overIndex = list.findIndex((i) => i.id === overId)
  if (activeIndex < 0 || overIndex < 0) return list

  const group = selectedIds.has(activeId) && selectedIds.size > 1
  if (!group) {
    if (activeIndex === overIndex) return list
    const next = [...list]
    const [moved] = next.splice(activeIndex, 1)
    next.splice(overIndex, 0, moved)
    return next
  }

  const moving = list.filter((i) => selectedIds.has(i.id))
  const rest = list.filter((i) => !selectedIds.has(i.id))
  // Dropping onto another member of the group (or itself) is a no-op.
  const overPos = rest.findIndex((i) => i.id === overId)
  if (overPos < 0) return list

  const insertAt = activeIndex < overIndex ? overPos + 1 : overPos
  return [...rest.slice(0, insertAt), ...moving, ...rest.slice(insertAt)]
}

/** Ids in `list` order between two indices, inclusive, for shift-click ranges. */
export function rangeIds<T extends { id: string }>(
  list: readonly T[],
  a: number,
  b: number,
): string[] {
  const [lo, hi] = a <= b ? [a, b] : [b, a]
  return list.slice(lo, hi + 1).map((i) => i.id)
}
