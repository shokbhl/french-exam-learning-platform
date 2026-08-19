import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * A client that bypasses row level security.
 *
 * Used only where the database cannot express the decision, which currently
 * means minting signed URLs for the private storage bucket. Every caller must
 * establish authorization first — through `may_download_source_file` or an
 * equivalent check made with the caller's own session — because nothing this
 * client does is filtered by policy.
 *
 * The `server-only` import above makes a build fail rather than shipping the
 * service-role key to a browser bundle.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) {
    throw new Error("Service-role access is not configured.");
  }
  return createSupabaseClient<Database>(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function hasServiceRole() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
