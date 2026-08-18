"use server";
import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export async function signIn(_previous: { error: string }, formData: FormData) {
  if (!isSupabaseConfigured()) return { error: "Supabase n’est pas configuré. Ajoutez les variables indiquées dans .env.example." };
  const email = String(formData.get("email") ?? ""); const password = String(formData.get("password") ?? "");
  const supabase = await createClient(); const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "Adresse ou mot de passe incorrect." }; redirect("/");
}

export async function signUp(_previous: { error: string }, formData: FormData) {
  if (!isSupabaseConfigured()) return { error: "Supabase n’est pas configuré. Ajoutez les variables indiquées dans .env.example." };
  const email = String(formData.get("email") ?? ""); const password = String(formData.get("password") ?? "");
  if (password.length < 8) return { error: "Le mot de passe doit contenir au moins 8 caractères." };
  const supabase = await createClient(); const { error } = await supabase.auth.signUp({ email, password });
  if (error) return { error: "Impossible de créer ce compte." }; redirect("/onboarding");
}
