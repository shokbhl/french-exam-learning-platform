# Deployment

1. Create separate Supabase development and production projects.
2. Configure the environment variables listed in `.env.example` in the hosting secret manager.
3. Apply migrations and seed only approved demonstration content.
4. Create private material and response-audio buckets; verify RLS with role-specific tests.
5. Run `npm ci && npm run check` and the Playwright suite.
6. Deploy the Next.js application, configure authentication redirect URLs, and smoke-test each role.

No deployment is performed by this repository workflow without explicit owner approval. Database backups, point-in-time recovery, object retention, and restore drills are release requirements.
