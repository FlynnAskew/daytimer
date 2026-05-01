# DayTimer v4

A personal time tracking app with a floating widget and full dashboard.

## Quick start

**For developers / first-time setup:**
👉 See [SETUP-GITHUB.md](./SETUP-GITHUB.md) for the full packaging & deployment guide.

**For users:**
Download the latest installer from [Releases](../../releases) and run it.

---

## What's in v4

The big difference from v3 is **packaging**:

- 🚀 **Real Windows installer** — no more Command Prompt windows
- 🔄 **Auto-update** via GitHub Releases — updates flow to all installed copies automatically
- 🖼️ **Proper app icon, Start Menu, Desktop shortcut** — feels like a normal Windows app
- 📦 **CI/CD via GitHub Actions** — building a new version is a single tag command
- 🔒 **Supabase keys never exposed** in code — kept in encrypted GitHub Secrets

All v3 functionality is intact:

- Floating widget with Start Day / End Day, breaks, idle auto-stop, upcoming task preview
- Time Tracker with calendar picker
- Day Plan with drag-to-create, drag-to-resize, Shift+drag-to-move, zoom
- To-Do list (in-app for now; Microsoft To Do integration in a future build)
- Insights with goals, heatmap, charts, custom date ranges
- Stats with streaks, best day of week, peak windows
- 10 themes (5 dark + 5 light)

---

## Local development

```bash
# Install dependencies
npm install

# Copy config templates and add your Supabase keys
cp src/supabase-config.example.js src/supabase-config.js
# Edit src/supabase-config.js with your real keys

# Run in dev mode
npm start
```

---

## Releasing a new version

```bash
# Bump version in package.json
# Then:
git add . && git commit -m "Description"
git tag v4.0.X
git push --tags
```

GitHub Actions builds and publishes automatically.

---

## Folder structure

```
daytimer/
├── .github/workflows/    # GitHub Actions CI/CD
├── build/                # Icons & build resources
├── src/
│   ├── main/             # Electron main process
│   ├── renderer/         # UI (HTML/CSS/JS)
│   ├── shared/           # Shared assets (themes)
│   ├── supabase-config.example.js   # Template — copy to supabase-config.js
│   └── ms-config.example.js         # Template — copy when MS integration is set up
├── package.json
├── supabase-schema.sql
└── SETUP-GITHUB.md       # Setup walkthrough
```
