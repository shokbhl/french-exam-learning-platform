-- Ingestion pipeline and source-grounded retrieval.
--
-- The foundation migration stored an uploaded file and an ingestion_jobs row,
-- but nothing between the file and a citable answer existed: no extracted
-- text, no page numbers, no chunks, no embeddings. This migration adds that
-- chain, keeping the page number and source version attached at every step so
-- a retrieved passage can always be traced back to "source X, version N,
-- page P".
--
-- Everything here is private editorial material. Learners never read these
-- tables directly; grounded answers reach them through a function that
-- returns citations, never raw source text in bulk.

create extension if not exists vector;

-- ---------------------------------------------------------------------------
-- Extracted text, one row per page
-- ---------------------------------------------------------------------------
-- Page-level rows are what make citation possible. A scanned PDF produces the
-- same shape via OCR, distinguished by extraction_method so that low-quality
-- OCR can be filtered or re-run without touching native text.

create type public.extraction_method as enum ('native', 'ocr', 'manual');

create table public.document_pages (
  id uuid primary key default gen_random_uuid(),
  source_file_id uuid not null references public.source_files(id) on delete cascade,
  page_number integer not null check (page_number >= 1),
  text text not null,
  char_count integer not null default 0,
  extraction_method public.extraction_method not null,
  -- OCR confidence in [0,1]; null for native extraction.
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  created_at timestamptz not null default now(),
  unique (source_file_id, page_number)
);

create index document_pages_file on public.document_pages (source_file_id, page_number);

-- ---------------------------------------------------------------------------
-- Semantic chunks
-- ---------------------------------------------------------------------------
-- A chunk may span a page boundary, so it records the range rather than a
-- single page. Retrieval cites page_from..page_to.

create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  source_file_id uuid not null references public.source_files(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  page_from integer not null check (page_from >= 1),
  page_to integer not null check (page_to >= 1),
  heading text,
  text text not null,
  token_count integer,
  created_at timestamptz not null default now(),
  unique (source_file_id, chunk_index),
  check (page_to >= page_from)
);

create index document_chunks_file on public.document_chunks (source_file_id);

-- Full-text search in French, used both on its own and to complement vector
-- search when an embedding provider is not configured.
alter table public.document_chunks
  add column search_vector tsvector
  generated always as (to_tsvector('french', coalesce(heading, '') || ' ' || text)) stored;

create index document_chunks_search on public.document_chunks using gin (search_vector);

-- ---------------------------------------------------------------------------
-- Embeddings
-- ---------------------------------------------------------------------------
-- The adapter that produces these is provider-neutral, but pgvector needs a
-- fixed dimension to build an index. 1536 matches the common default; the
-- model and dimensions are stored alongside so a mismatch is detectable rather
-- than silently producing nonsense similarity scores. Switching to a provider
-- with a different width requires a migration, which is documented in
-- docs/MATERIAL_INGESTION.md.

create table public.chunk_embeddings (
  id uuid primary key default gen_random_uuid(),
  chunk_id uuid not null references public.document_chunks(id) on delete cascade,
  provider text not null,
  model text not null,
  dimensions integer not null check (dimensions = 1536),
  embedding vector(1536) not null,
  created_at timestamptz not null default now(),
  unique (chunk_id, provider, model)
);

create index chunk_embeddings_ann on public.chunk_embeddings
  using hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- Job tracking
-- ---------------------------------------------------------------------------
-- ingestion_jobs already recorded a status; these columns and the event table
-- record why a job failed and how many times it has been retried, which is
-- what makes a background worker safe to re-run.

alter table public.ingestion_jobs
  add column attempts integer not null default 0,
  add column next_retry_at timestamptz,
  add column created_at timestamptz not null default now();

create index ingestion_jobs_pending on public.ingestion_jobs (status, next_retry_at)
  where status in ('pending', 'failed');

create table public.ingestion_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.ingestion_jobs(id) on delete cascade,
  stage text not null,
  status public.processing_status not null,
  message text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index ingestion_events_job on public.ingestion_events (job_id, created_at);

-- ---------------------------------------------------------------------------
-- Retrieval audit
-- ---------------------------------------------------------------------------
-- Records which chunks were returned for which question. This is what makes
-- "the answer cited page 12" checkable after the fact, and makes a leak
-- across users visible in the log rather than invisible.

create table public.retrieval_queries (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  query_text text not null,
  strategy text not null,
  chunk_ids uuid[] not null default '{}',
  result_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index retrieval_queries_actor on public.retrieval_queries (actor_id, created_at);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
-- Extracted source text is licensed third-party material. Only staff read it.

alter table public.document_pages enable row level security;
alter table public.document_chunks enable row level security;
alter table public.chunk_embeddings enable row level security;
alter table public.ingestion_events enable row level security;
alter table public.retrieval_queries enable row level security;

create policy document_pages_staff on public.document_pages
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy document_chunks_staff on public.document_chunks
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy chunk_embeddings_staff on public.chunk_embeddings
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy ingestion_events_staff on public.ingestion_events
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- A learner may see their own retrieval history; staff see all of it.
create policy retrieval_queries_own on public.retrieval_queries
  for select to authenticated using (actor_id = auth.uid() or public.is_staff());

-- ---------------------------------------------------------------------------
-- Grounded search
-- ---------------------------------------------------------------------------
-- Returns chunks with the source, version, and page range needed to cite them.
-- Restricted to source materials that are published and, for a learner, marked
-- student_file_access. A caller that gets no rows must be told the sources do
-- not support an answer rather than being given an ungrounded one.

create or replace function public.search_source_chunks(
  query_embedding vector(1536),
  match_limit integer default 8,
  min_similarity numeric default 0.25
)
returns table (
  chunk_id uuid,
  source_id uuid,
  source_title text,
  source_file_id uuid,
  source_version integer,
  page_from integer,
  page_to integer,
  heading text,
  text text,
  similarity numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    dc.id,
    sm.id,
    sm.title,
    sf.id,
    sf.version,
    dc.page_from,
    dc.page_to,
    dc.heading,
    dc.text,
    (1 - (ce.embedding <=> query_embedding))::numeric as similarity
  from public.document_chunks dc
  join public.chunk_embeddings ce on ce.chunk_id = dc.id
  join public.source_files sf on sf.id = dc.source_file_id
  join public.source_materials sm on sm.id = sf.source_id
  where
    (
      public.is_staff()
      or (sm.status = 'published' and sm.student_file_access)
    )
    and (1 - (ce.embedding <=> query_embedding)) >= min_similarity
  order by ce.embedding <=> query_embedding
  limit greatest(1, least(match_limit, 50));
$$;

-- EXECUTE defaults to PUBLIC, which anon inherits; revoke there and grant to
-- the signed-in role only, so an unauthenticated caller cannot reach source
-- text even though the function is security definer.
revoke execute on function public.search_source_chunks(vector, integer, numeric) from public;
grant execute on function public.search_source_chunks(vector, integer, numeric) to authenticated;
