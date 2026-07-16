import { describe, it, expect, vi } from 'vitest'
import { useBackdropClose } from '../useBackdropClose.js'

// The overlay element stands in for both event.target and event.currentTarget.
const overlay = { id: 'overlay' }
const inner = { id: 'textarea' }
const down = (target) => ({ target, currentTarget: overlay })
const clickSelf = () => ({ target: overlay, currentTarget: overlay }) // @click.self guarantees this

describe('useBackdropClose', () => {
  it('closes on a genuine backdrop press-and-release', () => {
    const onClose = vi.fn()
    const { onBackdropMouseDown, onBackdropClick } = useBackdropClose(onClose)
    onBackdropMouseDown(down(overlay)) // pressed on the backdrop
    onBackdropClick(clickSelf())
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does NOT close when the press started inside the modal (text-drag out)', () => {
    const onClose = vi.fn()
    const { onBackdropMouseDown, onBackdropClick } = useBackdropClose(onClose)
    onBackdropMouseDown(down(inner)) // press began on the textarea; bubbles to overlay
    onBackdropClick(clickSelf()) // release over the backdrop → click lands on overlay
    expect(onClose).not.toHaveBeenCalled()
  })

  it('resets between interactions (a drag-out does not arm the next click)', () => {
    const onClose = vi.fn()
    const { onBackdropMouseDown, onBackdropClick } = useBackdropClose(onClose)
    onBackdropMouseDown(down(inner))
    onBackdropClick(clickSelf())
    expect(onClose).not.toHaveBeenCalled()
    // A later click with no fresh backdrop mousedown must not close either.
    onBackdropClick(clickSelf())
    expect(onClose).not.toHaveBeenCalled()
    // A fresh genuine backdrop press then closes.
    onBackdropMouseDown(down(overlay))
    onBackdropClick(clickSelf())
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
