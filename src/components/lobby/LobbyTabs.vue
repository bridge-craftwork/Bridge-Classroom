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
  </div>
</template>

<script setup>
const TAB_LABELS = {
  lessons: 'Lessons',
  students: 'Students',
  classrooms: 'Classrooms',
  exercises: 'Exercises',
  assignments: 'Assignments',
  dealLibrary: 'Deal Library',
  conventionCard: 'Convention Card',
  admin: 'Admin'
}

defineProps({
  tabs: { type: Array, required: true },
  active: { type: String, required: true }
})

defineEmits(['update:active'])
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
</style>
