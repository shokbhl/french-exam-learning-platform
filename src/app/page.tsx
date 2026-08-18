import Platform from "@/components/platform";
import { loadProgress } from "@/lib/repositories/progress";

export default async function HomePage() {
  // Read on the server so the dashboard renders the learner's real figures
  // instead of flashing placeholder values before hydration.
  const serverProgress = await loadProgress();
  return <Platform serverProgress={serverProgress} />;
}
