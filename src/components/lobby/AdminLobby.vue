<template>
  <div class="admin-lobby">
    <p v-if="admin.stats.value" class="admin-subtitle">
      {{ admin.stats.value.total_observations.toLocaleString() }} total observations across {{ admin.stats.value.total_users }} users
    </p>

    <!-- Loading -->
    <div v-if="admin.loading.value && !admin.stats.value" class="loading-state">
      <div class="spinner"></div>
      <p>Loading dashboard...</p>
    </div>

    <!-- Error -->
    <div v-else-if="admin.error.value" class="error-state">
      <p>{{ admin.error.value }}</p>
      <button class="retry-btn" @click="loadData">Retry</button>
    </div>

    <template v-else-if="admin.stats.value">
      <!-- Announcement Management -->
      <div class="announcement-section">
        <h3 class="section-title">Site Announcement</h3>
        <div v-if="ann.announcement.value && !editing" class="current-announcement" :class="ann.announcement.value.type">
          <div class="announcement-info">
            <span class="announcement-type-badge" :class="ann.announcement.value.type">{{ ann.announcement.value.type }}</span>
            <span class="announcement-message" v-html="renderMessage(ann.announcement.value.message)"></span>
            <span v-if="ann.announcement.value.expires_at" class="announcement-expires">
              Expires: {{ formatExpiry(ann.announcement.value.expires_at) }}
            </span>
            <span v-else class="announcement-expires">No expiration</span>
          </div>
          <div class="announcement-actions">
            <button class="edit-btn" @click="startEdit">Edit</button>
            <button class="clear-btn" @click="handleClear" :disabled="clearing">
              {{ clearing ? 'Clearing...' : 'Clear' }}
            </button>
          </div>
        </div>
        <div v-else-if="editing || !ann.announcement.value" class="announcement-form">
          <input
            v-model="newMessage"
            type="text"
            class="announcement-input"
            placeholder="Enter announcement message..."
            @keydown.enter="handlePublish"
          />
          <div class="form-row">
            <select v-model="newType" class="type-select">
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="urgent">Urgent</option>
            </select>
            <input
              v-model="newExpiry"
              type="datetime-local"
              class="expiry-input"
              title="Optional expiration date"
            />
            <button v-if="editing" class="cancel-btn" @click="cancelEdit">Cancel</button>
            <button class="publish-btn" @click="handlePublish" :disabled="!newMessage.trim() || publishing">
              {{ publishing ? 'Publishing...' : editing ? 'Update' : 'Publish' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Stats row -->
      <AdminStatsRow :stats="admin.stats.value" :expanded="showNewUsers" @toggle="showNewUsers = !showNewUsers" />

      <!-- New-users roster: tap the "N New this Week" pill to expand. Replaces the
           old hover-only tooltip (invisible on touch). Tap a row → Find User detail. -->
      <div v-if="showNewUsers" class="new-users-panel">
        <div class="new-users-head">New this week</div>
        <div v-if="newUsersRecent.length" class="new-users-list">
          <button
            v-for="u in newUsersRecent"
            :key="u.id"
            type="button"
            class="new-user-row"
            @click="selectNewUser(u)"
          >
            <span class="nu-name">{{ anon.displayFullName(u) }}</span>
            <span class="nu-email">{{ anon.displayEmail(u.email) }}</span>
            <span class="nu-when">{{ joinedAgo(u.created_at) }}</span>
          </button>
        </div>
        <div v-else class="new-users-empty">No new-user details available.</div>
      </div>

      <!-- Two-column: Popular Lessons + Database -->
      <div class="content-grid">
        <PopularLessons :lessons="admin.popularLessons.value" />
        <DatabasePanel :database="admin.database.value" />
      </div>

      <!-- System Health -->
      <SystemHealth
        :health="admin.health.value"
        :database="admin.database.value"
        :refreshing="refreshing"
        @refresh="handleRefresh"
      />

      <!-- User Name Correction -->
      <div class="name-correction-section">
        <h3 class="section-title">Find User</h3>
        <div class="search-row">
          <input
            v-model="searchEmail"
            type="text"
            class="search-input"
            placeholder="Search by name or email..."
            @keydown.enter="handleSearchUser"
          />
          <button class="search-btn" @click="handleSearchUser" :disabled="searching || !searchEmail.trim()">
            {{ searching ? 'Searching...' : 'Search' }}
          </button>
        </div>

        <div v-if="searchResults.length" class="search-results">
          <div
            v-for="user in searchResults"
            :key="user.id"
            class="search-result-item"
            :class="{ selected: selectedUser && selectedUser.id === user.id }"
            @click="selectUser(user)"
          >
            <span class="result-name">{{ anon.displayFullName(user) }}</span>
            <span class="result-email">{{ anon.displayEmail(user.email) }}</span>
            <span v-if="user.name_corrected_at" class="corrected-badge">corrected</span>
            <button
              class="view-as-btn"
              @click.stop="handleViewAs(user)"
              title="Render the app from this user's perspective (read-only)"
            >View as user</button>
          </div>
        </div>

        <div v-if="searchDone && !searchResults.length" class="no-results">
          No users found for "{{ searchEmail }}"
        </div>

        <div v-if="selectedUser" class="edit-form">
          <div class="edit-row">
            <div class="edit-field">
              <label>First Name</label>
              <input v-model="editFirstName" type="text" class="edit-input" />
            </div>
            <div class="edit-field">
              <label>Last Name</label>
              <input v-model="editLastName" type="text" class="edit-input" />
            </div>
            <button class="save-btn" @click="handleSaveCorrection" :disabled="saving || !editFirstName.trim() || !editLastName.trim()">
              {{ saving ? 'Saving...' : 'Save' }}
            </button>
          </div>
          <p v-if="saveSuccess" class="save-feedback success">Name corrected successfully.</p>
          <p v-if="saveError" class="save-feedback error">{{ saveError }}</p>

          <!-- Merge accounts -->
          <div class="merge-section">
            <button v-if="!mergeMode" class="merge-btn" @click="openMerge">Merge into another account…</button>

            <div v-else class="merge-panel">
              <p class="merge-intro">
                Merge <strong>{{ selectedUser.email }}</strong> with a duplicate account. All
                data is consolidated onto the account you keep; the other is removed and its
                device switches over automatically on next load.
              </p>
              <div class="search-row">
                <input
                  v-model="mergeSearch" type="text" class="search-input"
                  placeholder="Find the other account by name or email..."
                  @keydown.enter="searchMergeOther"
                />
                <button class="search-btn" @click="searchMergeOther" :disabled="mergeSearching || !mergeSearch.trim()">
                  {{ mergeSearching ? 'Searching...' : 'Search' }}
                </button>
              </div>

              <div v-if="mergeSearchResults.length" class="search-results">
                <div
                  v-for="u in mergeSearchResults" :key="u.id"
                  class="search-result-item" :class="{ selected: mergeOther && mergeOther.id === u.id }"
                  @click="pickMergeOther(u)"
                >
                  <span class="result-name">{{ anon.displayFullName(u) }}</span>
                  <span class="result-email">{{ anon.displayEmail(u.email) }}</span>
                </div>
              </div>

              <div v-if="mergeOther" class="merge-confirm">
                <p class="merge-keeper-label">Keep which account? (defaults to the older one)</p>
                <label class="keeper-option">
                  <input type="radio" :value="selectedUser.id" v-model="keeperId" />
                  <span><strong>{{ selectedUser.email }}</strong> · created {{ formatDate(selectedUser.created_at) }}</span>
                </label>
                <label class="keeper-option">
                  <input type="radio" :value="mergeOther.id" v-model="keeperId" />
                  <span><strong>{{ mergeOther.email }}</strong> · created {{ formatDate(mergeOther.created_at) }}</span>
                </label>
                <p class="merge-warning">
                  Removes <strong>{{ awayEmail }}</strong> and moves its data onto
                  <strong>{{ keeperEmail }}</strong>. This cannot be undone.
                </p>
                <button class="merge-confirm-btn" @click="confirmMerge" :disabled="merging || !keeperId">
                  {{ merging ? 'Merging…' : `Merge — keep ${keeperEmail}` }}
                </button>
              </div>

              <button class="merge-cancel" @click="cancelMerge">Cancel</button>
            </div>

            <p v-if="mergeError" class="save-feedback error">{{ mergeError }}</p>
            <p v-if="mergeDoneMsg" class="save-feedback success">{{ mergeDoneMsg }}</p>
          </div>
        </div>
      </div>

      <!-- Ops tools. These decrypt every E2E observation server-side, so they
           are gated by a signed admin request (ADR-0003): the browser signs
           with the admin's own private key at click time — no secret in the
           bundle. Only an admin's device can produce a valid signature. -->
      <div class="ops-section">
        <h3 class="section-title">Ops tools</h3>
        <p class="ops-description">
          Privileged maintenance. Each runs as a request signed with your admin key.
        </p>
        <div class="ops-actions">
          <button class="ops-btn" @click="runOp('decrypt')" :disabled="!!opRunning">
            {{ opRunning === 'decrypt' ? 'Decrypting…' : 'Decrypt observations' }}
          </button>
          <button class="ops-btn" @click="runOp('backfill')" :disabled="!!opRunning">
            {{ opRunning === 'backfill' ? 'Backfilling…' : 'Backfill active time' }}
          </button>
        </div>
        <div v-if="opResult" class="ops-result" :class="{ error: !opResult.success }">
          {{ opResult.message }}
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick } from 'vue'
import { useAdminDashboard } from '../../composables/useAdminDashboard.js'
import { useAnnouncement } from '../../composables/useAnnouncement.js'
import { useUserStore } from '../../composables/useUserStore.js'
import { useTeacherRole } from '../../composables/useTeacherRole.js'
import { signedFetch } from '../../utils/signedRequest.js'
import { API_URL } from '@/utils/apiUrl.js'
import AdminStatsRow from './AdminStatsRow.vue'
import PopularLessons from './PopularLessons.vue'
import DatabasePanel from './DatabasePanel.vue'
import SystemHealth from './SystemHealth.vue'
import { useAnonymizer } from '../../composables/useAnonymizer.js'


const admin = useAdminDashboard()
const ann = useAnnouncement()
const userStore = useUserStore()
const teacherRole = useTeacherRole()
// Anonymizes the browsable user lists for screenshots (issue #334). NOTE: the
// edit-form inputs and the merge-confirmation panel deliberately stay on REAL
// data — the edit inputs write back to the record, and merges must distinguish
// accounts by their real email to be safe.
const anon = useAnonymizer()

// Signing credentials for privileged (admin) requests (ADR-0003). Throws a
// friendly error if the current user has no teacher signing key on this device.
function signedCreds() {
  const userId = userStore.currentUser.value?.id
  const privateKeyBase64 = teacherRole.getTeacherPrivateKey()
  if (!userId || !privateKeyBase64) {
    throw new Error('No teacher signing key on this device — sign in as a teacher/admin first.')
  }
  return { userId, privateKeyBase64 }
}
const refreshing = ref(false)

function handleViewAs(user) {
  userStore.startViewingAs(user)
}

// Announcement form state
const newMessage = ref('')
const newType = ref('info')
const newExpiry = ref('')
const publishing = ref(false)
const clearing = ref(false)
const editing = ref(false)

function startEdit() {
  const a = ann.announcement.value
  if (!a) return
  newMessage.value = a.message
  newType.value = a.type
  // Convert ISO expiry back to datetime-local format
  if (a.expires_at) {
    const d = new Date(a.expires_at)
    newExpiry.value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
  } else {
    newExpiry.value = ''
  }
  editing.value = true
}

function cancelEdit() {
  editing.value = false
  newMessage.value = ''
  newType.value = 'info'
  newExpiry.value = ''
}

async function handlePublish() {
  if (!newMessage.value.trim()) return
  publishing.value = true
  try {
    const expiresAt = newExpiry.value ? new Date(newExpiry.value).toISOString() : null
    await ann.setAnnouncement(newMessage.value.trim(), newType.value, expiresAt)
    newMessage.value = ''
    newType.value = 'info'
    newExpiry.value = ''
    editing.value = false
  } catch (err) {
    console.error('Failed to publish announcement:', err)
  } finally {
    publishing.value = false
  }
}

async function handleClear() {
  clearing.value = true
  try {
    await ann.clearAnnouncement()
  } catch (err) {
    console.error('Failed to clear announcement:', err)
  } finally {
    clearing.value = false
  }
}

function formatExpiry(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleString()
}

const circleColors = {
  red: { bg: '#ef5350', fg: 'white' },
  yellow: { bg: '#ffeb3b', fg: '#333' },
  orange: { bg: '#ff9800', fg: 'white' },
  green: { bg: '#4caf50', fg: 'white' },
  grey: { bg: '#ccc', fg: '#666' }
}

function renderMessage(message) {
  const escaped = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return escaped.replace(/:(\w+):/g, (match, color) => {
    const c = circleColors[color.toLowerCase()]
    if (!c) return match
    return `<span class="ann-circle" style="background:${c.bg};color:${c.fg}"></span>`
  })
}

// Name correction state
const API_KEY = import.meta.env.VITE_API_KEY || ''
const searchEmail = ref('')
const searchResults = ref([])
const searchDone = ref(false)
const searching = ref(false)
const selectedUser = ref(null)
const editFirstName = ref('')
const editLastName = ref('')
const saving = ref(false)
const saveSuccess = ref(false)
const saveError = ref('')

// New-users roster (expand from the Total Users stat pill).
const showNewUsers = ref(false)
const newUsersRecent = computed(() => admin.stats.value?.new_users_recent || [])
function joinedAgo(iso) {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000))
  if (mins < 60) return mins <= 1 ? 'just now' : `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}
// From the roster → open the user in the existing Find User detail (edit / merge).
function selectNewUser(user) {
  selectUser(user)
  nextTick(() => document.querySelector('.edit-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
}

async function handleSearchUser() {
  if (!searchEmail.value.trim()) return
  searching.value = true
  searchDone.value = false
  searchResults.value = []
  selectedUser.value = null
  saveSuccess.value = false
  saveError.value = ''
  try {
    const res = await fetch(
      `${API_URL}/admin/users/search?q=${encodeURIComponent(searchEmail.value.trim())}`,
      { headers: { 'x-api-key': API_KEY } }
    )
    if (!res.ok) throw new Error(`Search failed: ${res.status}`)
    const data = await res.json()
    searchResults.value = data.users || []
  } catch (err) {
    console.error('User search failed:', err)
  } finally {
    searching.value = false
    searchDone.value = true
  }
}

function selectUser(user) {
  selectedUser.value = user
  editFirstName.value = user.first_name
  editLastName.value = user.last_name
  saveSuccess.value = false
  saveError.value = ''
}

async function handleSaveCorrection() {
  if (!selectedUser.value || !editFirstName.value.trim() || !editLastName.value.trim()) return
  saving.value = true
  saveSuccess.value = false
  saveError.value = ''
  try {
    const res = await fetch(
      `${API_URL}/admin/users/${encodeURIComponent(selectedUser.value.id)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
        body: JSON.stringify({ first_name: editFirstName.value.trim(), last_name: editLastName.value.trim() })
      }
    )
    if (!res.ok) throw new Error(`Save failed: ${res.status}`)
    const data = await res.json()
    if (data.success) {
      saveSuccess.value = true
      // Update the result in-place
      selectedUser.value.first_name = data.user.first_name
      selectedUser.value.last_name = data.user.last_name
      selectedUser.value.name_corrected_at = data.user.name_corrected_at
    }
  } catch (err) {
    saveError.value = err.message
  } finally {
    saving.value = false
  }
}

// ---- Merge accounts ----
const mergeMode = ref(false)
const mergeSearch = ref('')
const mergeSearchResults = ref([])
const mergeSearching = ref(false)
const mergeOther = ref(null)
const keeperId = ref(null)
const merging = ref(false)
const mergeError = ref('')
const mergeDoneMsg = ref('')

const keeperEmail = computed(() => {
  if (!keeperId.value) return ''
  return keeperId.value === selectedUser.value?.id ? selectedUser.value.email : (mergeOther.value?.email || '')
})
const awayEmail = computed(() => {
  if (!keeperId.value) return ''
  return keeperId.value === selectedUser.value?.id ? (mergeOther.value?.email || '') : (selectedUser.value?.email || '')
})

function openMerge() {
  mergeMode.value = true
  mergeSearch.value = ''
  mergeSearchResults.value = []
  mergeOther.value = null
  keeperId.value = null
  mergeError.value = ''
  mergeDoneMsg.value = ''
}

function cancelMerge() {
  mergeMode.value = false
}

async function searchMergeOther() {
  if (!mergeSearch.value.trim()) return
  mergeSearching.value = true
  mergeSearchResults.value = []
  mergeError.value = ''
  try {
    const res = await fetch(
      `${API_URL}/admin/users/search?q=${encodeURIComponent(mergeSearch.value.trim())}`,
      { headers: { 'x-api-key': API_KEY } }
    )
    if (!res.ok) throw new Error(`Search failed: ${res.status}`)
    const data = await res.json()
    // Exclude the already-selected account from the "other" list.
    mergeSearchResults.value = (data.users || []).filter(u => u.id !== selectedUser.value?.id)
  } catch (err) {
    mergeError.value = err.message
  } finally {
    mergeSearching.value = false
  }
}

function pickMergeOther(u) {
  mergeOther.value = u
  // Default keeper = the older account (holds the history).
  const a = selectedUser.value
  keeperId.value = new Date(a.created_at) <= new Date(u.created_at) ? a.id : u.id
}

async function confirmMerge() {
  if (!keeperId.value || !mergeOther.value || !selectedUser.value) return
  const keeper = keeperId.value
  const away = keeper === selectedUser.value.id ? mergeOther.value.id : selectedUser.value.id
  merging.value = true
  mergeError.value = ''
  mergeDoneMsg.value = ''
  try {
    const res = await signedFetch('/admin/merge-accounts', {
      ...signedCreds(),
      body: { merge_user_id: away, keeper_user_id: keeper },
    })
    const data = await res.json()
    if (!res.ok || !data.success) {
      mergeError.value = data.error || `Merge failed: ${res.status}`
    } else {
      mergeDoneMsg.value =
        `Merged — ${data.observations_moved} observations moved onto ${data.keeper_email}. ` +
        `The removed account's device will switch over on its next load.`
      mergeMode.value = false
      selectedUser.value = null
      handleSearchUser() // refresh the list; one account is now gone
    }
  } catch (err) {
    mergeError.value = err.message
  } finally {
    merging.value = false
  }
}

function formatDate(iso) {
  if (!iso) return '?'
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
}

// Ops tools — signed admin requests (ADR-0003).
const opRunning = ref(null) // 'decrypt' | 'backfill' | null
const opResult = ref(null)

async function runOp(kind) {
  const subpath = kind === 'decrypt' ? '/admin/decrypt-observations' : '/admin/backfill-active-time'
  opRunning.value = kind
  opResult.value = null
  try {
    const res = await signedFetch(subpath, signedCreds())
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      opResult.value = { success: false, message: `HTTP ${res.status}: ${data.error || (await res.text?.() ) || 'failed'}` }
      return
    }
    opResult.value = kind === 'decrypt'
      ? { success: true, message: `Decrypted ${data.observations_decrypted?.toLocaleString?.() ?? '?'} observations from ${data.users_processed} users (${data.users_skipped} skipped, ${data.errors} errors).` }
      : { success: true, message: `Backfill complete — ${data.observations_updated?.toLocaleString?.() ?? '?'} observations updated, ${data.pairs_recomputed} pairs recomputed.` }
  } catch (err) {
    opResult.value = { success: false, message: err.message }
  } finally {
    opRunning.value = null
  }
}

async function loadData() {
  await Promise.all([admin.loadStats(), admin.loadHealth()])
}

async function handleRefresh() {
  refreshing.value = true
  await admin.refreshAll()
  refreshing.value = false
}

onMounted(loadData)
</script>

<style scoped>
.admin-lobby {
  padding: 20px 0;
}

.admin-subtitle {
  color: var(--text-secondary, #6b7280);
  margin-bottom: 16px;
}

.loading-state {
  text-align: center;
  padding: 60px 20px;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid #e0e0e0;
  border-top-color: #2d6a4f;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin: 0 auto 16px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error-state {
  text-align: center;
  padding: 40px;
  color: #d32f2f;
}

.retry-btn {
  margin-top: 12px;
  padding: 8px 20px;
  background: #d32f2f;
  color: white;
  border: none;
  border-radius: var(--radius-button, 6px);
  font-size: 14px;
  cursor: pointer;
}

.content-grid {
  display: grid;
  grid-template-columns: 3fr 2fr;
  gap: 24px;
  margin-bottom: 24px;
}

/* Announcement management */
.announcement-section {
  background: white;
  border-radius: var(--radius-card, 10px);
  border: 1px solid var(--card-border, #e0ddd7);
  padding: 20px;
  margin-bottom: 24px;
}

.section-title {
  font-family: var(--font-heading, 'Source Serif 4', serif);
  font-size: 18px;
  color: var(--green-dark, #2d6a4f);
  margin: 0 0 16px 0;
}

.current-announcement {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  border-radius: var(--radius-button, 6px);
}

.current-announcement.info {
  background: #e3f2fd;
  border-left: 3px solid #1565c0;
}

.current-announcement.warning {
  background: #fff8e1;
  border-left: 3px solid #e65100;
}

.current-announcement.urgent {
  background: #ffebee;
  border-left: 3px solid #c62828;
}

.announcement-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}

.announcement-type-badge {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  width: fit-content;
  padding: 1px 8px;
  border-radius: 10px;
}

.announcement-type-badge.info { background: #bbdefb; color: #1565c0; }
.announcement-type-badge.warning { background: #ffe082; color: #e65100; }
.announcement-type-badge.urgent { background: #ef9a9a; color: #c62828; }

.announcement-message {
  font-size: 14px;
  color: var(--text-primary, #1a1a1a);
}

.announcement-message :deep(.ann-circle) {
  display: inline-block;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  vertical-align: middle;
  margin: 0 1px;
}

.announcement-expires {
  font-size: 12px;
  color: var(--text-muted, #9ca3af);
}

.announcement-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.edit-btn {
  padding: 6px 16px;
  background: #e3f2fd;
  color: #1565c0;
  border: none;
  border-radius: var(--radius-button, 6px);
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  font-family: var(--font-body, 'DM Sans', sans-serif);
}

.edit-btn:hover { background: #bbdefb; }

.cancel-btn {
  padding: 8px 16px;
  background: #f3f4f6;
  color: var(--text-secondary, #6b7280);
  border: 1px solid var(--card-border, #e0ddd7);
  border-radius: var(--radius-button, 6px);
  font-size: 13px;
  cursor: pointer;
  font-family: var(--font-body, 'DM Sans', sans-serif);
}

.cancel-btn:hover { background: #e5e7eb; }

.clear-btn {
  padding: 6px 16px;
  background: #ef5350;
  color: white;
  border: none;
  border-radius: var(--radius-button, 6px);
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  font-family: var(--font-body, 'DM Sans', sans-serif);
}

.clear-btn:hover { background: #d32f2f; }
.clear-btn:disabled { opacity: 0.6; cursor: not-allowed; }

.announcement-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.announcement-input {
  padding: 10px 14px;
  border: 1px solid var(--card-border, #e0ddd7);
  border-radius: var(--radius-button, 6px);
  font-size: 14px;
  font-family: var(--font-body, 'DM Sans', sans-serif);
  width: 100%;
}

.announcement-input:focus {
  outline: none;
  border-color: var(--green-mid, #40916c);
}

.form-row {
  display: flex;
  gap: 10px;
  align-items: center;
}

.type-select {
  padding: 8px 12px;
  border: 1px solid var(--card-border, #e0ddd7);
  border-radius: var(--radius-button, 6px);
  font-size: 13px;
  font-family: var(--font-body, 'DM Sans', sans-serif);
  background: white;
}

.expiry-input {
  padding: 8px 12px;
  border: 1px solid var(--card-border, #e0ddd7);
  border-radius: var(--radius-button, 6px);
  font-size: 13px;
  font-family: var(--font-body, 'DM Sans', sans-serif);
  flex: 1;
}

.publish-btn {
  padding: 8px 20px;
  background: var(--green-mid, #40916c);
  color: white;
  border: none;
  border-radius: var(--radius-button, 6px);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  font-family: var(--font-body, 'DM Sans', sans-serif);
}

.publish-btn:hover { background: var(--green-dark, #2d6a4f); }
.publish-btn:disabled { opacity: 0.6; cursor: not-allowed; }

/* Name correction section */
.name-correction-section {
  background: white;
  border-radius: var(--radius-card, 10px);
  border: 1px solid var(--card-border, #e0ddd7);
  padding: 20px;
  margin-top: 24px;
}

.search-row {
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
}

.search-input {
  flex: 1;
  padding: 8px 14px;
  border: 1px solid var(--card-border, #e0ddd7);
  border-radius: var(--radius-button, 6px);
  font-size: 14px;
  font-family: var(--font-body, 'DM Sans', sans-serif);
}

.search-input:focus {
  outline: none;
  border-color: var(--green-mid, #40916c);
}

.search-btn {
  padding: 8px 20px;
  background: var(--green-mid, #40916c);
  color: white;
  border: none;
  border-radius: var(--radius-button, 6px);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  font-family: var(--font-body, 'DM Sans', sans-serif);
}

.search-btn:hover { background: var(--green-dark, #2d6a4f); }
.search-btn:disabled { opacity: 0.6; cursor: not-allowed; }

.search-results {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
}

.search-result-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-radius: var(--radius-button, 6px);
  cursor: pointer;
  font-size: 13px;
  border: 1px solid transparent;
}

.search-result-item:hover { background: #f8f9fa; }
.search-result-item.selected { background: #e3f2fd; border-color: #bbdefb; }

.result-name { font-weight: 500; color: var(--text-primary, #1a1a1a); }
.result-email { color: var(--text-secondary, #6b7280); }

/* New-users roster (expands from the Total Users stat pill). */
.new-users-panel {
  background: white;
  border: 1px solid var(--card-border, #e0ddd7);
  border-radius: var(--radius-card, 10px);
  padding: 12px 16px;
  margin-bottom: 24px;
  margin-top: -8px;
}
.new-users-head {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-secondary, #6b7280);
  margin-bottom: 8px;
}
.new-users-list { display: flex; flex-direction: column; gap: 4px; }
.new-user-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-button, 6px);
  background: none;
  font-family: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.new-user-row:hover { background: #f8f9fa; }
.nu-name { font-weight: 600; color: var(--text-primary, #1a1a1a); white-space: nowrap; }
.nu-email { color: var(--text-secondary, #6b7280); flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nu-when { color: var(--text-secondary, #9ca3af); white-space: nowrap; font-variant-numeric: tabular-nums; }
.new-users-empty { font-size: 13px; color: var(--text-secondary, #6b7280); }
@media (max-width: 600px) {
  .new-user-row { flex-wrap: wrap; gap: 2px 10px; }
  .nu-email { flex-basis: 100%; order: 3; }
}

.corrected-badge {
  font-size: 10px;
  text-transform: uppercase;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 8px;
  background: #e8f5e9;
  color: #2e7d32;
}

.view-as-btn {
  margin-left: auto;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 500;
  border: 1px solid #f59e0b;
  background: #fffbeb;
  color: #92400e;
  border-radius: var(--radius-button, 6px);
  cursor: pointer;
}
.view-as-btn:hover { background: #fde68a; }

.no-results {
  color: var(--text-muted, #9ca3af);
  font-size: 13px;
  padding: 8px 0;
}

.edit-form {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--card-border, #e0ddd7);
}

.edit-row {
  display: flex;
  gap: 10px;
  align-items: flex-end;
}

.edit-field {
  flex: 1;
}

.edit-field label {
  display: block;
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
  margin-bottom: 4px;
}

.edit-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--card-border, #e0ddd7);
  border-radius: var(--radius-button, 6px);
  font-size: 14px;
  font-family: var(--font-body, 'DM Sans', sans-serif);
}

.edit-input:focus {
  outline: none;
  border-color: var(--green-mid, #40916c);
}

.save-btn {
  padding: 8px 20px;
  background: var(--green-mid, #40916c);
  color: white;
  border: none;
  border-radius: var(--radius-button, 6px);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  font-family: var(--font-body, 'DM Sans', sans-serif);
  height: fit-content;
}

.save-btn:hover { background: var(--green-dark, #2d6a4f); }
.save-btn:disabled { opacity: 0.6; cursor: not-allowed; }

.save-feedback {
  margin-top: 8px;
  font-size: 13px;
}

.save-feedback.success { color: #2e7d32; }
.save-feedback.error { color: #d32f2f; }

/* Ops tools */
.ops-section {
  background: white;
  border-radius: var(--radius-card, 10px);
  border: 1px solid var(--card-border, #e0ddd7);
  padding: 20px;
  margin-top: 24px;
}

.ops-description {
  font-size: 13px;
  color: var(--text-secondary, #6b7280);
  margin-bottom: 12px;
}

.ops-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.ops-btn {
  padding: 8px 20px;
  background: #7c3aed;
  color: white;
  border: none;
  border-radius: var(--radius-button, 6px);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  font-family: var(--font-body, 'DM Sans', sans-serif);
}

.ops-btn:hover { background: #6d28d9; }
.ops-btn:disabled { opacity: 0.6; cursor: not-allowed; }

.ops-result {
  padding: 12px 16px;
  border-radius: var(--radius-button, 6px);
  background: #e8f5e9;
  font-size: 13px;
}

.ops-result.error {
  background: #ffebee;
  color: #c62828;
}

@media (max-width: 768px) {
  .content-grid {
    grid-template-columns: 1fr;
  }

  .form-row,
  .edit-row {
    flex-direction: column;
  }
}

/* Merge accounts */
.merge-section {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--card-border, #e0ddd7);
}
.merge-btn {
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 600;
  color: #8a2c2c;
  background: #fff;
  border: 1px solid #e0b4b4;
  border-radius: 6px;
  cursor: pointer;
}
.merge-btn:hover { background: #fdf2f2; }
.merge-panel {
  margin-top: 8px;
  padding: 14px;
  background: #faf7f2;
  border: 1px solid var(--card-border, #e0ddd7);
  border-radius: 8px;
}
.merge-intro { font-size: 13px; color: var(--text-secondary, #6b7280); margin: 0 0 12px 0; }
.merge-confirm { margin-top: 12px; }
.merge-keeper-label { font-size: 13px; font-weight: 600; margin: 0 0 8px 0; }
.keeper-option {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; padding: 6px 0; cursor: pointer;
}
.merge-warning {
  font-size: 13px; color: #8a2c2c;
  background: #fdf2f2; border: 1px solid #f0d0d0; border-radius: 6px;
  padding: 8px 10px; margin: 10px 0;
}
.merge-confirm-btn {
  padding: 9px 16px; font-size: 13px; font-weight: 700;
  color: #fff; background: #b23b3b; border: none; border-radius: 6px; cursor: pointer;
}
.merge-confirm-btn:disabled { opacity: 0.5; cursor: default; }
.merge-cancel {
  display: block; margin-top: 10px;
  background: none; border: none; color: var(--text-secondary, #6b7280);
  font-size: 13px; cursor: pointer; text-decoration: underline;
}
</style>
