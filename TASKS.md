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
- [ ] Verified against a hosted Supabase project — **blocked, see below**
- [ ] Storage buckets and signed URLs verified — **blocked, see below**
- [ ] Multi-tenant isolation: the schema is role-based and single-tenant, so
      "cross-organization" leakage cannot be enforced or tested until an
      organization/tenant boundary is designed

## Phase 4 — Persistence (replacing demonstration storage)

- [x] Seeded learner progress removed (shipped a 12-day streak and 2840 XP as
      a new learner's own record)
- [ ] Repository layer over Supabase
- [ ] Persist onboarding, goals, lessons, attempts, answers, mistakes, review
      cards, study plans, writing, speaking, XP, and progress
- [ ] Offline/demo mode preserved when Supabase is unavailable
- [ ] Remove hardcoded skill scores, weekly activity, and pathway progress
      from `src/lib/content.ts`, which currently presents fixed numbers as the
      learner's own record

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
- [ ] PDF text extraction, page by page
- [ ] OCR adapter for scanned documents
- [ ] Chunking implementation
- [ ] Embedding provider adapter
- [ ] MIME signature (magic byte) validation — currently only the
      client-supplied `file.type` is checked
- [ ] Background ingestion worker
- [ ] Draft lesson/vocabulary/question generation with human approval

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

1. **Supabase project.** No credentials exist; `.env.local` is a byte-identical
   copy of `.env.example`. Required to verify auth flows, storage buckets, and
   signed URLs, and to run the migrations against the real platform (the local
   suite uses a compatibility shim for the `auth` and `storage` schemas).
   Owner action: create a project, then put `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in
   `.env.local` and in the Vercel project settings. Do not commit them.

2. **Embedding provider.** The retrieval schema fixes vector width at 1536.
   Choosing a provider with a different width requires a migration. No AI
   credentials are configured and no provider returns fabricated output.

3. **Exam format review.** The TEF/TCF section timings and question counts in
   the seed and in `src/lib/content.ts` must be checked against current
   official sources before any version is marked active. All scores the
   platform reports are unofficial practice estimates.
