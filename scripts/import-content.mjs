#!/usr/bin/env node
/**
 * Imports authored practice content into Postgres.
 *
 * Content lives in reviewable JSON files under `content/` rather than in the
 * database only, so that a question can be diffed, reviewed in a pull request,
 * and re-imported. Re-running the script on an edited file updates the same
 * rows: questions are matched by `stableKey` and practice sets by title, so
 * the import is idempotent rather than accumulating duplicates.
 *
 * It writes with the service-role key because the answer key columns are
 * revoked from `authenticated` — no signed-in session, staff included, can
 * insert `correct_answer` or `is_correct` through PostgREST.
 *
 *   node scripts/import-content.mjs content/exemple-comprehension.json
 *   node scripts/import-content.mjs content/*.json --dry-run
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const SKILLS = ["LISTENING", "READING", "WRITING", "SPEAKING", "GRAMMAR", "VOCABULARY"];
const STATUSES = ["draft", "in_review", "published", "archived"];

function loadEnv() {
  // Vercel and CI provide these directly; locally they sit in .env.local.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      for (const line of readFileSync(".env.local", "utf8").split("\n")) {
        if (!line.includes("=") || line.trimStart().startsWith("#")) continue;
        const at = line.indexOf("=");
        const key = line.slice(0, at).trim();
        if (process.env[key]) continue;
        process.env[key] = line.slice(at + 1).trim().replace(/^["']|["']$/g, "");
      }
    } catch {
      /* no .env.local; rely on the ambient environment */
    }
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  }
  return { url, key };
}

function fail(message) {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
}

/**
 * Checks a file before any write happens.
 *
 * Validation is deliberately strict and runs over the whole file first: a
 * partial import that stopped halfway through would leave a practice set
 * pointing at some questions and not others.
 */
function validate(doc, path) {
  const errors = [];
  const at = (where) => `${path}: ${where}`;

  if (!doc.set || typeof doc.set.title !== "string" || doc.set.title.trim().length < 3) {
    errors.push(at("set.title is required (3 characters or more)"));
  }
  if (doc.set?.status && !STATUSES.includes(doc.set.status)) {
    errors.push(at(`set.status must be one of ${STATUSES.join(", ")}`));
  }
  if (doc.set?.skill && !SKILLS.includes(doc.set.skill)) {
    errors.push(at(`set.skill must be one of ${SKILLS.join(", ")}`));
  }
  if (!Array.isArray(doc.questions) || doc.questions.length === 0) {
    errors.push(at("questions must be a non-empty array"));
    return errors;
  }

  const seen = new Set();
  doc.questions.forEach((question, index) => {
    const where = `questions[${index}]`;
    if (typeof question.stableKey !== "string" || !/^[a-z0-9][a-z0-9-]{2,79}$/.test(question.stableKey)) {
      errors.push(at(`${where}.stableKey must be a lowercase slug`));
    } else if (seen.has(question.stableKey)) {
      errors.push(at(`${where}.stableKey "${question.stableKey}" is used twice in this file`));
    } else {
      seen.add(question.stableKey);
    }

    // A question inherits the set's skill so that an author states it once per
    // file. Neither level naming a skill is an error rather than a guess: a
    // question filed under the wrong skill silently distorts the per-skill
    // mastery tracking, and would surface as a wrong level estimate weeks
    // later instead of as a message now.
    const skill = question.skill ?? doc.set?.skill;
    if (!SKILLS.includes(skill)) {
      errors.push(
        at(
          skill == null
            ? `${where}.skill is missing and set.skill is not set either`
            : `${where}.skill must be one of ${SKILLS.join(", ")}`,
        ),
      );
    }
    if (typeof question.prompt !== "string" || question.prompt.trim().length < 5) {
      errors.push(at(`${where}.prompt is required`));
    }
    if (question.difficulty != null && !(question.difficulty >= 1 && question.difficulty <= 5)) {
      errors.push(at(`${where}.difficulty must be between 1 and 5`));
    }
    if (question.version != null && !Number.isInteger(question.version)) {
      errors.push(at(`${where}.version must be a whole number`));
    }

    const choices = question.choices;
    if (!Array.isArray(choices) || choices.length < 2) {
      errors.push(at(`${where}.choices needs at least two options`));
      return;
    }
    const keys = new Set();
    choices.forEach((choice, choiceIndex) => {
      if (typeof choice.key !== "string" || choice.key.length === 0) {
        errors.push(at(`${where}.choices[${choiceIndex}].key is required`));
      } else if (keys.has(choice.key)) {
        errors.push(at(`${where}.choices[${choiceIndex}].key "${choice.key}" is duplicated`));
      } else {
        keys.add(choice.key);
      }
      if (typeof choice.label !== "string" || choice.label.trim().length === 0) {
        errors.push(at(`${where}.choices[${choiceIndex}].label is required`));
      }
    });
    // Grading compares the full set of correct keys, so a question with no
    // correct option is unanswerable rather than merely hard.
    if (!choices.some((choice) => choice.correct === true)) {
      errors.push(at(`${where} has no option marked "correct": true`));
    }
  });

  return errors;
}

/** Resolves the newest file of a source material named in the content file. */
async function resolveEvidenceFile(db, sourceTitle, cache) {
  if (cache.has(sourceTitle)) return cache.get(sourceTitle);

  const { data, error } = await db
    .from("source_materials")
    .select("id, source_files(id, version)")
    .eq("title", sourceTitle)
    .maybeSingle();

  if (error) fail(`could not look up source material "${sourceTitle}": ${error.message}`);
  if (!data) {
    fail(`no source material titled "${sourceTitle}". Upload it at /admin/materials first.`);
  }
  const latest = (data.source_files ?? []).slice().sort((a, b) => b.version - a.version)[0];
  if (!latest) fail(`source material "${sourceTitle}" has no uploaded file to cite.`);

  cache.set(sourceTitle, latest.id);
  return latest.id;
}

async function importFile(db, path, dryRun) {
  const doc = JSON.parse(readFileSync(path, "utf8"));
  const errors = validate(doc, path);
  if (errors.length > 0) {
    console.error(`\n  ✗ ${path} is not valid:`);
    for (const message of errors) console.error(`      ${message}`);
    process.exit(1);
  }

  console.log(`\n  ${path}`);
  if (dryRun) {
    console.log(`    valid · set "${doc.set.title}" · ${doc.questions.length} questions (no write)`);
    return;
  }

  const setStatus = doc.set.status ?? "published";
  const evidenceCache = new Map();
  const versionIds = [];

  for (const question of doc.questions) {
    const version = question.version ?? 1;
    const skill = question.skill ?? doc.set.skill;
    // A question inherits the set's status. Defaulting to "published" would
    // mark the questions of a draft set as publishable on their own, so a later
    // set could pick them up before anyone had read them.
    const status = question.status ?? setStatus;
    const correctKeys = question.choices
      .filter((choice) => choice.correct === true)
      .map((choice) => choice.key)
      .sort();

    const { data: questionRow, error: questionError } = await db
      .from("questions")
      .upsert(
        {
          stable_key: question.stableKey,
          skill,
          status,
          current_version: version,
        },
        { onConflict: "stable_key" },
      )
      .select("id")
      .single();
    if (questionError) fail(`question "${question.stableKey}": ${questionError.message}`);

    const { data: versionRow, error: versionError } = await db
      .from("question_versions")
      .upsert(
        {
          question_id: questionRow.id,
          version,
          kind: question.kind ?? "mcq",
          prompt: question.prompt,
          difficulty: question.difficulty ?? null,
          content: question.content ?? {},
          correct_answer: correctKeys,
          explanation: question.explanation ?? null,
          distractor_explanations: Object.fromEntries(
            question.choices
              .filter((choice) => choice.explanation && choice.correct !== true)
              .map((choice) => [choice.key, choice.explanation]),
          ),
        },
        { onConflict: "question_id,version" },
      )
      .select("id")
      .single();
    if (versionError) fail(`question "${question.stableKey}" version ${version}: ${versionError.message}`);

    // Options and evidence are replaced wholesale: editing the file is the
    // way to change them, and a leftover option from a previous import would
    // be an answer nobody wrote.
    const { error: clearChoices } = await db
      .from("question_choices")
      .delete()
      .eq("question_version_id", versionRow.id);
    if (clearChoices) fail(`clearing options for "${question.stableKey}": ${clearChoices.message}`);

    const { error: choiceError } = await db.from("question_choices").insert(
      question.choices.map((choice, position) => ({
        question_version_id: versionRow.id,
        stable_key: choice.key,
        label: choice.label,
        position,
        is_correct: choice.correct === true,
        explanation: choice.explanation ?? null,
      })),
    );
    if (choiceError) fail(`options for "${question.stableKey}": ${choiceError.message}`);

    const { error: clearEvidence } = await db
      .from("question_evidence")
      .delete()
      .eq("question_version_id", versionRow.id);
    if (clearEvidence) fail(`clearing evidence for "${question.stableKey}": ${clearEvidence.message}`);

    if (Array.isArray(question.evidence) && question.evidence.length > 0) {
      const rows = [];
      for (const item of question.evidence) {
        rows.push({
          question_version_id: versionRow.id,
          source_file_id: item.sourceTitle ? await resolveEvidenceFile(db, item.sourceTitle, evidenceCache) : null,
          page_number: item.page ?? null,
          evidence_text: item.text,
        });
      }
      const { error: evidenceError } = await db.from("question_evidence").insert(rows);
      if (evidenceError) fail(`evidence for "${question.stableKey}": ${evidenceError.message}`);
    }

    versionIds.push(versionRow.id);
  }

  const { data: existingSet, error: setLookupError } = await db
    .from("practice_sets")
    .select("id")
    .eq("title", doc.set.title)
    .maybeSingle();
  if (setLookupError) fail(`practice set lookup: ${setLookupError.message}`);

  let setId = existingSet?.id;
  if (setId) {
    const { error } = await db
      .from("practice_sets")
      .update({ mode: doc.set.mode ?? "practice", status: setStatus })
      .eq("id", setId);
    if (error) fail(`practice set update: ${error.message}`);
  } else {
    const { data, error } = await db
      .from("practice_sets")
      .insert({ title: doc.set.title, mode: doc.set.mode ?? "practice", status: setStatus })
      .select("id")
      .single();
    if (error) fail(`practice set insert: ${error.message}`);
    setId = data.id;
  }

  const { error: clearSet } = await db.from("practice_set_questions").delete().eq("practice_set_id", setId);
  if (clearSet) fail(`clearing practice set: ${clearSet.message}`);

  const { error: linkError } = await db.from("practice_set_questions").insert(
    versionIds.map((id, position) => ({
      practice_set_id: setId,
      question_version_id: id,
      position,
    })),
  );
  if (linkError) fail(`linking questions to the set: ${linkError.message}`);

  console.log(`    ✓ "${doc.set.title}" · ${versionIds.length} questions · status ${setStatus}`);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const paths = args.filter((arg) => !arg.startsWith("--"));

  if (paths.length === 0) {
    fail("usage: node scripts/import-content.mjs <file.json> [...] [--dry-run]");
  }

  const { url, key } = loadEnv();
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  for (const path of paths) await importFile(db, path, dryRun);
  console.log(dryRun ? "\n  Validation complete. Nothing was written.\n" : "\n  Import complete.\n");
}

await main();
