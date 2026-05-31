-- ============================================================
--  DayTimer v5.6.0 — Teams & Managers
--  Run ONCE in the Supabase SQL Editor.
--  Safe to re-run (every CREATE / ALTER guarded; policies dropped before recreate).
-- ============================================================

-- ── profiles: public mirror of auth.users emails ─────────────
-- auth.users isn't directly queryable from the client, so the admin
-- UI can't look up a user_id by email without this. Populated by
-- trigger on signup, with a one-off backfill at the end.
CREATE TABLE IF NOT EXISTS profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT UNIQUE NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_authed" ON profiles;
CREATE POLICY "profiles_select_authed" ON profiles
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- One-off backfill so existing users show up immediately.
INSERT INTO profiles (id, email)
SELECT id, email FROM auth.users
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

-- ── teams ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teams (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS team_managers (
  team_id  UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id)
);
ALTER TABLE team_managers ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS team_members (
  team_id  UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id)
);
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

-- ── RLS: teams ───────────────────────────────────────────────
-- Admin sees & manages everything. Managers can see teams they manage.
-- Members can see teams they belong to (so the future dashboard can
-- show team labels).
DO $$ BEGIN
  DROP POLICY IF EXISTS "teams_select"   ON teams;
  DROP POLICY IF EXISTS "teams_admin_ins" ON teams;
  DROP POLICY IF EXISTS "teams_admin_upd" ON teams;
  DROP POLICY IF EXISTS "teams_admin_del" ON teams;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

CREATE POLICY "teams_select" ON teams FOR SELECT
USING (
  auth.jwt() ->> 'email' = 'flynn@howleruk.com'
  OR EXISTS (SELECT 1 FROM team_managers tm WHERE tm.team_id = teams.id AND tm.user_id = auth.uid())
  OR EXISTS (SELECT 1 FROM team_members  tmb WHERE tmb.team_id = teams.id AND tmb.user_id = auth.uid())
);

CREATE POLICY "teams_admin_ins" ON teams FOR INSERT
  WITH CHECK (auth.jwt() ->> 'email' = 'flynn@howleruk.com');
CREATE POLICY "teams_admin_upd" ON teams FOR UPDATE
  USING (auth.jwt() ->> 'email' = 'flynn@howleruk.com');
CREATE POLICY "teams_admin_del" ON teams FOR DELETE
  USING (auth.jwt() ->> 'email' = 'flynn@howleruk.com');

-- ── RLS: team_managers ──────────────────────────────────────
DO $$ BEGIN
  DROP POLICY IF EXISTS "tmgr_select"     ON team_managers;
  DROP POLICY IF EXISTS "tmgr_admin_ins"  ON team_managers;
  DROP POLICY IF EXISTS "tmgr_admin_del"  ON team_managers;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

CREATE POLICY "tmgr_select" ON team_managers FOR SELECT
USING (
  auth.jwt() ->> 'email' = 'flynn@howleruk.com'
  OR user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM team_managers tm2 WHERE tm2.team_id = team_managers.team_id AND tm2.user_id = auth.uid())
);

CREATE POLICY "tmgr_admin_ins" ON team_managers FOR INSERT
  WITH CHECK (auth.jwt() ->> 'email' = 'flynn@howleruk.com');
CREATE POLICY "tmgr_admin_del" ON team_managers FOR DELETE
  USING (auth.jwt() ->> 'email' = 'flynn@howleruk.com');

-- ── RLS: team_members ───────────────────────────────────────
-- Members can see their own row. Managers see members of teams they manage.
-- Admin sees all and is the only one who can add/remove members.
DO $$ BEGIN
  DROP POLICY IF EXISTS "tmb_select"     ON team_members;
  DROP POLICY IF EXISTS "tmb_admin_ins"  ON team_members;
  DROP POLICY IF EXISTS "tmb_admin_del"  ON team_members;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

CREATE POLICY "tmb_select" ON team_members FOR SELECT
USING (
  auth.jwt() ->> 'email' = 'flynn@howleruk.com'
  OR user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM team_managers tm WHERE tm.team_id = team_members.team_id AND tm.user_id = auth.uid())
);

CREATE POLICY "tmb_admin_ins" ON team_members FOR INSERT
  WITH CHECK (auth.jwt() ->> 'email' = 'flynn@howleruk.com');
CREATE POLICY "tmb_admin_del" ON team_members FOR DELETE
  USING (auth.jwt() ->> 'email' = 'flynn@howleruk.com');

-- ── Manager read access to team members' data ────────────────
-- Adds SELECT policies on time_entries and day_plans so a manager (or
-- admin) can read their team members' rows. Members' own existing
-- policies (auth.uid() = user_id) are untouched.
DO $$ BEGIN
  DROP POLICY IF EXISTS "te_select_manager" ON time_entries;
  DROP POLICY IF EXISTS "te_select_admin"   ON time_entries;
  DROP POLICY IF EXISTS "dp_select_manager" ON day_plans;
  DROP POLICY IF EXISTS "dp_select_admin"   ON day_plans;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

CREATE POLICY "te_select_admin" ON time_entries FOR SELECT
USING (auth.jwt() ->> 'email' = 'flynn@howleruk.com');

CREATE POLICY "te_select_manager" ON time_entries FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM team_managers tm
    JOIN team_members tmb ON tmb.team_id = tm.team_id
    WHERE tm.user_id = auth.uid()
      AND tmb.user_id = time_entries.user_id
  )
);

CREATE POLICY "dp_select_admin" ON day_plans FOR SELECT
USING (auth.jwt() ->> 'email' = 'flynn@howleruk.com');

CREATE POLICY "dp_select_manager" ON day_plans FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM team_managers tm
    JOIN team_members tmb ON tmb.team_id = tm.team_id
    WHERE tm.user_id = auth.uid()
      AND tmb.user_id = day_plans.user_id
  )
);

-- ✅ Done. Next:
--   1. Settings → Teams panel (admin) becomes available in 5.6.0-beta.1
--   2. Manager dashboard ships in 5.6.0-beta.2
