"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export type AuthState = { error: string; notice?: string };

const credentials = z.object({
  email: z.string().trim().email("Adresse courriel invalide."),
  password: z.string().min(8, "Le mot de passe doit contenir au moins 8 caractères."),
});

const NOT_CONFIGURED = "Supabase n’est pas configuré. Ajoutez les variables indiquées dans .env.example.";

/** Only allow same-origin paths, so `next` cannot be used as an open redirect. */
function safeNext(value: FormDataEntryValue | null) {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export async function signIn(_previous: AuthState, formData: FormData): Promise<AuthState> {
  if (!isSupabaseConfigured()) return { error: NOT_CONFIGURED };

  const parsed = credentials.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Identifiants invalides." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    // Distinguish an unconfirmed address from a wrong password: telling someone
    // their password is wrong when they simply have not clicked the email link
    // sends them round in circles.
    if (error.code === "email_not_confirmed") {
      return {
        error: "",
        notice: "Votre adresse n’est pas encore confirmée. Ouvrez le lien envoyé à votre adresse courriel.",
      };
    }
    return { error: "Adresse ou mot de passe incorrect." };
  }
  redirect(safeNext(formData.get("next")));
}

export async function signUp(_previous: AuthState, formData: FormData): Promise<AuthState> {
  if (!isSupabaseConfigured()) return { error: NOT_CONFIGURED };

  const parsed = credentials.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Identifiants invalides." };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp(parsed.data);
  if (error) return { error: "Impossible de créer ce compte." };

  // This project requires email confirmation, so sign-up returns no session.
  // Redirecting to the application here would bounce the learner straight back
  // to this page with no explanation, because every route now needs a session.
  if (!data.session) {
    return {
      error: "",
      notice:
        "Compte créé. Ouvrez le lien de confirmation envoyé à votre adresse courriel, puis connectez-vous pour accéder à votre parcours.",
    };
  }
  redirect("/onboarding");
}
