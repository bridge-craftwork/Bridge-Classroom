<template>
  <!-- The docked context region: lesson commentary, table chat, or teacher
       controls. One shell owns which mode is live (keyed on engine.capabilities
       upstream); this component just renders the mode it's given. It absorbs
       MainLayout's inline commentary and the scenario description panel. -->
  <section class="context-panel" :class="'mode-' + mode">
    <header class="cp-head">
      <h3>{{ title || defaultTitle }}</h3>
    </header>

    <!-- Commentary: colorized teaching prose. -->
    <div v-if="mode === 'commentary'" class="cp-commentary">
      <p v-for="(para, i) in paragraphs" :key="i" v-html="para"></p>
    </div>

    <!-- Chat: table messages, your own right-aligned. -->
    <ul v-else-if="mode === 'chat'" class="cp-chat">
      <li v-for="(m, i) in messages" :key="i" :class="{ own: m.own }">
        <span class="from">{{ m.from }}</span>
        <span class="msg">{{ m.text }}</span>
      </li>
    </ul>

    <!-- Teacher: an optional stat line + command buttons (display-only here). -->
    <div v-else-if="mode === 'teacher'" class="cp-teacher">
      <div v-if="stat" class="cp-stat">{{ stat }}</div>
      <div class="cp-actions">
        <button
          v-for="(a, i) in actions"
          :key="i"
          class="cp-btn"
          :class="a.kind ? 'kind-' + a.kind : null"
          type="button"
        >{{ a.label }}</button>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  mode: {
    type: String,
    default: 'commentary',
    validator: (v) => ['commentary', 'chat', 'teacher'].includes(v),
  },
  title: { type: String, default: null },
  // commentary
  text: { type: String, default: '' },
  // chat: [{ from, text, own }]
  messages: { type: Array, default: () => [] },
  // teacher
  stat: { type: String, default: null },
  actions: { type: Array, default: () => [] }, // [{ label, kind }]
})

const defaultTitle = computed(
  () => ({ commentary: 'Commentary', chat: 'Table chat', teacher: 'Teacher' }[props.mode]),
)

const esc = (s) =>
  String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))

// Colorize suit glyphs so teaching prose reads like the rest of the app.
function colorize(text) {
  return esc(text)
    .replace(/♠/g, '<span class="s-dark">♠</span>')
    .replace(/♣/g, '<span class="s-dark">♣</span>')
    .replace(/[♥♦]/g, (c) => `<span class="s-red">${c}</span>`)
}
const paragraphs = computed(() =>
  (props.text || '').split('\n').filter(Boolean).map(colorize),
)
</script>

<style scoped>
.context-panel {
  background: #fff;
  border: 1px solid #e6e8e3;
  border-radius: 12px;
  padding: 14px 16px;
  font-family: 'DM Sans', system-ui, sans-serif;
}
.cp-head h3 {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: #33403a;
  text-transform: uppercase;
}

.cp-commentary p {
  margin: 0 0 8px;
  font-size: 14.5px;
  line-height: 1.5;
  color: #384039;
}
.cp-commentary p:last-child { margin-bottom: 0; }
.cp-commentary :deep(.s-red) { color: #d43f30; }
.cp-commentary :deep(.s-dark) { color: #1a1a1a; }

.cp-chat { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 7px; }
.cp-chat li {
  display: flex; flex-direction: column;
  background: #f1f4f1; border-radius: 10px; padding: 6px 10px;
  align-self: flex-start; max-width: 85%;
}
.cp-chat li.own { align-self: flex-end; background: #e4f3ec; }
.cp-chat .from { font-size: 11px; font-weight: 700; color: #6a746d; }
.cp-chat .msg { font-size: 14px; color: #2c332e; }

.cp-teacher .cp-stat { font-size: 13px; color: #55605a; margin-bottom: 10px; }
.cp-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.cp-btn {
  font: 600 13px 'DM Sans', system-ui, sans-serif;
  border: 1px solid #cdd4ce; background: #f6f8f6; color: #33403a;
  border-radius: 8px; padding: 7px 13px; cursor: pointer;
}
.cp-btn.kind-primary { border-color: #1d9e75; background: #1d9e75; color: #fff; }
.cp-btn.kind-danger { border-color: #d9b0ab; background: #fbe6e3; color: #b1352a; }
</style>
