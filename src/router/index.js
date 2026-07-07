import { createRouter, createWebHashHistory } from 'vue-router'
import MainLayout from '../views/MainLayout.vue'
import ConventionCardView from '../views/ConventionCardView.vue'

const JoinClassroomView = () => import('../views/JoinClassroomView.vue')
const BiddingPracticeView = () => import('../views/BiddingPracticeView.vue')
const TableLobbyView = () => import('../views/TableLobbyView.vue')
const TeacherConsoleView = () => import('../views/TeacherConsoleView.vue')
const TableHostView = () => import('../views/TableHostView.vue')

const routes = [
  {
    path: '/join/:joinCode',
    name: 'join',
    component: JoinClassroomView
  },
  {
    path: '/bidding-practice',
    name: 'bidding-practice',
    component: BiddingPracticeView
  },
  {
    path: '/convention-card',
    name: 'convention-card',
    component: ConventionCardView
  },
  {
    // Multiplayer tables: teacher's evergreen class URL. Bare /play shows
    // the remembered-tables picker (auto-connects if exactly one is live).
    path: '/play/:hostCode?',
    name: 'play',
    component: TableLobbyView
  },
  {
    // Multiplayer tables: player's evergreen social URL. Unknown codes fall
    // back to a direct session-id join (keeps #/table/demo working).
    path: '/table/:inviteCode?',
    name: 'table',
    component: TableLobbyView
  },
  {
    // Legacy create page → the console is now the teacher home (it starts a
    // session itself). Redirect any old links.
    path: '/tables/new',
    redirect: '/tables/console'
  },
  {
    // Teacher home + live console. No :sessionId → it resolves the teacher's
    // open session or offers Start; with an id → joins that session.
    path: '/tables/console/:sessionId?',
    name: 'tables-console',
    component: TeacherConsoleView
  },
  {
    // Single-table "host a table" surface for any signed-in user (non-teacher
    // friendly): one casual table, invite link, deal source — no multi-table
    // console chrome. The owner is the see-all controller server-side.
    path: '/tables/host',
    name: 'tables-host',
    component: TableHostView
  },
  {
    // Catch-all: the main app layout handles lobby/collection/practice
    path: '/:pathMatch(.*)*',
    name: 'app',
    component: MainLayout
  }
]

// Rendering harness (Tier 1). Behind VITE_HARNESS: the flag is statically
// replaced at build time, so a production build (flag unset) dead-code-drops
// this branch and never emits the harness chunk or its specimens.
if (import.meta.env.VITE_HARNESS === '1') {
  routes.unshift({
    path: '/harness/component/:component/:specimen',
    name: 'harness-component',
    component: () => import('../harness/HarnessComponentView.vue')
  })
  routes.unshift({
    path: '/harness/scene/:scene',
    name: 'harness-scene',
    component: () => import('../harness/HarnessSceneView.vue')
  })
}

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
