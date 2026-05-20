-- ============================================================
--  DayTimer — Feature Requests table
--  Run this ONCE in the Supabase SQL Editor (new query).
--  Safe to re-run: uses IF NOT EXISTS / DROP POLICY IF EXISTS.
-- ============================================================

-- ── Table ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS feature_requests (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email   TEXT,
  request_text TEXT NOT NULL,
  -- status: new | planned | complete | cancelled
  status       TEXT NOT NULL DEFAULT 'new',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── Row Level Security ────────────────────────────────────────
ALTER TABLE feature_requests ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "fr_insert_own"   ON feature_requests;
  DROP POLICY IF EXISTS "fr_select"       ON feature_requests;
  DROP POLICY IF EXISTS "fr_update_admin" ON feature_requests;
  DROP POLICY IF EXISTS "fr_delete_admin" ON feature_requests;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Any authenticated user may submit a request as themselves.
CREATE POLICY "fr_insert_own" ON feature_requests
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- A user can see their own requests; the admin sees everyone's.
CREATE POLICY "fr_select" ON feature_requests
  FOR SELECT USING (
    auth.uid() = user_id
    OR auth.jwt() ->> 'email' = 'flynn@howleruk.com'
  );

-- Only the admin can change status (plan / complete / cancel).
CREATE POLICY "fr_update_admin" ON feature_requests
  FOR UPDATE USING (auth.jwt() ->> 'email' = 'flynn@howleruk.com');

-- Only the admin can permanently delete a request.
CREATE POLICY "fr_delete_admin" ON feature_requests
  FOR DELETE USING (auth.jwt() ->> 'email' = 'flynn@howleruk.com');

-- ✅ Done. The DayTimer Settings page picks this up automatically.
