import { createBrowserClient } from "@supabase/ssr";
import { getPublicEnv } from "@/lib/env";

export function createClient() {
  const parsed = getPublicEnv();
  if (!parsed.success) throw new Error("Supabase is not configured. Copy .env.example to .env.local and add your project values.");
  return createBrowserClient(parsed.data.NEXT_PUBLIC_SUPABASE_URL, parsed.data.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
