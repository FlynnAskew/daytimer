-- ============================================================
--  DayTimer v5.6.0 — Teams & Managers
--  Run ONCE in the Supabase SQL Editor.
--  Safe to re-run: every CREATE / ALTER guarded, policies + functions
--  dropped before recreate. If you already ran an earlier draft of this
--  file and hit "infinite recursion detected in policy", just re-run
--  this updated version — it replaces the broken policies.
-- ============================================================

-- ── profiles: public mirror of auth.users emails ─────────────
-- auth.users isn't directly queryable from the client, so the admin UI
-- can't look up a user_id by email without this. Populated by trigger
-- on signup, with a one-off backfill at the end.
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

INSERT INTO profiles (id, email)
SELECT id, email FROM auth.users
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

-- ── teams / team_managers / team_members ─────────────────────
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

-- ── Helper functions (SECURITY DEFINER — bypass RLS inside) ──
-- Wrapping these lookups in SECURITY DEFINER functions avoids the
-- "infinite recursion detected in policy" error you get if a policy on
-- table X subqueries X itself (or anything whose policy subqueries X).
-- Inside a DEFINER function, RLS doesn't re-trigger.

CREATE OR REPLACE FUNCTION public.user_manages_team(p_team_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_managers
    WHERE team_id = p_team_id AND user_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.user_in_team(p_team_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE team_id = p_team_id AND user_id = p_user_id
  );
$$;

-- "Is p_manager a manager of any team that p_member belongs to?"
-- Used by time_entries / day_plans manager-visibility policies.
CREATE OR REPLACE FUNCTION public.is_team_manager_of_user(p_manager UUID, p_member UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_managers tm
    JOIN public.team_members tmb ON tmb.team_id = tm.team_id
    WHERE tm.user_id = p_manager AND tmb.user_id = p_member
  );
$$;

GRANT EXECUTE ON FUNCTION public.user_manages_team(UUID, UUID)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_in_team(UUID, UUID)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_team_manager_of_user(UUID, UUID)  TO authenticated;

-- ── RLS: teams ───────────────────────────────────────────────
DO $$ BEGIN
  DROP POLICY IF EXISTS "teams_select"    ON teams;
  DROP POLICY IF EXISTS "teams_admin_ins" ON teams;
  DROP POLICY IF EXISTS "teams_admin_upd" ON teams;
  DROP POLICY IF EXISTS "teams_admin_del" ON teams;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

CREATE POLICY "teams_select" ON teams FOR SELECT
USING (
  auth.jwt() ->> 'email' = 'flynn@howleruk.com'
  OR public.user_manages_team(id, auth.uid())
  OR public.user_in_team(id, auth.uid())
);

CREATE POLICY "teams_admin_ins" ON teams FOR INSERT
  WITH CHECK (auth.jwt() ->> 'email' = 'flynn@howleruk.com');
CREATE POLICY "teams_admin_upd" ON teams FOR UPDATE
  USING (auth.jwt() ->> 'email' = 'flynn@howleruk.com');
CREATE POLICY "teams_admin_del" ON teams FOR DELETE
  USING (auth.jwt() ->> 'email' = 'flynn@howleruk.com');

-- ── RLS: team_managers ──────────────────────────────────────
DO $$ BEGIN
  DROP POLICY IF EXISTS "tmgr_select"    ON team_managers;
  DROP POLICY IF EXISTS "tmgr_admin_ins" ON team_managers;
  DROP POLICY IF EXISTS "tmgr_admin_del" ON team_managers;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

CREATE POLICY "tmgr_select" ON team_managers FOR SELECT
USING (
  auth.jwt() ->> 'email' = 'flynn@howleruk.com'
  OR user_id = auth.uid()
  OR public.user_manages_team(team_id, auth.uid())
);

CREATE POLICY "tmgr_admin_ins" ON team_managers FOR INSERT
  WITH CHECK (auth.jwt() ->> 'email' = 'flynn@howleruk.com');
CREATE POLICY "tmgr_admin_del" ON team_managers FOR DELETE
  USING (auth.jwt() ->> 'email' = 'flynn@howleruk.com');

-- ── RLS: team_members ───────────────────────────────────────
DO $$ BEGIN
  DROP POLICY IF EXISTS "tmb_select"    ON team_members;
  DROP POLICY IF EXISTS "tmb_admin_ins" ON team_members;
  DROP POLICY IF EXISTS "tmb_admin_del" ON team_members;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

CREATE POLICY "tmb_select" ON team_members FOR SELECT
USING (
  auth.jwt() ->> 'email' = 'flynn@howleruk.com'
  OR user_id = auth.uid()
  OR public.user_manages_team(team_id, auth.uid())
);

CREATE POLICY "tmb_admin_ins" ON team_members FOR INSERT
  WITH CHECK (auth.jwt() ->> 'email' = 'flynn@howleruk.com');
CREATE POLICY "tmb_admin_del" ON team_members FOR DELETE
  USING (auth.jwt() ->> 'email' = 'flynn@howleruk.com');

-- ── Manager read access to team members' data ────────────────
-- Adds SELECT policies on time_entries and day_plans so a manager can
-- read their team members' rows. Each member's own existing self-RLS
-- (auth.uid() = user_id) is untouched and still applies.
--
-- IMPORTANT: there is no admin blanket-read policy here. An earlier draft
-- of this file added te_select_admin / dp_select_admin, which had the
-- (bad) side-effect of making Flynn's own Day Plan view show every user's
-- planned tasks. Removed — admins still build / edit teams via the
-- existing teams_* policies, but they don't get to read everyone's
-- personal tracking data on their own dashboards. (Re-running this file
-- drops those policies if they were created by the earlier version.)
DO $$ BEGIN
  DROP POLICY IF EXISTS "te_select_manager" ON time_entries;
  DROP POLICY IF EXISTS "te_select_admin"   ON time_entries;
  DROP POLICY IF EXISTS "dp_select_manager" ON day_plans;
  DROP POLICY IF EXISTS "dp_select_admin"   ON day_plans;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

CREATE POLICY "te_select_manager" ON time_entries FOR SELECT
USING (public.is_team_manager_of_user(auth.uid(), time_entries.user_id));

CREATE POLICY "dp_select_manager" ON day_plans FOR SELECT
USING (public.is_team_manager_of_user(auth.uid(), day_plans.user_id));

-- ✅ Done. Re-run this whole file in the Supabase SQL Editor to apply
-- the fix to a project that hit the earlier recursion error.
