<template>
  <div class="bidding-box" :class="{ disabled }">
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
import { ref, computed } from 'vue'

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
  padding: calc(10px * var(--table-scale));
  display: flex;
  flex-direction: column;
  gap: calc(8px * var(--table-scale));
}

/* Not this player's turn: same layout, greyed and non-interactive. */
.bidding-box.disabled {
  opacity: 0.45;
  pointer-events: none;
}

.bid-section {
  display: flex;
  flex-direction: column;
  gap: calc(6px * var(--table-scale));
}

.levels {
  display: flex;
  gap: calc(3px * var(--table-scale));
  justify-content: center;
}

.level-btn {
  /* Narrower (a digit doesn't need a 36px box) but TALLER — the 44px height carries
     the ≥44px touch target while the width shrinks the natural form. Bigger, tighter
     glyph: font ~55% of the button height (was ~36%). */
  width: calc(26px * var(--table-scale));
  height: calc(44px * var(--table-scale));
  padding: 0;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: #fff;
  font-size: calc(34px * var(--table-scale));
  font-weight: bold;
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
  gap: calc(3px * var(--table-scale));
  justify-content: center;
}

.strain-btn {
  width: calc(38px * var(--table-scale));
  height: calc(44px * var(--table-scale));
  padding: 0;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: #fff;
  font-size: calc(34px * var(--table-scale));
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
  font-size: calc(18px * var(--table-scale));
  font-weight: bold;
  color: #1a1a1a;
}

.special-bids {
  display: flex;
  gap: calc(8px * var(--table-scale));
  justify-content: center;
}

.special-btn {
  min-width: calc(58px * var(--table-scale));
  height: calc(44px * var(--table-scale)); /* ≥44px touch target */
  padding: calc(4px * var(--table-scale)) calc(12px * var(--table-scale));
  border: none;
  border-radius: 4px;
  font-size: calc(16px * var(--table-scale));
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
