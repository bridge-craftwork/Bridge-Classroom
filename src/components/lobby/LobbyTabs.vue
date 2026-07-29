<template>
  <div class="lobby-tabs">
    <button
      v-for="tab in tabs"
      :key="tab"
      class="tab-btn"
      :class="{ active: tab === active }"
      @click="$emit('update:active', tab)"
    >
      {{ TAB_LABELS[tab] }}
    </button>

    <!-- Global anonymize toggle. Only teachers/admins see it; it governs every
         teacher-facing student-name display via the shared singleton (issue #334). -->
    <button
      v-if="showAnonToggle"
      class="anon-btn"
      :class="{ active: anon.isAnonymized.value }"
      :title="anon.isAnonymized.value ? 'Showing anonymized names — click to reveal' : 'Hide student names/emails for screenshots or class presentation'"
      @click="anon.toggleAnonymize()"
    >
      {{ anon.isAnonymized.value ? 'Anon: On' : 'Anon: Off' }}
    </button>
  </div>
</template>

<script setup>
import { useAnonymizer } from '../../composables/useAnonymizer.js'

const TAB_LABELS = {
  lessons: 'Lessons',
  students: 'Students',
  classrooms: 'Classrooms',
  exercises: 'Exercises',
  assignments: 'Assignments',
  dealLibrary: 'Deal Library',
  friends: 'Friends',
  conventionCard: 'Convention Card',
  admin: 'Admin'
}

defineProps({
  tabs: { type: Array, required: true },
  active: { type: String, required: true },
  showAnonToggle: { type: Boolean, default: false }
})

defineEmits(['update:active'])

const anon = useAnonymizer()
</script>

<style scoped>
.lobby-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

.tab-btn {
  padding: 10px 18px;
  border: none;
  background: transparent;
  color: #666;
  font-size: 14px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.2s;
}

.tab-btn:hover {
  background: #e8e8e8;
}

.tab-btn.active {
  background: var(--green-mid, #40916c);
  color: white;
}

/* Anonymize toggle — pushed to the far right of the tab strip. */
.anon-btn {
  margin-left: auto;
  align-self: center;
  padding: 8px 14px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  background: white;
  color: #666;
  border: 1px solid #ddd;
  transition: all 0.2s;
}

.anon-btn:hover {
  background: #f5f5f5;
  color: #333;
}

.anon-btn.active {
  background: #fff3e0;
  color: #e65100;
  border-color: #ffcc80;
}

.anon-btn.active:hover {
  background: #ffe0b2;
}
</style>
