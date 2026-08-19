import { PracticeRunner } from "@/components/practice-runner";
import { ProductionLab } from "@/components/production-lab";
import { loadPracticeSets, PRODUCTION_SKILLS } from "@/lib/repositories/practice";

export const metadata = { title: "Écrire & parler" };

/**
 * Production practice: writing and speaking.
 *
 * Authored production questions are served here rather than on the practice
 * page, so a mixed set imported from one document reaches the section of the
 * exam it actually belongs to.
 */
export default async function ProductionPage() {
  const state = await loadPracticeSets(PRODUCTION_SKILLS);
  if (state.status === "ready") return <PracticeRunner sets={state.sets} />;
  return <ProductionLab />;
}
