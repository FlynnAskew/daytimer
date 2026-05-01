-- ============================================================
--  DayTimer v5 — Supabase Database Setup
--  Run this in a NEW query in Supabase SQL Editor
--
--  IMPORTANT: Run the sections in order.
--  If upgrading from v4, the ALTER TABLE statements handle
--  existing data safely.
-- ============================================================

-- ── 1. Tables (safe to run on existing data) ─────────────────

CREATE TABLE IF NOT EXISTS time_entries (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE,
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

CREATE TABLE IF NOT EXISTS categories (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  colour     TEXT DEFAULT '#6ee7b7',
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS day_plans (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  date          DATE NOT NULL,
  task_name     TEXT NOT NULL,
  category      TEXT,
  planned_start TIME NOT NULL,
  planned_end   TIME NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS goals (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  category     TEXT NOT NULL,
  frequency    TEXT NOT NULL,
  limit_type   TEXT NOT NULL,
  target_mins  INTEGER NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS todos (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  task_name    TEXT NOT NULL,
  category     TEXT,
  notes        TEXT,
  is_done      BOOLEAN DEFAULT FALSE,
  done_at      TIMESTAMPTZ,
  sort_order   INTEGER DEFAULT 0,
  ms_todo_id   TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2. Claim existing data for the first user ─────────────────
-- Run this AFTER you first log in with your Microsoft account.
-- Replace the email below with your own @howleruk.com address.
-- This assigns all your existing (pre-login) data to your account.
--
-- DO NOT run this until you've logged into the app at least once.
--
-- UPDATE time_entries SET user_id = (
--   SELECT id FROM auth.users WHERE email = 'YOUR_EMAIL@howleruk.com' LIMIT 1
-- ) WHERE user_id IS NULL;
--
-- UPDATE categories SET user_id = (
--   SELECT id FROM auth.users WHERE email = 'YOUR_EMAIL@howleruk.com' LIMIT 1
-- ) WHERE user_id IS NULL;
--
-- UPDATE day_plans SET user_id = (
--   SELECT id FROM auth.users WHERE email = 'YOUR_EMAIL@howleruk.com' LIMIT 1
-- ) WHERE user_id IS NULL;
--
-- UPDATE goals SET user_id = (
--   SELECT id FROM auth.users WHERE email = 'YOUR_EMAIL@howleruk.com' LIMIT 1
-- ) WHERE user_id IS NULL;
--
-- UPDATE todos SET user_id = (
--   SELECT id FROM auth.users WHERE email = 'YOUR_EMAIL@howleruk.com' LIMIT 1
-- ) WHERE user_id IS NULL;

-- ── 3. Enable Row Level Security ──────────────────────────────

ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories   ENABLE ROW LEVEL SECURITY;
ALTER TABLE day_plans    ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals        ENABLE ROW LEVEL SECURITY;
ALTER TABLE todos        ENABLE ROW LEVEL SECURITY;

-- ── 4. RLS Policies (users only see their own data) ───────────

-- Drop existing policies if any, then recreate cleanly
DO $$ BEGIN
  DROP POLICY IF EXISTS "own_time_entries" ON time_entries;
  DROP POLICY IF EXISTS "own_categories"   ON categories;
  DROP POLICY IF EXISTS "own_day_plans"    ON day_plans;
  DROP POLICY IF EXISTS "own_goals"        ON goals;
  DROP POLICY IF EXISTS "own_todos"        ON todos;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

CREATE POLICY "own_time_entries" ON time_entries
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own_categories" ON categories
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own_day_plans" ON day_plans
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own_goals" ON goals
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own_todos" ON todos
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── 5. Domain restriction function ───────────────────────────
-- This runs on every login and rejects non-@howleruk.com accounts.

CREATE OR REPLACE FUNCTION public.enforce_howleruk_domain()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.email NOT LIKE '%@howleruk.com' THEN
    RAISE EXCEPTION 'Access restricted to @howleruk.com accounts';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_domain ON auth.users;
CREATE TRIGGER enforce_domain
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.enforce_howleruk_domain();

-- ✅ Done! Now follow the Microsoft SSO setup in SETUP-MICROSOFT-SSO.md
