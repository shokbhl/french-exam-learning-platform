# Security

- Supabase Auth owns sessions; `profiles.id` references `auth.users.id`.
- RLS is enabled on exposed tables and private storage buckets. Server actions repeat authorization checks.
- Zod validates inputs. Uploads validate MIME signatures, size, generated names, and ownership.
- Signed URLs are short-lived. Secrets and service-role keys are server-only.
- Authentication, upload, transcription, and AI endpoints are rate-limited.
- Administrative mutations create append-only audit events with actor and change metadata.
- Errors shown to users exclude stack traces, SQL, storage paths, and provider secrets.
- CSP and standard security headers are configured at the application edge.

Before production, run dependency, RLS, authorization, upload, and recovery reviews against the configured Supabase project.
