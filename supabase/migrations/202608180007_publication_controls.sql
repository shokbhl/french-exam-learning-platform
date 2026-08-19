-- Publication safeguards.
--
-- Releasing a file to members is the one action on this table that cannot be
-- taken back: once a learner has downloaded a PDF, unsetting the flag does not
-- recall it. The rules that protect that decision belong in the database
-- rather than only in the action that happens to call it today.

-- ---------------------------------------------------------------------------
-- Rights must be established before a file is handed out
-- ---------------------------------------------------------------------------
-- A material whose copyright status is still "unknown" may be catalogued and
-- worked on, but it cannot be released for download. Quoting it in an exercise
-- remains possible; redistributing the file does not.

alter table public.source_materials
  add constraint source_materials_release_requires_rights
  check (not student_file_access or copyright_status <> 'unknown');

-- ---------------------------------------------------------------------------
-- Publication is a human decision
-- ---------------------------------------------------------------------------
-- Recording who published a material, and when, so the audit trail answers
-- "who approved this" rather than only "it changed".

alter table public.source_materials
  add column published_at timestamptz,
  add column published_by uuid references public.profiles(id) on delete set null,
  add column released_at timestamptz,
  add column released_by uuid references public.profiles(id) on delete set null;

create or replace function public.stamp_material_publication()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Entering the published state records the approver; leaving it clears the
  -- stamp so a later re-publication cannot inherit an older approval.
  if new.status = 'published' and coalesce(old.status, 'draft') <> 'published' then
    new.published_at := now();
    new.published_by := auth.uid();
  elsif new.status <> 'published' then
    new.published_at := null;
    new.published_by := null;
  end if;

  if new.student_file_access and not coalesce(old.student_file_access, false) then
    new.released_at := now();
    new.released_by := auth.uid();
  elsif not new.student_file_access then
    new.released_at := null;
    new.released_by := null;
  end if;

  return new;
end
$$;

create trigger source_materials_stamp_publication
  before insert or update on public.source_materials
  for each row execute function public.stamp_material_publication();
