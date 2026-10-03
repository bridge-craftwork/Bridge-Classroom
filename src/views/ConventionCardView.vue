<template>
  <div>
    <div v-if="handoff.message" class="handoff-note" :class="{ error: handoff.error }" role="status">
      {{ handoff.message }}
      <a v-if="handoff.needsSignIn" href="#/">Sign in</a>
    </div>
    <!-- One card, in the editor (?card=<id>). -->
    <template v-if="cardId">
      <a class="back" :href="homeHref" @click.prevent="goHome">← All cards</a>
      <ConventionCardEditor
        :embedded="embedded"
        :storage="bridgeClassroomStorage"
        :overlays="bridgeClassroomOverlays"
        @deleted="goHome"
      />
    </template>

    <!-- Home: the player's cards, from the convention-card package. -->
    <div v-else class="card-home">
      <p v-if="!signedIn" class="handoff-note">
        Sign in to see and keep your convention cards.
        <a href="#/">Sign in</a>
      </p>
      <CardCatalog
        :key="userStore.currentUser.value?.id || 'signed-out'"
        :storage="bridgeClassroomStorage"
        :overlays="bridgeClassroomOverlays"
        :embedded="embedded"
        storage-place="account"
        :card-link="cardHref"
        @open="openCard"
      />
    </div>
  </div>
</template>

<script setup>
// The convention card editor moved to github.com/bridge-craftwork/convention-card
// (its Phase 3). This view shows its home page (a table of the player's
// cards) and, for ?card=<id>, the editor, with Bridge Classroom's adapters
// (cards in this API, the lesson-mastery overlay); and it receives cards the standalone
// editor at bridge-craftwork.com/card/ hands over in the URL
// (#/convention-card?import=…; its DECISIONS.md, 20).
import { computed, onMounted, reactive, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ConventionCardEditor from '@bridge-craftwork/convention-card/web/src/editor/ConventionCardEditor.vue'
import CardCatalog from '@bridge-craftwork/convention-card/web/src/editor/CardCatalog.vue'
import { useCardEditor } from '@bridge-craftwork/convention-card/web/src/editor/useCardEditor.js'
import { decodeCardFromUrl } from '@bridge-craftwork/convention-card/js/handoff.js'
import '../utils/conventionCardLibrary.js' // where the PDF export's template and font are served
import { useUserStore } from '../composables/useUserStore.js'
import { bridgeClassroomStorage, bridgeClassroomOverlays } from '../utils/conventionCardAdapters.js'

defineProps({
  embedded: { type: Boolean, default: false }
})

// A handed-over card waits here (it survives signing in) until it is saved.
const PENDING = 'convention-card-import'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const editor = useCardEditor(bridgeClassroomStorage, bridgeClassroomOverlays)
const handoff = reactive({ message: '', needsSignIn: false, error: false })
const signedIn = computed(() => !!userStore.currentUser.value?.id)

// ─── Home or one card, by the `card` query ─────────────────────
// This view is the /convention-card page and the lobby's Convention Card
// tab; either way the query says which card is open (none: the table).
const cardId = computed(() => (typeof route.query.card === 'string' ? route.query.card : null))
const queryWith = card => {
  const { card: _, ...rest } = route.query
  return card ? { ...rest, card } : rest
}
const cardHref = id => router.resolve({ query: queryWith(id) }).href
const homeHref = computed(() => router.resolve({ query: queryWith(null) }).href)
function openCard(id) { router.push({ query: queryWith(id) }) }
function goHome() { router.push({ query: queryWith(null) }) }

// Load the card the address names, before the editor mounts where it can,
// so the editor does not load the primary card over it.
let routeLoading = false
watch(cardId, async id => {
  if (!id || editor.currentCard.value?.id === id) return
  routeLoading = true
  try {
    if (!editor.userCardLinks.value.length) editor.loadUserCardLinks()
    await editor.switchCard(id)
  } finally {
    routeLoading = false
  }
}, { immediate: true })

// The editor's own card picker switches cards: keep the address in step.
watch(() => editor.currentCard.value?.id, id => {
  if (cardId.value && id && id !== cardId.value && !routeLoading) router.replace({ query: queryWith(id) })
})

function readPending() {
  try { return localStorage.getItem(PENDING) } catch { return null }
}
function clearPending() {
  try { localStorage.removeItem(PENDING) } catch { /* nothing to clear */ }
}

// One save at a time: loading, a URL change and signing in can each ask.
let importing = false

async function importPending() {
  if (importing) return
  const text = readPending()
  if (!text) return
  if (!userStore.currentUser.value?.id) {
    Object.assign(handoff, {
      message: 'A convention card is waiting to be saved to your Bridge Classroom account.',
      needsSignIn: true,
      error: false
    })
    return
  }
  importing = true
  try {
    const record = await decodeCardFromUrl(text)
    clearPending()
    const name = record.name || 'Imported convention card'
    const id = await editor.createCard({ name, description: record.description || null, cardData: record.card_data })
    Object.assign(handoff, { message: `Saved “${name}” to your cards.`, needsSignIn: false, error: false })
    openCard(id)
  } catch (err) {
    clearPending()
    Object.assign(handoff, { message: `Could not save the card you sent: ${err.message}`, needsSignIn: false, error: true })
  } finally {
    importing = false
  }
}

// The standalone /convention-card route doesn't go through
// MainLayout, so the user store may not have been hydrated yet.
// initialize() is idempotent.
userStore.initialize()

// A card arriving in the URL, on load or in a tab already open here (a
// hash change reuses this view): keep it, take it out of the address bar,
// and save it if someone is signed in.
watch(() => route.query.import, async incoming => {
  if (typeof incoming !== 'string' || !incoming) return
  try { localStorage.setItem(PENDING, incoming) } catch { /* saved below if signed in */ }
  const { import: _, ...rest } = route.query
  await router.replace({ query: rest })
  await importPending()
}, { immediate: true })

onMounted(importPending)

// Signing in (here or in the lobby) saves a card that was waiting.
watch(() => userStore.currentUser.value?.id, uid => { if (uid) importPending() })
</script>

<style scoped>
.handoff-note {
  margin: 8px 0;
  padding: 10px 14px;
  border: 1px solid var(--card-border);
  border-radius: var(--radius-card);
  background: var(--green-pale);
  color: var(--text-primary);
  font-size: 14px;
}
.handoff-note.error {
  background: var(--red-light);
}
.card-home {
  max-width: var(--max-width, 1200px);
  margin: 0 auto;
  padding: 12px 16px 32px;
}
.back {
  display: inline-block;
  margin: 4px 0 8px;
  font-weight: 600;
  color: var(--green-dark);
  text-decoration: none;
}
.back:hover { text-decoration: underline; }
.handoff-note a {
  margin-left: 8px;
  font-weight: 600;
  color: var(--green-dark);
}
</style>
