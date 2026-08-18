-- Learner progress tests.
--
-- The property that matters most here is that a learner cannot award
-- themselves XP. Everything else (totals, streaks) is only meaningful if that
-- holds, so it is asserted first.
--
-- Depends on the fixtures created by 10_rls.test.sql and 20_functions.test.sql.

\set ON_ERROR_STOP on
\set QUIET on

create or replace function pg_temp.login(user_id uuid, api_role text default 'authenticated')
returns void
language plpgsql
as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user_id::text, 'role', api_role)::text,
    false
  );
end
$$;

\set QUIET off

-- ---------------------------------------------------------------------------
-- 1. XP cannot be granted by the client
-- ---------------------------------------------------------------------------

\echo '-- a learner cannot insert XP events or edit their own total'
set role authenticated;
select pg_temp.login('11111111-1111-1111-1111-111111111111');

do $$
declare
  wrote boolean := true;
begin
  begin
    insert into public.xp_events (user_id, amount, reason, source_type, source_id)
    values ('11111111-1111-1111-1111-111111111111', 999999, 'cheating', 'manual', gen_random_uuid());
  exception when others then
    wrote := false;
  end;
  assert not wrote, 'REGRESSION: a learner can award themselves XP';
end
$$;

do $$
declare
  wrote boolean := true;
begin
  begin
    update public.learner_progress set xp = 999999
    where user_id = '11111111-1111-1111-1111-111111111111';
    wrote := found;
  exception when others then
    wrote := false;
  end;
  assert not wrote, 'REGRESSION: a learner can edit their XP total directly';
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Answering questions accrues XP through the trigger
-- ---------------------------------------------------------------------------
-- 20_functions.test.sql already recorded one incorrect and one correct answer
-- for this learner, so the ledger should hold exactly those two events.

\echo '-- XP accrued from the answers recorded earlier'
do $$
declare
  total integer;
  events integer;
begin
  select xp into total from public.learner_progress
  where user_id = '11111111-1111-1111-1111-111111111111';

  select count(*) into events from public.xp_events
  where user_id = '11111111-1111-1111-1111-111111111111';

  assert events = 2,
    format('expected 2 XP events from the two recorded answers, found %s', events);
  -- 10 for the correct answer, 3 for the incorrect one.
  assert total = 13, format('expected 13 XP, found %s', total);
end
$$;

\echo '-- a learner cannot read another learner''s progress'
select pg_temp.login('22222222-2222-2222-2222-222222222222');
do $$
begin
  assert (select count(*) from public.learner_progress) = 0,
    'REGRESSION: a learner can read another learner''s progress';
  assert (select count(*) from public.xp_events) = 0,
    'REGRESSION: a learner can read another learner''s XP ledger';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 3. Lesson completion awards XP once
-- ---------------------------------------------------------------------------

\echo '-- completing a lesson awards XP, and cannot be claimed twice'
set role authenticated;
select pg_temp.login('11111111-1111-1111-1111-111111111111');

do $$
declare
  before_xp integer;
  after_xp integer;
begin
  select xp into before_xp from public.learner_progress
  where user_id = '11111111-1111-1111-1111-111111111111';

  insert into public.lesson_completions (user_id, lesson_id)
  values ('11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000001');

  select xp into after_xp from public.learner_progress
  where user_id = '11111111-1111-1111-1111-111111111111';

  assert after_xp = before_xp + 50,
    format('lesson completion awarded %s XP, expected 50', after_xp - before_xp);

  -- Claiming the same lesson again must not add more.
  begin
    insert into public.lesson_completions (user_id, lesson_id)
    values ('11111111-1111-1111-1111-111111111111', 'aaaa1111-0000-0000-0000-000000000001');
  exception when unique_violation then
    null;
  end;

  select xp into after_xp from public.learner_progress
  where user_id = '11111111-1111-1111-1111-111111111111';
  assert after_xp = before_xp + 50,
    'REGRESSION: a lesson can be completed twice for repeated XP';
end
$$;

\echo '-- a learner cannot mark a lesson complete for someone else'
do $$
declare
  wrote boolean := true;
begin
  begin
    insert into public.lesson_completions (user_id, lesson_id)
    values ('22222222-2222-2222-2222-222222222222', 'aaaa1111-0000-0000-0000-000000000001');
  exception when others then
    wrote := false;
  end;
  assert not wrote,
    'REGRESSION: a learner can record a lesson completion for another learner';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 4. Streaks
-- ---------------------------------------------------------------------------
-- Activity on the same day must not inflate the streak; a gap must reset it.
-- The dates are moved directly because the trigger reads current_date.

\echo '-- same-day activity does not inflate the streak'
do $$
declare
  streak_before integer;
  streak_after integer;
begin
  select current_streak into streak_before from public.learner_progress
  where user_id = '11111111-1111-1111-1111-111111111111';

  insert into public.xp_events (user_id, amount, reason, source_type, source_id)
  values ('11111111-1111-1111-1111-111111111111', 5, 'test', 'test', gen_random_uuid());

  select current_streak into streak_after from public.learner_progress
  where user_id = '11111111-1111-1111-1111-111111111111';

  assert streak_after = streak_before,
    format('same-day activity changed the streak from %s to %s', streak_before, streak_after);
end
$$;

\echo '-- activity the next day increments the streak'
update public.learner_progress
set last_active_on = current_date - 1
where user_id = '11111111-1111-1111-1111-111111111111';

do $$
declare
  streak_before integer;
  streak_after integer;
begin
  select current_streak into streak_before from public.learner_progress
  where user_id = '11111111-1111-1111-1111-111111111111';

  insert into public.xp_events (user_id, amount, reason, source_type, source_id)
  values ('11111111-1111-1111-1111-111111111111', 5, 'test', 'test', gen_random_uuid());

  select current_streak into streak_after from public.learner_progress
  where user_id = '11111111-1111-1111-1111-111111111111';

  assert streak_after = streak_before + 1,
    format('next-day activity moved the streak from %s to %s', streak_before, streak_after);
end
$$;

\echo '-- a gap resets the streak to one and preserves the longest'
update public.learner_progress
set last_active_on = current_date - 5
where user_id = '11111111-1111-1111-1111-111111111111';

do $$
declare
  longest_before integer;
  streak_after integer;
  longest_after integer;
begin
  select longest_streak into longest_before from public.learner_progress
  where user_id = '11111111-1111-1111-1111-111111111111';

  insert into public.xp_events (user_id, amount, reason, source_type, source_id)
  values ('11111111-1111-1111-1111-111111111111', 5, 'test', 'test', gen_random_uuid());

  select current_streak, longest_streak into streak_after, longest_after
  from public.learner_progress
  where user_id = '11111111-1111-1111-1111-111111111111';

  assert streak_after = 1, format('a five-day gap left the streak at %s', streak_after);
  assert longest_after = longest_before,
    'the longest streak was lost when the current streak reset';
end
$$;

\echo ''
\echo 'All progress assertions passed.'
