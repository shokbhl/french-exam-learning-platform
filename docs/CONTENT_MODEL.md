# Content model

A concept is the canonical teaching unit, such as “expressing an opinion.” A version contains localized explanations, rules, examples, errors, pronunciation, and summary blocks. Lessons compose concept versions with diagnostics, controlled practice, free production, review cards, and next-step references.

Exam mappings connect the same concept to a particular versioned exam task and carry one label: `COMMON`, `TEF_ONLY`, `TCF_ONLY`, or `GENERAL_FRENCH`. Editing creates a new version; it never mutates content referenced by a submitted attempt or published mock exam.

Questions use a stable question identity plus immutable versions. Options and evidence are normalized. Evidence retains source material version, page, and excerpt coordinates. Duplicate detection combines source evidence, normalized prompt hashes, and editorial review.
