<template>
  <div v-if="hasRecentLessons" class="recent-lessons">
    <div class="section-header">
      <h3 class="section-title">Pick up where you left off</h3>
      <button
        v-if="totalStartedLessons > recentLessons.length"
        class="view-all-link"
        @click="$emit('show-progress')"
      >
        All started lessons &rarr;
      </button>
    </div>

    <div class="lesson-cards">
      <div
        v-for="lesson in recentLessons"
        :key="lesson.subfolder"
        class="lesson-card"
      >
        <div class="card-top">
          <div class="card-titles">
            <span v-if="lesson.collectionName" class="collection-label">
              {{ lesson.collectionName.toUpperCase() }}
            </span>
            <span class="lesson-name">
              {{ lesson.displayName }}
              <span
                v-if="lesson.tier"
                class="tier-badge"
                :class="`tier-${lesson.tier.toLowerCase()}`"
              >{{ lesson.tier }}</span>
            </span>
            <span class="board-count">{{ boardProgressText(lesson) }}</span>
          </div>
          <div class="card-right">
            <span class="relative-time">{{ lesson.relativeTime }}</span>
            <button
              class="resume-btn"
              @click.stop="$emit('resume-lesson', {
                subfolder: lesson.subfolder,
                dealNumber: lesson.resumeDealNumber
              })"
            >
              Resume
            </button>
          </div>
        </div>

        <div class="mastery-bar">
          <div
            v-for="seg in masterySegments(lesson)" :key="seg.label"
            class="segment"
            :style="{ width: seg.pct, backgroundColor: seg.color }"
            :title="`${seg.label}: ${seg.count}`"
          ></div>
        </div>

        <div class="mastery-counts">
          <span
            v-for="seg in masterySegments(lesson)" :key="seg.label"
            class="count"
          >
            <span class="count-dot" :style="{ backgroundColor: seg.color }"></span>
            {{ seg.count }} {{ seg.label }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import { useRecentLessons } from '../../composables/useRecentLessons.js'
import { STATUS_COLORS } from '../../utils/studentProgressData.js'

defineEmits(['resume-lesson', 'show-progress'])

const { recentLessons, hasRecentLessons, totalStartedLessons, ensureBoardCounts } = useRecentLessons()

// Bucket per CORRECTNESS_AND_MASTERY.md §5. close_correct + corrected
// share the orange swatch (§5.4 drilldown rule) but stay distinct in
// tooltips. Mirrors StudentProgressPanel.masterySegments.
function masterySegments(lesson) {
  const c = lesson.stateCounts || { clean_correct: 0, close_correct: 0, corrected: 0, failed: 0, not_attempted: 0 }
  const orangeCount = c.close_correct + c.corrected
  const orangeLabel = c.close_correct && c.corrected
    ? `Corrected / close (${c.corrected} corrected, ${c.close_correct} close)`
    : c.corrected
      ? 'Corrected'
      : 'Close correct'
  const segments = [
    { count: c.clean_correct,   color: STATUS_COLORS.clean_correct, label: 'Clean correct' },
    { count: orangeCount,       color: STATUS_COLORS.close_correct, label: orangeLabel },
    { count: c.failed,          color: STATUS_COLORS.failed,        label: 'Failed' },
    { count: c.not_attempted,   color: STATUS_COLORS.not_attempted, label: 'Not attempted' },
  ].filter(s => s.count > 0)
  const sum = segments.reduce((s, seg) => s + seg.count, 0) || 1
  segments.forEach(s => { s.pct = `${(s.count / sum * 100).toFixed(1)}%` })
  return segments
}

function boardProgressText(lesson) {
  return `${lesson.tried || 0} of ${lesson.totalBoards} tried`
}

onMounted(() => {
  ensureBoardCounts()
})
</script>

<style scoped>
.recent-lessons {
  margin-bottom: 32px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.section-title {
  font-family: var(--font-heading, 'Source Serif 4', serif);
  font-size: 20px;
  color: var(--green-dark, #2d6a4f);
  margin: 0;
}

.view-all-link {
  background: none;
  border: none;
  color: var(--green-dark, #2d6a4f);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  padding: 4px 0;
}

.view-all-link:hover {
  text-decoration: underline;
}

.lesson-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}

.lesson-card {
  background: white;
  border-radius: var(--radius-card, 10px);
  border: 1px solid var(--card-border, #e0ddd7);
  padding: 16px 20px;
}

.card-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 8px;
}

.card-titles {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.collection-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.5px;
  color: var(--text-secondary, #6b7280);
}

.lesson-name {
  font-family: var(--font-heading, 'Source Serif 4', serif);
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary, #1a1a1a);
  line-height: 1.2;
}

/* Lesson mastery tier (CORRECTNESS_AND_MASTERY.md §13). */
.tier-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 7px;
  border-radius: 10px;
  font-family: var(--font-body, system-ui, sans-serif);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.3px;
  text-transform: uppercase;
  vertical-align: 2px;
}
.tier-badge.tier-exploring {
  background: #eef0f3;
  color: #5f6b7a;
}
.tier-badge.tier-learning {
  background: #dde9f5;
  color: #1d4f80;
}
.tier-badge.tier-retaining {
  background: #d8efdc;
  color: #1f6638;
}
.tier-badge.tier-mastering {
  background: #fbe9b8;
  color: #7a5a08;
}

.board-count {
  font-size: 13px;
  color: var(--text-secondary, #6b7280);
  margin-top: 2px;
}

.card-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  flex-shrink: 0;
}

.relative-time {
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
  white-space: nowrap;
}

.resume-btn {
  padding: 6px 16px;
  font-size: 13px;
  font-weight: 600;
  color: white;
  background: var(--green-dark, #2d6a4f);
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.2s;
  white-space: nowrap;
}

.resume-btn:hover {
  background: var(--green-mid, #40916c);
}

.mastery-bar {
  display: flex;
  height: 8px;
  background: var(--card-border, #e0ddd7);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 8px;
  gap: 1px;
}

.segment {
  height: 100%;
  transition: width 0.3s ease;
}

.mastery-counts {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
  flex-wrap: wrap;
}

.count {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.count-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

@media (max-width: 600px) {
  .lesson-cards {
    grid-template-columns: 1fr;
  }

  .card-top {
    flex-direction: column;
    gap: 8px;
  }

  .card-right {
    flex-direction: row;
    align-items: center;
    width: 100%;
    justify-content: space-between;
  }
}
</style>
