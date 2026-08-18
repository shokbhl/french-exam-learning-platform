-- Supabase compatibility shim for local verification.
--
-- The migrations target a Supabase database, which supplies an `auth` schema,
-- a `storage` schema, and the anon / authenticated / service_role roles before
-- any project migration runs. A plain PostgreSQL server has none of that, so
-- this file recreates just enough of it to apply the migrations and exercise
-- the policies.
--
-- This file is NEVER applied to a real Supabase project: there the real
-- objects already exist and are managed by the platform. It exists so that
-- RLS policies can be tested in CI and on a developer machine without
-- provisioning a hosted project.

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- auth schema
-- ---------------------------------------------------------------------------

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- Supabase derives the current user from the request JWT. PostgREST exposes
-- the claims as the `request.jwt.claims` GUC, so tests impersonate a user by
-- setting that GUC and switching role.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif((current_setting('request.jwt.claims', true)::jsonb ->> 'sub'), '')
  )::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif((current_setting('request.jwt.claims', true)::jsonb ->> 'role'), ''),
    'anon'
  )
$$;

-- ---------------------------------------------------------------------------
-- storage schema
-- ---------------------------------------------------------------------------

create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets(id),
  name text not null,
  owner uuid,
  metadata jsonb,
  created_at timestamptz not null default now(),
  unique (bucket_id, name)
);

alter table storage.objects enable row level security;

-- Splits an object path into its folder segments, dropping the filename.
-- Matches the behaviour the storage policies rely on: for 'uid/file.webm'
-- element 1 is the owning user id.
create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select string_to_array(name, '/')
$$;

-- ---------------------------------------------------------------------------
-- Default grants
-- ---------------------------------------------------------------------------
-- Supabase grants the API roles blanket access to the public schema; the
-- hardening migration then revokes it from anon. Reproduce the starting state
-- so the revoke is actually exercised.

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema storage to anon, authenticated, service_role;

alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;
