# Architecture

The current application is a production-shaped interactive prototype: Next.js App Router and TypeScript provide the UI shell, domain types, static educational seed content, and browser persistence. `database/schema.sql` is the PostgreSQL source model for the server-backed release.

## Bounded contexts

- **Identity and goals:** users, roles, learner targets, preferred exam, exam date.
- **Curriculum:** versioned courses and ordered lessons with structured block content.
- **Assessment:** reusable question sets, typed items, rubrics, attempts, responses, and scaled results.
- **Learning record:** enrollment, lesson mastery, time-on-task, XP, streaks, and immutable study events.
- **Publishing:** draft → review → published → archived lifecycle, with author ownership and role gates.

## Production integration

Connect PostgreSQL through a server-only data layer, add an OIDC-compatible authentication provider, and move progress writes from local storage to authenticated server actions. Uploads should use private object storage with signed URLs and malware scanning. AI feedback should run asynchronously, retain the rubric and model version, redact personal data, and always be presented as formative rather than an official exam score.

Use database transactions when submitting attempts. Compute official-style scaled scores in a versioned scoring service; do not infer or advertise equivalence without validating the current exam-provider tables. Rate-limit login, uploads, recording transcription, and AI feedback endpoints. Apply row-level authorization in the service layer and keep audit logs for publishing changes.

## Accessibility and quality

The interface uses semantic buttons and headings, visible focus behavior, reduced-motion support, responsive navigation, and text labels alongside color. Production QA should include keyboard/screen-reader journeys, audio transcripts, browser coverage, load testing for timed submissions, and restore tests for PostgreSQL and private media backups.
