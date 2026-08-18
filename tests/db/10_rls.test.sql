-- Row level security regression tests.
--
-- Each block impersonates a role the way PostgREST does — switch to the API
-- role, then set the JWT claims GUC that auth.uid() reads — and asserts what
-- that identity can and cannot see. Every assertion here corresponds to a
-- policy; the ones marked REGRESSION cover defects found in the foundation
-- migration and fixed in 202608180002.
--
-- Run with: psql -v ON_ERROR_STOP=1 -f tests/db/10_rls.test.sql
-- Any failed assertion aborts the script with a non-zero exit status.

\set ON_ERROR_STOP on
\timing off
\set QUIET on

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

begin;

-- Deterministic identities so assertions can reference them directly.
\set student_a '''11111111-1111-1111-1111-111111111111'''
\set student_b '''22222222-2222-2222-2222-222222222222'''
\set editor    '''33333333-3333-3333-3333-333333333333'''
\set instructor '''44444444-4444-4444-4444-444444444444'''
\set admin     '''55555555-5555-5555-5555-555555555555'''

insert into auth.users (id, email) values
  (:student_a, 'student-a@example.test'),
  (:student_b, 'student-b@example.test'),
  (:editor,    'editor@example.test'),
  (:instructor,'instructor@example.test'),
  (:admin,     'admin@example.test');

-- The auth trigger creates profiles and a default student role. Promote the
-- three staff identities.
insert into public.user_roles (user_id, role) values
  (:editor, 'editor'),
  (:instructor, 'instructor'),
  (:admin, 'admin');

-- One published and one draft lesson, so "drafts stay hidden" is testable.
insert into public.lessons (id, slug, title, cefr_level, primary_skill, duration_minutes, status)
values
  ('aaaa1111-0000-0000-0000-000000000001', 'published-lesson', 'Published', 'B1', 'GRAMMAR', 15, 'published'),
  ('aaaa1111-0000-0000-0000-000000000002', 'draft-lesson',     'Draft',     'B1', 'GRAMMAR', 15, 'draft');

-- A published question with a key, to test answer-key column protection.
insert into public.questions (id, stable_key, skill, status, current_version)
values ('bbbb1111-0000-0000-0000-000000000001', 'q-published', 'READING', 'published', 1);

insert into public.question_versions (id, question_id, version, kind, prompt, correct_answer, explanation)
values (
  'cccc1111-0000-0000-0000-000000000001',
  'bbbb1111-0000-0000-0000-000000000001',
  1, 'single_choice', 'Quelle est la bonne réponse ?', '"b"'::jsonb, 'Parce que.'
);

insert into public.question_choices (question_version_id, stable_key, label, position, is_correct)
values
  ('cccc1111-0000-0000-0000-000000000001', 'a', 'Mauvaise', 1, false),
  ('cccc1111-0000-0000-0000-000000000001', 'b', 'Bonne',    2, true);

-- Private source material, which no learner may read.
insert into public.source_materials (id, title, copyright_status, status, created_by)
values ('dddd1111-0000-0000-0000-000000000001', 'Private manual', 'owned', 'draft', :editor);

-- attempts requires exactly one of practice_set_id / mock_exam_id, so an
-- attempt fixture needs a practice set to point at.
insert into public.practice_sets (id, title, mode, status)
values ('ffff1111-0000-0000-0000-000000000001', 'Test set', 'practice', 'published');

commit;

-- ---------------------------------------------------------------------------
-- Helper: impersonate an API identity
-- ---------------------------------------------------------------------------

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

create or replace function pg_temp.logout() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', false);
end
$$;

\set QUIET off

-- ---------------------------------------------------------------------------
-- 1. Anonymous access is fully revoked
-- ---------------------------------------------------------------------------

\echo '-- anon has no access to the public schema'
set role anon;
do $$
declare
  readable boolean := true;
begin
  begin
    perform 1 from public.lessons limit 1;
  exception when insufficient_privilege then
    readable := false;
  end;
  assert not readable, 'REGRESSION: anon can still read public.lessons';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 2. Draft content never reaches a learner
-- ---------------------------------------------------------------------------

\echo '-- students see published lessons only; staff see drafts'
set role authenticated;
select pg_temp.login('11111111-1111-1111-1111-111111111111');
do $$
begin
  assert (select count(*) from public.lessons) = 1,
    'REGRESSION: student sees a number of lessons other than the single published one';
  assert (select count(*) from public.lessons where status = 'draft') = 0,
    'REGRESSION: student can read draft lessons';
end
$$;

select pg_temp.login('33333333-3333-3333-3333-333333333333');
do $$
begin
  assert (select count(*) from public.lessons) = 2,
    'editor cannot see both the draft and published lesson';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 3. Answer keys are not readable by learners
-- ---------------------------------------------------------------------------

\echo '-- answer key columns are revoked from authenticated'
set role authenticated;
select pg_temp.login('11111111-1111-1111-1111-111111111111');
do $$
declare
  leaked boolean := true;
begin
  begin
    perform is_correct from public.question_choices limit 1;
  exception when insufficient_privilege then
    leaked := false;
  end;
  assert not leaked, 'REGRESSION: learner can read question_choices.is_correct';

  leaked := true;
  begin
    perform correct_answer from public.question_versions limit 1;
  exception when insufficient_privilege then
    leaked := false;
  end;
  assert not leaked, 'REGRESSION: learner can read question_versions.correct_answer';
end
$$;

-- but the columns needed to render the question remain readable
do $$
begin
  assert (select count(*) from public.question_choices) = 2,
    'learner cannot read the choice labels needed to answer';
  assert (select prompt from public.question_versions limit 1) is not null,
    'learner cannot read the question prompt';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 4. Private source material is staff-only
-- ---------------------------------------------------------------------------

\echo '-- learners cannot read source materials'
set role authenticated;
select pg_temp.login('11111111-1111-1111-1111-111111111111');
do $$
begin
  assert (select count(*) from public.source_materials) = 0,
    'REGRESSION: learner can read private source materials';
end
$$;

select pg_temp.login('33333333-3333-3333-3333-333333333333');
do $$
begin
  assert (select count(*) from public.source_materials) = 1,
    'editor cannot read source materials';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 5. Learner-owned data does not cross between users
-- ---------------------------------------------------------------------------

\echo '-- attempts are visible only to their owner'
set role authenticated;
select pg_temp.login('11111111-1111-1111-1111-111111111111');
insert into public.attempts (id, user_id, practice_set_id)
values (
  'eeee1111-0000-0000-0000-000000000001',
  '11111111-1111-1111-1111-111111111111',
  'ffff1111-0000-0000-0000-000000000001'
)
on conflict do nothing;

do $$
begin
  assert (select count(*) from public.attempts) = 1, 'owner cannot read their own attempt';
end
$$;

select pg_temp.login('22222222-2222-2222-2222-222222222222');
do $$
begin
  assert (select count(*) from public.attempts) = 0,
    'REGRESSION: a learner can read another learner''s attempts';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 6. Previously dead policies now work
-- ---------------------------------------------------------------------------

\echo '-- study_plans accept writes from their owner (was select-only)'
set role authenticated;
select pg_temp.login('11111111-1111-1111-1111-111111111111');
do $$
begin
  insert into public.study_plans (user_id, start_date, end_date, plan)
  values ('11111111-1111-1111-1111-111111111111', current_date, current_date + 7, '{}'::jsonb);
  assert (select count(*) from public.study_plans) = 1, 'owner cannot read back their study plan';
exception when insufficient_privilege then
  raise exception 'REGRESSION: study_plans still rejects an insert from its owner';
end
$$;

\echo '-- review_events accept writes from the card owner (was deny-all)'
do $$
declare
  card uuid;
begin
  insert into public.review_cards (user_id, kind, front, back)
  values ('11111111-1111-1111-1111-111111111111', 'question', '{}'::jsonb, '{}'::jsonb)
  returning id into card;

  insert into public.review_events (card_id, rating) values (card, 2);
  assert (select count(*) from public.review_events) = 1,
    'REGRESSION: review_events is still effectively deny-all';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 7. Learners cannot write content
-- ---------------------------------------------------------------------------

\echo '-- learners cannot create or modify lessons'
set role authenticated;
select pg_temp.login('11111111-1111-1111-1111-111111111111');
do $$
declare
  wrote boolean := true;
begin
  begin
    insert into public.lessons (slug, title, cefr_level, primary_skill, duration_minutes)
    values ('learner-made', 'Nope', 'B1', 'GRAMMAR', 10);
  exception
    when insufficient_privilege then wrote := false;
    when others then wrote := false;
  end;
  assert not wrote, 'REGRESSION: a learner can insert lessons';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 8. Audit log is append-only and admin-readable
-- ---------------------------------------------------------------------------

\echo '-- audit entries are written by trigger and cannot be edited'
set role authenticated;
select pg_temp.login('55555555-5555-5555-5555-555555555555');
do $$
begin
  assert (select count(*) from public.audit_logs) > 0,
    'no audit entries were recorded by the triggers';
end
$$;

do $$
declare
  mutated boolean := true;
begin
  begin
    update public.audit_logs set action = 'tampered';
    -- No update policy exists, so this affects zero rows rather than raising.
    mutated := found;
  exception when insufficient_privilege then
    mutated := false;
  end;
  assert not mutated, 'REGRESSION: audit_logs rows can be modified';
end
$$;

select pg_temp.login('11111111-1111-1111-1111-111111111111');
do $$
begin
  assert (select count(*) from public.audit_logs) = 0,
    'REGRESSION: a learner can read the audit log';
end
$$;
reset role;
select pg_temp.logout();

\echo ''
\echo 'All RLS assertions passed.'
