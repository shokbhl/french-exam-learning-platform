-- Member access to the curated library.
--
-- source_materials and source_files were readable by editors and admins only,
-- which is right for working drafts but leaves members unable to see anything
-- at all. The columns that decide what a member may see already exist:
-- `status` marks a material as published, and `student_file_access` says
-- whether the underlying file may be handed to a learner rather than only
-- being used to generate exercises.
--
-- Both conditions are required. A published material is not automatically
-- downloadable: the platform may hold licensed third-party text that can be
-- quoted in a question but not redistributed, and student_file_access is the
-- switch that separates the two.
--
-- The storage bucket stays closed to members. Files are served through
-- short-lived signed URLs minted server-side after this same check, so there
-- is one authorization path rather than two that can drift apart.

-- ---------------------------------------------------------------------------
-- Reading the catalogue
-- ---------------------------------------------------------------------------

-- Members see published materials. Whether they may also open the file is a
-- separate question, answered by student_file_access below.
create policy materials_member_read on public.source_materials
  for select to authenticated
  using (status = 'published');

-- Members only ever see file rows for material that has been released to them.
-- Without student_file_access they can still see that the material exists and
-- work with exercises drawn from it, but not reach the file itself.
create policy source_files_member_read on public.source_files
  for select to authenticated
  using (
    exists (
      select 1 from public.source_materials m
      where m.id = source_id
        and m.status = 'published'
        and m.student_file_access
    )
  );

-- ---------------------------------------------------------------------------
-- Authorization for a download
-- ---------------------------------------------------------------------------
-- Used by the server action that mints a signed URL. Runs as definer so the
-- decision does not depend on which policies the caller can see, and returns a
-- plain boolean so the calling code cannot accidentally treat "no rows" as
-- permission.

create or replace function public.may_download_source_file(target_file_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.source_files f
    join public.source_materials m on m.id = f.source_id
    where f.id = target_file_id
      and (
        public.is_staff()
        or (m.status = 'published' and m.student_file_access)
      )
  )
$$;

revoke execute on function public.may_download_source_file(uuid) from public;
grant execute on function public.may_download_source_file(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Download record
-- ---------------------------------------------------------------------------
-- Licensed material carries redistribution limits, so who opened which file
-- has to be answerable. Append-only: no update or delete policy exists.

create table public.material_downloads (
  id bigint generated always as identity primary key,
  source_file_id uuid not null references public.source_files(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index material_downloads_file on public.material_downloads (source_file_id, created_at);

alter table public.material_downloads enable row level security;

create policy material_downloads_own_read on public.material_downloads
  for select to authenticated
  using (actor_id = auth.uid() or public.is_staff());

create policy material_downloads_insert on public.material_downloads
  for insert to authenticated
  with check (actor_id = auth.uid());
