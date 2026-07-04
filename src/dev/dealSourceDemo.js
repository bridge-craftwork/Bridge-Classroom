// Dev-only harness to preview DealSourcePicker in isolation (not shipped).
// Serve via `npm run dev` → /deal-source-demo.html.
import { createApp, h, ref } from 'vue'
import DealSourcePicker from '@/components/dealSource/DealSourcePicker.vue'

const App = {
  setup() {
    const selection = ref({ items: [], options: {} })
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
            tabs: ['favorites', 'history', 'scenarios', 'curated', 'clubgames', 'library', 'pbn', 'random'],
            options: ['fresh'],
          },
          layout: 'compact',
          actionLabel: 'Deal',
          onSubmit: (s) => console.log('submit →', JSON.stringify(s)),
        }),
      )
  },
}

createApp(App).mount('#app')
