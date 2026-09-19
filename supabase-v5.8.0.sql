-- DayTimer v5.8.0 — day_reviews
--
-- Records the Plan vs Actual % somebody types when the widget asks for it at
-- End Day (off by default; switched on in Hub → Settings → DayTimer).
--
-- The REAL figure is not stored because it never needed to be — calculatePlanMatch
-- in src/renderer/planMatch.js derives it from that day's plans and entries. What
-- cannot be derived is what the person BELIEVED it was, and the gap between the
-- two is the only new number here: it measures how well somebody knows their own
-- week, which is what the prompt exists to teach.
--
-- actual_score IS stored despite being derivable, because it is a SNAPSHOT of
-- what the calculation said at the moment the day ended. Plans and entries stay
-- editable afterwards, so comparing today's typed figure against one recomputed
-- next month would report a gap that never existed. Nullable: a failed
-- calculation must never stop somebody ending their day, and the typed figure is
-- still worth having on its own.
--
-- One row per person per day, upserted — ending the day twice overwrites rather
-- than accumulating.
--
-- RLS is own-rows-only, the same shape as own_todos. Deliberately NOT visible to
-- a manager through the Team view: a figure somebody typed about their own
-- honesty is a different thing from the hours they logged, and opening it up
-- should be a decision taken on purpose rather than by copying a policy.
--
-- Mirrors supabase/schema_daytimer_day_reviews.sql in the Howler-Hub repo, which
-- is the same database. Already applied.

create table if not exists public.day_reviews (
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  reported_score integer not null check (reported_score between 0 and 100),
  actual_score integer check (actual_score between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

alter table public.day_reviews enable row level security;

drop policy if exists own_day_reviews on public.day_reviews;
create policy own_day_reviews on public.day_reviews
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
