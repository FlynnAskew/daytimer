-- ============================================================
--  DayTimer v5.6.3 — calendar_events: dismiss flag
--  Run ONCE in the Supabase SQL Editor.
--  Safe to re-run.
-- ============================================================

-- Lets the user remove an MS calendar event from their day plan
-- without affecting Outlook. Setting a category on the event flips this
-- back to false (handled in the renderer) so re-categorising un-removes.
ALTER TABLE calendar_events
  ADD COLUMN IF NOT EXISTS is_dismissed BOOLEAN NOT NULL DEFAULT FALSE;

-- ✅ Done.
