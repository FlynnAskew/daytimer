-- ============================================================
--  DayTimer v5.6.7 — plan_templates + plan_template_items
--  Run ONCE in the Supabase SQL Editor.
--  Safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS plan_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT 'New template',
  type        TEXT NOT NULL DEFAULT 'day' CHECK (type IN ('day', 'week')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS plan_template_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id   UUID NOT NULL REFERENCES plan_templates(id) ON DELETE CASCADE,
  day_of_week   SMALLINT,           -- NULL for day templates; 0=Mon…4=Fri for week templates
  planned_start TEXT NOT NULL DEFAULT '09:00',  -- 'HH:MM'
  planned_end   TEXT NOT NULL DEFAULT '10:00',  -- 'HH:MM'
  task_name     TEXT NOT NULL DEFAULT '',
  category      TEXT,
  is_high_priority BOOLEAN NOT NULL DEFAULT FALSE
);

-- Row-level security
ALTER TABLE plan_templates      ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_template_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY pt_select  ON plan_templates FOR SELECT  USING (user_id = auth.uid());
CREATE POLICY pt_insert  ON plan_templates FOR INSERT  WITH CHECK (user_id = auth.uid());
CREATE POLICY pt_update  ON plan_templates FOR UPDATE  USING (user_id = auth.uid());
CREATE POLICY pt_delete  ON plan_templates FOR DELETE  USING (user_id = auth.uid());

CREATE POLICY pti_select ON plan_template_items FOR SELECT  USING (template_id IN (SELECT id FROM plan_templates WHERE user_id = auth.uid()));
CREATE POLICY pti_insert ON plan_template_items FOR INSERT  WITH CHECK (template_id IN (SELECT id FROM plan_templates WHERE user_id = auth.uid()));
CREATE POLICY pti_update ON plan_template_items FOR UPDATE  USING (template_id IN (SELECT id FROM plan_templates WHERE user_id = auth.uid()));
CREATE POLICY pti_delete ON plan_template_items FOR DELETE  USING (template_id IN (SELECT id FROM plan_templates WHERE user_id = auth.uid()));

-- ✅ Done.
