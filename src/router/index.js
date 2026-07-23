import { createRouter, createWebHashHistory } from 'vue-router'
import MainLayout from '../views/MainLayout.vue'
import ConventionCardView from '../views/ConventionCardView.vue'

const JoinClassroomView = () => import('../views/JoinClassroomView.vue')
const TableLobbyView = () => import('../views/TableLobbyView.vue')
const TeacherConsoleView = () => import('../views/TeacherConsoleView.vue')
const TableView = () => import('../views/TableView.vue')

const routes = [
  {
    path: '/join/:joinCode',
    name: 'join',
    component: JoinClassroomView
  },
  {
    // The unified practice/host table. Starts solo (LocalEngine, no droplet
    // cost); upgrades to a served table-service session in place when you invite
    // (or with ?host=1). Replaces the old /bidding-practice + /tables/host split.
    path: '/table',
    name: 'table',
    component: TableView
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
    // Join a served table by invite code (social URL). A REQUIRED code, so bare
    // /table is the unified table above, not the join lobby. Unknown codes fall
    // back to a direct session-id join (keeps #/table/demo working).
    path: '/table/:inviteCode',
    name: 'table-join',
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
