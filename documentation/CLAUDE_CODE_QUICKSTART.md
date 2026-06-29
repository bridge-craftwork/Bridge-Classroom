# Claude Code Quick Start Guide

## Project Context

You are implementing a bridge teaching platform that tracks student progress. This document provides the essential context for Claude Code to begin implementation.

## Existing Codebase

**Repository:** https://github.com/bridge-craftwork/Bridge-Offline-Practice

**Current Structure:**
```
Bridge-Offline-Practice/
├── src/
│   ├── components/
│   │   ├── AuctionTable.vue      # Displays bidding history
│   │   ├── BiddingBox.vue        # Bidding input interface
│   │   ├── BridgeTable.vue       # Main table layout (N/E/S/W)
│   │   ├── DealInfo.vue          # Deal metadata display
│   │   ├── DealNavigator.vue     # Navigate between deals
│   │   ├── FeedbackPanel.vue     # Right/wrong feedback
│   │   └── HandDisplay.vue       # Single hand rendering
│   ├── composables/
│   │   └── useBiddingPractice.js # Main game state (335 lines)
│   ├── utils/
│   │   ├── pbnParser.js          # PBN file parsing (389 lines)
│   │   └── cardFormatting.js     # Card display utilities
│   ├── App.vue
│   └── main.js
├── public/
├── package.json                   # Vue 3 + Vite
├── vite.config.js
└── vitest.config.js
```

**Tech Stack:**
- Vue 3 (Composition API with `<script setup>`)
- Vite for build
- Vitest for testing
- No CSS framework (plain CSS)

## What We're Building

### Stage 1: User Onboarding (Start Here)

Add user identification so we know who is practicing.

**New Files to Create:**
```
src/
├── components/
│   ├── WelcomeScreen.vue         # First-run / returning user flow
│   ├── SettingsPanel.vue         # User settings, consent management
│   └── KeyBackupModal.vue        # Download encryption key backup
├── composables/
│   └── useUserStore.js           # User management (localStorage)
└── utils/
    └── crypto.js                 # Encryption utilities (Stage 2)
```

**Key Requirements:**

1. **First-time flow:**
   - Prompt for firstName, lastName
   - Dropdown for classroom (Tuesday AM, Tuesday PM, Thursday Zoom, Private - Ladies, Private - Nancies)
   - Checkbox for data sharing consent (default: checked)
   - Store in localStorage

2. **Returning user:**
   - Detect existing user
   - Show "Welcome back, {name}!"
   - Option to switch users (for shared computers)

3. **localStorage schema:**
```javascript
{
  "bridgePractice": {
    "currentUserId": "uuid",
    "users": {
      "uuid": {
        "id": "uuid",
        "firstName": "Margaret",
        "lastName": "Thompson", 
        "classroom": "tuesday-am",
        "dataConsent": true,
        "createdAt": "ISO8601"
      }
    }
  }
}
```

### Coding Guidelines

**Vue Component Style:**
```vue
<script setup>
import { ref, computed, onMounted } from 'vue'

const props = defineProps({
  // ...
})

const emit = defineEmits(['userReady'])

// Reactive state
const firstName = ref('')

// Computed
const isValid = computed(() => firstName.value.trim().length > 0)

// Methods
function handleSubmit() {
  // ...
  emit('userReady', userData)
}

// Lifecycle
onMounted(() => {
  // ...
})
</script>

<template>
  <!-- Template here -->
</template>

<style scoped>
/* Styles here */
</style>
```

**Composable Style:**
```javascript
import { ref, computed, watch } from 'vue'

const STORAGE_KEY = 'bridgePractice'

export function useUserStore() {
  // State
  const users = ref({})
  const currentUserId = ref(null)
  
  // Computed
  const currentUser = computed(() => 
    currentUserId.value ? users.value[currentUserId.value] : null
  )
  
  // Methods
  function loadFromStorage() {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const data = JSON.parse(stored)
      users.value = data.users || {}
      currentUserId.value = data.currentUserId
    }
  }
  
  function saveToStorage() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      currentUserId: currentUserId.value,
      users: users.value
    }))
  }
  
  function createUser(userData) {
    const id = crypto.randomUUID()
    users.value[id] = {
      id,
      ...userData,
      createdAt: new Date().toISOString()
    }
    currentUserId.value = id
    saveToStorage()
    return users.value[id]
  }
  
  // Initialize
  loadFromStorage()
  
  return {
    users,
    currentUser,
    currentUserId,
    createUser,
    // ... other methods
  }
}
```

## Reference Documents

For full details, see:
- `PROJECT_OVERVIEW.md` - Vision and architecture
- `REQUIREMENTS.md` - Detailed requirements
- `IMPLEMENTATION_PLAN.md` - Staged implementation with all tasks
- `DATA_SCHEMAS.md` - Data structures and API contracts

## Getting Started

1. Clone the repository:
```bash
git clone https://github.com/bridge-craftwork/Bridge-Offline-Practice.git
cd Bridge-Offline-Practice
npm install
```

2. Start development server:
```bash
npm run dev
```

3. Begin with Stage 1, Task 1.1: Create WelcomeScreen.vue

## Testing

Run tests with:
```bash
npm run test
```

Write tests for composables:
```javascript
// src/composables/__tests__/useUserStore.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { useUserStore } from '../useUserStore'

describe('useUserStore', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  
  it('creates a new user', () => {
    const store = useUserStore()
    const user = store.createUser({
      firstName: 'Test',
      lastName: 'User',
      classroom: 'tuesday-am',
      dataConsent: true
    })
    
    expect(user.id).toBeDefined()
    expect(user.firstName).toBe('Test')
    expect(store.currentUser.value).toEqual(user)
  })
})
```

## Questions?

If anything is unclear, refer to the detailed documentation or ask for clarification. The key principle: **keep it simple**, especially for the seniors who will use this app.
