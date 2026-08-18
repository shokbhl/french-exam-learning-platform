-- Authorization hardening.
--
-- The foundation migration enabled row level security on the 17 tables that
-- hold learner-owned data, but left 25 content tables without it and created
-- two tables (feedback_records, review_events) with RLS enabled and no policy
-- at all. In Supabase every signed-in user authenticates as the `authenticated`
-- role and reaches the database through PostgREST, so a table without RLS is
-- readable and writable by any learner. That exposed unpublished drafts and
-- answer keys, and left two shipped features silently non-functional.
--
-- This migration:
--   1. removes the anonymous role's blanket access to the public schema,
--   2. enables RLS on every remaining table and gives each one an explicit
--      policy, gating unpublished content behind an editor/admin role,
--   3. supplies the two missing policy sets,
--   4. widens study_plans and assignments from select-only to their real
--      write paths,
--   5. makes audit_logs append-only and writes entries from triggers.
--
-- Answer-key column protection is handled separately in 202608180003.

-- ---------------------------------------------------------------------------
-- Role helpers
-- ---------------------------------------------------------------------------

-- Staff = editor or admin. Security definer so that evaluating the policy does
-- not itself require the caller to be able to read user_roles.
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role in ('editor', 'admin')
  )
$$;

create or replace function public.is_instructor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role in ('instructor', 'admin')
  )
$$;

-- Revoking from anon alone would achieve nothing: PostgreSQL grants EXECUTE on
-- new functions to PUBLIC, and anon inherits it there. Drop the PUBLIC grant
-- and hand the privilege back to the signed-in role explicitly.
revoke execute on function public.is_staff() from public;
revoke execute on function public.is_instructor() from public;
revoke execute on function public.has_role(public.app_role) from public;

grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_instructor() to authenticated;
grant execute on function public.has_role(public.app_role) to authenticated;

-- ---------------------------------------------------------------------------
-- Anonymous access
-- ---------------------------------------------------------------------------
-- Every page that reads data requires a session. Anonymous visitors have no
-- legitimate reason to reach any table, so revoke the schema-wide grants
-- Supabase installs by default rather than relying on each policy to say no.

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

-- ---------------------------------------------------------------------------
-- Exam configuration (reference data)
-- ---------------------------------------------------------------------------
-- Readable by any signed-in learner because the practice and exam runners need
-- section timings, navigation rules, and replay limits. Writable by staff only.

alter table public.exams enable row level security;
alter table public.exam_versions enable row level security;
alter table public.exam_sections enable row level security;
alter table public.exam_tasks enable row level security;

create policy exams_read on public.exams
  for select to authenticated using (true);
create policy exams_staff_write on public.exams
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Learners only see the active version; staff see drafts and retired versions.
create policy exam_versions_read on public.exam_versions
  for select to authenticated using (is_active or public.is_staff());
create policy exam_versions_staff_write on public.exam_versions
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy exam_sections_read on public.exam_sections
  for select to authenticated using (
    exists (
      select 1 from public.exam_versions v
      where v.id = exam_version_id and (v.is_active or public.is_staff())
    )
  );
create policy exam_sections_staff_write on public.exam_sections
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy exam_tasks_read on public.exam_tasks
  for select to authenticated using (
    exists (
      select 1
      from public.exam_sections s
      join public.exam_versions v on v.id = s.exam_version_id
      where s.id = section_id and (v.is_active or public.is_staff())
    )
  );
create policy exam_tasks_staff_write on public.exam_tasks
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- Canonical concepts and lessons
-- ---------------------------------------------------------------------------
-- Unpublished rows must never reach a learner: drafts are working material and
-- may contain unreviewed AI output.

alter table public.concepts enable row level security;
alter table public.content_versions enable row level security;
alter table public.lessons enable row level security;
alter table public.lesson_versions enable row level security;
alter table public.lesson_concepts enable row level security;
alter table public.concept_exam_tasks enable row level security;

create policy concepts_read_published on public.concepts
  for select to authenticated using (status = 'published' or public.is_staff());
create policy concepts_staff_write on public.concepts
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- A version is visible only when its concept is, and only up to the version the
-- concept currently points at. Immutable history stays with staff.
create policy content_versions_read on public.content_versions
  for select to authenticated using (
    exists (
      select 1 from public.concepts c
      where c.id = concept_id
        and (
          (c.status = 'published' and content_versions.version = c.current_version)
          or public.is_staff()
        )
    )
  );
create policy content_versions_staff_write on public.content_versions
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy lessons_read_published on public.lessons
  for select to authenticated using (status = 'published' or public.is_staff());
create policy lessons_staff_write on public.lessons
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy lesson_versions_read on public.lesson_versions
  for select to authenticated using (
    exists (
      select 1 from public.lessons l
      where l.id = lesson_id
        and (
          (l.status = 'published' and lesson_versions.version = l.current_version)
          or public.is_staff()
        )
    )
  );
create policy lesson_versions_staff_write on public.lesson_versions
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy lesson_concepts_read on public.lesson_concepts
  for select to authenticated using (
    exists (
      select 1 from public.lessons l
      where l.id = lesson_id and (l.status = 'published' or public.is_staff())
    )
  );
create policy lesson_concepts_staff_write on public.lesson_concepts
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy concept_exam_tasks_read on public.concept_exam_tasks
  for select to authenticated using (
    exists (
      select 1 from public.concepts c
      where c.id = concept_id and (c.status = 'published' or public.is_staff())
    )
  );
create policy concept_exam_tasks_staff_write on public.concept_exam_tasks
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- Lexical reference tables
-- ---------------------------------------------------------------------------
-- These carry no draft state and are safe for any signed-in learner to read.

alter table public.vocabulary_entries enable row level security;
alter table public.phrases enable row level security;
alter table public.collocations enable row level security;

create policy vocabulary_read on public.vocabulary_entries
  for select to authenticated using (true);
create policy vocabulary_staff_write on public.vocabulary_entries
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy phrases_read on public.phrases
  for select to authenticated using (true);
create policy phrases_staff_write on public.phrases
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy collocations_read on public.collocations
  for select to authenticated using (true);
create policy collocations_staff_write on public.collocations
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- Audio and reading material
-- ---------------------------------------------------------------------------

alter table public.audio_assets enable row level security;
alter table public.audio_transcripts enable row level security;
alter table public.reading_passages enable row level security;
alter table public.reading_passage_versions enable row level security;

create policy audio_assets_read_published on public.audio_assets
  for select to authenticated using (status = 'published' or public.is_staff());
create policy audio_assets_staff_write on public.audio_assets
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy audio_transcripts_read on public.audio_transcripts
  for select to authenticated using (
    exists (
      select 1 from public.audio_assets a
      where a.id = audio_id and (a.status = 'published' or public.is_staff())
    )
  );
create policy audio_transcripts_staff_write on public.audio_transcripts
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy reading_passages_read_published on public.reading_passages
  for select to authenticated using (status = 'published' or public.is_staff());
create policy reading_passages_staff_write on public.reading_passages
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy reading_passage_versions_read on public.reading_passage_versions
  for select to authenticated using (
    exists (
      select 1 from public.reading_passages p
      where p.id = passage_id
        and (
          (p.status = 'published' and reading_passage_versions.version = p.current_version)
          or public.is_staff()
        )
    )
  );
create policy reading_passage_versions_staff_write on public.reading_passage_versions
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- Question bank
-- ---------------------------------------------------------------------------
-- Row visibility is handled here; the correct_answer / is_correct columns are
-- additionally revoked at column level in the next migration so that a learner
-- who can legitimately fetch a question still cannot read its key.

alter table public.questions enable row level security;
alter table public.question_versions enable row level security;
alter table public.question_choices enable row level security;
alter table public.question_evidence enable row level security;

create policy questions_read_published on public.questions
  for select to authenticated using (status = 'published' or public.is_staff());
create policy questions_staff_write on public.questions
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy question_versions_read on public.question_versions
  for select to authenticated using (
    exists (
      select 1 from public.questions q
      where q.id = question_id and (q.status = 'published' or public.is_staff())
    )
  );
create policy question_versions_staff_write on public.question_versions
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy question_choices_read on public.question_choices
  for select to authenticated using (
    exists (
      select 1
      from public.question_versions qv
      join public.questions q on q.id = qv.question_id
      where qv.id = question_version_id and (q.status = 'published' or public.is_staff())
    )
  );
create policy question_choices_staff_write on public.question_choices
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Evidence cites private source files and is editorial material: staff only.
create policy question_evidence_staff on public.question_evidence
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- Practice sets and mock exams
-- ---------------------------------------------------------------------------

alter table public.practice_sets enable row level security;
alter table public.practice_set_questions enable row level security;
alter table public.mock_exams enable row level security;
alter table public.mock_exam_sections enable row level security;

create policy practice_sets_read_published on public.practice_sets
  for select to authenticated using (status = 'published' or public.is_staff());
create policy practice_sets_staff_write on public.practice_sets
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy practice_set_questions_read on public.practice_set_questions
  for select to authenticated using (
    exists (
      select 1 from public.practice_sets s
      where s.id = practice_set_id and (s.status = 'published' or public.is_staff())
    )
  );
create policy practice_set_questions_staff_write on public.practice_set_questions
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy mock_exams_read_published on public.mock_exams
  for select to authenticated using (status = 'published' or public.is_staff());
create policy mock_exams_staff_write on public.mock_exams
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy mock_exam_sections_read on public.mock_exam_sections
  for select to authenticated using (
    exists (
      select 1 from public.mock_exams m
      where m.id = mock_exam_id and (m.status = 'published' or public.is_staff())
    )
  );
create policy mock_exam_sections_staff_write on public.mock_exam_sections
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- Missing policies on already-protected tables
-- ---------------------------------------------------------------------------

-- feedback_records had RLS on and no policy, which denied every role and made
-- writing/speaking feedback unreachable. A learner may read feedback attached
-- to their own submission; instructors and staff may read and write it.
create policy feedback_read_own on public.feedback_records
  for select to authenticated using (
    exists (
      select 1 from public.writing_submissions w
      where w.id = writing_id and w.user_id = auth.uid()
    )
    or exists (
      select 1 from public.speaking_submissions s
      where s.id = speaking_id and s.user_id = auth.uid()
    )
    or reviewer_id = auth.uid()
    or public.is_instructor()
    or public.is_staff()
  );

create policy feedback_reviewer_write on public.feedback_records
  for insert to authenticated
  with check (public.is_instructor() or public.is_staff());

create policy feedback_reviewer_update on public.feedback_records
  for update to authenticated
  using (reviewer_id = auth.uid() or public.is_staff())
  with check (reviewer_id = auth.uid() or public.is_staff());

-- review_events had the same problem, which broke spaced-repetition logging.
create policy review_events_owner on public.review_events
  for all to authenticated
  using (
    exists (
      select 1 from public.review_cards c
      where c.id = card_id and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.review_cards c
      where c.id = card_id and c.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Write paths that were missing
-- ---------------------------------------------------------------------------

-- study_plans previously allowed select only, so a generated plan could never
-- be stored by the owner.
create policy study_plans_owner_write on public.study_plans
  for insert to authenticated with check (user_id = auth.uid());
create policy study_plans_owner_update on public.study_plans
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy study_plans_owner_delete on public.study_plans
  for delete to authenticated using (user_id = auth.uid());

-- assignments allowed select only, so instructors could not create them.
create policy assignments_instructor_write on public.assignments
  for insert to authenticated
  with check (instructor_id = auth.uid() and public.is_instructor());
create policy assignments_instructor_update on public.assignments
  for update to authenticated
  using (instructor_id = auth.uid() or public.has_role('admin'))
  with check (instructor_id = auth.uid() or public.has_role('admin'));
create policy assignments_instructor_delete on public.assignments
  for delete to authenticated
  using (instructor_id = auth.uid() or public.has_role('admin'));

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------
-- Append-only: no update or delete policy exists, so entries cannot be edited
-- or removed through PostgREST by any role, including admin.

create or replace function public.record_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  before_row jsonb;
  after_row jsonb;
  subject jsonb;
  entity uuid;
  payload jsonb;
begin
  if tg_op <> 'INSERT' then
    before_row := to_jsonb(old);
  end if;
  if tg_op <> 'DELETE' then
    after_row := to_jsonb(new);
  end if;

  subject := coalesce(after_row, before_row);

  -- Not every audited table has an `id`: user_roles is keyed by
  -- (user_id, role), so fall back to the column that identifies the subject
  -- rather than assuming a surrogate key exists.
  entity := nullif(
    coalesce(subject ->> 'id', subject ->> 'user_id'),
    ''
  )::uuid;

  payload := jsonb_strip_nulls(
    jsonb_build_object('before', before_row, 'after', after_row)
  );

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, changes)
  values (auth.uid(), lower(tg_op), tg_table_name, entity, payload);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

create trigger audit_source_materials
  after insert or update or delete on public.source_materials
  for each row execute function public.record_audit_event();

create trigger audit_lessons
  after insert or update or delete on public.lessons
  for each row execute function public.record_audit_event();

create trigger audit_concepts
  after insert or update or delete on public.concepts
  for each row execute function public.record_audit_event();

create trigger audit_questions
  after insert or update or delete on public.questions
  for each row execute function public.record_audit_event();

create trigger audit_exam_versions
  after insert or update or delete on public.exam_versions
  for each row execute function public.record_audit_event();

create trigger audit_user_roles
  after insert or update or delete on public.user_roles
  for each row execute function public.record_audit_event();

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

create trigger student_goals_touch_updated_at
  before update on public.student_goals
  for each row execute function public.touch_updated_at();
