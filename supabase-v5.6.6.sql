-- ============================================================
--  DayTimer v5.6.6 — time_entries: per-entry HP/LP flag
--  Run ONCE in the Supabase SQL Editor.
--  Safe to re-run.
-- ============================================================

-- Stores whether a task was marked High Payoff at the time it was logged.
-- NULL = legacy entry (chart falls back to category-level is_high_payoff).
ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS is_high_payoff BOOLEAN;

-- ✅ Done.
