<template>
  <div class="roster">
    <div class="roster-header">
      <h4>Class Roster</h4>
      <span class="member-count">{{ members.length }} {{ members.length === 1 ? 'student' : 'students' }}</span>
    </div>

    <div v-if="members.length === 0" class="roster-empty">
      <p>No students have joined yet. Share the invite link above.</p>
    </div>

    <table v-else class="roster-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Email</th>
          <th>Joined</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="member in members" :key="member.student_id">
          <td class="member-name">{{ anon.displayFullName(member) }}</td>
          <td class="member-email">{{ anon.displayEmail(member.email) }}</td>
          <td class="member-date">{{ formatDate(member.joined_at) }}</td>
          <td class="member-action">
            <button
              class="remove-btn"
              @click="confirmRemove(member)"
              :disabled="removing === member.student_id"
            >
              {{ removing === member.student_id ? 'Removing...' : 'Remove' }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useAnonymizer } from '../../composables/useAnonymizer.js'

const props = defineProps({
  members: { type: Array, required: true }
})

const anon = useAnonymizer()

const emit = defineEmits(['remove-member'])

const removing = ref(null)

function formatDate(isoString) {
  try {
    const date = new Date(isoString)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch {
    return isoString
  }
}

function confirmRemove(member) {
  const name = anon.displayFullName(member)
  if (confirm(`Remove ${name} from this classroom?`)) {
    removing.value = member.student_id
    emit('remove-member', member.student_id)
    // Parent will update the members list; reset removing state after a short delay
    setTimeout(() => { removing.value = null }, 2000)
  }
}
</script>

<style scoped>
.roster {
  margin-top: 16px;
  border-top: 1px solid var(--card-border, #e0ddd7);
  padding-top: 16px;
}

.roster-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.roster-header h4 {
  font-size: 15px;
  color: var(--text-primary, #1a1a1a);
  margin: 0;
}

.member-count {
  font-size: 13px;
  color: var(--text-secondary, #6b7280);
}

.roster-empty {
  text-align: center;
  padding: 20px;
  color: var(--text-muted, #9ca3af);
  font-size: 14px;
}

.roster-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.roster-table th {
  text-align: left;
  font-weight: 500;
  color: var(--text-secondary, #6b7280);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 6px 8px;
  border-bottom: 1px solid var(--card-border, #e0ddd7);
}

.roster-table td {
  padding: 8px;
  border-bottom: 1px solid #f3f4f6;
  color: var(--text-primary, #1a1a1a);
}

.member-name {
  font-weight: 500;
}

.member-email {
  color: var(--text-secondary, #6b7280);
}

.member-date {
  color: var(--text-secondary, #6b7280);
  white-space: nowrap;
}

.member-action {
  text-align: right;
}

.remove-btn {
  background: none;
  border: none;
  color: var(--text-muted, #9ca3af);
  font-size: 13px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--radius-button, 6px);
  transition: all 0.2s;
  font-family: var(--font-body, 'DM Sans', sans-serif);
}

.remove-btn:hover:not(:disabled) {
  color: var(--red, #ef4444);
  background: var(--red-light, #fee2e2);
}

.remove-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
