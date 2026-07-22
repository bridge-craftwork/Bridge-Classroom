<template>
  <div class="board-mastery-strip" :class="{ 'justify-start': alignLeft }" v-if="boardNumbers.length > 0">
    <button
      v-if="introUrl"
      class="intro-btn"
      @click="emit('open-intro', introUrl)"
      title="View lesson introduction"
    >
      Intro
    </button>
    <div
      v-for="(board, index) in boardMastery"
      :key="board.boardNumber"
      class="board-indicator"
      :class="[
        `status-${board.status}`,
        { active: index === currentIndex },
        { prerelease: board.prerelease },
        { 'has-medal': board.achievement !== 'none' },
        { 'medal-gold': board.achievement === 'gold' },
        { 'medal-silver': board.achievement === 'silver' }
      ]"
      @click="emit('goto', index)"
      :title="getTooltip(board)"
    >
      <span
        v-if="board.achievement === 'gold'"
        class="medal gold-medal"
      >&#9733;</span>
      <span
        v-else-if="board.achievement === 'silver'"
        class="medal silver-medal"
      >&#9733;</span>
      <!-- Wild-mastery paw, bottom-right corner (star owns top-right). -->
      <PawIcon
        v-if="board.wildAchievement"
        class="paw-mark"
        :tier="board.wildAchievement"
      />
      <span class="board-num">{{ board.boardNumber }}</span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useBoardStatus } from '../composables/useBoardStatus.js'
import { useAssignmentStatus } from '../composables/useAssignmentStatus.js'
import { useBoardMastery } from '../composables/useBoardMastery.js'
import { useUserStore } from '../composables/useUserStore.js'
import PawIcon from './PawIcon.vue'

const props = defineProps({
  boardNumbers: {
    type: Array,
    required: true
  },
  lessonSubfolder: {
    type: String,
    required: true
  },
  currentIndex: {
    type: Number,
    default: 0
  },
  forceBoardStatus: {
    type: Object,
    default: () => ({})
  },
  introUrl: {
    type: String,
    default: null
  },
  alignLeft: {
    type: Boolean,
    default: false
  },
  userId: {
    type: String,
    default: null
  },
  exerciseContext: {
    type: Object,
    default: null
    // Shape: { boards: [{displayNumber, originalSubfolder, originalBoardNumber}], assignedAt: string }
  },
  localPrerelease: {
    type: Object,
    default: () => ({})
    // Map boardNumber → boolean, derived locally from the loaded deals'
    // `stable` flag. Seeds the triangle marker before server board-status
    // arrives so beta boards don't flash as circles first.
  }
})

const emit = defineEmits(['goto', 'open-intro'])

const boardStatusApi = useBoardStatus()
const assignmentStatusApi = useAssignmentStatus()
const mastery = useBoardMastery()
const userStore = useUserStore()
const apiBoards = ref([])
const useApi = ref(false)
// Assignment-scoped server rollup, remapped to the strip's displayNumbers.
// Null until loaded / when unavailable → local computation is used instead.
const assignmentRows = ref(null)

// Fetch board status from API
async function loadBoardStatus() {
  const uid = props.userId || userStore.currentUser.value?.id
  if (!uid) return

  // Assignment/exercise mode: read the assignment-scoped server rollup. This is
  // the ONLY cross-device source of truth — computing from local observations
  // alone renders every board grey on a device that didn't play them
  // (bug-artifacts #32). Falls back to local computation when the assignment id
  // is absent (legacy context) or the rollup is unavailable/offline.
  const ctx = props.exerciseContext
  if (ctx) {
    if (!ctx.assignmentId) return
    try {
      const entries = await assignmentStatusApi.fetchAssignmentStatus(uid, ctx.assignmentId)
      if (entries && entries.length > 0) {
        // The rollup is keyed by (deal_subfolder, deal_number); the strip is
        // keyed by the exercise's sequential displayNumber. Remap so the shared
        // buildBoardMastery() colour/star logic can be reused unchanged — this
        // also keeps mixed-lesson assignments correct, where the same
        // deal_number occurs in more than one subfolder.
        const byKey = {}
        for (const e of entries) byKey[`${e.deal_subfolder}::${e.deal_number}`] = e
        assignmentRows.value = ctx.boards
          .map(b => {
            const e = byKey[`${b.originalSubfolder}::${b.originalBoardNumber}`]
            return e ? { ...e, deal_number: b.displayNumber } : null
          })
          .filter(Boolean)
      }
    } catch {
      // Leave assignmentRows null → local computation fallback below.
    }
    return
  }

  if (!props.lessonSubfolder) return

  try {
    // Scope to this lesson's collection so a subfolder shared across
    // collections shows only this one's boards. Null when unknown → unscoped
    // (legacy) fetch, so nothing breaks before the mapping is cached.
    const collectionId = mastery.getLessonCollection(props.lessonSubfolder)
    const boards = await boardStatusApi.fetchBoardStatus(uid, props.lessonSubfolder, false, collectionId)
    if (boards.length > 0) {
      apiBoards.value = boards
      useApi.value = true
    }
  } catch {
    // Fall back to local computation
  }
}

onMounted(loadBoardStatus)
watch(() => props.lessonSubfolder, loadBoardStatus)
watch(() => boardStatusApi.cacheVersion.value, loadBoardStatus)
// Re-read when the assignment changes, and after a sync invalidates the rollup
// (so a board just completed here turns colour without a reload).
watch(() => props.exerciseContext?.assignmentId, loadBoardStatus)
watch(() => assignmentStatusApi.cacheVersion.value, loadBoardStatus)

const boardMastery = computed(() => {
  // Exercise mode: compute mastery locally with date filtering across multiple subfolders
  if (props.exerciseContext) {
    const allObs = mastery.getObservations()
    const cutoff = props.exerciseContext.assignedAt
    const filtered = cutoff ? allObs.filter(o => o.timestamp >= cutoff) : allObs

    let results = props.exerciseContext.boards.map(eb => {
      const boardObs = filtered
        .filter(o =>
          (o.deal_subfolder || o.deal?.subfolder) === eb.originalSubfolder &&
          (o.deal_number ?? o.deal?.deal_number) === eb.originalBoardNumber
        )
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))

      return {
        boardNumber: eb.displayNumber,
        status: mastery.calculateCurrentStatus(boardObs),
        achievement: mastery.calculateAchievement(boardObs),
        attemptCount: mastery.groupIntoBoardAttempts(boardObs).length,
        lastAttemptTime: boardObs.length > 0 ? boardObs[boardObs.length - 1].timestamp : null
      }
    })

    // Prefer the assignment-scoped server rollup when we have it: it reflects
    // every device this student has played on, whereas `results` above only
    // knows this device's observations (bug-artifacts #32). Local results are
    // overlaid for boards played here but not yet synced, so instant feedback
    // still works and a just-played board never regresses to grey.
    if (assignmentRows.value && assignmentRows.value.length > 0) {
      const merged = boardStatusApi.buildBoardMastery(
        assignmentRows.value,
        props.boardNumbers,
        props.localPrerelease
      )
      for (const board of merged) {
        const local = results.find(r => r.boardNumber === board.boardNumber)
        if (!local || !local.lastAttemptTime) continue
        if (!board.lastObservationAt || local.lastAttemptTime > board.lastObservationAt) {
          board.status = local.status
          board.achievement = local.achievement
        }
      }
      results = merged
    }

    if (props.forceBoardStatus) {
      for (const [bn, status] of Object.entries(props.forceBoardStatus)) {
        const board = results.find(b => b.boardNumber === Number(bn))
        if (board) board.status = status
      }
    }
    return results
  }

  // Backend is the single source of truth for board state and mastery
  // (CORRECTNESS_AND_MASTERY.md §10). Local pending observations are
  // merged on top for instant feedback before the next sync.
  let results = boardStatusApi.buildBoardMastery(
    apiBoards.value || [],
    props.boardNumbers,
    props.localPrerelease
  )
  boardStatusApi.mergeLocalPending(results, props.lessonSubfolder)

  // Local override: force board statuses during/after play
  if (props.forceBoardStatus) {
    for (const [bn, status] of Object.entries(props.forceBoardStatus)) {
      const board = results.find(b => b.boardNumber === Number(bn))
      if (board) board.status = status
    }
  }
  return results
})

function getTooltip(board) {
  const statusLabels = {
    grey: 'Not attempted',
    red: 'Failed',
    yellow: 'Corrected (recent)',
    orange: 'Corrected \u2014 ready to retry',
    blue: 'Correct (try again after cooldown)',
    green: 'Clean correct'
  }
  const achievementLabels = {
    none: '',
    silver: ' | Silver star',
    gold: ' | Gold star'
  }
  const wildLabels = {
    Fresh: ' | 🐾 Fresh paw (clean on a cold wild board)',
    Recent: ' | 🐾 Recent paw (clean on a wild board)'
  }
  const prereleaseNote = board.prerelease ? ' | Beta board (under development) — not counted toward mastery' : ''
  return `Board ${board.boardNumber}: ${statusLabels[board.status] || board.status}${achievementLabels[board.achievement] || ''}${wildLabels[board.wildAchievement] || ''}${prereleaseNote}`
}
</script>

<style scoped>
.board-mastery-strip {
  display: flex;
  gap: 6px;
  padding: 8px 12px;
  background: #f8f8f8;
  border-radius: 8px;
  flex-wrap: wrap;
  justify-content: center;
}

.board-mastery-strip.justify-start {
  justify-content: flex-start;
}

.intro-btn {
  height: 32px;
  padding: 0 14px;
  border-radius: 16px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: transform 0.15s, box-shadow 0.15s;
  user-select: none;
  letter-spacing: 0.3px;
}

.intro-btn:hover {
  transform: scale(1.05);
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.4);
}

.board-indicator {
  position: relative;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  transition: transform 0.15s, box-shadow 0.15s;
  user-select: none;
}

.board-indicator:hover {
  transform: scale(1.15);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

/* Current status colors */
.status-grey {
  background: #ccc;
  color: #666;
}

.status-red {
  background: #ef5350;
  color: white;
}

.status-yellow {
  background: #ffeb3b;
  color: #333;
}

.status-orange {
  background: #ff9800;
  color: white;
}

.status-blue {
  background: #42a5f5;
  color: white;
}

.status-green {
  background: #4caf50;
  color: white;
}

/* Prerelease (beta) boards render as a triangle instead of a circle, keeping
   their status color. Signals "under development / not counted toward mastery"
   while staying navigable. The number is nudged into the wider lower half. */
.board-indicator.prerelease {
  border-radius: 0;
  clip-path: polygon(50% 6%, 96% 94%, 4% 94%);
}

.board-indicator.prerelease .board-num {
  padding-top: 9px;
  font-size: 11px;
}

/* Active board highlight — pseudo-element ring avoids outline layout quirks */
.board-indicator.active::before {
  content: '';
  position: absolute;
  inset: -5px;
  border-radius: 50%;
  border: 3px solid #1976d2;
  pointer-events: none;
}

/* Medal overlay */
.medal {
  position: absolute;
  top: -6px;
  right: -6px;
  font-size: 14px;
  z-index: 1;
  line-height: 1;
}

.gold-medal {
  color: #ffd700;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.3));
}

.silver-medal {
  color: #e8e8e8;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
}

/* Wild-mastery paw glyph (PawIcon owns fill/outline); positioned in the
   bottom-right corner (star owns top-right). */
.paw-mark {
  position: absolute;
  bottom: -5px;
  right: -5px;
  width: 13px;
  height: 13px;
  z-index: 1;
}

/* Medal + bad status: add a colored ring to make both visible */
.has-medal.status-red {
  box-shadow: 0 0 0 2px white, 0 0 0 4px #ef5350;
}

.has-medal.status-yellow {
  box-shadow: 0 0 0 2px white, 0 0 0 4px #ffc107;
}

.has-medal.status-orange {
  box-shadow: 0 0 0 2px white, 0 0 0 4px #ff9800;
}

.has-medal.status-blue {
  box-shadow: 0 0 0 2px white, 0 0 0 4px #42a5f5;
}

/* Board number text */
.board-num {
  position: relative;
  z-index: 0;
}

/* Responsive */
@media (max-width: 600px) {
  .board-mastery-strip {
    gap: 4px;
    padding: 6px 8px;
  }

  .board-indicator {
    width: 28px;
    height: 28px;
    font-size: 11px;
  }

  .intro-btn {
    height: 28px;
    padding: 0 10px;
    border-radius: 14px;
    font-size: 11px;
  }

  .board-indicator.active::before {
    inset: -4px;
    border-width: 2px;
  }

  .medal {
    font-size: 12px;
    top: -5px;
    right: -5px;
  }
}
</style>
