import { LearningLab } from "@/components/learning-lab";
import { PracticeRunner } from "@/components/practice-runner";
import { COMPREHENSION_SKILLS, loadPracticeSets } from "@/lib/repositories/practice";

export const metadata = { title: "Entraînement" };

/**
 * Comprehension practice: listening and reading.
 *
 * Serves database content when there is any, and the demonstration lab when
 * there is not. Keeping the fallback means a fresh checkout with no Supabase
 * project still shows a working exercise, which the demo mode elsewhere in the
 * project also assumes.
 */
export default async function PracticePage() {
  const state = await loadPracticeSets([...COMPREHENSION_SKILLS, "GRAMMAR", "VOCABULARY"]);
  if (state.status === "ready") return <PracticeRunner sets={state.sets} />;
  return <LearningLab />;
}
