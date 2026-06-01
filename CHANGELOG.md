# Changelog

All notable changes to DayTimer.

## [5.6.2] — 2026-05-20

### Fixed
- **Data leak on admin's personal Day Plan / Tracker / Insights / Stats views.** The v5.6.0 RLS additions included a blanket admin SELECT policy on `time_entries` and `day_plans`, which made every user's data visible on Flynn's personal dashboards. Policies removed; manager-only SELECT policies (which are the legitimate ones) remain. Personal-view queries now also pin `user_id = me` client-side as defence in depth.

## [5.6.1] — 2026-05-20

### Added
- "What's new" tour for users updating to v5.6.1 — covers all the 5.5.x features (pause rework, priority/scheduled flags, future-date picker, high-payoff tracking, feature requests). Teams deliberately omitted from the tour.

## [5.6.0] — 2026-05-20

### Added
- **Teams & Managers** — admin can build teams (Settings → Teams) and assign managers + members by email. Managers get a new sidebar dashboard with team headline stats (avg log-in, avg log-out, Plan vs Actual %, total tracked), per-member time-by-category, and a per-member summary table. Visible only to actual team managers — no admin override on the dashboard.
- New `profiles` table mirroring `auth.users` emails so the admin UI can resolve emails → user IDs.
- New RLS policies giving managers SELECT access to their team members' `time_entries` and `day_plans`.

### Notes
- No "What's new" tour for this release — the feature is gated to managers, so most staff would see nothing actionable.

## [5.5.6] — 2026-05-20

### Added
- **High Payoff time tracking** — tick "💎 High payoff" on a category in Settings and a new chart on Insights shows your high-payoff hours per day, plus a total and per-active-day average
- Consolidated "What's New" tour covering the pause rework, priority flags, scheduling and high-payoff features

### Changed
- Insights layout: Week-on-Week Trend removed (rarely useful); Daily Hours moved into its slot; High Payoff promoted to top-right

### Fixed
- Daily Hours bar chart now actually renders the bars (CSS height was resolving to nothing)
- Removing a planned task that came from a To-Do now clears the "Scheduled" outline on that To-Do

## [5.5.5] — 2026-05-20

### Added
- Pause rework — paused time no longer bleeds into the next task; shown as a greyed "Paused" placeholder in Tracker; doesn't count in day totals; timer counts up while paused
- High-priority flag on To-Dos (auto-sorts to top) and Day Planner blocks
- "Scheduled" outline on To-Dos that have been added to the Day Planner
- Date picker on the Add Planned Task dialog — schedule any future day in one step
- Feature Request status chip: click to toggle New ↔ Planned

### Fixed
- Pause → End Day now saves the last task instead of losing it

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
