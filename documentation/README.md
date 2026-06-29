# Bridge Classroom Documentation

This folder contains the complete specification and implementation plan for the Bridge Classroom student proficiency tracking system.

## Document Overview

| Document | Purpose |
|----------|---------|
| `PROJECT_OVERVIEW.md` | High-level vision, architecture, and goals |
| `REQUIREMENTS.md` | Detailed functional and technical requirements |
| `IMPLEMENTATION_PLAN.md` | Staged implementation with specific tasks |
| `DATA_SCHEMAS.md` | Data structures, API contracts, taxonomy |
| `CLAUDE_CODE_QUICKSTART.md` | Quick reference for starting implementation |

## Quick Links

### For Understanding the Project
1. Start with `PROJECT_OVERVIEW.md` for the big picture
2. Read `REQUIREMENTS.md` for detailed specifications

### For Implementation
1. Read `CLAUDE_CODE_QUICKSTART.md` first
2. Follow stages in `IMPLEMENTATION_PLAN.md`
3. Reference `DATA_SCHEMAS.md` for data structures

## Project Summary

**What:** A web app for bridge students to practice bidding, track their progress, and identify skill gaps.

**Key Features:**
- User identification (name + classroom)
- Bidding practice with 1,173 Baker Bridge deals
- Client-side encryption (student owns their data)
- Progress visualization for students
- Teacher dashboard for class insights

**Tech Stack:**
- Frontend: Vue 3 + Vite (existing repo)
- Backend: Rust/Axum (new)
- Database: SQLite
- Hosting: GitHub Pages + harmonicsystems.com

## Implementation Stages

| Stage | Description | Duration |
|-------|-------------|----------|
| 1 | User Onboarding & Local Storage | 2-3 days |
| 2 | Cryptography & Key Management | 2-3 days |
| 3 | Observation Recording | 2-3 days |
| 4 | Backend API Server | 3-4 days |
| 5 | Data Synchronization | 2-3 days |
| 6 | Student Progress View | 3-4 days |
| 7 | Teacher Dashboard | 4-5 days |
| 8 | Deployment & Polish | 2-3 days |

**Total estimated time:** 3-4 weeks

## Existing Code

**Repository:** https://github.com/bridge-craftwork/Bridge-Offline-Practice

The Vue app already has:
- Bridge table UI with all four hands
- Bidding box component
- PBN file parsing
- Bidding practice flow
- Basic feedback system

We're extending this with user management, data persistence, and progress tracking.

## Content Source

Baker Bridge deals (with permission): https://bakerbridge.coffeecup.com/
- 1,173 interactive practice deals
- 49 skill categories
- Rich instructional commentary

## Contact

Project Owner: Rick Wilson
- GitHub: @Rick-Wilson
- Teaching: Bridge classes in Bay Area
