# Implementation Plan

## Overview

This document outlines the staged implementation plan for the Bridge Classroom project. Each stage builds on the previous one and delivers incremental value.

**Existing Codebase:** https://github.com/bridge-craftwork/Bridge-Offline-Practice
- Vue 3 + Vite
- Components: BridgeTable, HandDisplay, BiddingBox, AuctionTable, DealNavigator, FeedbackPanel, DealInfo
- Composables: useBiddingPractice.js (335 lines)
- Utils: pbnParser.js (389 lines), cardFormatting.js
- Tests: Vitest configured

**Content Source:** Baker Bridge deals (1,173 deals across 49 categories)
- CSV available at: /Users/rick/Development/GitHub/Baker-Bridge/Tools/BakerBridgeFull.csv
- PBN files also available

---

## Stage 1: User Onboarding & Local Storage

**Goal:** Students can identify themselves and the app remembers them

**Duration:** 2-3 days

### Tasks

#### 1.1 Create WelcomeScreen Component
```
src/components/WelcomeScreen.vue
```
- First-time user form (firstName, lastName, classroom dropdown, consent checkbox)
- Returning user greeting with continue/switch options
- User switching modal for shared computers
- Form validation

#### 1.2 Create User Store
```
src/composables/useUserStore.js
```
- Load/save users to localStorage
- Current user management
- User CRUD operations
- Classroom constants

#### 1.3 Integrate with App.vue
- Show WelcomeScreen when no current user or on explicit switch
- Pass current user to practice components
- Add settings menu for user management

#### 1.4 Create Settings Panel
```
src/components/SettingsPanel.vue
```
- View/edit current user
- Switch user
- Change data consent
- (Placeholder for key backup - Stage 2)

### Deliverables
- [ ] WelcomeScreen.vue component
- [ ] useUserStore.js composable
- [ ] SettingsPanel.vue component
- [ ] Updated App.vue with user flow
- [ ] Unit tests for useUserStore

### Testing Checklist
- [ ] First-time user can register
- [ ] Returning user sees greeting
- [ ] Multiple users on same browser work
- [ ] User switching works
- [ ] Data persists across browser refresh

---

## Stage 2: Cryptography & Key Management

**Goal:** Generate and manage encryption keys for each user

**Duration:** 2-3 days

### Tasks

#### 2.1 Create Crypto Utility
```
src/utils/crypto.js
```
Functions:
- `generateKeyPair()` - RSA-OAEP 2048-bit keypair
- `exportKey(key)` - Export to base64 string
- `importKey(keyData, isPublic)` - Import from base64
- `generateSymmetricKey()` - AES-256-GCM key
- `encryptObservation(observation, studentPubKey, teacherPubKey)` - Full encryption flow
- `decryptObservation(encrypted, privateKey)` - Decryption flow

#### 2.2 Integrate Key Generation into Onboarding
- Generate keypair on user registration
- Store privateKey in localStorage (per user)
- Prepare publicKey for server registration (Stage 4)

#### 2.3 Teacher Public Key Management
- Hardcode teacher public key initially (can fetch from server later)
- Store in localStorage for offline use

#### 2.4 Key Backup Feature
```
src/components/KeyBackupModal.vue
```
- Show after registration
- Generate downloadable JSON backup file
- "Download Key Backup" button
- "I understand, continue" to dismiss

#### 2.5 Key Restoration
- Add to WelcomeScreen: "Restore from Backup" option
- File upload and validation
- Merge restored user into localStorage

### Deliverables
- [ ] crypto.js utility module
- [ ] KeyBackupModal.vue component
- [ ] Key restoration flow in WelcomeScreen
- [ ] Updated useUserStore to handle keys
- [ ] Unit tests for crypto functions

### Testing Checklist
- [ ] Keypair generates successfully
- [ ] Keys persist across sessions
- [ ] Backup file downloads correctly
- [ ] Backup file can be restored
- [ ] Encryption/decryption round-trips correctly

---

## Stage 3: Observation Recording

**Goal:** Record each bid attempt with full context

**Duration:** 2-3 days

### Tasks

#### 3.1 Create Observation Schema
```
src/utils/observationSchema.js
```
- TypeScript/JSDoc types for observation structure
- Validation function
- Helper to create observation from bid attempt

#### 3.2 Create Baker Bridge Taxonomy
```
src/utils/bakerBridgeTaxonomy.js
```
- Mapping of subfolder → skill path
- Category groupings
- Helper functions for lookups

#### 3.3 Integrate with useBiddingPractice
Modify existing composable to:
- Call `recordObservation()` on each bid (correct or incorrect)
- Include full deal context
- Include auction state at time of bid
- Track time taken
- Track attempt number

#### 3.4 Create Observation Store
```
src/composables/useObservationStore.js
```
- Queue observations locally
- Encrypt before queuing (using crypto.js)
- Persist queue to localStorage
- Expose pending count

### Deliverables
- [ ] observationSchema.js
- [ ] bakerBridgeTaxonomy.js (all 49 categories mapped)
- [ ] useObservationStore.js composable
- [ ] Modified useBiddingPractice.js
- [ ] Unit tests for observation creation

### Testing Checklist
- [ ] Correct bid records observation with correct=true
- [ ] Wrong bid records observation with correct=false
- [ ] All deal context captured
- [ ] Observations persist in localStorage
- [ ] Observations are encrypted

---

## Stage 4: Backend API Server

**Goal:** Server to receive and store encrypted observations

**Duration:** 3-4 days

### Tasks

#### 4.1 Create Rust Project
```
bridge-classroom-api/
├── Cargo.toml
├── src/
│   ├── main.rs
│   ├── routes/
│   │   ├── mod.rs
│   │   ├── keys.rs
│   │   ├── users.rs
│   │   └── observations.rs
│   ├── models/
│   │   ├── mod.rs
│   │   ├── user.rs
│   │   └── observation.rs
│   ├── db.rs
│   └── config.rs
└── migrations/
```

#### 4.2 Dependencies (Cargo.toml)
```toml
[dependencies]
axum = "0.7"
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
sqlx = { version = "0.7", features = ["runtime-tokio", "sqlite"] }
tower-http = { version = "0.5", features = ["cors"] }
tracing = "0.1"
tracing-subscriber = "0.3"
```

#### 4.3 Implement Endpoints

**GET /api/keys/teacher**
- Return hardcoded teacher public key

**POST /api/users**
- Receive: user_id, first_name, last_name, classroom, public_key
- Encrypt names with server-side key (for admin queries)
- Store in SQLite

**POST /api/observations**
- Receive: array of encrypted observations
- Validate API key header
- Store each observation
- Return count received/stored

**GET /api/observations**
- Query params: user_id, classroom, skill_path, date range
- Return matching observations (encrypted blobs)

**GET /api/observations/metadata**
- Same query params
- Return only metadata (no encrypted blobs) - for dashboard summaries

#### 4.4 Database Setup
- SQLite for simplicity
- Schema from REQUIREMENTS.md
- Migrations with sqlx

#### 4.5 Configuration
- Environment variables for:
  - DATABASE_URL
  - API_KEY
  - TEACHER_PUBLIC_KEY
  - ALLOWED_ORIGINS
- Config file fallback

#### 4.6 CORS Setup
- Allow practice.harmonicsystems.com
- Allow localhost for development

### Deliverables
- [ ] Rust project structure
- [ ] All API endpoints implemented
- [ ] SQLite database with migrations
- [ ] Configuration management
- [ ] Docker/containerization (optional)
- [ ] README with setup instructions

### Testing Checklist
- [ ] Can register a user
- [ ] Can POST observations
- [ ] Can GET observations by user
- [ ] Can GET observations by classroom
- [ ] API key validation works
- [ ] CORS works from allowed origins

---

## Stage 5: Data Synchronization

**Goal:** Vue app syncs observations to server reliably

**Duration:** 2-3 days

### Tasks

#### 5.1 Create Data Sync Composable
```
src/composables/useDataSync.js
```
- Sync pending observations to server
- Retry with exponential backoff
- Handle offline gracefully
- Use sendBeacon on page unload

#### 5.2 Server Registration on Onboarding
- After user created locally, POST to /api/users
- Store registration status in user object
- Retry registration if failed

#### 5.3 Fetch Teacher Public Key
- On app init, fetch from /api/keys/teacher
- Cache in localStorage
- Fallback to cached if offline

#### 5.4 Sync Status Indicator
```
src/components/SyncStatus.vue
```
- Small indicator showing sync state
- Pending count badge
- Error state with retry button
- "All synced" confirmation

#### 5.5 Integrate Sync Triggers
- After observation recorded (debounced)
- On visibility change (tab focus)
- On online event
- Before unload

### Deliverables
- [ ] useDataSync.js composable
- [ ] SyncStatus.vue component
- [ ] Server registration in onboarding
- [ ] Teacher key fetching
- [ ] Integration with observation store

### Testing Checklist
- [ ] Observations sync when online
- [ ] Observations queue when offline
- [ ] Queue syncs when back online
- [ ] Sync status shows correct state
- [ ] Page close doesn't lose data

---

## Stage 6: Student Progress View

**Goal:** Students can see their own practice history and progress

**Duration:** 3-4 days

### Tasks

#### 6.1 Create Progress Dashboard
```
src/components/ProgressDashboard.vue
```
- Overall stats: total deals, accuracy %, streak
- Today/this week summary
- Quick links to practice

#### 6.2 Create Skill Breakdown Chart
```
src/components/SkillChart.vue
```
- Bar chart or radar chart of categories
- Color coded by proficiency
- Click to filter history

#### 6.3 Create Practice History
```
src/components/PracticeHistory.vue
```
- List of sessions
- Expandable to show individual deals
- Show expected vs actual bids

#### 6.4 Fetch and Decrypt Own Data
```
src/composables/useStudentProgress.js
```
- Fetch observations from server (by user_id)
- Decrypt with student's private key
- Aggregate into stats
- Cache locally

#### 6.5 Offline Progress View
- Use locally stored observations for instant display
- Supplement with server data when available

### Deliverables
- [ ] ProgressDashboard.vue
- [ ] SkillChart.vue
- [ ] PracticeHistory.vue
- [ ] useStudentProgress.js composable
- [ ] Navigation to progress view

### Testing Checklist
- [ ] Dashboard shows correct totals
- [ ] Skill chart reflects actual performance
- [ ] History lists all sessions
- [ ] Decryption works correctly
- [ ] Works offline with local data

---

## Stage 7: Teacher Dashboard

**Goal:** Teacher can view all student data and insights

**Duration:** 4-5 days

### Tasks

#### 7.1 Create Teacher Auth
```
src/components/TeacherLogin.vue
```
- Simple password entry
- Store session in localStorage (or cookie)
- Logout function

#### 7.2 Teacher Private Key Entry
- Option 1: Password unlocks stored encrypted key
- Option 2: Upload key file each session
- Option 3: Paste key (least secure but simplest)

#### 7.3 Classroom List View
```
src/components/teacher/ClassroomList.vue
```
- All classrooms with summary stats
- Participation rates
- Average accuracy
- Click to drill in

#### 7.4 Classroom Detail View
```
src/components/teacher/ClassroomDetail.vue
```
- Student list with stats
- Class skill profile
- Recommended focus areas
- Participation tracking

#### 7.5 Student Detail View
```
src/components/teacher/StudentDetail.vue
```
- Full proficiency breakdown
- Trend charts
- Recent errors with deal context
- Notes (optional)

#### 7.6 Data Fetching and Decryption
```
src/composables/useTeacherDashboard.js
```
- Fetch all observations (or by classroom)
- Decrypt with teacher private key
- Aggregate statistics
- Cache for performance

### Deliverables
- [ ] TeacherLogin.vue
- [ ] ClassroomList.vue
- [ ] ClassroomDetail.vue
- [ ] StudentDetail.vue
- [ ] useTeacherDashboard.js
- [ ] Teacher-specific routes

### Testing Checklist
- [ ] Login/logout works
- [ ] Can view all classrooms
- [ ] Can drill into classroom
- [ ] Can view student detail
- [ ] Decryption works for all students
- [ ] Stats aggregate correctly

---

## Stage 8: Deployment & Polish

**Goal:** Deploy to production, polish UX

**Duration:** 2-3 days

### Tasks

#### 8.1 GitHub Pages Setup
- Configure vite.config.js for production build
- Create GitHub Actions workflow for auto-deploy
- Configure custom domain (practice.harmonicsystems.com)

#### 8.2 Cloudflare Configuration
- DNS: CNAME practice → GitHub Pages
- DNS: A/CNAME api → backend server
- SSL/TLS settings
- Caching rules

#### 8.3 Backend Deployment
- Option A: Deploy to fly.io / railway
- Option B: Run on your VM with Cloudflare Tunnel
- Set environment variables
- Database backup strategy

#### 8.4 Generate Teacher Keypair
- Generate production keypair
- Store private key securely (not in repo!)
- Configure public key in backend

#### 8.5 UX Polish
- Loading states
- Error messages
- Empty states
- Mobile responsiveness
- Font sizes for seniors

#### 8.6 Documentation
- User guide for students
- Teacher dashboard guide
- API documentation
- Deployment runbook

### Deliverables
- [ ] GitHub Actions workflow
- [ ] Production vite config
- [ ] Cloudflare setup documented
- [ ] Backend deployed
- [ ] Teacher keys generated
- [ ] User documentation

### Testing Checklist
- [ ] App loads from custom domain
- [ ] API accessible from app
- [ ] Full user flow works in production
- [ ] Teacher dashboard works in production
- [ ] No console errors
- [ ] Mobile works

---

## Future Stages (Post-MVP)

### Stage 9: Partner Sharing
- Share data with regular bridge partner
- Re-encrypt observations for partner's key
- Manage sharing permissions

### Stage 10: BEN Integration
- Evaluate BEN bot for card play
- API integration
- Card play practice mode

### Stage 11: Advanced Analytics
- "Bridge Perimetry" visualization
- Improvement predictions
- Personalized practice recommendations

### Stage 12: Multi-Teacher Support
- Multiple teacher accounts
- Classroom ownership
- Shared classrooms

---

## Development Environment Setup

### Prerequisites
- Node.js 18+
- Rust toolchain (rustup)
- SQLite
- Git

### Vue App (Bridge-Offline-Practice)
```bash
cd Bridge-Offline-Practice
npm install
npm run dev        # Development server
npm run test       # Run tests
npm run build      # Production build
```

### API Server (bridge-classroom-api)
```bash
cd bridge-classroom-api
cp .env.example .env
# Edit .env with your values
cargo run          # Development server
cargo test         # Run tests
cargo build --release  # Production build
```

### Environment Variables

**Vue App (.env)**
```
VITE_API_URL=http://localhost:3000/api
VITE_TEACHER_PUBLIC_KEY=base64...
```

**API Server (.env)**
```
DATABASE_URL=sqlite:./data/bridge_classroom.db
API_KEY=your-secret-api-key
TEACHER_PUBLIC_KEY=base64...
ALLOWED_ORIGINS=http://localhost:5173,https://practice.harmonicsystems.com
```
