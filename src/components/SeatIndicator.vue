<template>
  <div
    ref="root"
    class="seat-indicator"
    :class="{ 'is-turn': turn, 'is-you': you, 'is-empty': !name, centered: align === 'center', conn: connected === true, disc: connected === false }"
    :title="titleText"
  >
    <span class="si-badge">{{ seat }}</span>
    <span
      v-if="display"
      class="si-name"
      :style="{ fontSize: `calc(14px * var(--table-scale) * ${nameScale})` }"
    >{{ display }}</span>
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

// Build the fallback ladder (widest → narrowest), tuned per occupant kind so we
// don't waste room on last initials nobody needs:
//   • bot / single-token handle ("BBA+Rules")  → the whole handle (font-shrinks
//        to fit); ellipsis only as a last resort.
//   • you (your own seat / the host)            → your full name, then your FIRST
//        name only — you don't need a last initial to recognise yourself.
//   • everyone else                             → "First L." (compact, privacy
//        friendly), then first name.
// The trailing rungs trim the first name with an ellipsis as a final resort.
function forms(raw, you) {
  const name = (raw || '').trim()
  if (!name) return props.emptyLabel ? [props.emptyLabel] : []
  const words = name.split(/\s+/)
  const first = words[0]
  const trimFirst = []
  for (let k = first.length - 1; k >= 2; k--) trimFirst.push(first.slice(0, k) + '…')
  if (words.length === 1) {
    const trimHandle = []
    for (let k = name.length - 1; k >= 2; k--) trimHandle.push(name.slice(0, k) + '…')
    return [name, ...trimHandle]
  }
  if (you) return [name, first, ...trimFirst] // full name → first name
  const lastInitial = words[words.length - 1][0]
  return [`${first} ${lastInitial}.`, first, ...trimFirst] // First L. → first
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
  const host = root.value
  const el = host?.querySelector('.si-name')
  if (!el || !host) return
  const cs = getComputedStyle(el)
  // Always measure at the BASE size, WITHOUT the per-name fit scale we apply
  // inline — otherwise the applied scale would feed back into the measurement.
  // Mirrors `.si-name { font-size: calc(14px * var(--table-scale)) }`; keep the
  // 14 in sync with that rule.
  const ts = parseFloat(getComputedStyle(host).getPropertyValue('--table-scale')) || 1
  nameFont.value = `${cs.fontWeight || '600'} ${14 * ts}px ${cs.fontFamily || 'sans-serif'}`
}

// A name may shrink to this fraction of its base size to fit BEFORE we drop to a
// shorter ladder rung — i.e. "reduce the font before truncating". Kept modest so
// names stay legible. This never touches card/panel sizing (the arranger owns
// that): a very long name shrinks/degrades, it does not make the hand narrower.
const NAME_MIN_SCALE = 0.72

// Walk the ladder widest→narrowest and take the first rung that fits at a font
// scale ≥ the floor. So a name that's only a little too wide is font-shrunk in
// place (bot handles, the host's full name); one that's far too wide drops to a
// shorter rung instead of becoming tiny.
const fit = computed(() => {
  const ladder = forms(props.name, props.you)
  if (!ladder.length) return { text: '', scale: 1 }
  const room = avail.value
  for (const form of ladder) {
    const w = measure(form, nameFont.value)
    if (w <= 0) return { text: form, scale: 1 }
    const needed = room / w
    if (needed >= 1) return { text: form, scale: 1 }
    if (needed >= NAME_MIN_SCALE) return { text: form, scale: needed }
  }
  // Even the narrowest rung won't fit at the floor — show it shrunk (clips via
  // overflow), still better than dropping to the bare badge.
  return { text: ladder[ladder.length - 1], scale: NAME_MIN_SCALE }
})
const display = computed(() => fit.value.text)
const nameScale = computed(() => fit.value.scale)

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
  // Flex gaps consumed: badge↔name always; name↔adorn only when the adorn is a
  // rendered item (it's `:empty` → display:none when there's no bot/count slot, so
  // it takes no width and no gap). Subtracting a fixed `gap * 2` shaved ~9px off the
  // name's true room and truncated a name that fits (e.g. "Declarer", 2026-07-13).
  const gaps = 1 + (adornW > 0 ? 1 : 0)
  avail.value = Math.max(0, el.clientWidth - padding - badgeW - adornW - gap * gaps)
}

// Measure AFTER layout + fonts settle, not just after nextTick. A single-nextTick
// measure reads a pre-settle (narrow) width — the box then stabilises, so the
// ResizeObserver never re-fires to correct it, and every relayout re-mounts and
// re-truncates at the unsettled size. A double rAF waits for the browser's
// layout/paint (same settle HandDisplay's measure uses); `readFont` re-runs too so a
// late web-font swap (which changes text metrics) is picked up.
function scheduleMeasure() {
  if (typeof requestAnimationFrame === 'undefined') { readFont(); measureAvail(); return }
  requestAnimationFrame(() => requestAnimationFrame(() => { readFont(); measureAvail() }))
}

onMounted(async () => {
  await nextTick()
  scheduleMeasure()
  // Web font may resolve after mount; its metrics differ from the fallback, so
  // re-measure once it's ready (no-op if already loaded).
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    document.fonts.ready.then(scheduleMeasure)
  }
  if (typeof ResizeObserver !== 'undefined' && root.value) {
    ro = new ResizeObserver(() => scheduleMeasure())
    ro.observe(root.value)
  }
})
watch(() => [props.name, props.emptyLabel, props.connected], async () => { await nextTick(); scheduleMeasure() })
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
