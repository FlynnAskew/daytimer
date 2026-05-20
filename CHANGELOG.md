# Changelog

All notable changes to DayTimer.

## [5.5.4] — 2026-05-20

### Changed
- "What's new" tour now rolls up every feature added since 5.4.1 into a single walkthrough, so team members updating from 5.4.1 see the full picture

## [5.5.3] — 2026-05-20

### Added
- **Feature Requests** — submit ideas from Settings; the admin reviews them and can mark them Planned / Complete / Cancelled
- Customisable widget quick-action bar (up to 4 buttons)
- Admin beta-update channel for staged rollouts
- Onboarding tour now covers feature requests
- "What's new" tour shown to returning users on update

### Fixed
- Installer no longer shows the "DayTimer cannot be closed" dialog — it now closes the running app cleanly before updating
- Minimised widget no longer blocks clicks on apps underneath it
- Widget neon outline renders as a uniform glow (no square corners or bottom bleed)
- Quick-action buttons stay visible in the widget
- Streak badge hides immediately when the setting is turned off
- Custom quick-action buttons now correctly return to "Next Task" after use

## [4.0.0] — 2026-04-30

### Packaging & Distribution
- Real Windows `.exe` installer via electron-builder
- Auto-update mechanism using GitHub Releases (electron-updater)
- App icon (stopwatch on accent colour)
- Start Menu and Desktop shortcuts
- GitHub Actions workflow for automatic build & publish
- Supabase keys moved to GitHub Secrets (never committed)
- Settings → About section with version & "Check for updates"

### Internal
- Config files split into `.example.js` templates + gitignored real values
- Added `electron-updater` dependency
- Added `electron-builder` build configuration

## [3.1.0] — 2026-04-30

### Fixed
- Widget always opens on a visible display (resilient to disconnected monitors)
- Timer no longer drifts when window is in background — uses real timestamps
- Coming Up panel advances when "Start" is clicked
- Auto-detects when current task matches a planned one and skips it in Coming Up

### Added
- Breaks visible on Day Plan Actual view (greyed dashed blocks)
- Quicker time entry on planning — text fields with loose parsing ("0930", "9:30", "930")
- Quick duration buttons (15m / 30m / 45m / 1h / 1h30 / 2h)
- New plan tasks default to previous task's end time
- To-Do list page (in-app + Microsoft To Do tab)
- "Reset widget position" button in Settings

## [3.0.0] — 2026-04-30

- Goals on Insights page
- Stats page (streaks, best day, peak windows, plan adherence)
- Drag-to-resize and Shift+drag-to-move on planner
- Calendar picker with data dots
- Heatmap and week-trend charts
- 10 themes (5 dark + 5 light)
- Editable categories with colours

## [2.0.0]

- Main app dashboard with Tracker, Day Plan, Analysis, Settings
- Categories saved in Supabase, editable in app
- Date navigation across all pages

## [1.0.0]

- Initial floating widget with timer, task name, category, Next Task button
- Cloud saving via Supabase
