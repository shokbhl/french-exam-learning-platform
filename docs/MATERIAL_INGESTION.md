# Material ingestion

1. Validate role, extension, MIME signature, size, and safe generated filename.
2. Store the original in a private Supabase bucket.
3. Create a source and immutable source-file version.
4. Queue extraction and record page-level text/metadata.
5. Suggest language, CEFR level, topics, concepts, vocabulary, and exam relevance.
6. Create draft content with source/page evidence and provider metadata.
7. Require human review before publication.

Allowed formats are PDF, DOCX, TXT, Markdown, supported images, MP3, WAV, and M4A. Replacing a source creates a version. Referenced sources cannot be hard-deleted until dependencies are resolved; archive is the normal operation. Student access to originals is independent of lesson access.
