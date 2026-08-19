"use server";

import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/**
 * Ends the session and returns to the sign-in page.
 *
 * Every route except the auth pages now requires a session, so without this
 * a learner who signs in has no way back out.
 */
export async function signOut() {
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect("/auth");
}
