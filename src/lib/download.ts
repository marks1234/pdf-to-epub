/** Trigger a browser download for a Blob or byte array. */
export function downloadBlob(
  data: Blob | Uint8Array,
  filename: string,
  mimeType = "application/octet-stream",
): void {
  const blob =
    data instanceof Blob ? data : new Blob([data as BlobPart], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
