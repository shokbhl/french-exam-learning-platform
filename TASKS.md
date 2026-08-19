# Delivery tracker

Status reflects what has been verified, not what has been sketched. A box is
ticked only when the behaviour it describes has been executed and checked —
for database work, against a real PostgreSQL server; for application work,
against the lint / typecheck / unit test / build gate.

## Phase 1 — Foundation

- [x] Isolated Git repository and safe ignore rules
- [x] Next.js, React, strict TypeScript, Tailwind, lint, and unit-test baseline
- [x] Responsive dashboard prototype
- [x] Supabase clients, migrations, seed, authentication, roles, onboarding
- [x] Route-based application navigation and reusable accessible components

## Phase 2 — Admin and materials

- [x] Private upload and materials library
- [x] Metadata, ingestion status, preview, version replacement, archive
- [x] Draft/review/publish data workflow and audit log schema
- [x] Audit log actually written, from triggers, and append-only

## Phase 3 — Database authorization

- [x] Row level security enabled on every table (25 were unprotected)
- [x] Explicit policy on every RLS-enabled table (2 were deny-all)
- [x] Anonymous role's blanket grants on the public schema revoked
- [x] Answer keys withheld from learners at column level
- [x] Server-side grading, so the key never reaches the browser
- [x] Explanations withheld until an attempt is submitted
- [x] RLS regression suite covering each role (`npm run db:test`)
- [x] Database-generated TypeScript types (`npm run db:types`), wired into
      the browser, server, and proxy clients
- [x] Migrations, policies, and functions verified on PostgreSQL 17 + pgvector
- [x] Verified against the hosted Supabase project. All five migrations were
      applied to the live project and the policies re-checked from a real
      signed-in session over PostgREST: with two lessons present (one draft,
      one published) a learner sees only the published one; with a private
      source material and eight audit rows present a learner sees none of
      either; `is_correct` and `correct_answer` return 403; inserting a
      lesson, granting oneself `admin`, and awarding oneself XP all return
      403; and one learner cannot write another's goals. The signup trigger
      creates the profile and default role.
- [x] Private storage buckets confirmed on the live project: `materials`
      (25 MB) and `speaking-responses` (50 MB), both non-public
- [ ] Signed URLs not yet exercised — no file has been uploaded through the
      live project, so the download path is still unverified
- [ ] Multi-tenant isolation: the schema is role-based and single-tenant, so
      "cross-organization" leakage cannot be enforced or tested until an
      organization/tenant boundary is designed

## Phase 4 — Persistence (replacing demonstration storage)

- [x] Seeded learner progress removed (shipped a 12-day streak and 2840 XP as
      a new learner's own record)
- [x] XP, streaks, and lesson completions persisted server-side, with a
      progress repository that returns a distinct state for unconfigured,
      signed-out, ready, and failed reads — a failed read never degrades into
      plausible-looking numbers
- [x] Dashboard reads progress on the server; local storage is used only as
      the demonstration store when Supabase is unavailable
- [ ] Lesson completion is **not yet persisted**: the demonstration lessons in
      `src/lib/content.ts` are identified by slugs like `radio` and have no
      corresponding rows in the `lessons` table, so a completion cannot be
      recorded against them. Completing a lesson currently updates the
      interface for the session only. Blocked on seeding real lessons
      (Phase 5).
- [ ] Persist onboarding, goals, attempts, answers, mistakes, review cards,
      study plans, writing, speaking
- [x] Fabricated learner figures removed from the dashboard. The fixed
      "68% / 3 h 24 min" weekly goal now reports real days of activity derived
      from the XP ledger against the learner's own study-day target; the
      hardcoded five-of-seven active days come from real dates; the learner
      identity, declared level and NCLC target come from the profile and
      goals; the greeting shows the real name and today's date. Per-skill
      mastery is not tracked yet, so that card shows an explicit empty state
      instead of the invented 74/81/62/70 scores, and the recommendation no
      longer asserts a 12-point gap nothing measured. Demonstration figures
      still appear when signed out or unconfigured, but now behind a banner
      that says so.

## Phase 4b — Members-only access

- [x] Every route requires a session. Only `/auth`, `/unauthorized` and the
      web manifest are public, so a new page is private by default rather than
      public until someone remembers to protect it. The gate is skipped when
      Supabase is unconfigured, which keeps the offline demonstration usable.
- [x] Sign-out. None existed; gating every route without it would have left a
      signed-in learner with no way out.
- [x] Registration handles email confirmation. This project has
      `mailer_autoconfirm` off, so sign-up returns no session; the form now
      says to open the confirmation link instead of redirecting into the gate
      and bouncing straight back with no explanation. Sign-in also
      distinguishes an unconfirmed address from a wrong password.
- [x] A signed-in learner without goals is sent to onboarding first.
- [x] Server-side Zod validation on both auth actions, and `next` is
      restricted to same-origin paths so it cannot be used as an open redirect.
- [x] End-to-end coverage against the real project: a signed-out visitor is
      refused, sign-in leads to onboarding then a dashboard showing 0 XP with
      no demonstration figures, and signing out revokes access again. The
      demonstration specs skip when Supabase is configured and vice versa, so
      both modes stay covered.
- [x] Verified directly against production: 50 tables, all 50 with row level
      security enabled, 86 policies, none enabled-but-policy-less, pgvector
      0.8.2. Generated types are byte-identical from production and from the
      local test database.

## Phase 4c — Member library

- [x] Members read the curated library. `source_materials` was staff-only, so
      members could not see anything; a published material is now visible to
      any member.
- [x] Publication and redistribution are separate gates. A published material
      may be quoted in an exercise without its file being handed over;
      `student_file_access` decides that, and the file row itself is hidden
      unless it is set. Licensed third-party text can therefore be used
      without being redistributed.
- [x] Downloads go through short-lived signed URLs (120s) minted server-side
      after `may_download_source_file` has answered, so the storage bucket
      stays closed to members and there is one authorization path rather than
      two that can drift.
- [x] Downloads are rate limited per learner and recorded in an append-only
      `material_downloads` table, since licensed material carries
      redistribution limits and who opened what has to be answerable.
- [x] Verified on production: the private bucket refuses anonymous requests,
      a signed URL returns the exact uploaded bytes, a member sees both
      published materials but only the released file row, and the download
      check returns true for the released document and false for the
      quote-only one.
- [x] Staff UI for publishing and releasing material. The admin page listed
      two hardcoded demonstration entries and never read the database; it now
      shows real materials with their status, rights, and release state.
      Draft → in review → published, and release as a separate confirmed
      action, because handing over a file cannot be undone for copies already
      downloaded.
- [x] A material whose copyright status is still unverified cannot be
      released, enforced by a database constraint rather than only in the
      action that happens to call it. It can still be published and quoted in
      exercises.
- [x] Publication and release record who approved them and when; withdrawing
      clears the stamp so a later re-publication cannot inherit an old
      approval.

## Phase 5 — Shared learning

- [ ] Canonical concepts and versioned lessons
- [ ] Grammar, vocabulary, phrases, collocations
- [x] Mistake notebook and review cards (schema and generation; UI still reads
      local storage)

## Phase 6 — Listening and reading

- [x] Original learning-mode demonstrations
- [x] Configurable exam-mode demonstrations
- [x] Evidence explanations and mistake capture

## Phase 7 — Writing and speaking

- [x] Writing workspace with preserved original and deterministic structure feedback
- [x] Browser recording/upload workflow with private-storage architecture
- [ ] Submissions persisted to `writing_submissions` / `speaking_submissions`
- [ ] Recordings stored privately with signed-URL playback
- [ ] Transcription and AI-feedback provider implementations

## Phase 8 — Ingestion and retrieval

- [x] Schema: page-level extracted text, OCR/native distinction, semantic
      chunks with page ranges, pgvector embeddings with an HNSW index,
      ingestion job retry/event tracking, retrieval audit
- [x] Grounded search returns source, version, and page for every hit, and
      returns nothing rather than guessing when no source matches
- [x] PDF text extraction, page by page (`scripts/ingest-material.ts`)
- [x] Scanned-document reading through the Claude provider, opt-in per run
      with `--allow-model-reading`; pages recorded as `ocr` with a confidence
- [x] Chunking implementation, page ranges preserved across page breaks
- [ ] Embedding provider adapter (retrieval still unused; drafting reads
      chunks directly by document rather than by similarity)
- [ ] MIME signature (magic byte) validation — currently only the
      client-supplied `file.type` is checked
- [ ] Background ingestion worker (ingestion is a CLI step today)
- [x] Draft question generation across skills, written to `content/drafts/`
      for human review rather than into the database
- [ ] Draft lesson and vocabulary generation

## Phase 9 — Exam simulator

- [x] Editable TEF/TCF configuration demonstration and versioned schema
- [ ] Timers, navigation rules, estimates, and attempt history driven from
      database configuration

## Phase 10 — Adaptive and AI

- [ ] Study-plan and recommendation service
- [x] Provider-neutral AI and speech adapters with disabled states
- [ ] Mastery tracking by concept and skill
- [ ] Instructor assignment and feedback workflows

## Phase 11 — Release readiness

- [x] GitHub Actions quality gate, extended with a database job that applies
      the migrations, runs the RLS suite, and fails if the generated types are
      stale
- [ ] PWA, RTL, accessibility and security review
- [ ] Rate limiting
- [ ] Full Playwright coverage
- [ ] Production documentation refresh

## Blocked on owner action

These cannot be completed from the repository alone.

1. **Database connection string.** The project itself is provisioned and the
   schema is applied. `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   and `SUPABASE_SERVICE_ROLE_KEY` are configured locally and in Vercel, but
   `DATABASE_URL` is empty because Vercel stores the pooled connection string
   as a write-only secret and the direct host is IPv6-only. Future migrations
   are therefore applied through the dashboard SQL editor rather than `psql`,
   and `npm run db:types` runs against the local shimmed database. Owner
   action, optional: reset the database password and record a session-pooler
   connection string in `.env.local`.

2. **Embedding provider.** The retrieval schema fixes vector width at 1536.
   Choosing a provider with a different width requires a migration. No AI
   credentials are configured and no provider returns fabricated output.

3. **Exam format review.** The TEF/TCF section timings and question counts in
   the seed and in `src/lib/content.ts` must be checked against current
   official sources before any version is marked active. All scores the
   platform reports are unofficial practice estimates.
