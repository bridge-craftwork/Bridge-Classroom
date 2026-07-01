# Bridge Classroom Deployment Configuration

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         INTERNET                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  bridge-classroom.com           api.bridge-classroom.com        │
│           │                              │                       │
│           ▼                              ▼                       │
│  ┌─────────────────┐            ┌─────────────────┐             │
│  │  GitHub Pages   │            │  Cloudflare     │             │
│  │  (Static Files) │            │  Tunnel         │             │
│  └─────────────────┘            └────────┬────────┘             │
│                                          │                       │
│                                          ▼                       │
│                                 ┌─────────────────┐             │
│                                 │  Mac localhost  │             │
│                                 │  :3000 (API)    │             │
│                                 └─────────────────┘             │
└─────────────────────────────────────────────────────────────────┘
```

## Components

### 1. Frontend (Vue.js App)
- **URLs**: https://bridge-classroom.com (GitHub Pages) and
  https://bridge-classroom.org (Cloudflare Worker — the Norton-block fallback,
  see [dot-com-vs-dot-org.md](../dot-com-vs-dot-org.md))
- **Repo**: bridge-craftwork/Bridge-Classroom
- **Build**: Vite (`npm run build && bash scripts/build-site.sh`)
- **Deploy**: **both** domains deploy from the single GitHub Actions workflow
  [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) on push to
  `main` — the `build`/`deploy` jobs publish `.com` to Pages, the
  `deploy-worker` job runs `wrangler deploy` for the `.org` Worker. This
  replaced Cloudflare's own Git build integration (which had no latest-wins
  concurrency and once let `.org` drift behind `.com`); the Cloudflare dashboard
  Git auto-build is intentionally **disabled**. Needs repo secrets
  `CLOUDFLARE_API_TOKEN` (Workers Scripts: Read+Write) and `CLOUDFLARE_ACCOUNT_ID`.

### 2. Backend API (Rust)
- **URL**: https://api.bridge-classroom.com
- **Hosting**: Mac mini via Cloudflare Tunnel
- **Local Port**: 3000
- **Database**: SQLite at `bridge-classroom-api/data/bridge_classroom.db`

---

## Cloudflare Configuration

### DNS Records (bridge-classroom.com)

| Type | Name | Target | Proxy Status |
|------|------|--------|--------------|
| CNAME | @ | rick-wilson.github.io | Proxied (orange) |
| CNAME | www | bridge-classroom.com | Proxied (orange) |
| CNAME | api | f1fae255-82da-4016-ab0e-de93365574e1.cfargotunnel.com | Proxied (orange) |

> Note: the `@` CNAME still targets `rick-wilson.github.io` even though the
> repo moved to `bridge-craftwork`. This is fine — GitHub Pages routes by the
> `Host` header (`bridge-classroom.com`), and `rick-wilson.github.io` resolves
> to the same shared Pages IPs as `bridge-craftwork.github.io`. It can
> optionally be updated to `bridge-craftwork.github.io`; not required.

**Note**: GitHub Pages requires "DNS only" (grey cloud) for SSL to work properly.

### Tunnels

#### Bridge Classroom API Tunnel (Mac)
- **Tunnel ID**: `f1fae255-82da-4016-ab0e-de93365574e1`
- **Config**: `/Users/rick/.cloudflared/config.yml`
- **Credentials**: `/Users/rick/.cloudflared/f1fae255-82da-4016-ab0e-de93365574e1.json`

```yaml
# /Users/rick/.cloudflared/config.yml
tunnel: f1fae255-82da-4016-ab0e-de93365574e1
credentials-file: /Users/rick/.cloudflared/f1fae255-82da-4016-ab0e-de93365574e1.json

ingress:
  - hostname: api.bridge-classroom.com
    service: http://localhost:3000
  - hostname: api.harmonicsystems.com
    service: http://localhost:3000
  - service: http_status:404
```

#### BBA Tunnel (Windows VM)
- **Tunnel ID**: `7d3ab3db-0a42-4422-8017-2542f18a15a2`
- **Config**: `C:\Users\rick\.cloudflared\config.yml`
- Routes `bba.harmonicsystems.com` → `localhost:5000`

---

## Mac Launchd Services

### Cloudflare Tunnel Service
**File**: `/Users/rick/Library/LaunchAgents/com.cloudflare.bridge-classroom-tunnel.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.cloudflare.bridge-classroom-tunnel</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/cloudflared</string>
        <string>tunnel</string>
        <string>run</string>
        <string>bridge-classroom-api</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/rick/Library/Logs/cloudflared-tunnel.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/rick/Library/Logs/cloudflared-tunnel.log</string>
</dict>
</plist>
```

### Bridge Classroom API Service
**File**: `/Users/rick/Library/LaunchAgents/com.bridgeclassroom.api.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.bridgeclassroom.api</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Users/rick/Development/GitHub/Bridge-Classroom/bridge-classroom-api/target/release/bridge-classroom-api</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/rick/Development/GitHub/Bridge-Classroom/bridge-classroom-api</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>DATABASE_URL</key>
        <string>sqlite:./data/bridge_classroom.db</string>
        <key>API_KEY</key>
        <string>YOUR_API_KEY_HERE</string>
        <key>TEACHER_PUBLIC_KEY</key>
        <string>MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwEaflizTJt8N5ba6H3cGLn9Z1gd/j2JP5lEOJ1H8l/OC6AyjqaJqF7zIOHd2iQWirCQiIwdjMbm7BLIgxfvMq2fuSZQ5CtMbJ8GyVPCCS+7k63YjPlgHWpZ/YLZgZMSeFNEKi6QWo5zbbwjPxWqWQamJ8jNFutl/ffvQ7JDdasSP8GqsgKDW4Ad/fyfXepqoFCVe/jOkMpo6Qfg6KHsb7zXX/aafqi4u5Ke2aLyY9/i4gwWWMBMF9qNf0/YqaH4apOBsKGZiNG+5mlFgk0lqR3VvvCnTwORy63amrPC3qKRpuDMhRmg7ilp2urbkA65AvlGbeY+itg4SYM8VLvhf7QIDAQAB</string>
        <key>ALLOWED_ORIGINS</key>
        <string>http://localhost:5173,http://localhost:4173,https://bridge-classroom.com,https://www.bridge-classroom.com</string>
        <key>FRONTEND_URL</key>
        <string>https://bridge-classroom.com</string>
        <key>HOST</key>
        <string>127.0.0.1</string>
        <key>PORT</key>
        <string>3000</string>
        <key>RECOVERY_SECRET</key>
        <string>YOUR_RECOVERY_SECRET_HERE</string>
        <key>RESEND_API_KEY</key>
        <string>YOUR_RESEND_API_KEY_HERE</string>
        <key>FROM_EMAIL</key>
        <string>Bridge Classroom &lt;noreply@harmonicsystems.com&gt;</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/rick/Library/Logs/bridge-classroom-api.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/rick/Library/Logs/bridge-classroom-api.log</string>
</dict>
</plist>
```

---

## Service Management Commands

### Check Service Status
```bash
launchctl list | grep -E "bridge|cloudflare"
```

### Restart Services
```bash
# Restart API
launchctl unload ~/Library/LaunchAgents/com.bridgeclassroom.api.plist
launchctl load ~/Library/LaunchAgents/com.bridgeclassroom.api.plist

# Restart Tunnel
launchctl unload ~/Library/LaunchAgents/com.cloudflare.bridge-classroom-tunnel.plist
launchctl load ~/Library/LaunchAgents/com.cloudflare.bridge-classroom-tunnel.plist
```

### View Logs
```bash
# API logs
tail -f ~/Library/Logs/bridge-classroom-api.log

# Tunnel logs
tail -f ~/Library/Logs/cloudflared-tunnel.log
```

### Test API
```bash
# Health check
curl https://api.bridge-classroom.com/health

# Users (requires API key)
curl https://api.bridge-classroom.com/api/users \
  -H "x-api-key: YOUR_API_KEY_HERE"
```

---

## GitHub Pages Configuration

### Repository Settings
- **Source**: GitHub Actions
- **Custom Domain**: bridge-classroom.com
- **CNAME file**: `public/CNAME` contains `bridge-classroom.com`

### Workflow File
`.github/workflows/deploy.yml` - Builds and deploys on push to main

### Environment Variables (Production)
`.env.production`:
```
VITE_API_URL=https://api.bridge-classroom.com/api
VITE_API_KEY=YOUR_API_KEY_HERE
```

---

## Troubleshooting

### "Not Secure" Warning on bridge-classroom.com
- Ensure DNS record uses "DNS only" (grey cloud), not "Proxied"
- Wait for GitHub Pages to provision SSL certificate (can take up to 24 hours)
- Verify in GitHub repo Settings → Pages that certificate is active

### API Returns 401 Unauthorized
- Check that `x-api-key` header is set (not query param for /api/users)
- Observations endpoint accepts `?api_key=...` query param
- Verify API_KEY environment variable in launchd plist

### Tunnel Not Connecting
- Check cloudflared is running: `launchctl list | grep cloudflare`
- Verify credentials file exists: `ls ~/.cloudflared/*.json`
- Check tunnel logs: `tail ~/Library/Logs/cloudflared-tunnel.log`

### API Not Starting
- Check if port 3000 is already in use: `lsof -i :3000`
- Verify binary exists: `ls ~/Development/GitHub/Bridge-Classroom/bridge-classroom-api/target/release/`
- Rebuild if needed: `cd bridge-classroom-api && cargo build --release`

---

## Related Files

| File | Purpose |
|------|---------|
| `bridge-classroom-api/.env` | Local development API config |
| `.env.production` | Production frontend config |
| `public/CNAME` | GitHub Pages custom domain |
| `.github/workflows/deploy.yml` | GitHub Actions deployment |
| `~/Library/LaunchAgents/*.plist` | Mac auto-start services |
| `~/.cloudflared/config.yml` | Cloudflare tunnel config |
