<template>
  <div class="sc-body" v-html="html"></div>
</template>

<script setup>
// Body-only renderer for a scenario's BBO-flavoured @chat text. The window frame
// (drag / resize / dock / float / close) is provided by DockablePanel; this is
// just the formatted text that goes in its slot.
import { computed } from 'vue'

const props = defineProps({
  // Raw @chat block text from the .btn file.
  text: { type: String, default: '' }
})

// Render the @chat text: !C/!D/!H/!S → coloured suit symbols,
// "--- Heading" lines → a heading, URLs → links. Line breaks preserved.
const SUIT = { C: ['♣', 'sc-black'], D: ['♦', 'sc-red'], H: ['♥', 'sc-red'], S: ['♠', 'sc-black'], N: ['NT', ''] }
function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function inline(s) {
  let h = esc(s).replace(/!([CDHSN])/g, (_, k) => {
    const [sym, cls] = SUIT[k]
    return cls ? `<span class="${cls}">${sym}</span>` : sym
  })
  h = h.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
  return h
}
const html = computed(() =>
  (props.text || '').split('\n').map(line => {
    const t = line.match(/^---\s*(.+)$/)
    return t ? `<div class="sc-heading">${inline(t[1])}</div>` : inline(line)
  }).join('\n')
)
</script>

<style scoped>
.sc-body {
  padding: 16px 18px;
  font-size: 18px;
  line-height: 1.55;
  color: #222;
  white-space: pre-wrap;
}

.sc-body :deep(.sc-heading) {
  font-weight: 700;
  font-size: 20px;
  margin-bottom: 8px;
  color: #1b4332;
}
.sc-body :deep(.sc-red) { color: #d32f2f; }
.sc-body :deep(.sc-black) { color: #000; }
.sc-body :deep(a) { color: #1976d2; }
</style>
