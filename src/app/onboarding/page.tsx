import Link from "next/link";
import { OnboardingForm } from "@/components/onboarding-form";
import { isSupabaseConfigured } from "@/lib/env";
export default function OnboardingPage(){return <main className="standalone-page"><Link href="/" className="back-link">← Tableau de bord</Link><header><p className="eyebrow">VOTRE PARCOURS</p><h1>Un programme qui s’adapte à vous</h1><p>Répondez à quelques questions. La date d’examen reste facultative.</p></header><OnboardingForm configured={isSupabaseConfigured()}/></main>}
