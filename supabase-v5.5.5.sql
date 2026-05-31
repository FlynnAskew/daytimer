-- ============================================================
--  DayTimer v5.5.5 — schema additions
--  Run ONCE in the Supabase SQL Editor (new query).
--  Safe to re-run: IF NOT EXISTS guards on every column.
-- ============================================================

-- ── Categories: high-payoff flag ──────────────────────────────
-- Tick this on a category and its time aggregates into the new
-- "High Payoff" chart + per-day scorecard on the Insights page.
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS is_high_payoff BOOLEAN NOT NULL DEFAULT FALSE;

-- ── To-Dos: priority + scheduled date ─────────────────────────
-- is_high_priority: red flag + auto-sort to top of the in-app list.
-- scheduled_date:   set when the to-do is added to the Day Planner,
--                   drives the "Scheduled" badge.
ALTER TABLE todos
  ADD COLUMN IF NOT EXISTS is_high_priority BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE todos
  ADD COLUMN IF NOT EXISTS scheduled_date DATE;

-- ── Day Plans: priority flag ──────────────────────────────────
-- Lets planned tasks display the same red flag as high-priority To-Dos.
ALTER TABLE day_plans
  ADD COLUMN IF NOT EXISTS is_high_priority BOOLEAN NOT NULL DEFAULT FALSE;

-- ✅ Done. The DayTimer renderer picks these up automatically once
-- v5.5.5+ is installed; existing rows default to FALSE / NULL.
