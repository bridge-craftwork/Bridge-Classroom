// Backdrop-dismiss that doesn't fire on a text-drag ending outside the modal.
//
// The naive pattern `<div class="overlay" @click.self="close">` closes the modal
// whenever the *click* target is the overlay. But a `click` fires on the nearest
// common ancestor of its mousedown and mouseup — so selecting text inside the
// modal (mousedown on an input) and releasing over the backdrop (mouseup on the
// overlay) produces a click ON THE OVERLAY, silently closing the modal and losing
// in-progress work (2026-07-15 beetle report on ExerciseEditorModal).
//
// Fix: only dismiss when the press ALSO started on the backdrop. Bind both
// handlers on the overlay element:
//   <div class="modal-overlay" @mousedown="onBackdropMouseDown" @click.self="onBackdropClick">
// `@mousedown` (no `.self`) sees every press bubble up, so it records false when
// the press began inside the content; `@click.self` guarantees the click target
// is the overlay, so a true flag means a genuine backdrop press-and-release.
export function useBackdropClose(onClose) {
  let pressedOnBackdrop = false

  function onBackdropMouseDown(e) {
    // True only when the press landed on the overlay itself, not inside content.
    pressedOnBackdrop = e.target === e.currentTarget
  }

  function onBackdropClick() {
    // Paired with `@click.self`, so the click is already on the overlay; close
    // only if the press started there too. Reset regardless.
    const shouldClose = pressedOnBackdrop
    pressedOnBackdrop = false
    if (shouldClose) onClose()
  }

  return { onBackdropMouseDown, onBackdropClick }
}
