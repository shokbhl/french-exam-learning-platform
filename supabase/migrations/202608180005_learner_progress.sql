-- Learner progress: XP, streaks, and lesson completions.
--
-- The application tracked these in browser local storage, which meant progress
-- was per-device, lost on cache clear, and trivially editable from the
-- console. There was no table for any of it, so this migration adds one.
--
-- The important design point is that XP is never written by the client. A
-- learner who could insert their own XP rows could award themselves any total,
-- which would make every leaderboard, streak, and recommendation meaningless.
-- Instead XP is appended by triggers that fire on things the learner actually
-- did — answering a question, completing a lesson — and the running total is
-- maintained from that append-only log.

-- ---------------------------------------------------------------------------
-- Append-only XP ledger
-- ---------------------------------------------------------------------------

create table public.xp_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount integer not null check (amount > 0),
  reason text not null,
  -- Identifies what earned the XP, so the same event cannot be counted twice.
  source_type text not null,
  source_id uuid,
  created_at timestamptz not null default now(),
  unique (user_id, source_type, source_id)
);

create index xp_events_user on public.xp_events (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Running totals
-- ---------------------------------------------------------------------------

create table public.learner_progress (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  xp integer not null default 0 check (xp >= 0),
  current_streak integer not null default 0 check (current_streak >= 0),
  longest_streak integer not null default 0 check (longest_streak >= 0),
  last_active_on date,
  updated_at timestamptz not null default now()
);

create table public.lesson_completions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (user_id, lesson_id)
);

-- ---------------------------------------------------------------------------
-- Total and streak maintenance
-- ---------------------------------------------------------------------------
-- A streak counts consecutive calendar days with activity. Recording activity
-- twice in one day leaves it unchanged; a gap of more than one day restarts
-- it at 1.

create or replace function public.apply_xp_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.learner_progress (user_id, xp, current_streak, longest_streak, last_active_on)
  values (new.user_id, new.amount, 1, 1, current_date)
  on conflict (user_id) do update set
    xp = public.learner_progress.xp + new.amount,
    current_streak = case
      when public.learner_progress.last_active_on = current_date
        then public.learner_progress.current_streak
      when public.learner_progress.last_active_on = current_date - 1
        then public.learner_progress.current_streak + 1
      else 1
    end,
    longest_streak = greatest(
      public.learner_progress.longest_streak,
      case
        when public.learner_progress.last_active_on = current_date
          then public.learner_progress.current_streak
        when public.learner_progress.last_active_on = current_date - 1
          then public.learner_progress.current_streak + 1
        else 1
      end
    ),
    last_active_on = current_date,
    updated_at = now();

  return new;
end
$$;

create trigger xp_events_apply
  after insert on public.xp_events
  for each row execute function public.apply_xp_event();

-- ---------------------------------------------------------------------------
-- Earning XP
-- ---------------------------------------------------------------------------
-- Answering a question earns more for a correct answer than an incorrect one,
-- but an incorrect answer still earns something: the mistake it generates is
-- the point of the exercise, and zeroing it would push learners to avoid
-- questions they might get wrong.

create or replace function public.award_response_xp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  learner uuid;
begin
  select user_id into learner from public.attempts where id = new.attempt_id;
  if learner is null then
    return new;
  end if;

  insert into public.xp_events (user_id, amount, reason, source_type, source_id)
  values (
    learner,
    case when coalesce(new.score, 0) > 0 then 10 else 3 end,
    case when coalesce(new.score, 0) > 0 then 'correct_answer' else 'attempted_answer' end,
    'attempt_response',
    new.id
  )
  on conflict (user_id, source_type, source_id) do nothing;

  return new;
end
$$;

create trigger attempt_responses_award_xp
  after insert on public.attempt_responses
  for each row execute function public.award_response_xp();

create or replace function public.award_lesson_xp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.xp_events (user_id, amount, reason, source_type, source_id)
  values (new.user_id, 50, 'lesson_completed', 'lesson', new.lesson_id)
  on conflict (user_id, source_type, source_id) do nothing;
  return new;
end
$$;

create trigger lesson_completions_award_xp
  after insert on public.lesson_completions
  for each row execute function public.award_lesson_xp();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.xp_events enable row level security;
alter table public.learner_progress enable row level security;
alter table public.lesson_completions enable row level security;

-- Read-only to the learner. There is deliberately no insert or update policy:
-- rows arrive only through the triggers above, which run as definer.
create policy xp_events_read_own on public.xp_events
  for select to authenticated using (user_id = auth.uid());

create policy learner_progress_read_own on public.learner_progress
  for select to authenticated using (user_id = auth.uid() or public.is_instructor());

-- Completing a lesson is a legitimate learner action, and the primary key
-- stops it being claimed twice.
create policy lesson_completions_own on public.lesson_completions
  for select to authenticated using (user_id = auth.uid() or public.is_instructor());
create policy lesson_completions_insert on public.lesson_completions
  for insert to authenticated with check (user_id = auth.uid());

create trigger learner_progress_touch_updated_at
  before update on public.learner_progress
  for each row execute function public.touch_updated_at();
