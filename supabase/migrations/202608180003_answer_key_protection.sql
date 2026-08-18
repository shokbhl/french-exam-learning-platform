-- Answer-key protection and graded submission.
--
-- Row level security decides which question rows a learner may fetch, but a
-- learner legitimately needs to fetch a published question in order to answer
-- it. Without column-level restrictions the same request also returns
-- correct_answer, is_correct, and the explanations, so the practice runner
-- would ship the key to the browser alongside the prompt.
--
-- Postgres grants SELECT per column, but every signed-in Supabase user shares
-- the `authenticated` role, so column grants cannot distinguish a learner from
-- an editor. The approach here is therefore:
--
--   * revoke direct SELECT on the key columns from `authenticated` entirely,
--   * re-grant only the columns needed to render a question,
--   * expose the withheld data through security-definer functions that check
--     who is asking and, for learners, that the attempt is already submitted.
--
-- Grading also moves into the database. Doing it here means the key never
-- leaves the server, the response and its score are written in one
-- transaction, and the mistake record and review card required for incorrect
-- answers cannot be skipped by a client that simply stops calling.

-- ---------------------------------------------------------------------------
-- Column-level restriction
-- ---------------------------------------------------------------------------
-- Postgres treats table-level SELECT as covering every column, so the
-- table-level grant has to go before the per-column grants mean anything.

revoke select on public.question_versions from authenticated;
grant select (
  id, question_id, version, kind, prompt, difficulty, content, created_at
) on public.question_versions to authenticated;

revoke select on public.question_choices from authenticated;
grant select (
  id, question_version_id, stable_key, label, position
) on public.question_choices to authenticated;

-- ---------------------------------------------------------------------------
-- Staff access to the withheld columns
-- ---------------------------------------------------------------------------

create or replace function public.staff_question_full(target_version_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'question_version_id', qv.id,
    'kind', qv.kind,
    'prompt', qv.prompt,
    'difficulty', qv.difficulty,
    'content', qv.content,
    'correct_answer', qv.correct_answer,
    'explanation', qv.explanation,
    'distractor_explanations', qv.distractor_explanations,
    'choices', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'stable_key', c.stable_key,
            'label', c.label,
            'position', c.position,
            'is_correct', c.is_correct,
            'explanation', c.explanation
          ) order by c.position
        )
        from public.question_choices c
        where c.question_version_id = qv.id
      ),
      '[]'::jsonb
    ),
    'evidence', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'source_file_id', e.source_file_id,
            'page_number', e.page_number,
            'evidence_text', e.evidence_text,
            'locator', e.locator
          )
        )
        from public.question_evidence e
        where e.question_version_id = qv.id
      ),
      '[]'::jsonb
    )
  )
  into result
  from public.question_versions qv
  where qv.id = target_version_id;

  return result;
end
$$;

-- ---------------------------------------------------------------------------
-- Graded submission
-- ---------------------------------------------------------------------------
-- Returns only whether the answer was accepted. Explanations are withheld
-- until the whole attempt is submitted, which is what attempt_review is for.

create or replace function public.submit_attempt_response(
  target_attempt_id uuid,
  target_version_id uuid,
  learner_answer jsonb,
  seconds_spent integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  attempt_owner uuid;
  attempt_submitted timestamptz;
  key jsonb;
  choice_keys text[];
  correct_keys text[];
  answer_keys text[];
  is_correct boolean;
  question_skill public.skill_code;
  new_response_id uuid;
  mistake_id uuid;
begin
  select a.user_id, a.submitted_at into attempt_owner, attempt_submitted
  from public.attempts a where a.id = target_attempt_id;

  if attempt_owner is null then
    raise exception 'attempt not found' using errcode = 'P0002';
  end if;
  if attempt_owner <> auth.uid() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if attempt_submitted is not null then
    raise exception 'attempt already submitted' using errcode = '22023';
  end if;

  select qv.correct_answer, q.skill into key, question_skill
  from public.question_versions qv
  join public.questions q on q.id = qv.question_id
  where qv.id = target_version_id;

  -- Choice-based questions are graded against question_choices so that the
  -- key stays in one place; other kinds fall back to jsonb equality.
  select array_agg(c.stable_key order by c.stable_key)
    filter (where c.is_correct)
  into correct_keys
  from public.question_choices c
  where c.question_version_id = target_version_id;

  select array_agg(c.stable_key) into choice_keys
  from public.question_choices c
  where c.question_version_id = target_version_id;

  if choice_keys is not null then
    if jsonb_typeof(learner_answer) = 'array' then
      select array_agg(value order by value) into answer_keys
      from jsonb_array_elements_text(learner_answer);
    elsif jsonb_typeof(learner_answer) = 'string' then
      answer_keys := array[learner_answer #>> '{}'];
    else
      answer_keys := array[]::text[];
    end if;
    is_correct := coalesce(answer_keys, array[]::text[]) = coalesce(correct_keys, array[]::text[]);
  else
    is_correct := key is not null and learner_answer = key;
  end if;

  insert into public.attempt_responses (
    attempt_id, question_version_id, answer, score, time_seconds
  )
  values (
    target_attempt_id, target_version_id, learner_answer,
    case when is_correct then 1 else 0 end, seconds_spent
  )
  on conflict (attempt_id, question_version_id) do update
    set answer = excluded.answer,
        score = excluded.score,
        time_seconds = excluded.time_seconds
  returning id into new_response_id;

  -- An incorrect answer always produces a mistake record and a review card.
  if not is_correct then
    insert into public.mistake_records (
      user_id, response_id, category, original_answer, correct_answer, skill
    )
    values (
      auth.uid(), new_response_id, 'incorrect_answer', learner_answer,
      to_jsonb(correct_keys), question_skill
    )
    returning id into mistake_id;

    insert into public.review_cards (user_id, kind, front, back, source_mistake_id)
    select
      auth.uid(),
      'question',
      jsonb_build_object('prompt', qv.prompt, 'question_version_id', qv.id),
      jsonb_build_object('correct', to_jsonb(correct_keys)),
      mistake_id
    from public.question_versions qv
    where qv.id = target_version_id;
  end if;

  return jsonb_build_object('recorded', true, 'response_id', new_response_id);
end
$$;

-- ---------------------------------------------------------------------------
-- Post-submission review
-- ---------------------------------------------------------------------------
-- Every option carries its own explanation, and cited evidence carries the
-- source file, version, and page so a learner can check the claim.

create or replace function public.attempt_review(target_attempt_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  attempt_owner uuid;
  attempt_submitted timestamptz;
  result jsonb;
begin
  select a.user_id, a.submitted_at into attempt_owner, attempt_submitted
  from public.attempts a where a.id = target_attempt_id;

  if attempt_owner is null then
    raise exception 'attempt not found' using errcode = 'P0002';
  end if;
  if attempt_owner <> auth.uid() and not public.is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if attempt_submitted is null and not public.is_staff() then
    raise exception 'attempt not submitted' using errcode = '22023';
  end if;

  select jsonb_agg(item order by item->>'prompt')
  into result
  from (
    select jsonb_build_object(
      'question_version_id', qv.id,
      'prompt', qv.prompt,
      'your_answer', r.answer,
      'score', r.score,
      'correct_answer', qv.correct_answer,
      'explanation', qv.explanation,
      'distractor_explanations', qv.distractor_explanations,
      'options', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'stable_key', c.stable_key,
              'label', c.label,
              'is_correct', c.is_correct,
              'explanation', c.explanation
            ) order by c.position
          )
          from public.question_choices c
          where c.question_version_id = qv.id
        ),
        '[]'::jsonb
      ),
      'evidence', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'source_file_id', e.source_file_id,
              'source_version', sf.version,
              'page_number', e.page_number,
              'evidence_text', e.evidence_text
            )
          )
          from public.question_evidence e
          left join public.source_files sf on sf.id = e.source_file_id
          where e.question_version_id = qv.id
        ),
        '[]'::jsonb
      )
    ) as item
    from public.attempt_responses r
    join public.question_versions qv on qv.id = r.question_version_id
    where r.attempt_id = target_attempt_id
  ) rows;

  return coalesce(result, '[]'::jsonb);
end
$$;

revoke execute on function public.staff_question_full(uuid) from anon;
revoke execute on function public.submit_attempt_response(uuid, uuid, jsonb, integer) from anon;
revoke execute on function public.attempt_review(uuid) from anon;
