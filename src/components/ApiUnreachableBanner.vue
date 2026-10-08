<template>
  <div v-if="unreachable" class="api-banner blocked" role="alert" data-testid="api-unreachable-banner">
    <div class="api-banner-text">
      <strong>Can't reach the Bridge Classroom server right now.</strong>
      <span>
        Your practice is saved on this device and will upload once the connection is back.
        Assignments and class lists can't be shown until then.
      </span>
      <span class="api-banner-hint">
        This usually clears up within a few minutes. If it keeps happening only on one network
        (at a residence, office or library, say), that network may be blocking the server: try
        another, such as your phone's cellular data.
      </span>
      <span class="api-banner-detail">Can't reach {{ host }}<template v-if="sinceText"> since {{ sinceText }}</template>.</span>
    </div>
    <button class="api-banner-btn" :disabled="checking" @click="retry">
      {{ checking ? 'Checking…' : 'Try again' }}
    </button>
  </div>

  <div v-else-if="recovered" class="api-banner ok" role="status" data-testid="api-recovered-banner">
    <div class="api-banner-text">
      <strong>Connected to the Bridge Classroom server again.</strong>
      <span>Reload to see your assignments and classes.</span>
    </div>
    <button class="api-banner-btn" @click="reload">Reload</button>
    <button class="api-banner-close" title="Dismiss" @click="dismissRecovered">&times;</button>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useApiReachability } from '../composables/useApiReachability.js'

const { unreachable, recovered, since, checking, host, retry, dismissRecovered } = useApiReachability()

const sinceText = computed(() =>
  since.value ? since.value.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '')

function reload() {
  window.location.reload()
}
</script>

<style scoped>
.api-banner {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 20px;
  font-family: var(--font-body, 'DM Sans', sans-serif);
  font-size: 15px;
  line-height: 1.45;
}

.api-banner.blocked {
  background: #fff4e5;
  border-bottom: 2px solid #f0a040;
  color: #5c3400;
}

.api-banner.ok {
  background: #e8f5ee;
  border-bottom: 2px solid #40916c;
  color: #1b4332;
}

.api-banner-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.api-banner-hint {
  font-size: 14px;
}

.api-banner-detail {
  font-size: 12px;
  opacity: 0.75;
}

.api-banner-btn {
  flex-shrink: 0;
  padding: 8px 18px;
  border-radius: var(--radius-button, 6px);
  border: 1px solid currentColor;
  background: white;
  color: inherit;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.api-banner-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.api-banner-close {
  flex-shrink: 0;
  border: none;
  background: none;
  color: inherit;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}

@media (max-width: 600px) {
  .api-banner { flex-wrap: wrap; padding: 10px 16px; }
  .api-banner-btn { width: 100%; }
}
</style>
