# Parcours français

An installable, responsive French-learning and TEF Canada / TCF Canada preparation platform built with Next.js, strict TypeScript, Tailwind CSS, Supabase, Zod, React Hook Form, Vitest, and Playwright.

The repository currently delivers a production-shaped MVP foundation and original demonstration content. It runs without Supabase or AI credentials in transparent local demonstration mode; configuring Supabase activates authenticated persistence and private material uploads.

## Implemented

- Responsive dashboard, skill analytics, XP, streak, goals, and progress persistence
- Supabase email authentication, canonical profiles, roles, protected admin routes, and multilingual onboarding goals
- Normalized migration with canonical concepts, immutable versions, database-driven exam formats, attempts, feedback, mistakes, spaced review, assignments, audits, RLS, and private buckets
- Original listening and reading activities with learning/exam modes, transcript/playback, notes, flags, evidence, distractor explanations, mistake capture, and review cards
- Writing workspace preserving the original, deterministic structure checks, browser speaking recorder, audio import, and explicit optional-AI state
- Private material workflow with MIME/size/metadata validation, checksums, safe paths, role checks, ingestion records, and compensating cleanup
- Editable TEF/TCF configuration demonstration and provider-neutral AI/speech boundaries
- Web-app manifest, security headers, CI, unit tests, and Playwright critical paths

## Local installation

Node.js 20.9 or newer is required.

```bash
cd /Users/shokbhl/Desktop/french-exam-learning-platform
cp .env.example .env.local
npm install
npm run dev
```

Open `http://localhost:3000`. Placeholder values intentionally keep Supabase disabled; replace them with a real project URL and anonymous key.

## Supabase setup

Create a private Supabase project, then:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
npx supabase db seed
```

Add the project URL and anonymous key to `.env.local`. The service-role key is only for trusted background ingestion and must never appear in a browser bundle. Verify RLS policies against each role before inviting users.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | Yes | Local/deployed canonical URL |
| `NEXT_PUBLIC_SUPABASE_URL` | For persistence | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | For persistence | RLS-scoped public client key |
| `SUPABASE_SERVICE_ROLE_KEY` | Background jobs only | Trusted ingestion; server-only |
| `AUTH_SECRET` | Production | Additional server-side signing secret |
| `AI_PROVIDER` / `OPENAI_API_KEY` | No | AI is disabled by default |
| `SPEECH_TO_TEXT_PROVIDER` | No | Disabled by default |
| `TEXT_TO_SPEECH_PROVIDER` | No | Disabled by default |

## Quality commands

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:e2e -- --project=chromium
```

`npm run check` runs the non-browser quality gate. Playwright may use locally installed Google Chrome on older macOS; CI installs Chromium.

## Security

Source files and speaking responses use separate private buckets. Admin writes require an editor/admin role at route and action layers. Inputs are validated server-side, filenames are replaced with generated paths, file types and sizes are restricted, and administrative data is designed for RLS and append-only audit events. Never commit `.env.local`, source PDFs, private audio, service-role keys, or exports. See `docs/SECURITY.md` before production use.

## Current limitations

- A Supabase project, SMTP/auth settings, and RLS integration tests require owner-provided infrastructure.
- Demo progress, exam-config drafts, and review cards use local storage until repository services are connected throughout the UI.
- AI feedback, transcription/TTS implementations, ingestion workers, instructor assignment UI, full mock orchestration, and production scoring adapters remain planned; no fake provider responses are returned.
- Listening playback is simulated because no licensed audio is committed.
- Exam formats must be checked against current official sources before activating a production version. All practice estimates are unofficial.
- The current product name is temporary and should move into application settings.

This independent tool is not affiliated with official TEF or TCF providers. Only project-owned, public-domain, or properly licensed materials may be imported.
