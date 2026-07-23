<template>
  <div class="friends-tab">
    <!-- No durable session on this device: the friends features need a
         server-verified identity, but the rest of the app runs from
         localStorage, so this is a panel notice rather than an app error. -->
    <div v-if="needsSession" class="notice">
      <p class="notice-title">Sign in on this device to use Friends</p>
      <p class="notice-desc">
        Friends are stored with your account, so this device needs to know it's
        really you. Open the sign-in link from your email on this device once,
        and it will remember you from then on.
      </p>
    </div>

    <template v-else>
      <div v-if="loading && !loaded" class="loading-state">
        <div class="spinner"></div>
        <p>Loading friends…</p>
      </div>

      <template v-else>
        <p v-if="error" class="error-banner">{{ error }}</p>

        <!-- Requests waiting on ME. First, because it's the only part that
             needs an answer. -->
        <section v-if="incoming.length" class="section">
          <h3 class="section-title">
            Friend {{ incoming.length === 1 ? 'request' : 'requests' }}
            <span class="count-pill">{{ incoming.length }}</span>
          </h3>
          <div
            v-for="r in incoming"
            :key="r.id"
            class="row request-row"
          >
            <div class="row-main">
              <span class="name">{{ r.name }}</span>
              <span class="sub">wants to be friends</span>
            </div>
            <div class="row-actions">
              <button
                class="btn primary"
                :disabled="busyId === r.id"
                @click="onAccept(r)"
              >
                Accept
              </button>
              <button
                class="btn quiet"
                :disabled="busyId === r.id"
                @click="onDecline(r)"
              >
                Not now
              </button>
            </div>
          </div>
        </section>

        <!-- My friends -->
        <section class="section">
          <h3 class="section-title">
            Friends
            <span v-if="friends.length" class="count-pill">{{ friends.length }}</span>
          </h3>

          <div v-if="!friends.length" class="empty-state">
            <p class="empty-title">No friends yet</p>
            <p class="empty-desc">
              You can add someone after you've played at the same table. Open a
              table together, then use <strong>Add friend</strong> next to their
              name. Once you're friends you'll be able to invite each other
              straight from here.
            </p>
          </div>

          <div v-else>
            <div v-for="f in friends" :key="f.user_id" class="row">
              <div class="row-main">
                <span class="name">{{ f.name }}</span>
                <!-- Presence lands in Phase 3; until then everyone reads as
                     offline, so say nothing rather than imply availability. -->
                <span class="sub">Friends since {{ formatDate(f.friends_since) }}</span>
              </div>
              <div class="row-actions">
                <button
                  v-if="confirmRemoveId !== f.user_id"
                  class="btn quiet"
                  @click="confirmRemoveId = f.user_id"
                >
                  Remove
                </button>
                <template v-else>
                  <span class="confirm-text">Remove {{ f.name }}?</span>
                  <button
                    class="btn danger"
                    :disabled="busyId === f.user_id"
                    @click="onRemove(f)"
                  >
                    Remove
                  </button>
                  <button class="btn quiet" @click="confirmRemoveId = null">Cancel</button>
                </template>
              </div>
            </div>
          </div>
        </section>

        <!-- Requests I've sent. Deliberately phrased as "waiting", never as a
             permanent state: a declined request can be sent again, so the UI
             must not imply the door is closed. -->
        <section v-if="outgoing.length" class="section">
          <h3 class="section-title">Waiting for a reply</h3>
          <div v-for="r in outgoing" :key="r.id" class="row muted-row">
            <div class="row-main">
              <span class="name">{{ r.name }}</span>
              <span class="sub">Asked {{ formatDate(r.created_at) }} — no reply yet</span>
            </div>
          </div>
        </section>
      </template>
    </template>
  </div>
</template>

<script setup>
// Friends tab (ADR-0005 Phase 2). List, request inbox, and removal.
//
// No presence yet — Phase 3 adds the online/at-table/practicing states. Until
// then this deliberately shows no availability at all rather than showing
// everyone as offline, which would read as "nobody ever plays."
//
// There is no "find a friend" input here on purpose: friending requires a
// shared table first (see useFriends.js / ADR-0005).

import { ref, onMounted, watch } from 'vue'
import { useUserStore } from '../../../composables/useUserStore.js'
import { useFriends } from '../../../composables/useFriends.js'

const userStore = useUserStore()
const {
  friends,
  incoming,
  outgoing,
  loading,
  loaded,
  error,
  needsSession,
  load,
  acceptRequest,
  declineRequest,
  removeFriend,
} = useFriends()

const busyId = ref(null)
const confirmRemoveId = ref(null)

const currentUserId = () => userStore.currentUser.value?.id

onMounted(() => load(currentUserId()))

// Switch User swaps the whole identity — reload against the new one.
watch(
  () => userStore.currentUser.value?.id,
  (id) => {
    confirmRemoveId.value = null
    if (id) load(id)
  }
)

async function onAccept(r) {
  busyId.value = r.id
  try {
    await acceptRequest(currentUserId(), r.id)
  } catch {
    /* surfaced via `error` */
  } finally {
    busyId.value = null
  }
}

async function onDecline(r) {
  busyId.value = r.id
  try {
    await declineRequest(currentUserId(), r.id)
  } catch {
    /* surfaced via `error` */
  } finally {
    busyId.value = null
  }
}

async function onRemove(f) {
  busyId.value = f.user_id
  try {
    await removeFriend(currentUserId(), f.user_id)
    confirmRemoveId.value = null
  } catch {
    /* surfaced via `error` */
  } finally {
    busyId.value = null
  }
}

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
</script>

<style scoped>
.friends-tab {
  padding: 8px 0;
}

.section {
  margin-bottom: 28px;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
  font-family: var(--font-heading, 'DM Sans', sans-serif);
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary, #1f2937);
}

.count-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 7px;
  border-radius: 11px;
  background: #e3f2fd;
  color: #1565c0;
  font-size: 12px;
  font-weight: 600;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 14px;
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: var(--radius-card, 8px);
  margin-bottom: 8px;
  background: #fff;
}

.request-row {
  border-color: #bbdefb;
  background: #f5faff;
}

.muted-row {
  background: #fafafa;
}

.row-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.name {
  font-size: 15px;
  font-weight: 500;
  color: var(--text-primary, #1f2937);
}

.sub {
  font-size: 13px;
  color: var(--text-secondary, #6b7280);
}

.row-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.confirm-text {
  font-size: 13px;
  color: var(--text-secondary, #6b7280);
}

.btn {
  padding: 7px 14px;
  border: none;
  border-radius: var(--radius-button, 6px);
  font-family: var(--font-body, 'DM Sans', sans-serif);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn:disabled {
  opacity: 0.55;
  cursor: default;
}

.btn.primary {
  background: #e3f2fd;
  color: #1565c0;
}

.btn.primary:hover:not(:disabled) {
  background: #bbdefb;
}

.btn.quiet {
  background: transparent;
  color: var(--text-secondary, #6b7280);
}

.btn.quiet:hover:not(:disabled) {
  background: #f3f4f6;
}

.btn.danger {
  background: #fdecea;
  color: #b3261e;
}

.btn.danger:hover:not(:disabled) {
  background: #fad2ce;
}

.empty-state,
.notice {
  text-align: center;
  padding: 40px 24px;
  border: 1px dashed var(--border-color, #e5e7eb);
  border-radius: var(--radius-card, 8px);
}

.empty-title,
.notice-title {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary, #1f2937);
}

.empty-desc,
.notice-desc {
  margin: 0 auto;
  max-width: 480px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-secondary, #6b7280);
}

.error-banner {
  margin: 0 0 16px;
  padding: 10px 14px;
  border-radius: var(--radius-card, 8px);
  background: #fdecea;
  color: #b3261e;
  font-size: 14px;
}

.loading-state {
  text-align: center;
  padding: 60px 20px;
}

.spinner {
  width: 36px;
  height: 36px;
  border: 3px solid #e0e0e0;
  border-top-color: #1565c0;
  border-radius: 50%;
  margin: 0 auto 12px;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
