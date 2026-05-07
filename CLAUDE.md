# DayTimer — Claude Code Guidelines

## What This App Does
DayTimer is a Windows desktop time-tracking app for Howler UK (Dorset Fire Protection) employees. It has a floating always-on-top widget for quick task logging and a full dashboard with day planning, insights, and Microsoft 365 integration. Users must sign in with a @howleruk.com Microsoft account (enforced by Supabase RLS + trigger).

## Tech Stack
- **Electron 28** (Node 18 bundled), vanilla JS renderers (no React/Vue)
- **Supabase** backend: auth, Postgres, Realtime for presence
- **Microsoft Graph** for calendar + To Do (separate PKCE flow from login)
- **electron-builder** for packaging, **electron-updater** for auto-updates
- **GitHub Actions** builds on tag push, auto-publishes releases

## Architecture Patterns
- Widget and main app are SEPARATE BrowserWindows with separate localStorage
- Auth is brokered through the main process via IPC — main holds the cached Supabase session and pushes refreshes to all renderers
- All HTTP from main process uses Electron's `net` module (NOT Node fetch) — corporate SSL inspection breaks Node fetch
- All inserts must go through `withUid()` helper which stamps `user_id` (RLS rejects writes without it)
- Microsoft Graph URL parsers are picky: never use `$select` on `/me/todo/lists/.../tasks`, always encode `=` in list IDs to `%3D`, sequence requests (don't parallelise) to avoid 429

## Key Files
| Path | Purpose |
|------|---------|
| `src/main/main.js` | Electron main: window mgmt, IPC, auth refresh, auto-updater, autolaunch |
| `src/main/graph.js` | Microsoft Graph: calendar + to-do via PKCE OAuth |
| `src/renderer/main.js` | Main app dashboard renderer (3000+ lines) |
| `src/renderer/main.html` | Main app HTML structure |
| `src/renderer/main.css` | Main app styles |
| `src/renderer/widget.html` | Floating widget (single file, embedded JS) |
| `src/renderer/fun.js` | Confetti, toasts, sparkles |
| `src/renderer/troop.js` | Troop Mode presence layer |
| `src/renderer/tour.js` | Onboarding tour runner |
| `src/renderer/login.html` | Login window (Supabase + Microsoft SSO) |
| `src/shared/themes.css` | All theme CSS variable definitions |
| `package.json` | Version, build config, electron-builder settings |
| `.github/workflows/build-release.yml` | CI/CD pipeline |

## Release Workflow
1. Make changes, run syntax checks (`node -c` on JS files)
2. Bump `version` in package.json
3. Commit with descriptive message
4. Push to main
5. Create and push tag: `git tag vX.Y.Z && git push origin vX.Y.Z`
6. GitHub Actions builds (~2 min) and auto-publishes the release
7. Poll GitHub API until release has all assets (DayTimer-Setup-X.X.X.exe, .blockmap, latest.yml)

## Testing Changes
- Widget changes: restart app, test in widget window
- Main app changes: Ctrl+R to reload, or restart app
- Auth changes: sign out and back in
- Always test both widget AND main app — they're separate windows

## Battle-Tested & Fragile (Don't Touch Without Asking)
- Microsoft SSO flow (login.html, daytimer:// protocol handler, GitHub Pages auth-callback)
- Auto-update config in package.json `build.win` and `autoUpdater.disableDifferentialDownload`
- Supabase RLS policies (in migrations)

## Never Do
- Commit secrets, API keys, or service-role keys
- Add new npm dependencies without flagging
- Drop or rename existing Supabase tables
- Push without bumping the version
- Create code-signing infrastructure (we'll add that when we get a cert)
- Use Node's `fetch` in main process — use Electron's `net` module

## Syntax Checks Before Commit
```bash
node -c src/main/main.js
node -c src/main/graph.js
node -c src/renderer/main.js
node -c src/renderer/fun.js
node -c src/renderer/troop.js
node -c src/renderer/tour.js
```
HTML: verify div balance manually or use a linter

## GitHub CLI Not Available
Use PowerShell `Invoke-RestMethod` for GitHub API calls:
```powershell
Invoke-RestMethod -Uri "https://api.github.com/repos/FlynnAskew/daytimer/releases/latest"
```

## Known Bugs at Handoff
1. Tour widget tour box overlays main app on initial run only (z-order race)
2. Categories desync between widget and main app on first install
3. Troop mode category dot colours sometimes missing (`_cachedCategories` race)
4. Streak counter doesn't account for weekends or UK bank holidays

## Feature Requests at Handoff
1. Inbound call button on widget (pause + register as 'inbound_call' entry_type)
2. Replace "D" letter in widget top-left with first letter of user's name
