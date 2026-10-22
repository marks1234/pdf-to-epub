/**
 * How long an object URL stays alive after the click. Firefox and Safari can
 * cancel an in-flight download if the URL is revoked synchronously, so hold on
 * to it well past the point the browser has committed to the save.
 */
const REVOKE_DELAY_MS = 60_000

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
  // Deferred: revoking here would abort the download in Firefox/Safari.
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS)
}
