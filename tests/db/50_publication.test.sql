-- Publication controls.
--
-- Publishing a material and releasing its file are separate decisions, and
-- releasing cannot be undone for copies already downloaded. These assertions
-- cover the guards around that: rights must be established first, the approver
-- is recorded, and a member cannot move either switch.
--
-- A note on method: an UPDATE a policy filters out affects zero rows rather
-- than raising, so asserting "no exception" would pass even if the write had
-- been allowed. Every check below inspects the stored value or the affected
-- row count instead.
--
-- Depends on the fixtures from 10_rls.test.sql.

\set ON_ERROR_STOP on
\set QUIET on

create or replace function pg_temp.login(user_id uuid, api_role text default 'authenticated')
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_id::text, 'role', api_role)::text, false);
end $$;

insert into public.source_materials (id, title, copyright_status, status)
values
  ('cccc5555-0000-0000-0000-000000000001', 'Rights established', 'owned', 'draft'),
  ('cccc5555-0000-0000-0000-000000000002', 'Rights unverified', 'unknown', 'draft');

\set QUIET off

-- ---------------------------------------------------------------------------
-- 1. Rights must be established before a file is released
-- ---------------------------------------------------------------------------

\echo '-- a material with unverified rights cannot be released'
do $$
declare
  blocked boolean := false;
begin
  begin
    update public.source_materials
    set status = 'published', student_file_access = true
    where id = 'cccc5555-0000-0000-0000-000000000002';
  exception when check_violation then
    blocked := true;
  end;
  assert blocked,
    'REGRESSION: a material whose copyright status is unknown can be released for download';
end
$$;

\echo '-- it may still be published for use in exercises'
do $$
begin
  update public.source_materials set status = 'published'
  where id = 'cccc5555-0000-0000-0000-000000000002';
  assert (
    select status from public.source_materials
    where id = 'cccc5555-0000-0000-0000-000000000002'
  ) = 'published', 'publishing without releasing was refused';
end
$$;

-- ---------------------------------------------------------------------------
-- 2. The approver is recorded
-- ---------------------------------------------------------------------------

\echo '-- publishing and releasing record who approved them'
set role authenticated;
select pg_temp.login('33333333-3333-3333-3333-333333333333');

do $$
declare
  row_after public.source_materials;
begin
  update public.source_materials
  set status = 'published', student_file_access = true
  where id = 'cccc5555-0000-0000-0000-000000000001';

  select * into row_after from public.source_materials
  where id = 'cccc5555-0000-0000-0000-000000000001';

  assert row_after.published_by = '33333333-3333-3333-3333-333333333333',
    'the publishing editor was not recorded';
  assert row_after.published_at is not null, 'no publication timestamp was recorded';
  assert row_after.released_by = '33333333-3333-3333-3333-333333333333',
    'the releasing editor was not recorded';
  assert row_after.released_at is not null, 'no release timestamp was recorded';
end
$$;

\echo '-- withdrawing clears the stamps so a later approval cannot be inherited'
do $$
declare
  row_after public.source_materials;
begin
  update public.source_materials
  set status = 'draft', student_file_access = false
  where id = 'cccc5555-0000-0000-0000-000000000001';

  select * into row_after from public.source_materials
  where id = 'cccc5555-0000-0000-0000-000000000001';

  assert row_after.published_by is null and row_after.published_at is null,
    'REGRESSION: an unpublished material keeps its old publication stamp';
  assert row_after.released_by is null and row_after.released_at is null,
    'REGRESSION: a withdrawn material keeps its old release stamp';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 3. A member cannot move either switch
-- ---------------------------------------------------------------------------
-- Both assertions read the stored value back rather than trusting the absence
-- of an error, because a filtered UPDATE succeeds silently against no rows.

\echo '-- a member cannot publish or release, and the write touches no rows'
\set QUIET on
update public.source_materials
set status = 'published', student_file_access = false
where id = 'cccc5555-0000-0000-0000-000000000001';
\set QUIET off

set role authenticated;
select pg_temp.login('11111111-1111-1111-1111-111111111111');

do $$
declare
  affected integer;
begin
  update public.source_materials set student_file_access = true
  where id = 'cccc5555-0000-0000-0000-000000000001';
  get diagnostics affected = row_count;
  assert affected = 0,
    format('REGRESSION: a member updated %s material rows', affected);
end
$$;

do $$
declare
  affected integer;
begin
  update public.source_materials set status = 'archived'
  where id = 'cccc5555-0000-0000-0000-000000000001';
  get diagnostics affected = row_count;
  assert affected = 0,
    format('REGRESSION: a member changed the status of %s materials', affected);
end
$$;
reset role;

do $$
begin
  assert (
    select not student_file_access and status = 'published'
    from public.source_materials where id = 'cccc5555-0000-0000-0000-000000000001'
  ), 'REGRESSION: a member''s write reached the stored row';
end
$$;

\echo ''
\echo 'All publication assertions passed.'
