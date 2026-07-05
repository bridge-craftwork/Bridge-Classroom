import { createRouter, createWebHashHistory } from 'vue-router'
import MainLayout from '../views/MainLayout.vue'
import ConventionCardView from '../views/ConventionCardView.vue'

const JoinClassroomView = () => import('../views/JoinClassroomView.vue')
const BiddingPracticeView = () => import('../views/BiddingPracticeView.vue')
const TableLobbyView = () => import('../views/TableLobbyView.vue')
const TeacherConsoleView = () => import('../views/TeacherConsoleView.vue')

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
    // Catch-all: the main app layout handles lobby/collection/practice
    path: '/:pathMatch(.*)*',
    name: 'app',
    component: MainLayout
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
