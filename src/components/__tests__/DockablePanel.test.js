import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import DockablePanel from '../DockablePanel.vue'

function pressEscape(target = document.body) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
}

describe('DockablePanel Escape', () => {
  let w
  afterEach(() => { w?.unmount(); document.body.innerHTML = '' })

  it('closes on Escape, without the panel needing focus', () => {
    w = mount(DockablePanel, { props: { visible: true } })
    pressEscape()
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('ignores other keys', () => {
    w = mount(DockablePanel, { props: { visible: true } })
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    expect(w.emitted('close')).toBeUndefined()
  })

  it('does nothing while hidden, and listens again once shown', async () => {
    w = mount(DockablePanel, { props: { visible: false } })
    pressEscape()
    expect(w.emitted('close')).toBeUndefined()
    await w.setProps({ visible: true })
    pressEscape()
    expect(w.emitted('close')).toHaveLength(1)
    await w.setProps({ visible: false })
    pressEscape()
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('leaves Escape to a text field that has focus', () => {
    w = mount(DockablePanel, { props: { visible: true } })
    const field = document.body.appendChild(document.createElement('textarea'))
    pressEscape(field)
    expect(w.emitted('close')).toBeUndefined()
  })

  it('stops listening when unmounted', () => {
    w = mount(DockablePanel, { props: { visible: true } })
    const emitted = w.emitted()
    w.unmount()
    pressEscape()
    expect(emitted.close).toBeUndefined()
    w = null
  })
})
