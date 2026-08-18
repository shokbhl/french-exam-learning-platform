-- Behavioural tests for the security-definer functions.
--
-- These cover the paths that RLS alone cannot express: grading without
-- exposing the key, withholding explanations until an attempt is submitted,
-- and restricting grounded retrieval to material the caller is allowed to see.
--
-- Depends on the fixtures created by 10_rls.test.sql.

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

-- A second question so a correct answer and an incorrect answer can both be
-- recorded within one attempt.
insert into public.questions (id, stable_key, skill, status, current_version)
values ('bbbb1111-0000-0000-0000-000000000002', 'q-published-2', 'READING', 'published', 1)
on conflict do nothing;

insert into public.question_versions (id, question_id, version, kind, prompt, correct_answer, explanation)
values (
  'cccc1111-0000-0000-0000-000000000002',
  'bbbb1111-0000-0000-0000-000000000002',
  1, 'single_choice', 'Deuxième question ?', '"y"'::jsonb, 'Explication deux.'
)
on conflict do nothing;

insert into public.question_choices (question_version_id, stable_key, label, position, is_correct)
values
  ('cccc1111-0000-0000-0000-000000000002', 'x', 'Non', 1, false),
  ('cccc1111-0000-0000-0000-000000000002', 'y', 'Oui', 2, true)
on conflict do nothing;

\set QUIET off

-- ---------------------------------------------------------------------------
-- 1. Grading happens server-side and records the wrong answer
-- ---------------------------------------------------------------------------

\echo '-- an incorrect answer scores zero and creates a mistake and review card'
set role authenticated;
select pg_temp.login('11111111-1111-1111-1111-111111111111');

do $$
declare
  mistakes_before integer;
  cards_before integer;
begin
  select count(*) into mistakes_before from public.mistake_records;
  select count(*) into cards_before from public.review_cards;

  perform public.submit_attempt_response(
    'eeee1111-0000-0000-0000-000000000001',
    'cccc1111-0000-0000-0000-000000000001',
    '"a"'::jsonb,
    12
  );

  assert (
    select score from public.attempt_responses
    where question_version_id = 'cccc1111-0000-0000-0000-000000000001'
  ) = 0, 'an incorrect answer was not scored zero';

  assert (select count(*) from public.mistake_records) = mistakes_before + 1,
    'an incorrect answer did not produce a mistake record';
  assert (select count(*) from public.review_cards) = cards_before + 1,
    'an incorrect answer did not produce a review card';
end
$$;

\echo '-- a correct answer scores one and creates no mistake'
do $$
declare
  mistakes_before integer;
begin
  select count(*) into mistakes_before from public.mistake_records;

  perform public.submit_attempt_response(
    'eeee1111-0000-0000-0000-000000000001',
    'cccc1111-0000-0000-0000-000000000002',
    '"y"'::jsonb,
    9
  );

  assert (
    select score from public.attempt_responses
    where question_version_id = 'cccc1111-0000-0000-0000-000000000002'
  ) = 1, 'a correct answer was not scored one';

  assert (select count(*) from public.mistake_records) = mistakes_before,
    'a correct answer produced a mistake record';
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Explanations are withheld until the attempt is submitted
-- ---------------------------------------------------------------------------

\echo '-- attempt_review refuses an attempt that is still open'
do $$
declare
  allowed boolean := true;
begin
  begin
    perform public.attempt_review('eeee1111-0000-0000-0000-000000000001');
  exception when others then
    allowed := false;
  end;
  assert not allowed,
    'REGRESSION: explanations are readable before the attempt is submitted';
end
$$;

\echo '-- after submission the review carries per-option explanations'
update public.attempts set submitted_at = now()
where id = 'eeee1111-0000-0000-0000-000000000001';

do $$
declare
  review jsonb;
  first_item jsonb;
begin
  review := public.attempt_review('eeee1111-0000-0000-0000-000000000001');
  assert jsonb_array_length(review) = 2,
    'the review did not cover both answered questions';

  first_item := review -> 0;
  assert first_item ? 'correct_answer', 'the review omits the correct answer';
  assert first_item ? 'explanation', 'the review omits the explanation';
  assert jsonb_array_length(first_item -> 'options') = 2,
    'the review omits the per-option breakdown';
  assert (first_item -> 'options' -> 0) ? 'is_correct',
    'the review options do not say which option was correct';
end
$$;

-- ---------------------------------------------------------------------------
-- 3. One learner cannot submit into another learner's attempt
-- ---------------------------------------------------------------------------

\echo '-- submitting into someone else''s attempt is refused'
select pg_temp.login('22222222-2222-2222-2222-222222222222');
do $$
declare
  allowed boolean := true;
begin
  begin
    perform public.submit_attempt_response(
      'eeee1111-0000-0000-0000-000000000001',
      'cccc1111-0000-0000-0000-000000000001',
      '"b"'::jsonb,
      3
    );
  exception when others then
    allowed := false;
  end;
  assert not allowed,
    'REGRESSION: a learner can write into another learner''s attempt';
end
$$;

\echo '-- and cannot read their review'
do $$
declare
  allowed boolean := true;
begin
  begin
    perform public.attempt_review('eeee1111-0000-0000-0000-000000000001');
  exception when others then
    allowed := false;
  end;
  assert not allowed,
    'REGRESSION: a learner can read another learner''s attempt review';
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Staff-only access to the full question
-- ---------------------------------------------------------------------------

\echo '-- staff_question_full is refused to learners and served to editors'
select pg_temp.login('11111111-1111-1111-1111-111111111111');
do $$
declare
  allowed boolean := true;
begin
  begin
    perform public.staff_question_full('cccc1111-0000-0000-0000-000000000001');
  exception when others then
    allowed := false;
  end;
  assert not allowed, 'REGRESSION: a learner can call staff_question_full';
end
$$;

select pg_temp.login('33333333-3333-3333-3333-333333333333');
do $$
declare
  full_question jsonb;
begin
  full_question := public.staff_question_full('cccc1111-0000-0000-0000-000000000001');
  assert full_question ? 'correct_answer', 'staff cannot see the correct answer';
  assert jsonb_array_length(full_question -> 'choices') = 2,
    'staff cannot see the choices';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 5. Grounded retrieval respects source visibility
-- ---------------------------------------------------------------------------
-- Two source files: one published and released to learners, one still a draft.
-- A learner must retrieve only from the first.

\set QUIET on
insert into public.source_materials (id, title, copyright_status, status, student_file_access)
values
  ('dddd1111-0000-0000-0000-000000000002', 'Released reader', 'owned', 'published', true),
  ('dddd1111-0000-0000-0000-000000000003', 'Unreleased reader', 'owned', 'draft', false);

insert into public.source_files (id, source_id, version, original_filename, storage_path, mime_type, byte_size, sha256)
values
  ('dddd2222-0000-0000-0000-000000000002', 'dddd1111-0000-0000-0000-000000000002', 1, 'released.pdf',   'p/released-v1.pdf',   'application/pdf', 100, 'hash-released'),
  ('dddd2222-0000-0000-0000-000000000003', 'dddd1111-0000-0000-0000-000000000003', 1, 'unreleased.pdf', 'p/unreleased-v1.pdf', 'application/pdf', 100, 'hash-unreleased');

insert into public.document_chunks (id, source_file_id, chunk_index, page_from, page_to, text)
values
  ('dddd3333-0000-0000-0000-000000000002', 'dddd2222-0000-0000-0000-000000000002', 0, 12, 12, 'Le conditionnel présent exprime une hypothèse.'),
  ('dddd3333-0000-0000-0000-000000000003', 'dddd2222-0000-0000-0000-000000000003', 0, 4,  4,  'Texte non publié.');

insert into public.chunk_embeddings (chunk_id, provider, model, dimensions, embedding)
values
  ('dddd3333-0000-0000-0000-000000000002', 'test', 'test-embed', 1536, array_fill(0.1::real, array[1536])::vector),
  ('dddd3333-0000-0000-0000-000000000003', 'test', 'test-embed', 1536, array_fill(0.1::real, array[1536])::vector);
\set QUIET off

\echo '-- a learner retrieves only from released sources, with page and version'
set role authenticated;
select pg_temp.login('11111111-1111-1111-1111-111111111111');
do $$
declare
  hits integer;
  cited record;
begin
  select count(*) into hits
  from public.search_source_chunks(array_fill(0.1::real, array[1536])::vector, 10, 0.0);
  assert hits = 1,
    format('REGRESSION: learner retrieval returned %s chunks; only the released source should match', hits);

  select * into cited
  from public.search_source_chunks(array_fill(0.1::real, array[1536])::vector, 10, 0.0)
  limit 1;

  assert cited.page_from = 12, 'the citation lost its page number';
  assert cited.source_version = 1, 'the citation lost its source version';
  assert cited.source_title = 'Released reader', 'the citation lost its source identity';
end
$$;

\echo '-- staff retrieve from drafts as well'
select pg_temp.login('33333333-3333-3333-3333-333333333333');
do $$
declare
  hits integer;
begin
  select count(*) into hits
  from public.search_source_chunks(array_fill(0.1::real, array[1536])::vector, 10, 0.0);
  assert hits = 2, format('editor retrieval returned %s chunks, expected both', hits);
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 6. Anonymous callers cannot execute the functions
-- ---------------------------------------------------------------------------

\echo '-- anon cannot execute the retrieval or review functions'
set role anon;
do $$
declare
  allowed boolean := true;
begin
  begin
    perform public.search_source_chunks(array_fill(0.1::real, array[1536])::vector, 10, 0.0);
  exception when insufficient_privilege then
    allowed := false;
  end;
  assert not allowed, 'REGRESSION: anon can execute search_source_chunks';
end
$$;
reset role;

\echo ''
\echo 'All function assertions passed.'
