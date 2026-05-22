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
      <AdminStatsRow :stats="admin.stats.value" />

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
            <span class="result-name">{{ user.first_name }} {{ user.last_name }}</span>
            <span class="result-email">{{ user.email }}</span>
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
        </div>
      </div>

      <!-- Observation Decryption -->
      <div class="decrypt-section">
        <h3 class="section-title">Observation Decryption</h3>
        <p class="decrypt-description">
          Decrypt all observations using RECOVERY_SECRET and populate the
          <code>observations_decrypted</code> table for inspection and backfill.
        </p>
        <div class="decrypt-actions">
          <button
            class="decrypt-btn"
            @click="handleDecryptObservations"
            :disabled="decrypting"
          >
            {{ decrypting ? 'Decrypting...' : 'Decrypt All Observations' }}
          </button>
        </div>
        <div v-if="decrypting" class="decrypt-progress">
          <div class="spinner"></div>
          <p>Processing observations (this may take a minute)...</p>
        </div>
        <div v-if="decryptResult" class="decrypt-result" :class="{ error: !decryptResult.success }">
          <p v-if="decryptResult.success">
            Decrypted <strong>{{ decryptResult.observations_decrypted.toLocaleString() }}</strong> observations
            from <strong>{{ decryptResult.users_processed }}</strong> users.
            <span v-if="decryptResult.users_skipped"> ({{ decryptResult.users_skipped }} users skipped — no recovery key)</span>
            <span v-if="decryptResult.errors"> | {{ decryptResult.errors }} errors</span>
          </p>
          <p v-else>Decryption failed: {{ decryptResult.error }}</p>
          <p v-if="decryptResult.success" class="decrypt-hint">
            Results in <code>observations_decrypted</code> table. Query via SQLite to inspect.
          </p>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useAdminDashboard } from '../../composables/useAdminDashboard.js'
import { useAnnouncement } from '../../composables/useAnnouncement.js'
import { useUserStore } from '../../composables/useUserStore.js'
import { API_URL } from '@/utils/apiUrl.js'
import AdminStatsRow from './AdminStatsRow.vue'
import PopularLessons from './PopularLessons.vue'
import DatabasePanel from './DatabasePanel.vue'
import SystemHealth from './SystemHealth.vue'


const admin = useAdminDashboard()
const ann = useAnnouncement()
const userStore = useUserStore()
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

// Observation decryption
const decrypting = ref(false)
const decryptResult = ref(null)

async function handleDecryptObservations() {
  decrypting.value = true
  decryptResult.value = null
  try {
    const res = await fetch(`${API_URL}/admin/decrypt-observations`, {
      method: 'POST',
      headers: { 'x-api-key': API_KEY }
    })
    if (!res.ok) {
      const text = await res.text()
      decryptResult.value = { success: false, error: `HTTP ${res.status}: ${text}` }
      return
    }
    decryptResult.value = await res.json()
  } catch (err) {
    decryptResult.value = { success: false, error: err.message }
  } finally {
    decrypting.value = false
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

/* Decrypt section */
.decrypt-section {
  background: white;
  border-radius: var(--radius-card, 10px);
  border: 1px solid var(--card-border, #e0ddd7);
  padding: 20px;
  margin-top: 24px;
}

.decrypt-description {
  font-size: 13px;
  color: var(--text-secondary, #6b7280);
  margin-bottom: 12px;
}

.decrypt-description code {
  background: #f3f4f6;
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 12px;
}

.decrypt-actions {
  margin-bottom: 12px;
}

.decrypt-btn {
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

.decrypt-btn:hover { background: #6d28d9; }
.decrypt-btn:disabled { opacity: 0.6; cursor: not-allowed; }

.decrypt-progress {
  text-align: center;
  padding: 16px 0;
  color: var(--text-secondary, #6b7280);
  font-size: 13px;
}

.decrypt-result {
  padding: 12px 16px;
  border-radius: var(--radius-button, 6px);
  background: #e8f5e9;
  font-size: 13px;
}

.decrypt-result.error {
  background: #ffebee;
  color: #c62828;
}

.decrypt-hint {
  margin-top: 6px;
  color: var(--text-muted, #9ca3af);
  font-size: 12px;
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
</style>
