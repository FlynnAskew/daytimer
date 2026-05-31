-- ============================================================
--  DayTimer v5.5.6 — schema additions
--  Run ONCE in the Supabase SQL Editor (new query).
--  Safe to re-run.
-- ============================================================

-- ── Day Plans: link back to the source To-Do ──────────────────
-- Set when a planned task is created via "→ Plan" on a To-Do. Lets us
-- clear todos.scheduled_date automatically when the plan is deleted,
-- so the "Scheduled" outline on the To-Do disappears with it.
ALTER TABLE day_plans
  ADD COLUMN IF NOT EXISTS source_todo_id UUID;

-- ✅ Done.
