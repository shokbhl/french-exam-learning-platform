/**
 * Environment loading shared by the operational scripts.
 *
 * Vercel and CI supply these directly; locally they sit in .env.local. An
 * ambient variable always wins, so a one-off `ANTHROPIC_API_KEY=… node …`
 * behaves as expected.
 */

import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function loadEnv(path = ".env.local") {
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      if (!line.includes("=") || line.trimStart().startsWith("#")) continue;
      const at = line.indexOf("=");
      const key = line.slice(0, at).trim();
      if (process.env[key]) continue;
      process.env[key] = line
        .slice(at + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
    }
  } catch {
    /* no .env.local; rely on the ambient environment */
  }
}

export function fail(message: string): never {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
}

/**
 * A service-role client.
 *
 * Extracted source text and answer keys are unreachable through PostgREST for
 * every signed-in role, staff included, so these scripts cannot do their work
 * with a user session.
 */
export function adminClient(): SupabaseClient {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Resolves a material by exact title, with its newest file. */
export async function findMaterial(db: SupabaseClient, title: string) {
  const { data, error } = await db
    .from("source_materials")
    .select("id, title, cefr_level, language, source_files(id, version, storage_path, original_filename, mime_type, byte_size)")
    .eq("title", title)
    .maybeSingle();

  if (error) fail(`looking up "${title}": ${error.message}`);
  if (!data) fail(`no source material titled "${title}". Upload it at /admin/materials first.`);

  const files = (data.source_files ?? []) as {
    id: string;
    version: number;
    storage_path: string;
    original_filename: string;
    mime_type: string;
    byte_size: number;
  }[];
  const latest = files.slice().sort((a, b) => b.version - a.version)[0];
  if (!latest) fail(`"${title}" has no uploaded file.`);

  return { material: data, file: latest };
}
