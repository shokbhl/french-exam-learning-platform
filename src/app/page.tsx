import { redirect } from "next/navigation";
import Platform from "@/components/platform";
import { loadProgress } from "@/lib/repositories/progress";

export default async function HomePage() {
  // Read on the server so the dashboard renders the learner's real figures
  // instead of flashing placeholder values before hydration.
  const serverProgress = await loadProgress();

  // A signed-in learner who has not set a goal yet has nothing to show on the
  // dashboard, and every recommendation depends on it, so finish onboarding
  // first. The onboarding route itself stays reachable.
  if (serverProgress.status === "ready" && !serverProgress.snapshot.goals) {
    redirect("/onboarding");
  }

  return <Platform serverProgress={serverProgress} />;
}
