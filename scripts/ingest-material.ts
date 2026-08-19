#!/usr/bin/env node
/**
 * Reads an uploaded material into page-level text and citable chunks.
 *
 * This is the step between "a file exists in private storage" and "a question
 * can cite page 12 of it". It writes `document_pages` and `document_chunks`,
 * and records an `ingestion_jobs` row with its events so a failed run explains
 * itself rather than leaving a half-read document behind.
 *
 * Re-running replaces the pages and chunks of that file: extraction is
 * deterministic for a given file, and stale chunks from an earlier run would be
 * cited by questions as though they were current.
 *
 *   node scripts/ingest-material.ts --material "Titre du document"
 *   node scripts/ingest-material.ts --all
 *   node scripts/ingest-material.ts --material "…" --allow-model-reading
 */

import { chunkPages, type ExtractedPage } from "../src/lib/ingestion/chunk.ts";
import { extractLocally, isImage, isPdf } from "../src/lib/ingestion/extract.ts";
import { adminClient, fail, findMaterial } from "./lib/env.ts";

type Args = { titles: string[]; all: boolean; allowModel: boolean };

function parseArgs(argv: string[]): Args {
  const args: Args = { titles: [], all: false, allowModel: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--all") args.all = true;
    else if (argv[i] === "--allow-model-reading") args.allowModel = true;
    else if (argv[i] === "--material") {
      const value = argv[i + 1];
      if (!value) fail("--material needs a title");
      args.titles.push(value);
      i += 1;
    } else fail(`unknown argument: ${argv[i]}`);
  }
  if (!args.all && args.titles.length === 0) {
    fail('usage: node scripts/ingest-material.ts --material "Title" [--allow-model-reading] | --all');
  }
  return args;
}

async function ingestOne(db: ReturnType<typeof adminClient>, title: string, allowModel: boolean) {
  const { material, file } = await findMaterial(db, title);
  console.log(`\n  ${material.title}\n    file: ${file.original_filename} (${file.mime_type})`);

  const { data: job, error: jobError } = await db
    .from("ingestion_jobs")
    .insert({ source_file_id: file.id, status: "processing", stage: "extract", started_at: new Date().toISOString() })
    .select("id")
    .single();
  if (jobError) fail(`could not open an ingestion job: ${jobError.message}`);

  const event = (stage: string, status: string, message: string, details: Record<string, unknown> = {}) =>
    db.from("ingestion_events").insert({ job_id: job.id, stage, status, message, details });

  const finish = async (status: string, message: string) => {
    await db
      .from("ingestion_jobs")
      .update({ status, stage: message, finished_at: new Date().toISOString() })
      .eq("id", job.id);
  };

  const { data: download, error: downloadError } = await db.storage.from("materials").download(file.storage_path);
  if (downloadError || !download) {
    await event("extract", "failed", `download failed: ${downloadError?.message}`);
    await finish("failed", "download");
    fail(`could not download "${file.original_filename}": ${downloadError?.message}`);
  }

  const bytes = new Uint8Array(await download.arrayBuffer());
  let extracted = await extractLocally(bytes, file.mime_type, file.original_filename);

  if (extracted.unsupported) {
    await event("extract", "failed", extracted.unsupported);
    await finish("failed", "unsupported");
    console.log(`    ✗ ${extracted.unsupported}`);
    return;
  }

  // A scan has no text layer to read. The model can read it, but that is a
  // paid call on someone else's material, so it stays opt-in per run.
  if (extracted.needsModelReading) {
    if (!allowModel) {
      const reason =
        "aucune couche de texte détectée (document numérisé). Relancez avec --allow-model-reading pour le faire lire par le modèle.";
      await event("extract", "needs_review", reason);
      await finish("needs_review", "scanned");
      console.log(`    ⚠ ${reason}`);
      return;
    }

    const { hasAnthropicKey, readDocumentWithModel } = await import("../src/lib/ai/anthropic.ts");
    if (!hasAnthropicKey()) {
      await event("extract", "failed", "ANTHROPIC_API_KEY is not set");
      await finish("failed", "no provider");
      fail("ANTHROPIC_API_KEY is not set, so a scanned document cannot be read.");
    }

    const mediaType = isPdf(file.mime_type, file.original_filename)
      ? "application/pdf"
      : isImage(file.mime_type)
        ? file.mime_type
        : null;
    if (!mediaType) {
      await event("extract", "failed", `no model reader for ${file.mime_type}`);
      await finish("failed", "unsupported");
      fail(`no model reader for ${file.mime_type}`);
    }

    console.log("    reading with the model (scanned document)…");
    const read = await readDocumentWithModel(bytes, mediaType);
    extracted = {
      pages: read.map((page) => ({
        pageNumber: page.page,
        text: page.text,
        method: "ocr" as const,
        confidence: page.confidence,
      })),
      needsModelReading: false,
    };
  }

  const usable = extracted.pages.filter((page) => page.text.trim().length > 0);
  if (usable.length === 0) {
    await event("extract", "failed", "no text could be read");
    await finish("failed", "empty");
    console.log("    ✗ aucun texte n’a pu être lu.");
    return;
  }

  // Replaced rather than appended: chunks cascade from pages, so clearing the
  // pages clears the chunks and embeddings of the previous run with them.
  const { error: clearError } = await db.from("document_pages").delete().eq("source_file_id", file.id);
  if (clearError) fail(`clearing previous pages: ${clearError.message}`);

  const { error: pageError } = await db.from("document_pages").insert(
    usable.map((page) => ({
      source_file_id: file.id,
      page_number: page.pageNumber,
      text: page.text,
      char_count: page.text.length,
      extraction_method: page.method,
      confidence: page.confidence,
    })),
  );
  if (pageError) fail(`writing pages: ${pageError.message}`);
  await event("extract", "complete", `${usable.length} pages`, { method: usable[0].method });

  const chunks = chunkPages(usable as ExtractedPage[]);
  const { error: clearChunks } = await db.from("document_chunks").delete().eq("source_file_id", file.id);
  if (clearChunks) fail(`clearing previous chunks: ${clearChunks.message}`);

  const { error: chunkError } = await db.from("document_chunks").insert(
    chunks.map((chunk) => ({
      source_file_id: file.id,
      chunk_index: chunk.chunkIndex,
      page_from: chunk.pageFrom,
      page_to: chunk.pageTo,
      heading: chunk.heading,
      text: chunk.text,
      token_count: chunk.tokenCount,
    })),
  );
  if (chunkError) fail(`writing chunks: ${chunkError.message}`);

  await event("chunk", "complete", `${chunks.length} chunks`);
  await finish("complete", "done");

  const method = usable[0].method === "ocr" ? "lecture par le modèle" : "couche de texte";
  console.log(`    ✓ ${usable.length} pages · ${chunks.length} chunks · ${method}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = adminClient();

  let titles = args.titles;
  if (args.all) {
    const { data, error } = await db.from("source_materials").select("title").order("title");
    if (error) fail(`listing materials: ${error.message}`);
    titles = (data ?? []).map((row) => row.title as string);
  }

  for (const title of titles) await ingestOne(db, title, args.allowModel);
  console.log("\n  Ingestion complete.\n");
}

await main();
