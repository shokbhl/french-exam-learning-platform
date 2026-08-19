-- Member library access.
--
-- The distinction that matters here is between seeing that a material exists
-- and being allowed to open its file. Licensed third-party text may be
-- quotable in an exercise without being redistributable, so `published` and
-- `student_file_access` are two separate gates and both are exercised below.
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

-- Three materials covering each combination that decides visibility.
insert into public.source_materials (id, title, copyright_status, status, student_file_access)
values
  ('aaaa4444-0000-0000-0000-000000000001', 'Published and released', 'owned', 'published', true),
  ('aaaa4444-0000-0000-0000-000000000002', 'Published, not released', 'licensed', 'published', false),
  ('aaaa4444-0000-0000-0000-000000000003', 'Still a draft', 'owned', 'draft', true);

insert into public.source_files (id, source_id, version, original_filename, storage_path, mime_type, byte_size, sha256)
values
  ('bbbb4444-0000-0000-0000-000000000001', 'aaaa4444-0000-0000-0000-000000000001', 1, 'released.pdf', 'lib/released.pdf', 'application/pdf', 10, 'h1'),
  ('bbbb4444-0000-0000-0000-000000000002', 'aaaa4444-0000-0000-0000-000000000002', 1, 'quoteonly.pdf', 'lib/quoteonly.pdf', 'application/pdf', 10, 'h2'),
  ('bbbb4444-0000-0000-0000-000000000003', 'aaaa4444-0000-0000-0000-000000000003', 1, 'draft.pdf', 'lib/draft.pdf', 'application/pdf', 10, 'h3');

\set QUIET off

-- ---------------------------------------------------------------------------
-- 1. The catalogue
-- ---------------------------------------------------------------------------

\echo '-- a member sees published materials only'
set role authenticated;
select pg_temp.login('11111111-1111-1111-1111-111111111111');
do $$
declare
  visible integer;
begin
  select count(*) into visible from public.source_materials
  where id::text like 'aaaa4444-%';
  assert visible = 2,
    format('member sees %s of this fixture''s materials; expected the 2 published ones', visible);

  assert not exists (
    select 1 from public.source_materials
    where id = 'aaaa4444-0000-0000-0000-000000000003'
  ), 'REGRESSION: a member can see a draft material';
end
$$;

-- ---------------------------------------------------------------------------
-- 2. The files
-- ---------------------------------------------------------------------------

\echo '-- a member reaches files only for released material'
do $$
declare
  visible integer;
begin
  select count(*) into visible from public.source_files
  where id::text like 'bbbb4444-%';
  assert visible = 1,
    format('member sees %s of this fixture''s files; only the released one should be reachable', visible);

  assert exists (
    select 1 from public.source_files where id = 'bbbb4444-0000-0000-0000-000000000001'
  ), 'member cannot reach the released file';

  assert not exists (
    select 1 from public.source_files where id = 'bbbb4444-0000-0000-0000-000000000002'
  ), 'REGRESSION: a member reaches a file whose material is published but not released';
end
$$;

-- ---------------------------------------------------------------------------
-- 3. The download decision
-- ---------------------------------------------------------------------------

\echo '-- may_download_source_file matches the visibility rules'
do $$
begin
  assert public.may_download_source_file('bbbb4444-0000-0000-0000-000000000001'),
    'member refused the released file';
  assert not public.may_download_source_file('bbbb4444-0000-0000-0000-000000000002'),
    'REGRESSION: member allowed to download a quote-only material';
  assert not public.may_download_source_file('bbbb4444-0000-0000-0000-000000000003'),
    'REGRESSION: member allowed to download a draft';
end
$$;

\echo '-- staff may download any of them'
select pg_temp.login('33333333-3333-3333-3333-333333333333');
do $$
begin
  assert public.may_download_source_file('bbbb4444-0000-0000-0000-000000000002'),
    'editor refused a quote-only material';
  assert public.may_download_source_file('bbbb4444-0000-0000-0000-000000000003'),
    'editor refused a draft';
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Members still cannot change the catalogue
-- ---------------------------------------------------------------------------

\echo '-- a member cannot publish or release material'
select pg_temp.login('11111111-1111-1111-1111-111111111111');
do $$
declare
  changed boolean := true;
begin
  begin
    update public.source_materials set student_file_access = true
    where id = 'aaaa4444-0000-0000-0000-000000000002';
    changed := found;
  exception when insufficient_privilege then
    changed := false;
  end;
  assert not changed, 'REGRESSION: a member can release a material to themselves';
end
$$;

do $$
declare
  wrote boolean := true;
begin
  begin
    insert into public.source_materials (title, copyright_status, status)
    values ('member upload', 'unknown', 'published');
  exception when others then
    wrote := false;
  end;
  assert not wrote, 'REGRESSION: a member can add material to the library';
end
$$;

-- ---------------------------------------------------------------------------
-- 5. Download log
-- ---------------------------------------------------------------------------

\echo '-- a member records only their own downloads and cannot read others'
do $$
begin
  insert into public.material_downloads (source_file_id, actor_id)
  values ('bbbb4444-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');
  assert (select count(*) from public.material_downloads
          where actor_id = '11111111-1111-1111-1111-111111111111') = 1,
    'the member cannot read back their own download record';
end
$$;

do $$
declare
  wrote boolean := true;
begin
  begin
    insert into public.material_downloads (source_file_id, actor_id)
    values ('bbbb4444-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222');
  exception when others then
    wrote := false;
  end;
  assert not wrote, 'REGRESSION: a member can log a download as another learner';
end
$$;

select pg_temp.login('22222222-2222-2222-2222-222222222222');
do $$
begin
  assert (select count(*) from public.material_downloads) = 0,
    'REGRESSION: a member can read another learner''s download history';
end
$$;
reset role;

\echo ''
\echo 'All library assertions passed.'
