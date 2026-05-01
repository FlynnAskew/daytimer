-- ============================================================
--  DayTimer v3.1 — Supabase Database Setup
--  Run this in a NEW query in Supabase SQL Editor
--
--  Safe to run if you already ran v1, v2, or v3 — uses IF NOT EXISTS.
-- ============================================================

-- ── Time entries ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS time_entries (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID,
  task_name     TEXT NOT NULL,
  category      TEXT,
  started_at    TIMESTAMPTZ NOT NULL,
  ended_at      TIMESTAMPTZ NOT NULL,
  duration_secs INTEGER NOT NULL,
  date          DATE NOT NULL,
  notes         TEXT,
  entry_type    TEXT DEFAULT 'task',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS entry_type TEXT DEFAULT 'task';

-- ── Categories ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID,
  name       TEXT NOT NULL,
  colour     TEXT DEFAULT '#6ee7b7',
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Day plans ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS day_plans (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID,
  date          DATE NOT NULL,
  task_name     TEXT NOT NULL,
  category      TEXT,
  planned_start TIME NOT NULL,
  planned_end   TIME NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Goals ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS goals (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID,
  category     TEXT NOT NULL,
  frequency    TEXT NOT NULL,
  limit_type   TEXT NOT NULL,
  target_mins  INTEGER NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── To-Dos (NEW in v3.1) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS todos (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID,
  task_name    TEXT NOT NULL,
  category     TEXT,
  notes        TEXT,
  is_done      BOOLEAN DEFAULT FALSE,
  done_at      TIMESTAMPTZ,
  sort_order   INTEGER DEFAULT 0,
  ms_todo_id   TEXT,                  -- Microsoft Graph todo ID for sync
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── Disable RLS (single-user mode) ───────────────────────────
ALTER TABLE time_entries DISABLE ROW LEVEL SECURITY;
ALTER TABLE categories   DISABLE ROW LEVEL SECURITY;
ALTER TABLE day_plans    DISABLE ROW LEVEL SECURITY;
ALTER TABLE goals        DISABLE ROW LEVEL SECURITY;
ALTER TABLE todos        DISABLE ROW LEVEL SECURITY;

-- ✅ Done!
