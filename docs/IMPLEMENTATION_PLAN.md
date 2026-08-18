# Implementation plan

## Delivery principles

Canonical concepts are authored once and linked to exam applications. Published content and submitted attempts point to immutable versions. All data access is scoped by Supabase Row Level Security and repeated in server-side authorization. AI and speech providers sit behind interfaces and are optional.

## Phases

1. **Foundation:** application shell, design tokens, Supabase clients, authentication, roles, onboarding, migrations, and seed data.
2. **Admin and materials:** private upload, metadata, ingestion jobs, source references, review workflow, versioning, and audit history.
3. **Shared learning:** canonical concepts, lessons, vocabulary, expressions, collocations, mistakes, and spaced repetition.
4. **Listening and reading:** complete learning and exam-mode demo workflows, question explanations, attempts, and progress.
5. **Writing and speaking:** text/audio submissions, timers, structured feedback, and exam-specific tasks.
6. **Exam simulator:** database-driven TEF/TCF versions, navigation policies, timings, estimates, and history.
7. **Adaptive and AI:** study-plan recommendations and source-grounded provider-neutral assistance.
8. **Release readiness:** accessibility, security, performance, PWA, CI, E2E tests, and deployment runbook.

Each phase must pass lint, type-check, unit tests, and production build. Important user journeys additionally require Playwright coverage.
