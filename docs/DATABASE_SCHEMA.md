# Database schema

The authoritative Supabase/PostgreSQL migration lives in `supabase/migrations`. Stable UUID primary keys identify concepts and records; display names are never relational keys.

Content identity and content versions are separate. Mutable authoring records point to a current version while published practice sets and attempts retain the exact immutable version used. Junction tables connect concepts to lessons, exam tasks, vocabulary, phrases, and collocations without duplication.

Student-owned data uses `user_id = auth.uid()` policies. Instructor access is assignment-scoped. Editor and administrator actions require a role recorded in `user_roles`; administrative mutations also create append-only audit events. Storage object paths begin with the owner or source ID to make policies enforceable.
