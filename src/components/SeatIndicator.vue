<template>
  <div
    ref="root"
    class="seat-indicator"
    :class="{ 'is-turn': turn, 'is-you': you, 'is-empty': !name, centered: align === 'center', conn: connected === true, disc: connected === false }"
    :title="titleText"
  >
    <span class="si-badge">{{ seat }}</span>
    <span v-if="display" class="si-name">{{ display }}</span>
    <span class="si-adorn">
      <span
        v-if="connected === false"
        class="si-bot"
        title="Bot is playing this seat (player disconnected)"
        aria-label="bot playing"
      >🤖</span>
      <slot />
    </span>
  </div>
</template>

<script setup>
// Seat position indicator: a circular seat-letter badge + the occupant's name,
// where the name degrades responsively to whatever fits the available width:
//   First Last → First L. → First → First… → (just the seat letter).
// The seat badge is always shown, so the floor of the ladder is "badge only".
// Modelled on the Intobridge chip (badge + name pill).
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'

const props = defineProps({
  seat: { type: String, required: true, validator: v => ['N', 'E', 'S', 'W'].includes(v) },
  // Occupant name, or null for an empty/bot seat (then only the badge shows,
  // plus the `emptyLabel` if it fits).
  name: { type: String, default: null },
  // Label for an unoccupied seat (e.g. 'Bot'), shown when there's room.
  emptyLabel: { type: String, default: '' },
  you: { type: Boolean, default: false },
  turn: { type: Boolean, default: false },
  // 'start' (seats strip) | 'center' (centered pill above a hand, BBO-style).
  align: { type: String, default: 'start' },
  // Connection state (tri-state): true → green badge (seated & connected),
  // false → grey badge (disconnected), null → white (bot / no presence). Shown
  // ON the badge instead of a separate dot, so the name gets the full width.
  connected: { default: null },
})

const root = ref(null)
const avail = ref(9999) // px available to the name, measured from the container

// Build the fallback ladder (widest → narrowest) for a name string.
function forms(raw) {
  const name = (raw || '').trim()
  if (!name) return props.emptyLabel ? [props.emptyLabel] : []
  const words = name.split(/\s+/)
  const first = words[0]
  const out = [name] // First Last (or the whole handle)
  if (words.length > 1) {
    const lastInitial = words[words.length - 1][0]
    out.push(`${first} ${lastInitial}.`) // First L.
    out.push(first) // First
  }
  // Trimmed first name: progressively shorter with an ellipsis, down to 2 chars.
  for (let k = first.length - 1; k >= 2; k--) out.push(first.slice(0, k) + '…')
  return out
}

// Canvas text measurement using the name span's real font (no reflow thrash).
let canvasCtx = null
function measure(text, font) {
  if (!canvasCtx) canvasCtx = document.createElement('canvas').getContext('2d')
  canvasCtx.font = font
  return canvasCtx.measureText(text).width
}

const nameFont = ref('600 14px sans-serif')
function readFont() {
  const el = root.value?.querySelector('.si-name')
  if (el) nameFont.value = getComputedStyle(el).font || nameFont.value
}

// Pick the widest ladder form that fits the available width; '' = badge only.
const display = computed(() => {
  const ladder = forms(props.name)
  for (const form of ladder) {
    if (measure(form, nameFont.value) <= avail.value) return form
  }
  return ''
})

const titleText = computed(() => {
  const n = (props.name || '').trim()
  if (n) {
    if (props.connected === false) return `${n} — disconnected, bot playing`
    return props.you ? `${n} (you)` : n
  }
  return props.emptyLabel || props.seat
})

let ro = null
function measureAvail() {
  const el = root.value
  if (!el) return
  const badge = el.querySelector('.si-badge')
  const cs = getComputedStyle(el)
  const gap = parseFloat(cs.columnGap || cs.gap || '0') || 0
  const padding = parseFloat(cs.paddingLeft || '0') + parseFloat(cs.paddingRight || '0')
  const badgeW = badge ? badge.getBoundingClientRect().width : 0
  const adorn = el.querySelector('.si-adorn')
  const adornW = adorn ? adorn.getBoundingClientRect().width : 0
  // Room left for the name after the badge, adornments, gaps and padding.
  avail.value = Math.max(0, el.clientWidth - padding - badgeW - adornW - gap * 2)
}

onMounted(async () => {
  await nextTick()
  readFont()
  measureAvail()
  if (typeof ResizeObserver !== 'undefined' && root.value) {
    ro = new ResizeObserver(() => measureAvail())
    ro.observe(root.value)
  }
})
watch(() => [props.name, props.emptyLabel, props.connected], async () => { await nextTick(); measureAvail() })
onBeforeUnmount(() => ro?.disconnect())
</script>

<style scoped>
.seat-indicator {
  display: flex;
  align-items: center;
  gap: calc(8px * var(--table-scale));
  width: 100%; /* fill the slot — the name degrades against the slot's width */
  min-width: 0;
}
.seat-indicator.centered {
  justify-content: center;
}
.si-badge {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: calc(22px * var(--table-scale));
  height: calc(22px * var(--table-scale));
  border-radius: 50%;
  background: #fff;
  color: #1a1a1a;
  font-weight: 700;
  font-size: calc(13px * var(--table-scale));
  line-height: 1;
  border: 1.5px solid rgba(0, 0, 0, 0.15);
}
/* Connection shown on the badge (no separate dot): green = connected. */
.seat-indicator.conn .si-badge {
  background: #1d9e75;
  color: #fff;
  border-color: #1d9e75;
}
.seat-indicator.disc .si-badge {
  background: #c0c4c0;
  color: #fff;
  border-color: #c0c4c0;
}
.si-name {
  flex: 0 1 auto;
  min-width: 0;
  font-weight: 600;
  font-size: calc(14px * var(--table-scale));
  white-space: nowrap;
  overflow: hidden;
}
.si-adorn {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: calc(6px * var(--table-scale));
}
.si-adorn:empty { display: none; }
.si-bot { font-size: calc(13px * var(--table-scale)); line-height: 1; filter: grayscale(0.2); }
/* Disconnected human: dim the name so a bot-covered seat reads as "not live". */
.seat-indicator.disc .si-name { color: #888; }

/* Emphasis states (kept subtle; hosts can override via the wrapper). */
.seat-indicator.is-turn .si-badge {
  border-color: #1565c0;
  box-shadow: 0 0 0 2px rgba(21, 101, 192, 0.25);
}
.seat-indicator.is-you .si-name { color: #1565c0; }
.seat-indicator.is-empty .si-name { color: #888; font-weight: 500; }
</style>
