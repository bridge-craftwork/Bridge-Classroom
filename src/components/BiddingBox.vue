<template>
  <div ref="root" class="bidding-box" :class="{ disabled, tight }" :style="fitStyle">
    <div class="bid-section">
      <!-- Level buttons -->
      <div class="levels">
        <button
          v-for="level in 7"
          :key="level"
          class="level-btn"
          :class="{ active: selectedLevel === level }"
          @click="selectLevel(level)"
        >
          {{ level }}
        </button>
      </div>

      <!-- Strain buttons -->
      <div class="strains">
        <button
          v-for="strain in strains"
          :key="strain.value"
          class="strain-btn"
          :class="[strain.colorClass, { disabled: !canBid(selectedLevel, strain.value) }]"
          :disabled="!canBid(selectedLevel, strain.value)"
          @click="makeBid(selectedLevel, strain.value)"
        >
          <span v-html="strain.display"></span>
        </button>
      </div>
    </div>

    <!-- Special bids -->
    <div class="special-bids">
      <button
        class="special-btn pass"
        @click="$emit('bid', 'Pass')"
      >
        Pass
      </button>
      <!-- Double and redouble are mutually exclusive (you double an opponent's
           bid, or redouble their double — never both), so a single control
           covers both: it shows X to double, and switches to XX when there's a
           double in place to redouble. Labelled as on a physical bidding box. -->
      <button
        class="special-btn"
        :class="canRedouble ? 'redouble' : 'double'"
        :disabled="!canDouble && !canRedouble"
        :title="canRedouble ? 'Redouble' : 'Double'"
        @click="$emit('bid', canRedouble ? 'XX' : 'X')"
      >
        {{ canRedouble ? 'XX' : 'X' }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { biddingBoxReservePx } from './biddingBoxMetrics.js'

const props = defineProps({
  lastBid: {
    type: String,
    default: null
  },
  lastBidWasDouble: {
    type: Boolean,
    default: false
  },
  lastBidWasRedouble: {
    type: Boolean,
    default: false
  },
  canDouble: {
    type: Boolean,
    default: false
  },
  canRedouble: {
    type: Boolean,
    default: false
  },
  // Greyed + non-interactive when it's not this player's turn (the box stays
  // visible so the UI doesn't collapse to a "waiting" message).
  disabled: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['bid'])

const selectedLevel = ref(1)

// ── Responsive fit (Rick, 2026-07-11): when the box is crowded, GIVE UP THE GAPS
// between cards before shrinking the cards. Most bidding boxes have no gap anyway,
// so adjacent cards at tight widths is fine. Only if even the no-gap form won't fit
// (e.g. 1.5× in a narrow tile) do we "cheat on the font increase" — cap the
// effective scale so the structure fits, buttons and all. Measured on the PARENT
// (never our own width, never container-type — the #88 rule).
const root = ref(null)
const containerW = ref(Infinity)
const tableScale = ref(1)
let ro = null
onMounted(() => {
  if (root.value) {
    const s = parseFloat(getComputedStyle(root.value).getPropertyValue('--table-scale'))
    if (s > 0) tableScale.value = s
  }
  const el = root.value?.parentElement || root.value
  if (typeof ResizeObserver === 'undefined' || !el) return
  ro = new ResizeObserver((e) => { containerW.value = e[0].contentRect.width })
  ro.observe(el)
})
onBeforeUnmount(() => ro?.disconnect())

const NAT_GAPS = biddingBoxReservePx()                    // ~222 (with inter-card gaps)
const NAT_NOGAP = biddingBoxReservePx(undefined, { gaps: false }) // ~210 (cards adjacent)
// Step 1: collapse the gaps once the gapped form no longer fits.
const tight = computed(() => containerW.value < NAT_GAPS * tableScale.value)
// Step 2: only if the no-gap form still overflows, cap the effective scale so it
// fits (never above the requested scale, never below a legibility floor).
const fitScale = computed(() => {
  const want = tableScale.value
  if (containerW.value >= NAT_NOGAP * want) return want
  return Math.max(0.65, containerW.value / NAT_NOGAP)
})
// The box drives its sizes off --bb-scale (= the capped effective scale) instead of
// the raw --table-scale, and zeroes the gap when tight.
const fitStyle = computed(() => ({
  '--bb-scale': fitScale.value,
  '--btn-gap': tight.value ? '0px' : `calc(3px * ${fitScale.value})`,
}))

const strains = [
  { value: 'C', display: '♣', colorClass: 'suit-black' },
  { value: 'D', display: '♦', colorClass: 'suit-red' },
  { value: 'H', display: '♥', colorClass: 'suit-red' },
  { value: 'S', display: '♠', colorClass: 'suit-black' },
  { value: 'NT', display: 'NT', colorClass: 'suit-nt' }
]

const lastBidLevel = computed(() => {
  if (!props.lastBid) return 0
  const match = props.lastBid.match(/^(\d)/)
  return match ? parseInt(match[1], 10) : 0
})

const lastBidStrainRank = computed(() => {
  if (!props.lastBid) return -1
  const strainOrder = ['C', 'D', 'H', 'S', 'NT', 'N']
  const match = props.lastBid.match(/\d([CDHSN]T?)$/i)
  if (!match) return -1
  const strain = match[1].toUpperCase()
  return strainOrder.indexOf(strain === 'N' ? 'NT' : strain)
})

function selectLevel(level) {
  selectedLevel.value = level
}

function canBid(level, strain) {
  if (!level) return false

  const strainOrder = ['C', 'D', 'H', 'S', 'NT']
  const strainRank = strainOrder.indexOf(strain)

  if (level > lastBidLevel.value) return true
  if (level === lastBidLevel.value && strainRank > lastBidStrainRank.value) return true
  return false
}

function makeBid(level, strain) {
  if (!canBid(level, strain)) return
  emit('bid', `${level}${strain}`)
}
</script>

<style scoped>
.bidding-box {
  background: #e8e8e8;
  border-radius: 8px;
  /* Glyph-ratio restyle (2026-07-11): tighter container padding + gaps for an
     honestly narrower natural form (documentation/design/biddingbox-glyph-restyle.md). */
  padding: calc(10px * var(--bb-scale, var(--table-scale)));
  display: flex;
  flex-direction: column;
  gap: calc(8px * var(--bb-scale, var(--table-scale)));
}

/* Not this player's turn: same layout, greyed and non-interactive. */
.bidding-box.disabled {
  opacity: 0.45;
  pointer-events: none;
}

.bid-section {
  display: flex;
  flex-direction: column;
  gap: calc(6px * var(--bb-scale, var(--table-scale)));
}

.levels {
  display: flex;
  gap: var(--btn-gap, calc(3px * var(--bb-scale, var(--table-scale))));
  justify-content: center;
}

.level-btn {
  /* Narrow (a digit doesn't need a wide box), 44px tall for the ≥44px touch target.
     Numeral at the UNIFIED glyph scale (documentation/design/glyph-scale.md): the
     hand-rank reference — 'Segoe UI'/system-ui, MEDIUM (500), 24px — not a
     button-fill ratio. A number is a number wherever it is on the table. */
  width: calc(26px * var(--bb-scale, var(--table-scale)));
  height: calc(44px * var(--bb-scale, var(--table-scale)));
  padding: 0;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: #fff;
  font-family: 'Segoe UI', system-ui, sans-serif;
  font-size: calc(24px * var(--bb-scale, var(--table-scale)));
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
  transition: all 0.15s;
}

.level-btn:hover {
  border-color: #007bff;
}

.level-btn.active {
  background: #007bff;
  color: white;
  border-color: #007bff;
}

.strains {
  display: flex;
  gap: var(--btn-gap, calc(3px * var(--bb-scale, var(--table-scale))));
  justify-content: center;
}

.strain-btn {
  width: calc(38px * var(--bb-scale, var(--table-scale)));
  height: calc(44px * var(--bb-scale, var(--table-scale)));
  padding: 0;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: #fff;
  /* Suit symbol at 100% of the level digit's character extents (glyph-scale rule):
     a suit is sized to match the numbers it sits beside. 28px renders the ♠♥♦♣ at
     the 24px digit's visual height. */
  font-family: 'Segoe UI', system-ui, sans-serif;
  font-size: calc(28px * var(--bb-scale, var(--table-scale)));
  line-height: 1;
  cursor: pointer;
  transition: all 0.15s;
}

.strain-btn:hover:not(:disabled) {
  border-color: #007bff;
  transform: translateY(-2px);
}

.strain-btn:disabled,
.strain-btn.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.strain-btn.suit-red {
  color: #d32f2f;
}

.strain-btn.suit-black {
  color: #1a1a1a;
}

.strain-btn.suit-nt {
  /* NT set at the same scale as the strain symbols (item 2), medium weight; "NT" is
     two chars so it sits a touch smaller to fit the button. */
  font-size: calc(22px * var(--bb-scale, var(--table-scale)));
  font-weight: 500;
  color: #1a1a1a;
}

.special-bids {
  display: flex;
  gap: calc(8px * var(--bb-scale, var(--table-scale)));
  justify-content: center;
}

.special-btn {
  min-width: calc(58px * var(--bb-scale, var(--table-scale)));
  height: calc(44px * var(--bb-scale, var(--table-scale))); /* ≥44px touch target */
  padding: calc(4px * var(--bb-scale, var(--table-scale))) calc(12px * var(--bb-scale, var(--table-scale)));
  border: none;
  border-radius: 4px;
  font-size: calc(16px * var(--bb-scale, var(--table-scale)));
  font-weight: bold;
  cursor: pointer;
  transition: all 0.15s;
}

.special-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.special-btn.pass {
  background: #4caf50;
  color: white;
}

.special-btn.pass:hover {
  background: #388e3c;
}

.special-btn.double {
  background: #ff5722;
  color: white;
}

.special-btn.double:hover:not(:disabled) {
  background: #e64a19;
}

.special-btn.redouble {
  background: #2196f3;
  color: white;
}

.special-btn.redouble:hover:not(:disabled) {
  background: #1976d2;
}
</style>
