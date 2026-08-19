#!/usr/bin/env node
/**
 * Drafts questions across skills from an ingested material.
 *
 * The output is a JSON file under `content/drafts/`, in exactly the format
 * `import-content.ts` reads — not rows in the database. That is deliberate: the
 * schema treats publication as a human decision, and a generated question that
 * wrote itself straight into a learner's exercise would make that decision on
 * nobody's authority. Read the draft, fix what is wrong, then import it.
 *
 * The material must be ingested first, because a question is only allowed to
 * cite text that actually exists in `document_chunks`.
 *
 *   node scripts/draft-questions.ts --material "Titre" --skills READING,LISTENING --per-skill 3
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { adminClient, fail, findMaterial, loadEnv } from "./lib/env.ts";

const ALL_SKILLS = ["LISTENING", "READING", "WRITING", "SPEAKING", "GRAMMAR", "VOCABULARY"];

/** How much source text one drafting call is given. */
const MAX_CHUNKS = 12;

type Args = { title: string; skills: string[]; perSkill: number; out: string | null };

function parseArgs(argv: string[]): Args {
  const args: Args = { title: "", skills: ["READING", "LISTENING", "WRITING", "SPEAKING"], perSkill: 2, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i + 1];
    if (argv[i] === "--material") {
      if (!value) fail("--material needs a title");
      args.title = value;
      i += 1;
    } else if (argv[i] === "--skills") {
      if (!value) fail("--skills needs a comma-separated list");
      args.skills = value.split(",").map((skill) => skill.trim().toUpperCase());
      i += 1;
    } else if (argv[i] === "--per-skill") {
      args.perSkill = Number(value);
      i += 1;
    } else if (argv[i] === "--out") {
      args.out = value ?? null;
      i += 1;
    } else fail(`unknown argument: ${argv[i]}`);
  }

  if (!args.title) fail('usage: node scripts/draft-questions.ts --material "Title" [--skills READING,WRITING] [--per-skill 2]');
  const unknown = args.skills.filter((skill) => !ALL_SKILLS.includes(skill));
  if (unknown.length > 0) fail(`unknown skill(s): ${unknown.join(", ")}`);
  if (!Number.isInteger(args.perSkill) || args.perSkill < 1 || args.perSkill > 10) {
    fail("--per-skill must be a whole number between 1 and 10");
  }
  return args;
}

function slug(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnv();

  const { hasAnthropicKey, draftQuestionsFromChunks } = await import("../src/lib/ai/anthropic.ts");
  if (!hasAnthropicKey()) {
    fail(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local (and set AI_PROVIDER=anthropic for the application) before drafting.",
    );
  }

  const db = adminClient();
  const { material, file } = await findMaterial(db, args.title);

  const { data: chunks, error } = await db
    .from("document_chunks")
    .select("id, page_from, page_to, heading, text")
    .eq("source_file_id", file.id)
    .order("chunk_index")
    .limit(MAX_CHUNKS);

  if (error) fail(`reading chunks: ${error.message}`);
  if (!chunks || chunks.length === 0) {
    fail(`"${material.title}" has no extracted text yet. Run: node scripts/ingest-material.ts --material "${material.title}"`);
  }

  console.log(`\n  ${material.title}`);
  console.log(`    ${chunks.length} chunk(s) · skills: ${args.skills.join(", ")} · ${args.perSkill} per skill`);
  console.log("    drafting with claude-opus-5…");

  const drafted = await draftQuestionsFromChunks({
    materialTitle: material.title as string,
    cefrLevel: material.cefr_level as string | null,
    skills: args.skills,
    perSkill: args.perSkill,
    chunks: chunks.map((chunk) => ({
      chunkId: chunk.id as string,
      pageFrom: chunk.page_from as number,
      pageTo: chunk.page_to as number,
      heading: chunk.heading as string | null,
      text: chunk.text as string,
    })),
  });

  if (drafted.length === 0) {
    fail("the model returned no questions. The passages may not support the requested skills.");
  }

  // Written in the import format, with the material named so that
  // `question_evidence` resolves back to the file the questions came from.
  const document = {
    set: {
      title: `${material.title} · exercices`,
      mode: "practice",
      // Drafts stay unpublished until a person has read them.
      status: "draft",
    },
    questions: drafted.map((question) => ({
      stableKey: question.stableKey,
      skill: question.skill,
      kind: question.kind || "mcq",
      version: 1,
      difficulty: question.difficulty,
      prompt: question.prompt,
      content: question.content,
      explanation: question.explanation,
      choices: question.choices,
      evidence: (question.evidence ?? []).map((item) => ({
        sourceTitle: material.title,
        page: item.page,
        text: item.text,
      })),
    })),
  };

  const path = args.out ?? `content/drafts/${slug(material.title as string)}.json`;
  mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`, "utf8");

  const bySkill = drafted.reduce<Record<string, number>>((counts, question) => {
    counts[question.skill] = (counts[question.skill] ?? 0) + 1;
    return counts;
  }, {});

  console.log(`    ✓ ${drafted.length} questions → ${path}`);
  console.log(`      ${Object.entries(bySkill).map(([skill, count]) => `${skill}: ${count}`).join(" · ")}`);
  console.log(`\n  Review the draft, then import it:\n    node scripts/import-content.mjs ${path}\n`);
}

await main();
