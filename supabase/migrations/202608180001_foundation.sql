-- Foundation schema for Supabase PostgreSQL.
create extension if not exists pgcrypto;
create type public.app_role as enum ('student','instructor','editor','admin');
create type public.content_status as enum ('draft','in_review','published','archived');
create type public.exam_code as enum ('TEF_CANADA','TCF_CANADA');
create type public.skill_code as enum ('LISTENING','READING','WRITING','SPEAKING','GRAMMAR','VOCABULARY');
create type public.processing_status as enum ('pending','processing','needs_review','complete','failed');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text, locale text not null default 'fr', timezone text not null default 'America/Toronto',
  onboarding_completed boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.user_roles (user_id uuid references public.profiles(id) on delete cascade, role public.app_role not null default 'student', primary key(user_id,role));
create table public.student_goals (
  user_id uuid primary key references public.profiles(id) on delete cascade, exam_goal text not null check(exam_goal in ('TEF_CANADA','TCF_CANADA','BOTH')),
  current_cefr text not null, target_cefr text not null, target_nclc smallint check(target_nclc between 1 and 12), exam_date date,
  study_days text[] not null default '{}', minutes_per_day smallint not null check(minutes_per_day between 10 and 480),
  strongest_skill public.skill_code, weakest_skill public.skill_code, explanation_language text not null check(explanation_language in ('fr','en','fa')), updated_at timestamptz default now()
);

create table public.exams (id uuid primary key default gen_random_uuid(), code public.exam_code unique not null, name text not null);
create table public.exam_versions (
  id uuid primary key default gen_random_uuid(), exam_id uuid not null references public.exams(id), version text not null,
  valid_from date not null, source_url text, administrative_notes text, is_active boolean not null default false,
  created_at timestamptz default now(), unique(exam_id,version)
);
create unique index one_active_exam_version on public.exam_versions(exam_id) where is_active;
create table public.exam_sections (
  id uuid primary key default gen_random_uuid(), exam_version_id uuid not null references public.exam_versions(id) on delete cascade,
  skill public.skill_code not null, title text not null, position smallint not null, question_count smallint, duration_seconds integer not null,
  navigation_rules jsonb not null default '{}', audio_replay_limit smallint, scoring_scale jsonb not null default '{}', unique(exam_version_id,position)
);
create table public.exam_tasks (
  id uuid primary key default gen_random_uuid(), section_id uuid not null references public.exam_sections(id) on delete cascade,
  code text not null, title text not null, position smallint not null, preparation_seconds integer, word_min smallint, word_max smallint,
  instructions text not null, settings jsonb not null default '{}', unique(section_id,code)
);

create table public.source_materials (
  id uuid primary key default gen_random_uuid(), title text not null, author text, publisher text, publication_year smallint,
  copyright_status text not null, license_notes text, language text, cefr_level text, skills public.skill_code[], topics text[], exam_relevance public.exam_code[],
  student_file_access boolean not null default false, status public.content_status not null default 'draft', created_by uuid references public.profiles(id), created_at timestamptz default now()
);
create table public.source_files (
  id uuid primary key default gen_random_uuid(), source_id uuid not null references public.source_materials(id) on delete restrict,
  version integer not null, original_filename text not null, storage_path text unique not null, mime_type text not null, byte_size bigint not null,
  page_count integer, sha256 text not null, created_at timestamptz default now(), unique(source_id,version)
);
create table public.ingestion_jobs (
  id uuid primary key default gen_random_uuid(), source_file_id uuid not null references public.source_files(id) on delete cascade,
  status public.processing_status not null default 'pending', stage text, error_code text, metadata jsonb default '{}', started_at timestamptz, finished_at timestamptz
);

create table public.concepts (
  id uuid primary key default gen_random_uuid(), stable_key text unique not null, kind text not null, title text not null,
  cefr_level text not null, status public.content_status not null default 'draft', current_version integer not null default 1, created_by uuid references public.profiles(id)
);
create table public.content_versions (
  id uuid primary key default gen_random_uuid(), concept_id uuid not null references public.concepts(id) on delete restrict,
  version integer not null, content jsonb not null, prompt_version text, model_metadata jsonb, created_by uuid references public.profiles(id), created_at timestamptz default now(), unique(concept_id,version)
);
create table public.lessons (
  id uuid primary key default gen_random_uuid(), slug text unique not null, title text not null, cefr_level text not null,
  primary_skill public.skill_code not null, duration_minutes smallint not null, status public.content_status not null default 'draft', current_version integer not null default 1, created_by uuid references public.profiles(id)
);
create table public.lesson_versions (id uuid primary key default gen_random_uuid(), lesson_id uuid not null references public.lessons(id) on delete restrict, version integer not null, blocks jsonb not null, created_at timestamptz default now(), unique(lesson_id,version));
create table public.lesson_concepts (lesson_id uuid references public.lessons(id) on delete cascade, concept_id uuid references public.concepts(id) on delete restrict, position smallint not null, exam_label text not null check(exam_label in ('COMMON','TEF_ONLY','TCF_ONLY','GENERAL_FRENCH')), primary key(lesson_id,concept_id));
create table public.concept_exam_tasks (concept_id uuid references public.concepts(id) on delete cascade, exam_task_id uuid references public.exam_tasks(id) on delete cascade, application_notes text, primary key(concept_id,exam_task_id));
create table public.vocabulary_entries (id uuid primary key default gen_random_uuid(), lemma text not null, language text not null default 'fr', cefr_level text, definition jsonb not null, pronunciation jsonb, unique(lemma,language));
create table public.phrases (id uuid primary key default gen_random_uuid(), text text unique not null, meaning jsonb not null, cefr_level text);
create table public.collocations (id uuid primary key default gen_random_uuid(), left_term text not null, right_term text not null, meaning jsonb not null, cefr_level text, unique(left_term,right_term));

create table public.audio_assets (id uuid primary key default gen_random_uuid(), title text not null, storage_path text, generated boolean default false, speaker_info jsonb, accent_region text, cefr_level text, duration_seconds integer, source_id uuid references public.source_materials(id), copyright_status text, skills public.skill_code[], exam_tags public.exam_code[], status public.content_status default 'draft');
create table public.audio_transcripts (id uuid primary key default gen_random_uuid(), audio_id uuid not null references public.audio_assets(id) on delete cascade, version integer not null, segments jsonb not null, language text default 'fr', unique(audio_id,version));
create table public.reading_passages (id uuid primary key default gen_random_uuid(), title text not null, passage_type text not null, cefr_level text not null, status public.content_status default 'draft', current_version integer default 1, source_id uuid references public.source_materials(id));
create table public.reading_passage_versions (id uuid primary key default gen_random_uuid(), passage_id uuid references public.reading_passages(id) on delete restrict, version integer not null, body text not null, word_count integer not null, unique(passage_id,version));

create table public.questions (id uuid primary key default gen_random_uuid(), stable_key text unique not null, skill public.skill_code not null, status public.content_status default 'draft', current_version integer default 1, usage_count integer default 0);
create table public.question_versions (id uuid primary key default gen_random_uuid(), question_id uuid references public.questions(id) on delete restrict, version integer not null, kind text not null, prompt text not null, difficulty smallint check(difficulty between 1 and 5), content jsonb not null default '{}', correct_answer jsonb, explanation text, distractor_explanations jsonb, created_at timestamptz default now(), unique(question_id,version));
create table public.question_choices (id uuid primary key default gen_random_uuid(), question_version_id uuid references public.question_versions(id) on delete cascade, stable_key text not null, label text not null, position smallint not null, is_correct boolean not null default false, explanation text, unique(question_version_id,stable_key));
create table public.question_evidence (id uuid primary key default gen_random_uuid(), question_version_id uuid references public.question_versions(id) on delete cascade, source_file_id uuid references public.source_files(id) on delete restrict, page_number integer, evidence_text text not null, locator jsonb default '{}');
create table public.practice_sets (id uuid primary key default gen_random_uuid(), title text not null, exam_version_id uuid references public.exam_versions(id), mode text not null, status public.content_status default 'draft', settings jsonb default '{}');
create table public.practice_set_questions (practice_set_id uuid references public.practice_sets(id) on delete cascade, question_version_id uuid references public.question_versions(id) on delete restrict, position smallint not null, primary key(practice_set_id,position));
create table public.mock_exams (id uuid primary key default gen_random_uuid(), title text not null, exam_version_id uuid not null references public.exam_versions(id), status public.content_status default 'draft', settings jsonb default '{}');
create table public.mock_exam_sections (mock_exam_id uuid references public.mock_exams(id) on delete cascade, exam_section_id uuid references public.exam_sections(id), practice_set_id uuid references public.practice_sets(id), position smallint not null, primary key(mock_exam_id,position));

create table public.attempts (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade, practice_set_id uuid references public.practice_sets(id), mock_exam_id uuid references public.mock_exams(id), exam_version_id uuid references public.exam_versions(id), started_at timestamptz default now(), submitted_at timestamptz, score numeric, estimate jsonb, check((practice_set_id is null) <> (mock_exam_id is null)));
create table public.attempt_responses (id uuid primary key default gen_random_uuid(), attempt_id uuid references public.attempts(id) on delete cascade, question_version_id uuid references public.question_versions(id) on delete restrict, answer jsonb not null, score numeric, time_seconds integer, feedback jsonb, unique(attempt_id,question_version_id));
create table public.writing_submissions (id uuid primary key default gen_random_uuid(), user_id uuid references public.profiles(id) on delete cascade, exam_task_id uuid references public.exam_tasks(id), original_text text not null, word_count integer not null, submitted_at timestamptz default now());
create table public.speaking_submissions (id uuid primary key default gen_random_uuid(), user_id uuid references public.profiles(id) on delete cascade, exam_task_id uuid references public.exam_tasks(id), storage_path text not null, duration_seconds integer, transcript text, submitted_at timestamptz default now());
create table public.feedback_records (id uuid primary key default gen_random_uuid(), writing_id uuid references public.writing_submissions(id) on delete cascade, speaking_id uuid references public.speaking_submissions(id) on delete cascade, reviewer_id uuid references public.profiles(id), rubric jsonb not null, annotations jsonb, corrected_version text, model_version text, prompt_version text, created_at timestamptz default now(), check((writing_id is null) <> (speaking_id is null)));
create table public.mistake_records (id uuid primary key default gen_random_uuid(), user_id uuid references public.profiles(id) on delete cascade, response_id uuid references public.attempt_responses(id), category text not null, original_answer jsonb, correct_answer jsonb, explanation text, skill public.skill_code, exam public.exam_code, repetitions integer default 0, mastery smallint default 0, created_at timestamptz default now());
create table public.review_cards (id uuid primary key default gen_random_uuid(), user_id uuid references public.profiles(id) on delete cascade, kind text not null, front jsonb not null, back jsonb not null, due_at timestamptz default now(), interval_days integer default 0, ease numeric default 2.5, source_mistake_id uuid references public.mistake_records(id));
create table public.review_events (id bigint generated always as identity primary key, card_id uuid references public.review_cards(id) on delete cascade, rating smallint check(rating between 0 and 3), reviewed_at timestamptz default now());
create table public.study_plans (id uuid primary key default gen_random_uuid(), user_id uuid references public.profiles(id) on delete cascade, start_date date not null, end_date date not null, plan jsonb not null, status text default 'active');
create table public.assignments (id uuid primary key default gen_random_uuid(), instructor_id uuid references public.profiles(id), student_id uuid references public.profiles(id), lesson_id uuid references public.lessons(id), practice_set_id uuid references public.practice_sets(id), due_at timestamptz, notes text);
create table public.audit_logs (id bigint generated always as identity primary key, actor_id uuid references public.profiles(id), action text not null, entity_type text not null, entity_id uuid, changes jsonb not null default '{}', created_at timestamptz default now());

create or replace function public.has_role(required_role public.app_role) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.user_roles where user_id=auth.uid() and role=required_role) $$;
create or replace function public.create_profile() returns trigger language plpgsql security definer set search_path=public as $$ begin insert into profiles(id,display_name) values(new.id,coalesce(new.raw_user_meta_data->>'display_name','Learner')); insert into user_roles(user_id,role) values(new.id,'student'); return new; end $$;
create trigger auth_user_profile after insert on auth.users for each row execute function public.create_profile();

alter table public.profiles enable row level security; alter table public.user_roles enable row level security; alter table public.student_goals enable row level security;
alter table public.source_materials enable row level security; alter table public.source_files enable row level security; alter table public.ingestion_jobs enable row level security;
alter table public.attempts enable row level security; alter table public.attempt_responses enable row level security; alter table public.writing_submissions enable row level security; alter table public.speaking_submissions enable row level security; alter table public.feedback_records enable row level security; alter table public.mistake_records enable row level security; alter table public.review_cards enable row level security; alter table public.review_events enable row level security; alter table public.study_plans enable row level security; alter table public.assignments enable row level security; alter table public.audit_logs enable row level security;

create policy profile_self_read on public.profiles for select using(id=auth.uid() or public.has_role('admin'));
create policy profile_self_update on public.profiles for update using(id=auth.uid()) with check(id=auth.uid());
create policy role_self_read on public.user_roles for select using(user_id=auth.uid() or public.has_role('admin'));
create policy role_admin_write on public.user_roles for all using(public.has_role('admin')) with check(public.has_role('admin'));
create policy goals_owner on public.student_goals for all using(user_id=auth.uid() or public.has_role('admin')) with check(user_id=auth.uid() or public.has_role('admin'));
create policy materials_staff_read on public.source_materials for select using(public.has_role('editor') or public.has_role('admin'));
create policy materials_staff_write on public.source_materials for all using(public.has_role('editor') or public.has_role('admin')) with check(public.has_role('editor') or public.has_role('admin'));
create policy source_files_staff on public.source_files for all using(public.has_role('editor') or public.has_role('admin')) with check(public.has_role('editor') or public.has_role('admin'));
create policy ingestion_staff on public.ingestion_jobs for all using(public.has_role('editor') or public.has_role('admin')) with check(public.has_role('editor') or public.has_role('admin'));
create policy attempts_owner on public.attempts for all using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy responses_owner on public.attempt_responses for all using(exists(select 1 from public.attempts a where a.id=attempt_id and a.user_id=auth.uid())) with check(exists(select 1 from public.attempts a where a.id=attempt_id and a.user_id=auth.uid()));
create policy writing_owner on public.writing_submissions for all using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy speaking_owner on public.speaking_submissions for all using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy mistakes_owner on public.mistake_records for all using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy cards_owner on public.review_cards for all using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy plans_owner on public.study_plans for select using(user_id=auth.uid());
create policy assignments_parties on public.assignments for select using(student_id=auth.uid() or instructor_id=auth.uid() or public.has_role('admin'));
create policy audit_admin_read on public.audit_logs for select using(public.has_role('admin'));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
('materials','materials',false,26214400,array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain','text/markdown','image/jpeg','image/png','audio/mpeg','audio/wav','audio/mp4']),
('speaking-responses','speaking-responses',false,52428800,array['audio/mpeg','audio/wav','audio/mp4','audio/webm']) on conflict(id) do nothing;
create policy material_storage_staff on storage.objects for all using(bucket_id='materials' and (public.has_role('editor') or public.has_role('admin'))) with check(bucket_id='materials' and (public.has_role('editor') or public.has_role('admin')));
create policy speaking_storage_owner on storage.objects for all using(bucket_id='speaking-responses' and (storage.foldername(name))[1]=auth.uid()::text) with check(bucket_id='speaking-responses' and (storage.foldername(name))[1]=auth.uid()::text);
