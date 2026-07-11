// DOM rasterization wrapper (spec §4). Lazy-loads `modern-screenshot` so the
// rasterizer is only pulled into the bundle on demand — in Slice 0 the beetle is
// dev-only, so this never reaches a production build's critical path.
//
// Best-effort by contract: returns null on any failure. A report without a
// screenshot is still useful; a screenshot must never break report capture.

/**
 * Capture the current page as a downscaled JPEG blob.
 *
 * Captured at report time, BEFORE any report dialog covers the screen — the
 * caller invokes this on the beetle tap and only then opens UI.
 *
 * @param {HTMLElement} [target=document.body]
 * @param {object} [opts]
 * @param {number} [opts.quality=0.8]  JPEG quality.
 * @param {number} [opts.maxWidth=1600] Max output width in px; larger pages are scaled down.
 * @returns {Promise<Blob|null>}
 */
export async function captureScreenshot(target = document?.body, opts = {}) {
  const { quality = 0.8, maxWidth = 1600 } = opts
  if (!target) return null

  // Capture-time style normalization. DOM rasterizers re-lay-out text themselves
  // and mishandle `letter-spacing` on inline runs — the HandDisplay's cellular
  // hand (`.cards { letter-spacing: 1px }`, `.cell { display: inline }`) then
  // renders with overlapping/ghosted ranks. Forcing letter-spacing to normal for
  // the capture removes the trigger; killing transitions/animations is cheap
  // insurance against catching a mid-transition frame. The style is applied for
  // the ~single frame of capture and removed immediately, so any on-screen shift
  // is imperceptible (and the screenshot is "approximate" by contract anyway).
  const freeze = document.createElement('style')
  freeze.textContent =
    '*,*::before,*::after{transition:none!important;animation:none!important;}' +
    // The cellular hand renders each card as `.cell { display: inline }` in a
    // space-joined run. DOM rasterizers reconstruct inline-text positions
    // themselves and stack the glyphs (ghosted/overlapping ranks). Promoting the
    // cells to inline-block for the capture gives each card its own box, which
    // the rasterizer positions correctly — this is the verified fix (letter-
    // spacing:normal is a harmless extra normalization). Capture-only; reverted
    // in the finally below.
    '.cell{display:inline-block!important;}' +
    '.cards{letter-spacing:normal!important;}'

  try {
    document.head.appendChild(freeze)
    void target.offsetWidth // force reflow so the override is live before capture
    const { domToBlob } = await import('modern-screenshot')
    const width = target.scrollWidth || target.clientWidth || maxWidth
    const scale = Math.min(1, maxWidth / Math.max(1, width))
    return await domToBlob(target, {
      type: 'image/jpeg',
      quality,
      scale
    })
  } catch (err) {
    console.warn('[report] screenshot capture failed:', err)
    return null
  } finally {
    freeze.remove()
  }
}

/** Convert a Blob to a data URL (used by the single-file fallback sink). */
export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    if (!blob) return resolve(null)
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}
