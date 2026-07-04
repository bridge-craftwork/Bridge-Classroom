// Dev-only harness to preview DealSourcePicker in isolation (not shipped).
// Serve via `npm run dev` → /deal-source-demo.html.
import { createApp, h, ref } from 'vue'
import DealSourcePicker from '@/components/dealSource/DealSourcePicker.vue'

const App = {
  setup() {
    // Pre-populate a mixed pool so the tray + options + action all read populated.
    const selection = ref({
      items: [
        { kind: 'scenario', repo: 'pbs', file: 'Stayman', label: 'Stayman' },
        { kind: 'scenario', repo: 'pbs', file: 'Jacoby_Transfers', label: 'Jacoby Transfers' },
        { kind: 'random', label: 'Random' },
      ],
      options: { drawOrder: 'sequential', mode: 'bid-and-play', fresh: false },
    })
    return () =>
      h(
        'div',
        {
          // Top-anchored (not vertically centered) so the tab row stays put and
          // the body expands downward as tabs change — mirrors how a real modal
          // host should anchor the picker.
          style:
            'min-height:100vh;background:#eef1f4;display:flex;align-items:flex-start;justify-content:center;padding:32px 24px;box-sizing:border-box',
        },
        h(DealSourcePicker, {
          modelValue: selection.value,
          'onUpdate:modelValue': (v) => (selection.value = v),
          allow: {
            tabs: ['scenarios', 'curated', 'clubgames', 'library', 'pbn', 'random'],
            options: ['mode', 'drawOrder', 'fresh'],
          },
          layout: 'compact',
          actionLabel: 'Deal',
          onSubmit: (s) => console.log('submit', s),
        }),
      )
  },
}

createApp(App).mount('#app')
