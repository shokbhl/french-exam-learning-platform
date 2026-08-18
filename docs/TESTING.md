# Testing

`npm run check` runs lint, strict type-check, unit tests, and the production build. Playwright covers registration, onboarding, authorization, admin upload and publishing, learning/exam modes, submission, mistake creation, review cards, and protected routes.

Database tests must exercise every RLS policy using anonymous, student, instructor, and administrator sessions. Upload tests use harmless fixtures and verify rejected MIME/size cases. Timed exam tests use a controllable clock. Accessibility checks cover keyboard flow, names, contrast, transcript access, and RTL rendering.
