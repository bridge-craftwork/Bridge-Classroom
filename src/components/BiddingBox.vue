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
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* Not this player's turn: same layout, greyed and non-interactive. */
.bidding-box.disabled {
  opacity: 0.45;
  pointer-events: none;
}

.bid-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.levels {
  display: flex;
  gap: 4px;
  justify-content: center;
}

.level-btn {
  width: 36px;
  height: 36px;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: #fff;
  font-size: 18px;
  font-weight: bold;
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
  gap: 4px;
  justify-content: center;
}

.strain-btn {
  width: 48px;
  height: 42px;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: #fff;
  font-size: 20px;
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
  font-size: 14px;
  font-weight: bold;
  color: #1a1a1a;
}

.special-bids {
  display: flex;
  gap: 8px;
  justify-content: center;
}

.special-btn {
  min-width: 64px;
  padding: 10px 16px;
  border: none;
  border-radius: 4px;
  font-size: 14px;
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
