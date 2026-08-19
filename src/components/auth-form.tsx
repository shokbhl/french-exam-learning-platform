"use client";
import { useActionState, useState } from "react";
import { signIn, signUp, type AuthState } from "@/app/auth/actions";

const initial: AuthState = { error: "", notice: "" };

export function AuthForm({ next }: { next: string }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [state, action, pending] = useActionState(mode === "login" ? signIn : signUp, initial);
  return (
    <section className="auth-card">
      <p className="eyebrow">{mode === "login" ? "BON RETOUR" : "COMMENCER"}</p>
      <h1>{mode === "login" ? "Connectez-vous" : "Créez votre compte"}</h1>
      <p>Votre parcours de français et de préparation aux examens, au même endroit.</p>
      <form action={action}>
        <input type="hidden" name="next" value={next} />
        <label>Adresse courriel<input name="email" type="email" required autoComplete="email"/></label>
        <label>Mot de passe<input name="password" type="password" minLength={8} required autoComplete={mode === "login" ? "current-password" : "new-password"}/></label>
        {state?.error && <div role="alert" className="form-error">{state.error}</div>}
        {state?.notice && <div role="status" className="form-success">{state.notice}</div>}
        <button className="primary" disabled={pending}>{pending ? "Veuillez patienter…" : mode === "login" ? "Se connecter" : "Créer mon compte"}</button>
      </form>
      <button className="text-button" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
        {mode === "login" ? "Nouveau ici ? Créer un compte" : "Déjà inscrit ? Se connecter"}
      </button>
    </section>
  );
}
