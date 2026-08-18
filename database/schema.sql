-- Production PostgreSQL schema. Apply with your migration tool of choice.
CREATE TYPE user_role AS ENUM ('LEARNER','INSTRUCTOR','EDITOR','ADMIN');
CREATE TYPE exam_kind AS ENUM ('TEF_CANADA','TCF_CANADA');
CREATE TYPE skill_kind AS ENUM ('LISTENING','READING','SPEAKING','WRITING','GRAMMAR','VOCABULARY');
CREATE TYPE content_status AS ENUM ('DRAFT','IN_REVIEW','PUBLISHED','ARCHIVED');
CREATE TYPE item_kind AS ENUM ('SINGLE_CHOICE','MULTIPLE_CHOICE','SHORT_TEXT','ESSAY','RECORDING');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL,
  display_name text NOT NULL, password_hash text, role user_role NOT NULL DEFAULT 'LEARNER',
  locale text NOT NULL DEFAULT 'fr-CA', timezone text NOT NULL DEFAULT 'America/Toronto',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE learner_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  target_nclc smallint CHECK(target_nclc BETWEEN 1 AND 12), current_cefr text,
  preferred_exam exam_kind, exam_date date, weekly_goal_minutes integer NOT NULL DEFAULT 300,
  xp integer NOT NULL DEFAULT 0, streak_days integer NOT NULL DEFAULT 0
);
CREATE TABLE courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text UNIQUE NOT NULL, title text NOT NULL,
  summary text NOT NULL, cefr_level text NOT NULL, primary_skill skill_kind NOT NULL,
  status content_status NOT NULL DEFAULT 'DRAFT', estimated_minutes integer NOT NULL,
  author_id uuid REFERENCES users(id), published_at timestamptz, version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE course_exam_tags (
  course_id uuid REFERENCES courses(id) ON DELETE CASCADE, exam exam_kind NOT NULL,
  PRIMARY KEY(course_id, exam)
);
CREATE TABLE lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title text NOT NULL, position integer NOT NULL, body jsonb NOT NULL DEFAULT '[]',
  estimated_minutes integer NOT NULL, status content_status NOT NULL DEFAULT 'DRAFT',
  UNIQUE(course_id, position)
);
CREATE TABLE question_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL, exam exam_kind,
  skill skill_kind NOT NULL, cefr_level text NOT NULL, status content_status NOT NULL DEFAULT 'DRAFT',
  time_limit_seconds integer, instructions text, author_id uuid REFERENCES users(id), created_at timestamptz DEFAULT now()
);
CREATE TABLE questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), set_id uuid NOT NULL REFERENCES question_sets(id) ON DELETE CASCADE,
  kind item_kind NOT NULL, position integer NOT NULL, prompt text NOT NULL, stimulus jsonb,
  options jsonb, answer_key jsonb, explanation text, rubric jsonb, points numeric(6,2) NOT NULL DEFAULT 1,
  UNIQUE(set_id, position)
);
CREATE TABLE enrollments (
  user_id uuid REFERENCES users(id) ON DELETE CASCADE, course_id uuid REFERENCES courses(id) ON DELETE CASCADE,
  enrolled_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, PRIMARY KEY(user_id, course_id)
);
CREATE TABLE lesson_progress (
  user_id uuid REFERENCES users(id) ON DELETE CASCADE, lesson_id uuid REFERENCES lessons(id) ON DELETE CASCADE,
  state text NOT NULL CHECK(state IN ('NOT_STARTED','IN_PROGRESS','COMPLETED')),
  percent smallint NOT NULL DEFAULT 0 CHECK(percent BETWEEN 0 AND 100), time_spent_seconds integer NOT NULL DEFAULT 0,
  last_activity_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id, lesson_id)
);
CREATE TABLE attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  set_id uuid NOT NULL REFERENCES question_sets(id), started_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz, raw_score numeric(8,2), scaled_score numeric(8,2), estimated_nclc smallint
);
CREATE TABLE responses (
  attempt_id uuid REFERENCES attempts(id) ON DELETE CASCADE, question_id uuid REFERENCES questions(id),
  answer jsonb NOT NULL, score numeric(6,2), feedback jsonb, answered_at timestamptz DEFAULT now(),
  PRIMARY KEY(attempt_id, question_id)
);
CREATE TABLE study_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type text NOT NULL, entity_type text, entity_id uuid, duration_seconds integer,
  metadata jsonb NOT NULL DEFAULT '{}', occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX study_events_user_date_idx ON study_events(user_id, occurred_at DESC);
CREATE INDEX attempts_user_date_idx ON attempts(user_id, started_at DESC);
CREATE INDEX courses_discovery_idx ON courses(status, cefr_level, primary_skill);
