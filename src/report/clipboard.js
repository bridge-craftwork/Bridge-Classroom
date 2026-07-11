// Best-effort clipboard write, shared by the dev sink (copy-first-then-save) and
// the dialog's manual fallback. Returns true on success.
//
// Tries the async Clipboard API first, then falls back to a hidden-textarea +
// execCommand('copy'), which tolerates more activation states (e.g. right after
// a file-picker consumed the transient activation on the very first save).
export async function writeClipboard(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    let ok = false
    try { ok = document.execCommand('copy') } catch { ok = false }
    ta.remove()
    return ok
  }
}
