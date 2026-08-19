"use server";

import { z } from "zod";
import { isSupabaseConfigured } from "@/lib/env";
import { rateLimit } from "@/lib/rate-limit";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type DownloadResult = { ok: true; url: string } | { ok: false; message: string };

const fileIdSchema = z.string().uuid();

/** Signed links are short-lived: the file is licensed material, not a public asset. */
const SIGNED_URL_SECONDS = 120;

/**
 * Produces a temporary link to a library file.
 *
 * The permission decision is made by the database, through
 * `may_download_source_file` called with the learner's own session, so it
 * follows exactly the rules the RLS tests cover. Only after that does the
 * service-role client mint the URL, because the storage bucket is closed to
 * members and nothing else can sign for it.
 */
export async function createDownloadUrl(sourceFileId: string): Promise<DownloadResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: "Mode démonstration : aucun fichier n’est disponible." };
  }

  const parsed = fileIdSchema.safeParse(sourceFileId);
  if (!parsed.success) return { ok: false, message: "Fichier introuvable." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Votre session a expiré." };

  const limit = rateLimit(`download:${user.id}`, 30, 60);
  if (!limit.allowed) {
    return {
      ok: false,
      message: `Trop de téléchargements. Réessayez dans ${limit.retryAfterSeconds} secondes.`,
    };
  }

  const { data: allowed, error: checkError } = await supabase.rpc("may_download_source_file", {
    target_file_id: parsed.data,
  });
  if (checkError) {
    console.error("download permission check failed", checkError.message);
    return { ok: false, message: "Le fichier n’a pas pu être vérifié." };
  }
  if (allowed !== true) {
    // Deliberately the same message as a missing file: whether a given
    // material exists is not something to confirm to someone who may not see it.
    return { ok: false, message: "Fichier introuvable." };
  }

  if (!hasServiceRole()) {
    return {
      ok: false,
      message: "Le téléchargement n’est pas configuré sur ce serveur.",
    };
  }

  const admin = createAdminClient();
  const { data: file, error: fileError } = await admin
    .from("source_files")
    .select("storage_path, original_filename")
    .eq("id", parsed.data)
    .maybeSingle();

  if (fileError || !file) {
    console.error("download path lookup failed", fileError?.message);
    return { ok: false, message: "Fichier introuvable." };
  }

  const { data: signed, error: signError } = await admin.storage
    .from("materials")
    .createSignedUrl(file.storage_path, SIGNED_URL_SECONDS, {
      download: file.original_filename,
    });

  if (signError || !signed) {
    console.error("signed url failed", signError?.message);
    return { ok: false, message: "Le lien de téléchargement n’a pas pu être créé." };
  }

  // Recorded with the learner's own client so the insert is subject to the
  // same policy as any other write they make.
  const { error: logError } = await supabase
    .from("material_downloads")
    .insert({ source_file_id: parsed.data, actor_id: user.id });
  if (logError) console.error("download log failed", logError.message);

  return { ok: true, url: signed.signedUrl };
}
