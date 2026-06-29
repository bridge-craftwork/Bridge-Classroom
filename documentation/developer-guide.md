# Bridge Classroom Developer Guide

## Project Structure

```
Bridge-Classroom/
├── src/                    # Vue.js frontend source
│   ├── components/         # Vue components
│   ├── composables/        # Vue composables (state, logic)
│   └── utils/              # Utility functions
├── public/                 # Static assets (copied to dist/)
│   ├── data/               # PBN lesson files
│   └── CNAME               # GitHub Pages custom domain
├── bridge-classroom-api/   # Rust backend API
│   ├── src/                # Rust source code
│   ├── data/               # SQLite database
│   └── target/release/     # Compiled binary
├── dist/                   # Built frontend (generated)
└── docs/                   # Documentation
```

---

## Frontend Development

### Local Development

```bash
cd /Users/rick/Development/GitHub/Bridge-Classroom

# Start dev server (hot reload)
npm run dev
# Opens at http://localhost:5173

# Run tests
npm test

# Build for production
npm run build
```

### Making Frontend Changes

1. **Edit files** in `src/` directory
2. **Test locally** with `npm run dev`
3. **Commit and push** to deploy:

```bash
git add -A
git commit -m "Description of changes"
git push origin main
```

4. **Automatic deployment**: GitHub Actions builds and deploys to GitHub Pages
5. **Check deployment**: https://github.com/bridge-craftwork/Bridge-Classroom/actions

Changes are live at https://practice.harmonicsystems.com within ~2 minutes of push.

### Adding/Updating Lessons

PBN lesson files are fetched from the Baker-Bridge repo:
```
https://raw.githubusercontent.com/bridge-craftwork/Baker-Bridge/main/Package/{lesson}.pbn
```

To add new lessons:
1. Add PBN file to Baker-Bridge repo's `Package/` folder
2. Update lesson list in `src/components/LessonBrowser.vue` or lesson config

### Environment Configuration

| File | Purpose | Used When |
|------|---------|-----------|
| `.env` | Local development | `npm run dev` |
| `.env.production` | Production build | `npm run build` |

Key variables:
- `VITE_API_URL` - Backend API endpoint
- `VITE_API_KEY` - API authentication key

---

## Backend API Development

### Architecture

The API is a Rust application using:
- **Axum** - Web framework
- **SQLx** - Database (SQLite)
- **Tower** - Middleware (CORS, logging)

### Local Development

```bash
cd /Users/rick/Development/GitHub/Bridge-Classroom/bridge-classroom-api

# Run in development mode (uses .env file)
cargo run

# Run with logging
RUST_LOG=debug cargo run

# Build release version
cargo build --release
```

### Making API Changes

**For code changes:**

1. **Edit files** in `bridge-classroom-api/src/`
2. **Test locally**: `cargo run`
3. **Build release**: `cargo build --release`
4. **Restart the service** (changes don't take effect until restart):

```bash
launchctl unload ~/Library/LaunchAgents/com.bridgeclassroom.api.plist
launchctl load ~/Library/LaunchAgents/com.bridgeclassroom.api.plist
```

5. **Commit to preserve**:
```bash
git add bridge-classroom-api/
git commit -m "API: description of changes"
git push origin main
```

### When API Restart is Required

| Change Type | Restart Needed? |
|-------------|-----------------|
| Rust source code | Yes - rebuild and restart |
| Environment variables | Yes - restart service |
| Database schema (migrations) | Yes - restart to run migrations |
| Database data only | No |
| Frontend changes | No |

### Restart Commands

```bash
# Quick restart (stop and start)
launchctl unload ~/Library/LaunchAgents/com.bridgeclassroom.api.plist
launchctl load ~/Library/LaunchAgents/com.bridgeclassroom.api.plist

# Check if running
launchctl list | grep bridgeclassroom

# View logs
tail -f ~/Library/Logs/bridge-classroom-api.log
```

### API Endpoints

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| POST | `/api/users` | None | Register new user |
| GET | `/api/users` | x-api-key header | List all users (teacher) |
| GET | `/api/users/:id/encrypted-key` | None | Get user's encrypted key backup |
| PUT | `/api/users/:id/encrypted-key` | None | Store encrypted key backup |
| POST | `/api/observations` | x-api-key header | Submit observation |
| GET | `/api/observations` | x-api-key header | Get observations (with filters) |
| GET | `/api/keys/teacher` | None | Get teacher's public key |
| POST | `/api/auth/teacher` | Password | Teacher login |

### Testing the API

```bash
# Health check (via tunnel)
curl https://api.harmonicsystems.com/api/keys/teacher

# List users (requires API key)
curl -H "x-api-key: YOUR_API_KEY" https://api.harmonicsystems.com/api/users

# Local testing
curl http://localhost:3000/api/keys/teacher
```

---

## Database Management

### Location

```
/Users/rick/Development/GitHub/Bridge-Classroom/bridge-classroom-api/data/bridge_classroom.db
```

### Viewing Data

```bash
# Open SQLite shell
sqlite3 bridge-classroom-api/data/bridge_classroom.db

# List tables
.tables

# View schema
.schema users
.schema observations

# Query users
SELECT id, first_name, classroom, created_at FROM users;

# Count observations
SELECT COUNT(*) FROM observations;

# Exit
.quit
```

### Common Queries

```sql
-- All users
SELECT * FROM users;

-- Observations for a specific user
SELECT * FROM observations WHERE user_id = 'user-uuid-here';

-- Recent observations
SELECT * FROM observations ORDER BY created_at DESC LIMIT 10;

-- Observations by lesson
SELECT lesson, COUNT(*) as count
FROM observations
GROUP BY lesson
ORDER BY count DESC;
```

### Database Backup

```bash
# Create backup
cp bridge-classroom-api/data/bridge_classroom.db \
   bridge-classroom-api/data/bridge_classroom.db.backup

# Restore from backup
cp bridge-classroom-api/data/bridge_classroom.db.backup \
   bridge-classroom-api/data/bridge_classroom.db
```

**Note**: The database file is in `.gitignore` - it is NOT committed to the repo.

### Migrations

Migrations run automatically when the API starts. To add a new migration:

1. Create SQL file in `bridge-classroom-api/migrations/`
2. Name format: `YYYYMMDDHHMMSS_description.sql`
3. Restart API to apply

---

## Cloudflare Tunnel Management

### Check Tunnel Status

```bash
# Is tunnel running?
launchctl list | grep cloudflare

# View tunnel logs
tail -f ~/Library/Logs/cloudflared-tunnel.log

# Test tunnel connectivity
curl https://api.harmonicsystems.com/api/keys/teacher
```

### Restart Tunnel

```bash
launchctl unload ~/Library/LaunchAgents/com.cloudflare.bridge-classroom-tunnel.plist
launchctl load ~/Library/LaunchAgents/com.cloudflare.bridge-classroom-tunnel.plist
```

### Tunnel Configuration

File: `~/.cloudflared/config.yml`

```yaml
tunnel: f1fae255-82da-4016-ab0e-de93365574e1
credentials-file: /Users/rick/.cloudflared/f1fae255-82da-4016-ab0e-de93365574e1.json

ingress:
  - hostname: api.harmonicsystems.com
    service: http://localhost:3000
  - service: http_status:404
```

---

## Deployment Checklist

### Frontend Deployment

- [ ] Test locally with `npm run dev`
- [ ] Run tests: `npm test`
- [ ] Commit changes
- [ ] Push to main: `git push origin main`
- [ ] Check GitHub Actions completed successfully
- [ ] Verify at https://practice.harmonicsystems.com

### API Deployment

- [ ] Test changes locally with `cargo run`
- [ ] Build release: `cargo build --release`
- [ ] Restart service (see commands above)
- [ ] Test API endpoints
- [ ] Commit source changes to preserve
- [ ] Push to main

---

## Troubleshooting

### Frontend not updating after push

1. Check GitHub Actions: https://github.com/bridge-craftwork/Bridge-Classroom/actions
2. Clear browser cache (Cmd+Shift+R)
3. Check for build errors in workflow logs

### API not responding

```bash
# Check if running
lsof -i :3000

# Check logs
tail -50 ~/Library/Logs/bridge-classroom-api.log

# Restart
launchctl unload ~/Library/LaunchAgents/com.bridgeclassroom.api.plist
launchctl load ~/Library/LaunchAgents/com.bridgeclassroom.api.plist
```

### Tunnel not working

```bash
# Check tunnel process
launchctl list | grep cloudflare

# Check logs
tail -50 ~/Library/Logs/cloudflared-tunnel.log

# Restart tunnel
launchctl unload ~/Library/LaunchAgents/com.cloudflare.bridge-classroom-tunnel.plist
launchctl load ~/Library/LaunchAgents/com.cloudflare.bridge-classroom-tunnel.plist
```

### Database locked

If you see "database is locked" errors:
1. Close any sqlite3 shells
2. Restart the API
3. If persists, check for zombie processes: `lsof bridge-classroom-api/data/bridge_classroom.db`

---

## Quick Reference

| Task | Command |
|------|---------|
| Start frontend dev server | `npm run dev` |
| Build frontend | `npm run build` |
| Deploy frontend | `git push origin main` |
| Run API locally | `cd bridge-classroom-api && cargo run` |
| Build API release | `cd bridge-classroom-api && cargo build --release` |
| Restart API service | `launchctl unload/load ~/Library/LaunchAgents/com.bridgeclassroom.api.plist` |
| View API logs | `tail -f ~/Library/Logs/bridge-classroom-api.log` |
| Open database | `sqlite3 bridge-classroom-api/data/bridge_classroom.db` |
| Check services | `launchctl list \| grep -E "bridge\|cloudflare"` |

---

## Baker-Bridge Lesson Content

The Bridge Classroom app fetches lesson content (PBN files) from the Baker-Bridge repository. This section covers how to maintain and update lesson content.

### Repository Location

```
/Users/rick/Development/GitHub/Baker-Bridge/
```

### Source Files

The original Baker Bridge lessons are HTML files located at:
```
/Users/rick/Documents/Bridge/Baker Bridge/Website/Baker Bridge/bakerbridge.coffeecup.com/
```

Subfolders contain different lesson categories:
- `Declarer/` - Declarer play lessons
- `OLead/` - Opening lead lessons
- `ThirdHand/` - Third hand play lessons
- `Squeeze/` - Squeeze play lessons
- etc.

### Build Pipeline

```
HTML Files → bbparse.py → CSV → CSV_to_PBN.py → PBN Files
```

### Running the Build

```bash
cd /Users/rick/Development/GitHub/Baker-Bridge/Tools

# Step 1: Parse HTML to CSV
python3 bbparse.py
# Outputs: BakerBridge.csv

# Step 2: Convert CSV to PBN files
python3 CSV_to_PBN.py BakerBridge.csv
# Outputs: pbns/*.pbn (one file per lesson subfolder)

# Step 3: Copy to distribution folder
cp pbns/*.pbn ../Package/

# Step 4: Commit and push
cd ..
git add Package/*.pbn
git commit -m "Update lesson content"
git push origin main
```

### Build Script Details

#### bbparse.py

Parses Baker Bridge HTML files and extracts:
- Deal information (hands, auction, contract, declarer)
- Progressive analysis text for each step
- Opening lead
- Student seat (South by default, West for OLead, East for ThirdHand)
- Card play detection (which cards were played between sections)
- E/W hand visibility changes

**Key functions:**
- `extract_hands_from_table()` - Parses bridge diagram tables
- `extract_hands_by_anchor()` - Tracks card play across HTML sections
- `extract_analysis_text()` - Extracts commentary from TD elements
- `clean_up_analysis()` - Cleans up HTML artifacts, converts suits

#### CSV_to_PBN.py

Converts CSV data to PBN format with control directives:
- `[show NS]` / `[show NESW]` - Hand visibility
- `[AUCTION off]` / `[AUCTION on]` - Auction table visibility
- `[SHOW_LEAD]` - Display opening lead banner
- `[PLAY N:SK,E:H5]` - Mark cards as played
- `[NEXT]` / `[ROTATE]` - Navigation controls
- `[RESET]` - Reset hands to original state

### PBN Control Directives Reference

| Directive | Purpose |
|-----------|---------|
| `[show NS]` | Show only North/South hands |
| `[show NESW]` | Show all four hands |
| `[show W]` | Show only West hand (for OLead lessons) |
| `[AUCTION off]` | Hide the auction table |
| `[AUCTION on]` | Show the auction table |
| `[SHOW_LEAD]` | Display opening lead in UI |
| `[PLAY N:SK,S:H3]` | Mark cards as played (removed from display) |
| `[RESET]` | Reset hands to original (undo all plays) |
| `[NEXT]` | End of step, show Next button |
| `[ROTATE]` | Like NEXT but also rotates table view |

### File Locations

| File | Purpose |
|------|---------|
| `Tools/bbparse.py` | HTML parser, generates CSV |
| `Tools/CSV_to_PBN.py` | CSV to PBN converter |
| `Tools/BakerBridge.csv` | Parsed lesson data (intermediate) |
| `Tools/pbns/` | Generated PBN files (working) |
| `Package/` | PBN files served via GitHub raw URLs |
| `CLAUDE.md` | Build process documentation |

### How the App Fetches Lessons

The frontend fetches PBN files from:
```
https://raw.githubusercontent.com/bridge-craftwork/Baker-Bridge/main/Package/{lesson}.pbn
```

Lesson names are the subfolder names from the original HTML structure (e.g., "Declarer", "Squeeze", "OLead").

### Adding a New Lesson Category

1. **Create HTML source** in the Baker Bridge website folder structure
2. **Update bbparse.py** if needed for special handling
3. **Run the build pipeline** (see above)
4. **Update the frontend** lesson browser if needed to include the new category

### Modifying Existing Lessons

1. **Edit the source HTML** file
2. **Re-run the build pipeline**:
   ```bash
   cd /Users/rick/Development/GitHub/Baker-Bridge/Tools
   python3 bbparse.py
   python3 CSV_to_PBN.py BakerBridge.csv
   cp pbns/*.pbn ../Package/
   ```
3. **Test locally** by loading the lesson in the app
4. **Commit and push** the updated PBN files

### Debugging Build Issues

**Missing commentary:**
- Check `extract_analysis_text()` - may need to handle new HTML patterns
- HTML uses `<br>` not `<br/>` - regex must handle both

**Card play not detected:**
- `extract_hands_by_anchor()` compares hands across sections
- Both sections must have valid hands for comparison
- Check for table structure changes in HTML

**E/W hands not showing:**
- Visibility is detected when E/W hands appear in a section
- `[show NESW]` directive should be injected automatically

### Testing Lessons

```bash
# Start the frontend dev server
cd /Users/rick/Development/GitHub/Bridge-Classroom
npm run dev

# The app will fetch from GitHub, so push changes first
# Or temporarily modify fetch URL in code to test local files
```
