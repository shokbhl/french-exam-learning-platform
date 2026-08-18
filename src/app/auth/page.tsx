"use client";
import { useActionState, useState } from "react";
import Link from "next/link";
import { signIn, signUp } from "./actions";

const initial = { error: "" };
export default function AuthPage() {
  const [mode,setMode]=useState<"login"|"signup">("login");
  const [state,action,pending]=useActionState(mode === "login" ? signIn : signUp, initial);
  return <main className="auth-page"><Link href="/" className="brand auth-brand"><span className="brand-mark">ç</span><span>Parcours<span>français</span></span></Link><section className="auth-card"><p className="eyebrow">{mode === "login" ? "BON RETOUR" : "COMMENCER"}</p><h1>{mode === "login" ? "Connectez-vous" : "Créez votre compte"}</h1><p>Votre parcours de français et de préparation aux examens, au même endroit.</p><form action={action}><label>Adresse courriel<input name="email" type="email" required autoComplete="email"/></label><label>Mot de passe<input name="password" type="password" minLength={8} required autoComplete={mode === "login" ? "current-password" : "new-password"}/></label>{state?.error&&<div role="alert" className="form-error">{state.error}</div>}<button className="primary" disabled={pending}>{pending?"Veuillez patienter…":mode === "login"?"Se connecter":"Créer mon compte"}</button></form><button className="text-button" onClick={()=>setMode(mode === "login"?"signup":"login")}>{mode === "login"?"Nouveau ici ? Créer un compte":"Déjà inscrit ? Se connecter"}</button></section></main>;
}
