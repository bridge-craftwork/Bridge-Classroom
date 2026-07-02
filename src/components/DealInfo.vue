<template>
  <div class="deal-info">
    <div class="board-selector" @mouseenter="showPopup = true" @mouseleave="showPopup = false">
      <div class="board-number">Board {{ boardNumber }}</div>
      <div v-if="showPopup && totalDeals > 1" class="board-popup">
        <div class="popup-header">Select Board</div>
        <div class="popup-list">
          <button
            v-for="i in totalDeals"
            :key="i"
            class="popup-item"
            :class="{ active: i - 1 === currentIndex }"
            @click="selectBoard(i - 1)"
          >
            Board {{ dealBoardNumbers[i - 1] || i }}
          </button>
        </div>
      </div>
    </div>

    <div class="info-row">
      <div class="info-item">
        <span class="label">Dealer:</span>
        <span class="value">{{ dealerName }}</span>
      </div>
      <div class="info-item">
        <span class="label">Vul:</span>
        <span class="value" :class="vulClass">{{ vulDisplay }}</span>
      </div>
    </div>

    <div v-if="showContract && contract" class="contract-row">
      <div class="info-item">
        <span class="value contract" v-html="contractHtml"></span>
        <span v-if="declarer" class="label">by {{ declarerName }}</span>
        <span v-if="showResult && resultDisplay" class="value result" title="Single-dummy result">{{ resultDisplay }}</span>
      </div>
      <div v-if="openingLead" class="info-item">
        <span class="label">OL:</span>
        <span class="value lead-card" v-html="openingLeadHtml"></span>
      </div>
    </div>

    <div v-if="bridgeContext" class="bridge-context">
      <span class="bridge-context-icon" aria-hidden="true">ⓘ</span>
      <span class="bridge-context-text">{{ bridgeContext }}</span>
    </div>

    <div v-if="title" class="title">{{ title }}</div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { getSeatName, formatBid, formatVulnerability } from '../utils/cardFormatting.js'

const props = defineProps({
  boardNumber: {
    type: Number,
    default: 0
  },
  dealer: {
    type: String,
    default: 'N'
  },
  vulnerable: {
    type: String,
    default: 'None'
  },
  contract: {
    type: String,
    default: ''
  },
  declarer: {
    type: String,
    default: ''
  },
  showContract: {
    type: Boolean,
    default: false
  },
  openingLead: {
    type: String,
    default: ''
  },
  title: {
    type: String,
    default: ''
  },
  totalDeals: {
    type: Number,
    default: 0
  },
  currentIndex: {
    type: Number,
    default: 0
  },
  dealBoardNumbers: {
    type: Array,
    default: () => []
  },
  bridgeContext: {
    type: String,
    default: ''
  },
  result: {
    type: [String, Number],
    default: ''
  },
  showResult: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['goto'])

const showPopup = ref(false)

function selectBoard(index) {
  emit('goto', index)
  showPopup.value = false
}

const dealerName = computed(() => getSeatName(props.dealer))
const declarerName = computed(() => getSeatName(props.declarer))
const vulDisplay = computed(() => formatVulnerability(props.vulnerable))

const vulClass = computed(() => {
  const vul = props.vulnerable?.toUpperCase()
  if (vul === 'BOTH' || vul === 'ALL') return 'vul-both'
  if (vul === 'NS' || vul === 'EW') return 'vul-partial'
  return 'vul-none'
})

const contractHtml = computed(() => {
  if (!props.contract) return ''
  return formatBid(props.contract).html
})

// Single-dummy result as a trick differential vs the contract: +1 / = / -1
const resultDisplay = computed(() => {
  if (!props.contract || props.result === '' || props.result == null) return ''
  const level = parseInt(String(props.contract)[0], 10)
  const made = parseInt(props.result, 10)
  if (!level || Number.isNaN(made)) return ''
  const diff = made - (6 + level)
  return diff > 0 ? `+${diff}` : diff === 0 ? '=' : `${diff}`
})

const openingLeadHtml = computed(() => {
  if (!props.openingLead) return ''
  const suit = props.openingLead[0]
  const rank = props.openingLead.slice(1)
  const suitSymbols = { S: '♠', H: '♥', D: '♦', C: '♣' }
  const suitColors = { S: 'black', H: 'red', D: 'red', C: 'black' }
  const symbol = suitSymbols[suit] || suit
  const colorClass = suitColors[suit] || 'black'
  const displayRank = rank === 'T' ? '10' : rank
  return `<span class="${colorClass}">${symbol}</span>${displayRank}`
})
</script>

<style scoped>
.deal-info {
  background: #f0f0f0;
  border-radius: 8px;
  padding: 12px 16px;
  text-align: center;
  overflow: visible;
  position: relative;
}

.board-selector {
  position: relative;
  display: inline-block;
}

.board-number {
  font-size: 18px;
  font-weight: bold;
  color: #333;
  margin-bottom: 8px;
  cursor: pointer;
}

.board-number:hover {
  color: #1976d2;
}

.board-popup {
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
  z-index: 100;
  min-width: 150px;
  max-height: 300px;
  overflow: hidden;
}

.popup-header {
  padding: 10px 16px;
  font-size: 12px;
  font-weight: 600;
  color: #666;
  text-transform: uppercase;
  border-bottom: 1px solid #eee;
  background: #fafafa;
}

.popup-list {
  max-height: 250px;
  overflow-y: auto;
}

.popup-item {
  display: block;
  width: 100%;
  padding: 10px 16px;
  border: none;
  background: none;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s;
}

.popup-item:hover {
  background: #e3f2fd;
}

.popup-item.active {
  background: #1976d2;
  color: white;
}

.info-row,
.contract-row {
  display: flex;
  justify-content: center;
  gap: 20px;
  margin-bottom: 4px;
}

.info-item {
  display: flex;
  gap: 4px;
  align-items: center;
}

.label {
  font-size: 12px;
  color: #666;
}

.value {
  font-size: 14px;
  font-weight: 500;
}

.value.result {
  margin-left: 6px;
  padding: 0 6px;
  border-radius: 4px;
  background: #eef2f7;
  color: #33475b;
  font-size: 18px;
  font-weight: bold;
  font-variant-numeric: tabular-nums;
}

.vul-both {
  color: #d32f2f;
  font-weight: bold;
}

.vul-partial {
  color: #f57c00;
}

.vul-none {
  color: #4caf50;
}

.contract {
  font-size: 16px;
  font-weight: bold;
}

.contract :deep(.red) {
  color: #d32f2f;
}

.lead-card {
  font-size: 16px;
  font-weight: bold;
}

.lead-card :deep(.red) {
  color: #d32f2f;
}

.lead-card :deep(.black) {
  color: #000;
}

.bridge-context {
  margin-top: 8px;
  padding: 6px 10px;
  background: #e3f2fd;
  border-left: 3px solid #1976d2;
  border-radius: 4px;
  display: flex;
  gap: 8px;
  align-items: flex-start;
  text-align: left;
  font-size: 13px;
  line-height: 1.35;
  color: #0d3a66;
}

.bridge-context-icon {
  color: #1976d2;
  font-weight: bold;
  flex-shrink: 0;
}

.bridge-context-text {
  flex: 1;
  word-wrap: break-word;
}

.title {
  margin-top: 8px;
  font-style: italic;
  color: #555;
  font-size: 13px;
}
</style>
