import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/**
 * Learner progress as stored in the database.
 *
 * Every field is a real count. There is no seeded or placeholder variant of
 * this type: a learner who has done nothing has zeroes, and a failed read
 * produces an error state rather than plausible-looking numbers.
 */
export type ProgressSnapshot = {
  xp: number;
  currentStreak: number;
  longestStreak: number;
  completedLessonIds: string[];
};

/**
 * The four situations the dashboard has to tell apart.
 *
 * `demo` and `error` exist so the interface can say which one it is. Rendering
 * demonstration figures as though they were the learner's own record is the
 * specific failure this type is shaped to prevent.
 */
export type ProgressState =
  | { status: "unconfigured" }
  | { status: "signed-out" }
  | { status: "ready"; snapshot: ProgressSnapshot }
  | { status: "error"; message: string };

export const emptySnapshot: ProgressSnapshot = {
  xp: 0,
  currentStreak: 0,
  longestStreak: 0,
  completedLessonIds: [],
};

/**
 * Reads the signed-in learner's progress.
 *
 * Row level security restricts both queries to the caller, so no user filter
 * is applied here; the database is the boundary rather than this function.
 */
export async function loadProgress(): Promise<ProgressState> {
  if (!isSupabaseConfigured()) return { status: "unconfigured" };

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { status: "signed-out" };

    const [progress, completions] = await Promise.all([
      supabase
        .from("learner_progress")
        .select("xp, current_streak, longest_streak")
        .maybeSingle(),
      supabase.from("lesson_completions").select("lesson_id"),
    ]);

    if (progress.error || completions.error) {
      // The specific database message is deliberately not forwarded to the
      // browser; it is logged for an operator instead.
      console.error("progress read failed", {
        progress: progress.error?.message,
        completions: completions.error?.message,
      });
      return {
        status: "error",
        message: "Vos statistiques n’ont pas pu être chargées.",
      };
    }

    return {
      status: "ready",
      snapshot: {
        // A learner with no activity has no learner_progress row yet, which is
        // a genuine zero rather than a missing value.
        xp: progress.data?.xp ?? 0,
        currentStreak: progress.data?.current_streak ?? 0,
        longestStreak: progress.data?.longest_streak ?? 0,
        completedLessonIds: (completions.data ?? []).map((row) => row.lesson_id),
      },
    };
  } catch (error) {
    console.error("progress read threw", error);
    return {
      status: "error",
      message: "Vos statistiques n’ont pas pu être chargées.",
    };
  }
}
